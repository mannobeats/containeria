//! Builds the SQL that reads a table page. Values are always bound parameters; identifiers come
//! from the introspected schema and are quoted; types used in casts come from the database's own
//! catalog, never from the UI.

use serde::Deserialize;

use crate::dialect::{Dialect, escape_like};
use crate::error::{Error, Result};
use crate::schema::{Column, Table, TableRef};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Equals,
    NotEquals,
    Greater,
    Less,
    GreaterOrEqual,
    LessOrEqual,
    Contains,
    StartsWith,
    IsNull,
    IsNotNull,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub column: String,
    pub op: FilterOp,
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Sort {
    pub column: String,
    pub descending: bool,
}

/// One page of a table, filtered and sorted in the database.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RowsRequest {
    pub table: TableRef,
    pub filters: Vec<Filter>,
    pub sort: Option<Sort>,
    pub limit: u32,
    pub offset: u32,
}

/// SQL with its bound parameters, in order. `None` binds `NULL`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Statement {
    pub sql: String,
    pub params: Vec<Option<String>>,
}

/// Never return more than this many rows on one page.
pub(crate) const MAX_PAGE: u32 = 1000;

pub(crate) struct Builder<'a> {
    pub(crate) dialect: Dialect,
    pub(crate) table: &'a Table,
    pub(crate) params: Vec<Option<String>>,
}

impl<'a> Builder<'a> {
    pub(crate) const fn new(dialect: Dialect, table: &'a Table) -> Self {
        Self { dialect, table, params: Vec::new() }
    }

    pub(crate) fn column(&self, name: &str) -> Result<&'a Column> {
        self.table.column(name).ok_or_else(|| {
            Error::Invalid(format!("{} has no column named {name}", self.table.name))
        })
    }

    pub(crate) fn target(&self) -> String {
        self.dialect.table(self.table.schema.as_deref(), &self.table.name)
    }

    /// Binds `value` and returns its placeholder, cast to the column type where the engine needs it.
    pub(crate) fn bind(&mut self, column: &Column, value: Option<String>) -> String {
        self.params.push(value);
        let cast = match self.dialect {
            Dialect::Postgres | Dialect::ClickHouse => Some(column.type_name.as_str()),
            Dialect::MySql | Dialect::Sqlite => None,
        };
        self.dialect.placeholder(self.params.len(), cast)
    }

    fn condition(&mut self, filter: &Filter) -> Result<String> {
        let column = self.column(&filter.column)?;
        let name = self.dialect.quote(&column.name);
        let value = || {
            filter.value.clone().ok_or_else(|| {
                Error::Invalid(format!("the filter on {} needs a value", column.name))
            })
        };
        let operator = match filter.op {
            FilterOp::IsNull => return Ok(format!("{name} IS NULL")),
            FilterOp::IsNotNull => return Ok(format!("{name} IS NOT NULL")),
            FilterOp::Contains | FilterOp::StartsWith => {
                let term = escape_like(&value()?);
                let pattern = if filter.op == FilterOp::Contains {
                    format!("%{term}%")
                } else {
                    format!("{term}%")
                };
                self.params.push(Some(pattern));
                let placeholder = self.dialect.placeholder(self.params.len(), None);
                return Ok(self.dialect.like(&name, &placeholder));
            }
            FilterOp::Equals => "=",
            FilterOp::NotEquals => "<>",
            FilterOp::Greater => ">",
            FilterOp::Less => "<",
            FilterOp::GreaterOrEqual => ">=",
            FilterOp::LessOrEqual => "<=",
        };
        let placeholder = self.bind(column, Some(value()?));
        Ok(format!("{name} {operator} {placeholder}"))
    }

    fn where_clause(&mut self, filters: &[Filter]) -> Result<String> {
        if filters.is_empty() {
            return Ok(String::new());
        }
        let conditions =
            filters.iter().map(|filter| self.condition(filter)).collect::<Result<Vec<_>>>()?;
        Ok(format!(" WHERE {}", conditions.join(" AND ")))
    }

    fn select_list(&self) -> String {
        self.table
            .columns
            .iter()
            .map(|column| {
                let name = self.dialect.quote(&column.name);
                // Postgres hands every column back as text, so any type, even one a driver doesn't
                // know, shows up; the grid reads it back by the column's type.
                if self.dialect == Dialect::Postgres {
                    format!("{name}::text AS {name}")
                } else {
                    name
                }
            })
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn finish(self, sql: String) -> Statement {
        Statement { sql, params: self.params }
    }
}

