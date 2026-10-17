//! MongoDB: databases become namespaces, collections become tables whose columns are sampled from
//! their documents. Browsing filters and sorts translate into a query document; query tabs run
//! `find` or `aggregate` written as JSON; grid edits become `updateOne`, `deleteOne` and
//! `insertOne` by `_id`.

use std::time::{Duration, Instant};

use futures::{StreamExt, TryStreamExt};
use mongodb::bson::{Bson, DateTime, Document, doc, oid::ObjectId};
use mongodb::options::{ClientOptions, Credential, FindOptions, ServerAddress, Tls, TlsOptions};
use mongodb::{ClientSession, Collection};

use crate::changes::{Cell, ChangeSet};
use crate::connection::Target;
use crate::error::{Error, Result};
use crate::query::{Filter, FilterOp, RowsRequest};
use crate::result::{MAX_RESULT_ROWS, QueryResult, ResultColumn};
use crate::schema::{Column, Namespace, Table, TableKind};
use crate::value::{Value, ValueKind};

const SAMPLE: i64 = 50;
const SYSTEM_DATABASES: [&str; 3] = ["admin", "config", "local"];

#[derive(Debug, Clone)]
pub(crate) struct Mongo {
    client: mongodb::Client,
    /// The connection's database: where a query without `"database"` runs.
    database: Option<String>,
}

fn bson_type(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Decimal128(_) => "decimal",
        Bson::String(_) => "string",
        Bson::Boolean(_) => "bool",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) | Bson::Timestamp(_) => "date",
        Bson::Document(_) => "object",
        Bson::Array(_) => "array",
        Bson::Binary(_) => "binData",
        Bson::Null | Bson::Undefined => "null",
        _ => "other",
    }
}

pub(crate) fn value(bson: Bson) -> Value {
    match bson {
        Bson::Null | Bson::Undefined => Value::Null,
        Bson::Boolean(flag) => Value::Bool(flag),
        Bson::Int32(number) => Value::integer(number.into()),
        Bson::Int64(number) => Value::integer(number),
        Bson::Double(number) => Value::float(number),
        Bson::String(text) => Value::Text(text),
        Bson::ObjectId(id) => Value::Text(id.to_hex()),
        Bson::DateTime(time) => {
            Value::Text(time.try_to_rfc3339_string().unwrap_or_else(|_| time.to_string()))
        }
        Bson::Decimal128(decimal) => Value::Text(decimal.to_string()),
        Bson::Binary(binary) => Value::bytes(&binary.bytes),
        nested @ (Bson::Document(_) | Bson::Array(_)) => Value::Json(nested.into_relaxed_extjson()),
        other => Value::Text(other.to_string()),
    }
}

/// The filter or edited value as BSON, typed by what the column holds.
fn typed(column: &Column, text: &str) -> Bson {
    if column.type_name == "objectId"
        && let Ok(id) = ObjectId::parse_str(text)
    {
        return Bson::ObjectId(id);
    }
    if column.kind == ValueKind::Number {
        if let Ok(integer) = text.parse::<i64>() {
            return Bson::Int64(integer);
        }
        if let Ok(real) = text.parse::<f64>() {
            return Bson::Double(real);
        }
    }
    if column.kind == ValueKind::Bool
        && let Ok(flag) = text.parse::<bool>()
    {
        return Bson::Boolean(flag);
    }
    if column.kind == ValueKind::Time
        && let Ok(time) = DateTime::parse_rfc3339_str(text)
    {
        return Bson::DateTime(time);
    }
    Bson::String(text.to_owned())
}

