//! ClickHouse over its HTTP interface. Results come back as `JSONCompactEachRowWithNamesAndTypes`,
//! so any query's columns and types are known without a typed Rust row.

use std::time::Instant;

use crate::connection::Target;
use crate::error::Result;
use crate::query::Statement;
use crate::result::{MAX_RESULT_ROWS, QueryResult, ResultColumn};
use crate::schema::{Column, Namespace, Table, TableKind};
use crate::value::Value;

const FORMAT: &str = "JSONCompactEachRowWithNamesAndTypes";

#[derive(Clone)]
pub(crate) struct ClickHouse {
    client: clickhouse::Client,
}

impl std::fmt::Debug for ClickHouse {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("ClickHouse").finish_non_exhaustive()
    }
}

/// Columns and rows parsed from one result.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct Parsed {
    pub(crate) columns: Vec<ResultColumn>,
    pub(crate) rows: Vec<Vec<Value>>,
}

fn json_value(value: serde_json::Value, type_name: &str) -> Value {
    match value {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(flag) => Value::Bool(flag),
        // Read from the exact digits, so 64-bit integers past 2^53 stay text instead of rounding.
        serde_json::Value::Number(number) => Value::from_text(&number.to_string(), type_name),
        serde_json::Value::String(text) => Value::from_text(&text, type_name),
        nested @ (serde_json::Value::Array(_) | serde_json::Value::Object(_)) => {
            Value::Json(nested)
        }
    }
}

/// Parses `JSONCompactEachRowWithNamesAndTypes`: names, then types, then one array per row.
pub(crate) fn parse(body: &[u8], cap: usize) -> Result<(Parsed, bool)> {
    let mut lines = body.split(|byte| *byte == b'\n').filter(|line| !line.is_empty());
    let (Some(names), Some(types)) = (lines.next(), lines.next()) else {
        return Ok((Parsed::default(), false));
    };
    let names: Vec<String> = serde_json::from_slice(names)?;
    let types: Vec<String> = serde_json::from_slice(types)?;
    let mut table = Parsed {
        columns: names
            .iter()
            .zip(&types)
            .map(|(name, type_name)| ResultColumn::new(name, type_name))
            .collect(),
        rows: Vec::new(),
    };
    let mut truncated = false;
    for line in lines {
        if table.rows.len() >= cap {
            truncated = true;
            break;
        }
        let values: Vec<serde_json::Value> = serde_json::from_slice(line)?;
        table.rows.push(
            values
                .into_iter()
                .zip(&types)
                .map(|(value, type_name)| json_value(value, type_name))
                .collect(),
        );
    }
    Ok((table, truncated))
}

fn returns_rows(sql: &str) -> bool {
    let first = sql.split_whitespace().next().unwrap_or_default().to_ascii_lowercase();
    matches!(
        first.as_str(),
        "select" | "with" | "show" | "describe" | "desc" | "explain" | "exists"
    )
}

impl ClickHouse {
    pub(crate) fn connect(target: &Target) -> Self {
        let scheme = if target.tls { "https" } else { "http" };
        let mut client = clickhouse::Client::default()
            .with_url(format!("{scheme}://{}:{}", target.host, target.port.unwrap_or(8123)))
            .with_user(target.user.clone().unwrap_or_else(|| "default".into()))
            .with_setting("output_format_json_quote_64bit_integers", "1")
            .with_setting("output_format_json_quote_decimals", "1");
        if let Some(password) = &target.password {
            client = client.with_password(password);
        }
        if let Some(database) = &target.database {
            client = client.with_database(database);
        }
        Self { client }
    }

    async fn fetch(&self, query: clickhouse::query::Query, cap: usize) -> Result<(Parsed, bool)> {
        let body = query.fetch_bytes(FORMAT)?.collect().await?;
        parse(&body, cap)
    }

    pub(crate) async fn version(&self) -> Result<String> {
        let (table, _) = self.fetch(self.client.query("SELECT version()"), 1).await?;
        let version = table
            .rows
            .first()
            .and_then(|row| row.first())
            .and_then(Value::to_text)
            .unwrap_or_default();
        Ok(format!("ClickHouse {version}"))
    }

