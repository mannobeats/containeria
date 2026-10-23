//! Redis and Valkey: keys found with `SCAN`, values read by their type.

use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, ConnectionAddr, IntoConnectionInfo, RedisConnectionInfo};
use serde::Serialize;

use crate::connection::Target;
use crate::error::Result;
use crate::value::Value;

/// How many items of a long list, set or stream are read for display.
const PREVIEW: isize = 500;

#[derive(Clone)]
pub(crate) struct Redis {
    connection: MultiplexedConnection,
}

impl std::fmt::Debug for Redis {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("Redis").finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RedisKey {
    pub key: String,
    /// `string`, `hash`, `list`, `set`, `zset` or `stream`.
    pub kind: String,
    /// Seconds until it expires; `None` when it never does.
    #[specta(type = Option<specta_typescript::Number>)]
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyPage {
    pub keys: Vec<RedisKey>,
    /// Pass back to continue the scan; `None` when it reached the end.
    pub cursor: Option<String>,
}

/// A key's value, shaped for display: text, field pairs, or a list of members.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RedisValue {
    Text { value: String },
    Pairs { pairs: Vec<(String, Value)> },
    Items { items: Vec<String>, truncated: bool },
    Missing,
}

impl Redis {
    /// Through an SSH tunnel the driver dials 127.0.0.1, which the server's certificate never
    /// names; SSH has already checked the host and encrypts the hop, so the name check is skipped
    /// there only.
    fn address(target: &Target) -> ConnectionAddr {
        let (host, port) = (target.host.clone(), target.port.unwrap_or(6379));
        if target.tls {
            let insecure = target.ssh.is_some();
            ConnectionAddr::TcpTls { host, port, insecure, tls_params: None }
        } else {
            ConnectionAddr::Tcp(host, port)
        }
    }

    pub(crate) async fn connect(target: &Target) -> Result<Self> {
        let address = Self::address(target);
        let mut settings = RedisConnectionInfo::default();
        if let Some(user) = &target.user {
            settings = settings.set_username(user);
        }
        if let Some(password) = &target.password {
            settings = settings.set_password(password);
        }
        if let Some(database) =
            target.database.as_deref().and_then(|database| database.parse::<i64>().ok())
        {
            settings = settings.set_db(database);
        }
        let info = address.into_connection_info()?.set_redis_settings(settings);
        let connection = redis::Client::open(info)?.get_multiplexed_async_connection().await?;
        Ok(Self { connection })
    }

    pub(crate) async fn version(&self) -> Result<String> {
        let info: String =
            redis::cmd("INFO").arg("server").query_async(&mut self.connection.clone()).await?;
        let version =
            info.lines().find_map(|line| line.strip_prefix("redis_version:")).unwrap_or("").trim();
        let product = if info.contains("valkey_version") { "Valkey" } else { "Redis" };
        Ok(format!("{product} {version}"))
    }

    pub(crate) async fn keys(&self, pattern: &str, cursor: Option<&str>) -> Result<RedisKeyPage> {
        let mut connection = self.connection.clone();
        let (next, keys): (String, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor.unwrap_or("0"))
            .arg("MATCH")
            .arg(if pattern.is_empty() { "*" } else { pattern })
            .arg("COUNT")
            .arg(200)
            .query_async(&mut connection)
            .await?;
        let mut pipe = redis::pipe();
        for key in &keys {
            pipe.cmd("TYPE").arg(key).cmd("TTL").arg(key);
        }
        let details: Vec<redis::Value> =
            if keys.is_empty() { Vec::new() } else { pipe.query_async(&mut connection).await? };
        let keys = keys
            .into_iter()
            .zip(details.chunks(2))
            .map(|(key, detail)| {
                let kind = detail
                    .first()
                    .and_then(|value| redis::from_redis_value_ref::<String>(value).ok())
                    .unwrap_or_default();
                let ttl = detail
                    .get(1)
                    .and_then(|value| redis::from_redis_value_ref::<i64>(value).ok())
                    .filter(|ttl| *ttl >= 0);
                RedisKey { key, kind, ttl_seconds: ttl }
            })
            .collect();
        Ok(RedisKeyPage { keys, cursor: Some(next).filter(|next| next != "0") })
    }

