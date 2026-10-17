//! MongoDB: databases become namespaces, collections become tables whose columns are sampled from
//! their documents. Browsing filters and sorts translate into a query document.

use std::time::Duration;

use futures::TryStreamExt;
use mongodb::bson::{Bson, Document, doc, oid::ObjectId};
use mongodb::options::{ClientOptions, Credential, ServerAddress, Tls, TlsOptions};

use crate::connection::Target;
use crate::error::{Error, Result};
use crate::query::{Filter, FilterOp, RowsRequest};
use crate::schema::{Column, Namespace, Table, TableKind};
use crate::value::{Value, ValueKind};

const SAMPLE: i64 = 50;
const SYSTEM_DATABASES: [&str; 3] = ["admin", "config", "local"];

#[derive(Debug, Clone)]
pub(crate) struct Mongo {
    client: mongodb::Client,
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

/// The filter value as BSON, typed by what the column holds.
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
        Ok(Self { client: mongodb::Client::with_options(options)? })
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

    fn collection(&self, table: &Table) -> mongodb::Collection<Document> {
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
    fn rejects_unknown_fields() {
        let filters = [Filter { column: "$where".into(), op: FilterOp::IsNull, value: None }];
        assert!(query(&users(), &filters).is_err());
    }
}
