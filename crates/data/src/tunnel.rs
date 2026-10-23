//! SSH tunnels: a port on 127.0.0.1 forwarded through an SSH server to the database, so a driver
//! connects to the database as if it ran on the Mac. Host keys are checked against
//! `~/.ssh/known_hosts` and Containeria's own `known_hosts`; only the second is ever written.

use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::agent::AgentIdentity;
use russh::keys::agent::client::AgentClient;
use russh::keys::known_hosts::{check_known_hosts_path, learn_known_hosts_path};
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::task::{JoinHandle, JoinSet};

use crate::error::{Error, Result};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const KEEPALIVE: Duration = Duration::from_secs(30);

/// How Containeria proves who it is to the SSH server.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SshAuth {
    /// The keys loaded in ssh-agent, through `SSH_AUTH_SOCK`.
    #[default]
    Agent,
    /// A private key file; its passphrase, if any, is in the Keychain.
    Key,
    /// A password, kept in the Keychain.
    Password,
}

/// The SSH server a connection reaches its database through. The database host and port are
/// dialled from that server, so `localhost` there means the server itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnel {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
    /// The private key, for `SshAuth::Key`. A leading `~/` means the home folder.
    pub key_file: Option<String>,
}

/// An SSH server's host key, shown so the user can compare its fingerprint before trusting it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostKey {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    /// `SHA256:…`, as `ssh` prints it.
    pub fingerprint: String,
    /// The key in OpenSSH format; trusting sends it back unchanged.
    pub key: String,
}

impl SshTunnel {
    fn address(&self) -> String {
        if self.port == 22 { self.host.clone() } else { format!("{}:{}", self.host, self.port) }
    }

    /// # Errors
    /// Fails with a sentence naming the missing or wrong field.
    pub(crate) fn validate(&self) -> Result<()> {
        if self.host.trim().is_empty() {
            return Err(Error::Invalid("Enter the SSH host.".into()));
        }
        if self.host.contains(['/', ' ', '@']) {
            return Err(Error::Invalid(
                "Enter only the SSH host name, without a user or path.".into(),
            ));
        }
        if self.port == 0 {
            return Err(Error::Invalid("The SSH port is a number from 1 to 65535.".into()));
        }
        if self.user.trim().is_empty() {
            return Err(Error::Invalid("Enter the SSH user.".into()));
        }
        if self.auth == SshAuth::Key && self.key_file.as_deref().is_none_or(str::is_empty) {
            return Err(Error::Invalid("Choose the SSH private key file.".into()));
        }
        Ok(())
    }

    /// Trimmed, with the key file kept only when a key file is the way in.
    #[must_use]
    pub(crate) fn normalized(self) -> Self {
        Self {
            host: self.host.trim().to_owned(),
            user: self.user.trim().to_owned(),
            key_file: if self.auth == SshAuth::Key {
                self.key_file.map(|file| file.trim().to_owned())
            } else {
                None
            },
            ..self
        }
    }
}

/// What the known-hosts files say about a server's key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Trust {
    Known,
    Unknown,
    /// A different key of the same type was trusted before.
    Changed,
}

/// The user's `~/.ssh/known_hosts`, read only, and Containeria's own, where trusted keys go.
#[derive(Debug, Clone)]
pub(crate) struct KnownHosts {
    user: Option<PathBuf>,
    ours: PathBuf,
}

impl KnownHosts {
    #[must_use]
    pub(crate) fn new(folder: &Path) -> Self {
        Self {
            user: std::env::home_dir().map(|home| home.join(".ssh").join("known_hosts")),
            ours: folder.join("known_hosts"),
        }
    }

    #[cfg(test)]
    fn at(user: PathBuf, ours: PathBuf) -> Self {
        Self { user: Some(user), ours }
    }