    pub(crate) async fn value(&self, key: &str) -> Result<RedisValue> {
        let mut connection = self.connection.clone();
        let kind: String = redis::cmd("TYPE").arg(key).query_async(&mut connection).await?;
        Ok(match kind.as_str() {
            "string" => RedisValue::Text { value: connection.get(key).await? },
            "hash" => {
                let pairs: Vec<(String, String)> = connection.hgetall(key).await?;
                RedisValue::Pairs {
                    pairs: pairs
                        .into_iter()
                        .map(|(field, value)| (field, Value::Text(value)))
                        .collect(),
                }
            }
            "zset" => {
                let pairs: Vec<(String, f64)> =
                    connection.zrange_withscores(key, 0, PREVIEW - 1).await?;
                RedisValue::Pairs {
                    pairs: pairs
                        .into_iter()
                        .map(|(member, score)| (member, Value::float(score)))
                        .collect(),
                }
            }
            "list" => {
                let length: isize = connection.llen(key).await?;
                RedisValue::Items {
                    items: connection.lrange(key, 0, PREVIEW - 1).await?,
                    truncated: length > PREVIEW,
                }
            }
            "set" => {
                let mut items: Vec<String> = connection.smembers(key).await?;
                let truncated = items.len() > usize::try_from(PREVIEW).unwrap_or(usize::MAX);
                items.truncate(usize::try_from(PREVIEW).unwrap_or(usize::MAX));
                RedisValue::Items { items, truncated }
            }
            "stream" => {
                let entries: redis::Value = redis::cmd("XRANGE")
                    .arg(key)
                    .arg("-")
                    .arg("+")
                    .arg("COUNT")
                    .arg(PREVIEW)
                    .query_async(&mut connection)
                    .await?;
                RedisValue::Text { value: format!("{entries:?}") }
            }
            _ => RedisValue::Missing,
        })
    }

    pub(crate) async fn set_text(&self, key: &str, value: &str) -> Result<()> {
        let () = self.connection.clone().set(key, value).await?;
        Ok(())
    }

    pub(crate) async fn delete(&self, key: &str) -> Result<()> {
        let _: i64 = self.connection.clone().del(key).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Engine;

    #[test]
    fn dials_tls_targets_over_tls() {
        let mut target = Target {
            engine: Engine::Redis,
            host: "cache.example.com".into(),
            port: Some(6380),
            user: None,
            password: Some("secret".into()),
            database: None,
            file: None,
            tls: true,
            ssh: None,
            ssh_secret: None,
        };
        assert!(matches!(
            Redis::address(&target),
            ConnectionAddr::TcpTls { port: 6380, insecure: false, .. }
        ));
        target.tls = false;
        assert_eq!(Redis::address(&target), ConnectionAddr::Tcp("cache.example.com".into(), 6380));
    }

    #[test]
    fn checks_the_certificate_name_except_through_an_ssh_tunnel() {
        let mut target = Target {
            engine: Engine::Redis,
            host: "127.0.0.1".into(),
            port: Some(41234),
            user: None,
            password: None,
            database: None,
            file: None,
            tls: true,
            ssh: Some(crate::tunnel::SshTunnel {
                host: "bastion.example.com".into(),
                port: 22,
                user: "ada".into(),
                auth: crate::tunnel::SshAuth::Agent,
                key_file: None,
            }),
            ssh_secret: None,
        };
        assert!(matches!(Redis::address(&target), ConnectionAddr::TcpTls { insecure: true, .. }));
        target.ssh = None;
        assert!(matches!(Redis::address(&target), ConnectionAddr::TcpTls { insecure: false, .. }));
    }
}
