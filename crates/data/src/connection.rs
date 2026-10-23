use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::engine::{Engine, Provider};
use crate::error::{Error, Result};
use crate::tunnel::SshTunnel;

/// Production connections open read-only until the user allows writes for a while.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Environment {
    #[default]
    Local,
    Staging,
    Production,
}

/// A saved connection. Its password lives in the Keychain, never here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub engine: Engine,
    pub provider: Option<Provider>,
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub database: Option<String>,
    /// The database file, for SQLite.
    pub file: Option<String>,
    pub tls: bool,
    pub environment: Environment,
    pub has_password: bool,
    /// Reached through this SSH server, when set.
    #[serde(default)]
    pub ssh: Option<SshTunnel>,
    /// The SSH password or key passphrase is in the Keychain.
    #[serde(default)]
    pub has_ssh_secret: bool,
}

/// What the connection sheet sends. `password: None` and `ssh_secret: None` keep the saved ones.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub id: Option<String>,
    pub name: String,
    pub engine: Engine,
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub database: Option<String>,
    pub file: Option<String>,
    pub tls: bool,
    pub environment: Environment,
    pub password: Option<String>,
    pub ssh: Option<SshTunnel>,
    /// The SSH password, or the key file's passphrase.
    pub ssh_secret: Option<String>,
}

impl ConnectionInput {
    /// Checks the fields an engine needs before anything is saved or dialled.
    ///
    /// # Errors
    /// Fails with a sentence naming the missing or wrong field.
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            return Err(Error::Invalid("Give the connection a name.".into()));
        }
        if self.engine == Engine::Sqlite {
            return match self.file.as_deref().map(str::trim) {
                Some(file) if !file.is_empty() => Ok(()),
                _ => Err(Error::Invalid("Choose the SQLite database file.".into())),
            };
        }
        if self.host.trim().is_empty() {
            return Err(Error::Invalid("Enter the host.".into()));
        }
        if self.host.contains(['/', ' ', '@']) {
            return Err(Error::Invalid(
                "Enter only the host name, without a scheme, user or path.".into(),
            ));
        }
        self.ssh.as_ref().map_or(Ok(()), SshTunnel::validate)
    }

    #[must_use]
    pub fn into_connection(
        self,
        id: String,
        has_password: bool,
        has_ssh_secret: bool,
    ) -> Connection {
        let ssh = self.ssh.filter(|_| self.engine != Engine::Sqlite).map(SshTunnel::normalized);
        let provider = Provider::from_host(&self.host);
        Connection {
            tls: self.tls || provider.is_some_and(Provider::requires_tls),
            id,
            name: self.name.trim().to_owned(),
            engine: self.engine,
            provider,
            host: self.host.trim().to_owned(),
            port: self.port.or_else(|| self.engine.default_port()),
            user: self.user.filter(|user| !user.is_empty()),
            database: self.database.filter(|database| !database.is_empty()),
            file: self.file,
            environment: self.environment,
            has_password,
            has_ssh_secret: has_ssh_secret && ssh.is_some(),
            ssh,
        }
    }
}

/// Everything needed to dial a database, password included. Never serialized.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Target {
    pub engine: Engine,
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    pub file: Option<String>,
    pub tls: bool,
    pub ssh: Option<SshTunnel>,
    pub ssh_secret: Option<String>,
}

impl std::fmt::Debug for Target {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Target")
            .field("engine", &self.engine)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("password", &self.password.as_ref().map(|_| "••••"))
            .field("database", &self.database)
            .field("ssh", &self.ssh)
            .finish_non_exhaustive()
    }
}

impl Target {
    #[must_use]
    pub(crate) fn from_connection(
        connection: &Connection,
        password: Option<String>,
        ssh_secret: Option<String>,
    ) -> Self {
        Self {
            engine: connection.engine,
            host: connection.host.clone(),
            port: connection.port,
            user: connection.user.clone(),
            password,
            database: connection.database.clone(),
            file: connection.file.clone(),
            tls: connection.tls,
            ssh: connection.ssh.clone(),
            ssh_secret,
        }
    }
}

/// Saved connections, as `connections.json` in Containeria's data folder.
#[derive(Debug, Clone)]
pub(crate) struct ConnectionStore {
    path: PathBuf,
}

impl ConnectionStore {
    #[must_use]
    pub(crate) fn new(folder: &Path) -> Self {
        Self { path: folder.join("connections.json") }
    }

    /// # Errors
    /// Fails when the file exists but can't be read.
    pub(crate) fn list(&self) -> Result<Vec<Connection>> {
        crate::files::read_json(&self.path)
    }

    /// # Errors
    /// Fails when the id is unknown.
    pub(crate) fn get(&self, id: &str) -> Result<Connection> {
        self.list()?
            .into_iter()
            .find(|connection| connection.id == id)
            .ok_or_else(|| Error::UnknownConnection(id.to_owned()))
    }

    /// Adds or replaces a connection by id.
    ///
    /// # Errors
    /// Fails when the file can't be written.
    pub(crate) fn put(&self, connection: Connection) -> Result<()> {
        crate::files::update_json(&self.path, |all: &mut Vec<Connection>| {
            match all.iter_mut().find(|saved| saved.id == connection.id) {
                Some(saved) => *saved = connection,
                None => all.push(connection),
            }
        })
    }

