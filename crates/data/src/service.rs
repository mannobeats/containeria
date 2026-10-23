use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
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
use crate::import::{self, ImportOptions, ImportPreview, ImportRequest, ImportedRows, Plan};
use crate::mongo;
use crate::query::{MAX_PAGE, RowsRequest, Sort, Statement};
use crate::redis::{RedisKeyPage, RedisValue};
use crate::result::{QueryResult, RowPage};
use crate::schema::{Namespace, Table, TableKind, TableRef};
use crate::session::{COUNT_CAP, Driver, Session};
use crate::tunnel::{self, HostKey, KnownHosts, SshAuth, SshTunnel};

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
fn read_only_reason(session: &Session, table: &Table, writes_blocked: bool) -> Option<String> {
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
        let saved = self.connections.get(&id).ok();
        let has_password = Self::keep_secret(
            &id,
            input.password.as_deref(),
            saved.as_ref().is_some_and(|saved| saved.has_password),
        )?;
        let ssh_secret = match &input.ssh {
            Some(ssh) if ssh.auth != SshAuth::Agent => input.ssh_secret.as_deref(),
            _ => Some(""),
        };
        let has_ssh_secret = Self::keep_secret(
            &Keychain::ssh(&id),
            ssh_secret,
            saved.as_ref().is_some_and(|saved| saved.has_ssh_secret),
        )?;
        let connection = input.into_connection(id, has_password, has_ssh_secret);
        self.connections.put(connection.clone())?;
        Ok(connection)
    }

    /// Saves, forgets or keeps one Keychain secret; `None` keeps what was there.
    fn keep_secret(account: &str, secret: Option<&str>, had: bool) -> Result<bool> {
        match secret {
            Some(secret) if !secret.is_empty() => {
                Keychain::save(account, secret)?;
                Ok(true)
            }
            Some(_) => {
                if had {
                    Keychain::forget(account)?;
                }
                Ok(false)
            }
            None => Ok(had),
        }
    }

    /// Forgets a connection, its password and any open session. The database isn't touched.
    ///
    /// # Errors
    /// Fails when the file or the Keychain can't be written.
    pub async fn remove(&self, id: &str) -> Result<()> {
        self.disconnect(id).await;
        Keychain::forget(id)?;
        Keychain::forget(&Keychain::ssh(id))?;
        self.connections.remove(id)
    }

    fn known_hosts(&self) -> KnownHosts {
        KnownHosts::new(&self.folder)
    }

    /// Dials the database the sheet describes without saving anything, through its SSH tunnel
    /// when it has one.
    ///
    /// # Errors
    /// Fails with `Error::Ssh`, `UnknownHostKey` or `HostKeyChanged` when the tunnel can't open,
    /// otherwise with the database's own message when it can't connect.
    pub async fn test(&self, input: ConnectionInput) -> Result<String> {
        input.validate()?;
        let saved = input.id.as_deref().filter(|id| !id.is_empty());
        let password = match (&input.password, saved) {
            (Some(password), _) => Some(password.clone()),
            (None, Some(id)) => Keychain::read(id).await?,
            (None, None) => None,
        };
        let ssh_secret = match (&input.ssh_secret, saved) {
            (Some(secret), _) => Some(secret.clone()),
            (None, Some(id)) if input.ssh.is_some() => Keychain::read(&Keychain::ssh(id)).await?,
            _ => None,
        };
        let connection = input.into_connection(String::new(), false, false);
        let target = Target::from_connection(&connection, password, ssh_secret);
        let session = Session::open(&target, self.known_hosts()).await?;
        let version = session.version.clone();
        session.close().await;
        Ok(version)
    }

    /// The host key an SSH server offers, for the user to compare before trusting it.
    ///
    /// # Errors
    /// Fails when the SSH server can't be reached.
    pub async fn ssh_host_key(&self, ssh: &SshTunnel) -> Result<HostKey> {
        tunnel::host_key(&ssh.clone().normalized(), self.known_hosts()).await
    }

    /// Trusts an SSH server's key in Containeria's own `known_hosts`; `~/.ssh` is never written.
    ///
    /// # Errors
    /// Fails when the key can't be parsed or the file can't be written.
    pub fn trust_host_key(&self, key: &HostKey) -> Result<()> {
        self.known_hosts().trust(key)
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
        let password = if connection.has_password { Keychain::read(id).await? } else { None };
        let ssh_secret = if connection.has_ssh_secret {
            Keychain::read(&Keychain::ssh(id)).await?
        } else {
            None
        };
        Ok(Target::from_connection(&connection, password, ssh_secret))
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
        let session = Arc::new(Session::open(&target, self.known_hosts()).await?);
        self.sessions.write().await.insert(id.to_owned(), Arc::clone(&session));
        self.info(id, &session)
    }

    pub async fn disconnect(&self, id: &str) {
        // Out of the map before closing: a pool waits for its running queries to close, and every
        // other call would wait on the lock meanwhile.
        let session = self.sessions.write().await.remove(id);
        if let Some(session) = session {
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
        if let Driver::Mongo(_) = &session.driver {
            return Ok(mongo::preview(&table, &mongo::changes(&table, changes)?));
        }
        let dialect = session
            .dialect()
            .ok_or_else(|| Error::Unsupported("This database isn't edited with SQL.".into()))?;
        Ok(changes::preview(dialect, &changes::statements(dialect, &table, changes)?))
    }

    /// Commits staged edits in one transaction. Refused in safe mode. MongoDB without a replica
    /// set has no transactions: its writes run in order and stop at the first that fails.
    ///
    /// # Errors
    /// Fails, changing nothing, when safe mode is on, a row moved, or the database refuses.
    pub async fn commit(&self, id: &str, changes: &ChangeSet) -> Result<u64> {
        let session = self.session(id).await?;
        self.guard_writes(id, &session)?;
        let table = session.table(&changes.table).await?;
        if let Driver::Mongo(client) = &session.driver {
            if let Some(reason) = changes::not_editable_because(&table) {
                return Err(Error::Unsupported(reason));
            }
            return client.apply(&table, &mongo::changes(&table, changes)?).await;
        }
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
        // The query already ran: failing it now could lead someone to run a write twice.
        if let Err(error) = self.history.record(entry) {
            tracing::warn!(%error, "a query ran but couldn't be added to the history");
        }
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
        // Pages without an order may overlap or skip rows, so they're read in key order.
        if page.sort.is_none() {
            page.sort = table
                .primary_key()
                .first()
                .map(|key| Sort { column: key.name.clone(), descending: false });
        }
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

    /// A table writes may change: safe mode is off and it isn't a view.
    async fn writable(&self, id: &str, reference: &TableRef) -> Result<(Arc<Session>, Table)> {
        let session = self.session(id).await?;
        self.guard_writes(id, &session)?;
        let table = session.table(reference).await?;
        if table.kind != TableKind::Table {
            return Err(Error::Unsupported(format!("{} is a view, not a table.", table.name)));
        }
        session.sql()?;
        Ok((session, table))
    }

    /// The columns and first rows of a CSV or JSON file, for matching them to a table's columns.
    ///
    /// # Errors
    /// Fails when the file can't be read or parsed.
    pub fn import_preview(&self, path: &Path, options: ImportOptions) -> Result<ImportPreview> {
        import::preview(path, options)
    }

    /// Imports a CSV or JSON file into a table in one transaction, streaming it in batches and
    /// calling `progress` after each. Refused in safe mode.
    ///
    /// # Errors
    /// Fails, changing nothing, when safe mode is on, the mapping doesn't fit the table, a row
    /// can't be parsed, or the database refuses a row; the message names the row.
    pub async fn import(
        &self,
        id: &str,
        request: &ImportRequest,
        progress: impl Fn(ImportedRows) + Sync,
    ) -> Result<u64> {
        let (session, table) = self.writable(id, &request.table).await?;
        let pool = session.sql()?;
        let plan = Plan::new(pool.dialect(), &table, &request.mapping)?;
        let path = PathBuf::from(&request.path);
        let bytes_total = std::fs::metadata(&path)?.len();
        let read = Arc::new(AtomicU64::new(0));
        let (sender, batches) = tokio::sync::mpsc::channel(2);
        let reader = tokio::task::spawn_blocking({
            let (options, sources, size, read) =
                (request.options, plan.sources.clone(), plan.batch_size(), Arc::clone(&read));
            move || import::read(&path, options, &sources, size, read, sender)
        });
        let clear = request.empty_first.then(|| plan.clear());
        pool.import(
            clear.as_ref(),
            batches,
            reader,
            |rows| plan.insert(rows),
            |rows| {
                let bytes_read = read.load(Ordering::Relaxed).min(bytes_total);
                progress(ImportedRows { rows, bytes_read, bytes_total });
            },
        )
        .await
    }

    /// Deletes every row of a table and returns the refreshed schema. Refused in safe mode.
    ///
    /// # Errors
    /// Fails when safe mode is on, it's a view, or the database refuses, such as a Postgres table
    /// other tables reference.
    pub async fn truncate(&self, id: &str, reference: &TableRef) -> Result<Vec<Namespace>> {
        let (session, table) = self.writable(id, reference).await?;
        let pool = session.sql()?;
        let target = pool.dialect().table(table.schema.as_deref(), &table.name);
        pool.execute(&Statement { sql: pool.dialect().truncate(&target), params: Vec::new() })
            .await?;
        session.schema(true).await
    }

    /// Drops a table and returns the refreshed schema. Refused in safe mode.
    ///
    /// # Errors
    /// Fails when safe mode is on, it's a view, or the database refuses.
    pub async fn drop_table(&self, id: &str, reference: &TableRef) -> Result<Vec<Namespace>> {
        let (session, table) = self.writable(id, reference).await?;
        let pool = session.sql()?;
        let target = pool.dialect().table(table.schema.as_deref(), &table.name);
        pool.execute(&Statement { sql: format!("DROP TABLE {target}"), params: Vec::new() })
            .await?;
        session.schema(true).await
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn returns_a_query_that_ran_even_when_the_history_cant_be_written() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("notes.db");
        std::fs::write(&file, b"").unwrap();
        let data = Data::new(folder.path());
        let connection = data
            .save(ConnectionInput {
                id: None,
                name: "notes".into(),
                engine: Engine::Sqlite,
                host: String::new(),
                port: None,
                user: None,
                database: None,
                file: Some(file.to_string_lossy().into_owned()),
                tls: false,
                environment: Environment::Local,
                password: None,
                ssh: None,
                ssh_secret: None,
            })
            .unwrap();
        data.connect(&connection.id, None).await.unwrap();
        std::fs::create_dir(folder.path().join("history.json")).unwrap();
        assert!(data.run(&connection.id, "SELECT 1").await.is_ok());
    }
}
