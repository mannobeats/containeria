import type { ComposeSource } from "@/lib/ipc/bindings";

/** What the editor holds: a file on the Mac, pasted YAML, or the file of a running project. */
export type ComposeDraft = {
  path: string | null;
  /** The file's text as it was read, to tell whether saving is needed. */
  saved: string;
  text: string;
  name: string;
  /** Set when editing a project that already runs; its name can't change. */
  project: string | null;
};

const EXAMPLE = `services:
  web:
    image: nginx:1.29
    ports:
      - "8080:80"
`;

const COMPOSE_FILE = /(^|\/)((docker-)?compose(\.[\w-]+)?|[\w.-]+\.compose)\.ya?ml$/i;

/** `compose.yaml`, `docker-compose.yml`, `compose.prod.yaml`, `shop.compose.yml`. */
export function isComposeFile(path: string): boolean {
  return COMPOSE_FILE.test(path);
}

/** Compose names: lowercase letters, digits, dashes and underscores, from a letter or digit. */
export function isProjectName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/.test(name);
}

/** The name Compose gives a project in this folder. */
export function projectNameFor(path: string): string {
  const folder = path.split("/").at(-2) ?? "";
  return folder
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[-_]+/, "");
}

export function newDraft(): ComposeDraft {
  return { path: null, saved: "", text: EXAMPLE, name: "", project: null };
}

export function fileDraft(path: string, text: string, project: string | null = null): ComposeDraft {
  return { path, saved: text, text, name: project ?? projectNameFor(path), project };
}

/** What to send: a file as is, a file with edits to save first, or pasted text. */
export function sourceOf(draft: ComposeDraft): ComposeSource {
  if (draft.path === null) {
    return { kind: "text", text: draft.text };
  }
  return { kind: "file", path: draft.path, text: draft.text === draft.saved ? null : draft.text };
}
