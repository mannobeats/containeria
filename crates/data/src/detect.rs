//! Finds databases running in containers and reads their credentials from the environment the
//! image was started with, the way each official image documents it.

use std::collections::HashMap;

use containeria_docker::{ContainerState, ContainerSummary};
use serde::Serialize;

use crate::connection::Target;
use crate::engine::Engine;

/// A database found in a container. The password stays in the container; this only says one exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    /// `container:<name>`, used like a saved connection's id.
    pub id: String,
    pub container_id: String,
    pub container_name: String,
    pub image: String,
    pub engine: Engine,
    pub running: bool,
    /// The port published on the Mac; `None` when the database is only reachable inside Docker.
    pub port: Option<u16>,
    pub user: Option<String>,
    pub database: Option<String>,
    /// The environment variable the password came from, shown as "from `POSTGRES_PASSWORD`".
    pub password_source: Option<String>,
}

pub(crate) const CONTAINER_PREFIX: &str = "container:";

/// Reads the engine from the image name: the last path segment, without its tag.
fn engine_of(image: &str) -> Option<Engine> {
    let name = image.rsplit('/').next()?.split([':', '@']).next()?.to_ascii_lowercase();
    let engines = [
        ("postgres", Engine::Postgres),
        ("postgis", Engine::Postgres),
        ("timescaledb", Engine::Postgres),
        ("pgvector", Engine::Postgres),
        ("mysql", Engine::MySql),
        ("percona", Engine::MySql),
        ("mariadb", Engine::MariaDb),
        ("redis", Engine::Redis),
        ("valkey", Engine::Redis),
        ("redis-stack", Engine::Redis),
        ("mongo", Engine::MongoDb),
        ("mongodb", Engine::MongoDb),
        ("clickhouse", Engine::ClickHouse),
        ("clickhouse-server", Engine::ClickHouse),
    ];
    engines
        .iter()
        .find(|(prefix, _)| name == *prefix || name.starts_with(&format!("{prefix}-")))
        .map(|(_, engine)| *engine)
}

fn first<'a>(env: &'a HashMap<String, String>, keys: &[&'a str]) -> Option<(&'a str, String)> {
    keys.iter().find_map(|key| {
        env.get(*key).filter(|value| !value.is_empty()).map(|value| (*key, value.clone()))
    })
}

struct Credentials {
    user: Option<String>,
    password: Option<(String, String)>,
    database: Option<String>,
}

fn credentials(engine: Engine, env: &HashMap<String, String>) -> Credentials {
    let pick = |keys: &[&str]| first(env, keys).map(|(_, value)| value);
    let secret = |keys: &[&str]| first(env, keys).map(|(key, value)| (key.to_owned(), value));
    match engine {
        Engine::Postgres => {
            let user = pick(&["POSTGRES_USER"]).unwrap_or_else(|| "postgres".into());
            Credentials {
                database: pick(&["POSTGRES_DB"]).or_else(|| Some(user.clone())),
                password: secret(&["POSTGRES_PASSWORD"]),
                user: Some(user),
            }
        }
        Engine::MySql | Engine::MariaDb => {
            match secret(&["MYSQL_ROOT_PASSWORD", "MARIADB_ROOT_PASSWORD"]) {
                Some(root) => Credentials {
                    user: Some("root".into()),
                    password: Some(root),
                    database: pick(&["MYSQL_DATABASE", "MARIADB_DATABASE"]),
                },
                None => Credentials {
                    user: pick(&["MYSQL_USER", "MARIADB_USER"]).or_else(|| Some("root".into())),
                    password: secret(&["MYSQL_PASSWORD", "MARIADB_PASSWORD"]),
                    database: pick(&["MYSQL_DATABASE", "MARIADB_DATABASE"]),
                },
            }
        }
        Engine::MongoDb => Credentials {
            user: pick(&["MONGO_INITDB_ROOT_USERNAME"]),
            password: secret(&["MONGO_INITDB_ROOT_PASSWORD"]),
            database: pick(&["MONGO_INITDB_DATABASE"]),
        },
        Engine::ClickHouse => Credentials {
            user: pick(&["CLICKHOUSE_USER"]).or_else(|| Some("default".into())),
            password: secret(&["CLICKHOUSE_PASSWORD"]),
            database: pick(&["CLICKHOUSE_DB"]),
        },
        Engine::Redis => Credentials {
            user: None,
            password: secret(&["REDIS_PASSWORD", "VALKEY_PASSWORD"]),
            database: None,
        },
        Engine::Sqlite => Credentials { user: None, password: None, database: None },
    }
}

/// The engine, if this container runs a database Containeria can open. Tools named after a
/// database (`redis-commander`, `postgres-exporter`) don't expose its port, so they don't match.
#[must_use]
pub(crate) fn engine_for(container: &ContainerSummary) -> Option<Engine> {
    let engine = engine_of(&container.image)?;
    let port = engine.default_port()?;
    container.ports.iter().any(|published| published.container == port).then_some(engine)
}

