//! Imports CSV and JSON files into a table. The file is read on a blocking thread and handed over in
//! batches, so a file of any size streams through without sitting in memory; each batch is one
//! parameterized multi-row `INSERT`, and the whole import is one transaction.

use std::fmt;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read};
use std::ops::ControlFlow;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::de::{self, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};
use tokio::sync::mpsc;

use crate::dialect::Dialect;
use crate::error::{Error, Result};
use crate::query::{Builder, Statement};
use crate::schema::{Column, Table, TableRef};
use crate::value::ValueKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ImportFormat {
    Csv,
    /// An array of objects, or one object per line (NDJSON).
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Delimiter {
    Auto,
    Comma,
    Semicolon,
    Tab,
}

impl Delimiter {
    const fn byte(self) -> u8 {
        match self {
            Self::Auto | Self::Comma => b',',
            Self::Semicolon => b';',
            Self::Tab => b'\t',
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    pub format: ImportFormat,
    /// CSV: the first row names the columns.
    pub header: bool,
    /// CSV only.
    pub delimiter: Delimiter,
}

/// The file's columns and first rows, for the import sheet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// Unique names: the CSV header (`column 1`, ... without one), or the keys of the first JSON
    /// objects. A mapping's `source` is one of these.
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    /// The delimiter the file uses, once `auto` is resolved.
    pub delimiter: Delimiter,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMapping {
    pub source: String,
    pub column: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub table: TableRef,
    pub path: String,
    pub options: ImportOptions,
    /// File columns left out are skipped; table columns left out take their default.
    pub mapping: Vec<ColumnMapping>,
    /// Deletes every row first, in the same transaction.
    pub empty_first: bool,
}

/// How far an import has got.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportedRows {
    #[specta(type = specta_typescript::Number)]
    pub rows: u64,
    #[specta(type = specta_typescript::Number)]
    pub bytes_read: u64,
    #[specta(type = specta_typescript::Number)]
    pub bytes_total: u64,
}

const PREVIEW_ROWS: usize = 20;
/// Bound parameters per `INSERT`, well under every engine's limit.
const MAX_PARAMS: usize = 10_000;
const MAX_BATCH_ROWS: usize = 500;
/// Auto-detection reads at most this much of the first line.
const SNIFF_BYTES: u64 = 64 * 1024;

/// Rows read from the file, numbered from 1 after any header.
#[derive(Debug)]
pub(crate) struct Batch {
    pub first_row: u64,
    pub rows: Vec<Vec<Option<String>>>,
}

/// Counts the bytes read, for progress.
struct Counted<R> {
    inner: R,
    read: Arc<AtomicU64>,
}

impl<R: Read> Read for Counted<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(buffer)?;
        self.read.fetch_add(count as u64, Ordering::Relaxed);
        Ok(count)
    }
}

/// Opens the file past any UTF-8 byte order mark.
fn open(path: &Path, read: Arc<AtomicU64>) -> Result<impl BufRead> {
    let mut reader = BufReader::new(Counted { inner: File::open(path)?, read });
    if reader.fill_buf()?.starts_with(b"\xEF\xBB\xBF") {
        reader.consume(3);
    }
    Ok(reader)
}

/// The delimiter used most often outside quotes on the first line; a comma when none is.
fn sniff(line: &str) -> Delimiter {
    let (mut commas, mut semicolons, mut tabs) = (0, 0, 0);
    let mut quoted = false;
    for char in line.chars() {
        match char {
            '"' => quoted = !quoted,
            ',' if !quoted => commas += 1,
            ';' if !quoted => semicolons += 1,
            '\t' if !quoted => tabs += 1,
            _ => {}
        }
    }
    if semicolons > commas && semicolons >= tabs {
        Delimiter::Semicolon
    } else if tabs > commas && tabs > semicolons {
        Delimiter::Tab
    } else {
        Delimiter::Comma
    }
}

