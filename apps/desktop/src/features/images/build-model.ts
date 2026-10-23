/** `/Users/ada/My Shop` → `my-shop:latest`. */
export function defaultTag(context: string): string {
  const folder = context.split("/").filter(Boolean).at(-1) ?? "image";
  const name = folder
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return `${name || "image"}:latest`;
}

/** `KEY=value` per line; blank lines and comments are skipped. */
export function buildArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("=") && !line.startsWith("#"));
}

/** `ghcr.io/acme/api:1` → `ghcr.io`; a name without a registry host goes to Docker Hub. */
export function registryOf(reference: string): string {
  const first = reference.split("/")[0] ?? "";
  const isHost =
    reference.includes("/") &&
    (first.includes(".") || first.includes(":") || first === "localhost");
  return isHost ? first : "Docker Hub";
}

/** `Dockerfile`, `Dockerfile.dev`, `api.Dockerfile` and `api.dockerfile`. */
export function isDockerfile(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  return /^Dockerfile(\.[\w-]+)?$/.test(name) || /\.dockerfile$/i.test(name);
}