    pub(crate) async fn schema(&self) -> Result<Vec<Namespace>> {
        let excluded = "database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')";
        let (tables, _) = self
            .fetch(
                self.client.query(&format!(
                    "SELECT database, name, engine, total_rows, total_bytes FROM system.tables WHERE {excluded} ORDER BY database, name"
                )),
                usize::MAX,
            )
            .await?;
        let (columns, _) = self
            .fetch(
                self.client.query(&format!(
                    "SELECT database, table, name, type, is_in_primary_key, default_expression FROM system.columns \
                     WHERE {excluded} ORDER BY database, table, position"
                )),
                usize::MAX,
            )
            .await?;
        let text = |row: &[Value], index: usize| {
            row.get(index).and_then(Value::to_text).unwrap_or_default()
        };
        let number = |row: &[Value], index: usize| {
            row.get(index).and_then(Value::to_text).and_then(|value| value.parse::<u64>().ok())
        };
        let mut namespaces: Vec<Namespace> = Vec::new();
        for row in &tables.rows {
            let database = text(row, 0);
            let kind =
                if text(row, 2).contains("View") { TableKind::View } else { TableKind::Table };
            let table = Table {
                schema: Some(database.clone()),
                name: text(row, 1),
                kind,
                row_estimate: number(row, 3),
                size_bytes: number(row, 4),
                columns: Vec::new(),
                indexes: Vec::new(),
            };
            match namespaces.iter_mut().find(|namespace| namespace.name == database) {
                Some(namespace) => namespace.tables.push(table),
                None => namespaces.push(Namespace {
                    name: database,
                    tables: vec![table],
                    functions: Vec::new(),
                    enums: Vec::new(),
                }),
            }
        }
        for row in &columns.rows {
            let (database, table_name) = (text(row, 0), text(row, 1));
            let Some(table) = namespaces
                .iter_mut()
                .filter(|namespace| namespace.name == database)
                .flat_map(|namespace| namespace.tables.iter_mut())
                .find(|table| table.name == table_name)
            else {
                continue;
            };
            let mut column = Column::new(text(row, 2), text(row, 3));
            column.nullable = column.type_name.starts_with("Nullable(");
            column.primary_key = matches!(row.get(4), Some(Value::Number(flag)) if *flag > 0.0)
                || text(row, 4) == "1";
            column.default = Some(text(row, 5)).filter(|default| !default.is_empty());
            table.columns.push(column);
        }
        Ok(namespaces)
    }

    fn bound(&self, statement: &Statement) -> clickhouse::query::Query {
        let mut query = self.client.query(&statement.sql);
        for param in &statement.params {
            query = query.bind(param.as_deref());
        }
        query
    }

    pub(crate) async fn rows(&self, statement: &Statement) -> Result<Vec<Vec<Value>>> {
        Ok(self.fetch(self.bound(statement), usize::MAX).await?.0.rows)
    }

    pub(crate) async fn count(&self, statement: &Statement) -> Result<u64> {
        let (table, _) = self.fetch(self.bound(statement), 1).await?;
        Ok(table
            .rows
            .first()
            .and_then(|row| row.first())
            .and_then(Value::to_text)
            .and_then(|count| count.parse().ok())
            .unwrap_or(0))
    }

    /// Runs editor SQL; `readonly = 2` makes the server refuse writes in safe mode while still accepting the output settings.
    pub(crate) async fn run(&self, sql: &str, read_only: bool) -> Result<QueryResult> {
        let started = Instant::now();
        let client = if read_only {
            self.client.clone().with_setting("readonly", "2")
        } else {
            self.client.clone()
        };
        let query = client.query_raw(sql.trim().trim_end_matches(';'));
        let mut result = QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected: None,
            truncated: false,
            elapsed_ms: 0.0,
        };
        if returns_rows(sql) {
            let (table, truncated) = self.fetch(query, MAX_RESULT_ROWS).await?;
            result.columns = table.columns;
            result.rows = table.rows;
            result.truncated = truncated;
        } else {
            query.execute().await?;
        }
        result.elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_names_types_and_quoted_64_bit_integers() {
        let body = br#"["event","user_id","props"]
["LowCardinality(String)","UInt64","Map(String, String)"]
["page_view","18446744073709551615",{"a":"b"}]
["purchase","42",{}]
"#;
        let (table, truncated) = parse(body, 10).unwrap();
        assert!(!truncated);
        assert_eq!(table.columns[1].type_name, "UInt64");
        assert_eq!(table.rows[0][0], Value::Text("page_view".into()));
        assert_eq!(table.rows[0][1], Value::Text("18446744073709551615".into()));
        assert_eq!(table.rows[1][1], Value::Number(42.0));
        assert_eq!(table.rows[0][2], Value::Json(serde_json::json!({"a": "b"})));
    }

    #[test]
    fn stops_at_the_cap() {
        let body = b"[\"n\"]\n[\"UInt8\"]\n[1]\n[2]\n[3]\n";
        let (table, truncated) = parse(body, 2).unwrap();
        assert_eq!(table.rows.len(), 2);
        assert!(truncated);
    }

    #[test]
    fn knows_which_statements_return_rows() {
        assert!(returns_rows("  WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(returns_rows("show tables"));
        assert!(!returns_rows("INSERT INTO t VALUES (1)"));
    }
}