/// Translates grid filters into a query document. Text searches are literal, case-insensitive.
pub(crate) fn query(table: &Table, filters: &[Filter]) -> Result<Document> {
    let mut query = Document::new();
    for filter in filters {
        let column = table.column(&filter.column).ok_or_else(|| {
            Error::Invalid(format!("{} has no field named {}", table.name, filter.column))
        })?;
        let text = || {
            filter.value.clone().ok_or_else(|| {
                Error::Invalid(format!("the filter on {} needs a value", column.name))
            })
        };
        let condition = match filter.op {
            FilterOp::IsNull => Bson::Null,
            FilterOp::IsNotNull => Bson::Document(doc! { "$ne": Bson::Null }),
            FilterOp::Equals => typed(column, &text()?),
            FilterOp::NotEquals => Bson::Document(doc! { "$ne": typed(column, &text()?) }),
            FilterOp::Greater => Bson::Document(doc! { "$gt": typed(column, &text()?) }),
            FilterOp::Less => Bson::Document(doc! { "$lt": typed(column, &text()?) }),
            FilterOp::GreaterOrEqual => Bson::Document(doc! { "$gte": typed(column, &text()?) }),
            FilterOp::LessOrEqual => Bson::Document(doc! { "$lte": typed(column, &text()?) }),
            FilterOp::Contains | FilterOp::StartsWith => {
                let literal = regex_escape(&text()?);
                let pattern =
                    if filter.op == FilterOp::StartsWith { format!("^{literal}") } else { literal };
                Bson::Document(doc! { "$regex": pattern, "$options": "i" })
            }
        };
        query.insert(column.name.clone(), condition);
    }
    Ok(query)
}

fn regex_escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for char in text.chars() {
        if "\\^$.|?*+()[]{}".contains(char) {
            escaped.push('\\');
        }
        escaped.push(char);
    }
    escaped
}

impl Mongo {
    pub(crate) fn connect(target: &Target) -> Result<Self> {
        let mut options = ClientOptions::default();
        options.hosts = vec![ServerAddress::Tcp {
            host: target.host.clone(),
            port: Some(target.port.unwrap_or(27017)),
        }];
        options.app_name = Some("Containeria".into());
        options.server_selection_timeout = Some(Duration::from_secs(10));
        options.connect_timeout = Some(Duration::from_secs(10));
        options.direct_connection = Some(true);
        if target.tls {
            options.tls = Some(Tls::Enabled(TlsOptions::default()));
        }
        if let Some(user) = &target.user {
            let mut credential = Credential::default();
            credential.username = Some(user.clone());
            credential.password.clone_from(&target.password);
            credential.source = Some("admin".into());
            options.credential = Some(credential);
        }
        Ok(Self {
            client: mongodb::Client::with_options(options)?,
            database: target.database.clone(),
        })
    }

    pub(crate) async fn version(&self) -> Result<String> {
        let info = self.client.database("admin").run_command(doc! { "buildInfo": 1 }).await?;
        Ok(format!("MongoDB {}", info.get_str("version").unwrap_or("")))
    }

    pub(crate) async fn schema(&self) -> Result<Vec<Namespace>> {
        let mut namespaces = Vec::new();
        for name in self.client.list_database_names().await? {
            if SYSTEM_DATABASES.contains(&name.as_str()) {
                continue;
            }
            let database = self.client.database(&name);
            let mut tables = Vec::new();
            let mut collections = database.list_collection_names().await?;
            collections.sort();
            for collection_name in collections {
                let collection = database.collection::<Document>(&collection_name);
                let rows = collection.estimated_document_count().await.ok();
                let sample: Vec<Document> =
                    collection.find(doc! {}).limit(SAMPLE).await?.try_collect().await?;
                tables.push(Table {
                    schema: Some(name.clone()),
                    name: collection_name,
                    kind: TableKind::Collection,
                    row_estimate: rows,
                    size_bytes: None,
                    columns: fields(&sample),
                    indexes: Vec::new(),
                });
            }
            namespaces.push(Namespace { name, tables, functions: Vec::new(), enums: Vec::new() });
        }
        Ok(namespaces)
    }

    fn collection(&self, table: &Table) -> Collection<Document> {
        self.client.database(table.schema.as_deref().unwrap_or("test")).collection(&table.name)
    }

    pub(crate) async fn rows(
        &self,
        table: &Table,
        request: &RowsRequest,
    ) -> Result<Vec<Vec<Value>>> {
        let collection = self.collection(table);
        let sort = request.sort.as_ref().map_or_else(
            Document::new,
            |sort| doc! { sort.column.clone(): if sort.descending { -1 } else { 1 } },
        );
        let documents: Vec<Document> = collection
            .find(query(table, &request.filters)?)
            .sort(sort)
            .skip(u64::from(request.offset))
            .limit(i64::from(request.limit.clamp(1, crate::query::MAX_PAGE)))
            .await?
            .try_collect()
            .await?;
        Ok(documents
            .into_iter()
            .map(|mut document| {
                table
                    .columns
                    .iter()
                    .map(|column| document.remove(&column.name).map_or(Value::Null, value))
                    .collect()
            })
            .collect())
    }

