//! Reads schemas, tables, columns, keys and indexes from each engine's catalog.

use std::collections::BTreeMap;

use sqlx::{MySqlPool, PgPool, SqlitePool};

use crate::dialect::Dialect;
use crate::error::Result;
use crate::schema::{Column, Enum, ForeignKey, Index, Namespace, Table, TableKind};

/// Collects tables by `(schema, name)` while the catalog queries fill them in.
#[derive(Default)]
struct Tables(BTreeMap<(String, String), Table>);

impl Tables {
    fn add(
        &mut self,
        schema: &str,
        name: &str,
        kind: TableKind,
        rows: Option<u64>,
        size: Option<u64>,
    ) {
        self.0.insert(
            (schema.to_owned(), name.to_owned()),
            Table {
                schema: Some(schema.to_owned()),
                name: name.to_owned(),
                kind,
                row_estimate: rows,
                size_bytes: size,
                columns: Vec::new(),
                indexes: Vec::new(),
            },
        );
    }

    fn get(&mut self, schema: &str, name: &str) -> Option<&mut Table> {
        self.0.get_mut(&(schema.to_owned(), name.to_owned()))
    }

    fn column(&mut self, schema: &str, table: &str, column: &str) -> Option<&mut Column> {
        self.get(schema, table)?.columns.iter_mut().find(|candidate| candidate.name == column)
    }

    fn mark_primary(&mut self, schema: &str, table: &str, columns: &[String]) {
        for name in columns {
            if let Some(column) = self.column(schema, table, name) {
                column.primary_key = true;
            }
        }
    }

    fn into_namespaces(
        self,
        functions: &BTreeMap<String, Vec<String>>,
        enums: &BTreeMap<String, Vec<Enum>>,
    ) -> Vec<Namespace> {
        let mut namespaces: BTreeMap<String, Namespace> = BTreeMap::new();
        for ((schema, _), table) in self.0 {
            namespaces
                .entry(schema.clone())
                .or_insert_with(|| Namespace {
                    name: schema,
                    tables: Vec::new(),
                    functions: Vec::new(),
                    enums: Vec::new(),
                })
                .tables
                .push(table);
        }
        for namespace in namespaces.values_mut() {
            namespace.functions = functions.get(&namespace.name).cloned().unwrap_or_default();
            namespace.enums = enums.get(&namespace.name).cloned().unwrap_or_default();
        }
        let mut list: Vec<Namespace> = namespaces.into_values().collect();
        // The default schema first, the way people look for it.
        list.sort_by_key(|namespace| !matches!(namespace.name.as_str(), "public" | "main"));
        list
    }
}

const PG_SCHEMAS: &str = "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'";

#[expect(
    clippy::cast_sign_loss,
    clippy::cast_possible_truncation,
    reason = "estimates are non-negative and far below u64::MAX"
)]
fn estimate(value: f64) -> Option<u64> {
    (value >= 0.0).then_some(value as u64)
}

