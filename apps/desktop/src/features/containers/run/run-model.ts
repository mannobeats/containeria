import type { ContainerSummary, Restart, RunSpec } from "@/lib/ipc/bindings";

/** Each editable row carries an `id` so React keeps its inputs while rows are added and removed. */
export type PortRow = { id: string; host: string; container: string };
export type EnvRow = { id: string; key: string; value: string };
export type StorageRow = { id: string; source: string; target: string; readOnly: boolean };

export const rowId = () => crypto.randomUUID();

/** What the sheet edits: strings, as typed, turned into a `RunSpec` on Run. */
export type RunForm = {
  image: string;
  name: string;
  ports: PortRow[];
  env: EnvRow[];
  storage: StorageRow[];
  restart: Restart;
  command: string;
  amd64: boolean;
};

export const emptyForm: RunForm = {
  image: "",
  name: "",
  ports: [],
  env: [],
  storage: [],
  restart: "unlessStopped",
  command: "",
  amd64: false,
};

/** Splits a command line like a shell would for quotes and spaces; no variables or globs. */
export function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (started) {
    args.push(current);
  }
  return args;
}

/** `ghcr.io/acme/api:v2` → `api-1`, the name Docker Desktop users expect. */
export function suggestedName(image: string): string {
  const base = image.trim().split("/").pop()?.split(/[:@]/)[0] ?? "";
  return base ? `${base.replace(/[^a-zA-Z0-9_.-]/g, "-")}-1` : "";
}

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export type FormErrors = { image?: string; name?: string; ports?: string };

/** Host ports already published by other containers. */
export function usedPorts(containers: ContainerSummary[]): Map<number, string> {
  const used = new Map<number, string>();
  for (const container of containers) {
    for (const port of container.ports) {
      if (port.host !== null) {
        used.set(port.host, container.name);
      }
    }
  }
  return used;
}

export function freePort(wanted: number, used: Map<number, string>): number {
  let port = wanted;
  while (used.has(port)) {
    port += 1;
  }
  return port;
}

export function validate(form: RunForm, used: Map<number, string>): FormErrors {
  const errors: FormErrors = {};
  if (!form.image.trim()) {
    errors.image = "Choose an image to run.";
  }
  if (form.name && !NAME.test(form.name)) {
    errors.name = "Use letters, numbers, dots, dashes and underscores.";
  }
  const taken = form.ports.find((port) => used.has(Number(port.host)));
  if (taken) {
    errors.ports = `Port ${taken.host} is in use by ${used.get(Number(taken.host))}.`;
  } else if (form.ports.some((port) => !(isPort(port.host) && isPort(port.container)))) {
    errors.ports = "Ports are numbers from 1 to 65535.";
  }
  return errors;
}

function isPort(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function toSpec(form: RunForm): RunSpec {
  const command = splitCommand(form.command);
  return {
    image: form.image.trim(),
    name: form.name.trim() || suggestedName(form.image) || null,
    ports: form.ports.map((port) => ({
      host: Number(port.host),
      container: Number(port.container),
      protocol: "tcp",
    })),
    env: form.env
      .filter((row) => row.key.trim())
      .map((row) => ({ key: row.key.trim(), value: row.value })),
    storage: form.storage
      .filter((row) => row.source.trim() && row.target.trim())
      .map((row) => ({
        source: row.source.trim(),
        target: row.target.trim(),
        readOnly: row.readOnly,
      })),
    restart: form.restart,
    command: command.length > 0 ? command : null,
    platform: form.amd64 ? "linux/amd64" : null,
  };
}

const RESTART_FLAG: Record<Restart, string> = {
  no: "no",
  onFailure: "on-failure",
  unlessStopped: "unless-stopped",
  always: "always",
};

const quote = (value: string) =>
  /^[\w./:=@%+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

/** The same container as a `docker run` command, for Copy. */
export function dockerRun(form: RunForm): string {
  const spec = toSpec(form);
  const parts = ["docker run -d"];
  if (spec.name) {
    parts.push(`--name ${quote(spec.name)}`);
  }
  if (spec.platform) {
    parts.push(`--platform ${spec.platform}`);
  }
  parts.push(`--restart ${RESTART_FLAG[spec.restart]}`);
  parts.push(...spec.ports.map((port) => `-p ${port.host}:${port.container}`));
  parts.push(...spec.env.map((row) => `-e ${quote(`${row.key}=${row.value}`)}`));
  parts.push(
    ...spec.storage.map(
      (row) => `-v ${quote(`${row.source}:${row.target}${row.readOnly ? ":ro" : ""}`)}`,
    ),
  );
  parts.push(quote(spec.image || "<image>"));
  parts.push(...(spec.command ?? []).map(quote));
  return parts.join(" ");
}
