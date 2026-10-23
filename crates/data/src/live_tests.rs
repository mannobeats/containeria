//! End-to-end checks against real databases running in throwaway containers. They need a Docker
//! engine, so they're ignored by default. Start the containers, run, then remove them:
//!
//! ```sh
//! docker run -d --name containeria-test-postgres -e POSTGRES_PASSWORD=test-pass -e POSTGRES_DB=shop -p 55432:5432 postgres:18-alpine
//! docker run -d --name containeria-test-mysql -e MYSQL_ROOT_PASSWORD=test-pass -e MYSQL_DATABASE=shop -p 53306:3306 mysql:8.4
//! docker run -d --name containeria-test-redis -p 56379:6379 redis:8-alpine
//! docker run -d --name containeria-test-mongo -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=test-pass -p 57017:27017 mongo:8
//! docker run -d --name containeria-test-clickhouse -e CLICKHOUSE_PASSWORD=test-pass -e CLICKHOUSE_DB=events -p 58123:8123 clickhouse/clickhouse-server:25.8-alpine
//! DOCKER_SOCKET=$HOME/.orbstack/run/docker.sock cargo test -p containeria-data -- --ignored --test-threads=1
//! docker rm -f containeria-test-postgres containeria-test-mysql containeria-test-redis containeria-test-mongo containeria-test-clickhouse
//! ```
//!
//! Each test opens its database the way the app does: found in its container, credentials read
//! from the container's environment.

use std::path::PathBuf;

use containeria_docker::Docker;

use crate::changes::{Cell, ChangeSet, RowUpdate};
use crate::export::ExportFormat;
use crate::query::{Filter, FilterOp, RowsRequest, Sort};
use crate::schema::TableRef;
use crate::service::Data;
use crate::value::Value;

fn docker() -> Docker {
    let socket = std::env::var_os("DOCKER_SOCKET")
        .map_or_else(|| PathBuf::from("/var/run/docker.sock"), PathBuf::from);
    Docker::connect(&socket).unwrap()
}

