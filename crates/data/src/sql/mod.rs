//! Postgres, MySQL and SQLite through sqlx.

mod decode;
mod introspect;

use std::time::{Duration, Instant};

use futures::TryStreamExt;
use sqlx::mysql::{MySqlConnectOptions, MySqlDatabaseError, MySqlPoolOptions, MySqlSslMode};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqlitePoolOptions};
use sqlx::{
    Acquire, AssertSqlSafe, Connection, Either, Executor, MySqlPool, PgPool, Row, SqlSafeStr,
    SqlStr, SqlitePool,
};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::changes::Change;
use crate::connection::Target;
use crate::dialect::Dialect;
use crate::engine::Engine;
use crate::error::{Error, Result};
use crate::import::Batch;
use crate::query::Statement;
use crate::result::{MAX_RESULT_ROWS, QueryResult};
use crate::schema::{Namespace, Table};
use crate::value::Value;

const POOL_SIZE: u32 = 4;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// A pool of connections to one SQL database.
#[derive(Debug, Clone)]
pub(crate) enum SqlPool {
    Postgres(PgPool),
    MySql(MySqlPool),
    Sqlite(SqlitePool),
}

/// Binds every parameter as text: the SQL casts it to the column's type where that matters.
macro_rules! bound {
    ($statement:expr) => {{
        let statement: &Statement = $statement;
        let mut query = sqlx::query(AssertSqlSafe(statement.sql.as_str()));
        for param in &statement.params {
            query = query.bind(param.clone());
        }
        query
    }};
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

impl SqlPool {
    pub(crate) async fn connect(target: &Target) -> Result<Self> {
        match target.engine {
            Engine::Postgres => {
                let mut options = PgConnectOptions::new()
                    .host(&target.host)
                    .port(target.port.unwrap_or(5432))
                    .application_name("Containeria")
                    .ssl_mode(if target.tls { PgSslMode::Require } else { PgSslMode::Prefer });
                if let Some(user) = &target.user {
                    options = options.username(user);
                }
                if let Some(password) = &target.password {
                    options = options.password(password);
                }
                if let Some(database) = &target.database {
                    options = options.database(database);
                }
                let pool = PgPoolOptions::new()
                    .max_connections(POOL_SIZE)
                    .acquire_timeout(CONNECT_TIMEOUT)
                    .connect_with(options)
                    .await?;
                Ok(Self::Postgres(pool))
            }
            Engine::MySql | Engine::MariaDb => {
                let mut options = MySqlConnectOptions::new()
                    .host(&target.host)
                    .port(target.port.unwrap_or(3306))
                    .ssl_mode(if target.tls {
                        MySqlSslMode::Required
                    } else {
                        MySqlSslMode::Preferred
                    });
                if let Some(user) = &target.user {
                    options = options.username(user);
                }
                if let Some(password) = &target.password {
                    options = options.password(password);
                }
                if let Some(database) = &target.database {
                    options = options.database(database);
                }
                let pool = MySqlPoolOptions::new()
                    .max_connections(POOL_SIZE)
                    .acquire_timeout(CONNECT_TIMEOUT)
                    .connect_with(options)
                    .await?;
                Ok(Self::MySql(pool))
            }
            Engine::Sqlite => {
                let file = target
                    .file
                    .as_deref()
                    .ok_or_else(|| Error::Invalid("Choose the SQLite database file.".into()))?;
                let options = SqliteConnectOptions::new().filename(file).create_if_missing(false);
                let pool = SqlitePoolOptions::new()
                    .max_connections(POOL_SIZE)
                    .connect_with(options)
                    .await?;
                Ok(Self::Sqlite(pool))
            }
            other => Err(Error::Unsupported(format!("{other:?} isn't a SQL engine"))),
        }
    }

    pub(crate) const fn dialect(&self) -> Dialect {
        match self {
            Self::Postgres(_) => Dialect::Postgres,
            Self::MySql(_) => Dialect::MySql,
            Self::Sqlite(_) => Dialect::Sqlite,
        }
    }

    pub(crate) async fn version(&self) -> Result<String> {
        Ok(match self {
            Self::Postgres(pool) => {
                let (version,): (String,) =
                    sqlx::query_as("SHOW server_version").fetch_one(pool).await?;
                format!("PostgreSQL {}", version.split_whitespace().next().unwrap_or(&version))
            }
            Self::MySql(pool) => {
                let (version,): (String,) =
                    sqlx::query_as("SELECT CAST(VERSION() AS CHAR)").fetch_one(pool).await?;
                let number = version.split('-').next().unwrap_or(&version);
                if version.contains("MariaDB") {
                    format!("MariaDB {number}")
                } else {
                    format!("MySQL {number}")
                }
            }
            Self::Sqlite(pool) => {
                let (version,): (String,) =
                    sqlx::query_as("SELECT sqlite_version()").fetch_one(pool).await?;
                format!("SQLite {version}")
            }
        })
    }

    pub(crate) async fn schema(&self) -> Result<Vec<Namespace>> {
        match self {
            Self::Postgres(pool) => introspect::postgres(pool).await,
            Self::MySql(pool) => introspect::mysql(pool).await,
            Self::Sqlite(pool) => introspect::sqlite(pool).await,
        }
    }

    /// Runs a table page `SELECT`, reading values by the table's column types.
    pub(crate) async fn rows(
        &self,
        table: &Table,
        statement: &Statement,
    ) -> Result<Vec<Vec<Value>>> {
        let width = table.columns.len();
        Ok(match self {
            Self::Postgres(pool) => bound!(statement)
                .fetch_all(pool)
                .await?
                .iter()
                .map(|row| {
                    table
                        .columns
                        .iter()
                        .enumerate()
                        .map(|(index, column)| decode::postgres_text(row, index, &column.type_name))
                        .collect()
                })
                .collect(),
            Self::MySql(pool) => bound!(statement)
                .fetch_all(pool)
                .await?
                .iter()
                .map(|row| (0..width).map(|index| decode::mysql(row, index)).collect())
                .collect(),
            Self::Sqlite(pool) => bound!(statement)
                .fetch_all(pool)
                .await?
                .iter()
                .map(|row| (0..width).map(|index| decode::sqlite(row, index)).collect())
                .collect(),
        })
    }

    pub(crate) async fn count(&self, statement: &Statement) -> Result<u64> {
        let count: i64 = match self {
            Self::Postgres(pool) => bound!(statement).fetch_one(pool).await?.try_get(0)?,
            Self::MySql(pool) => bound!(statement).fetch_one(pool).await?.try_get(0)?,
            Self::Sqlite(pool) => bound!(statement).fetch_one(pool).await?.try_get(0)?,
        };
        Ok(u64::try_from(count).unwrap_or(0))
    }

    /// Runs every change in one transaction. A change that must hit exactly one row and doesn't
    /// rolls everything back.
    pub(crate) async fn apply(&self, changes: &[Change]) -> Result<u64> {
        macro_rules! transaction {
            ($pool:expr) => {{
                let mut transaction = $pool.begin().await?;
                let mut affected = 0;
                for change in changes {
                    let rows = bound!(&change.statement).execute(&mut *transaction).await?.rows_affected();
                    if change.exactly_one_row && rows != 1 {
                        transaction.rollback().await?;
                        return Err(Error::Database(format!(
                            "a row changed or was deleted by someone else ({rows} rows matched); nothing was committed"
                        )));
                    }
                    affected += rows;
                }
                transaction.commit().await?;
                affected
            }};
        }
        Ok(match self {
            Self::Postgres(pool) => transaction!(pool),
            Self::MySql(pool) => transaction!(pool),
            Self::Sqlite(pool) => transaction!(pool),
        })
    }

    /// Runs one statement outside the editor, such as a `TRUNCATE` or `DROP TABLE`.
    pub(crate) async fn execute(&self, statement: &Statement) -> Result<u64> {
        Ok(match self {
            Self::Postgres(pool) => bound!(statement).execute(pool).await?.rows_affected(),
            Self::MySql(pool) => bound!(statement).execute(pool).await?.rows_affected(),
            Self::Sqlite(pool) => bound!(statement).execute(pool).await?.rows_affected(),
        })
    }

    /// Inserts batches as the reader sends them, all in one transaction that commits only once the
    /// reader finished cleanly. When a batch fails, its rows are retried one by one to name the row
    /// the database refused; nothing is kept.
    pub(crate) async fn import(
        &self,
        clear: Option<&Statement>,
        mut batches: mpsc::Receiver<Batch>,
        reader: JoinHandle<Result<()>>,
        insert: impl Fn(&[Vec<Option<String>>]) -> Statement,
        progress: impl Fn(u64),
    ) -> Result<u64> {
        macro_rules! import {
            ($pool:expr) => {{
                let mut transaction = $pool.begin().await?;
                if let Some(clear) = clear {
                    bound!(clear).execute(&mut *transaction).await?;
                }
                let mut inserted = 0;
                while let Some(batch) = batches.recv().await {
                    let statement = insert(&batch.rows);
                    let mut savepoint = (&mut transaction).begin().await?;
                    if let Err(error) = bound!(&statement).execute(&mut *savepoint).await {
                        savepoint.rollback().await?;
                        for (row, values) in (batch.first_row..).zip(&batch.rows) {
                            let single = insert(std::slice::from_ref(values));
                            if let Err(error) = bound!(&single).execute(&mut *transaction).await {
                                return Err(at_rows(error, row, row));
                            }
                        }
                        let last = batch.first_row + batch.rows.len() as u64 - 1;
                        return Err(at_rows(error, batch.first_row, last));
                    }
                    savepoint.commit().await?;
                    inserted += batch.rows.len() as u64;
                    progress(inserted);
                }
                reader
                    .await
                    .map_err(|_| Error::Invalid("The file stopped being read.".into()))??;
                transaction.commit().await?;
                inserted
            }};
        }
        Ok(match self {
            Self::Postgres(pool) => import!(pool),
            Self::MySql(pool) => import!(pool),
            Self::Sqlite(pool) => import!(pool),
        })
    }

    /// Runs SQL typed in the editor. In read-only mode the database refuses writes: Postgres and
    /// MySQL run it in a read-only transaction, once they have parsed it as a single statement, so
    /// it can't end that transaction with a `COMMIT` before writing; SQLite runs it on a connection
    /// opened read-only. A MySQL stored procedure that commits part-way can still write.
    pub(crate) async fn run(&self, sql: &str, read_only: bool) -> Result<QueryResult> {
        let started = Instant::now();
        let mut result = match self {
            Self::Postgres(pool) => {
                let mut transaction =
                    pool.begin_with(if read_only { "BEGIN READ ONLY" } else { "BEGIN" }).await?;
                let parsed = if read_only {
                    let prepared = (&mut *transaction).prepare(editor_sql(sql)).await;
                    one_statement(prepared.map(drop))
                } else {
                    Ok(())
                };
                let outcome = match parsed {
                    Ok(()) => {
                        collect(
                            sqlx::raw_sql(editor_sql(sql)).fetch_many(&mut *transaction),
                            |row: &sqlx::postgres::PgRow| {
                                (0..row.len()).map(|index| decode::postgres(row, index)).collect()
                            },
                        )
                        .await
                    }
                    Err(error) => Err(error),
                };
                finish(transaction, outcome, read_only).await?
            }
            Self::MySql(pool) => {
                let mut transaction = pool
                    .begin_with(if read_only {
                        "START TRANSACTION READ ONLY"
                    } else {
                        "START TRANSACTION"
                    })
                    .await?;
                let parsed = if read_only {
                    let prepared = (&mut *transaction).prepare(editor_sql(sql)).await;
                    one_statement(prepared.map(drop))
                } else {
                    Ok(())
                };
                let outcome = match parsed {
                    Ok(()) => {
                        collect(
                            sqlx::raw_sql(editor_sql(sql)).fetch_many(&mut *transaction),
                            |row: &sqlx::mysql::MySqlRow| {
                                (0..row.len()).map(|index| decode::mysql(row, index)).collect()
                            },
                        )
                        .await
                    }
                    Err(error) => Err(error),
                };
                finish(transaction, outcome, read_only).await?
            }
            Self::Sqlite(pool) if read_only => {
                // Not `PRAGMA query_only`, which the SQL itself could turn off.
                let options = pool.connect_options().as_ref().clone().read_only(true);
                sqlite_run(&mut SqliteConnection::connect_with(&options).await?, sql).await?
            }
            Self::Sqlite(pool) => {
                let mut connection = pool.acquire().await?;
                let outcome = sqlite_run(&mut connection, sql).await;
                // The pool's connections serve the grid's edits too.
                sqlx::query("PRAGMA query_only = OFF").execute(&mut *connection).await?;
                outcome?
            }
        };
        result.elapsed_ms = elapsed_ms(started);
        Ok(result)
    }
}

async fn sqlite_run(connection: &mut SqliteConnection, sql: &str) -> Result<QueryResult> {
    collect(
        sqlx::raw_sql(editor_sql(sql)).fetch_many(connection),
        |row: &sqlx::sqlite::SqliteRow| {
            (0..row.len()).map(|index| decode::sqlite(row, index)).collect()
        },
    )
    .await
}

/// MySQL's number for a statement it parsed but can't prepare, such as `USE`.
const MYSQL_UNSUPPORTED_PREPARE: u16 = 1295;
const MYSQL_SYNTAX_ERROR: u16 = 1064;
const POSTGRES_SYNTAX_ERROR: &str = "42601";

/// Editor SQL, which the user typed to run as it is.
fn editor_sql(sql: &str) -> SqlStr {
    AssertSqlSafe(sql.to_owned()).into_sql_str()
}

/// Whether the database could prepare the SQL, which it refuses for more than one statement.
fn one_statement(prepared: std::result::Result<(), sqlx::Error>) -> Result<()> {
    let error = match prepared {
        Ok(()) => return Ok(()),
        Err(sqlx::Error::Database(error)) => error,
        Err(other) => return Err(other.into()),
    };
    let mysql = error.try_downcast_ref::<MySqlDatabaseError>().map(MySqlDatabaseError::number);
    if mysql == Some(MYSQL_UNSUPPORTED_PREPARE) {
        return Ok(());
    }
    let syntax =
        mysql == Some(MYSQL_SYNTAX_ERROR) || error.code().as_deref() == Some(POSTGRES_SYNTAX_ERROR);
    Err(if syntax {
        Error::Database(format!("{}. In safe mode, run one statement at a time.", error.message()))
    } else {
        Error::Database(error.message().to_owned())
    })
}

/// The database's refusal, with the rows of the file it was about.
fn at_rows(error: sqlx::Error, first: u64, last: u64) -> Error {
    let rows =
        if first == last { format!("row {first}") } else { format!("rows {first}–{last}") };
    match Error::from(error) {
        Error::Database(message) => Error::Database(format!("{message} ({rows} of the file)")),
        other => other,
    }
}

async fn finish<DB: sqlx::Database>(
    transaction: sqlx::Transaction<'_, DB>,
    outcome: Result<QueryResult>,
    read_only: bool,
) -> Result<QueryResult> {
    match outcome {
        Ok(result) if !read_only => {
            transaction.commit().await?;
            Ok(result)
        }
        Ok(result) => {
            transaction.rollback().await?;
            Ok(result)
        }
        Err(error) => {
            transaction.rollback().await?;
            Err(error)
        }
    }
}

/// Reads a multi-statement result: rows of the first result set that has any, up to the cap, and
/// the rows every statement affected.
async fn collect<R, A, S>(mut stream: S, read: impl Fn(&R) -> Vec<Value>) -> Result<QueryResult>
where
    R: Row,
    A: HasAffected,
    S: futures::Stream<Item = std::result::Result<Either<A, R>, sqlx::Error>> + Unpin,
{
    let mut result = QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        affected: None,
        truncated: false,
        elapsed_ms: 0.0,
    };
    while let Some(item) = stream.try_next().await? {
        match item {
            Either::Left(done) => *result.affected.get_or_insert(0) += done.affected(),
            Either::Right(row) => {
                if result.columns.is_empty() {
                    result.columns = decode::columns(&row);
                }
                if result.rows.len() < MAX_RESULT_ROWS {
                    result.rows.push(read(&row));
                } else {
                    result.truncated = true;
                }
            }
        }
    }
    if !result.rows.is_empty() {
        result.affected = None;
    }
    Ok(result)
}