/// `SELECT` for one page of `table`.
///
/// # Errors
/// Fails when a filter or sort names a column the table doesn't have, or misses its value.
pub(crate) fn select_rows(
    dialect: Dialect,
    table: &Table,
    request: &RowsRequest,
) -> Result<Statement> {
    let mut builder = Builder::new(dialect, table);
    let filters = builder.where_clause(&request.filters)?;
    let target = builder.target();
    let qualified = |name: &str| {
        let column = dialect.quote(name);
        // A bare name would sort by the `::text` copy in the select list, putting 10 before 9.
        if dialect == Dialect::Postgres { format!("{target}.{column}") } else { column }
    };
    let mut terms = Vec::new();
    if let Some(sort) = &request.sort {
        terms.push(dialect.order(&qualified(&builder.column(&sort.column)?.name), sort.descending));
    }
    // Rows that tie, or a page with no order at all, may come back in a different order each time,
    // so paging would repeat some and skip others; the primary key breaks every tie.
    for key in table.primary_key() {
        if request.sort.as_ref().is_none_or(|sort| sort.column != key.name) {
            terms.push(dialect.order(&qualified(&key.name), false));
        }
    }
    let order =
        if terms.is_empty() { String::new() } else { format!(" ORDER BY {}", terms.join(", ")) };
    let limit = request.limit.clamp(1, MAX_PAGE);
    let sql = format!(
        "SELECT {} FROM {}{filters}{order} LIMIT {limit} OFFSET {}",
        builder.select_list(),
        builder.target(),
        request.offset
    );
    Ok(builder.finish(sql))
}