async fn open(container: &str) -> (tempfile::TempDir, Data, String) {
    let folder = tempfile::tempdir().unwrap();
    let data = Data::new(folder.path());
    let docker = docker();
    let id = format!("container:{container}");
    let mut last = None;
    // Databases take a few seconds to accept connections after their container starts.
    for _ in 0..60 {
        match data.connect(&id, Some(&docker)).await {
            Ok(_) => return (folder, data, id),
            Err(error) => last = Some(error),
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    panic!("{container} never accepted a connection: {last:?}");
}

fn request(table: &str, schema: Option<&str>) -> RowsRequest {
    RowsRequest {
        table: TableRef { schema: schema.map(Into::into), name: table.into() },
        filters: Vec::new(),
        sort: None,
        limit: 100,
        offset: 0,
    }
}

fn cell(column: &str, value: &str) -> Cell {
    Cell { column: column.into(), value: Some(value.into()) }
}

async fn browse_edit_and_export(data: &Data, id: &str, schema: Option<&str>) {
    let tables = data.schema(id, true).await.unwrap();
    let customers = tables
        .iter()
        .flat_map(|namespace| &namespace.tables)
        .find(|table| table.name == "customers")
        .unwrap();
    assert!(customers.column("id").unwrap().primary_key);
    let orders = tables
        .iter()
        .flat_map(|namespace| &namespace.tables)
        .find(|table| table.name == "orders")
        .unwrap();
    assert_eq!(
        orders.column("customer_id").unwrap().references.as_ref().map(|key| key.table.as_str()),
        Some("customers")
    );

    let mut filtered = request("customers", schema);
    filtered.filters =
        vec![Filter { column: "email".into(), op: FilterOp::Contains, value: Some("_b".into()) }];
    filtered.sort = Some(Sort { column: "id".into(), descending: true });
    let page = data.rows(id, &filtered).await.unwrap();
    assert_eq!(page.total, Some(1), "the underscore is matched literally");
    assert_eq!(page.rows[0][1], Value::Text("o'brien_b@example.com".into()));
    assert!(page.read_only_reason.is_none());

    let changes = ChangeSet {
        table: TableRef { schema: schema.map(Into::into), name: "customers".into() },
        updates: vec![RowUpdate {
            key: vec![cell("id", "1")],
            set: vec![cell("email", "ada@example.org"), cell("credit", "12.50")],
        }],
        inserts: vec![vec![cell("email", "new@example.com")]],
        deletes: Vec::new(),
    };
    assert!(data.preview(id, &changes).await.unwrap().contains("ada@example.org"));
    assert_eq!(data.commit(id, &changes).await.unwrap(), 2);
    let all = data.rows(id, &request("customers", schema)).await.unwrap();
    assert_eq!(all.rows.len(), 3);
    assert!(all.rows.iter().any(
        |row| row[1] == Value::Text("ada@example.org".into()) && row[2] == Value::Number(12.5)
    ));

    let file = tempfile::NamedTempFile::new().unwrap();
    assert_eq!(
        data.export(id, &request("customers", schema), ExportFormat::Csv, file.path())
            .await
            .unwrap(),
        3
    );
    assert!(std::fs::read_to_string(file.path()).unwrap().starts_with("id,email,credit\n"));
    assert_eq!(data.history().unwrap().len(), 1, "the setup statement is in the history");
}

#[tokio::test]
#[ignore = "needs a Docker engine and the containeria-test-postgres container"]
async fn postgres_end_to_end() {
    let (_folder, data, id) = open("containeria-test-postgres").await;
    data.run(
        &id,
        "DROP TABLE IF EXISTS orders, customers;
         CREATE TABLE customers (id serial PRIMARY KEY, email text NOT NULL, credit numeric(10,2));
         CREATE TABLE orders (id serial PRIMARY KEY, customer_id int REFERENCES customers(id), placed timestamptz DEFAULT now(), tags text[]);
         INSERT INTO customers (email) VALUES ('ada@example.com'), ('o''brien_b@example.com');
         INSERT INTO orders (customer_id, tags) VALUES (1, '{a,b}');",
    )
    .await
    .unwrap();
    browse_edit_and_export(&data, &id, Some("public")).await;
    let orders = data.rows(&id, &request("orders", Some("public"))).await.unwrap();
    assert_eq!(orders.rows[0][3], Value::Text("{a,b}".into()), "arrays read as their text form");
    let result = data
        .run(&id, "SELECT 1::int8 AS big, 'x'::text AS t, '{\"a\":1}'::jsonb AS j")
        .await
        .unwrap();
    assert_eq!(
        result.rows[0],
        vec![Value::Number(1.0), Value::Text("x".into()), Value::Json(serde_json::json!({"a": 1}))]
    );
}

#[tokio::test]
#[ignore = "needs a Docker engine and the containeria-test-mysql container"]
async fn mysql_end_to_end() {
    let (_folder, data, id) = open("containeria-test-mysql").await;
    data.run(
        &id,
        "DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS customers;
         CREATE TABLE customers (id int AUTO_INCREMENT PRIMARY KEY, email varchar(255) NOT NULL, credit decimal(10,2));
         CREATE TABLE orders (id int AUTO_INCREMENT PRIMARY KEY, customer_id int, done tinyint(1) DEFAULT 0, FOREIGN KEY (customer_id) REFERENCES customers(id));
         INSERT INTO customers (email) VALUES ('ada@example.com'), ('o''brien_b@example.com');
         INSERT INTO orders (customer_id) VALUES (1);",
    )
    .await
    .unwrap();
    browse_edit_and_export(&data, &id, Some("shop")).await;
    let orders = data.rows(&id, &request("orders", Some("shop"))).await.unwrap();
    assert_eq!(orders.rows[0][2], Value::Bool(false));
}

/// Safe mode isn't a UI promise: the database refuses the write inside a read-only transaction.
async fn refuses_writes_in_safe_mode(container: &str) {
    let docker = docker();
    let data = Data::new(tempfile::tempdir().unwrap().path());
    let detected = data
        .detected(&docker)
        .await
        .unwrap()
        .into_iter()
        .find(|found| found.container_name == container)
        .unwrap();
    let env = docker.container_env(&detected.container_id).await.unwrap();
    let session = crate::session::Session::open(
        &crate::detect::target(&detected, &env).unwrap(),
        crate::tunnel::KnownHosts::new(data.folder()),
    )
    .await
    .unwrap();
    let error =
        session.run("DELETE FROM customers", true).await.unwrap_err().to_string().to_lowercase();
    assert!(error.contains("read-only") || error.contains("read only"), "{error}");
    assert!(session.run("SELECT count(*) FROM customers", true).await.is_ok());
}

#[tokio::test]
#[ignore = "needs a Docker engine and the containeria-test-postgres and containeria-test-mysql containers"]
async fn safe_mode_is_enforced_by_the_database() {
    let (_pg_folder, pg, pg_id) = open("containeria-test-postgres").await;
    pg.run(&pg_id, "CREATE TABLE IF NOT EXISTS customers (id serial PRIMARY KEY)").await.unwrap();
    refuses_writes_in_safe_mode("containeria-test-postgres").await;
    let (_my_folder, my, my_id) = open("containeria-test-mysql").await;
    my.run(&my_id, "CREATE TABLE IF NOT EXISTS customers (id int PRIMARY KEY)").await.unwrap();
    refuses_writes_in_safe_mode("containeria-test-mysql").await;
}

#[tokio::test]
#[ignore = "needs a Docker engine and the containeria-test-redis container"]
async fn redis_keys_and_values() {
    let (_folder, data, id) = open("containeria-test-redis").await;
    data.redis_set(&id, "containeria:test:greeting", "hello").await.unwrap();
    let page = data.redis_keys(&id, "containeria:test:*", None).await.unwrap();
    assert!(
        page.keys.iter().any(|key| key.key == "containeria:test:greeting" && key.kind == "string")
    );
    assert_eq!(
        data.redis_value(&id, "containeria:test:greeting").await.unwrap(),
        crate::redis::RedisValue::Text { value: "hello".into() }
    );
    data.redis_delete(&id, "containeria:test:greeting").await.unwrap();
}

#[tokio::test]
#[ignore = "needs a Docker engine and the containeria-test-mongo container"]
async fn mongo_collections_and_filters() {
    let (_folder, data, id) = open("containeria-test-mongo").await;
    let mongodb = mongodb::Client::with_uri_str(
        "mongodb://root:test-pass@127.0.0.1:57017/?directConnection=true",
    )
    .await
    .unwrap();
    let users = mongodb.database("app").collection::<mongodb::bson::Document>("users");
    users.drop().await.unwrap();
    users
        .insert_many([
            mongodb::bson::doc! { "name": "Ada", "age": 36 },
            mongodb::bson::doc! { "name": "Grace", "age": 45 },
        ])
        .await
        .unwrap();
    data.schema(&id, true).await.unwrap();
    let mut older = request("users", Some("app"));
    older.filters =
        vec![Filter { column: "age".into(), op: FilterOp::Greater, value: Some("40".into()) }];
    let page = data.rows(&id, &older).await.unwrap();
    assert_eq!(page.total, Some(1));
    assert_eq!(page.rows[0][1], Value::Text("Grace".into()));
}

#[tokio::test]
#[ignore = "needs a Docker engine and the containeria-test-clickhouse container"]
async fn clickhouse_tables_and_queries() {
    let (_folder, data, id) = open("containeria-test-clickhouse").await;
    data.run(&id, "DROP TABLE IF EXISTS events.hits").await.unwrap();
    data.run(
        &id,
        "CREATE TABLE events.hits (id UInt64, path String) ENGINE = MergeTree ORDER BY id",
    )
    .await
    .unwrap();
    data.run(
        &id,
        "INSERT INTO events.hits VALUES (1, '/'), (2, '/tees'), (18446744073709551615, '/max')",
    )
    .await
    .unwrap();
    data.schema(&id, true).await.unwrap();
    let mut filtered = request("hits", Some("events"));
    filtered.filters =
        vec![Filter { column: "id".into(), op: FilterOp::Greater, value: Some("1".into()) }];
    let page = data.rows(&id, &filtered).await.unwrap();
    assert_eq!(page.total, Some(2));
    assert!(page.rows.iter().any(|row| row[0] == Value::Text("18446744073709551615".into())));
    assert!(page.read_only_reason.is_some());
}