    pub(crate) async fn count(&self, table: &Table, filters: &[Filter], cap: u32) -> Result<u64> {
        Ok(self
            .collection(table)
            .count_documents(query(table, filters)?)
            .limit(u64::from(cap))
            .await?)
    }

    /// Runs a query tab's `find` or `aggregate`. In safe mode, pipelines that write are refused.
    pub(crate) async fn run(&self, text: &str, read_only: bool) -> Result<QueryResult> {
        let started = Instant::now();
        let query = MongoQuery::parse(text)?;
        let database = query.database.as_deref().or(self.database.as_deref()).ok_or_else(|| {
            Error::Invalid(
                "Add \"database\" to the query: this connection has no default database.".into(),
            )
        })?;
        let collection = self.client.database(database).collection::<Document>(&query.collection);
        let cap = MAX_RESULT_ROWS + 1;
        let mut documents: Vec<Document> = match query.operation {
            Operation::Find { filter, mut options } => {
                let limit =
                    options.limit.map_or(cap, |limit| usize::try_from(limit).unwrap_or(cap));
                options.limit = Some(i64::try_from(limit.min(cap)).unwrap_or(i64::MAX));
                collection.find(filter).with_options(*options).await?.try_collect().await?
            }
            Operation::Aggregate(pipeline) => {
                if read_only && writes(&pipeline) {
                    return Err(Error::Unsupported(
                        "Safe mode is on: $out and $merge write, so they run only once you allow writes."
                            .into(),
                    ));
                }
                collection.aggregate(pipeline).await?.take(cap).try_collect().await?
            }
        };
        let truncated = documents.len() > MAX_RESULT_ROWS;
        documents.truncate(MAX_RESULT_ROWS);
        Ok(QueryResult { truncated, ..flatten(documents, started) })
    }

    /// Applies grid edits. A replica set or sharded cluster runs them in one transaction; a
    /// standalone server has none, so they run in order and stop at the first that fails.
    pub(crate) async fn apply(&self, table: &Table, changes: &[DocumentChange]) -> Result<u64> {
        let hello = self.client.database("admin").run_command(doc! { "hello": 1 }).await?;
        let transactional = hello.contains_key("setName")
            || hello.get_str("msg").is_ok_and(|msg| msg == "isdbgrid");
        let collection = self.collection(table);
        let mut session = self.client.start_session().await?;
        if transactional {
            session.start_transaction().await?;
        }
        let mut affected = 0;
        for change in changes {
            match apply_one(&collection, &mut session, table, change).await {
                Ok(()) => affected += 1,
                Err(error) => {
                    if transactional {
                        let _ = session.abort_transaction().await;
                    }
                    return Err(error);
                }
            }
        }
        if transactional {
            session.commit_transaction().await?;
        }
        Ok(affected)
    }
}

async fn apply_one(
    collection: &Collection<Document>,
    session: &mut ClientSession,
    table: &Table,
    change: &DocumentChange,
) -> Result<()> {
    let moved = || {
        Error::Invalid(format!(
            "a document in {} changed or was deleted since it was read; refresh and try again",
            table.name
        ))
    };
    match change {
        DocumentChange::Delete { filter } => {
            let deleted = collection.delete_one(filter.clone()).session(&mut *session).await?;
            if deleted.deleted_count != 1 {
                return Err(moved());
            }
        }
        DocumentChange::Update { filter, set } => {
            let update = doc! { "$set": set.clone() };
            let updated =
                collection.update_one(filter.clone(), update).session(&mut *session).await?;
            if updated.matched_count != 1 {
                return Err(moved());
            }
        }
        DocumentChange::Insert { document } => {
            collection.insert_one(document.clone()).session(&mut *session).await?;
        }
    }
    Ok(())
}

/// A pipeline with `$out` or `$merge` writes to a collection.
fn writes(pipeline: &[Document]) -> bool {
    pipeline.iter().any(|stage| stage.contains_key("$out") || stage.contains_key("$merge"))
}

