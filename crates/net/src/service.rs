use std::fs;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError, RwLock};

use containeria_docker::ContainerSummary;
use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;
use tokio::task::JoinHandle;

use crate::ca::Authority;
use crate::error::{Error, Result};
use crate::host::{DEFAULT_TLD, normalize};
use crate::routes::{CustomRoute, DomainRoute, RouteTable};
use crate::system::{self, ResolverState};
use crate::{dns, proxy};

/// The DNS server's port. Fixed, because `/etc/resolver/<tld>` names it.
pub const DNS_PORT: u16 = 15353;
/// 80 and 443 when free, so URLs need no port; otherwise these fallbacks.
const HTTP_PORTS: [u16; 2] = [80, 7080];
const HTTPS_PORTS: [u16; 2] = [443, 7443];
/// Written while the servers run, so the `cx` tool can build URLs with the real ports.
const RUNNING_FILE: &str = "running.json";

/// The ports the app's DNS server and proxy use right now, or `None` when they aren't running.
#[must_use]
pub fn running_ports(dir: &Path) -> Option<DomainPorts> {
    let text = fs::read_to_string(dir.join(RUNNING_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

/// What the user chose, saved in `settings.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    enabled: bool,
    tld: String,
    https: bool,
    routes: Vec<CustomRoute>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { enabled: false, tld: DEFAULT_TLD.to_owned(), https: true, routes: Vec::new() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DomainPorts {
    pub dns: u16,
    pub http: u16,
    pub https: u16,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DomainsStatus {
    pub enabled: bool,
    pub tld: String,
    pub https: bool,
    /// Set while the DNS server and proxy run.
    pub ports: Option<DomainPorts>,
    pub resolver: ResolverState,
    pub ca_trusted: bool,
    pub routes: Vec<DomainRoute>,
}

struct Running {
    ports: DomainPorts,
    tasks: Vec<JoinHandle<()>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

/// Domains and HTTPS for containers: the DNS server, the proxy, the certificate authority and the
/// route table, under one folder (`~/.containeria/net`).
pub struct Domains {
    dir: PathBuf,
    settings: Mutex<Settings>,
    containers: Mutex<Vec<ContainerSummary>>,
    table: Arc<RwLock<RouteTable>>,
    running: tokio::sync::Mutex<Option<Running>>,
}

impl std::fmt::Debug for Domains {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("Domains").field("dir", &self.dir).finish_non_exhaustive()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Domains {
    /// Reads the saved settings from `dir`. Starts nothing.
    ///
    /// # Errors
    /// Fails when the settings file exists but can't be read.
    pub fn open(dir: &Path) -> Result<Self> {
        let settings = match fs::read_to_string(dir.join("settings.json")) {
            Ok(text) => serde_json::from_str(&text)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(error) => return Err(error.into()),
        };
        let domains = Self {
            dir: dir.to_path_buf(),
            settings: Mutex::new(settings),
            containers: Mutex::new(Vec::new()),
            table: Arc::new(RwLock::new(RouteTable::default())),
            running: tokio::sync::Mutex::new(None),
        };
        domains.rebuild();
        Ok(domains)
    }

    #[must_use]
    pub fn enabled(&self) -> bool {
        lock(&self.settings).enabled
    }

    fn save(&self, settings: &Settings) -> Result<()> {
        fs::create_dir_all(&self.dir)?;
        fs::write(self.dir.join("settings.json"), serde_json::to_string_pretty(settings)?)?;
        Ok(())
    }

    fn update(&self, change: impl FnOnce(&mut Settings) -> Result<()>) -> Result<()> {
        let mut settings = lock(&self.settings).clone();
        change(&mut settings)?;
        self.save(&settings)?;
        *lock(&self.settings) = settings;
        self.rebuild();
        Ok(())
    }

    fn rebuild(&self) {
        let settings = lock(&self.settings).clone();
        let table = RouteTable::build(
            &settings.tld,
            &lock(&self.containers),
            &settings.routes,
            settings.https,
        );
        *self.table.write().unwrap_or_else(PoisonError::into_inner) = table;
    }

    /// Replaces the containers routes are built from. Call it when Docker reports a change.
    pub fn set_containers(&self, containers: Vec<ContainerSummary>) {
        *lock(&self.containers) = containers;
        self.rebuild();
    }

    fn authority(&self) -> Result<Authority> {
        Authority::load_or_create(&self.dir)
    }

    pub async fn status(&self) -> DomainsStatus {
        let settings = lock(&self.settings).clone();
        let ports = self.running.lock().await.as_ref().map(|running| running.ports);
        let cert = self.dir.join("ca.pem");
        let ca_trusted = cert.exists() && system::is_trusted(&cert).await;
        let routes = self.table.read().unwrap_or_else(PoisonError::into_inner).routes().to_vec();
        DomainsStatus {
            resolver: system::resolver_state(&system::resolver_path(&settings.tld), DNS_PORT),
            enabled: settings.enabled,
            tld: settings.tld,
            https: settings.https,
            ports,
            ca_trusted,
            routes,
        }
    }

    /// Starts the DNS server and the proxy, if they aren't running.
    ///
    /// # Errors
    /// Fails when a port can't be bound or the certificate authority can't be created.
    pub async fn start(&self) -> Result<DomainPorts> {
        let mut running = self.running.lock().await;
        if let Some(running) = running.as_ref() {
            return Ok(running.ports);
        }
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, DNS_PORT)).await?;
        let http = proxy::bind_first(&HTTP_PORTS).await?;
        let https = proxy::bind_first(&HTTPS_PORTS).await?;
        let ports = DomainPorts {
            dns: DNS_PORT,
            http: http.local_addr()?.port(),
            https: https.local_addr()?.port(),
        };
        let tls = proxy::tls_config(Arc::new(self.authority()?), Arc::clone(&self.table))?;
        let tasks = vec![
            tokio::spawn(dns::serve(socket, Arc::clone(&self.table))),
            tokio::spawn(proxy::serve_http(http, Arc::clone(&self.table))),
            tokio::spawn(proxy::serve_https(https, Arc::clone(&self.table), tls)),
        ];
        fs::write(self.dir.join(RUNNING_FILE), serde_json::to_string(&ports)?)?;
        tracing::info!(?ports, "domains started");
        *running = Some(Running { ports, tasks });
        Ok(ports)
    }

    pub async fn stop(&self) {
        *self.running.lock().await = None;
        let _ = fs::remove_file(self.dir.join(RUNNING_FILE));
    }

    /// Turns domains on or off and starts or stops the servers to match.
    ///
    /// # Errors
    /// Fails when the setting can't be saved or the servers can't start.
    pub async fn set_enabled(&self, enabled: bool) -> Result<()> {
        self.update(|settings| {
            settings.enabled = enabled;
            Ok(())
        })?;
        if enabled {
            self.start().await.map(drop)
        } else {
            self.stop().await;
            Ok(())
        }
    }

    /// Adds a route, or replaces the one with the same host.
    ///
    /// # Errors
    /// Fails for an invalid host name or port, or when it can't be saved.
    pub fn add_route(&self, route: CustomRoute) -> Result<()> {
        let host = normalize(&route.host).ok_or_else(|| Error::InvalidHost(route.host.clone()))?;
        if route.port == 0 || route.container.trim().is_empty() {
            return Err(Error::InvalidHost(route.host));
        }
        let route = CustomRoute { host, ..route };
        self.update(|settings| {
            settings.routes.retain(|existing| existing.host != route.host);
            settings.routes.push(route);
            Ok(())
        })
    }

    /// # Errors
    /// Fails when there's no such route or it can't be saved.
    pub fn remove_route(&self, host: &str) -> Result<()> {
        self.update(|settings| {
            let before = settings.routes.len();
            settings.routes.retain(|route| route.host != host);
            if settings.routes.len() == before {
                return Err(Error::UnknownRoute(host.to_owned()));
            }
            Ok(())
        })
    }

    /// # Errors
    /// Fails when the user cancels the macOS prompt or the file can't be written.
    pub async fn install_resolver(&self) -> Result<()> {
        let tld = lock(&self.settings).tld.clone();
        system::install_resolver(&tld, DNS_PORT).await
    }

    /// # Errors
    /// Fails when the user cancels the macOS prompt or the file can't be removed.
    pub async fn uninstall_resolver(&self) -> Result<()> {
        let tld = lock(&self.settings).tld.clone();
        system::uninstall_resolver(&tld).await
    }

    /// # Errors
    /// Fails when the authority can't be created or the user cancels the Keychain prompt.
    pub async fn trust_ca(&self) -> Result<()> {
        let authority = self.authority()?;
        system::trust(authority.cert_path()).await
    }

    /// # Errors
    /// Fails when the user cancels the Keychain prompt.
    pub async fn untrust_ca(&self) -> Result<()> {
        system::untrust(&self.dir.join("ca.pem")).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_custom_routes_and_reads_them_back() {
        let dir = tempfile::tempdir().unwrap();
        let domains = Domains::open(dir.path()).unwrap();
        domains
            .add_route(CustomRoute {
                host: "Shop.Test".into(),
                container: "web".into(),
                port: 3000,
                https: true,
            })
            .unwrap();
        let reopened = Domains::open(dir.path()).unwrap();
        let routes = reopened.table.read().unwrap().routes().to_vec();
        assert_eq!(routes[0].host, "shop.test");
        reopened.remove_route("shop.test").unwrap();
        assert!(matches!(reopened.remove_route("shop.test"), Err(Error::UnknownRoute(_))));
    }

    #[test]
    fn refuses_a_route_with_an_invalid_host() {
        let dir = tempfile::tempdir().unwrap();
        let domains = Domains::open(dir.path()).unwrap();
        let route = CustomRoute {
            host: "not a host".into(),
            container: "web".into(),
            port: 80,
            https: false,
        };
        assert!(matches!(domains.add_route(route), Err(Error::InvalidHost(_))));
    }
}
