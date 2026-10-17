//! Containeria's database browser: saved and detected connections, schemas, table pages with
//! filters pushed into SQL, staged edits committed in one transaction, the SQL editor, history and
//! import and export, for Postgres, MySQL, MariaDB, SQLite, ClickHouse, MongoDB and Redis.

mod changes;
mod clickhouse;
mod connection;
mod detect;
mod dialect;
mod engine;
mod error;
mod export;
mod files;
mod history;
mod import;
#[cfg(test)]
mod live_tests;
mod mongo;
mod query;
mod redis;
mod result;
mod schema;
mod service;
mod session;
mod sql;
mod value;

pub use changes::{Cell, ChangeSet, RowUpdate};
pub use connection::{Connection, ConnectionInput, Environment};
pub use detect::Detected;
pub use engine::{Capabilities, Engine, Provider};
pub use error::{Error, Result};
pub use export::ExportFormat;
pub use history::{HistoryEntry, SavedQuery};
pub use import::{
    ColumnMapping, Delimiter, ImportFormat, ImportOptions, ImportPreview, ImportRequest,
    ImportedRows,
};
pub use query::{Filter, FilterOp, RowsRequest, Sort};
pub use redis::{RedisKey, RedisKeyPage, RedisValue};
pub use result::{QueryResult, ResultColumn, RowPage};
pub use schema::{Column, Enum, ForeignKey, Index, Namespace, Table, TableKind, TableRef};
pub use service::{Data, ServerInfo};
pub use value::{Value, ValueKind};