/// Documents as grid rows: one column per top-level field, nested values as JSON.
fn flatten(documents: Vec<Document>, started: Instant) -> QueryResult {
    let columns = fields(&documents);
    let rows = documents
        .into_iter()
        .map(|mut document| {
            columns
                .iter()
                .map(|column| document.remove(&column.name).map_or(Value::Null, value))
                .collect()
        })
        .collect();
    QueryResult {
        columns: columns
            .into_iter()
            .map(|column| ResultColumn {
                name: column.name,
                type_name: column.type_name,
                kind: column.kind,
            })
            .collect(),
        rows,
        affected: None,
        truncated: false,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
    }
}

#[derive(Debug, Clone)]
enum Operation {
    Find { filter: Document, options: Box<FindOptions> },
    Aggregate(Vec<Document>),
}

/// A query tab's text: a JSON object naming the collection and either `find` (with optional
/// `projection`, `sort`, `limit` and `skip`) or an `aggregate` pipeline. Values are MongoDB
/// Extended JSON, so `{"$oid": "…"}` and `{"$date": "…"}` work.
#[derive(Debug, Clone)]
struct MongoQuery {
    database: Option<String>,
    collection: String,
    operation: Operation,
}

const QUERY_KEYS: [&str; 8] =
    ["database", "collection", "find", "projection", "sort", "limit", "skip", "aggregate"];

impl MongoQuery {
    fn parse(text: &str) -> Result<Self> {
        let json: serde_json::Value = serde_json::from_str(text)
            .map_err(|error| Error::Invalid(format!("the query isn't valid JSON: {error}")))?;
        let serde_json::Value::Object(map) = json else {
            return Err(Error::Invalid(
                "write the query as one JSON object, such as {\"collection\": \"users\", \"find\": {}}"
                    .into(),
            ));
        };
        if let Some(unknown) = map.keys().find(|key| !QUERY_KEYS.contains(&key.as_str())) {
            return Err(Error::Invalid(format!(
                "the query has an unknown key \"{unknown}\"; use {}",
                QUERY_KEYS.join(", ")
            )));
        }
        let mut query = Document::try_from(map).map_err(|error| {
            Error::Invalid(format!("the query isn't valid Extended JSON: {error}"))
        })?;
        let text_key = |query: &mut Document, key: &str| match query.remove(key) {
            None => Ok(None),
            Some(Bson::String(text)) if !text.trim().is_empty() => Ok(Some(text)),
            Some(_) => Err(Error::Invalid(format!("\"{key}\" is the name, as a string"))),
        };
        let database = text_key(&mut query, "database")?;
        let collection = text_key(&mut query, "collection")?.ok_or_else(|| {
            Error::Invalid("name the collection: \"collection\": \"users\"".into())
        })?;
        let operation = match query.remove("aggregate") {
            Some(pipeline) => {
                if let Some(extra) = ["find", "projection", "sort", "limit", "skip"]
                    .into_iter()
                    .find(|key| query.contains_key(key))
                {
                    return Err(Error::Invalid(format!(
                        "\"{extra}\" belongs to find; in an aggregate, use a pipeline stage"
                    )));
                }
                Operation::Aggregate(stages(pipeline)?)
            }
            None => Operation::Find {
                filter: document_key(&mut query, "find")?.unwrap_or_default(),
                options: Box::new(find_options(&mut query)?),
            },
        };
        Ok(Self { database, collection, operation })
    }
}

fn document_key(query: &mut Document, key: &str) -> Result<Option<Document>> {
    match query.remove(key) {
        None => Ok(None),
        Some(Bson::Document(document)) => Ok(Some(document)),
        Some(_) => Err(Error::Invalid(format!("\"{key}\" is a JSON object"))),
    }
}

fn count_key(query: &mut Document, key: &str) -> Result<Option<u64>> {
    let number = match query.remove(key) {
        None => return Ok(None),
        Some(Bson::Int32(number)) => i64::from(number),
        Some(Bson::Int64(number)) => number,
        Some(_) => -1,
    };
    u64::try_from(number)
        .map(Some)
        .map_err(|_| Error::Invalid(format!("\"{key}\" is a whole number, 0 or more")))
}