    /// A changed key in either file wins over a match in the other: it may be an attack. Key
    /// comments don't count.
    pub(crate) fn check(&self, host: &str, port: u16, key: &PublicKey) -> Trust {
        let bare = PublicKey::from(key.key_data().clone());
        let mut trust = Trust::Unknown;
        for path in self.user.iter().chain([&self.ours]) {
            match check_known_hosts_path(host, port, &bare, path) {
                Ok(true) => trust = Trust::Known,
                Err(russh::keys::Error::KeyChanged { .. }) => return Trust::Changed,
                Ok(false) | Err(_) => {}
            }
        }
        trust
    }

    /// # Errors
    /// Fails when the key can't be parsed or Containeria's file can't be written.
    pub(crate) fn trust(&self, key: &HostKey) -> Result<()> {
        let public = PublicKey::from_openssh(&key.key)
            .map_err(|error| Error::Invalid(format!("that isn't an SSH public key: {error}")))?;
        let bare = PublicKey::from(public.key_data().clone());
        learn_known_hosts_path(&key.host, key.port, &bare, &self.ours)
            .map_err(|error| Error::Io(std::io::Error::other(error)))
    }
}

fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

/// Accepts the server only when its key is known, and remembers what it saw for the error.
struct Verifier {
    known: KnownHosts,
    host: String,
    port: u16,
    seen: Arc<Mutex<Option<(Trust, PublicKey)>>>,
}

impl client::Handler for Verifier {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        offered: &PublicKeyOrCertificate,
    ) -> std::result::Result<bool, Self::Error> {
        let key = match offered {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            PublicKeyOrCertificate::Certificate(certificate) => {
                PublicKey::from(certificate.public_key().clone())
            }
        };
        let trust = self.known.check(&self.host, self.port, &key);
        *self.seen.lock().unwrap_or_else(PoisonError::into_inner) = Some((trust, key));
        Ok(trust == Trust::Known)
    }
}

fn ssh_error(ssh: &SshTunnel, error: impl std::fmt::Display) -> Error {
    Error::Ssh(format!("SSH to {} failed: {error}", ssh.address()))
}

/// Connects and checks the host key. Also returns the key the server offered, whatever the outcome.
async fn handshake(
    ssh: &SshTunnel,
    known: KnownHosts,
) -> (Result<Handle<Verifier>>, Option<(Trust, PublicKey)>) {
    let seen = Arc::new(Mutex::new(None));
    let verifier =
        Verifier { known, host: ssh.host.clone(), port: ssh.port, seen: Arc::clone(&seen) };
    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(KEEPALIVE),
        nodelay: true,
        ..client::Config::default()
    });
    let connected = tokio::time::timeout(
        CONNECT_TIMEOUT,
        client::connect(config, (ssh.host.as_str(), ssh.port), verifier),
    )
    .await;
    let offered = seen.lock().unwrap_or_else(PoisonError::into_inner).take();
    let outcome = match connected {
        Ok(Ok(handle)) => Ok(handle),
        Err(_) => Err(ssh_error(ssh, "the server didn't answer within 10 seconds")),
        Ok(Err(error)) => Err(match &offered {
            Some((Trust::Unknown, key)) => {
                Error::UnknownHostKey { host: ssh.address(), fingerprint: fingerprint(key) }
            }
            Some((Trust::Changed, _)) => Error::HostKeyChanged(ssh.address()),
            _ => ssh_error(ssh, error),
        }),
    };
    (outcome, offered)
}

fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), std::env::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

fn load_key(ssh: &SshTunnel, passphrase: Option<&str>) -> Result<PrivateKey> {
    let file = ssh.key_file.as_deref().unwrap_or_default();
    let passphrase = passphrase.filter(|text| !text.is_empty());
    let key =
        russh::keys::load_secret_key(expand_home(file), passphrase).map_err(
            |error| match error {
                russh::keys::Error::KeyIsEncrypted => Error::Ssh(format!(
                    "{file} is protected by a passphrase; enter it to use the key"
                )),
                russh::keys::Error::IO(io) => {
                    Error::Ssh(format!("the key file {file} couldn't be read: {io}"))
                }
                other => Error::Ssh(format!("{file} couldn't be used as an SSH key: {other}")),
            },
        )?;
    if key.algorithm().is_rsa() {
        return Err(Error::Ssh(format!(
            "{file} is an RSA key, which Containeria doesn't sign with; add it to ssh-agent with ssh-add, or use an Ed25519 or ECDSA key"
        )));
    }
    Ok(key)
}

