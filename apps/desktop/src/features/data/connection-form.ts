import type {
  Connection,
  ConnectionInput,
  Engine,
  Environment,
  Provider,
  SshAuth,
  SshTunnel,
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
  /** Reach the database through an SSH server. */
  ssh: boolean;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  sshAuth: SshAuth;
  sshKeyFile: string;
  /** The SSH password or the key's passphrase. */
  sshSecret: string;
  /** Like `passwordChanged`, for the SSH secret. */
  sshSecretChanged: boolean;
};

const NO_SSH = {
  ssh: false,
  sshHost: "",
  sshPort: "22",
  sshUser: "",
  sshAuth: "agent",
  sshKeyFile: "",
  sshSecret: "",
  sshSecretChanged: true,
} as const;

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
    ...NO_SSH,
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
    passwordChanged: !connection.hasPassword,
    database: connection.database ?? "",
    file: connection.file ?? "",
    tls: connection.tls,
    environment: connection.environment,
    ...NO_SSH,
    ...(connection.ssh
      ? {
          ssh: true,
          sshHost: connection.ssh.host,
          sshPort: String(connection.ssh.port),
          sshUser: connection.ssh.user,
          sshAuth: connection.ssh.auth,
          sshKeyFile: connection.ssh.keyFile ?? "",
          sshSecretChanged: !connection.hasSshSecret,
        }
      : {}),
  };
}

/** The SSH tunnel the form describes, or `null` when it connects directly. */
export function sshTunnel(form: ConnectionForm): SshTunnel | null {
  if (!form.ssh || form.engine === "sqlite") {
    return null;
  }
  return {
    host: form.sshHost.trim(),
    port: Number(form.sshPort.trim() || "22"),
    user: form.sshUser.trim(),
    auth: form.sshAuth,
    keyFile: form.sshAuth === "key" ? orNull(form.sshKeyFile) : null,
  };
}

function orNull(text: string) {
  return text.trim() === "" ? null : text.trim();
}

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
    ssh: sshTunnel(form),
    sshSecret: form.sshSecretChanged && form.sshAuth !== "agent" ? form.sshSecret : null,
  };
}

const isPort = (text: string) => /^\d{1,5}$/.test(text.trim()) && Number(text) <= 65_535;

function sshProblem(form: ConnectionForm): string | null {
  if (form.sshHost.trim() === "") {
    return "Enter the SSH host.";
  }
  if (!isPort(form.sshPort)) {
    return "The SSH port is a number up to 65535.";
  }
  if (form.sshUser.trim() === "") {
    return "Enter the SSH user.";
  }
  if (form.sshAuth === "key" && form.sshKeyFile.trim() === "") {
    return "Choose the SSH private key file.";
  }
  return null;
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
  if (form.port.trim() !== "" && !isPort(form.port)) {
    return "The port is a number up to 65535.";
  }
  return form.ssh ? sshProblem(form) : null;
}
