//! Turns the grid's pending changes into statements that run in one transaction. Rows are found by
//! their primary key; each update and delete must touch exactly one row or the commit rolls back.

use std::fmt::Write as _;

use serde::Deserialize;

use crate::dialect::Dialect;
use crate::error::{Error, Result};
use crate::query::{Builder, Statement};
use crate::schema::{Table, TableRef};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub column: String,
    /// `None` writes `NULL`.
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RowUpdate {
    /// The primary key of the row as it was read.
    pub key: Vec<Cell>,
    pub set: Vec<Cell>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSet {
    pub table: TableRef,
    pub updates: Vec<RowUpdate>,
    /// New rows; columns left out take their default.
    pub inserts: Vec<Vec<Cell>>,
    /// Primary keys of rows to delete.
    pub deletes: Vec<Vec<Cell>>,
}

impl ChangeSet {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.updates.is_empty() && self.inserts.is_empty() && self.deletes.is_empty()
    }
}

/// A statement and whether it must affect exactly one row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Change {
    pub statement: Statement,
    pub exactly_one_row: bool,
}

/// Why rows of this table can't be edited, if they can't.
#[must_use]
pub(crate) fn not_editable_because(table: &Table) -> Option<String> {
    if table.primary_key().is_empty() {
        Some(format!(
            "{} has no primary key, so rows can't be told apart to edit them.",
            table.name
        ))
    } else {
        None
    }
}

/// Builds every statement for `changes`, in the order deletes, updates, inserts.
///
/// # Errors
/// Fails when the table has no primary key, a key doesn't match it, or a column doesn't exist.
pub(crate) fn statements(
    dialect: Dialect,
    table: &Table,
    changes: &ChangeSet,
) -> Result<Vec<Change>> {
    if let Some(reason) = not_editable_because(table) {
        return Err(Error::Unsupported(reason));
    }
    let deletes = changes.deletes.iter().map(|key| delete(dialect, table, key));
    let updates = changes.updates.iter().map(|update| self::update(dialect, table, update));
    let inserts = changes.inserts.iter().map(|values| insert(dialect, table, values));
    deletes.chain(updates).chain(inserts).collect()
}

fn key_condition(builder: &mut Builder<'_>, key: &[Cell]) -> Result<String> {
    let primary: Vec<&str> =
        builder.table.primary_key().iter().map(|column| column.name.as_str()).collect();
    let given: Vec<&str> = key.iter().map(|cell| cell.column.as_str()).collect();
    if primary.len() != given.len() || !primary.iter().all(|name| given.contains(name)) {
        return Err(Error::Invalid(format!(
            "a row of {} is identified by {}, not {}",
            builder.table.name,
            primary.join(", "),
            given.join(", ")
        )));
    }
    let mut parts = Vec::with_capacity(key.len());
    for cell in key {
        let column = builder.column(&cell.column)?;
        let value = cell
            .value
            .clone()
            .ok_or_else(|| Error::Invalid(format!("{} can't be NULL in a key", column.name)))?;
        let placeholder = builder.bind(column, Some(value));
        parts.push(format!("{} = {placeholder}", builder.dialect.quote(&column.name)));
    }
    Ok(parts.join(" AND "))
}

fn delete(dialect: Dialect, table: &Table, key: &[Cell]) -> Result<Change> {
    let mut builder = Builder::new(dialect, table);
    let condition = key_condition(&mut builder, key)?;
    let sql = format!("DELETE FROM {} WHERE {condition}", builder.target());
    Ok(Change { statement: Statement { sql, params: builder.params }, exactly_one_row: true })
}

fn update(dialect: Dialect, table: &Table, update: &RowUpdate) -> Result<Change> {
    if update.set.is_empty() {
        return Err(Error::Invalid("an update needs at least one changed column".into()));
    }
    let mut builder = Builder::new(dialect, table);
    let mut assignments = Vec::with_capacity(update.set.len());
    for cell in &update.set {
        let column = builder.column(&cell.column)?;
        let placeholder = builder.bind(column, cell.value.clone());
        assignments.push(format!("{} = {placeholder}", dialect.quote(&column.name)));
    }
    let condition = key_condition(&mut builder, &update.key)?;
    let sql =
        format!("UPDATE {} SET {} WHERE {condition}", builder.target(), assignments.join(", "));
    Ok(Change { statement: Statement { sql, params: builder.params }, exactly_one_row: true })
}

fn insert(dialect: Dialect, table: &Table, values: &[Cell]) -> Result<Change> {
    let mut builder = Builder::new(dialect, table);
    if values.is_empty() {
        let sql = match dialect {
            Dialect::MySql => format!("INSERT INTO {} () VALUES ()", builder.target()),
            Dialect::Postgres | Dialect::Sqlite | Dialect::ClickHouse => {
                format!("INSERT INTO {} DEFAULT VALUES", builder.target())
            }
        };
        return Ok(Change {
            statement: Statement { sql, params: Vec::new() },
            exactly_one_row: true,
        });
    }
    let mut names = Vec::with_capacity(values.len());
    let mut placeholders = Vec::with_capacity(values.len());
    for cell in values {
        let column = builder.column(&cell.column)?;
        names.push(dialect.quote(&column.name));
        placeholders.push(builder.bind(column, cell.value.clone()));
    }
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        builder.target(),
        names.join(", "),
        placeholders.join(", ")
    );
    Ok(Change { statement: Statement { sql, params: builder.params }, exactly_one_row: true })
}

