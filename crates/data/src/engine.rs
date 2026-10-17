use serde::{Deserialize, Serialize};

/// A database engine Containeria can open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Engine {
    Postgres,
    MySql,
    MariaDb,
    Sqlite,
    ClickHouse,
    MongoDb,
    Redis,
}

/// What the UI may offer for an engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[expect(clippy::struct_excessive_bools, reason = "independent capability flags")]
pub struct Capabilities {
    /// Runs SQL in the editor.
    pub sql: bool,
    /// Rows can be edited, added and deleted from the grid.
    pub edit_rows: bool,
    /// Has tables and columns to browse.
    pub tables: bool,
    /// A key-value store browsed by key.
    pub keys: bool,
}

impl Engine {
    #[must_use]
    pub const fn default_port(self) -> Option<u16> {
        match self {
            Self::Postgres => Some(5432),
            Self::MySql | Self::MariaDb => Some(3306),
            Self::ClickHouse => Some(8123),
            Self::MongoDb => Some(27017),
            Self::Redis => Some(6379),
            Self::Sqlite => None,
        }
    }

    #[must_use]
    pub const fn capabilities(self) -> Capabilities {
        match self {
            Self::Postgres | Self::MySql | Self::MariaDb | Self::Sqlite => {
                Capabilities { sql: true, edit_rows: true, tables: true, keys: false }
            }
            Self::ClickHouse => {
                Capabilities { sql: true, edit_rows: false, tables: true, keys: false }
            }
            Self::MongoDb => {
                Capabilities { sql: false, edit_rows: false, tables: true, keys: false }
            }
            Self::Redis => Capabilities { sql: false, edit_rows: false, tables: false, keys: true },
        }
    }

    #[must_use]
    pub const fn is_sql(self) -> bool {
        matches!(self, Self::Postgres | Self::MySql | Self::MariaDb | Self::Sqlite)
    }
}

/// A hosted service on top of an engine, for its logo and its defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    Neon,
    Supabase,
    Timescale,
    PlanetScale,
}

impl Provider {
    /// Recognises a hosted service from its host name.
    #[must_use]
    pub fn from_host(host: &str) -> Option<Self> {
        let host = host.to_ascii_lowercase();
        if host.ends_with(".neon.tech") {
            Some(Self::Neon)
        } else if host.ends_with(".supabase.co") || host.ends_with(".supabase.com") {
            Some(Self::Supabase)
        } else if host.ends_with(".tsdb.cloud.timescale.com") || host.ends_with(".timescale.com") {
            Some(Self::Timescale)
        } else if host.ends_with(".psdb.cloud") || host.contains("planetscale") {
            Some(Self::PlanetScale)
        } else {
            None
        }
    }

    /// Hosted databases only accept encrypted connections.
    #[must_use]
    pub const fn requires_tls(self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_hosted_services() {
        assert_eq!(
            Provider::from_host("ep-cool-river-123.eu-central-1.aws.neon.tech"),
            Some(Provider::Neon)
        );
        assert_eq!(Provider::from_host("db.abcd.supabase.co"), Some(Provider::Supabase));
        assert_eq!(Provider::from_host("aws-0-eu.pooler.supabase.com"), Some(Provider::Supabase));
        assert_eq!(Provider::from_host("aws.connect.psdb.cloud"), Some(Provider::PlanetScale));
        assert_eq!(Provider::from_host("localhost"), None);
    }

    #[test]
    fn only_sql_engines_edit_rows() {
        assert!(Engine::Postgres.capabilities().edit_rows);
        assert!(!Engine::ClickHouse.capabilities().edit_rows);
        assert!(Engine::Redis.capabilities().keys);
        assert_eq!(Engine::MariaDb.default_port(), Some(3306));
    }
}