fn delimiter(path: &Path, options: ImportOptions) -> Result<Delimiter> {
    if options.format != ImportFormat::Csv || options.delimiter != Delimiter::Auto {
        return Ok(options.delimiter);
    }
    let mut line = String::new();
    open(path, Arc::default())?.take(SNIFF_BYTES).read_line(&mut line)?;
    Ok(sniff(&line))
}

fn unreadable(row: u64, error: &impl fmt::Display) -> Error {
    if row == 0 {
        Error::Invalid(format!("The header row couldn't be read: {error}"))
    } else {
        Error::Invalid(format!("Row {row} of the file couldn't be read: {error}"))
    }
}

type OnRecord<'a, T> = dyn FnMut(T) -> Result<ControlFlow<()>> + 'a;

/// Calls `on` with every record, the header included, until it breaks.
fn csv_records(
    reader: impl Read,
    delimiter: Delimiter,
    header: bool,
    on: &mut OnRecord<'_, csv::StringRecord>,
) -> Result<()> {
    let mut csv = csv::ReaderBuilder::new()
        .has_headers(false)
        .delimiter(delimiter.byte())
        .from_reader(reader);
    for (index, record) in (0_u64..).zip(csv.records()) {
        let record = record.map_err(|error| unreadable(index + u64::from(!header), &error))?;
        if on(record)?.is_break() {
            break;
        }
    }
    Ok(())
}

/// Visits a JSON array one object at a time, so it never sits in memory whole.
struct Objects<'a, 'b> {
    on: &'a mut OnRecord<'b, Map<String, Json>>,
    seen: u64,
    stopped: bool,
    failed: Option<Error>,
}

impl<'de> Visitor<'de> for &mut Objects<'_, '_> {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("an array of objects")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        while let Some(object) = seq.next_element::<Map<String, Json>>()? {
            self.seen += 1;
            match (self.on)(object) {
                Ok(ControlFlow::Continue(())) => {}
                Ok(ControlFlow::Break(())) => self.stopped = true,
                Err(error) => self.failed = Some(error),
            }
            if self.stopped || self.failed.is_some() {
                return Err(de::Error::custom("stopped"));
            }
        }
        Ok(())
    }
}

/// Calls `on` with every object of a JSON array or an NDJSON file, until it breaks.
fn json_objects(mut reader: impl BufRead, on: &mut OnRecord<'_, Map<String, Json>>) -> Result<()> {
    let first = loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok(());
        }
        let length = buffer.len();
        match buffer.iter().position(|byte| !byte.is_ascii_whitespace()) {
            Some(index) => {
                let byte = buffer[index];
                reader.consume(index);
                break byte;
            }
            None => reader.consume(length),
        }
    };
    let mut deserializer = serde_json::Deserializer::from_reader(reader);
    if first != b'[' {
        for (index, object) in (1_u64..).zip(deserializer.into_iter::<Map<String, Json>>()) {
            let object = object.map_err(|error| unreadable(index, &error))?;
            if on(object)?.is_break() {
                break;
            }
        }
        return Ok(());
    }
    let mut objects = Objects { on, seen: 0, stopped: false, failed: None };
    let outcome = de::Deserializer::deserialize_seq(&mut deserializer, &mut objects);
    if let Some(error) = objects.failed {
        return Err(error);
    }
    if objects.stopped {
        return Ok(());
    }
    outcome.map_err(|error| unreadable(objects.seen + 1, &error))?;
    deserializer.end().map_err(|error| unreadable(objects.seen + 1, &error))
}

/// Unique column names for a CSV file: the header's, or `column 1`, `column 2`, ... without one.
fn csv_columns(header: Option<&csv::StringRecord>, width: usize) -> Vec<String> {
    let mut columns: Vec<String> = Vec::with_capacity(width);
    for index in 0..width {
        let base = header
            .and_then(|header| header.get(index))
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map_or_else(|| format!("column {}", index + 1), str::to_owned);
        let mut name = base.clone();
        let mut copy = 2;
        while columns.contains(&name) {
            name = format!("{base} ({copy})");
            copy += 1;
        }
        columns.push(name);
    }
    columns
}

