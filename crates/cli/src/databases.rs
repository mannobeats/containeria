use containeria_docker::{ContainerState, ContainerSummary, PortProtocol};

/// A database Containeria found running in a container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Database {
    pub(crate) container: String,
    pub(crate) kind: &'static str,
    pub(crate) url: String,
}

/// Image keyword, kind shown to the user, URL scheme, default port inside the container.
const KINDS: [(&str, &str, &str, u16); 7] = [
    ("postgres", "PostgreSQL", "postgres", 5432),
    ("mariadb", "MariaDB", "mysql", 3306),
    ("mysql", "MySQL", "mysql", 3306),
    ("redis", "Redis", "redis", 6379),
    ("valkey", "Valkey", "redis", 6379),
    ("mongo", "MongoDB", "mongodb", 27017),
    ("clickhouse", "ClickHouse", "http", 8123),
];

/// Databases in running containers that publish their port to the Mac, with a URL to connect.
pub(crate) fn detect(containers: &[ContainerSummary]) -> Vec<Database> {
    containers
        .iter()
        .filter(|container| container.state == ContainerState::Running)
        .filter_map(|container| {
            let image = container.image.to_ascii_lowercase();
            let &(_, kind, scheme, inside) =
                KINDS.iter().find(|(keyword, ..)| image.contains(keyword))?;
            let host = container
                .ports
                .iter()
                .find(|port| port.container == inside && port.protocol == PortProtocol::Tcp)?
                .host?;
            Some(Database {
                container: container.name.clone(),
                kind,
                url: format!("{scheme}://localhost:{host}"),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use containeria_docker::Port;

    use super::*;

    fn container(name: &str, image: &str, ports: &[(u16, u16)]) -> ContainerSummary {
        ContainerSummary {
            id: name.to_owned(),
            name: name.to_owned(),
            image: image.to_owned(),
            state: ContainerState::Running,
            status: "Up".to_owned(),
            project: None,
            service: None,
            pod: None,
            ports: ports
                .iter()
                .map(|&(inside, outside)| Port {
                    container: inside,
                    host: Some(outside),
                    protocol: PortProtocol::Tcp,
                })
                .collect(),
            created_at: 0,
        }
    }

    #[test]
    fn finds_published_databases_by_image() {
        let found = detect(&[
            container("db", "postgres:18-alpine", &[(5432, 54325)]),
            container("cache", "redis:7", &[]),
            container("web", "nginx", &[(80, 8080)]),
            container("maria", "mariadb:11", &[(3306, 3307)]),
        ]);
        assert_eq!(
            found,
            [
                Database {
                    container: "db".into(),
                    kind: "PostgreSQL",
                    url: "postgres://localhost:54325".into()
                },
                Database {
                    container: "maria".into(),
                    kind: "MariaDB",
                    url: "mysql://localhost:3307".into()
                },
            ]
        );
    }
}
