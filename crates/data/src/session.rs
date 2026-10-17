//! One open connection, whatever its engine.

use tokio::sync::RwLock;

use crate::clickhouse::ClickHouse;
use crate::connection::Target;
use crate::dialect::Dialect;
use crate::engine::Engine;
use crate::error::{Error, Result};
use crate::mongo::Mongo;
use crate::query::{RowsRequest, count_rows, select_rows};
use crate::redis::Redis;
use crate::result::QueryResult;
use crate::schema::{Namespace, Table, TableRef};
use crate::sql::SqlPool;
use crate::value::Value;

/// The engines Containeria speaks, behind one set of operations.
#[derive(Debug, Clone)]
pub(crate) enum Driver {
    Sql(SqlPool),
    ClickHouse(Box<ClickHouse>),
    Mongo(Mongo),
    Redis(Redis),
}

#[derive(Debug)]
pub(crate) struct Session {
    pub(crate) engine: Engine,
    pub(crate) driver: Driver,
    pub(crate) version: String,
    schema: RwLock<Option<Vec<Namespace>>>,
}

/// Counting filtered rows stops here: past it the footer says "100,000+".
pub(crate) const COUNT_CAP: u32 = 100_000;

impl Session {
    pub(crate) async fn open(target: &Target) -> Result<Self> {
        let driver = match target.engine {
            Engine::Postgres | Engine::MySql | Engine::MariaDb | Engine::Sqlite => {
                Driver::Sql(SqlPool::connect(target).await?)
            }
            Engine::ClickHouse => Driver::ClickHouse(Box::new(ClickHouse::connect(target))),
            Engine::MongoDb => Driver::Mongo(Mongo::connect(target)?),
            Engine::Redis => Driver::Redis(Redis::connect(target).await?),
        };
        let version = match &driver {
            Driver::Sql(pool) => pool.version().await?,
            Driver::ClickHouse(client) => client.version().await?,
            Driver::Mongo(client) => client.version().await?,
            Driver::Redis(client) => client.version().await?,
        };
        Ok(Self { engine: target.engine, driver, version, schema: RwLock::new(None) })
    }

    pub(crate) fn dialect(&self) -> Option<Dialect> {
        Dialect::of(self.engine)
    }

    /// The schema, read once and kept until `refresh`.
    pub(crate) async fn schema(&self, refresh: bool) -> Result<Vec<Namespace>> {
        if !refresh && let Some(schema) = self.schema.read().await.as_ref() {
            return Ok(schema.clone());
        }
        let schema = match &self.driver {
            Driver::Sql(pool) => pool.schema().await?,
            Driver::ClickHouse(client) => client.schema().await?,
            Driver::Mongo(client) => client.schema().await?,
            Driver::Redis(_) => Vec::new(),
        };
        *self.schema.write().await = Some(schema.clone());
        Ok(schema)
    }

    pub(crate) async fn table(&self, reference: &TableRef) -> Result<Table> {
        self.schema(false)
            .await?
            .into_iter()
            .flat_map(|namespace| namespace.tables)
            .find(|table| reference.matches(table))
            .ok_or_else(|| {
                Error::Invalid(format!(
                    "there's no table named {}; refresh the schema to check",
                    reference.name
                ))
            })
    }

    pub(crate) async fn rows(
        &self,
        table: &Table,
        request: &RowsRequest,
    ) -> Result<Vec<Vec<Value>>> {
        match &self.driver {
            Driver::Sql(pool) => {
                pool.rows(table, &select_rows(pool.dialect(), table, request)?).await
            }
            Driver::ClickHouse(client) => {
                client.rows(&select_rows(Dialect::ClickHouse, table, request)?).await
            }
            Driver::Mongo(client) => client.rows(table, request).await,
            Driver::Redis(_) => Err(Error::Unsupported("Redis has keys, not tables".into())),
        }
    }

    /// Counts filtered rows up to the cap.
    pub(crate) async fn count(&self, table: &Table, request: &RowsRequest) -> Result<u64> {
        match &self.driver {
            Driver::Sql(pool) => {
                pool.count(&count_rows(pool.dialect(), table, &request.filters, COUNT_CAP + 1)?)
                    .await
            }
            Driver::ClickHouse(client) => {
                client
                    .count(&count_rows(
                        Dialect::ClickHouse,
                        table,
                        &request.filters,
                        COUNT_CAP + 1,
                    )?)
                    .await
            }
            Driver::Mongo(client) => client.count(table, &request.filters, COUNT_CAP + 1).await,
            Driver::Redis(_) => Ok(0),
        }
    }

    pub(crate) async fn run(&self, sql: &str, read_only: bool) -> Result<QueryResult> {
        match &self.driver {
            Driver::Sql(pool) => pool.run(sql, read_only).await,
            Driver::ClickHouse(client) => client.run(sql, read_only).await,
            Driver::Mongo(_) | Driver::Redis(_) => {
                Err(Error::Unsupported(format!("{:?} doesn't run SQL", self.engine)))
            }
        }
    }

    pub(crate) fn sql(&self) -> Result<&SqlPool> {
        match &self.driver {
            Driver::Sql(pool) => Ok(pool),
            _ => Err(Error::Unsupported("Only SQL databases can be edited from the grid.".into())),
        }
    }

    pub(crate) fn redis(&self) -> Result<&Redis> {
        match &self.driver {
            Driver::Redis(client) => Ok(client),
            _ => Err(Error::Unsupported("This isn't a Redis connection.".into())),
        }
    }

    pub(crate) async fn close(&self) {
        if let Driver::Sql(pool) = &self.driver {
            match pool {
                SqlPool::Postgres(pool) => pool.close().await,
                SqlPool::MySql(pool) => pool.close().await,
                SqlPool::Sqlite(pool) => pool.close().await,
            }
        }
    }
}
