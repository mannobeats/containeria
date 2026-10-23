use serde::Serialize;

/// One cell as the grid shows it. Integers beyond 2^53 and exact decimals stay text so nothing is
/// rounded on the way to JavaScript.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(untagged)]
pub enum Value {
    #[specta(type = ())]
    Null,
    Bool(bool),
    Number(f64),
    Text(String),
    /// A JSON object or array: `jsonb`, MySQL `JSON`, a nested MongoDB document.
    Json(#[specta(type = JsonDocument)] serde_json::Value),
}

/// How TypeScript sees a JSON cell. Only describes the shape; values are `serde_json::Value`.
#[derive(Serialize, specta::Type)]
#[serde(untagged)]
#[expect(
    dead_code,
    reason = "only describes the TypeScript shape of a JSON cell; never built in Rust"
)]
pub(crate) enum JsonDocument {
    Object(std::collections::BTreeMap<String, specta_typescript::Unknown<serde_json::Value>>),
    Array(Vec<specta_typescript::Unknown<serde_json::Value>>),
}

/// The largest integer a JavaScript number holds exactly.
const SAFE_INTEGER: i64 = (1 << 53) - 1;

impl Value {
    #[must_use]
    #[expect(clippy::cast_precision_loss, reason = "only called for integers inside ±2^53")]
    pub fn integer(value: i64) -> Self {
        if (-SAFE_INTEGER..=SAFE_INTEGER).contains(&value) {
            Self::Number(value as f64)
        } else {
            Self::Text(value.to_string())
        }
    }

    #[must_use]
    pub fn unsigned(value: u64) -> Self {
        i64::try_from(value).map_or_else(|_| Self::Text(value.to_string()), Self::integer)
    }

    #[must_use]
    pub fn float(value: f64) -> Self {
        if value.is_finite() { Self::Number(value) } else { Self::Text(value.to_string()) }
    }

    #[must_use]
    pub fn bytes(bytes: &[u8]) -> Self {
        use std::fmt::Write;
        let mut hex = String::with_capacity(2 + bytes.len() * 2);
        hex.push_str("\\x");
        for byte in bytes {
            let _ = write!(hex, "{byte:02x}");
        }
        Self::Text(hex)
    }

    /// The value as the text an edit or a key comparison sends back to the database.
    #[must_use]
    pub fn to_text(&self) -> Option<String> {
        match self {
            Self::Null => None,
            Self::Bool(value) => Some(value.to_string()),
            Self::Number(value) => Some(value.to_string()),
            Self::Text(value) => Some(value.clone()),
            Self::Json(value) => Some(value.to_string()),
        }
    }

    /// Reads text the way a cell of the given SQL type would show it.
    #[must_use]
    pub fn from_text(text: &str, type_name: &str) -> Self {
        let kind = ValueKind::of(type_name);
        match kind {
            ValueKind::Number => text.parse::<i64>().map_or_else(
                |_| match text.parse::<f64>() {
                    Ok(number) if is_exact(text, number) => Self::float(number),
                    _ => Self::Text(text.to_owned()),
                },
                Self::integer,
            ),
            ValueKind::Bool => match text {
                "t" | "true" | "1" => Self::Bool(true),
                "f" | "false" | "0" => Self::Bool(false),
                _ => Self::Text(text.to_owned()),
            },
            ValueKind::Json => {
                serde_json::from_str(text).map_or_else(|_| Self::Text(text.to_owned()), Self::Json)
            }
            _ => Self::Text(text.to_owned()),
        }
    }
}

/// A decimal that round-trips through an f64 without changing.
fn is_exact(text: &str, number: f64) -> bool {
    number.is_finite() && text.trim_start_matches('-').len() <= 15
}

/// How the grid aligns, edits and filters a column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ValueKind {
    Number,
    Text,
    Bool,
    Json,
    Time,
    Binary,
    Other,
}