    /// # Errors
    /// Fails when the file can't be written.
    pub(crate) fn remove(&self, id: &str) -> Result<()> {
        crate::files::update_json(&self.path, |all: &mut Vec<Connection>| {
            all.retain(|connection| connection.id != id);
        })
    }
}

/// Passwords for saved connections, in the macOS Keychain.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Keychain;

impl Keychain {
    const SERVICE: &'static str = "dev.containeria.app.database";

    /// The Keychain account holding a connection's SSH password or key passphrase.
    #[must_use]
    pub(crate) fn ssh(id: &str) -> String {
        format!("{id}.ssh")
    }

    fn entry(id: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(Self::SERVICE, id).map_err(|error| Error::Keychain(error.to_string()))
    }

    /// # Errors
    /// Fails when the Keychain refuses the write.
    pub(crate) fn save(id: &str, password: &str) -> Result<()> {
        Self::entry(id)?.set_password(password).map_err(|error| Error::Keychain(error.to_string()))
    }

    /// The saved password, or `None` when there isn't one. Read on a blocking thread, as macOS may
    /// wait for the user to allow access.
    ///
    /// # Errors
    /// Fails when the Keychain can't be read.
    pub(crate) async fn read(id: &str) -> Result<Option<String>> {
        let id = id.to_owned();
        tokio::task::spawn_blocking(move || match Self::entry(&id)?.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(Error::Keychain(error.to_string())),
        })
        .await
        .map_err(|error| Error::Keychain(error.to_string()))?
    }

    /// # Errors
    /// Fails when the Keychain refuses the delete.
    pub(crate) fn forget(id: &str) -> Result<()> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(Error::Keychain(error.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ConnectionInput {
        ConnectionInput {
            id: None,
            name: " billing-prod ".into(),
            engine: Engine::Postgres,
            host: "ep-cool-river.eu-central-1.aws.neon.tech".into(),
            port: None,
            user: Some("neondb_owner".into()),
            database: Some(String::new()),
            file: None,
            tls: false,
            environment: Environment::Production,
            password: Some("secret".into()),
            ssh: None,
            ssh_secret: None,
        }
    }

    #[test]
    fn fills_defaults_and_forces_tls_for_hosted_services() {
        let connection = input().into_connection("billing".into(), true, false);
        assert_eq!(connection.name, "billing-prod");
        assert_eq!(connection.port, Some(5432));
        assert_eq!(connection.provider, Some(Provider::Neon));
        assert!(connection.tls);
        assert_eq!(connection.database, None);
    }

    #[test]
    fn validates_what_each_engine_needs() {
        assert!(input().validate().is_ok());
        let mut sqlite = input();
        sqlite.engine = Engine::Sqlite;
        assert!(sqlite.validate().unwrap_err().to_string().contains("SQLite"));
        let mut url = input();
        url.host = "postgres://user@host/db".into();
        assert!(url.validate().is_err());
    }

    #[test]
    fn never_prints_the_password() {
        let target = Target::from_connection(
            &input().into_connection("x".into(), true, false),
            Some("hunter2".into()),
            Some("opensesame".into()),
        );
        let printed = format!("{target:?}");
        assert!(!printed.contains("hunter2") && !printed.contains("opensesame"));
    }

    #[test]
    fn saves_replaces_and_removes_connections() {
        let folder = tempfile::tempdir().unwrap();
        let store = ConnectionStore::new(folder.path());
        assert!(store.list().unwrap().is_empty());
        store.put(input().into_connection("a".into(), false, false)).unwrap();
        let mut renamed = input().into_connection("a".into(), false, false);
        renamed.name = "renamed".into();
        store.put(renamed).unwrap();
        assert_eq!(store.get("a").unwrap().name, "renamed");
        store.remove("a").unwrap();
        assert!(matches!(store.get("a"), Err(Error::UnknownConnection(_))));
        let saved = std::fs::read_to_string(folder.path().join("connections.json")).unwrap();
        assert!(!saved.contains("secret"));
    }

    #[test]
    fn keeps_an_ssh_tunnel_for_server_engines_only() {
        let mut tunneled = input();
        tunneled.ssh = Some(SshTunnel {
            host: " bastion.example.com ".into(),
            port: 22,
            user: "deploy".into(),
            auth: crate::tunnel::SshAuth::Agent,
            key_file: Some("~/.ssh/id_ed25519".into()),
        });
        let connection = tunneled.clone().into_connection("a".into(), false, true);
        let ssh = connection.ssh.unwrap();
        assert_eq!((ssh.host.as_str(), ssh.key_file), ("bastion.example.com", None));
        assert!(connection.has_ssh_secret);
        tunneled.engine = Engine::Sqlite;
        assert_eq!(tunneled.into_connection("a".into(), false, true).ssh, None);
    }

    #[test]
    fn reads_connections_saved_before_ssh_tunnels() {
        let old = r#"{"id":"a","name":"a","engine":"postgres","provider":null,"host":"h","port":5432,"user":null,"database":null,"file":null,"tls":false,"environment":"local","hasPassword":false}"#;
        let connection: Connection = serde_json::from_str(old).unwrap();
        assert_eq!((connection.ssh, connection.has_ssh_secret), (None, false));
    }
}
