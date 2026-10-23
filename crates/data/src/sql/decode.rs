//! Turns rows from each SQL driver into grid values.

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::mysql::MySqlRow;
use sqlx::postgres::PgRow;
use sqlx::sqlite::SqliteRow;
use sqlx::{Column as _, Row, TypeInfo, ValueRef};

use crate::result::ResultColumn;
use crate::value::Value;

pub(crate) fn columns<R: Row>(row: &R) -> Vec<ResultColumn> {
    row.columns()
        .iter()
        .map(|column| ResultColumn::new(column.name(), column.type_info().name()))
        .collect()
}

/// Postgres rows read through the simple query protocol arrive as text, whatever their type.
pub(crate) fn postgres(row: &PgRow, index: usize) -> Value {
    let type_name = row.column(index).type_info().name();
    let Ok(raw) = row.try_get_raw(index) else { return Value::Null };
    if raw.is_null() {
        return Value::Null;
    }
    raw.as_str().map_or_else(
        |_| Value::Text(format!("‹{type_name}›")),
        |text| Value::from_text(text, type_name),
    )
}

/// Postgres rows from a table page, where every column was selected `::text`.
pub(crate) fn postgres_text(row: &PgRow, index: usize, type_name: &str) -> Value {
    match row.try_get::<Option<String>, _>(index) {
        Ok(Some(text)) => Value::from_text(&text, type_name),
        Ok(None) | Err(_) => Value::Null,
    }
}

fn iso<T: ToString>(value: &T) -> Value {
    Value::Text(value.to_string())
}

/// MySQL by declared type: its drivers accept any integer as `bool`, so the name decides.
pub(crate) fn mysql(row: &MySqlRow, index: usize) -> Value {
    let type_name = row.column(index).type_info().name().to_ascii_uppercase();
    let base = type_name.trim_end_matches(" UNSIGNED");
    let get = |row: &MySqlRow| -> Option<Value> {
        Some(match base {
            "BOOLEAN" => {
                row.try_get::<Option<bool>, _>(index).ok()?.map_or(Value::Null, Value::Bool)
            }
            "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "BIGINT" | "YEAR"
                if type_name.ends_with("UNSIGNED") =>
            {
                row.try_get::<Option<u64>, _>(index).ok()?.map_or(Value::Null, Value::unsigned)
            }
            "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "BIGINT" | "YEAR" => {
                row.try_get::<Option<i64>, _>(index).ok()?.map_or(Value::Null, Value::integer)
            }
            "FLOAT" | "DOUBLE" => {
                row.try_get::<Option<f64>, _>(index).ok()?.map_or(Value::Null, Value::float)
            }
            "DECIMAL" => row
                .try_get::<Option<sqlx::types::Decimal>, _>(index)
                .ok()?
                .map_or(Value::Null, |decimal| Value::from_text(&decimal.to_string(), "decimal")),
            "JSON" => row
                .try_get::<Option<serde_json::Value>, _>(index)
                .ok()?
                .map_or(Value::Null, Value::Json),
            "DATE" => row
                .try_get::<Option<NaiveDate>, _>(index)
                .ok()?
                .map_or(Value::Null, |time| iso(&time)),
            "TIME" => row
                .try_get::<Option<NaiveTime>, _>(index)
                .ok()?
                .map_or(Value::Null, |time| iso(&time)),
            "DATETIME" => row
                .try_get::<Option<NaiveDateTime>, _>(index)
                .ok()?
                .map_or(Value::Null, |time| iso(&time)),
            "TIMESTAMP" => row
                .try_get::<Option<DateTime<Utc>>, _>(index)
                .ok()?
                .map_or(Value::Null, |time| iso(&time.to_rfc3339())),
            "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY" | "BIT"
            | "GEOMETRY" => row
                .try_get::<Option<Vec<u8>>, _>(index)
                .ok()?
                .map_or(Value::Null, |bytes| Value::bytes(&bytes)),
            _ => row.try_get::<Option<String>, _>(index).ok()?.map_or(Value::Null, Value::Text),
        })
    };
    get(row).unwrap_or_else(|| Value::Text(format!("‹{type_name}›")))
}

/// SQLite stores a type per value, not per column: try each storage class in turn.
pub(crate) fn sqlite(row: &SqliteRow, index: usize) -> Value {
    if row.try_get_raw(index).is_ok_and(|raw| raw.is_null()) {
        return Value::Null;
    }
    if let Ok(Some(integer)) = row.try_get::<Option<i64>, _>(index) {
        return Value::integer(integer);
    }
    if let Ok(Some(real)) = row.try_get::<Option<f64>, _>(index) {
        return Value::float(real);
    }
    if let Ok(Some(text)) = row.try_get::<Option<String>, _>(index) {
        return Value::Text(text);
    }
    match row.try_get::<Option<Vec<u8>>, _>(index) {
        Ok(Some(bytes)) => Value::bytes(&bytes),
        _ => Value::Null,
    }
}