/// Counts matching rows, stopping at `cap` so a filter over a huge table stays fast.
///
/// # Errors
/// Fails when a filter names a column the table doesn't have.
pub(crate) fn count_rows(
    dialect: Dialect,
    table: &Table,
    filters: &[Filter],
    cap: u32,
) -> Result<Statement> {
    let mut builder = Builder::new(dialect, table);
    let conditions = builder.where_clause(filters)?;
    let sql = format!(
        "SELECT count(*) FROM (SELECT 1 FROM {}{conditions} LIMIT {cap}) AS counted",
        builder.target()
    );
    Ok(builder.finish(sql))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::schema::TableKind;

    pub(crate) fn orders() -> Table {
        let mut id = Column::new("id", "integer");
        id.primary_key = true;
        Table {
            schema: Some("public".into()),
            name: "orders".into(),
            kind: TableKind::Table,
            row_estimate: Some(10),
            size_bytes: None,
            columns: vec![id, Column::new("status", "text"), Column::new("total", "numeric(10,2)")],
            indexes: Vec::new(),
        }
    }

    fn request(filters: Vec<Filter>, sort: Option<Sort>) -> RowsRequest {
        RowsRequest {
            table: TableRef { schema: Some("public".into()), name: "orders".into() },
            filters,
            sort,
            limit: 100,
            offset: 200,
        }
    }

    fn filter(column: &str, op: FilterOp, value: Option<&str>) -> Filter {
        Filter { column: column.into(), op, value: value.map(Into::into) }
    }

    #[test]
    fn binds_filter_values_and_casts_them_on_postgres() {
        let statement = select_rows(
            Dialect::Postgres,
            &orders(),
            &request(
                vec![
                    filter("total", FilterOp::Greater, Some("10")),
                    filter("status", FilterOp::Contains, Some("pa%d")),
                ],
                Some(Sort { column: "total".into(), descending: true }),
            ),
        )
        .unwrap();
        assert_eq!(
            statement.sql,
            "SELECT \"id\"::text AS \"id\", \"status\"::text AS \"status\", \"total\"::text AS \"total\" \
             FROM \"public\".\"orders\" WHERE \"total\" > CAST($1 AS numeric(10,2)) AND \"status\"::text ILIKE $2 \
             ESCAPE '\\' ORDER BY \"public\".\"orders\".\"total\" DESC NULLS LAST, \
             \"public\".\"orders\".\"id\" ASC NULLS LAST LIMIT 100 OFFSET 200"
        );
        assert_eq!(statement.params, vec![Some("10".into()), Some("%pa\\%d%".into())]);
    }

    #[test]
    fn sorts_postgres_by_the_table_column_not_its_text_copy() {
        let sort = Some(Sort { column: "total".into(), descending: false });
        let statement =
            select_rows(Dialect::Postgres, &orders(), &request(Vec::new(), sort)).unwrap();
        assert!(
            statement.sql.contains(" ORDER BY \"public\".\"orders\".\"total\" ASC"),
            "{}",
            statement.sql
        );
    }

    #[test]
    fn uses_question_marks_on_mysql() {
        let statement = select_rows(
            Dialect::MySql,
            &orders(),
            &request(vec![filter("status", FilterOp::Equals, Some("paid"))], None),
        )
        .unwrap();
        assert_eq!(
            statement.sql,
            "SELECT `id`, `status`, `total` FROM `public`.`orders` WHERE `status` = ? \
             ORDER BY `id` IS NULL, `id` ASC LIMIT 100 OFFSET 200"
        );
    }

    #[test]
    fn breaks_sort_ties_with_every_primary_key_column() {
        let mut items = orders();
        items.columns[1].primary_key = true;
        let sort = Some(Sort { column: "total".into(), descending: false });
        let statement = select_rows(Dialect::Sqlite, &items, &request(Vec::new(), sort)).unwrap();
        let order = statement.sql.split(" ORDER BY ").nth(1).unwrap();
        assert!(order.starts_with("\"total\" ASC"), "{order}");
        assert!(order.contains("\"id\" ASC") && order.contains("\"status\" ASC"), "{order}");
    }

    #[test]
    fn rejects_columns_the_table_does_not_have() {
        let error = select_rows(
            Dialect::Sqlite,
            &orders(),
            &request(vec![filter("id; drop table orders", FilterOp::IsNull, None)], None),
        )
        .unwrap_err();
        assert!(error.to_string().contains("has no column"));
    }

    #[test]
    fn null_checks_bind_nothing() {
        let statement = select_rows(
            Dialect::Sqlite,
            &orders(),
            &request(vec![filter("status", FilterOp::IsNotNull, None)], None),
        )
        .unwrap();
        assert!(statement.sql.contains("WHERE \"status\" IS NOT NULL"));
        assert!(statement.params.is_empty());
    }

    #[test]
    fn caps_the_page_size() {
        let mut big = request(Vec::new(), None);
        big.limit = 50_000;
        assert!(select_rows(Dialect::Sqlite, &orders(), &big).unwrap().sql.contains("LIMIT 1000 "));
    }

    #[test]
    fn counts_with_a_cap() {
        let statement = count_rows(
            Dialect::Postgres,
            &orders(),
            &[filter("id", FilterOp::Less, Some("5"))],
            100_001,
        )
        .unwrap();
        assert_eq!(
            statement.sql,
            "SELECT count(*) FROM (SELECT 1 FROM \"public\".\"orders\" WHERE \"id\" < CAST($1 AS integer) LIMIT 100001) AS counted"
        );
    }
}