async fn agent_login(handle: &mut Handle<Verifier>, ssh: &SshTunnel) -> Result<bool> {
    let mut agent = AgentClient::connect_env().await.map_err(|error| {
        Error::Ssh(format!(
            "ssh-agent isn't reachable ({error}); start it and add your key with ssh-add, or choose a key file"
        ))
    })?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|error| Error::Ssh(format!("ssh-agent: {error}")))?;
    let hash = handle.best_supported_rsa_hash().await.map_err(|error| ssh_error(ssh, error))?;
    for identity in identities {
        let AgentIdentity::PublicKey { key, .. } = identity else {
            continue;
        };
        let outcome = handle
            .authenticate_publickey_with(&ssh.user, key, hash.flatten(), &mut agent)
            .await
            .map_err(|error| ssh_error(ssh, error))?;
        if outcome.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn login(handle: &mut Handle<Verifier>, ssh: &SshTunnel, secret: Option<&str>) -> Result<()> {
    let (accepted, way) = match ssh.auth {
        SshAuth::Password => {
            let outcome = handle
                .authenticate_password(&ssh.user, secret.unwrap_or_default())
                .await
                .map_err(|error| ssh_error(ssh, error))?;
            (outcome.success(), "that password")
        }
        SshAuth::Key => {
            let key = Arc::new(load_key(ssh, secret)?);
            let hash =
                handle.best_supported_rsa_hash().await.map_err(|error| ssh_error(ssh, error))?;
            let outcome = handle
                .authenticate_publickey(&ssh.user, PrivateKeyWithHashAlg::new(key, hash.flatten()))
                .await
                .map_err(|error| ssh_error(ssh, error))?;
            (outcome.success(), "that key")
        }
        SshAuth::Agent => (agent_login(handle, ssh).await?, "any key in ssh-agent"),
    };
    if accepted {
        Ok(())
    } else {
        Err(ssh_error(ssh, format!("the server didn't accept {} with {way}", ssh.user)))
    }
}

/// Reads the host key a server offers, so the user can decide whether to trust it.
///
/// # Errors
/// Fails when the server can't be reached or offers no key.
pub(crate) async fn host_key(ssh: &SshTunnel, known: KnownHosts) -> Result<HostKey> {
    ssh.validate()?;
    let (connected, offered) = handshake(ssh, known).await;
    if let Ok(handle) = connected {
        let _ = handle.disconnect(russh::Disconnect::ByApplication, "", "en").await;
    }
    let (_, key) = offered.ok_or_else(|| ssh_error(ssh, "the server didn't offer a host key"))?;
    Ok(HostKey {
        host: ssh.host.clone(),
        port: ssh.port,
        algorithm: key.algorithm().to_string(),
        fingerprint: fingerprint(&key),
        key: key.to_openssh().map_err(|error| ssh_error(ssh, error))?,
    })
}

/// A forwarded port, open for as long as the session it serves.
pub(crate) struct Tunnel {
    pub(crate) port: u16,
    forward: JoinHandle<()>,
}

impl std::fmt::Debug for Tunnel {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("Tunnel").field("port", &self.port).finish_non_exhaustive()
    }
}

