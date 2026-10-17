import type {
  Connection,
  ConnectionInput,
  Engine,
  Environment,
  Provider,
} from "@/lib/ipc/bindings";

import { defaultPort, ENGINE_CHOICES } from "./engines";

/** The connection sheet's fields, as typed. */
export type ConnectionForm = {
  id: string | null;
  name: string;
  engine: Engine;
  provider: Provider | null;
  host: string;
  port: string;
  user: string;
  password: string;
  /** For a saved connection, an untouched password keeps the one in the Keychain. */
  passwordChanged: boolean;
  database: string;
  file: string;
  tls: boolean;
  environment: Environment;
};

const DEFAULT_USERS: Record<Engine, string> = {
  postgres: "postgres",
  mysql: "root",
  mariadb: "root",
  clickhouse: "default",
  sqlite: "",
  mongodb: "",
  redis: "",
};

export function blankForm(choiceId: string): ConnectionForm {
  const choice = ENGINE_CHOICES.find((candidate) => candidate.id === choiceId) ?? ENGINE_CHOICES[0];
  const engine = choice?.engine ?? "postgres";
  return {
    id: null,
    name: "",
    engine,
    provider: choice?.provider ?? null,
    host: engine === "sqlite" ? "" : "localhost",
    port: String(defaultPort(engine) ?? ""),
    user: DEFAULT_USERS[engine],
    password: "",
    passwordChanged: true,
    database: "",
    file: "",
    tls: choice?.provider !== undefined,
    environment: "local",
  };
}

export function formFromConnection(connection: Connection): ConnectionForm {
  return {
    id: connection.id,
    name: connection.name,
    engine: connection.engine,
    provider: connection.provider,
    host: connection.host,
    port: connection.port === null ? "" : String(connection.port),
    user: connection.user ?? "",
    password: "",
    passwordChanged: false,
    database: connection.database ?? "",
    file: connection.file ?? "",
    tls: connection.tls,
    environment: connection.environment,
  };
}

const orNull = (text: string) => (text.trim() === "" ? null : text.trim());

export function toInput(form: ConnectionForm): ConnectionInput {
  return {
    id: form.id,
    name: form.name,
    engine: form.engine,
    host: form.engine === "sqlite" ? "" : form.host.trim(),
    port: form.port.trim() === "" ? null : Number(form.port),
    user: orNull(form.user),
    database: orNull(form.database),
    file: form.engine === "sqlite" ? orNull(form.file) : null,
    tls: form.tls,
    environment: form.environment,
    password: form.passwordChanged ? form.password : null,
  };
}

/** The sheet's own check before anything is sent: names the first missing field. */
export function formProblem(form: ConnectionForm): string | null {
  if (form.name.trim() === "") {
    return "Give the connection a name.";
  }
  if (form.engine === "sqlite") {
    return form.file.trim() === "" ? "Choose the SQLite database file." : null;
  }
  if (form.host.trim() === "") {
    return "Enter the host.";
  }
  if (form.port.trim() !== "" && !/^\d{1,5}$/.test(form.port.trim())) {
    return "The port is a number up to 65535.";
  }
  return null;
}