pub(crate) async fn postgres(pool: &PgPool) -> Result<Vec<Namespace>> {
    let mut tables = Tables::default();
    let relations: Vec<(String, String, String, f64, i64)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT n.nspname::text, c.relname::text, c.relkind::text, c.reltuples::float8, pg_total_relation_size(c.oid) \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND {PG_SCHEMAS} ORDER BY 1, 2"
    )))
    .fetch_all(pool)
    .await?;
    for (schema, name, kind, rows, size) in relations {
        let kind =
            if matches!(kind.as_str(), "v" | "m") { TableKind::View } else { TableKind::Table };
        tables.add(&schema, &name, kind, estimate(rows), u64::try_from(size).ok());
    }

    let columns: Vec<(String, String, String, String, bool, Option<String>)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT n.nspname::text, c.relname::text, a.attname::text, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull, \
         pg_get_expr(d.adbin, d.adrelid) \
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace \
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
         WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND {PG_SCHEMAS} \
         ORDER BY n.nspname, c.relname, a.attnum"
    )))
    .fetch_all(pool)
    .await?;
    for (schema, table, name, type_name, nullable, default) in columns {
        if let Some(table) = tables.get(&schema, &table) {
            let mut column = Column::new(name, type_name);
            column.nullable = nullable;
            column.default = default;
            table.columns.push(column);
        }
    }

    let indexes: Vec<(String, String, String, bool, bool, Vec<String>)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT n.nspname::text, t.relname::text, i.relname::text, ix.indisunique, ix.indisprimary, \
         array_agg(a.attname::text ORDER BY k.ord) \
         FROM pg_index ix JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_class i ON i.oid = ix.indexrelid \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) \
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum \
         WHERE {PG_SCHEMAS} GROUP BY 1, 2, 3, 4, 5"
    )))
    .fetch_all(pool)
    .await?;
    for (schema, table, name, unique, primary, columns) in indexes {
        if primary {
            tables.mark_primary(&schema, &table, &columns);
        }
        if let Some(table) = tables.get(&schema, &table) {
            table.indexes.push(Index { name, columns, unique });
        }
    }

    let keys: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
        "SELECT n.nspname::text, c.relname::text, a.attname::text, fn.nspname::text, fc.relname::text, fa.attname::text \
         FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace \
         JOIN pg_class fc ON fc.oid = con.confrelid JOIN pg_namespace fn ON fn.oid = fc.relnamespace \
         CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS k(col, fcol) \
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.col \
         JOIN pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = k.fcol \
         WHERE con.contype = 'f'",
    )
    .fetch_all(pool)
    .await?;
    for (schema, table, column, foreign_schema, foreign_table, foreign_column) in keys {
        if let Some(column) = tables.column(&schema, &table, &column) {
            column.references = Some(ForeignKey {
                schema: Some(foreign_schema),
                table: foreign_table,
                column: foreign_column,
            });
        }
    }

    let mut functions: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let rows: Vec<(String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT n.nspname::text, p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' \
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.prokind = 'f' AND {PG_SCHEMAS} ORDER BY 1, 2"
    )))
    .fetch_all(pool)
    .await?;
    for (schema, function) in rows {
        functions.entry(schema).or_default().push(function);
    }

    let mut enums: BTreeMap<String, Vec<Enum>> = BTreeMap::new();
    let rows: Vec<(String, String, Vec<String>)> = sqlx::query_as(
        "SELECT n.nspname::text, t.typname::text, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) \
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace \
         GROUP BY 1, 2 ORDER BY 1, 2",
    )
    .fetch_all(pool)
    .await?;
    for (schema, name, values) in rows {
        enums.entry(schema).or_default().push(Enum { name, values });
    }

    Ok(tables.into_namespaces(&functions, &enums))
}

