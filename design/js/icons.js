// Containeria's own icons for its own objects. 24px grid, 1.5px stroke, round joins, one duotone layer.
// `.f` is the soft fill (the object's body), `.a` the accent (the part that's alive: an edited cell, a running prompt).
const CX_ICONS = {
  // a shipping container in three-quarter view, lit from the top
  container: '<path class="f" d="M3 8.5 6.5 5h14.5L17.5 8.5z"/><path d="M3 8.5 6.5 5h14.5L17.5 8.5zM3 8.5h14.5V19H3zM17.5 8.5 21 5v10.5L17.5 19"/><path d="M6.6 11v5.5M10.25 11v5.5M13.9 11v5.5"/>',
  // an image is the blueprint a container is made from: a sheet with the container's ribs and a folded corner
  image: '<path d="M14.5 3H6.75A1.75 1.75 0 0 0 5 4.75v14.5c0 .97.78 1.75 1.75 1.75h10.5c.97 0 1.75-.78 1.75-1.75V7.5z"/><path class="f" d="M14.5 3v3.25c0 .69.56 1.25 1.25 1.25H19z"/><path d="M14.5 3v3.25c0 .69.56 1.25 1.25 1.25H19"/><path class="a" d="M8 11.5h8v5.5H8z"/><path d="M8 11.5h8v5.5H8zM10.67 11.5v5.5M13.33 11.5v5.5"/>',
  // a volume: a drum that keeps what's poured into it
  volume: '<path class="f" d="M5 13.25c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75v4.5c0 1.52-3.13 2.75-7 2.75s-7-1.23-7-2.75z"/><ellipse cx="12" cy="6.25" rx="7" ry="2.75"/><path d="M5 6.25v11.5c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75V6.25M5 13.25c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75"/>',
  // a network: three hosts on one bridge
  network: '<circle class="f" cx="12" cy="5.5" r="2.5"/><circle class="f" cx="5" cy="18" r="2.5"/><circle class="f" cx="19" cy="18" r="2.5"/><circle cx="12" cy="5.5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M10.6 7.6C8 9.6 6.3 12.2 5.6 15.5M13.4 7.6c2.6 2 4.3 4.6 5 7.9M7.5 18h9"/>',
  // a cluster: pods packed like a honeycomb
  kube: '<path class="f" d="m7.75 3 3.9 2.25v4.5l-3.9 2.25-3.9-2.25v-4.5z"/><path d="m7.75 3 3.9 2.25v4.5l-3.9 2.25-3.9-2.25v-4.5zM16.25 3l3.9 2.25v4.5L16.25 12l-3.9-2.25v-4.5zM12 12.25l3.9 2.25V19L12 21.25 8.1 19v-4.5z"/><path class="a" d="m12 12.25 3.9 2.25V19L12 21.25 8.1 19v-4.5z"/>',
  // a pod: one hexagon holding one container
  pod: '<path class="f" d="M9 10h6v4.5H9z"/><path d="m12 2.75 7.75 4.5v9.5L12 21.25l-7.75-4.5v-9.5z"/><path d="M9 10h6v4.5H9zM12 10v4.5"/>',
  // a Linux machine: a window with a live prompt
  machine: '<path class="f" d="M3 7.75V6.5A1.75 1.75 0 0 1 4.75 4.75h14.5c.97 0 1.75.78 1.75 1.75v1.25z"/><rect x="3" y="4.75" width="18" height="14.5" rx="1.75"/><path d="M3 7.75h18M7 11.5l2.5 2-2.5 2"/><path class="a" d="M12 14.75h4.5v1.5H12z"/>',
  // data: a table with one edited cell waiting to be committed
  data: '<path class="f" d="M3 8.75V6.25c0-.97.78-1.75 1.75-1.75h14.5c.97 0 1.75.78 1.75 1.75v2.5z"/><path class="a" d="M9.5 8.75H21v5H9.5z"/><rect x="3" y="4.5" width="18" height="15" rx="1.75"/><path d="M3 8.75h18M3 13.75h18M9.5 8.75V19.5"/>',
  // domains: a globe with its own address line
  domain: '<circle class="f" cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-2.4 2.4-3.6 5.23-3.6 8.5s1.2 6.1 3.6 8.5M12 3.5c2.4 2.4 3.6 5.23 3.6 8.5s-1.2 6.1-3.6 8.5"/>',
  // activity: the memory ledger with a pulse over it
  activity: '<path class="a" d="M5.5 14.5H11v5H5.5A2.5 2.5 0 0 1 3 17a2.5 2.5 0 0 1 2.5-2.5z"/><path class="f" d="M11 14.5h4.5v5H11z"/><rect x="3" y="14.5" width="18" height="5" rx="2.5"/><path d="M11 14.5v5M15.5 14.5v5"/><path d="M3 9.5h3.75l2-4.5 3 7 2-3.5H21"/>',
  // settings: two sliders, one set
  settings: '<circle class="f" cx="9" cy="7.5" r="2.5"/><circle class="f" cx="15" cy="16.5" r="2.5"/><circle cx="9" cy="7.5" r="2.5"/><circle cx="15" cy="16.5" r="2.5"/><path d="M3 7.5h3.5M11.5 7.5H21M3 16.5h9.5M17.5 16.5H21"/>',
  // a Compose project: containers stacked like cargo
  compose: '<path class="f" d="M7.75 4.5h8.5v6.25h-8.5z"/><path d="M7.75 4.5h8.5v6.25h-8.5zM3 12.75h8.5V19H3zM12.5 12.75H21V19h-8.5zM12 4.5v6.25M7.25 12.75V19M16.75 12.75V19"/>',
  // an empty or unknown container image layer
  layer: '<path class="f" d="m12 3.5 8.5 4.25L12 12 3.5 7.75z"/><path d="m12 3.5 8.5 4.25L12 12 3.5 7.75z"/><path stroke-dasharray="2 2.25" d="m3.5 12.25 8.5 4.25 8.5-4.25M3.5 16.5l8.5 4.25 8.5-4.25"/>',
};
function cxIcon(name, cls = '') {
  const body = CX_ICONS[name.replace(/^cx-/, '')] || CX_ICONS.container;
  return `<svg class="cxi ti ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

/* ---------- brand logos: Devicon (MIT) originals, Simple Icons (CC0) where Devicon has none ---------- */
const LOGOS = {
  postgresql: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', sqlite: 'SQLite', clickhouse: 'ClickHouse', mssql: 'SQL Server', mongodb: 'MongoDB', redis: 'Redis', dynamodb: 'DynamoDB',
  supabase: 'Supabase', neon: 'Neon', turso: 'Turso', planetscale: 'PlanetScale', timescale: 'Timescale', elasticsearch: 'Elasticsearch', kafka: 'Apache Kafka', rabbitmq: 'RabbitMQ',
  keycloak: 'Keycloak', grafana: 'Grafana', prometheus: 'Prometheus', minio: 'MinIO', stripe: 'Stripe', nginx: 'NGINX', traefik: 'Traefik', caddy: 'Caddy', ollama: 'Ollama', n8n: 'n8n', vault: 'Vault',
  python: 'Python', nodejs: 'Node.js', go: 'Go', rust: 'Rust', bun: 'Bun', deno: 'Deno', php: 'PHP', ruby: 'Ruby', java: 'Java',
  ubuntu: 'Ubuntu', debian: 'Debian', fedora: 'Fedora', archlinux: 'Arch Linux', alpine: 'Alpine Linux', nixos: 'NixOS', opensuse: 'openSUSE', rockylinux: 'Rocky Linux', kali: 'Kali Linux',
  kubernetes: 'Kubernetes', docker: 'Docker', k3s: 'K3s', helm: 'Helm',
};
// logos whose original artwork is near-black get a light variant in dark mode
const LOGO_DARK = new Set(['alpine','clickhouse','debian','deno','docker','dynamodb','elasticsearch','fedora','go','helm','k3s','kafka','keycloak','mariadb','mysql','ollama','php','planetscale','redis','ruby','rust','sqlite','turso','vault']);

// match an image, a connection, an engine or a distro to its logo; first rule that hits wins
const LOGO_RULES = [
  ['neon', 'neon'], ['supabase', 'supabase'], ['turso', 'turso'], ['planetscale', 'planetscale'], ['timescale', 'timescale'],
  ['postgis', 'postgresql'], ['postgres', 'postgresql'], ['mariadb', 'mariadb'], ['mysql', 'mysql'], ['sqlite', 'sqlite'], ['libsql', 'turso'], ['clickhouse', 'clickhouse'],
  ['mssql', 'mssql'], ['sql server', 'mssql'], ['sqlserver', 'mssql'], ['mongo', 'mongodb'], ['redis', 'redis'], ['valkey', 'redis'], ['dynamo', 'dynamodb'],
  ['elastic', 'elasticsearch'], ['kafka', 'kafka'], ['rabbitmq', 'rabbitmq'], ['keycloak', 'keycloak'], ['grafana', 'grafana'], ['prometheus', 'prometheus'], ['minio', 'minio'],
  ['stripe', 'stripe'], ['nginx', 'nginx'], ['traefik', 'traefik'], ['caddy', 'caddy'], ['ollama', 'ollama'], ['n8n', 'n8n'], ['vault', 'vault'],
  ['python', 'python'], ['node', 'nodejs'], ['golang', 'go'], ['rust', 'rust'], ['oven/bun', 'bun'], ['denoland', 'deno'], ['php', 'php'], ['ruby', 'ruby'], ['openjdk', 'java'], ['eclipse-temurin', 'java'],
  ['ubuntu', 'ubuntu'], ['debian', 'debian'], ['fedora', 'fedora'], ['arch', 'archlinux'], ['nixos', 'nixos'], ['suse', 'opensuse'], ['rocky', 'rockylinux'], ['kali', 'kali'], ['alpine', 'alpine'],
  ['kubernetes', 'kubernetes'], ['k3s', 'k3s'], ['helm', 'helm'], ['docker', 'docker'],
];
const LOGO_EXACT = { go: 'go', pg: 'postgresql', postgres: 'postgresql', bun: 'bun', deno: 'deno' };
function logoKey(o) {
  if (o.logo) return o.logo === 'none' ? null : o.logo;
  for (const f of [o.provider, o.image, o.repo, o.ref, o.kind, o.distro, o.id, o.name]) {
    if (!f || typeof f !== 'string') continue;
    const s = f.toLowerCase().split(':')[0];
    if (LOGO_EXACT[s]) return LOGO_EXACT[s];
    const hit = LOGO_RULES.find(([k]) => s.includes(k));
    if (hit) return hit[1];
  }
  return null;
}
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
function logoImg(key) {
  return `<img src="vendor/logos/${key}${LOGO_DARK.has(key) && isDark() ? '-dark' : ''}.svg" alt="${esc(LOGOS[key] || key)}" draggable="false">`;
}
