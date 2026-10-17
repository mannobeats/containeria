use serde::Serialize;

use crate::schema::Column;
use crate::value::{Value, ValueKind};

/// A column of a query result, which may not belong to any one table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResultColumn {
    pub name: String,
    pub type_name: String,
    pub kind: ValueKind,
}

impl ResultColumn {
    #[must_use]
    pub fn new(name: impl Into<String>, type_name: impl Into<String>) -> Self {
        let type_name = type_name.into();
        Self { name: name.into(), kind: ValueKind::of(&type_name), type_name }
    }
}

/// One page of a table.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RowPage {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<Value>>,
    /// Rows matching the filters, counted up to a cap; or the table's estimate when unfiltered.
    #[specta(type = Option<specta_typescript::Number>)]
    pub total: Option<u64>,
    /// The count stopped at the cap: there are at least this many.
    pub total_capped: bool,
    pub elapsed_ms: f64,
    /// Why the grid can't edit these rows, when it can't.
    pub read_only_reason: Option<String>,
}

/// What a statement in the SQL editor returned.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<Value>>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub affected: Option<u64>,
    /// More rows came back than the editor keeps; only the first ones are here.
    pub truncated: bool,
    pub elapsed_ms: f64,
}

/// The editor keeps at most this many rows of a result.
pub(crate) const MAX_RESULT_ROWS: usize = 5000;
