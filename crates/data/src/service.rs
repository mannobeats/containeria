use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use containeria_docker::Docker;
use serde::Serialize;
use tokio::sync::RwLock;

use crate::changes::{self, ChangeSet};
use crate::connection::{
    Connection, ConnectionInput, ConnectionStore, Environment, Keychain, Target,
};
use crate::detect::{self, CONTAINER_PREFIX, Detected};
use crate::engine::{Capabilities, Engine, Provider};
use crate::error::{Error, Result};
use crate::export::{ExportFormat, Writer};
use crate::history::{HistoryEntry, HistoryStore, SavedQuery};
use crate::query::{MAX_PAGE, RowsRequest};
use crate::redis::{RedisKeyPage, RedisValue};
use crate::result::{QueryResult, RowPage};
use crate::schema::{Namespace, TableKind};
use crate::session::{COUNT_CAP, Session};

/// An open connection, as the workspace header and the safe-mode banner show it.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub id: String,
    pub name: String,
    pub engine: Engine,
    pub provider: Option<Provider>,
    pub version: String,
    pub capabilities: Capabilities,
    pub environment: Environment,
    /// Writes are blocked: a production connection in safe mode.
    pub read_only: bool,
    /// When writes were allowed for a while, when that ends.
    pub writable_until_ms: Option<f64>,
}

/// The database browser: connections, open sessions, history and safe mode.
#[derive(Debug)]
pub struct Data {
    folder: PathBuf,
    connections: ConnectionStore,
    history: HistoryStore,
    sessions: RwLock<HashMap<String, Arc<Session>>>,
    writable_until: Mutex<HashMap<String, SystemTime>>,
}

fn now_ms() -> f64 {
    ms(SystemTime::now())
}

fn ms(time: SystemTime) -> f64 {
    time.duration_since(UNIX_EPOCH).map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0)
}

/// What the grid stays able to edit, given the engine and the table.
fn read_only_reason(
    session: &Session,
    table: &crate::schema::Table,
    writes_blocked: bool,
) -> Option<String> {
    if !session.engine.capabilities().edit_rows {
        return Some(format!("Rows from {} are shown read-only.", session.version));
    }
    if table.kind == TableKind::View {
        return Some(format!("{} is a view.", table.name));
    }
    if writes_blocked {
        return Some("Safe mode is on for this production database.".into());
    }
    changes::not_editable_because(table)
}

impl Data {
    /// Keeps everything in `folder`, normally `~/.containeria/data`.
    #[must_use]
    pub fn new(folder: &Path) -> Self {
        Self {
            folder: folder.to_path_buf(),
            connections: ConnectionStore::new(folder),
            history: HistoryStore::new(folder),
            sessions: RwLock::new(HashMap::new()),
            writable_until: Mutex::new(HashMap::new()),
        }
    }

    #[must_use]
    pub fn folder(&self) -> &Path {
        &self.folder
    }

    /// # Errors
    /// Fails when the saved file can't be read.
    pub fn connections(&self) -> Result<Vec<Connection>> {
        self.connections.list()
    }

    /// Databases running in containers, with where their credentials come from.
    ///
    /// # Errors
    /// Fails when Docker can't be reached.
    pub async fn detected(&self, docker: &Docker) -> Result<Vec<Detected>> {
        let mut found = Vec::new();
        for container in docker.containers().await? {
            if container.pod.is_some() || detect::engine_for(&container).is_none() {
                continue;
            }
            let env = docker.container_env(&container.id).await.unwrap_or_default();
            found.extend(detect::detect(&container, &env));
        }
        Ok(found)
    }

    /// Saves a connection and its password.
    ///
    /// # Errors
    /// Fails when a field is missing or the Keychain refuses the password.
    pub fn save(&self, input: ConnectionInput) -> Result<Connection> {
        input.validate()?;
        let id = input
            .id
            .clone()
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let has_password = match &input.password {
            Some(password) if !password.is_empty() => {
                Keychain::save(&id, password)?;
                true
            }
            Some(_) => {
                Keychain::forget(&id)?;
                false
            }
            None => self.connections.get(&id).is_ok_and(|saved| saved.has_password),
        };
        let connection = input.into_connection(id, has_password);
        self.connections.put(connection.clone())?;
        Ok(connection)
    }

    /// Forgets a connection, its password and any open session. The database isn't touched.
    ///
    /// # Errors
    /// Fails when the file or the Keychain can't be written.
    pub async fn remove(&self, id: &str) -> Result<()> {
        self.disconnect(id).await;
        Keychain::forget(id)?;
        self.connections.remove(id)
    }

    /// Dials the database the sheet describes without saving anything.
    ///
    /// # Errors
    /// Fails with the database's own message when it can't connect.
    pub async fn test(&self, input: ConnectionInput) -> Result<String> {
        input.validate()?;
        let password = match (&input.password, &input.id) {
            (Some(password), _) => Some(password.clone()),
            (None, Some(id)) => Keychain::read(id)?,
            (None, None) => None,
        };
        let connection = input.into_connection(String::new(), false);
        let session = Session::open(&Target::from_connection(&connection, password)).await?;
        let version = session.version.clone();
        session.close().await;
        Ok(version)
    }