fn find_options(query: &mut Document) -> Result<FindOptions> {
    let mut options = FindOptions::default();
    options.projection = document_key(query, "projection")?;
    options.sort = document_key(query, "sort")?;
    options.limit = count_key(query, "limit")?
        .filter(|limit| *limit > 0)
        .map(|limit| i64::try_from(limit).unwrap_or(i64::MAX));
    options.skip = count_key(query, "skip")?;
    Ok(options)
}

fn stages(pipeline: Bson) -> Result<Vec<Document>> {
    let not_a_pipeline =
        || Error::Invalid("\"aggregate\" is a pipeline: an array of stage objects".into());
    let Bson::Array(stages) = pipeline else {
        return Err(not_a_pipeline());
    };
    stages
        .into_iter()
        .map(|stage| match stage {
            Bson::Document(stage) => Ok(stage),
            _ => Err(not_a_pipeline()),
        })
        .collect()
}

/// One grid edit as a MongoDB write, matched by `_id`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DocumentChange {
    Delete { filter: Document },
    Update { filter: Document, set: Document },
    Insert { document: Document },
}

fn edited(table: &Table, cell: &Cell) -> Result<(String, Bson)> {
    let column = table.column(&cell.column).ok_or_else(|| {
        Error::Invalid(format!("{} has no field named {}", table.name, cell.column))
    })?;
    let value = match &cell.value {
        None => Bson::Null,
        Some(text) if column.kind == ValueKind::Json => {
            let json: serde_json::Value = serde_json::from_str(text).map_err(|error| {
                Error::Invalid(format!("{} holds JSON, and that isn't: {error}", column.name))
            })?;
            Bson::try_from(json).map_err(|error| {
                Error::Invalid(format!("{} isn't valid Extended JSON: {error}", column.name))
            })?
        }
        Some(text) => typed(column, text),
    };
    Ok((column.name.clone(), value))
}

fn by_id(table: &Table, key: &[Cell]) -> Result<Document> {
    match key {
        [cell] if cell.column == "_id" && cell.value.is_some() => {
            let (name, value) = edited(table, cell)?;
            Ok(doc! { name: value })
        }
        _ => Err(Error::Invalid(format!("a document of {} is identified by _id", table.name))),
    }
}

/// The writes for staged grid edits, in the order deletes, updates, inserts.
///
/// # Errors
/// Fails when a key isn't `_id`, a field doesn't exist, or JSON doesn't parse.
pub(crate) fn changes(table: &Table, set: &ChangeSet) -> Result<Vec<DocumentChange>> {
    let fields = |cells: &[Cell]| -> Result<Document> {
        cells.iter().map(|cell| edited(table, cell)).collect()
    };
    let deletes =
        set.deletes.iter().map(|key| Ok(DocumentChange::Delete { filter: by_id(table, key)? }));
    let updates = set.updates.iter().map(|update| {
        if update.set.is_empty() {
            return Err(Error::Invalid("an update needs at least one changed field".into()));
        }
        Ok(DocumentChange::Update { filter: by_id(table, &update.key)?, set: fields(&update.set)? })
    });
    let inserts =
        set.inserts.iter().map(|cells| Ok(DocumentChange::Insert { document: fields(cells)? }));
    deletes.chain(updates).chain(inserts).collect()
}

/// The writes as `mongosh` commands, for the review sheet. For people only; never executed.
#[must_use]
pub(crate) fn preview(table: &Table, changes: &[DocumentChange]) -> String {
    let json = |document: &Document| Bson::Document(document.clone()).into_relaxed_extjson();
    let target = format!("db.getCollection({})", serde_json::Value::from(table.name.as_str()));
    changes
        .iter()
        .map(|change| match change {
            DocumentChange::Delete { filter } => format!("{target}.deleteOne({});\n", json(filter)),
            DocumentChange::Update { filter, set } => format!(
                "{target}.updateOne({}, {});\n",
                json(filter),
                json(&doc! { "$set": set.clone() })
            ),
            DocumentChange::Insert { document } => {
                format!("{target}.insertOne({});\n", json(document))
            }
        })
        .collect()
}

