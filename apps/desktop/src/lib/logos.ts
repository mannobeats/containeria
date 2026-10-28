const files = import.meta.glob<string>("../assets/logos/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const TITLES = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  sqlite: "SQLite",
  clickhouse: "ClickHouse",
  mssql: "SQL Server",
  mongodb: "MongoDB",
  redis: "Redis",
  dynamodb: "DynamoDB",
  supabase: "Supabase",
  neon: "Neon",
  turso: "Turso",
  planetscale: "PlanetScale",
  timescale: "Timescale",
  elasticsearch: "Elasticsearch",
  kafka: "Apache Kafka",
  rabbitmq: "RabbitMQ",
  keycloak: "Keycloak",
  grafana: "Grafana",
  prometheus: "Prometheus",
  minio: "MinIO",
  stripe: "Stripe",
  nginx: "NGINX",
  traefik: "Traefik",
  caddy: "Caddy",
  ollama: "Ollama",
  n8n: "n8n",
  vault: "Vault",
  python: "Python",
  nodejs: "Node.js",
  go: "Go",
  rust: "Rust",
  bun: "Bun",
  deno: "Deno",
  php: "PHP",
  ruby: "Ruby",
  java: "Java",
  ubuntu: "Ubuntu",
  debian: "Debian",
  fedora: "Fedora",
  archlinux: "Arch Linux",
  alpine: "Alpine Linux",
  nixos: "NixOS",
  opensuse: "openSUSE",
  rockylinux: "Rocky Linux",
  kali: "Kali Linux",
  kubernetes: "Kubernetes",
  docker: "Docker",
  k3s: "K3s",
  helm: "Helm",
} as const;

export type LogoKey = keyof typeof TITLES;

/** Marks whose original artwork is near-black ship a light variant for dark mode. */
const HAS_DARK_VARIANT = new Set<LogoKey>([
  "alpine",
  "clickhouse",
  "debian",
  "deno",
  "docker",
  "dynamodb",
  "elasticsearch",
  "fedora",
  "go",
  "helm",
  "k3s",
  "kafka",
  "keycloak",
  "mariadb",
  "mysql",
  "ollama",
  "php",
  "planetscale",
  "redis",
  "ruby",
  "rust",
  "sqlite",
  "turso",
  "vault",
]);

/** Keyword to logo, most specific first: `postgis` must win over `postgres`, `neon` over both. */
const RULES: [string, LogoKey][] = [
  ["neon", "neon"],
  ["supabase", "supabase"],
  ["turso", "turso"],
  ["planetscale", "planetscale"],
  ["timescale", "timescale"],
  ["postgis", "postgresql"],
  ["postgres", "postgresql"],
  ["mariadb", "mariadb"],
  ["mysql", "mysql"],
  ["sqlite", "sqlite"],
  ["libsql", "turso"],
  ["clickhouse", "clickhouse"],
  ["mssql", "mssql"],
  ["sql server", "mssql"],
  ["sqlserver", "mssql"],
  ["mongo", "mongodb"],
  ["redis", "redis"],
  ["valkey", "redis"],
  ["dynamo", "dynamodb"],
  ["elastic", "elasticsearch"],
  ["kafka", "kafka"],
  ["rabbitmq", "rabbitmq"],
  ["keycloak", "keycloak"],
  ["grafana", "grafana"],
  ["prometheus", "prometheus"],
  ["minio", "minio"],
  ["stripe", "stripe"],
  ["nginx", "nginx"],
  ["traefik", "traefik"],
  ["caddy", "caddy"],
  ["ollama", "ollama"],
  ["n8n", "n8n"],
  ["vault", "vault"],
  ["python", "python"],
  ["node", "nodejs"],
  ["golang", "go"],
  ["rust", "rust"],
  ["oven/bun", "bun"],
  ["denoland", "deno"],
  ["php", "php"],
  ["ruby", "ruby"],
  ["openjdk", "java"],
  ["eclipse-temurin", "java"],
  ["ubuntu", "ubuntu"],
  ["debian", "debian"],
  ["fedora", "fedora"],
  ["arch", "archlinux"],
  ["nixos", "nixos"],
  ["opensuse", "opensuse"],
  ["suse", "opensuse"],
  ["rocky", "rockylinux"],
  ["kali", "kali"],
  ["alpine", "alpine"],
  ["kubernetes", "kubernetes"],
  ["k3s", "k3s"],
  ["helm", "helm"],
  ["docker", "docker"],
];

/** Whether `keyword` begins a word of `subject`: `arch` begins `archlinux` but not `opensearch`. */
function startsWord(subject: string, keyword: string): boolean {
  for (let at = subject.indexOf(keyword); at !== -1; at = subject.indexOf(keyword, at + 1)) {
    if (!/[a-z0-9]/.test(subject.charAt(at - 1))) {
      return true;
    }
  }
  return false;
}

const EXACT: Record<string, LogoKey> = {
  go: "go",
  pg: "postgresql",
  postgres: "postgresql",
  bun: "bun",
  deno: "deno",
};

/** The logo for an image reference, a database kind or a distro, from the first hint that matches. */
export function logoFor(...hints: (string | null | undefined)[]): LogoKey | undefined {
  for (const hint of hints) {
    if (!hint) {
      continue;
    }
    const subject = hint
      .toLowerCase()
      .replace(/@.*$/, "")
      .replace(/:[^/:]*$/, "")
      .replace(/^docker\.io\/(library\/)?/, "");
    const exact = EXACT[subject];
    if (exact) {
      return exact;
    }
    const rule = RULES.find(([keyword]) => startsWord(subject, keyword));
    if (rule) {
      return rule[1];
    }
  }
  return undefined;
}

export function logoTitle(key: LogoKey): string {
  return TITLES[key];
}

export function logoUrl(key: LogoKey, dark: boolean): string {
  const name = dark && HAS_DARK_VARIANT.has(key) ? `${key}-dark` : key;
  return files[`../assets/logos/${name}.svg`] ?? "";
}