/// What a database container offers, from its summary and its environment.
#[must_use]
pub(crate) fn detect(
    container: &ContainerSummary,
    env: &HashMap<String, String>,
) -> Option<Detected> {
    let engine = engine_for(container)?;
    let default_port = engine.default_port()?;
    let credentials = credentials(engine, env);
    Some(Detected {
        id: format!("{CONTAINER_PREFIX}{}", container.name),
        container_id: container.id.clone(),
        container_name: container.name.clone(),
        image: container.image.clone(),
        engine,
        running: container.state == ContainerState::Running,
        port: container
            .ports
            .iter()
            .find(|published| published.container == default_port)
            .and_then(|published| published.host),
        user: credentials.user,
        database: credentials.database,
        password_source: credentials.password.map(|(key, _)| key),
    })
}

/// How to dial a detected database from the Mac, password included.
#[must_use]
pub(crate) fn target(detected: &Detected, env: &HashMap<String, String>) -> Option<Target> {
    let credentials = credentials(detected.engine, env);
    Some(Target {
        engine: detected.engine,
        host: "127.0.0.1".into(),
        port: Some(detected.port?),
        user: credentials.user,
        password: credentials.password.map(|(_, value)| value),
        database: credentials.database,
        file: None,
        tls: false,
        ssh: None,
        ssh_secret: None,
    })
}

#[cfg(test)]
mod tests {
    use containeria_docker::{Port, PortProtocol};

    use super::*;

    fn container(image: &str, ports: &[(u16, Option<u16>)]) -> ContainerSummary {
        ContainerSummary {
            id: "abc".into(),
            name: "shop-db-1".into(),
            image: image.into(),
            state: ContainerState::Running,
            status: "Up".into(),
            project: Some("shop".into()),
            service: Some("db".into()),
            pod: None,
            ports: ports
                .iter()
                .map(|&(container, host)| Port { container, host, protocol: PortProtocol::Tcp })
                .collect(),
            created_at: 0,
        }
    }

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(key, value)| ((*key).to_owned(), (*value).to_owned())).collect()
    }

    #[test]
    fn reads_postgres_credentials_and_its_published_port() {
        let found = detect(
            &container("postgres:18-alpine", &[(5432, Some(54325))]),
            &env(&[("POSTGRES_PASSWORD", "s3cret"), ("POSTGRES_USER", "shop")]),
        )
        .unwrap();
        assert_eq!(found.engine, Engine::Postgres);
        assert_eq!(found.port, Some(54325));
        assert_eq!(found.user.as_deref(), Some("shop"));
        assert_eq!(found.database.as_deref(), Some("shop"));
        assert_eq!(found.password_source.as_deref(), Some("POSTGRES_PASSWORD"));
        let json = serde_json::to_string(&found).unwrap();
        assert!(!json.contains("s3cret"));
        let dial =
            target(&found, &env(&[("POSTGRES_PASSWORD", "s3cret"), ("POSTGRES_USER", "shop")]))
                .unwrap();
        assert_eq!(dial.password.as_deref(), Some("s3cret"));
    }

    #[test]
    fn prefers_the_mysql_root_password() {
        let found = detect(
            &container("docker.io/library/mysql:8.4", &[(3306, Some(3306))]),
            &env(&[
                ("MYSQL_ROOT_PASSWORD", "r"),
                ("MYSQL_USER", "app"),
                ("MYSQL_DATABASE", "shop"),
            ]),
        )
        .unwrap();
        assert_eq!(found.user.as_deref(), Some("root"));
        assert_eq!(found.database.as_deref(), Some("shop"));
    }

    #[test]
    fn ignores_tools_that_only_look_like_databases() {
        assert!(
            engine_for(&container("rediscommander/redis-commander", &[(8081, Some(8081))]))
                .is_none()
        );
        assert!(
            engine_for(&container("prometheuscommunity/postgres-exporter", &[(9187, None)]))
                .is_none()
        );
        assert!(engine_for(&container("nginx", &[(80, Some(8080))])).is_none());
    }

    #[test]
    fn finds_unpublished_databases_but_cannot_dial_them() {
        let found = detect(&container("redis:7", &[(6379, None)]), &env(&[])).unwrap();
        assert_eq!(found.port, None);
        assert!(target(&found, &env(&[])).is_none());
    }

    #[test]
    fn recognises_images_by_their_last_path_segment() {
        assert_eq!(engine_of("ghcr.io/acme/postgres:16"), Some(Engine::Postgres));
        assert_eq!(engine_of("clickhouse/clickhouse-server:25.1"), Some(Engine::ClickHouse));
        assert_eq!(engine_of("valkey/valkey:8"), Some(Engine::Redis));
        assert_eq!(engine_of("mongo@sha256:abc"), Some(Engine::MongoDb));
    }
}