/// Readable SQL for the review sheet: parameters written in as quoted literals. For people only;
/// never executed.
#[must_use]
pub(crate) fn preview(dialect: Dialect, changes: &[Change]) -> String {
    let mut text = String::new();
    for change in changes {
        let _ = writeln!(text, "{};", inline(dialect, &change.statement));
    }
    text
}

/// Replaces `$n` (Postgres) or `?` (the others) outside quoted identifiers with literals.
fn inline(dialect: Dialect, statement: &Statement) -> String {
    let param = |index: usize| {
        statement
            .params
            .get(index)
            .map_or_else(|| "?".to_owned(), |value| literal(value.as_deref()))
    };
    let mut out = String::with_capacity(statement.sql.len());
    let mut chars = statement.sql.chars().peekable();
    let mut quote: Option<char> = None;
    let mut next_question = 0;
    while let Some(char) = chars.next() {
        match (quote, char) {
            (Some(mark), _) if char == mark => quote = None,
            (None, '"' | '`') => quote = Some(char),
            (None, '$')
                if dialect == Dialect::Postgres
                    && chars.peek().is_some_and(char::is_ascii_digit) =>
            {
                let mut index = 0_usize;
                while let Some(digit) = chars.peek().and_then(|next| next.to_digit(10)) {
                    index = index * 10 + digit as usize;
                    chars.next();
                }
                out.push_str(&param(index.saturating_sub(1)));
                continue;
            }
            (None, '?') if dialect != Dialect::Postgres => {
                out.push_str(&param(next_question));
                next_question += 1;
                continue;
            }
            _ => {}
        }
        out.push(char);
    }
    out
}

fn literal(value: Option<&str>) -> String {
    value.map_or_else(|| "NULL".to_owned(), |value| format!("'{}'", value.replace('\'', "''")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::tests::orders;

    fn cell(column: &str, value: Option<&str>) -> Cell {
        Cell { column: column.into(), value: value.map(Into::into) }
    }

    fn changes() -> ChangeSet {
        ChangeSet {
            table: TableRef { schema: Some("public".into()), name: "orders".into() },
            updates: vec![RowUpdate {
                key: vec![cell("id", Some("7"))],
                set: vec![cell("status", Some("O'Brien")), cell("total", None)],
            }],
            inserts: vec![vec![cell("status", Some("new"))], Vec::new()],
            deletes: vec![vec![cell("id", Some("9"))]],
        }
    }

    #[test]
    fn deletes_then_updates_then_inserts_by_primary_key() {
        let built = statements(Dialect::Postgres, &orders(), &changes()).unwrap();
        let sql: Vec<&str> = built.iter().map(|change| change.statement.sql.as_str()).collect();
        assert_eq!(
            sql,
            [
                "DELETE FROM \"public\".\"orders\" WHERE \"id\" = CAST($1 AS integer)",
                "UPDATE \"public\".\"orders\" SET \"status\" = CAST($1 AS text), \"total\" = CAST($2 AS numeric(10,2)) WHERE \"id\" = CAST($3 AS integer)",
                "INSERT INTO \"public\".\"orders\" (\"status\") VALUES (CAST($1 AS text))",
                "INSERT INTO \"public\".\"orders\" DEFAULT VALUES",
            ]
        );
        assert_eq!(built[1].statement.params, vec![Some("O'Brien".into()), None, Some("7".into())]);
    }

    #[test]
    fn refuses_a_key_that_is_not_the_primary_key() {
        let mut wrong = changes();
        wrong.deletes = vec![vec![cell("status", Some("paid"))]];
        assert!(
            statements(Dialect::MySql, &orders(), &wrong)
                .unwrap_err()
                .to_string()
                .contains("identified by id")
        );
    }

    #[test]
    fn refuses_tables_without_a_primary_key() {
        let mut table = orders();
        table.columns[0].primary_key = false;
        assert!(not_editable_because(&table).is_some());
        assert!(statements(Dialect::Sqlite, &table, &changes()).is_err());
    }

    #[test]
    fn previews_with_quoted_literals() {
        let built = statements(Dialect::Postgres, &orders(), &changes()).unwrap();
        let text = preview(Dialect::Postgres, &built[1..2]);
        assert_eq!(
            text,
            "UPDATE \"public\".\"orders\" SET \"status\" = CAST('O''Brien' AS text), \"total\" = CAST(NULL AS numeric(10,2)) WHERE \"id\" = CAST('7' AS integer);\n"
        );
        let mysql = statements(Dialect::MySql, &orders(), &changes()).unwrap();
        assert_eq!(
            preview(Dialect::MySql, &mysql[..1]),
            "DELETE FROM `public`.`orders` WHERE `id` = '9';\n"
        );
    }
}