/// A JSON value as the text bound for its column; objects and arrays stay JSON.
fn json_text(value: &Json) -> Option<String> {
    match value {
        Json::Null => None,
        Json::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

/// The file's columns and first rows.
///
/// # Errors
/// Fails when the file can't be opened or its first rows can't be parsed.
pub(crate) fn preview(path: &Path, options: ImportOptions) -> Result<ImportPreview> {
    let delimiter = delimiter(path, options)?;
    let reader = open(path, Arc::default())?;
    if options.format == ImportFormat::Json {
        let mut objects = Vec::new();
        json_objects(reader, &mut |object| {
            objects.push(object);
            Ok(if objects.len() < PREVIEW_ROWS {
                ControlFlow::Continue(())
            } else {
                ControlFlow::Break(())
            })
        })?;
        let mut columns: Vec<String> = Vec::new();
        for key in objects.iter().flat_map(Map::keys) {
            if !columns.contains(key) {
                columns.push(key.clone());
            }
        }
        let rows = objects
            .iter()
            .map(|object| columns.iter().map(|key| object.get(key).and_then(json_text)).collect())
            .collect();
        return Ok(ImportPreview { columns, rows, delimiter });
    }
    let wanted = PREVIEW_ROWS + usize::from(options.header);
    let mut records = Vec::new();
    csv_records(reader, delimiter, options.header, &mut |record| {
        records.push(record);
        Ok(if records.len() < wanted { ControlFlow::Continue(()) } else { ControlFlow::Break(()) })
    })?;
    let header = if options.header && !records.is_empty() { Some(records.remove(0)) } else { None };
    let width = header.as_ref().or(records.first()).map_or(0, csv::StringRecord::len);
    let rows = records
        .iter()
        .map(|record| (0..width).map(|index| record.get(index).map(str::to_owned)).collect())
        .collect();
    Ok(ImportPreview { columns: csv_columns(header.as_ref(), width), rows, delimiter })
}

/// Collects rows into batches and hands each over; breaks once nobody is listening.
struct Batcher {
    size: usize,
    first_row: u64,
    rows: Vec<Vec<Option<String>>>,
    sender: mpsc::Sender<Batch>,
}

impl Batcher {
    fn push(&mut self, row: Vec<Option<String>>) -> ControlFlow<()> {
        self.rows.push(row);
        if self.rows.len() < self.size { ControlFlow::Continue(()) } else { self.flush() }
    }

    fn flush(&mut self) -> ControlFlow<()> {
        if self.rows.is_empty() {
            return ControlFlow::Continue(());
        }
        let rows = std::mem::replace(&mut self.rows, Vec::with_capacity(self.size));
        let count = rows.len() as u64;
        if self.sender.blocking_send(Batch { first_row: self.first_row, rows }).is_err() {
            return ControlFlow::Break(());
        }
        self.first_row += count;
        ControlFlow::Continue(())
    }
}

fn missing(source: &str) -> Error {
    Error::Invalid(format!("The file has no column named {source}."))
}

/// Reads the whole file on the calling (blocking) thread, sending the `sources` columns of each row
/// in batches of `size`. Stops early when the receiver is dropped.
///
/// # Errors
/// Fails when the file can't be read, a row can't be parsed, or a source column isn't in it.
pub(crate) fn read(
    path: &Path,
    options: ImportOptions,
    sources: &[String],
    size: usize,
    read: Arc<AtomicU64>,
    sender: mpsc::Sender<Batch>,
) -> Result<()> {
    let delimiter = delimiter(path, options)?;
    let reader = open(path, read)?;
    let mut batcher = Batcher { size, first_row: 1, rows: Vec::with_capacity(size), sender };
    if options.format == ImportFormat::Json {
        json_objects(reader, &mut |object| {
            Ok(batcher
                .push(sources.iter().map(|key| object.get(key).and_then(json_text)).collect()))
        })?;
    } else {
        let mut indices: Option<Vec<usize>> = None;
        csv_records(reader, delimiter, options.header, &mut |record| {
            if indices.is_none() {
                let columns = csv_columns(options.header.then_some(&record), record.len());
                let found = sources
                    .iter()
                    .map(|source| {
                        columns
                            .iter()
                            .position(|name| name == source)
                            .ok_or_else(|| missing(source))
                    })
                    .collect::<Result<Vec<_>>>()?;
                indices = Some(found);
                if options.header {
                    return Ok(ControlFlow::Continue(()));
                }
            }
            Ok(batcher.push(
                indices
                    .iter()
                    .flatten()
                    .map(|&index| record.get(index).map(str::to_owned))
                    .collect(),
            ))
        })?;
    }
    let _ = batcher.flush();
    Ok(())
}

/// What an import writes: which table columns, from which file columns.
#[derive(Debug)]
pub(crate) struct Plan<'a> {
    dialect: Dialect,
    table: &'a Table,
    columns: Vec<&'a Column>,
    pub sources: Vec<String>,
}

impl<'a> Plan<'a> {
    /// # Errors
    /// Fails when nothing is mapped, a column doesn't exist, or one is mapped twice.
    pub(crate) fn new(
        dialect: Dialect,
        table: &'a Table,
        mapping: &[ColumnMapping],
    ) -> Result<Self> {
        if mapping.is_empty() {
            return Err(Error::Invalid(format!(
                "Match at least one column of the file to a column of {}.",
                table.name
            )));
        }
        let mut columns: Vec<&Column> = Vec::with_capacity(mapping.len());
        for pair in mapping {
            let column = table.column(&pair.column).ok_or_else(|| {
                Error::Invalid(format!("{} has no column named {}", table.name, pair.column))
            })?;
            if columns.iter().any(|taken| taken.name == column.name) {
                return Err(Error::Invalid(format!(
                    "{} is matched to more than one column of the file.",
                    column.name
                )));
            }
            columns.push(column);
        }
        let sources = mapping.iter().map(|pair| pair.source.clone()).collect();
        Ok(Self { dialect, table, columns, sources })
    }

    /// Rows per `INSERT`, keeping the bound parameters under every engine's limit.
    pub(crate) fn batch_size(&self) -> usize {
        (MAX_PARAMS / self.columns.len()).clamp(1, MAX_BATCH_ROWS)
    }

    /// Empties the table inside the import's transaction. `DELETE`, not `TRUNCATE`: MySQL commits
    /// on `TRUNCATE`, which would break the import's all-or-nothing promise.
    pub(crate) fn clear(&self) -> Statement {
        let builder = Builder::new(self.dialect, self.table);
        Statement { sql: format!("DELETE FROM {}", builder.target()), params: Vec::new() }
    }

    /// One multi-row `INSERT` for `rows`, each in the order of the mapping.
    pub(crate) fn insert(&self, rows: &[Vec<Option<String>>]) -> Statement {
        let mut builder = Builder::new(self.dialect, self.table);
        let target = builder.target();
        let names = self
            .columns
            .iter()
            .map(|column| self.dialect.quote(&column.name))
            .collect::<Vec<_>>()
            .join(", ");
        let mut tuples = Vec::with_capacity(rows.len());
        for row in rows {
            let placeholders = self
                .columns
                .iter()
                .zip(row)
                .map(|(column, value)| {
                    builder.bind(column, cell(self.dialect, column, value.as_deref()))
                })
                .collect::<Vec<_>>();
            tuples.push(format!("({})", placeholders.join(", ")));
        }
        Statement {
            sql: format!("INSERT INTO {target} ({names}) VALUES {}", tuples.join(", ")),
            params: builder.params,
        }
    }
}

/// A file's text as the value bound for `column`: empty is `NULL` except in text columns, and
/// booleans become `1` and `0` where the engine stores them as integers.
fn cell(dialect: Dialect, column: &Column, value: Option<&str>) -> Option<String> {
    let value = value?;
    if value.is_empty() && column.kind != ValueKind::Text {
        return None;
    }
    if column.kind == ValueKind::Bool && dialect != Dialect::Postgres {
        match value.to_ascii_lowercase().as_str() {
            "true" | "t" | "yes" => return Some("1".into()),
            "false" | "f" | "no" => return Some("0".into()),
            _ => {}
        }
    }
    Some(value.to_owned())
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::*;
    use crate::connection::{ConnectionInput, Environment};
    use crate::engine::Engine;
    use crate::query::tests::orders;
    use crate::query::{RowsRequest, Sort};
    use crate::service::Data;
    use crate::value::Value;

    fn file(contents: &str) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(contents.as_bytes()).unwrap();
        file
    }

    const CSV: ImportOptions =
        ImportOptions { format: ImportFormat::Csv, header: true, delimiter: Delimiter::Auto };
    const JSON: ImportOptions =
        ImportOptions { format: ImportFormat::Json, header: false, delimiter: Delimiter::Auto };

    fn read_all(path: &Path, options: ImportOptions, sources: &[&str]) -> Result<Vec<Batch>> {
        let (sender, mut receiver) = mpsc::channel(64);
        let sources: Vec<String> = sources.iter().map(|&source| source.to_owned()).collect();
        read(path, options, &sources, 2, Arc::default(), sender)?;
        let mut batches = Vec::new();
        while let Ok(batch) = receiver.try_recv() {
            batches.push(batch);
        }
        Ok(batches)
    }

    fn text(values: &[Option<&str>]) -> Vec<Option<String>> {
        values.iter().map(|value| value.map(str::to_owned)).collect()
    }

    #[test]
    fn sniffs_the_delimiter_outside_quotes() {
        assert_eq!(sniff("id;name;\"a,b,c\""), Delimiter::Semicolon);
        assert_eq!(sniff("id\tname\tnote"), Delimiter::Tab);
        assert_eq!(sniff("id,name"), Delimiter::Comma);
        assert_eq!(sniff("single"), Delimiter::Comma);
    }

    #[test]
    fn previews_a_csv_with_a_header_and_a_byte_order_mark() {
        let csv = file("\u{feff}id;name;name\n1;\"Ada; L\";x\n2;;y\n");
        let shown = preview(csv.path(), CSV).unwrap();
        assert_eq!(shown.delimiter, Delimiter::Semicolon);
        assert_eq!(shown.columns, ["id", "name", "name (2)"]);
        assert_eq!(
            shown.rows,
            [
                text(&[Some("1"), Some("Ada; L"), Some("x")]),
                text(&[Some("2"), Some(""), Some("y")])
            ]
        );
    }

    #[test]
    fn names_headerless_columns_by_position() {
        let csv = file("1\tAda\n2\tGrace\n");
        let options = ImportOptions { header: false, ..CSV };
        let shown = preview(csv.path(), options).unwrap();
        assert_eq!(shown.columns, ["column 1", "column 2"]);
        assert_eq!(shown.rows.len(), 2);
        let batches = read_all(csv.path(), options, &["column 2"]).unwrap();
        assert_eq!(batches[0].rows, [text(&[Some("Ada")]), text(&[Some("Grace")])]);
    }

    #[test]
    fn previews_json_arrays_and_ndjson_alike() {
        let array =
            file(" [{\"id\": 1, \"tags\": [\"a\"]}, {\"id\": 2, \"ok\": true, \"name\": null}]");
        let ndjson =
            file("{\"id\": 1, \"tags\": [\"a\"]}\n{\"id\": 2, \"ok\": true, \"name\": null}\n");
        for path in [array.path(), ndjson.path()] {
            let shown = preview(path, JSON).unwrap();
            assert_eq!(shown.columns, ["id", "tags", "ok", "name"]);
            assert_eq!(
                shown.rows,
                [
                    text(&[Some("1"), Some("[\"a\"]"), None, None]),
                    text(&[Some("2"), None, Some("true"), None])
                ]
            );
        }
    }

    #[test]
    fn reads_mapped_columns_in_numbered_batches() {
        let csv = file("id,name,note\n1,Ada,x\n2,Grace,y\n3,Linus,z\n");
        let batches = read_all(csv.path(), CSV, &["note", "id"]).unwrap();
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].first_row, 1);
        assert_eq!(batches[0].rows, [text(&[Some("x"), Some("1")]), text(&[Some("y"), Some("2")])]);
        assert_eq!(batches[1].first_row, 3);
        assert_eq!(batches[1].rows, [text(&[Some("z"), Some("3")])]);
    }

    #[test]
    fn reports_the_row_that_cannot_be_read() {
        let csv = file("id,name\n1,Ada\n2\n");
        let error = read_all(csv.path(), CSV, &["id"]).unwrap_err().to_string();
        assert!(error.starts_with("Row 2 of the file couldn't be read"), "{error}");
        let json = file("[{\"id\": 1}, 7]");
        let error = read_all(json.path(), JSON, &["id"]).unwrap_err().to_string();
        assert!(error.starts_with("Row 2 of the file couldn't be read"), "{error}");
        let missing = read_all(csv.path(), CSV, &["email"]).unwrap_err().to_string();
        assert_eq!(missing, "The file has no column named email.");
    }

    fn mapping(pairs: &[(&str, &str)]) -> Vec<ColumnMapping> {
        pairs
            .iter()
            .map(|&(source, column)| ColumnMapping { source: source.into(), column: column.into() })
            .collect()
    }

    #[test]
    fn builds_one_insert_per_batch_for_each_dialect() {
        let table = orders();
        let rows = [text(&[Some("7"), Some("paid")]), text(&[Some(""), Some("")])];
        let pairs = mapping(&[("ID", "id"), ("Status", "status")]);
        let postgres = Plan::new(Dialect::Postgres, &table, &pairs).unwrap().insert(&rows);
        assert_eq!(
            postgres.sql,
            "INSERT INTO \"public\".\"orders\" (\"id\", \"status\") VALUES (CAST($1 AS integer), CAST($2 AS text)), (CAST($3 AS integer), CAST($4 AS text))"
        );
        assert_eq!(
            postgres.params,
            [Some("7".into()), Some("paid".into()), None, Some(String::new())]
        );
        let mysql = Plan::new(Dialect::MySql, &table, &pairs).unwrap().insert(&rows);
        assert_eq!(
            mysql.sql,
            "INSERT INTO `public`.`orders` (`id`, `status`) VALUES (?, ?), (?, ?)"
        );
        let sqlite = Plan::new(Dialect::Sqlite, &table, &pairs).unwrap();
        assert_eq!(sqlite.clear().sql, "DELETE FROM \"public\".\"orders\"");
        assert_eq!(sqlite.batch_size(), 500);
    }

    #[test]
    fn writes_booleans_as_integers_outside_postgres() {
        let flag = Column::new("active", "tinyint(1)");
        assert_eq!(cell(Dialect::MySql, &flag, Some("TRUE")), Some("1".into()));
        assert_eq!(
            cell(Dialect::Sqlite, &Column::new("on", "boolean"), Some("false")),
            Some("0".into())
        );
        assert_eq!(
            cell(Dialect::Postgres, &Column::new("on", "boolean"), Some("true")),
            Some("true".into())
        );
    }

    #[test]
    fn refuses_mappings_that_do_not_fit_the_table() {
        let table = orders();
        assert!(Plan::new(Dialect::Sqlite, &table, &[]).is_err());
        let unknown = Plan::new(Dialect::Sqlite, &table, &mapping(&[("a", "nope")])).unwrap_err();
        assert_eq!(unknown.to_string(), "orders has no column named nope");
        let twice = Plan::new(Dialect::Sqlite, &table, &mapping(&[("a", "id"), ("b", "id")]));
        assert!(twice.unwrap_err().to_string().contains("more than one"));
    }

    async fn notes(environment: Environment) -> (tempfile::TempDir, Data) {
        let folder = tempfile::tempdir().unwrap();
        let database = folder.path().join("notes.db");
        let setup = sqlx::sqlite::SqlitePoolOptions::new()
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&database)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, stars INTEGER CHECK (stars >= 0), done BOOLEAN);
             INSERT INTO notes VALUES (1, 'old', NULL, 0);",
        )
        .execute(&setup)
        .await
        .unwrap();
        setup.close().await;
        let data = Data::new(&folder.path().join("data"));
        data.save(ConnectionInput {
            id: Some("notes".into()),
            name: "Notes".into(),
            engine: Engine::Sqlite,
            host: String::new(),
            port: None,
            user: None,
            database: None,
            file: Some(database.to_string_lossy().into_owned()),
            tls: false,
            environment,
            password: None,
            ssh: None,
            ssh_secret: None,
        })
        .unwrap();
        data.connect("notes", None).await.unwrap();
        (folder, data)
    }

    fn request(path: &Path, empty_first: bool) -> ImportRequest {
        ImportRequest {
            table: TableRef { schema: None, name: "notes".into() },
            path: path.to_string_lossy().into_owned(),
            options: CSV,
            mapping: mapping(&[("Title", "title"), ("Stars", "stars"), ("Done", "done")]),
            empty_first,
        }
    }

    async fn titles(data: &Data) -> Vec<Vec<Value>> {
        let page = RowsRequest {
            table: TableRef { schema: None, name: "notes".into() },
            filters: Vec::new(),
            sort: Some(Sort { column: "id".into(), descending: false }),
            limit: 100,
            offset: 0,
        };
        data.rows("notes", &page).await.unwrap().rows
    }

    #[tokio::test]
    async fn imports_a_csv_into_sqlite_in_one_transaction() {
        let (_folder, data) = notes(Environment::Local).await;
        let csv =
            file("Title,Stars,Done,Ignored\nFirst,5,true,x\n\"Second, with comma\",,false,y\n");
        let progress = std::sync::Mutex::new(Vec::new());
        let imported = data
            .import("notes", &request(csv.path(), true), |step| progress.lock().unwrap().push(step))
            .await
            .unwrap();
        assert_eq!(imported, 2);
        let steps = progress.into_inner().unwrap();
        assert_eq!(steps.last().map(|step| step.rows), Some(2));
        assert_eq!(
            titles(&data).await,
            [
                vec![
                    Value::Number(1.0),
                    Value::Text("First".into()),
                    Value::Number(5.0),
                    Value::Number(1.0)
                ],
                vec![
                    Value::Number(2.0),
                    Value::Text("Second, with comma".into()),
                    Value::Null,
                    Value::Number(0.0)
                ],
            ]
        );

        let broken = file("Title,Stars,Done\nThird,1,true\nFourth,-1,false\n");
        let error = data.import("notes", &request(broken.path(), false), |_| {}).await.unwrap_err();
        assert!(error.to_string().contains("(row 2 of the file)"), "{error}");
        assert_eq!(titles(&data).await.len(), 2, "the failed import rolled back");
    }

    #[tokio::test]
    async fn refuses_writes_in_safe_mode_then_truncates_and_drops() {
        let (_folder, data) = notes(Environment::Production).await;
        let csv = file("Title\nBlocked\n");
        let table = TableRef { schema: None, name: "notes".into() };
        let blocked = data.import("notes", &request(csv.path(), false), |_| {}).await;
        assert!(matches!(blocked, Err(Error::ReadOnly(_))));
        assert!(matches!(data.truncate("notes", &table).await, Err(Error::ReadOnly(_))));
        assert!(matches!(data.drop_table("notes", &table).await, Err(Error::ReadOnly(_))));

        data.allow_writes("notes", 5).await.unwrap();
        data.truncate("notes", &table).await.unwrap();
        assert!(titles(&data).await.is_empty());
        let schema = data.drop_table("notes", &table).await.unwrap();
        assert!(schema.iter().all(|namespace| namespace.tables.is_empty()));
    }
}
