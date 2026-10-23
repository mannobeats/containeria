import type { ContainerDetails, EnvVar } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";

/** Values hidden until the user asks: anything that looks like a credential. */
export function isSecret(variable: EnvVar): boolean {
  return (
    /PASS|SECRET|TOKEN|KEY|CREDENTIAL|AUTH|PRIVATE/i.test(variable.key) ||
    /:\/\/[^/\s:@]+:[^@\s]+@/.test(variable.value)
  );
}

const DATABASES = new Set([
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "clickhouse",
  "mssql",
  "timescale",
]);

/** Databases get a shortcut into the data browser. */
export function isDatabase(details: Pick<ContainerDetails, "image">): boolean {
  const logo = logoFor(details.image);
  return logo !== undefined && DATABASES.has(logo);
}

/** A piece of `docker inspect` JSON to tint. `at` is its offset, a stable key for rendering. */
export type JsonToken = { kind: "key" | "string" | "number" | "plain"; text: string; at: number };

export function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const pattern = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/g;
  let last = 0;
  for (const match of json.matchAll(pattern)) {
    if (match.index > last) {
      tokens.push({ kind: "plain", text: json.slice(last, match.index), at: last });
    }
    if (match[1] !== undefined) {
      tokens.push({ kind: match[2] ? "key" : "string", text: match[1], at: match.index });
      if (match[2]) {
        tokens.push({ kind: "plain", text: match[2], at: match.index + match[1].length });
      }
    } else {
      tokens.push({ kind: "number", text: match[0], at: match.index });
    }
    last = match.index + match[0].length;
  }
  if (last < json.length) {
    tokens.push({ kind: "plain", text: json.slice(last), at: last });
  }
  return tokens;
}
