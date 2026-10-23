use serde::Serialize;

use crate::value::ValueKind;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    pub schema: Option<String>,
    pub table: String,
    pub column: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    /// The type as the database spells it, such as `character varying(255)` or `UInt64`.
    pub type_name: String,
    pub kind: ValueKind,
    pub nullable: bool,
    pub primary_key: bool,
    pub references: Option<ForeignKey>,
    pub default: Option<String>,
}

impl Column {
    #[must_use]
    pub fn new(name: impl Into<String>, type_name: impl Into<String>) -> Self {
        let type_name = type_name.into();
        Self {
            name: name.into(),
            kind: ValueKind::of(&type_name),
            type_name,
            nullable: true,
            primary_key: false,
            references: None,
            default: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum TableKind {
    Table,
    View,
    Collection,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub schema: Option<String>,
    pub name: String,
    pub kind: TableKind,
    /// The database's own estimate, cheap to read; not an exact count.
    #[specta(type = Option<specta_typescript::Number>)]
    pub row_estimate: Option<u64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub size_bytes: Option<u64>,
    pub columns: Vec<Column>,
    pub indexes: Vec<Index>,
}

impl Table {
    #[must_use]
    pub fn primary_key(&self) -> Vec<&Column> {
        self.columns.iter().filter(|column| column.primary_key).collect()
    }

    #[must_use]
    pub fn column(&self, name: &str) -> Option<&Column> {
        self.columns.iter().find(|column| column.name == name)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Enum {
    pub name: String,
    pub values: Vec<String>,
}

/// One schema, database or keyspace with what's inside it.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Namespace {
    pub name: String,
    pub tables: Vec<Table>,
    pub functions: Vec<String>,
    pub enums: Vec<Enum>,
}

/// Points at one table from the UI.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TableRef {
    pub schema: Option<String>,
    pub name: String,
}

impl TableRef {
    #[must_use]
    pub fn matches(&self, table: &Table) -> bool {
        self.name == table.name && (self.schema.is_none() || self.schema == table.schema)
    }
}