/// The rows a statement changed, for each driver's own result type.
pub(crate) trait HasAffected {
    fn affected(&self) -> u64;
}

impl HasAffected for sqlx::postgres::PgQueryResult {
    fn affected(&self) -> u64 {
        self.rows_affected()
    }
}

impl HasAffected for sqlx::mysql::MySqlQueryResult {
    fn affected(&self) -> u64 {
        self.rows_affected()
    }
}

impl HasAffected for sqlx::sqlite::SqliteQueryResult {
    fn affected(&self) -> u64 {
        self.rows_affected()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::{Cell, ChangeSet, RowUpdate, statements};
    use crate::query::{Filter, FilterOp, RowsRequest, count_rows, select_rows};
    use crate::schema::TableRef;

    async fn notes() -> (tempfile::TempDir, SqlPool) {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("notes.db");
        let setup = SqlitePoolOptions::new()
            .connect_with(SqliteConnectOptions::new().filename(&file).create_if_missing(true))
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE folders (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE notes (id INTEGER PRIMARY KEY, folder_id INTEGER REFERENCES folders(id), title TEXT, body TEXT);
             CREATE INDEX notes_folder ON notes(folder_id);
             INSERT INTO folders VALUES (1, 'Work'), (2, 'Home');
             INSERT INTO notes VALUES (1, 1, 'Postgres tuning', NULL), (2, 1, '50% off', 'x'), (3, 2, 'Lisbon', 'trip');",
        )
        .execute(&setup)
        .await
        .unwrap();
        setup.close().await;
        let target = Target {
            engine: Engine::Sqlite,
            host: String::new(),
            port: None,
            user: None,
            password: None,
            database: None,
            file: Some(file.to_string_lossy().into_owned()),
            tls: false,
            ssh: None,
            ssh_secret: None,
        };
        let pool = SqlPool::connect(&target).await.unwrap();
        (folder, pool)
    }

    fn notes_table(schema: &[Namespace]) -> Table {
        schema[0].tables.iter().find(|table| table.name == "notes").unwrap().clone()
    }

    #[tokio::test]
    async fn reads_a_sqlite_schema() {
        let (_folder, pool) = notes().await;
        let schema = pool.schema().await.unwrap();
        assert_eq!(schema[0].name, "main");
        let notes = notes_table(&schema);
        assert_eq!(notes.row_estimate, Some(3));
        assert!(notes.column("id").unwrap().primary_key);
        let folder = notes.column("folder_id").unwrap();
        assert_eq!(folder.references.as_ref().map(|key| key.table.as_str()), Some("folders"));
        assert_eq!(notes.indexes[0].columns, ["folder_id"]);
        assert!(pool.version().await.unwrap().starts_with("SQLite 3."));
    }

    #[tokio::test]
    async fn filters_sorts_and_counts_in_sql() {
        let (_folder, pool) = notes().await;
        let notes = notes_table(&pool.schema().await.unwrap());
        let request = RowsRequest {
            table: TableRef { schema: None, name: "notes".into() },
            filters: vec![Filter {
                column: "title".into(),
                op: FilterOp::Contains,
                value: Some("%".into()),
            }],
            sort: None,
            limit: 10,
            offset: 0,
        };
        let rows = pool
            .rows(&notes, &select_rows(Dialect::Sqlite, &notes, &request).unwrap())
            .await
            .unwrap();
        assert_eq!(
            rows,
            vec![vec![
                Value::Number(2.0),
                Value::Number(1.0),
                Value::Text("50% off".into()),
                Value::Text("x".into())
            ]]
        );
        let count = count_rows(Dialect::Sqlite, &notes, &request.filters, 100).unwrap();
        assert_eq!(pool.count(&count).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn commits_changes_atomically() {
        let (_folder, pool) = notes().await;
        let notes = notes_table(&pool.schema().await.unwrap());
        let cell =
            |column: &str, value: &str| Cell { column: column.into(), value: Some(value.into()) };
        let good = ChangeSet {
            table: TableRef { schema: None, name: "notes".into() },
            updates: vec![RowUpdate {
                key: vec![cell("id", "1")],
                set: vec![cell("title", "Tuning")],
            }],
            inserts: vec![vec![cell("title", "New")]],
            deletes: vec![vec![cell("id", "3")]],
        };
        assert_eq!(
            pool.apply(&statements(Dialect::Sqlite, &notes, &good).unwrap()).await.unwrap(),
            3
        );

        let stale = ChangeSet {
            updates: vec![RowUpdate { key: vec![cell("id", "99")], set: vec![cell("title", "x")] }],
            inserts: Vec::new(),
            deletes: vec![vec![cell("id", "2")]],
            ..good
        };
        assert!(pool.apply(&statements(Dialect::Sqlite, &notes, &stale).unwrap()).await.is_err());
        let result = pool.run("SELECT id, title FROM notes ORDER BY id", true).await.unwrap();
        assert_eq!(result.rows.len(), 3, "the delete of row 2 rolled back with the stale update");
        assert_eq!(result.rows[0][1], Value::Text("Tuning".into()));
    }

    #[tokio::test]
    async fn safe_mode_blocks_writes_in_the_database() {
        let (_folder, pool) = notes().await;
        let error = pool.run("DELETE FROM notes", true).await.unwrap_err();
        assert!(error.to_string().to_lowercase().contains("readonly"), "{error}");
        let result = pool.run("UPDATE notes SET body = 'b' WHERE id = 1", false).await.unwrap();
        assert_eq!(result.affected, Some(1));
        assert_eq!(result.columns, Vec::new());
    }

    #[tokio::test]
    async fn safe_mode_cannot_be_switched_off_from_the_editor() {
        let (_folder, pool) = notes().await;
        assert!(pool.run("PRAGMA query_only = OFF; DELETE FROM notes", true).await.is_err());
        let count = pool.run("SELECT count(*) FROM notes", false).await.unwrap();
        assert_eq!(count.rows[0][0], Value::Number(3.0));
    }

    #[tokio::test]
    async fn safe_mode_runs_a_statement_with_a_semicolon_in_a_string() {
        let (_folder, pool) = notes().await;
        let result = pool.run("SELECT ';' AS semicolon", true).await.unwrap();
        assert_eq!(result.rows[0][0], Value::Text(";".into()));
    }

    #[tokio::test]
    async fn returns_typed_editor_results() {
        let (_folder, pool) = notes().await;
        let result = pool
            .run("SELECT 1 AS one, 2.5 AS half, 'a' AS text, NULL AS empty", false)
            .await
            .unwrap();
        assert_eq!(
            result.columns.iter().map(|column| column.name.as_str()).collect::<Vec<_>>(),
            ["one", "half", "text", "empty"]
        );
        assert_eq!(
            result.rows[0],
            vec![Value::Number(1.0), Value::Number(2.5), Value::Text("a".into()), Value::Null]
        );
    }
}