/// Every top-level field seen in the sample, `_id` first, typed by the first value seen.
pub(crate) fn fields(sample: &[Document]) -> Vec<Column> {
    let mut columns: Vec<Column> = Vec::new();
    for document in sample {
        for (name, value) in document {
            if columns.iter().any(|column| &column.name == name) {
                continue;
            }
            let mut column = Column::new(name.clone(), bson_type(value));
            column.kind = match value {
                Bson::Double(_) | Bson::Int32(_) | Bson::Int64(_) | Bson::Decimal128(_) => {
                    ValueKind::Number
                }
                Bson::Boolean(_) => ValueKind::Bool,
                Bson::Document(_) | Bson::Array(_) => ValueKind::Json,
                Bson::DateTime(_) | Bson::Timestamp(_) => ValueKind::Time,
                _ => ValueKind::Text,
            };
            column.primary_key = name == "_id";
            columns.push(column);
        }
    }
    columns.sort_by_key(|column| !column.primary_key);
    columns
}

#[cfg(test)]
mod tests {
    use super::*;

    fn users() -> Table {
        Table {
            schema: Some("app".into()),
            name: "users".into(),
            kind: TableKind::Collection,
            row_estimate: None,
            size_bytes: None,
            columns: fields(&[
                doc! { "name": "Ada", "_id": ObjectId::new(), "age": 36, "tags": ["a"] },
            ]),
            indexes: Vec::new(),
        }
    }

    #[test]
    fn samples_fields_with_the_id_first() {
        let columns = users().columns;
        assert_eq!(
            columns.iter().map(|column| column.name.as_str()).collect::<Vec<_>>(),
            ["_id", "name", "age", "tags"]
        );
        assert_eq!(columns[2].kind, ValueKind::Number);
        assert_eq!(columns[0].type_name, "objectId");
    }

    #[test]
    fn builds_typed_and_literal_queries() {
        let filters = [
            Filter { column: "age".into(), op: FilterOp::Greater, value: Some("30".into()) },
            Filter { column: "name".into(), op: FilterOp::Contains, value: Some("a.d".into()) },
        ];
        let built = query(&users(), &filters).unwrap();
        assert_eq!(
            built,
            doc! { "age": { "$gt": 30_i64 }, "name": { "$regex": "a\\.d", "$options": "i" } }
        );
    }

    #[test]
    fn reads_bson_into_grid_values() {
        assert_eq!(value(Bson::Int32(4)), Value::Number(4.0));
        assert_eq!(value(Bson::Array(vec![Bson::Int32(1)])), Value::Json(serde_json::json!([1])));
        assert_eq!(value(Bson::Null), Value::Null);
    }

    #[test]
    fn parses_find_with_its_options() {
        let query = MongoQuery::parse(
            r#"{"database": "app", "collection": "users", "find": {"_id": {"$oid": "65f1a2b3c4d5e6f708192a3b"}, "age": {"$gt": 30}},
                "projection": {"name": 1}, "sort": {"age": -1}, "limit": 20, "skip": 5}"#,
        )
        .unwrap();
        assert_eq!(query.database.as_deref(), Some("app"));
        assert_eq!(query.collection, "users");
        let Operation::Find { filter, options } = query.operation else { panic!("not a find") };
        assert_eq!(
            filter,
            doc! { "_id": ObjectId::parse_str("65f1a2b3c4d5e6f708192a3b").unwrap(), "age": { "$gt": 30 } }
        );
        assert_eq!(options.projection, Some(doc! { "name": 1 }));
        assert_eq!(options.sort, Some(doc! { "age": -1 }));
        assert_eq!((options.limit, options.skip), (Some(20), Some(5)));
        let everything = MongoQuery::parse(r#"{"collection": "users"}"#).unwrap();
        assert!(
            matches!(everything.operation, Operation::Find { filter, .. } if filter.is_empty())
        );
    }

    #[test]
    fn parses_an_aggregate_and_spots_writing_stages() {
        let query = MongoQuery::parse(
            r#"{"collection": "orders", "aggregate": [{"$match": {"paid": true}}, {"$out": "paid"}]}"#,
        )
        .unwrap();
        let Operation::Aggregate(pipeline) = query.operation else { panic!("not an aggregate") };
        assert_eq!(pipeline.len(), 2);
        assert!(writes(&pipeline));
        assert!(!writes(&pipeline[..1]));
    }