impl Tunnel {
    /// Logs in to the SSH server, checks it can reach `host:port`, and forwards a local port there.
    ///
    /// # Errors
    /// Fails with `Error::Ssh`, `UnknownHostKey` or `HostKeyChanged`; never with a database error.
    pub(crate) async fn open(
        ssh: &SshTunnel,
        secret: Option<&str>,
        known: KnownHosts,
        host: &str,
        port: u16,
    ) -> Result<Self> {
        ssh.validate()?;
        let (connected, _) = handshake(ssh, known).await;
        let mut handle = connected?;
        login(&mut handle, ssh, secret).await?;
        let probe = handle
            .channel_open_direct_tcpip(host, u32::from(port), "127.0.0.1", 0)
            .await
            .map_err(|error| {
            ssh_error(ssh, format!("the server couldn't reach {host}:{port} ({error})"))
        })?;
        let _ = probe.close().await;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let local = listener.local_addr()?.port();
        let (host, handle) = (host.to_owned(), Arc::new(handle));
        let forward = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            while let Ok((mut socket, from)) = listener.accept().await {
                let (handle, host) = (Arc::clone(&handle), host.clone());
                connections.spawn(async move {
                    let opened = handle
                        .channel_open_direct_tcpip(
                            host,
                            u32::from(port),
                            from.ip().to_string(),
                            u32::from(from.port()),
                        )
                        .await;
                    match opened {
                        Ok(channel) => {
                            let mut stream = channel.into_stream();
                            let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
                        }
                        Err(error) => tracing::warn!(%error, "the SSH tunnel refused a connection"),
                    }
                });
            }
        });
        Ok(Self { port: local, forward })
    }

    /// Stops forwarding and drops every forwarded connection, which ends the SSH session.
    pub(crate) fn close(&self) {
        self.forward.abort();
    }
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.forward.abort();
    }
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    use super::*;

    const SERVER_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACAAJ6PA+SXEKvUXZkQHBv+0KnqAvF43tT95sB3OePbnSgAAAJitBE9jrQRP
YwAAAAtzc2gtZWQyNTUxOQAAACAAJ6PA+SXEKvUXZkQHBv+0KnqAvF43tT95sB3OePbnSg
AAAEBW2MblAHishBkwI+R9TkYwYl0+L5v/kzjfKW+Oq8eI0gAno8D5JcQq9RdmRAcG/7Qq
eoC8Xje1P3mwHc549udKAAAAEGNvbnRhaW5lcmlhLXRlc3QBAgMEBQ==
-----END OPENSSH PRIVATE KEY-----
";

    /// Passphrase `hunter2`.
    const CLIENT_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABCvsDTXM6