    async fn target(&self, id: &str, docker: Option<&Docker>) -> Result<Target> {
        if let Some(container) = id.strip_prefix(CONTAINER_PREFIX) {
            let docker = docker.ok_or_else(|| Error::NotConnected("the engine".into()))?;
            let detected = self
                .detected(docker)
                .await?
                .into_iter()
                .find(|found| found.container_name == container)
                .ok_or_else(|| Error::UnknownConnection(id.to_owned()))?;
            let env = docker.container_env(&detected.container_id).await?;
            return detect::target(&detected, &env).ok_or_else(|| {
                Error::Unsupported(format!("{container} doesn't publish its port to the Mac, so it can't be opened from here."))
            });
        }
        let connection = self.connections.get(id)?;
        let password = if connection.has_password { Keychain::read(id)? } else { None };
        Ok(Target::from_connection(&connection, password))
    }

    fn writes_blocked(&self, id: &str, environment: Environment) -> (bool, Option<f64>) {
        if environment != Environment::Production {
            return (false, None);
        }
        let until =
            self.writable_until.lock().unwrap_or_else(PoisonError::into_inner).get(id).copied();
        match until {
            Some(until) if until > SystemTime::now() => (false, Some(ms(until))),
            _ => (true, None),
        }
    }

    fn info(&self, id: &str, session: &Session) -> Result<ServerInfo> {
        let (name, environment, provider) =
            if let Some(container) = id.strip_prefix(CONTAINER_PREFIX) {
                (container.to_owned(), Environment::Local, None)
            } else {
                let connection = self.connections.get(id)?;
                (connection.name, connection.environment, connection.provider)
            };
        let (read_only, writable_until_ms) = self.writes_blocked(id, environment);
        Ok(ServerInfo {
            id: id.to_owned(),
            name,
            engine: session.engine,
            provider,
            version: session.version.clone(),
            capabilities: session.engine.capabilities(),
            environment,
            read_only,
            writable_until_ms,
        })
    }

    /// Opens a session, or returns the open one.
    ///
    /// # Errors
    /// Fails with the database's own message when it can't connect.
    pub async fn connect(&self, id: &str, docker: Option<&Docker>) -> Result<ServerInfo> {
        if let Some(session) = self.sessions.read().await.get(id).cloned() {
            return self.info(id, &session);
        }
        let target = self.target(id, docker).await?;
        let session = Arc::new(Session::open(&target).await?);
        self.sessions.write().await.insert(id.to_owned(), Arc::clone(&session));
        self.info(id, &session)
    }

    pub async fn disconnect(&self, id: &str) {
        if let Some(session) = self.sessions.write().await.remove(id) {
            session.close().await;
        }
        self.writable_until.lock().unwrap_or_else(PoisonError::into_inner).remove(id);
    }