impl ValueKind {
    /// Classifies a type name from any supported engine.
    #[must_use]
    pub fn of(type_name: &str) -> Self {
        let lowered = type_name.to_ascii_lowercase();
        let mut name = lowered.as_str();
        while let Some(inner) = ["nullable(", "lowcardinality("]
            .iter()
            .find_map(|wrapper| name.strip_prefix(wrapper))
            .and_then(|inner| inner.strip_suffix(')'))
        {
            name = inner;
        }
        let base = name.split(['(', ' ']).next().unwrap_or(name);
        if name.starts_with("tinyint(1)") || matches!(base, "bool" | "boolean") {
            return Self::Bool;
        }
        if name.contains("json") {
            return Self::Json;
        }
        if name.contains("time")
            || matches!(base, "date" | "datetime" | "datetime64" | "year" | "interval")
        {
            return Self::Time;
        }
        if matches!(
            base,
            "bytea" | "blob" | "binary" | "varbinary" | "longblob" | "mediumblob" | "tinyblob"
        ) {
            return Self::Binary;
        }
        let numeric = [
            "int",
            "integer",
            "smallint",
            "bigint",
            "tinyint",
            "mediumint",
            "int2",
            "int4",
            "int8",
            "serial",
            "bigserial",
            "smallserial",
            "real",
            "double",
            "float",
            "float4",
            "float8",
            "numeric",
            "decimal",
            "money",
            "oid",
            "number",
        ];
        if numeric.contains(&base)
            || base.starts_with("uint")
            || base.starts_with("int")
            || base.starts_with("float")
            || base.starts_with("decimal")
        {
            return Self::Number;
        }
        if name.contains("char")
            || name.contains("text")
            || name.contains("string")
            || matches!(base, "uuid" | "citext" | "name" | "enum" | "set")
        {
            return Self::Text;
        }
        Self::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_big_integers_exact_as_text() {
        assert_eq!(Value::integer(42), Value::Number(42.0));
        assert_eq!(Value::integer(9_007_199_254_740_993), Value::Text("9007199254740993".into()));
        assert_eq!(Value::unsigned(u64::MAX), Value::Text(u64::MAX.to_string()));
    }

    #[test]
    fn reads_text_by_column_type() {
        assert_eq!(Value::from_text("12", "integer"), Value::Number(12.0));
        assert_eq!(Value::from_text("12.50", "numeric(10,2)"), Value::Number(12.5));
        assert_eq!(
            Value::from_text("12345678901234567.89", "numeric"),
            Value::Text("12345678901234567.89".into())
        );
        assert_eq!(Value::from_text("t", "boolean"), Value::Bool(true));
        assert_eq!(
            Value::from_text(r#"{"a":1}"#, "jsonb"),
            Value::Json(serde_json::json!({"a": 1}))
        );
        assert_eq!(Value::from_text("hello", "text"), Value::Text("hello".into()));
    }

    #[test]
    fn classifies_types_across_engines() {
        assert_eq!(ValueKind::of("character varying(255)"), ValueKind::Text);
        assert_eq!(ValueKind::of("tinyint(1)"), ValueKind::Bool);
        assert_eq!(ValueKind::of("tinyint(4)"), ValueKind::Number);
        assert_eq!(ValueKind::of("UInt64"), ValueKind::Number);
        assert_eq!(ValueKind::of("timestamp with time zone"), ValueKind::Time);
        assert_eq!(ValueKind::of("DateTime64(3)"), ValueKind::Time);
        assert_eq!(ValueKind::of("jsonb"), ValueKind::Json);
        assert_eq!(ValueKind::of("bytea"), ValueKind::Binary);
        assert_eq!(ValueKind::of("LowCardinality(String)"), ValueKind::Text);
        assert_eq!(ValueKind::of("point"), ValueKind::Other);
    }

    #[test]
    fn classifies_clickhouse_types_inside_nullable_and_low_cardinality() {
        assert_eq!(ValueKind::of("Nullable(UInt64)"), ValueKind::Number);
        assert_eq!(ValueKind::of("Nullable(Decimal(10, 2))"), ValueKind::Number);
        assert_eq!(ValueKind::of("Nullable(Bool)"), ValueKind::Bool);
        assert_eq!(ValueKind::of("Nullable(Date)"), ValueKind::Time);
        assert_eq!(ValueKind::of("LowCardinality(Nullable(String))"), ValueKind::Text);
    }

    #[test]
    fn writes_bytes_as_postgres_hex() {
        assert_eq!(Value::bytes(&[0xde, 0xad]), Value::Text("\\xdead".into()));
    }

    #[test]
    fn turns_values_back_into_text() {
        assert_eq!(Value::Null.to_text(), None);
        assert_eq!(Value::Number(3.0).to_text().as_deref(), Some("3"));
        assert_eq!(Value::Bool(false).to_text().as_deref(), Some("false"));
    }
}
