// Sample data for the prototype. Every name, number and date here is invented.
window.DB = (() => {
  const now = Date.now();
  const min = 60e3, hour = 60 * min, day = 24 * hour;

  const engine = {
    state: 'running',            // running | stopped | starting | updating
    version: '1.4.2',
    vm: 'Apple Virtualization (VZ)',
    kernel: '6.12.8-containeria',
    arch: 'arm64',
    rosetta: true,
    cpus: 6, cpuMax: 12,
    memGB: 8, memMaxGB: 32,
    diskGB: 120, diskUsedGB: 41.6,
    uptime: now - (3 * hour + 12 * min),
    bootSeconds: 2.1,
    returnedGB: 2.4,
    socket: '~/.containeria/run/docker.sock',
    domain: 'containeria.local',
    dockerApi: '1.47', containerd: '2.0.4', k3s: 'v1.31.4+k3s1',
  };

  // Compose projects, in ledger order
  const projects = [
    { id: 'shop',      name: 'shop',      path: '~/Code/shop',            color: 's1' },
    { id: 'analytics', name: 'analytics', path: '~/Code/analytics-stack', color: 's2' },
    { id: 'auth',      name: 'auth',      path: '~/Code/auth-service',    color: 's3' },
    { id: null,        name: 'Standalone', color: 's6' },
  ];

  // th = tile hue, mono = 2-letter face
  const C = (o) => ({ cpu: 0, memMB: 0, memLimitMB: 0, ports: [], restarts: 0, health: null, ...o });
  const containers = [
    C({ id: '3f9a1c2b7e44', name: 'shop-web',      service: 'web',      project: 'shop', image: 'node', tag: '22-alpine', mono: 'Nx', th: 250, state: 'running', started: now - 3 * hour, cpu: 4.2, memMB: 412, ports: [{ host: 3000, ctr: 3000 }], domain: 'web.shop.containeria.local', cmd: 'npm run dev', health: 'healthy' }),
    C({ id: '8b21de90a1f3', name: 'shop-api',      service: 'api',      project: 'shop', image: 'golang', tag: '1.24', mono: 'Go', th: 215, state: 'running', started: now - 3 * hour, cpu: 1.6, memMB: 96, ports: [{ host: 8080, ctr: 8080 }], domain: 'api.shop.containeria.local', cmd: 'air -c .air.toml', health: 'healthy' }),
    C({ id: 'c4d81a6f0e92', name: 'shop-worker',   service: 'worker',   project: 'shop', image: 'golang', tag: '1.24', mono: 'Go', th: 215, state: 'running', started: now - 3 * hour, cpu: 0.4, memMB: 58, domain: 'worker.shop.containeria.local', cmd: './worker --queue=default' }),
    C({ id: '1e7b55c0d3aa', name: 'shop-postgres', service: 'postgres', project: 'shop', image: 'postgres', tag: '17', mono: 'Pg', th: 240, state: 'running', started: now - 3 * hour, cpu: 0.9, memMB: 284, ports: [{ host: 5432, ctr: 5432 }], domain: 'postgres.shop.containeria.local', cmd: 'postgres', db: 'postgres', health: 'healthy', env: { POSTGRES_USER: 'shop', POSTGRES_PASSWORD: 'shop_dev_pw', POSTGRES_DB: 'shop' } }),
    C({ id: '6a0f3e8c91b2', name: 'shop-redis',    service: 'redis',    project: 'shop', image: 'redis', tag: '7.4-alpine', mono: 'Rd', th: 25, state: 'running', started: now - 3 * hour, cpu: 0.3, memMB: 14, ports: [{ host: 6379, ctr: 6379 }], domain: 'redis.shop.containeria.local', cmd: 'redis-server', db: 'redis' }),
    C({ id: '92cd1b7a4f60', name: 'analytics-clickhouse', service: 'clickhouse', project: 'analytics', image: 'clickhouse/clickhouse-server', tag: '25.1', mono: 'Ch', th: 95, state: 'running', started: now - 2 * hour, cpu: 6.8, memMB: 1180, ports: [{ host: 8123, ctr: 8123 }, { host: 9000, ctr: 9000 }], domain: 'clickhouse.analytics.containeria.local', cmd: '/entrypoint.sh', db: 'clickhouse', health: 'healthy' }),
    C({ id: 'a71e0c25bd18', name: 'analytics-grafana', service: 'grafana', project: 'analytics', image: 'grafana/grafana', tag: '11.4.0', mono: 'Gf', th: 45, state: 'running', started: now - 2 * hour, cpu: 0.7, memMB: 168, ports: [{ host: 3001, ctr: 3000 }], domain: 'grafana.analytics.containeria.local', cmd: '/run.sh' }),
    C({ id: 'f02b9e1d6c37', name: 'analytics-prometheus', service: 'prometheus', project: 'analytics', image: 'prom/prometheus', tag: 'v3.1.0', mono: 'Pr', th: 30, state: 'exited', exitCode: 0, finished: now - 5 * hour, domain: 'prometheus.analytics.containeria.local', cmd: '--config.file=/etc/prometheus.yml' }),
    C({ id: '5d6e7f8a9b0c', name: 'auth-keycloak', service: 'keycloak', project: 'auth', image: 'quay.io/keycloak/keycloak', tag: '26.0', mono: 'Kc', th: 210, state: 'running', started: now - 47 * min, cpu: 2.1, memMB: 690, ports: [{ host: 8180, ctr: 8080 }], domain: 'keycloak.auth.containeria.local', cmd: 'start-dev', health: 'unhealthy', restarts: 2 }),
    C({ id: '0c1d2e3f4a5b', name: 'auth-mysql',    service: 'mysql',    project: 'auth', image: 'mysql', tag: '8.4', mono: 'My', th: 230, state: 'running', started: now - 47 * min, cpu: 0.8, memMB: 402, ports: [{ host: 3306, ctr: 3306 }], domain: 'mysql.auth.containeria.local', cmd: 'mysqld', db: 'mysql', env: { MYSQL_ROOT_PASSWORD: 'root', MYSQL_DATABASE: 'keycloak' } }),
    C({ id: 'e8f9a0b1c2d3', name: 'mailpit',       project: null, image: 'axllent/mailpit', tag: 'v1.21', mono: 'Mp', th: 160, state: 'running', started: now - 2 * day, cpu: 0.1, memMB: 22, ports: [{ host: 8025, ctr: 8025 }, { host: 1025, ctr: 1025 }], domain: 'mailpit.containeria.local', cmd: '/mailpit' }),
    C({ id: 'b3c4d5e6f7a8', name: 'minio',         project: null, image: 'minio/minio', tag: 'RELEASE.2025-01-20', mono: 'Mn', th: 5, state: 'exited', exitCode: 0, finished: now - day, domain: 'minio.containeria.local', cmd: 'server /data --console-address :9001' }),
    C({ id: '7a8b9c0d1e2f', name: 'payments-mock', project: null, image: 'stripe/stripe-mock', tag: 'v0.188', mono: 'St', th: 280, state: 'exited', exitCode: 1, finished: now - 4 * min, restarts: 5, domain: 'payments-mock.containeria.local', cmd: '/stripe-mock -http-port 12111', error: 'listen tcp :12111: bind: address already in use' }),
    C({ id: '4e5f6a7b8c9d', name: 'mongo-sandbox', project: null, image: 'mongo', tag: '8.0', mono: 'Mg', th: 145, state: 'exited', exitCode: 0, finished: now - 3 * day, domain: 'mongo-sandbox.containeria.local', cmd: 'mongod', db: 'mongodb' }),
  ];

  const images = [
    { repo: 'node', tag: '22-alpine', id: 'sha256:9e1f2a4c', sizeMB: 158, created: now - 12 * day, used: 1, mono: 'Nx', th: 250, arch: 'arm64' },
    { repo: 'golang', tag: '1.24', id: 'sha256:2b7d0e91', sizeMB: 842, created: now - 20 * day, used: 2, mono: 'Go', th: 215, arch: 'arm64' },
    { repo: 'postgres', tag: '17', id: 'sha256:6c03aa1f', sizeMB: 438, created: now - 9 * day, used: 1, mono: 'Pg', th: 240, arch: 'arm64' },
    { repo: 'postgres', tag: '15', id: 'sha256:0d4be872', sizeMB: 412, created: now - 140 * day, used: 0, mono: 'Pg', th: 240, arch: 'arm64' },
    { repo: 'redis', tag: '7.4-alpine', id: 'sha256:a8f1c3d2', sizeMB: 41, created: now - 30 * day, used: 1, mono: 'Rd', th: 25, arch: 'arm64' },
    { repo: 'clickhouse/clickhouse-server', tag: '25.1', id: 'sha256:51ce90b4', sizeMB: 612, created: now - 18 * day, used: 1, mono: 'Ch', th: 95, arch: 'arm64' },
    { repo: 'grafana/grafana', tag: '11.4.0', id: 'sha256:e40b2d17', sizeMB: 486, created: now - 44 * day, used: 1, mono: 'Gf', th: 45, arch: 'arm64' },
    { repo: 'prom/prometheus', tag: 'v3.1.0', id: 'sha256:73a9f0c6', sizeMB: 294, created: now - 61 * day, used: 1, mono: 'Pr', th: 30, arch: 'arm64' },
    { repo: 'quay.io/keycloak/keycloak', tag: '26.0', id: 'sha256:c21f8e05', sizeMB: 455, created: now - 33 * day, used: 1, mono: 'Kc', th: 210, arch: 'arm64' },
    { repo: 'mysql', tag: '8.4', id: 'sha256:8f2e6b3a', sizeMB: 602, created: now - 27 * day, used: 1, mono: 'My', th: 230, arch: 'arm64' },
    { repo: 'axllent/mailpit', tag: 'v1.21', id: 'sha256:1a9c7d40', sizeMB: 31, created: now - 52 * day, used: 1, mono: 'Mp', th: 160, arch: 'arm64' },
    { repo: 'minio/minio', tag: 'RELEASE.2025-01-20', id: 'sha256:fc05e2a8', sizeMB: 178, created: now - 70 * day, used: 1, mono: 'Mn', th: 5, arch: 'arm64' },
    { repo: 'stripe/stripe-mock', tag: 'v0.188', id: 'sha256:3e8d1b62', sizeMB: 24, created: now - 90 * day, used: 1, mono: 'St', th: 280, arch: 'amd64' },
    { repo: 'mongo', tag: '8.0', id: 'sha256:b6a2f9c1', sizeMB: 821, created: now - 15 * day, used: 1, mono: 'Mg', th: 145, arch: 'arm64' },
    { repo: 'shop-web', tag: 'dev', id: 'sha256:47e1ac03', sizeMB: 1240, created: now - 3 * hour, used: 0, mono: 'Sw', th: 250, arch: 'arm64', local: true },
    { repo: '<none>', tag: '<none>', id: 'sha256:d90f4e2b', sizeMB: 1188, created: now - 2 * day, used: 0, mono: '—', th: 0, arch: 'arm64', dangling: true },
    { repo: '<none>', tag: '<none>', id: 'sha256:aa61c07e', sizeMB: 1176, created: now - 4 * day, used: 0, mono: '—', th: 0, arch: 'arm64', dangling: true },
    { repo: 'ubuntu', tag: '24.04', id: 'sha256:5f3b1e9d', sizeMB: 101, created: now - 40 * day, used: 0, mono: 'Ub', th: 35, arch: 'arm64' },
  ];

  const volumes = [
    { name: 'shop_pgdata', driver: 'local', sizeMB: 1830, created: now - 64 * day, usedBy: ['shop-postgres'], project: 'shop', mount: '/var/lib/postgresql/data' },
    { name: 'shop_redis', driver: 'local', sizeMB: 12, created: now - 64 * day, usedBy: ['shop-redis'], project: 'shop', mount: '/data' },
    { name: 'shop_node_modules', driver: 'local', sizeMB: 742, created: now - 12 * day, usedBy: ['shop-web'], project: 'shop', mount: '/app/node_modules' },
    { name: 'analytics_clickhouse', driver: 'local', sizeMB: 5420, created: now - 31 * day, usedBy: ['analytics-clickhouse'], project: 'analytics', mount: '/var/lib/clickhouse' },
    { name: 'analytics_grafana', driver: 'local', sizeMB: 48, created: now - 31 * day, usedBy: ['analytics-grafana'], project: 'analytics', mount: '/var/lib/grafana' },
    { name: 'analytics_prometheus', driver: 'local', sizeMB: 960, created: now - 31 * day, usedBy: ['analytics-prometheus'], project: 'analytics', mount: '/prometheus' },
    { name: 'auth_mysql', driver: 'local', sizeMB: 388, created: now - 8 * day, usedBy: ['auth-mysql'], project: 'auth', mount: '/var/lib/mysql' },
    { name: 'minio_data', driver: 'local', sizeMB: 2210, created: now - 70 * day, usedBy: ['minio'], project: null, mount: '/data' },
    { name: 'mongo_sandbox', driver: 'local', sizeMB: 316, created: now - 15 * day, usedBy: ['mongo-sandbox'], project: null, mount: '/data/db' },
    { name: '7c1e94b0a2d35f6e8c19', driver: 'local', sizeMB: 64, created: now - 22 * day, usedBy: [], project: null, anonymous: true },
  ];

  const networks = [
    { name: 'bridge', driver: 'bridge', subnet: '172.17.0.0/16', gateway: '172.17.0.1', containers: ['mailpit', 'minio', 'payments-mock', 'mongo-sandbox'], scope: 'local', builtin: true },
    { name: 'shop_default', driver: 'bridge', subnet: '172.20.0.0/16', gateway: '172.20.0.1', containers: ['shop-web', 'shop-api', 'shop-worker', 'shop-postgres', 'shop-redis'], scope: 'local', project: 'shop' },
    { name: 'analytics_default', driver: 'bridge', subnet: '172.21.0.0/16', gateway: '172.21.0.1', containers: ['analytics-clickhouse', 'analytics-grafana', 'analytics-prometheus'], scope: 'local', project: 'analytics' },
    { name: 'auth_default', driver: 'bridge', subnet: '172.22.0.0/16', gateway: '172.22.0.1', containers: ['auth-keycloak', 'auth-mysql'], scope: 'local', project: 'auth' },
    { name: 'host', driver: 'host', subnet: '—', gateway: '—', containers: [], scope: 'local', builtin: true },
    { name: 'none', driver: 'null', subnet: '—', gateway: '—', containers: [], scope: 'local', builtin: true },
  ];

  const kube = {
    enabled: true, version: 'v1.31.4+k3s1', context: 'containeria', nodes: 1,
    namespaces: ['default', 'kube-system', 'shop-staging', 'monitoring'],
    pods: [
      { name: 'storefront-7d9c8b6f5-x2klp', ns: 'shop-staging', status: 'Running', ready: '1/1', restarts: 0, age: 2 * hour, cpu: 12, memMB: 148, node: 'containeria' },
      { name: 'storefront-7d9c8b6f5-qm4tz', ns: 'shop-staging', status: 'Running', ready: '1/1', restarts: 0, age: 2 * hour, cpu: 9, memMB: 141, node: 'containeria' },
      { name: 'checkout-5c6b7d8e9-h7wqn', ns: 'shop-staging', status: 'CrashLoopBackOff', ready: '0/1', restarts: 14, age: 51 * min, cpu: 0, memMB: 0, node: 'containeria' },
      { name: 'orders-db-0', ns: 'shop-staging', status: 'Running', ready: '1/1', restarts: 0, age: 6 * day, cpu: 21, memMB: 312, node: 'containeria' },
      { name: 'prometheus-server-6f7d5c9b8-lrx2m', ns: 'monitoring', status: 'Running', ready: '2/2', restarts: 1, age: 6 * day, cpu: 34, memMB: 286, node: 'containeria' },
      { name: 'coredns-ccb96694c-5wd2k', ns: 'kube-system', status: 'Running', ready: '1/1', restarts: 0, age: 6 * day, cpu: 3, memMB: 18, node: 'containeria' },
      { name: 'traefik-5d45fc8cc9-mvj8p', ns: 'kube-system', status: 'Running', ready: '1/1', restarts: 0, age: 6 * day, cpu: 2, memMB: 31, node: 'containeria' },
      { name: 'metrics-server-7bf7d58749-9n6fk', ns: 'kube-system', status: 'Running', ready: '1/1', restarts: 0, age: 6 * day, cpu: 4, memMB: 22, node: 'containeria' },
      { name: 'migrate-orders-28915560-kq2s4', ns: 'shop-staging', status: 'Completed', ready: '0/1', restarts: 0, age: 35 * min, cpu: 0, memMB: 0, node: 'containeria' },
    ],
    deployments: [
      { name: 'storefront', ns: 'shop-staging', ready: '2/2', upToDate: 2, available: 2, age: 6 * day, image: 'shop-web:dev' },
      { name: 'checkout', ns: 'shop-staging', ready: '0/1', upToDate: 1, available: 0, age: 6 * day, image: 'shop-checkout:dev' },
      { name: 'prometheus-server', ns: 'monitoring', ready: '1/1', upToDate: 1, available: 1, age: 6 * day, image: 'prom/prometheus:v3.1.0' },
      { name: 'coredns', ns: 'kube-system', ready: '1/1', upToDate: 1, available: 1, age: 6 * day, image: 'rancher/mirrored-coredns-coredns:1.12.0' },
      { name: 'traefik', ns: 'kube-system', ready: '1/1', upToDate: 1, available: 1, age: 6 * day, image: 'rancher/mirrored-library-traefik:3.3.2' },
    ],
    services: [
      { name: 'storefront', ns: 'shop-staging', type: 'LoadBalancer', clusterIP: '10.43.18.204', ports: '80:31480/TCP', external: 'storefront.k8s.containeria.local' },
      { name: 'checkout', ns: 'shop-staging', type: 'ClusterIP', clusterIP: '10.43.92.11', ports: '8080/TCP', external: '—' },
      { name: 'orders-db', ns: 'shop-staging', type: 'ClusterIP', clusterIP: '10.43.7.140', ports: '5432/TCP', external: '—' },
      { name: 'prometheus-server', ns: 'monitoring', type: 'ClusterIP', clusterIP: '10.43.201.33', ports: '80/TCP', external: '—' },
      { name: 'kube-dns', ns: 'kube-system', type: 'ClusterIP', clusterIP: '10.43.0.10', ports: '53/UDP,53/TCP', external: '—' },
    ],
  };

  const machines = [
    { name: 'ubuntu-dev', distro: 'Ubuntu', version: '24.04 LTS', icon: 'brand-ubuntu', th: 35, arch: 'arm64', state: 'running', cpu: 1.2, memMB: 310, diskGB: 6.4, ip: '198.19.249.12', user: 'mannobeats', started: now - 3 * hour, domain: 'ubuntu-dev.containeria.local' },
    { name: 'debian-ci', distro: 'Debian', version: '12 bookworm', icon: 'brand-debian', th: 350, arch: 'amd64', state: 'running', cpu: 0.4, memMB: 142, diskGB: 3.1, ip: '198.19.249.27', user: 'mannobeats', started: now - 26 * min, domain: 'debian-ci.containeria.local', rosetta: true },
    { name: 'arch-lab', distro: 'Arch Linux', version: 'rolling', icon: 'brand-redhat', mono: 'Ar', th: 225, arch: 'arm64', state: 'stopped', cpu: 0, memMB: 0, diskGB: 2.2, ip: '—', user: 'mannobeats', domain: 'arch-lab.containeria.local' },
  ];

  const distros = [
    { name: 'Ubuntu', versions: ['24.04 LTS', '22.04 LTS', '25.04'], icon: 'brand-ubuntu', th: 35 },
    { name: 'Debian', versions: ['12 bookworm', '13 trixie'], icon: 'brand-debian', th: 350 },
    { name: 'Fedora', versions: ['41', '42'], mono: 'Fe', th: 250 },
    { name: 'Arch Linux', versions: ['rolling'], mono: 'Ar', th: 225 },
    { name: 'Alpine', versions: ['3.21', 'edge'], mono: 'Al', th: 230 },
    { name: 'NixOS', versions: ['24.11', 'unstable'], mono: 'Nx', th: 215 },
    { name: 'openSUSE', versions: ['Tumbleweed', 'Leap 15.6'], mono: 'Su', th: 140 },
    { name: 'Rocky Linux', versions: ['9.5'], mono: 'Ro', th: 160 },
    { name: 'Kali', versions: ['2025.1'], mono: 'Ka', th: 260 },
  ];

  // Data browser
  const connections = [
    { id: 'shop-pg', name: 'shop-postgres', kind: 'postgres', host: 'postgres.shop.containeria.local', port: 5432, db: 'shop', user: 'shop', from: 'container', container: 'shop-postgres', env: 'local', mono: 'Pg', th: 240, tables: 9, sizeMB: 214 },
    { id: 'an-ch', name: 'analytics-clickhouse', kind: 'clickhouse', host: 'clickhouse.analytics.containeria.local', port: 8123, db: 'events', user: 'default', from: 'container', container: 'analytics-clickhouse', env: 'local', mono: 'Ch', th: 95, tables: 6, sizeMB: 4880 },
    { id: 'auth-my', name: 'auth-mysql', kind: 'mysql', host: 'mysql.auth.containeria.local', port: 3306, db: 'keycloak', user: 'root', from: 'container', container: 'auth-mysql', env: 'local', mono: 'My', th: 230, tables: 92, sizeMB: 36 },
    { id: 'shop-rd', name: 'shop-redis', kind: 'redis', host: 'redis.shop.containeria.local', port: 6379, db: '0', from: 'container', container: 'shop-redis', env: 'local', mono: 'Rd', th: 25, keys: 1284 },
    { id: 'billing', name: 'billing-prod', kind: 'postgres', provider: 'Neon', host: 'ep-quiet-sun-a4k2.eu-central-1.aws.neon.tech', port: 5432, db: 'billing', user: 'readonly', from: 'saved', env: 'production', readOnly: true, mono: 'Ne', th: 165, tables: 31, sizeMB: 9200 },
    { id: 'growth', name: 'growth-staging', kind: 'postgres', provider: 'Supabase', host: 'db.kpzqlxwnhvbe.supabase.co', port: 5432, db: 'postgres', user: 'postgres', from: 'saved', env: 'staging', mono: 'Sb', th: 150, tables: 18, sizeMB: 640 },
    { id: 'edge', name: 'edge-cache', kind: 'sqlite', provider: 'Turso', host: 'edge-cache-mannobeats.turso.io', db: 'main', from: 'saved', env: 'staging', mono: 'Tu', th: 185, tables: 4, sizeMB: 12 },
    { id: 'notes', name: 'notes.sqlite', kind: 'sqlite', host: '~/Library/Application Support/Notes/notes.sqlite', from: 'file', env: 'local', mono: 'Sq', th: 220, tables: 7, sizeMB: 3 },
  ];

  const schema = {
    public: {
      orders:      { rows: 48213, sizeMB: 38.2, cols: [['id','bigint','pk'],['customer_id','bigint','fk:customers.id'],['status','order_status'],['total_cents','integer'],['currency','char(3)'],['placed_at','timestamptz'],['shipped_at','timestamptz','null'],['coupon_code','text','null'],['notes','text','null']] },
      customers:   { rows: 12904, sizeMB: 6.1,  cols: [['id','bigint','pk'],['email','citext','unique'],['full_name','text'],['country','char(2)'],['created_at','timestamptz'],['marketing_opt_in','boolean'],['lifetime_cents','bigint']] },
      products:    { rows: 384,   sizeMB: 0.9,  cols: [['id','bigint','pk'],['sku','text','unique'],['title','text'],['price_cents','integer'],['stock','integer'],['category','text'],['active','boolean'],['metadata','jsonb']] },
      order_items: { rows: 131877, sizeMB: 61.5, cols: [['id','bigint','pk'],['order_id','bigint','fk:orders.id'],['product_id','bigint','fk:products.id'],['quantity','integer'],['unit_cents','integer']] },
      payments:    { rows: 47960, sizeMB: 22.8, cols: [['id','uuid','pk'],['order_id','bigint','fk:orders.id'],['provider','text'],['amount_cents','integer'],['status','text'],['captured_at','timestamptz','null']] },
      inventory_moves: { rows: 90211, sizeMB: 27.4, cols: [['id','bigint','pk'],['product_id','bigint','fk:products.id'],['delta','integer'],['reason','text'],['moved_at','timestamptz']] },
      coupons:     { rows: 42,    sizeMB: 0.1,  cols: [['code','text','pk'],['percent_off','smallint'],['expires_at','timestamptz','null'],['max_uses','integer','null']] },
    },
    views: { monthly_revenue: { rows: null, cols: [['month','date'],['orders','bigint'],['revenue_cents','numeric']] } },
    functions: ['refresh_lifetime_value()', 'order_total(bigint)', 'set_updated_at()'],
    enums: { order_status: ['pending', 'paid', 'shipped', 'delivered', 'refunded', 'cancelled'] },
    migrations: 24,
  };

  // deterministic rows for orders/customers
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const first = ['Amara','Lucas','Yuki','Sofia','Mateo','Ingrid','Kwame','Leila','Oskar','Priya','Tomás','Hana','Elif','Noah','Zara','Diego','Mei','Anouk','Rafael','Saoirse','Jonas','Aiko','Nadia','Felix'];
  const last = ['Okafor','Lindqvist','Tanaka','Moreau','Alvarez','Haugen','Mensah','Haddad','Nowak','Raman','Ferreira','Kim','Yilmaz','Becker','Ahmed','Castillo','Chen','de Vries','Costa','Byrne','Weber','Sato','Petrova','Schmidt'];
  const countries = ['DE','FR','US','JP','GB','NL','SE','ES','BR','NG','IN','CA','KR','IT'];
  const customers = Array.from({ length: 60 }, (_, i) => {
    const f = pick(first), l = pick(last);
    return { id: 10231 + i * 7, email: `${f}.${l}`.normalize('NFD').toLowerCase().replace(/[^a-z.]/g, '') + '@' + pick(['gmail.com','proton.me','outlook.com','icloud.com','hey.com']), full_name: `${f} ${l}`, country: pick(countries), created_at: new Date(now - rnd() * 400 * day).toISOString(), marketing_opt_in: rnd() > .45, lifetime_cents: Math.round(rnd() * 180000) };
  });
  const statuses = ['paid','paid','paid','shipped','shipped','delivered','delivered','delivered','pending','refunded','cancelled'];
  const orders = Array.from({ length: 200 }, (_, i) => {
    const placed = now - (i * 37 + rnd() * 30) * min;
    const status = i < 3 ? 'pending' : pick(statuses);
    return {
      id: 48213 - i, customer_id: pick(customers).id, status,
      total_cents: Math.round(1500 + rnd() * 42000), currency: pick(['EUR','EUR','EUR','USD','GBP']),
      placed_at: new Date(placed).toISOString(),
      shipped_at: ['shipped','delivered'].includes(status) ? new Date(placed + (6 + rnd() * 40) * hour).toISOString() : null,
      coupon_code: rnd() > .8 ? pick(['WELCOME10','SPRING25','FREESHIP','VIP15']) : null,
      notes: rnd() > .9 ? pick(['Leave at the back door','Gift wrap please','Call before delivery','Fragile']) : null,
    };
  });

  const queryHistory = [
    { sql: "select status, count(*), sum(total_cents) / 100.0 as revenue\nfrom orders\nwhere placed_at > now() - interval '7 days'\ngroup by status\norder by revenue desc;", at: now - 6 * min, ms: 41, rows: 6, conn: 'shop-postgres' },
    { sql: "update products set stock = stock - 1 where sku = 'TEE-BLK-M';", at: now - 38 * min, ms: 3, rows: 1, conn: 'shop-postgres' },
    { sql: "select * from customers where email ilike '%@hey.com' limit 50;", at: now - 2 * hour, ms: 12, rows: 18, conn: 'shop-postgres' },
    { sql: "select toStartOfHour(ts) h, count() from events where ts > now() - interval 1 day group by h order by h;", at: now - 5 * hour, ms: 186, rows: 24, conn: 'analytics-clickhouse' },
    { sql: "explain analyze select * from order_items where order_id = 48102;", at: now - day, ms: 2, rows: 4, conn: 'shop-postgres' },
    { sql: "select id, email from users where realm_id = 'shop' order by created_timestamp desc;", at: now - 2 * day, ms: 9, rows: 212, conn: 'auth-mysql' },
  ];

  const savedQueries = [
    { name: 'Revenue last 7 days', conn: 'shop-postgres' },
    { name: 'Stuck pending orders', conn: 'shop-postgres' },
    { name: 'Top customers by lifetime value', conn: 'shop-postgres' },
    { name: 'Hourly events', conn: 'analytics-clickhouse' },
  ];

  const domains = [
    ...containers.filter(c => c.domain).map(c => ({ host: c.domain, target: c.name, kind: 'container', port: c.ports[0]?.ctr || null, https: true, auto: true, up: c.state === 'running' })),
    { host: 'storefront.k8s.containeria.local', target: 'svc/storefront', kind: 'kubernetes', port: 80, https: true, auto: true, up: true },
    ...machines.map(m => ({ host: m.domain, target: m.name, kind: 'machine', port: null, https: false, auto: true, up: m.state === 'running' })),
    { host: 'shop.test', target: 'shop-web', kind: 'custom', port: 3000, https: true, auto: false, up: true },
    { host: 'api.shop.test', target: 'shop-api', kind: 'custom', port: 8080, https: true, auto: false, up: true },
  ];

  const logs = {
    'shop-api': [
      ['12:04:11.208', 'info',  'server listening on :8080'],
      ['12:04:11.209', 'info',  'connected to postgres://shop@postgres:5432/shop (pool=10)'],
      ['12:04:11.214', 'info',  'connected to redis://redis:6379/0'],
      ['12:06:42.871', 'info',  'GET /v1/products?category=tees 200 8.2ms'],
      ['12:06:43.019', 'info',  'GET /v1/products/TEE-BLK-M 200 2.9ms'],
      ['12:06:51.430', 'info',  'POST /v1/cart/items 201 11.4ms'],
      ['12:07:02.115', 'warn',  'slow query 412ms: select * from inventory_moves where product_id = $1'],
      ['12:07:09.662', 'info',  'POST /v1/checkout 200 64.1ms order_id=48213'],
      ['12:07:09.701', 'info',  'enqueued job send_receipt order_id=48213'],
      ['12:07:31.004', 'error', 'payments: dial tcp payments-mock:12111: connect: connection refused'],
      ['12:07:31.005', 'warn',  'retrying payment capture in 2s (attempt 1/5)'],
      ['12:07:33.010', 'error', 'payments: dial tcp payments-mock:12111: connect: connection refused'],
      ['12:07:41.889', 'info',  'GET /healthz 200 0.3ms'],
      ['12:08:12.342', 'info',  'GET /v1/orders?customer=10483 200 6.7ms'],
      ['12:08:40.120', 'debug', 'cache hit products:category:tees ttl=287s'],
      ['12:09:01.556', 'info',  'GET /v1/products?category=hoodies 200 7.9ms'],
      ['12:09:14.008', 'info',  'PATCH /v1/orders/48210 200 9.1ms status=shipped'],
      ['12:09:41.889', 'info',  'GET /healthz 200 0.2ms'],
    ],
  };

  const migration = { found: true, containers: 11, images: 23, volumes: 9, sizeGB: 18.4, memGB: 6, app: 'Docker Desktop 4.37.1' };

  return { now, min, hour, day, engine, projects, containers, images, volumes, networks, kube, machines, distros, connections, schema, customers, orders, queryHistory, savedQueries, domains, logs, migration };
})();