    async fn session(&self, id: &str) -> Result<Arc<Session>> {
        self.sessions
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| Error::NotConnected(id.to_owned()))
    }

    /// # Errors
    /// Fails when not connected or the catalog can't be read.
    pub async fn schema(&self, id: &str, refresh: bool) -> Result<Vec<Namespace>> {
        self.session(id).await?.schema(refresh).await
    }

    /// One page of a table, with a total and whether it can be edited.
    ///
    /// # Errors
    /// Fails when the table or a filtered column doesn't exist, or the query fails.
    pub async fn rows(&self, id: &str, request: &RowsRequest) -> Result<RowPage> {
        let session = self.session(id).await?;
        let started = Instant::now();
        let table = session.table(&request.table).await?;
        let rows = session.rows(&table, request).await?;
        let (total, total_capped) = if request.filters.is_empty() {
            (table.row_estimate, false)
        } else {
            let count = session.count(&table, request).await?;
            (Some(count.min(u64::from(COUNT_CAP))), count > u64::from(COUNT_CAP))
        };
        let (blocked, _) = self.writes_blocked(id, self.info(id, &session)?.environment);
        Ok(RowPage {
            read_only_reason: read_only_reason(&session, &table, blocked),
            columns: table.columns,
            rows,
            total,
            total_capped,
            elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        })
    }

    fn guard_writes(&self, id: &str, session: &Session) -> Result<()> {
        let info = self.info(id, session)?;
        if info.read_only {
            return Err(Error::ReadOnly(info.name));
        }
        Ok(())
    }

    /// The SQL a commit would run, written out for review.
    ///
    /// # Errors
    /// Fails when the changes don't fit the table.
    pub async fn preview(&self, id: &str, changes: &ChangeSet) -> Result<String> {
        let session = self.session(id).await?;
        let table = session.table(&changes.table).await?;
        let dialect = session
            .dialect()
            .ok_or_else(|| Error::Unsupported("This database isn't edited with SQL.".into()))?;
        Ok(changes::preview(dialect, &changes::statements(dialect, &table, changes)?))
    }

    /// Commits staged edits in one transaction. Refused in safe mode.
    ///
    /// # Errors
    /// Fails, changing nothing, when safe mode is on, a row moved, or the database refuses.
    pub async fn commit(&self, id: &str, changes: &ChangeSet) -> Result<u64> {
        let session = self.session(id).await?;
        self.guard_writes(id, &session)?;
        let table = session.table(&changes.table).await?;
        let pool = session.sql()?;
        let affected = pool.apply(&changes::statements(pool.dialect(), &table, changes)?).await?;
        Ok(affected)
    }

    /// Runs SQL from the editor and records it in the history. In safe mode the database itself
    /// refuses writes.
    ///
    /// # Errors
    /// Fails with the database's message; the failure is recorded too.
    pub async fn run(&self, id: &str, sql: &str) -> Result<QueryResult> {
        let session = self.session(id).await?;
        let info = self.info(id, &session)?;
        let started = now_ms();
        let outcome = session.run(sql, info.read_only).await;
        let entry = HistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            connection_id: id.to_owned(),
            connection_name: info.name,
            sql: sql.trim().to_owned(),
            at_ms: started,
            elapsed_ms: now_ms() - started,
            rows: outcome
                .as_ref()
                .ok()
                .map(|result| u32::try_from(result.rows.len()).unwrap_or(u32::MAX)),
            error: outcome.as_ref().err().map(ToString::to_string),
        };
        self.history.record(entry)?;
        outcome
    }

    /// Lets a production connection write for `minutes`. Safe mode returns by itself.
    ///
    /// # Errors
    /// Fails when not connected.
    pub async fn allow_writes(&self, id: &str, minutes: u32) -> Result<ServerInfo> {
        let session = self.session(id).await?;
        let until = SystemTime::now() + Duration::from_secs(u64::from(minutes.min(60)) * 60);
        self.writable_until
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.to_owned(), until);
        self.info(id, &session)
    }

    /// # Errors
    /// Fails when not connected.
    pub async fn safe_mode(&self, id: &str) -> Result<ServerInfo> {
        let session = self.session(id).await?;
        self.writable_until.lock().unwrap_or_else(PoisonError::into_inner).remove(id);
        self.info(id, &session)
    }

    /// # Errors
    /// Fails when the file can't be read.
    pub fn history(&self) -> Result<Vec<HistoryEntry>> {
        self.history.history()
    }

    /// # Errors
    /// Fails when the file can't be read.
    pub fn saved_queries(&self) -> Result<Vec<SavedQuery>> {
        self.history.saved()
    }

    /// # Errors
    /// Fails when the file can't be written.
    pub fn save_query(&self, mut query: SavedQuery) -> Result<SavedQuery> {
        if query.name.trim().is_empty() {
            return Err(Error::Invalid("Give the query a name.".into()));
        }
        if query.id.is_empty() {
            query.id = uuid::Uuid::new_v4().to_string();
        }
        self.history.save(query.clone())?;
        Ok(query)
    }

    /// # Errors
    /// Fails when the file can't be written.
    pub fn delete_query(&self, id: &str) -> Result<()> {
        self.history.unsave(id)
    }

    /// Writes every row matching the request's filters to `path`, a page at a time.
    ///
    /// # Errors
    /// Fails when the file can't be written or a page can't be read.
    pub async fn export(
        &self,
        id: &str,
        request: &RowsRequest,
        format: ExportFormat,
        path: &Path,
    ) -> Result<u64> {
        let session = self.session(id).await?;
        let table = session.table(&request.table).await?;
        let dialect = session.dialect().unwrap_or(crate::dialect::Dialect::Postgres);
        let file = std::io::BufWriter::new(std::fs::File::create(path)?);
        let mut writer = Writer::new(file, format, dialect, &table)?;
        let mut page = RowsRequest { limit: MAX_PAGE, offset: 0, ..request.clone() };
        loop {
            let rows = session.rows(&table, &page).await?;
            writer.rows(&rows)?;
            if rows.len() < MAX_PAGE as usize {
                break;
            }
            page.offset += MAX_PAGE;
        }
        writer.finish()
    }

    /// # Errors
    /// Fails when not connected to Redis.
    pub async fn redis_keys(
        &self,
        id: &str,
        pattern: &str,
        cursor: Option<&str>,
    ) -> Result<RedisKeyPage> {
        self.session(id).await?.redis()?.keys(pattern, cursor).await
    }

    /// # Errors
    /// Fails when not connected to Redis.
    pub async fn redis_value(&self, id: &str, key: &str) -> Result<RedisValue> {
        self.session(id).await?.redis()?.value(key).await
    }

    /// # Errors
    /// Fails in safe mode or when not connected to Redis.
    pub async fn redis_set(&self, id: &str, key: &str, value: &str) -> Result<()> {
        let session = self.session(id).await?;
        self.guard_writes(id, &session)?;
        session.redis()?.set_text(key, value).await
    }

    /// # Errors
    /// Fails in safe mode or when not connected to Redis.
    pub async fn redis_delete(&self, id: &str, key: &str) -> Result<()> {
        let session = self.session(id).await?;
        self.guard_writes(id, &session)?;
        session.redis()?.delete(key).await
    }
}