    #[test]
    fn explains_what_is_wrong_with_a_query() {
        let problem = |text: &str| MongoQuery::parse(text).unwrap_err().to_string();
        assert!(problem("{collection: users}").contains("valid JSON"));
        assert!(problem("[]").contains("one JSON object"));
        assert!(problem(r#"{"find": {}}"#).contains("name the collection"));
        assert!(problem(r#"{"collection": "u", "fitler": {}}"#).contains("unknown key \"fitler\""));
        assert!(problem(r#"{"collection": "u", "limit": -1}"#).contains("whole number"));
        assert!(problem(r#"{"collection": "u", "aggregate": {}}"#).contains("pipeline"));
        assert!(
            problem(r#"{"collection": "u", "aggregate": [], "sort": {}}"#)
                .contains("belongs to find")
        );
    }

    #[test]
    fn flattens_documents_to_top_level_fields() {
        let result = flatten(
            vec![
                doc! { "name": "Ada", "_id": 1, "address": { "city": "London" } },
                doc! { "_id": 2, "tags": ["x"] },
            ],
            Instant::now(),
        );
        let names: Vec<&str> = result.columns.iter().map(|column| column.name.as_str()).collect();
        assert_eq!(names, ["_id", "name", "address", "tags"]);
        assert_eq!(result.columns[2].kind, ValueKind::Json);
        assert_eq!(
            result.rows[0],
            [
                Value::Number(1.0),
                Value::Text("Ada".into()),
                Value::Json(serde_json::json!({ "city": "London" })),
                Value::Null
            ]
        );
        assert_eq!(result.rows[1][3], Value::Json(serde_json::json!(["x"])));
    }

    #[test]
    fn turns_grid_edits_into_writes_by_id() {
        let mut table = users();
        table.columns.push(Column { kind: ValueKind::Time, ..Column::new("seen", "date") });
        let id = "65f1a2b3c4d5e6f708192a3b";
        let cell = |column: &str, value: Option<&str>| Cell {
            column: column.into(),
            value: value.map(Into::into),
        };
        let set = ChangeSet {
            table: crate::schema::TableRef { schema: Some("app".into()), name: "users".into() },
            updates: vec![crate::changes::RowUpdate {
                key: vec![cell("_id", Some(id))],
                set: vec![
                    cell("age", Some("37")),
                    cell("tags", Some(r#"["a", "b"]"#)),
                    cell("name", None),
                    cell("seen", Some("2026-01-02T03:04:05Z")),
                ],
            }],
            inserts: vec![vec![cell("name", Some("Grace"))]],
            deletes: vec![vec![cell("_id", Some(id))]],
        };
        let built = changes(&table, &set).unwrap();
        let oid = ObjectId::parse_str(id).unwrap();
        assert_eq!(built[0], DocumentChange::Delete { filter: doc! { "_id": oid } });
        assert_eq!(
            built[1],
            DocumentChange::Update {
                filter: doc! { "_id": oid },
                set: doc! {
                    "age": 37_i64,
                    "tags": ["a", "b"],
                    "name": Bson::Null,
                    "seen": DateTime::parse_rfc3339_str("2026-01-02T03:04:05Z").unwrap(),
                },
            }
        );
        assert_eq!(built[2], DocumentChange::Insert { document: doc! { "name": "Grace" } });
        let text = preview(&table, &built[..2]);
        assert!(text.starts_with(&format!(
            "db.getCollection(\"users\").deleteOne({{\"_id\":{{\"$oid\":\"{id}\"}}}});\n"
        )));
        assert!(text.contains(".updateOne("));

        let mut wrong = set;
        wrong.deletes = vec![vec![cell("name", Some("Ada"))]];
        assert!(changes(&table, &wrong).unwrap_err().to_string().contains("identified by _id"));
        wrong.deletes.clear();
        wrong.updates[0].set = vec![cell("tags", Some("[oops"))];
        assert!(changes(&table, &wrong).unwrap_err().to_string().contains("holds JSON"));
    }

    #[test]
    fn rejects_unknown_fields() {
        let filters = [Filter { column: "$where".into(), op: FilterOp::IsNull, value: None }];
        assert!(query(&users(), &filters).is_err());
    }
}