CGX+RSzXgMfhThAAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIJSE6O/7pzL2umqU
SONmAzZDWkGwZXds4ceLQ6xn2L0sAAAAkGkUjgfnZdHvdOnJri6aeGLWxo2a8EGM7UTrqT
sSoi4dF5ZvmeMxGPqga+1BKG8E7Mqam9Tf1CY1qhrd6TGO3aqSuOTNY18MF9iC7QckF7tB
A1tMuLLYKydZNfrP+hFHIKf7NOsgJN7ChlGtr4pQ/wPoWqaYOUa0Kp1vbSq1afmTCVjidv
tU9vPvn4dC7hswdA==
-----END OPENSSH PRIVATE KEY-----
";
    const CLIENT_PUBLIC: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJSE6O/7pzL2umqUSONmAzZDWkGwZXds4ceLQ6xn2L0s client";

    fn server_public() -> PublicKey {
        russh::keys::decode_secret_key(SERVER_KEY, None).unwrap().public_key().clone()
    }

    /// An SSH server that accepts `tunnel` with password `secret` or the client key, and forwards
    /// direct-tcpip channels.
    #[derive(Clone)]
    struct TestServer;

    impl russh::server::Handler for TestServer {
        type Error = russh::Error;

        async fn auth_password(
            &mut self,
            user: &str,
            password: &str,
        ) -> std::result::Result<russh::server::Auth, Self::Error> {
            Ok(if user == "tunnel" && password == "secret" {
                russh::server::Auth::Accept
            } else {
                russh::server::Auth::reject()
            })
        }

        async fn auth_publickey(
            &mut self,
            user: &str,
            key: &PublicKey,
        ) -> std::result::Result<russh::server::Auth, Self::Error> {
            let allowed = PublicKey::from_openssh(CLIENT_PUBLIC).unwrap();
            Ok(if user == "tunnel" && key.key_data() == allowed.key_data() {
                russh::server::Auth::Accept
            } else {
                russh::server::Auth::reject()
            })
        }

        async fn channel_open_direct_tcpip(
            &mut self,
            channel: russh::Channel<russh::server::Msg>,
            host: &str,
            port: u32,
            _originator: &str,
            _originator_port: u32,
            reply: russh::server::ChannelOpenHandle,
            _session: &mut russh::server::Session,
        ) -> std::result::Result<(), Self::Error> {
            let Ok(mut target) =
                TcpStream::connect((host, u16::try_from(port).unwrap_or_default())).await
            else {
                reply.reject(russh::ChannelOpenFailure::ConnectFailed).await;
                return Ok(());
            };
            reply.accept().await;
            tokio::spawn(async move {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut target, &mut stream).await;
            });
            Ok(())
        }
    }

    /// Starts the SSH server and an echo server behind it; returns their ports.
    async fn servers() -> (u16, u16) {
        let echo = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let echo_port = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = echo.accept().await {
                tokio::spawn(async move {
                    let (mut read, mut write) = socket.split();
                    let _ = tokio::io::copy(&mut read, &mut write).await;
                });
            }
        });
        let ssh = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let ssh_port = ssh.local_addr().unwrap().port();
        let config = Arc::new(russh::server::Config {
            keys: vec![russh::keys::decode_secret_key(SERVER_KEY, None).unwrap()],
            auth_rejection_time: Duration::from_millis(1),
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..russh::server::Config::default()
        });
        tokio::spawn(async move {
            while let Ok((socket, _)) = ssh.accept().await {
                let _ = russh::server::run_stream(Arc::clone(&config), socket, TestServer).await;
            }
        });
        (ssh_port, echo_port)
    }

    fn tunnel(port: u16, auth: SshAuth, key_file: Option<String>) -> SshTunnel {
        SshTunnel { host: "127.0.0.1".into(), port, user: "tunnel".into(), auth, key_file }
    }

    fn known(folder: &Path) -> KnownHosts {
        KnownHosts::at(folder.join("user_known_hosts"), folder.join("known_hosts"))
    }

    async fn echo_through(tunnel: &Tunnel) -> String {
        let mut socket = TcpStream::connect((Ipv4Addr::LOCALHOST, tunnel.port)).await.unwrap();
        socket.write_all(b"ping").await.unwrap();
        let mut reply = [0; 4];
        socket.read_exact(&mut reply).await.unwrap();
        String::from_utf8_lossy(&reply).into_owned()
    }

    #[test]
    fn checks_both_known_hosts_files_and_flags_a_changed_key() {
        let folder = tempfile::tempdir().unwrap();
        let hosts = known(folder.path());
        let key = server_public();
        assert_eq!(hosts.check("db.example.com", 22, &key), Trust::Unknown);
        let line = format!("db.example.com,10.0.0.5 {}\n", key.to_openssh().unwrap());
        std::fs::write(folder.path().join("user_known_hosts"), line).unwrap();
        assert_eq!(hosts.check("10.0.0.5", 22, &key), Trust::Known);
        assert_eq!(hosts.check("10.0.0.5", 2222, &key), Trust::Unknown);
        let other = russh::keys::decode_secret_key(CLIENT_KEY, Some("hunter2"))
            .unwrap()
            .public_key()
            .clone();
        assert_eq!(hosts.check("db.example.com", 22, &other), Trust::Changed);
    }

    #[test]
    fn trusts_into_its_own_file_only() {
        let folder = tempfile::tempdir().unwrap();
        let hosts = known(folder.path());
        let key = server_public();
        hosts
            .trust(&HostKey {
                host: "bastion".into(),
                port: 2222,
                algorithm: key.algorithm().to_string(),
                fingerprint: fingerprint(&key),
                key: key.to_openssh().unwrap(),
            })
            .unwrap();
        assert_eq!(hosts.check("bastion", 2222, &key), Trust::Known);
        assert!(!folder.path().join("user_known_hosts").exists());
        let saved = std::fs::read_to_string(folder.path().join("known_hosts")).unwrap();
        assert!(saved.trim_start().starts_with("[bastion]:2222 ssh-ed25519 "));
    }

    #[test]
    fn validates_and_normalizes_the_tunnel() {
        assert!(tunnel(22, SshAuth::Agent, None).validate().is_ok());
        assert!(tunnel(22, SshAuth::Key, None).validate().unwrap_err().to_string().contains("key"));
        let mut url = tunnel(22, SshAuth::Agent, None);
        url.host = "me@bastion".into();
        assert!(url.validate().is_err());
        let mut padded = tunnel(22, SshAuth::Password, Some("~/.ssh/id".into()));
        padded.host = " bastion ".into();
        let normalized = padded.normalized();
        assert_eq!(normalized.host, "bastion");
        assert_eq!(normalized.key_file, None);
        assert_eq!(tunnel(2222, SshAuth::Agent, None).address(), "127.0.0.1:2222");
    }

    #[tokio::test]
    async fn forwards_through_a_trusted_server() {
        let (ssh_port, echo_port) = servers().await;
        let folder = tempfile::tempdir().unwrap();
        let ssh = tunnel(ssh_port, SshAuth::Password, None);
        let unknown =
            Tunnel::open(&ssh, Some("secret"), known(folder.path()), "127.0.0.1", echo_port).await;
        let fingerprint_shown = match unknown {
            Err(Error::UnknownHostKey { fingerprint, .. }) => fingerprint,
            other => panic!("expected an unknown host key, got {other:?}"),
        };
        let key = host_key(&ssh, known(folder.path())).await.unwrap();
        assert_eq!(key.fingerprint, fingerprint_shown);
        assert_eq!(key.fingerprint, fingerprint(&server_public()));
        known(folder.path()).trust(&key).unwrap();

        let open = Tunnel::open(&ssh, Some("secret"), known(folder.path()), "127.0.0.1", echo_port)
            .await
            .unwrap();
        assert_eq!(echo_through(&open).await, "ping");
        open.close();

        let key_file = folder.path().join("id_ed25519");
        std::fs::write(&key_file, CLIENT_KEY).unwrap();
        let by_key = tunnel(ssh_port, SshAuth::Key, Some(key_file.to_string_lossy().into_owned()));
        let locked =
            Tunnel::open(&by_key, None, known(folder.path()), "127.0.0.1", echo_port).await;
        assert!(matches!(locked, Err(Error::Ssh(message)) if message.contains("passphrase")));
        let unlocked =
            Tunnel::open(&by_key, Some("hunter2"), known(folder.path()), "127.0.0.1", echo_port)
                .await
                .unwrap();
        assert_eq!(echo_through(&unlocked).await, "ping");
    }

    #[tokio::test]
    async fn tells_ssh_failures_apart() {
        let (ssh_port, echo_port) = servers().await;
        let folder = tempfile::tempdir().unwrap();
        let ssh = tunnel(ssh_port, SshAuth::Password, None);
        known(folder.path()).trust(&host_key(&ssh, known(folder.path())).await.unwrap()).unwrap();

        let refused =
            Tunnel::open(&ssh, Some("wrong"), known(folder.path()), "127.0.0.1", echo_port).await;
        assert!(matches!(refused, Err(Error::Ssh(message)) if message.contains("didn't accept")));

        let closed = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let closed_port = closed.local_addr().unwrap().port();
        drop(closed);
        let unreachable =
            Tunnel::open(&ssh, Some("secret"), known(folder.path()), "127.0.0.1", closed_port)
                .await;
        assert!(
            matches!(unreachable, Err(Error::Ssh(message)) if message.contains("couldn't reach"))
        );

        let changed = folder.path().join("changed");
        std::fs::create_dir(&changed).unwrap();
        let other = russh::keys::decode_secret_key(CLIENT_KEY, Some("hunter2")).unwrap();
        let line = format!("[127.0.0.1]:{ssh_port} {}\n", other.public_key().to_openssh().unwrap());
        std::fs::write(changed.join("user_known_hosts"), line).unwrap();
        let attacked =
            Tunnel::open(&ssh, Some("secret"), known(&changed), "127.0.0.1", echo_port).await;
        assert!(matches!(attacked, Err(Error::HostKeyChanged(_))));
    }
}
