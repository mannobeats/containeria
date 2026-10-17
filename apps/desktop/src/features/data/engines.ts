import type { Engine, Provider } from "@/lib/ipc/bindings";
import { type LogoKey, logoFor } from "@/lib/logos";

/** A choice in the connection sheet: an engine, or a hosted service on one. */
export type EngineChoice = {
  id: string;
  label: string;
  engine: Engine;
  provider?: Provider;
  hint: string;
};

export const ENGINE_CHOICES: EngineChoice[] = [
  { id: "postgres", label: "PostgreSQL", engine: "postgres", hint: "Default port 5432" },
  { id: "mysql", label: "MySQL", engine: "mysql", hint: "Default port 3306" },
  { id: "mariadb", label: "MariaDB", engine: "mariadb", hint: "Default port 3306" },
  { id: "sqlite", label: "SQLite", engine: "sqlite", hint: "A database file on your Mac" },
  {
    id: "clickhouse",
    label: "ClickHouse",
    engine: "clickhouse",
    hint: "HTTP interface, default port 8123",
  },
  { id: "mongodb", label: "MongoDB", engine: "mongodb", hint: "Default port 27017" },
  { id: "redis", label: "Redis", engine: "redis", hint: "Default port 6379; Valkey works too" },
  {
    id: "neon",
    label: "Neon",
    engine: "postgres",
    provider: "neon",
    hint: "Serverless Postgres, always over TLS",
  },
  {
    id: "supabase",
    label: "Supabase",
    engine: "postgres",
    provider: "supabase",
    hint: "The project's Postgres, over TLS",
  },
  {
    id: "timescale",
    label: "Timescale",
    engine: "postgres",
    provider: "timescale",
    hint: "Postgres for time series, over TLS",
  },
  {
    id: "planetscale",
    label: "PlanetScale",
    engine: "mysql",
    provider: "planetscale",
    hint: "MySQL-compatible, over TLS",
  },
];

const LABELS: Record<Engine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  sqlite: "SQLite",
  clickhouse: "ClickHouse",
  mongodb: "MongoDB",
  redis: "Redis",
};

export function engineLabel(engine: Engine): string {
  return LABELS[engine];
}

export function engineLogo(engine: Engine, provider?: Provider | null): LogoKey | undefined {
  return logoFor(provider, engine);
}

export function defaultPort(engine: Engine): number | null {
  const ports: Record<Engine, number | null> = {
    postgres: 5432,
    mysql: 3306,
    mariadb: 3306,
    sqlite: null,
    clickhouse: 8123,
    mongodb: 27017,
    redis: 6379,
  };
  return ports[engine];
}