pub(crate) async fn mysql(pool: &MySqlPool) -> Result<Vec<Namespace>> {
    let (database,): (Option<String>,) =
        sqlx::query_as("SELECT CAST(DATABASE() AS CHAR)").fetch_one(pool).await?;
    let Some(schema) = database else { return Ok(Vec::new()) };
    let mut tables = Tables::default();

    let relations: Vec<(String, String, Option<u64>, Option<u64>)> = sqlx::query_as(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(TABLE_TYPE AS CHAR), CAST(TABLE_ROWS AS UNSIGNED), \
         CAST(DATA_LENGTH + INDEX_LENGTH AS UNSIGNED) FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
    )
    .fetch_all(pool)
    .await?;
    for (name, kind, rows, size) in relations {
        let kind = if kind.contains("VIEW") { TableKind::View } else { TableKind::Table };
        tables.add(&schema, &name, kind, rows, size);
    }

    let columns: Vec<(String, String, String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(COLUMN_NAME AS CHAR), CAST(COLUMN_TYPE AS CHAR), \
         CAST(IS_NULLABLE AS CHAR), CAST(COLUMN_KEY AS CHAR), CAST(COLUMN_DEFAULT AS CHAR) \
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
    )
    .fetch_all(pool)
    .await?;
    for (table, name, type_name, nullable, key, default) in columns {
        if let Some(table) = tables.get(&schema, &table) {
            let mut column = Column::new(name, type_name);
            column.nullable = nullable == "YES";
            column.primary_key = key == "PRI";
            column.default = default;
            table.columns.push(column);
        }
    }

    let keys: Vec<(String, String, Option<String>, String, String)> = sqlx::query_as(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(COLUMN_NAME AS CHAR), CAST(REFERENCED_TABLE_SCHEMA AS CHAR), \
         CAST(REFERENCED_TABLE_NAME AS CHAR), CAST(REFERENCED_COLUMN_NAME AS CHAR) \
         FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;
    for (table, column, foreign_schema, foreign_table, foreign_column) in keys {
        if let Some(column) = tables.column(&schema, &table, &column) {
            column.references = Some(ForeignKey {
                schema: foreign_schema,
                table: foreign_table,
                column: foreign_column,
            });
        }
    }

    let indexes: Vec<(String, String, i64, String)> = sqlx::query_as(
        "SELECT CAST(TABLE_NAME AS CHAR), CAST(INDEX_NAME AS CHAR), CAST(MIN(NON_UNIQUE) AS SIGNED), \
         CAST(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS CHAR) \
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() GROUP BY TABLE_NAME, INDEX_NAME",
    )
    .fetch_all(pool)
    .await?;
    for (table, name, non_unique, columns) in indexes {
        if let Some(table) = tables.get(&schema, &table) {
            table.indexes.push(Index {
                name,
                columns: columns.split(',').map(str::to_owned).collect(),
                unique: non_unique == 0,
            });
        }
    }

    Ok(tables.into_namespaces(&BTreeMap::new(), &BTreeMap::new()))
}

pub(crate) async fn sqlite(pool: &SqlitePool) -> Result<Vec<Namespace>> {
    let mut tables = Tables::default();
    let relations: Vec<(String, String)> = sqlx::query_as(
        "SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
    for (name, kind) in relations {
        let kind = if kind == "view" { TableKind::View } else { TableKind::Table };
        // The highest rowid is an instant estimate; `WITHOUT ROWID` tables and views have none.
        let estimate: Option<(Option<i64>,)> = if kind == TableKind::Table {
            let quoted = Dialect::Sqlite.quote(&name);
            sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT max(rowid) FROM {quoted}")))
                .fetch_one(pool)
                .await
                .ok()
        } else {
            None
        };
        let rows = match estimate {
            Some((Some(max),)) => u64::try_from(max).ok(),
            Some((None,)) => Some(0),
            None => None,
        };
        tables.add("main", &name, kind, rows, None);

        let columns: Vec<(String, String, bool, Option<String>, i64)> = sqlx::query_as(
            "SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info(?)",
        )
        .bind(&name)
        .fetch_all(pool)
        .await?;
        let keys: Vec<(String, String, Option<String>)> =
            sqlx::query_as("SELECT \"from\", \"table\", \"to\" FROM pragma_foreign_key_list(?)")
                .bind(&name)
                .fetch_all(pool)
                .await?;
        let indexes: Vec<(String, bool)> =
            sqlx::query_as("SELECT name, \"unique\" FROM pragma_index_list(?)")
                .bind(&name)
                .fetch_all(pool)
                .await?;
        let mut index_list = Vec::with_capacity(indexes.len());
        for (index, unique) in indexes {
            let columns: Vec<(String,)> =
                sqlx::query_as("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
                    .bind(&index)
                    .fetch_all(pool)
                    .await?;
            index_list.push(Index {
                name: index,
                columns: columns.into_iter().map(|(column,)| column).collect(),
                unique,
            });
        }

        let Some(table) = tables.get("main", &name) else { continue };
        for (column, type_name, not_null, default, primary) in columns {
            let mut entry = Column::new(
                column,
                if type_name.is_empty() { "any".to_owned() } else { type_name },
            );
            entry.nullable = !not_null;
            entry.primary_key = primary > 0;
            entry.default = default;
            entry.references =
                keys.iter().find(|(from, _, _)| *from == entry.name).map(|(_, table, to)| {
                    ForeignKey {
                        schema: None,
                        table: table.clone(),
                        column: to.clone().unwrap_or_else(|| "rowid".to_owned()),
                    }
                });
            table.columns.push(entry);
        }
        table.indexes = index_list;
    }
    Ok(tables.into_namespaces(&BTreeMap::new(), &BTreeMap::new()))
}
