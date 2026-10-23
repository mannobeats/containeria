use std::io::Write;

use serde::Deserialize;

use crate::dialect::Dialect;
use crate::error::Result;
use crate::schema::Table;
use crate::value::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Csv,
    Json,
    Sql,
}

/// Writes rows page by page, so a large table never sits in memory at once.
pub(crate) struct Writer<W: Write> {
    out: W,
    format: ExportFormat,
    dialect: Dialect,
    table: String,
    names: Vec<String>,
    written: u64,
}

/// A string literal. MySQL and ClickHouse read a backslash in one as an escape, so it's doubled
/// there; Postgres and SQLite keep it as it is.
fn quoted(dialect: Dialect, text: &str) -> String {
    let text = match dialect {
        Dialect::MySql | Dialect::ClickHouse => text.replace('\\', "\\\\"),
        Dialect::Postgres | Dialect::Sqlite => text.to_owned(),
    };
    format!("'{}'", text.replace('\'', "''"))
}

fn literal(dialect: Dialect, value: &Value) -> String {
    match value {
        Value::Null => "NULL".into(),
        Value::Bool(flag) => if *flag { "TRUE" } else { "FALSE" }.into(),
        Value::Number(number) => number.to_string(),
        Value::Text(text) => quoted(dialect, text),
        Value::Json(json) => quoted(dialect, &json.to_string()),
    }
}

fn json(value: &Value) -> serde_json::Value {
    match value {
        Value::Null => serde_json::Value::Null,
        Value::Bool(flag) => serde_json::Value::Bool(*flag),
        Value::Number(number) => serde_json::Number::from_f64(*number)
            .map_or(serde_json::Value::Null, serde_json::Value::Number),
        Value::Text(text) => serde_json::Value::String(text.clone()),
        Value::Json(json) => json.clone(),
    }
}

impl<W: Write> Writer<W> {
    pub(crate) fn new(
        out: W,
        format: ExportFormat,
        dialect: Dialect,
        table: &Table,
    ) -> Result<Self> {
        let names: Vec<String> = table.columns.iter().map(|column| column.name.clone()).collect();
        let mut writer = Self {
            out,
            format,
            dialect,
            table: dialect.table(table.schema.as_deref(), &table.name),
            names,
            written: 0,
        };
        match format {
            ExportFormat::Csv => writer.csv_row(&writer.names.clone())?,
            ExportFormat::Json => writer.out.write_all(b"[")?,
            ExportFormat::Sql => {}
        }
        Ok(writer)
    }

    fn csv_row(&mut self, fields: &[String]) -> Result<()> {
        let mut line = csv::Writer::from_writer(Vec::new());
        line.write_record(fields)?;
        let bytes = line.into_inner().map_err(|error| std::io::Error::other(error.to_string()))?;
        self.out.write_all(&bytes)?;
        Ok(())
    }

    pub(crate) fn rows(&mut self, rows: &[Vec<Value>]) -> Result<()> {
        for row in rows {
            match self.format {
                ExportFormat::Csv => self.csv_row(
                    &row.iter()
                        .map(|value| value.to_text().unwrap_or_default())
                        .collect::<Vec<_>>(),
                )?,
                ExportFormat::Json => {
                    let object: serde_json::Map<String, serde_json::Value> =
                        self.names.iter().cloned().zip(row.iter().map(json)).collect();
                    if self.written > 0 {
                        self.out.write_all(b",")?;
                    }
                    self.out.write_all(b"\n  ")?;
                    serde_json::to_writer(&mut self.out, &object)?;
                }
                ExportFormat::Sql => {
                    let columns = self
                        .names
                        .iter()
                        .map(|name| self.dialect.quote(name))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let values = row
                        .iter()
                        .map(|value| literal(self.dialect, value))
                        .collect::<Vec<_>>()
                        .join(", ");
                    writeln!(
                        self.out,
                        "INSERT INTO {} ({columns}) VALUES ({values});",
                        self.table
                    )?;
                }
            }
            self.written += 1;
        }
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<u64> {
        if self.format == ExportFormat::Json {
            self.out.write_all(if self.written > 0 { b"\n]\n" } else { b"]\n" })?;
        }
        self.out.flush()?;
        Ok(self.written)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::tests::orders;

    fn export(format: ExportFormat) -> String {
        let mut buffer = Vec::new();
        let mut writer = Writer::new(&mut buffer, format, Dialect::Postgres, &orders()).unwrap();
        writer
            .rows(&[vec![Value::Number(1.0), Value::Text("O'Brien, \"jr\"".into()), Value::Null]])
            .unwrap();
        assert_eq!(writer.finish().unwrap(), 1);
        String::from_utf8(buffer).unwrap()
    }

    #[test]
    fn writes_quoted_csv_with_a_header() {
        assert_eq!(export(ExportFormat::Csv), "id,status,total\n1,\"O'Brien, \"\"jr\"\"\",\n");
    }

    #[test]
    fn writes_a_json_array_of_objects() {
        let parsed: serde_json::Value = serde_json::from_str(&export(ExportFormat::Json)).unwrap();
        assert_eq!(
            parsed,
            serde_json::json!([{ "id": 1.0, "status": "O'Brien, \"jr\"", "total": null }])
        );
    }

    #[test]
    fn writes_inserts_with_escaped_literals() {
        assert_eq!(
            export(ExportFormat::Sql),
            "INSERT INTO \"public\".\"orders\" (\"id\", \"status\", \"total\") VALUES (1, 'O''Brien, \"jr\"', NULL);\n"
        );
    }

    #[test]
    fn doubles_backslashes_only_where_they_escape() {
        let text = Value::Text(r"x\'); DROP TABLE t; -- ".into());
        assert_eq!(literal(Dialect::MySql, &text), r"'x\\''); DROP TABLE t; -- '");
        assert_eq!(literal(Dialect::Postgres, &text), r"'x\''); DROP TABLE t; -- '");
        let json = Value::Json(serde_json::json!({ "path": "C:\\" }));
        assert_eq!(literal(Dialect::MySql, &json), r#"'{"path":"C:\\\\"}'"#);
    }
}
