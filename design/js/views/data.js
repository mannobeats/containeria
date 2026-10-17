// Data browser: connections, schema tree, grid with staged edits, SQL editor, diagram, history, Redis keys.
(() => {
  /* ---------- state that survives navigation ---------- */
  const S = {
    connected: new Set(['shop-pg', 'shop-rd']),
    failing: new Set(['growth']),       // fails on first connect, to show the error state
    tabs: {},                           // cid -> [{ key, kind, title, path }]
    grid: {},                           // `${cid}|${table}` -> view state
    pending: {},                        // `${cid}|${table}` -> { edits, added, deleted }
    cache: {},                          // `${cid}|${table}` -> loaded rows
    queries: {},                        // cid -> [{ id, sql, result }]
    nodePos: {},                        // `${cid}|${table}` -> [x, y]
    cam: {},                            // cid -> { x, y, z }
    redisSel: 'session:9f2c41e0b7',
    redisLog: [],
    unsafeUntil: 0,
  };

  /* ---------- engines ---------- */
  const ENGINES = [
    { id: 'postgres', name: 'PostgreSQL', mono: 'Pg', th: 240, port: 5432, user: 'postgres' },
    { id: 'mysql', name: 'MySQL', icon: 'brand-mysql', th: 215, port: 3306, user: 'root' },
    { id: 'mariadb', name: 'MariaDB', mono: 'Ma', th: 30, port: 3306, user: 'root' },
    { id: 'sqlite', name: 'SQLite', mono: 'Sq', th: 220, file: true },
    { id: 'clickhouse', name: 'ClickHouse', mono: 'Ch', th: 95, port: 8123, user: 'default' },
    { id: 'mssql', name: 'SQL Server', mono: 'Ms', th: 15, port: 1433, user: 'sa' },
    { id: 'mongodb', name: 'MongoDB', icon: 'brand-mongodb', th: 145, port: 27017, user: '' },
    { id: 'redis', name: 'Redis', mono: 'Rd', th: 25, port: 6379, user: '' },
    { id: 'dynamodb', name: 'DynamoDB', mono: 'Dy', th: 280, region: true },
    { id: 'supabase', name: 'Supabase', icon: 'brand-supabase', th: 150, port: 5432, user: 'postgres' },
    { id: 'neon', name: 'Neon', mono: 'Ne', th: 165, port: 5432, user: 'neondb_owner' },
    { id: 'turso', name: 'Turso', mono: 'Tu', th: 185, url: true },
    { id: 'planetscale', name: 'PlanetScale', icon: 'brand-planetscale', th: 0, port: 3306, user: '' },
  ];
  const engineName = (c) => ({ postgres: 'PostgreSQL', clickhouse: 'ClickHouse', mysql: 'MySQL', redis: 'Redis', sqlite: 'SQLite' }[c.kind] || c.kind);
  const engineVersion = { 'shop-pg': 'PostgreSQL 17.2', 'an-ch': 'ClickHouse 25.1', 'auth-my': 'MySQL 8.4.3', 'shop-rd': 'Redis 7.4.1', billing: 'PostgreSQL 16.6 · Neon', growth: 'PostgreSQL 15.8 · Supabase', edge: 'libSQL 0.24 · Turso', notes: 'SQLite 3.47' };

  /* ---------- schemas for every saved connection ---------- */
  const T = (rows, sizeMB, cols) => ({ rows, sizeMB, cols });
  const SCHEMAS = {
    'shop-pg': [{ name: 'public', tables: DB.schema.public, views: DB.schema.views, functions: DB.schema.functions, enums: DB.schema.enums }],
    'an-ch': [{ name: 'events', tables: {
      events: T(182400311, 3120, [['ts', 'DateTime64(3)'], ['event', 'LowCardinality(String)'], ['user_id', 'UInt64'], ['session_id', 'UUID', 'fk:sessions.session_id'], ['path', 'String'], ['country', 'FixedString(2)'], ['props', 'JSON']]),
      sessions: T(4120877, 410, [['session_id', 'UUID', 'pk'], ['user_id', 'UInt64'], ['started_at', 'DateTime'], ['duration_s', 'UInt32'], ['pages', 'UInt16'], ['device', 'LowCardinality(String)']]),
      pageviews_daily: T(18250, 2.1, [['day', 'Date'], ['path', 'String'], ['views', 'UInt64'], ['uniques', 'UInt64']]),
      web_vitals: T(9882104, 690, [['ts', 'DateTime'], ['path', 'String'], ['metric', 'LowCardinality(String)'], ['value', 'Float64']]),
      errors: T(61092, 48, [['ts', 'DateTime'], ['message', 'String'], ['release', 'String'], ['count', 'UInt32']]),
      experiments: T(1204552, 96, [['ts', 'DateTime'], ['experiment', 'String'], ['variant', 'String'], ['user_id', 'UInt64']]),
    }, views: { hourly_events_mv: { cols: [['hour', 'DateTime'], ['event', 'String'], ['c', 'UInt64']] } }, functions: [], enums: {} }],
    'auth-my': [{ name: 'keycloak', more: 80, tables: {
      USER_ENTITY: T(2140, 1.6, [['ID', 'varchar(36)', 'pk'], ['EMAIL', 'varchar(255)', 'null'], ['USERNAME', 'varchar(255)'], ['FIRST_NAME', 'varchar(255)', 'null'], ['LAST_NAME', 'varchar(255)', 'null'], ['ENABLED', 'tinyint(1)'], ['REALM_ID', 'varchar(255)', 'fk:REALM.ID'], ['CREATED_TIMESTAMP', 'bigint']]),
      REALM: T(3, 0.1, [['ID', 'varchar(36)', 'pk'], ['NAME', 'varchar(255)'], ['ENABLED', 'tinyint(1)'], ['SSL_REQUIRED', 'varchar(255)']]),
      CLIENT: T(41, 0.1, [['ID', 'varchar(36)', 'pk'], ['CLIENT_ID', 'varchar(255)'], ['REALM_ID', 'varchar(36)', 'fk:REALM.ID'], ['ENABLED', 'tinyint(1)'], ['PUBLIC_CLIENT', 'tinyint(1)']]),
      CREDENTIAL: T(2104, 0.9, [['ID', 'varchar(36)', 'pk'], ['USER_ID', 'varchar(36)', 'fk:USER_ENTITY.ID'], ['TYPE', 'varchar(255)'], ['CREATED_DATE', 'bigint']]),
      KEYCLOAK_ROLE: T(118, 0.1, [['ID', 'varchar(36)', 'pk'], ['NAME', 'varchar(255)'], ['REALM_ID', 'varchar(255)', 'fk:REALM.ID'], ['DESCRIPTION', 'varchar(255)', 'null']]),
      USER_ROLE_MAPPING: T(6620, 0.8, [['ROLE_ID', 'varchar(255)', 'fk:KEYCLOAK_ROLE.ID'], ['USER_ID', 'varchar(36)', 'fk:USER_ENTITY.ID']]),
      EVENT_ENTITY: T(48230, 12.4, [['ID', 'varchar(36)', 'pk'], ['TYPE', 'varchar(255)'], ['USER_ID', 'varchar(255)', 'null'], ['IP_ADDRESS', 'varchar(255)'], ['EVENT_TIME', 'bigint']]),
      OFFLINE_USER_SESSION: T(310, 0.4, [['USER_SESSION_ID', 'varchar(36)', 'pk'], ['USER_ID', 'varchar(255)'], ['REALM_ID', 'varchar(36)'], ['CREATED_ON', 'int']]),
    }, views: {}, functions: [], enums: {} }],
    billing: [{ name: 'public', tables: {
      invoices: T(184220, 96, [['id', 'text', 'pk'], ['customer_id', 'text', 'fk:customers.id'], ['status', 'text'], ['amount_cents', 'integer'], ['currency', 'char(3)'], ['issued_at', 'timestamptz'], ['paid_at', 'timestamptz', 'null']]),
      customers: T(22931, 8.4, [['id', 'text', 'pk'], ['email', 'citext'], ['company', 'text', 'null'], ['country', 'char(2)'], ['created_at', 'timestamptz']]),
      subscriptions: T(19402, 6.2, [['id', 'text', 'pk'], ['customer_id', 'text', 'fk:customers.id'], ['plan_id', 'text', 'fk:plans.id'], ['status', 'text'], ['current_period_end', 'timestamptz']]),
      plans: T(9, 0.1, [['id', 'text', 'pk'], ['title', 'text'], ['price_cents', 'integer'], ['interval', 'text']]),
      refunds: T(1873, 0.6, [['id', 'text', 'pk'], ['invoice_id', 'text', 'fk:invoices.id'], ['amount_cents', 'integer'], ['reason', 'text'], ['created_at', 'timestamptz']]),
      webhook_events: T(902118, 1840, [['id', 'uuid', 'pk'], ['type', 'text'], ['payload', 'jsonb'], ['received_at', 'timestamptz']]),
    }, views: {}, functions: ['mrr_cents()', 'close_period(date)'], enums: {} }],
    growth: [
      { name: 'public', tables: {
        profiles: T(8410, 3.1, [['id', 'uuid', 'pk'], ['full_name', 'text', 'null'], ['country', 'char(2)'], ['created_at', 'timestamptz']]),
        experiments: T(14, 0.1, [['id', 'bigint', 'pk'], ['key', 'text'], ['status', 'text'], ['started_at', 'timestamptz']]),
        assignments: T(61204, 9.8, [['id', 'bigint', 'pk'], ['experiment_id', 'bigint', 'fk:experiments.id'], ['profile_id', 'uuid', 'fk:profiles.id'], ['variant', 'text']]),
        signups: T(8977, 2.2, [['id', 'bigint', 'pk'], ['email', 'text'], ['source', 'text'], ['created_at', 'timestamptz']]),
      }, views: {}, functions: [], enums: {} },
      { name: 'auth', tables: { users: T(8410, 4.4, [['id', 'uuid', 'pk'], ['email', 'text'], ['created_at', 'timestamptz'], ['last_sign_in_at', 'timestamptz', 'null']]) }, views: {}, functions: [], enums: {} },
      { name: 'storage', tables: { objects: T(1290, 0.8, [['id', 'uuid', 'pk'], ['bucket_id', 'text'], ['name', 'text'], ['metadata', 'jsonb']]) }, views: {}, functions: [], enums: {} },
    ],
    edge: [{ name: 'main', tables: {
      cache_entries: T(41022, 9.1, [['key', 'text', 'pk'], ['route', 'text'], ['bytes', 'integer'], ['expires_at', 'integer']]),
      routes: T(214, 0.1, [['id', 'integer', 'pk'], ['path', 'text'], ['ttl', 'integer'], ['stale_while_revalidate', 'integer']]),
      purge_log: T(3880, 0.4, [['id', 'integer', 'pk'], ['path', 'text'], ['reason', 'text'], ['purged_at', 'integer']]),
      kv: T(612, 0.2, [['k', 'text', 'pk'], ['v', 'text']]),
    }, views: {}, functions: [], enums: {} }],
    notes: [{ name: 'main', tables: {
      notes: T(1204, 2.1, [['id', 'integer', 'pk'], ['folder_id', 'integer', 'fk:folders.id'], ['title', 'text'], ['body', 'text'], ['updated_at', 'integer']]),
      folders: T(18, 0.1, [['id', 'integer', 'pk'], ['name', 'text'], ['parent_id', 'integer', 'null']]),
      tags: T(41, 0.1, [['id', 'integer', 'pk'], ['name', 'text']]),
      note_tags: T(2210, 0.2, [['note_id', 'integer', 'fk:notes.id'], ['tag_id', 'integer', 'fk:tags.id']]),
      attachments: T(96, 0.6, [['id', 'integer', 'pk'], ['note_id', 'integer', 'fk:notes.id'], ['filename', 'text'], ['bytes', 'integer']]),
    }, views: {}, functions: [], enums: {} }],
  };

  const conn = (id) => DB.connections.find((c) => c.id === id);
  const groups = (cid) => SCHEMAS[cid] || [{ name: 'public', tables: {}, views: {}, functions: [], enums: {} }];
  // table names: "orders" in the first schema, "auth.users" elsewhere
  function tablesOf(cid) {
    const out = [];
    groups(cid).forEach((g, gi) => Object.entries(g.tables).forEach(([n, def]) => out.push({ id: gi ? `${g.name}.${n}` : n, schema: g.name, name: n, def })));
    return out;
  }
  const findTable = (cid, id) => tablesOf(cid).find((t) => t.id === id);
  const qname = (t) => `${t.schema}.${t.name}`;

  /* ---------- deterministic rows ---------- */
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  const rng = (seed) => { let s = (seed % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const hex = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
  const uuid = (r) => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-${pick(r, ['8', '9', 'a', 'b'])}${hex(r, 3)}-${hex(r, 12)}`;
  const iso = (t) => new Date(t).toISOString();
  const W = {
    sku: ['TEE-BLK-M', 'TEE-WHT-L', 'HOOD-GRY-M', 'CAP-NVY', 'SOCK-RED-42', 'BAG-TOTE-NAT', 'TEE-OLV-S', 'HOOD-BLK-XL', 'BEANIE-MUS'],
    title: ['Heavyweight tee, black', 'Heavyweight tee, white', 'Loopback hoodie, grey', 'Six-panel cap, navy', 'Ribbed socks, red', 'Canvas tote, natural', 'Garment-dyed tee, olive', 'Zip hoodie, black', 'Merino beanie, mustard'],
    category: ['tees', 'hoodies', 'caps', 'socks', 'bags', 'knitwear'],
    reason: ['restock', 'sale', 'return', 'stock count', 'damaged'],
    provider: ['stripe', 'stripe', 'adyen', 'paypal'],
    pay: ['captured', 'captured', 'captured', 'authorized', 'failed', 'refunded'],
    sub: ['active', 'active', 'active', 'trialing', 'past_due', 'canceled'],
    inv: ['paid', 'paid', 'paid', 'open', 'void', 'uncollectible'],
    event: ['page_view', 'page_view', 'page_view', 'add_to_cart', 'checkout_started', 'purchase', 'search', 'sign_up'],
    path: ['/', '/tees', '/hoodies', '/products/tee-blk-m', '/cart', '/checkout', '/account', '/search?q=hoodie'],
    device: ['desktop', 'mobile', 'mobile', 'tablet'],
    metric: ['LCP', 'INP', 'CLS', 'TTFB'],
    message: ["TypeError: Cannot read properties of undefined (reading 'price')", 'ChunkLoadError: Loading chunk 412 failed', 'NetworkError when attempting to fetch resource', 'RangeError: Invalid time value'],
    kc: ['LOGIN', 'LOGIN', 'CODE_TO_TOKEN', 'REFRESH_TOKEN', 'LOGOUT', 'LOGIN_ERROR'],
    company: ['Lindqvist & Co', 'Northwind Studio', 'Haddad Design', 'Okafor Labs', 'Tanaka Works', 'Moreau Atelier'],
    source: ['organic', 'referral', 'newsletter', 'paid_social', 'podcast'],
    note: ['Q4 launch checklist', 'Postgres tuning notes', 'Trip to Lisbon', 'Hoodie supplier call', 'Reading list', 'Pricing experiments'],
    word: ['alpha', 'harbor', 'linen', 'copper', 'meadow', 'signal', 'quartz', 'ember'],
  };
  const custIds = DB.customers.map((c) => c.id);
  const orderIds = DB.orders.map((o) => o.id);
  function value(cid, table, col, i, r) {
    const [name, type, flags = ''] = col;
    const n = name.toLowerCase(), t = type.toLowerCase();
    if (flags.includes('null') && r() < 0.28) return null;
    if (flags === 'pk') {
      if (/uuid|varchar\(36\)/.test(t)) return uuid(r);
      if (n === 'code') return pick(r, ['WELCOME10', 'SPRING25', 'FREESHIP', 'VIP15', 'BFCM30', 'STUDENT20']) + (i > 5 ? i : '');
      if (/text/.test(t)) return ({ invoices: 'in_', customers: 'cus_', subscriptions: 'sub_', plans: 'plan_', refunds: 're_' }[table] || '') + hex(r, 14);
      if (n === 'key') return `GET ${pick(r, W.path)}#${hex(r, 6)}`;
      if (n === 'k') return `${pick(r, ['flag', 'cfg', 'ab'])}:${pick(r, W.word)}`;
      return i + 1;
    }
    if (flags.startsWith('fk:')) {
      const target = flags.slice(3).split('.')[0];
      if (target === 'customers' && cid === 'shop-pg') return pick(r, custIds);
      if (target === 'orders' && cid === 'shop-pg') return pick(r, orderIds);
      if (/uuid|varchar\(36\)|text|string/.test(t)) { const rows = dataFor(cid, target); return rows.length ? rows[Math.floor(r() * rows.length)][Object.keys(rows[0])[0]] : uuid(r); }
      return 1 + Math.floor(r() * 300);
    }
    if (n.includes('email')) return pick(r, DB.customers).email;
    if (n === 'full_name') return pick(r, DB.customers).full_name;
    if (n === 'first_name') return pick(r, DB.customers).full_name.split(' ')[0];
    if (n === 'last_name') return pick(r, DB.customers).full_name.split(' ')[1];
    if (n === 'username') return pick(r, DB.customers).email.split('@')[0];
    if (n === 'sku') return W.sku[i % W.sku.length] + (i >= W.sku.length ? '-' + i : '');
    if (n === 'title') return table === 'notes' ? pick(r, W.note) : table === 'plans' ? pick(r, ['Starter', 'Team', 'Business', 'Enterprise']) + ' · ' + pick(r, ['monthly', 'yearly']) : W.title[i % W.title.length];
    if (n === 'category') return pick(r, W.category);
    if (n === 'reason') return pick(r, W.reason);
    if (n === 'provider') return pick(r, W.provider);
    if (n === 'status') return pick(r, { payments: W.pay, subscriptions: W.sub, invoices: W.inv, experiments: ['running', 'running', 'paused', 'concluded'] }[table] || ['active', 'pending', 'done']);
    if (n === 'currency') return pick(r, ['EUR', 'EUR', 'USD', 'GBP']);
    if (n === 'country') return pick(r, ['DE', 'FR', 'US', 'JP', 'GB', 'NL', 'SE', 'ES', 'BR', 'NG', 'IN']);
    if (n === 'event') return pick(r, W.event);
    if (n === 'path' || n === 'route') return pick(r, W.path);
    if (n === 'device') return pick(r, W.device);
    if (n === 'metric') return pick(r, W.metric);
    if (n === 'message') return pick(r, W.message);
    if (n === 'type') return table === 'EVENT_ENTITY' ? pick(r, W.kc) : table === 'CREDENTIAL' ? 'password' : pick(r, ['invoice.paid', 'customer.subscription.updated', 'charge.refunded', 'invoice.finalized']);
    if (n === 'company') return pick(r, W.company);
    if (n === 'source') return pick(r, W.source);
    if (n === 'variant') return pick(r, ['control', 'treatment']);
    if (n === 'experiment' || n === 'key') return pick(r, ['checkout_one_page', 'free_shipping_banner', 'size_guide_modal', 'pricing_annual_default']);
    if (n === 'interval') return pick(r, ['month', 'year']);
    if (n === 'release') return 'web@2026.10.' + Math.floor(r() * 17);
    if (n === 'name') return table === 'REALM' ? pick(r, ['master', 'shop', 'internal']) : table === 'folders' ? pick(r, ['Work', 'Personal', 'Recipes', 'Travel', 'Archive']) : table === 'tags' ? pick(r, ['todo', 'idea', 'reference', 'urgent']) : table === 'objects' ? `avatars/${hex(r, 8)}.webp` : pick(r, ['default-roles-shop', 'admin', 'offline_access', 'uma_authorization']);
    if (n === 'filename') return pick(r, ['receipt.pdf', 'whiteboard.png', 'contract-v2.pdf', 'sketch.heic']);
    if (n === 'body') return 'Draft: ' + pick(r, ['ship the new size guide before Friday', 'ask the mill about 380 gsm fleece', 'Postgres: raise work_mem for the nightly rollup', 'book the train to Porto']);
    if (n === 'ip_address') return `10.0.${Math.floor(r() * 9)}.${Math.floor(r() * 250)}`;
    if (n === 'bucket_id') return 'avatars';
    if (n === 'client_id') return pick(r, ['shop-web', 'shop-api', 'admin-console', 'account-console', 'broker']);
    if (n === 'description') return pick(r, ['Can manage orders', 'Read-only support access', '${role_offline-access}']);
    if (n === 'ssl_required') return 'EXTERNAL';
    if (n === 'v') return JSON.stringify({ enabled: r() > 0.5, rollout: Math.round(r() * 100) });
    if (/timestamp|datetime|date\b|_at$|^ts$/.test(t + ' ' + n) && !/bigint|int\b/.test(t)) return iso(DB.now - (i * 41 + r() * 60) * DB.min * (table === 'customers' ? 9 : 1));
    if (/created_timestamp|event_time|created_date|created_on|purged_at|expires_at|updated_at/.test(n)) return Math.round((DB.now - i * 3.7e6 - r() * 4e6) / (t === 'int' ? 1000 : 1));
    if (/bool|tinyint\(1\)/.test(t)) return r() > 0.3;
    if (/json/.test(t) || n === 'metadata' || n === 'props') return table === 'products' ? { color: pick(r, ['black', 'white', 'olive', 'grey']), gsm: pick(r, [180, 240, 380]), fit: pick(r, ['regular', 'boxy']) } : table === 'webhook_events' ? { object: 'event', livemode: true, data: { id: 'in_' + hex(r, 10), amount: Math.round(r() * 9000) } } : { utm_source: pick(r, W.source), ref: hex(r, 6) };
    if (/uuid/.test(t)) return uuid(r);
    if (/cents/.test(n)) return Math.round(900 + r() * (n.includes('lifetime') ? 180000 : 42000));
    if (n === 'quantity') return 1 + Math.floor(r() * 3);
    if (n === 'stock') return Math.floor(r() * 240);
    if (n === 'delta') return pick(r, [-1, -1, -2, 12, 24, -1, 48]);
    if (n === 'percent_off') return pick(r, [10, 15, 20, 25, 30]);
    if (n === 'max_uses') return pick(r, [100, 500, 1000]);
    if (/float|numeric/.test(t)) return n === 'value' ? +(r() * 3000).toFixed(1) : +(r() * 100).toFixed(2);
    if (/int|uint/.test(t)) return Math.floor(r() * (n === 'duration_s' ? 1800 : n === 'pages' ? 14 : n === 'bytes' ? 240000 : 9000));
    return pick(r, W.word) + '-' + hex(r, 4);
  }
  function dataFor(cid, tid) {
    const key = `${cid}|${tid}`;
    if (S.cache[key]) return S.cache[key];
    const t = findTable(cid, tid);
    if (!t) return [];
    const n = Math.min(t.def.rows ?? 0, 300);
    let base = [];
    if (cid === 'shop-pg' && tid === 'orders') base = DB.orders.map((o) => ({ ...o }));
    if (cid === 'shop-pg' && tid === 'customers') base = DB.customers.map((c) => ({ ...c }));
    const rows = base.slice(0, n);
    for (let i = rows.length; i < n; i++) {
      const r = rng(hash(key + i));
      const row = {};
      t.def.cols.forEach((c) => { row[c[0]] = value(cid, t.name, c, tid === 'customers' ? i + 7000 : i, r); });
      if (tid === 'customers') row.id = 10231 + i * 7;
      rows.push(row);
    }
    rows.forEach((r, i) => Object.defineProperty(r, '__rid', { value: i + 1, writable: true, configurable: true }));
    return (S.cache[key] = rows);
  }
  // tables without a primary key are matched by row position (ctid in Postgres)
  const pkCol = (t) => t.def.cols.find((c) => (c[2] || '') === 'pk')?.[0] || '__rid';

  /* ---------- formatting ---------- */
  const isNum = (type) => /int|numeric|float|decimal|real|double/i.test(type) && !/interval/i.test(type);
  const isTime = (type) => /time|date/i.test(type);
  const tsText = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? v.slice(0, 19).replace('T', ' ') : String(v));
  const raw = (v) => (v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  function cellHTML(v, col) {
    if (v === null || v === undefined) return '<span class="dbg-null">NULL</span>';
    if (typeof v === 'boolean') return `<span class="dbg-bool ${v ? 'is-t' : ''}">${v}</span>`;
    if (typeof v === 'object') return `<span class="dbg-json">${esc(JSON.stringify(v))}</span>`;
    if (isTime(col[1]) && typeof v === 'string') return esc(tsText(v));
    return esc(v);
  }
  const sqlLit = (v) => (v === null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/'/g, "''")}'`);
  function coerce(text, col) {
    if (text === '' && (col[2] || '').includes('null')) return null;
    if (/^null$/i.test(text)) return null;
    if (/bool|tinyint\(1\)/i.test(col[1])) return /^(t|true|1|yes)$/i.test(text);
    if (isNum(col[1]) && text !== '' && !isNaN(+text)) return +text;
    if (/json/i.test(col[1])) { try { return JSON.parse(text); } catch { return text; } }
    return text;
  }

  /* ---------- SQL highlighting ---------- */
  const KW = new Set('select from where and or not in is null as on join left right inner outer full cross group by order having limit offset insert into values update set delete create table alter add column drop index primary key foreign references unique default distinct case when then else end union all exists between like ilike interval begin commit rollback explain analyze with returning asc desc true false cast if constraint check'.split(' '));
  const FN = new Set('count sum avg min max now coalesce lower upper date_trunc to_char tostartofhour round length extract nullif greatest least json_agg array_agg row_number over partition'.split(' '));
  function hl(sql, cid) {
    const tables = new Set(tablesOf(cid).map((t) => t.name.toLowerCase()));
    const cols = new Set(tablesOf(cid).flatMap((t) => t.def.cols.map((c) => c[0].toLowerCase())));
    return sql.replace(/(--[^\n]*)|('(?:[^']|'')*'?)|("[^"]*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w$]*)|([^\w\s])/g, (m, com, str, qid, num, word, op, off) => {
      if (com) return `<span class="sx-com">${esc(m)}</span>`;
      if (str) return `<span class="sx-str">${esc(m)}</span>`;
      if (qid) return `<span class="sx-id">${esc(m)}</span>`;
      if (num) return `<span class="sx-num">${m}</span>`;
      if (word) {
        const w = m.toLowerCase();
        if (sql[off + m.length] === '(' && (FN.has(w) || !KW.has(w))) return `<span class="sx-fn">${m}</span>`;
        if (KW.has(w)) return `<span class="sx-kw">${m}</span>`;
        if (tables.has(w)) return `<span class="sx-tbl">${m}</span>`;
        if (cols.has(w)) return `<span class="sx-col">${m}</span>`;
        return m;
      }
      return `<span class="sx-op">${esc(m)}</span>`;
    });
  }

  /* ---------- small local popover (filter builder, column picker) ---------- */
  let pop = null;
  function dbPop(anchor, html, onMount) {
    dbPopClose();
    const el = document.createElement('div');
    el.className = 'menu float db-pop';
    el.innerHTML = html;
    document.body.append(el);
    const r = anchor.getBoundingClientRect();
    el.style.left = Math.min(innerWidth - el.offsetWidth - 8, r.left) + 'px';
    el.style.top = r.bottom + 6 + 'px';
    const away = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) dbPopClose(); };
    const key = (e) => { if (e.key === 'Escape') dbPopClose(); };
    setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', key);
    pop = { el, off: () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); } };
    onMount?.(el);
    return el;
  }
  function dbPopClose() { if (pop) { pop.off(); pop.el.remove(); pop = null; } }

  /* ---------- tabs ---------- */
  function tabFor(cid, kind, id) {
    const list = (S.tabs[cid] ||= []);
    const key = kind === 'table' ? 'table:' + id : kind === 'query' ? 'query:' + id : kind;
    let tab = list.find((t) => t.key === key);
    if (!tab) {
      tab = { key, kind, id, title: kind === 'table' ? id : kind === 'query' ? `Query ${id}` : kind === 'diagram' ? 'Schema diagram' : kind === 'history' ? 'History' : 'Keys' };
      list.push(tab);
    }
    return tab;
  }
  const tabIcon = { table: 'table', query: 'sql', diagram: 'schema', history: 'history', keys: 'key' };
  function tabsHTML(cid, active) {
    const list = S.tabs[cid] || [];
    return `<div class="dbw-tabs" role="tablist">${list.map((t) => {
      const pend = t.kind === 'table' ? pendingCount(`${cid}|${t.id}`) : 0;
      return `<button class="dbw-tab ${t === active ? 'is-active' : ''}" role="tab" aria-selected="${t === active}" data-go="${t.path}">${icon(tabIcon[t.kind], 'sm')}<span class="truncate">${esc(t.title)}</span>${pend ? `<span class="dbw-tab-dirty" data-tip="${pend} unsaved change${pend > 1 ? 's' : ''}">${pend}</span>` : ''}<span class="dbw-tab-x" data-act="db-close-tab" data-arg="${esc(t.key)}" aria-label="Close tab" data-tip="Close tab" data-kbd="⌘W">${icon('x', 'sm')}</span></button>`;
    }).join('')}<button class="btn btn-ghost btn-icon btn-sm dbw-tab-new" data-act="db-new-query" aria-label="New query" data-tip="New query" data-kbd="⌘T">${icon('plus')}</button></div>`;
  }
  App.act('db-close-tab', (el, key) => {
    const cid = App.route.params[0];
    const list = S.tabs[cid] || [];
    const i = list.findIndex((t) => t.key === key);
    if (i < 0) return;
    const t = list[i];
    if (t.kind === 'table' && pendingCount(`${cid}|${t.id}`)) {
      return confirmSheet({ title: `Discard changes to ${t.id}?`, body: `${pendingCount(`${cid}|${t.id}`)} staged changes in this tab haven't been committed. Closing the tab throws them away.`, action: 'Discard and close', onConfirm() { delete S.pending[`${cid}|${t.id}`]; closeAt(cid, i); } });
    }
    closeAt(cid, i);
  });
  function closeAt(cid, i) {
    const list = S.tabs[cid];
    const cur = location.hash.slice(1), wasActive = cur === list[i].path || cur.split('?')[0] === list[i].path;
    list.splice(i, 1);
    if (wasActive) App.go(list[Math.max(0, i - 1)]?.path || `/data/${cid}`);
    else App.rerender();
  }
  App.act('db-new-query', () => {
    const cid = App.route.params[0];
    const qs = (S.queries[cid] ||= []);
    const id = (qs.at(-1)?.id || 0) + 1;
    qs.push({ id, sql: `-- ${conn(cid).name}\nselect * from ${tablesOf(cid)[0]?.name || 'table_name'}\nlimit 100;`, result: null });
    App.go(`/data/${cid}/query?t=${id}`);
  });

  /* ---------- pending changes ---------- */
  const pend = (key) => (S.pending[key] ||= { edits: {}, added: [], deleted: new Set() });
  function pendingCount(key) {
    const p = S.pending[key];
    if (!p) return 0;
    return Object.values(p.edits).reduce((a, e) => a + Object.keys(e).length, 0) + p.added.length + p.deleted.size;
  }
  function pendingSQL(cid, t) {
    const p = S.pending[`${cid}|${t.id}`], pk = pkCol(t), q = `"${t.schema}"."${t.name}"`;
    const out = ['begin;'];
    for (const [id, cols] of Object.entries(p.edits)) {
      if (p.added.some((r) => String(r[pk]) === id)) continue;
      out.push(`update ${q}\n   set ${Object.entries(cols).map(([c, e]) => `"${c}" = ${sqlLit(e.new)}`).join(',\n       ')}\n where ${pk === '__rid' ? `ctid = '(0,${id})'` : `"${pk}" = ${sqlLit(isNaN(+id) ? id : +id)}`};`);
    }
    for (const r of p.added) {
      const row = { ...r, ...Object.fromEntries(Object.entries(p.edits[String(r[pk])] || {}).map(([c, e]) => [c, e.new])) };
      const cols = Object.keys(row).filter((c) => row[c] !== null);
      out.push(`insert into ${q} (${cols.map((c) => `"${c}"`).join(', ')})\nvalues (${cols.map((c) => sqlLit(row[c])).join(', ')});`);
    }
    if (p.deleted.size) out.push(`delete from ${q}\n where ${pk === '__rid' ? 'ctid' : `"${pk}"`} in (${[...p.deleted].map((v) => sqlLit(isNaN(+v) ? v : +v)).join(', ')});`);
    out.push('commit;');
    return out.join('\n\n');
  }
  const readOnly = (c) => c.readOnly && Date.now() > S.unsafeUntil;
  function blockedToast(c) { toast({ title: `${c.name} is read-only`, body: 'Production connections open in safe mode. Writes are blocked until you allow them.', tone: 'warn', ic: 'lock', actionLabel: 'Allow writes', action: () => App.actions['db-unsafe'](), ms: 5200 }); }
  App.act('db-unsafe', () => confirmSheet({
    title: 'Allow writes to billing-prod for 15 minutes?', danger: true, action: 'Allow writes',
    body: 'This is a production database on Neon. Every commit runs against live customer data. Safe mode turns back on automatically after 15 minutes.',
    onConfirm() { S.unsafeUntil = Date.now() + 15 * DB.min; App.rerender(); toast({ title: 'Writes allowed until ' + new Date(S.unsafeUntil).toTimeString().slice(0, 5), tone: 'warn', ic: 'lock-open' }); },
  }));

  /* ---------- connections home ---------- */
  const envChip = (c) => (c.env === 'production' ? `<span class="chip chip-bad">${icon('lock')}Production</span>` : c.env === 'staging' ? `<span class="chip chip-warn">Staging</span>` : `<span class="chip">Local</span>`);
  function home() {
    const fromCtr = DB.connections.filter((c) => c.from === 'container');
    const saved = DB.connections.filter((c) => c.from !== 'container');
    const ctrById = Object.fromEntries(DB.containers.map((c) => [c.name, c]));
    const stoppedDbs = DB.containers.filter((c) => c.db && c.state !== 'running' && !fromCtr.some((x) => x.container === c.name));
    const connected = (c) => S.connected.has(c.id);
    return `<div class="db-home" data-db-drop>
      <div class="page-head"><h1 class="h-page">Data</h1>
        <div class="search" style="width:240px">${icon('search')}<input class="input" placeholder="Filter connections" data-db-homeq aria-label="Filter connections"><span class="kbd">/</span></div>
        <button class="btn btn-brand" data-act="new-connection">${icon('plus')}New connection<span class="kbd">⌘⇧N</span></button>
      </div>
      <div class="db-home-grid">
        <div class="db-home-main">
          <section class="db-sec">
            <div class="db-sec-head"><h2 class="h-sec">In your containers</h2><span class="meta">Found automatically. Credentials come from each container’s environment.</span></div>
            <table class="tbl db-conn-tbl">
              <thead><tr><th>Name</th><th>Engine</th><th>Address</th><th>Credentials</th><th class="r"></th></tr></thead>
              <tbody>
              ${fromCtr.map((c) => {
                const ctr = ctrById[c.container];
                const up = ctr?.state === 'running';
                return `<tr data-go="/data/${c.id}" data-ctx="db-connrow" data-cid="${c.id}" data-q="${esc(c.name + ' ' + c.kind)}">
                  <td><span class="row">${tile(c)}<span class="col gap-4" style="gap:0"><b class="ink" style="font-weight:500">${esc(c.name)}</b><span class="meta">${connected(c) ? `<span class="ok-ink">${icon('plug-connected', 'sm')} Connected</span>` : up ? 'Ready to connect' : 'Container stopped'}</span></span></span></td>
                  <td>${esc(engineVersion[c.id] || engineName(c))}</td>
                  <td><span class="mono-sm ink-3">${esc(c.host)}:${c.port}</span></td>
                  <td><span class="meta">${c.kind === 'redis' ? 'No auth' : `${icon('key', 'sm')} from <span class="mono-sm">${esc(ctr?.env ? Object.keys(ctr.env).find((k) => /USER|ROOT/.test(k)) || 'env' : 'env')}</span>`}</span></td>
                  <td class="r"><button class="btn btn-sm ${connected(c) ? '' : 'btn-soft'}" data-go="/data/${c.id}">${connected(c) ? 'Open' : 'Connect'}</button></td></tr>`;
              }).join('')}
              ${stoppedDbs.map((c) => `<tr class="is-off"><td><span class="row">${tile(c, '', 'is-off')}<span class="col" style="gap:0"><b style="font-weight:500">${esc(c.name)}</b><span class="meta">${esc(c.image)}:${esc(c.tag)} · container stopped</span></span></span></td><td>MongoDB 8.0</td><td><span class="mono-sm">${esc(c.domain)}:27017</span></td><td><span class="meta">No credentials needed</span></td><td class="r"><button class="btn btn-sm" data-act="db-start-ctr" data-arg="${esc(c.name)}">${icon('player-play', 'sm')}Start and connect</button></td></tr>`).join('')}
              </tbody>
            </table>
          </section>
          <section class="db-sec">
            <div class="db-sec-head"><h2 class="h-sec">Saved connections</h2><span class="meta">Passwords are stored in your macOS Keychain.</span></div>
            <table class="tbl db-conn-tbl">
              <thead><tr><th>Name</th><th>Engine</th><th>Address</th><th>Environment</th><th class="num">Size</th><th class="r"></th></tr></thead>
              <tbody>${saved.map((c) => `<tr data-go="/data/${c.id}" data-ctx="db-connrow" data-cid="${c.id}" data-q="${esc(c.name + ' ' + c.kind + ' ' + (c.provider || ''))}">
                <td><span class="row">${tile(c)}<span class="col" style="gap:0"><b class="ink" style="font-weight:500">${esc(c.name)}</b><span class="meta">${connected(c) ? `<span class="ok-ink">${icon('plug-connected', 'sm')} Connected</span>` : c.provider ? esc(c.provider) : 'Local file'}</span></span></span></td>
                <td>${esc(engineVersion[c.id] || engineName(c))}</td>
                <td style="max-width:260px"><span class="mono-sm ink-3 truncate" style="display:block" data-tip="${esc(c.host)}">${esc(c.host)}</span></td>
                <td>${envChip(c)}</td>
                <td class="num">${fmt.mb(c.sizeMB)}</td>
                <td class="r"><span class="row-actions"><button class="btn btn-ghost btn-icon btn-sm" data-menu="db-connrow" data-cid="${c.id}" data-align="end" aria-label="More" data-tip="More">${icon('dots')}</button></span><button class="btn btn-sm ${connected(c) ? '' : 'btn-soft'}" data-go="/data/${c.id}">${connected(c) ? 'Open' : 'Connect'}</button></td></tr>`).join('')}
              </tbody>
            </table>
            <div class="db-drop-hint">${icon('file-database')}<span>Drop a <span class="mono-sm">.sqlite</span>, <span class="mono-sm">.db</span> or <span class="mono-sm">.duckdb</span> file anywhere here to open it.</span></div>
          </section>
        </div>
        <aside class="db-home-rail">
          <div class="db-sec-head"><h2 class="h-sec">Recent queries</h2></div>
          ${DB.queryHistory.slice(0, 5).map((h, i) => `<button class="db-recent" data-act="db-open-history" data-arg="${i}"><pre class="db-recent-sql">${hl(h.sql.split('\n').slice(0, 3).join('\n'), 'shop-pg')}</pre><span class="meta row">${esc(h.conn)}<span class="right num">${fmt.ago(h.at)}</span></span></button>`).join('')}
          <div class="db-sec-head" style="margin-top:20px"><h2 class="h-sec">Saved queries</h2></div>
          ${DB.savedQueries.map((q) => `<button class="db-saved" data-act="db-open-saved" data-arg="${esc(q.name)}">${icon('bookmark', 'ink-3')}<span class="grow truncate">${esc(q.name)}</span><span class="meta">${esc(q.conn)}</span></button>`).join('')}
        </aside>
      </div>
      <div class="db-dropzone">${icon('file-database', 'xl')}<b>Drop to open the database file</b></div>
    </div>`;
  }
  function mountHome(root) {
    const q = $('[data-db-homeq]', root);
    q?.addEventListener('input', () => $$('tr[data-q]', root).forEach((tr) => tr.classList.toggle('hide', !tr.dataset.q.toLowerCase().includes(q.value.toLowerCase()))));
    const zone = $('[data-db-drop]', root);
    let depth = 0;
    zone.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { depth++; zone.classList.add('is-drop'); } });
    zone.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.classList.remove('is-drop'); } });
    zone.addEventListener('dragover', (e) => e.preventDefault());
    zone.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; zone.classList.remove('is-drop'); const f = e.dataTransfer.files[0]; if (f) { toast({ title: `Opened ${f.name}`, body: 'Added to saved connections as a local SQLite file.', tone: 'ok' }); App.go('/data/notes'); } });
  }
  App.act('db-start-ctr', (el, name) => {
    el.classList.add('is-loading'); el.innerHTML = `${icon('loader-2', 'sm')}Starting…`;
    setTimeout(() => {
      const c = DB.containers.find((x) => x.name === name);
      c.state = 'running'; c.started = Date.now(); c.memMB = 162; c.cpu = 0.6;
      DB.connections.push({ id: 'mongo', name, kind: 'mongodb', host: c.domain, port: 27017, db: 'sandbox', from: 'container', container: name, env: 'local', mono: 'Mg', th: 145, tables: 3, sizeMB: 41 });
      toast({ title: `${name} started`, body: 'Connected to mongodb://mongo-sandbox.containeria.local', tone: 'ok' });
      App.rerender();
    }, 1400);
  });
  App.menu('db-connrow', (el) => {
    const c = conn(el.closest('[data-cid]').dataset.cid);
    return [
      { label: S.connected.has(c.id) ? 'Open' : 'Connect', icon: 'plug-connected', run: () => App.go('/data/' + c.id) },
      { label: 'New query', icon: 'sql', run: () => { App.go('/data/' + c.id); setTimeout(() => App.actions['db-new-query'](), 0); } },
      { label: 'Edit connection…', icon: 'pencil', run: () => connectionSheet(c) },
      { label: 'Duplicate', icon: 'copy' },
      { label: 'Copy connection string', icon: 'link', run: () => { const s = `${c.kind}://${c.user || 'user'}:••••@${c.host}${c.port ? ':' + c.port : ''}/${c.db || ''}`; navigator.clipboard?.writeText(s).catch(() => {}); toast({ title: 'Copied without the password', body: s, ic: 'copy' }); } },
      { sep: true },
      S.connected.has(c.id) ? { label: 'Disconnect', icon: 'plug-off', run: () => { S.connected.delete(c.id); App.rerender(); toast({ title: `Disconnected from ${c.name}` }); } } : { label: 'Disconnect', icon: 'plug-off', disabled: true },
      { label: 'Remove connection…', icon: 'trash', danger: true, run: () => confirmSheet({ title: `Remove ${c.name}?`, body: 'The saved connection and its Keychain password are removed. The database itself is not touched.', action: 'Remove connection', onConfirm() { DB.connections.splice(DB.connections.indexOf(c), 1); App.go('/data'); toast({ title: `${c.name} removed` }); } }) },
    ];
  });

  /* ---------- workspace shell ---------- */
  function side(cid, activeId) {
    const c = conn(cid);
    if (c.kind === 'redis') return '';
    return `<aside class="dbw-side">
      <div class="dbw-side-head">
        <button class="dbw-connbtn" data-menu="db-conn">${tile(c)}<span class="grow" style="min-width:0"><b class="ink truncate" style="display:block;font-weight:600">${esc(c.name)}</b><span class="meta truncate" style="display:block">${esc(engineVersion[cid] || engineName(c))}</span></span>${icon('selector', 'ink-3')}</button>
      </div>
      <div class="dbw-side-search search">${icon('search')}<input class="input" placeholder="Find a table or column" data-db-treeq aria-label="Find a table"></div>
      <div class="dbw-tree" data-db-tree>
        ${groups(cid).map((g, gi) => `
          <details class="dbt-group" ${gi === 0 || (activeId || '').startsWith(g.name + '.') ? 'open' : ''}>
            <summary class="dbt-row dbt-schema">${icon('chevron-right', 'sm dbt-chev')}${icon('folder', 'sm ink-3')}<span>${esc(g.name)}</span><span class="dbt-count">${Object.keys(g.tables).length + (g.more || 0)}</span></summary>
            <div class="dbt-label">Tables</div>
            ${Object.entries(g.tables).map(([n, d]) => { const id = gi ? `${g.name}.${n}` : n; return `<button class="dbt-row dbt-table ${id === activeId ? 'is-active' : ''}" data-go="/data/${cid}/${encodeURIComponent(id)}" data-ctx="db-table" data-t="${esc(id)}" data-name="${esc(n.toLowerCase())} ${esc(d.cols.map((x) => x[0].toLowerCase()).join(' '))}">${icon('table', 'sm')}<span class="truncate">${esc(n)}</span><span class="dbt-count num">${d.rows >= 1e6 ? (d.rows / 1e6).toFixed(1) + 'M' : d.rows >= 1e4 ? Math.round(d.rows / 1e3) + 'k' : fmt.num(d.rows)}</span></button>`; }).join('')}
            ${g.more ? `<div class="dbt-more meta">${g.more} more tables. Type to find them.</div>` : ''}
            ${Object.keys(g.views).length ? `<div class="dbt-label">Views</div>${Object.keys(g.views).map((v) => `<button class="dbt-row" data-act="db-view-sql" data-arg="${esc(v)}">${icon('eye', 'sm')}<span class="truncate">${esc(v)}</span></button>`).join('')}` : ''}
            ${g.functions.length ? `<div class="dbt-label">Functions</div>${g.functions.map((f) => `<button class="dbt-row" data-tip="${esc(f)}">${icon('math-function', 'sm')}<span class="truncate mono-sm">${esc(f)}</span></button>`).join('')}` : ''}
            ${Object.keys(g.enums).length ? `<div class="dbt-label">Enums</div>${Object.entries(g.enums).map(([e, vals]) => `<button class="dbt-row" data-tip="${esc(vals.join(', '))}">${icon('list-details', 'sm')}<span class="truncate">${esc(e)}</span><span class="dbt-count">${vals.length}</span></button>`).join('')}` : ''}
          </details>`).join('')}
      </div>
      <div class="dbw-side-foot">
        <button class="dbt-row" data-act="db-new-query">${icon('sql', 'sm')}New query<span class="kbd right">⌘T</span></button>
        <button class="dbt-row" data-go="/data/${cid}/diagram">${icon('schema', 'sm')}Schema diagram</button>
        <button class="dbt-row" data-go="/data/${cid}/history">${icon('history', 'sm')}History</button>
      </div>
    </aside>`;
  }
  function safeBanner(c) {
    if (!c.readOnly) return '';
    if (!readOnly(c)) return `<div class="db-safe is-open">${icon('lock-open')}<span><b>Writes allowed</b> until ${new Date(S.unsafeUntil).toTimeString().slice(0, 5)}. Commits run against production.</span><button class="btn btn-sm right" data-act="db-safe-on">Turn safe mode back on</button></div>`;
    return `<div class="db-safe">${icon('lock')}<span><b>Production, read-only.</b> Safe mode blocks inserts, updates, deletes and DDL on ${esc(c.name)}.</span><button class="btn btn-sm right" data-act="db-unsafe">Allow writes for 15 min</button></div>`;
  }
  App.act('db-safe-on', () => { S.unsafeUntil = 0; App.rerender(); toast({ title: 'Safe mode is on', ic: 'lock' }); });

  function connectingHTML(c) {
    const cols = 7;
    return `<div class="dbw"><aside class="dbw-side"><div class="dbw-side-head"><div class="dbw-connbtn">${tile(c)}<span class="grow"><b class="ink" style="font-weight:600">${esc(c.name)}</b><span class="meta" style="display:block">Connecting…</span></span></div></div><div style="padding:12px 14px" class="col">${Array.from({ length: 9 }, (_, i) => `<span class="skel" style="width:${50 + ((i * 37) % 45)}%"></span>`).join('')}</div></aside>
      <section class="dbw-main"><div class="dbw-tabs"><span class="dbw-tab is-active"><span class="skel" style="width:90px"></span></span></div>
        <div class="dbg-bar"><span class="skel" style="width:160px;height:20px"></span></div>
        <div class="dbg-skel">${Array.from({ length: 16 }, (_, r) => `<div class="dbg-skel-row">${Array.from({ length: cols }, (_, k) => `<span class="skel" style="width:${40 + ((r * 13 + k * 29) % 50)}%;animation-delay:${r * 30}ms"></span>`).join('')}</div>`).join('')}</div>
      </section></div>`;
  }
  function errorHTML(c) {
    return `<div class="empty db-error">${tile(c, 'tile-xl', 'is-bad')}<h2 class="h-sec">Couldn’t connect to ${esc(c.name)}</h2>
      <p>Supabase rejected the login for <span class="mono-sm">${esc(c.user)}</span> at <span class="mono-sm">${esc(c.host)}:${c.port}</span>.</p>
      <pre class="code db-error-msg selectable">FATAL:  password authentication failed for user "postgres"\nSQLSTATE 28P01 · after 412 ms</pre>
      <p class="meta">If the project’s database password was reset, update it here. Containeria keeps it in your Keychain.</p>
      <div class="row" style="margin-top:6px"><button class="btn btn-brand" data-act="db-retry" data-arg="${c.id}">${icon('refresh')}Try again</button><button class="btn" data-act="db-edit-conn" data-arg="${c.id}">${icon('pencil')}Edit connection</button><button class="btn btn-ghost" data-copy="FATAL: password authentication failed for user &quot;postgres&quot; (SQLSTATE 28P01)">${icon('copy')}Copy error</button></div></div>`;
  }
  App.act('db-retry', (el, cid) => { S.failing.delete(cid); S.connecting = cid; App.rerender(); });
  App.act('db-edit-conn', (el, cid) => connectionSheet(conn(cid)));

  function workspace(ctx) {
    const [cid, sub, sub2] = ctx.params;
    const c = conn(cid);
    if (!c) return `<div class="empty">${icon('database-off', 'xl')}<h2 class="h-sec">That connection is gone</h2><p>It may have been removed in another window.</p><button class="btn" data-go="/data">All connections</button></div>`;
    if (!S.connected.has(cid)) return S.failing.has(cid) && S.connecting !== cid ? errorHTML(c) : connectingHTML(c);
    if (c.kind === 'redis') { const tab = tabFor(cid, 'keys'); tab.path = `/data/${cid}`; return `<div class="dbw is-noside"><section class="dbw-main">${tabsHTML(cid, tab)}${redisHTML(c)}</section></div>`; }

    let tab, body;
    if (sub === 'query') {
      const qs = (S.queries[cid] ||= []);
      if (!qs.length) qs.push({ id: 1, sql: (DB.queryHistory.find((h) => h.conn === c.name)?.sql) || `select * from ${tablesOf(cid)[0].name}\nlimit 100;`, result: null });
      const q = qs.find((x) => x.id === +(ctx.query.t || qs[0].id)) || qs[0];
      tab = tabFor(cid, 'query', q.id); tab.path = `/data/${cid}/query?t=${q.id}`;
      body = editorHTML(cid, q);
    } else if (sub === 'diagram') {
      tab = tabFor(cid, 'diagram'); tab.path = `/data/${cid}/diagram`; body = diagramHTML(cid);
    } else if (sub === 'history') {
      tab = tabFor(cid, 'history'); tab.path = `/data/${cid}/history`; body = historyHTML(cid);
    } else {
      const tid = sub || tablesOf(cid)[0].id;
      const t = findTable(cid, tid);
      if (!t) body = `<div class="empty">${icon('table-off', 'xl')}<h2 class="h-sec">No table named ${esc(tid)}</h2><p>It may have been dropped or renamed. Refresh the schema to check.</p><button class="btn" data-act="db-refresh">${icon('refresh')}Refresh schema</button></div>`;
      else {
        tab = tabFor(cid, 'table', tid);
        tab.path = `/data/${cid}/${encodeURIComponent(tid)}${sub2 === 'structure' ? '/structure' : ''}`;
        const gs = gridState(cid, tid);
        if (ctx.query.f && gs._f !== ctx.query.f) { const [col, op, ...v] = ctx.query.f.split(':'); gs.filters = [{ col, op, val: v.join(':') }]; gs._f = ctx.query.f; gs.page = 0; }
        body = sub2 === 'structure' ? structureHTML(cid, t) : gridShell(cid, t);
      }
    }
    return `<div class="dbw">${side(cid, tab?.kind === 'table' ? tab.id : null)}<section class="dbw-main">${tabsHTML(cid, tab)}${safeBanner(c)}${body}</section></div>`;
  }

  /* ---------- grid ---------- */
  function gridState(cid, tid) {
    return (S.grid[`${cid}|${tid}`] ||= { sort: null, filters: [], page: 0, size: 100, sel: new Set(), cell: null, w: {}, hidden: new Set(), inspector: false, ms: 8 + (hash(tid) % 30) });
  }
  const OPS = [['=', '='], ['!=', '≠'], ['>', '>'], ['<', '<'], ['contains', 'contains'], ['starts', 'starts with'], ['null', 'is null'], ['notnull', 'is not null']];
  function passes(row, f) {
    const v = row[f.col], s = v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);
    switch (f.op) {
      case 'null': return s === null;
      case 'notnull': return s !== null;
      case '=': return s === f.val;
      case '!=': return s !== f.val;
      case '>': return s !== null && (isNaN(+s) ? s > f.val : +s > +f.val);
      case '<': return s !== null && (isNaN(+s) ? s < f.val : +s < +f.val);
      case 'contains': return s !== null && s.toLowerCase().includes(f.val.toLowerCase());
      case 'starts': return s !== null && s.toLowerCase().startsWith(f.val.toLowerCase());
    }
    return true;
  }
  // ponytail: filters and sort run over the loaded window (300 rows); the real app pushes them into SQL
  function visibleRows(cid, t) {
    const key = `${cid}|${t.id}`, gs = gridState(cid, t.id), p = S.pending[key];
    let rows = [...(p?.added || []), ...dataFor(cid, t.id)];
    rows = rows.filter((r) => gs.filters.every((f) => passes(r, f)));
    if (gs.sort) {
      const { col, dir } = gs.sort;
      rows = [...rows].sort((a, b) => { const x = a[col], y = b[col]; if (x === y) return 0; if (x === null) return 1; if (y === null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir; });
    }
    return rows;
  }
  const colWidth = (col, gs) => gs.w[col[0]] || (/json/i.test(col[1]) ? 240 : isTime(col[1]) ? 172 : /bool|tinyint\(1\)/i.test(col[1]) ? 88 : /email|title|message|body|full_name|name|path|payload/i.test(col[0]) ? 210 : /uuid|varchar\(36\)/i.test(col[1]) ? 280 : isNum(col[1]) ? 116 : 140);

  function filterBarHTML(cid, t) {
    const gs = gridState(cid, t.id);
    const where = gs.filters.map((f) => `${f.col} ${f.op === 'null' ? 'is null' : f.op === 'notnull' ? 'is not null' : f.op === 'contains' ? `ilike '%${f.val}%'` : f.op === 'starts' ? `ilike '${f.val}%'` : `${f.op === '!=' ? '<>' : f.op} ${isNaN(+f.val) ? `'${f.val}'` : f.val}`}`).join(' and ');
    return `<div class="dbg-bar">
      <div class="seg seg-sm" data-seg-manual><button aria-pressed="true" data-go="/data/${cid}/${encodeURIComponent(t.id)}">${icon('table', 'sm')}Data</button><button aria-pressed="false" data-go="/data/${cid}/${encodeURIComponent(t.id)}/structure">${icon('columns', 'sm')}Structure</button></div>
      <span class="vsep"></span>
      <div class="dbg-filters">
        ${gs.filters.map((f, i) => `<span class="dbf-chip"><button class="dbf-chip-body" data-db-editfilter="${i}"><span class="mono-sm ink">${esc(f.col)}</span><span class="ink-3">${esc(OPS.find((o) => o[0] === f.op)?.[1] || f.op)}</span>${['null', 'notnull'].includes(f.op) ? '' : `<span class="mono-sm brand-ink">${esc(f.val)}</span>`}</button><button class="dbf-chip-x" data-db-rmfilter="${i}" aria-label="Remove filter" data-tip="Remove filter">${icon('x', 'sm')}</button></span>`).join('<span class="meta">and</span>')}
        <button class="btn btn-ghost btn-sm" data-db-addfilter data-tip="Add a filter" data-kbd="⌘F">${icon('filter-plus', 'sm')}${gs.filters.length ? '' : 'Filter'}</button>
        ${gs.filters.length ? `<button class="btn btn-ghost btn-sm" data-db-clearfilters>Clear</button>` : ''}
      </div>
      <div class="row right gap-4">
        ${where ? `<code class="dbg-where mono-sm truncate" data-tip="Runs as: where ${esc(where)}">where ${hl(where, cid)}</code>` : ''}
        <button class="btn btn-ghost btn-icon btn-sm" data-db-cols aria-label="Columns" data-tip="Show or hide columns">${icon('columns-3')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-act="db-refresh" aria-label="Refresh" data-tip="Refresh" data-kbd="⌘R">${icon('refresh')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-act="db-export" aria-label="Export" data-tip="Export rows">${icon('table-export')}</button>
        <button class="btn btn-ghost btn-icon btn-sm ${gs.inspector ? 'is-on' : ''}" data-db-inspector aria-label="Row inspector" data-tip="Row inspector" data-kbd="⌘I">${icon('layout-sidebar-right')}</button>
      </div>
    </div>`;
  }
  function gridShell(cid, t) {
    const gs = gridState(cid, t.id);
    return `<div class="dbg-shell" data-grid-shell data-cid="${cid}" data-t="${esc(t.id)}">
      ${filterBarHTML(cid, t)}
      <div class="dbg-split ${gs.inspector ? 'has-inspector' : ''}">
        <div class="dbg-main">
          <div class="dbg-wrap" data-grid tabindex="0" aria-label="${esc(qname(t))} rows">${gridTable(cid, t)}</div>
          <div class="dbg-foot" data-grid-foot>${footHTML(cid, t)}</div>
          <div class="db-pending" data-pending>${pendingBarHTML(cid, t)}</div>
        </div>
        ${gs.inspector ? `<aside class="dbi" data-inspector>${inspectorHTML(cid, t)}</aside>` : ''}
      </div>
    </div>`;
  }
  function gridTable(cid, t) {
    const key = `${cid}|${t.id}`, gs = gridState(cid, t.id), p = S.pending[key], pk = pkCol(t);
    const cols = t.def.cols.filter((c) => !gs.hidden.has(c[0]));
    const all = visibleRows(cid, t);
    const rows = all.slice(gs.page * gs.size, (gs.page + 1) * gs.size);
    if (!rows.length) return `<div class="empty">${icon(gs.filters.length ? 'filter-off' : 'table', 'xl')}<h2 class="h-sec">${gs.filters.length ? 'No rows match these filters' : `${esc(t.name)} is empty`}</h2><p>${gs.filters.length ? 'Loosen a condition or clear the filters.' : 'Add a row or import a CSV.'}</p>${gs.filters.length ? `<button class="btn" data-db-clearfilters>Clear filters</button>` : `<div class="row"><button class="btn" data-db-addrow>${icon('row-insert-bottom')}Add row</button><button class="btn" data-act="db-import">${icon('table-import')}Import</button></div>`}</div>`;
    const width = 52 + cols.reduce((a, c) => a + colWidth(c, gs), 0);
    const allSel = rows.length && rows.every((r) => gs.sel.has(String(r[pk])));
    return `<table class="dbg" style="width:${width}px">
      <colgroup><col style="width:52px">${cols.map((c) => `<col style="width:${colWidth(c, gs)}px" data-colw="${esc(c[0])}">`).join('')}</colgroup>
      <thead><tr><th class="dbg-rn"><input type="checkbox" class="check" data-db-all ${allSel ? 'checked' : ''} aria-label="Select all rows on this page"></th>${cols.map((c) => {
        const fl = c[2] || '', s = gs.sort?.col === c[0] ? gs.sort.dir : 0;
        return `<th class="${isNum(c[1]) ? 'r' : ''} ${s ? 'is-sorted' : ''}" data-col="${esc(c[0])}" data-ctx="db-col"><div class="dbg-th"><span class="dbg-th-name">${fl === 'pk' ? `<span class="dbg-key" data-tip="Primary key">${icon('key', 'sm')}</span>` : fl.startsWith('fk:') ? `<span class="dbg-key is-fk" data-tip="References ${esc(fl.slice(3))}">${icon('link', 'sm')}</span>` : ''}${esc(c[0])}</span><span class="dbg-th-type">${esc(c[1])}</span>${s ? icon(s > 0 ? 'sort-ascending' : 'sort-descending', 'sm dbg-sort') : ''}</div><span class="dbg-rs" data-rs="${esc(c[0])}" aria-hidden="true"></span></th>`;
      }).join('')}</tr></thead>
      <tbody>${rows.map((r, ri) => {
        const id = String(r[pk]), ed = p?.edits[id] || {}, added = p?.added.includes(r), del = p?.deleted.has(id);
        return `<tr data-pk="${esc(id)}" class="${gs.sel.has(id) ? 'is-selected' : ''} ${added ? 'is-added' : ''} ${del ? 'is-deleted' : ''}"><td class="dbg-rn" data-tip="${added ? 'New row, not committed yet' : del ? 'Will be deleted on commit' : ''}">${added ? icon('plus', 'sm') : gs.page * gs.size + ri + 1}</td>${cols.map((c) => {
          const e = ed[c[0]], v = e ? e.new : r[c[0]], fl = c[2] || '';
          const isSel = gs.cell && gs.cell.pk === id && gs.cell.col === c[0];
          const fk = fl.startsWith('fk:') && v !== null ? fl.slice(3).split('.') : null;
          return `<td class="${isNum(c[1]) ? 'r' : ''} ${e ? 'is-edited' : ''} ${isSel ? 'is-cell' : ''}" data-c="${esc(c[0])}" data-ctx="db-cell" ${e ? `data-tip="Was ${esc(raw(e.old))}"` : ''}>${cellHTML(v, c)}${fk ? `<button class="dbg-jump" data-db-jump="${esc(fk[0])}:${esc(fk[1])}:${esc(v)}" aria-label="Open referenced row" data-tip="Open ${esc(fk[0])} where ${esc(fk[1])} = ${esc(v)}">${icon('link', 'sm')}</button>` : ''}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody></table>`;
  }
  function footHTML(cid, t) {
    const gs = gridState(cid, t.id), all = visibleRows(cid, t), c = conn(cid);
    const total = gs.filters.length ? all.length : Math.max(t.def.rows, all.length);
    const from = all.length ? gs.page * gs.size + 1 : 0, to = Math.min(all.length, (gs.page + 1) * gs.size);
    const pages = Math.ceil(all.length / gs.size);
    return `<span class="meta num">${icon('table', 'sm')} ${fmt.num(from)}–${fmt.num(to)} of ${fmt.num(total)} ${gs.filters.length ? 'matching ' : ''}rows · ${gs.ms} ms</span>
      ${gs.sel.size ? `<span class="dbg-selinfo">${gs.sel.size} selected <button class="btn btn-danger-ghost btn-sm" data-db-delrows>${icon('trash', 'sm')}Delete</button><button class="btn btn-ghost btn-sm" data-act="db-export">Export selected</button></span>` : ''}
      <span class="row right gap-4">
        <button class="btn btn-ghost btn-sm" data-db-addrow ${readOnly(c) ? 'data-ro' : ''}>${icon('row-insert-bottom', 'sm')}Add row</button>
        <span class="vsep"></span>
        <select class="select dbg-size" data-db-size aria-label="Rows per page">${[50, 100, 500].map((n) => `<option value="${n}" ${gs.size === n ? 'selected' : ''}>${n} per page</option>`).join('')}</select>
        <button class="btn btn-ghost btn-icon btn-sm" data-db-page="-1" ${gs.page ? '' : 'disabled'} aria-label="Previous page" data-tip="Previous page">${icon('chevron-left')}</button>
        <span class="meta num">${pages ? gs.page + 1 : 0} / ${fmt.num(gs.filters.length ? pages : Math.ceil(total / gs.size))}</span>
        <button class="btn btn-ghost btn-icon btn-sm" data-db-page="1" ${gs.page + 1 < pages ? '' : 'disabled'} aria-label="Next page" data-tip="Next page">${icon('chevron-right')}</button>
      </span>`;
  }
  function pendingBarHTML(cid, t) {
    const key = `${cid}|${t.id}`, n = pendingCount(key);
    if (!n) return '';
    const p = S.pending[key];
    const edited = Object.values(p.edits).reduce((a, e) => a + Object.keys(e).length, 0);
    const parts = [edited && `${edited} edited`, p.added.length && `${p.added.length} added`, p.deleted.size && `${p.deleted.size} deleted`].filter(Boolean).join(' · ');
    return `<div class="db-pending-bar" role="status"><span class="db-pending-n num">${n}</span><span class="col" style="gap:0"><b class="ink">${n} change${n > 1 ? 's' : ''} to ${esc(t.name)}</b><span class="meta">${parts}</span></span>
      <span class="row right gap-4"><button class="btn btn-ghost btn-sm" data-db-review>${icon('code', 'sm')}Review SQL</button><button class="btn btn-ghost btn-sm" data-db-discard>Discard</button><button class="btn btn-brand btn-sm" data-db-commit>Commit<span class="kbd">⌘S</span></button></span></div>`;
  }
  function inspectorHTML(cid, t) {
    const gs = gridState(cid, t.id), pk = pkCol(t);
    const id = gs.cell?.pk || [...gs.sel][0];
    const row = id && visibleRows(cid, t).find((r) => String(r[pk]) === id);
    if (!row) return `<div class="dbi-empty">${icon('layout-sidebar-right', 'lg')}<p>Select a row to see every field.</p><p class="meta">Long text and JSON open here in full.</p></div>`;
    const ed = S.pending[`${cid}|${t.id}`]?.edits[id] || {};
    return `<div class="dbi-head"><b class="ink">${esc(t.name)}</b><span class="mono-sm ink-3 truncate">${pk === '__rid' ? `row ${esc(id)}` : `${esc(pk)} = ${esc(id)}`}</span>
        <span class="row right gap-4"><button class="btn btn-ghost btn-icon btn-sm" data-db-step="-1" aria-label="Previous row" data-tip="Previous row" data-kbd="↑">${icon('chevron-up')}</button><button class="btn btn-ghost btn-icon btn-sm" data-db-step="1" aria-label="Next row" data-tip="Next row" data-kbd="↓">${icon('chevron-down')}</button><button class="btn btn-ghost btn-icon btn-sm" data-db-inspector aria-label="Close inspector" data-tip="Close">${icon('x')}</button></span></div>
      <div class="dbi-body">${t.def.cols.map((c) => {
        const e = ed[c[0]], v = e ? e.new : row[c[0]];
        const long = v !== null && (typeof v === 'object' || String(v).length > 40);
        return `<div class="dbi-field ${e ? 'is-edited' : ''}"><div class="dbi-label"><span class="ink" style="font-weight:500">${esc(c[0])}</span><span class="mono-sm ink-3">${esc(c[1])}</span>${e ? '<span class="chip chip-brand" style="height:18px">Edited</span>' : ''}</div>
          ${long ? `<pre class="dbi-val is-long selectable" data-dbi-col="${esc(c[0])}">${typeof v === 'object' ? esc(JSON.stringify(v, null, 2)) : esc(v)}</pre>` : `<div class="dbi-val selectable" data-dbi-col="${esc(c[0])}" tabindex="0">${cellHTML(v, c)}</div>`}</div>`;
      }).join('')}</div>
      <div class="dbi-foot"><button class="btn btn-sm" data-db-copyrow="json">${icon('braces', 'sm')}Copy as JSON</button><button class="btn btn-sm" data-db-copyrow="sql">${icon('sql', 'sm')}Copy as insert</button></div>`;
  }

  function mountGrid(root, cid, t) {
    const shell = $('[data-grid-shell]', root);
    if (!shell) return;
    const key = `${cid}|${t.id}`, gs = gridState(cid, t.id), pk = pkCol(t), c = conn(cid);
    const wrap = $('[data-grid]', shell);
    const paint = ({ table = true, keepScroll = true } = {}) => {
      const st = wrap.scrollTop, sl = wrap.scrollLeft;
      if (table) wrap.innerHTML = gridTable(cid, t);
      $('[data-grid-foot]', shell).innerHTML = footHTML(cid, t);
      $('[data-pending]', shell).innerHTML = pendingBarHTML(cid, t);
      const ins = $('[data-inspector]', shell); if (ins) ins.innerHTML = inspectorHTML(cid, t);
      const bar = $('.dbg-bar', shell); bar.outerHTML = filterBarHTML(cid, t); $$('.seg', shell).forEach(segThumb);
      $('.dbw-tabs')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: tabsHTML(cid, (S.tabs[cid] || []).find((x) => x.key === 'table:' + t.id)) }).firstElementChild);
      if (keepScroll) { wrap.scrollTop = st; wrap.scrollLeft = sl; }
    };
    shell._paint = paint;

    const rowById = (id) => visibleRows(cid, t).find((r) => String(r[pk]) === id);
    const colDef = (name) => t.def.cols.find((x) => x[0] === name);
    const setEdit = (id, col, newV) => {
      const row = rowById(id); if (!row) return;
      const p = pend(key), e = (p.edits[id] ||= {});
      const old = e[col] ? e[col].old : row[col];
      if (JSON.stringify(old) === JSON.stringify(newV)) delete e[col]; else e[col] = { old, new: newV };
      if (!Object.keys(e).length) delete p.edits[id];
    };

    function startEdit(td) {
      if (readOnly(c)) return blockedToast(c);
      const tr = td.closest('tr'), id = tr.dataset.pk, col = td.dataset.c, def = colDef(col);
      if (!def || tr.classList.contains('is-deleted')) return;
      const e = S.pending[key]?.edits[id]?.[col];
      const cur = e ? e.new : rowById(id)[col];
      const big = /json/i.test(def[1]) || (typeof cur === 'string' && cur.length > 60);
      const input = document.createElement(big ? 'textarea' : 'input');
      input.className = 'dbg-edit';
      input.value = cur === null ? '' : typeof cur === 'object' ? JSON.stringify(cur, null, 2) : isTime(def[1]) ? tsText(cur) : String(cur);
      input.placeholder = (def[2] || '').includes('null') ? 'NULL' : '';
      input.spellcheck = false;
      td.classList.add('is-editing');
      td.append(input);
      input.focus(); input.select();
      let done = false;
      const finish = (save, move) => {
        if (done) return; done = true;
        if (save) {
          let v = coerce(input.value, def);
          if (isTime(def[1]) && typeof cur === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(input.value)) v = input.value.replace(' ', 'T') + cur.slice(19);
          if (isTime(def[1]) && input.value === tsText(cur)) v = cur;
          setEdit(id, col, v);
        }
        gs.cell = { pk: id, col };
        paint();
        if (move) {
          const cols = t.def.cols.filter((x) => !gs.hidden.has(x[0])).map((x) => x[0]);
          const next = cols[cols.indexOf(col) + move];
          const ntd = next && wrap.querySelector(`tr[data-pk="${CSS.escape(id)}"] td[data-c="${CSS.escape(next)}"]`);
          if (ntd) startEdit(ntd);
        } else wrap.focus({ preventScroll: true });
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
        if (ev.key === 'Enter' && (!big || ev.metaKey)) { ev.preventDefault(); finish(true); }
        if (ev.key === 'Tab') { ev.preventDefault(); finish(true, ev.shiftKey ? -1 : 1); }
      });
      input.addEventListener('blur', () => finish(true));
    }
    shell._startEdit = startEdit;

    shell.addEventListener('click', (e) => {
      const tg = e.target;
      if (tg.closest('[data-db-addfilter]')) return filterPop(tg.closest('[data-db-addfilter]'), cid, t, null, paint);
      const ef = tg.closest('[data-db-editfilter]'); if (ef) return filterPop(ef, cid, t, +ef.dataset.dbEditfilter, paint);
      const rf = tg.closest('[data-db-rmfilter]'); if (rf) { gs.filters.splice(+rf.dataset.dbRmfilter, 1); gs.page = 0; gs._f = null; return paint(); }
      if (tg.closest('[data-db-clearfilters]')) { gs.filters = []; gs.page = 0; return paint(); }
      if (tg.closest('[data-db-inspector]')) { gs.inspector = !gs.inspector; return App.rerender(); }
      if (tg.closest('[data-db-cols]')) return colsPop(tg.closest('[data-db-cols]'), t, gs, paint);
      const pg = tg.closest('[data-db-page]'); if (pg) { gs.page += +pg.dataset.dbPage; wrap.scrollTop = 0; return paint({ keepScroll: false }); }
      if (tg.closest('[data-db-addrow]')) {
        if (readOnly(c)) return blockedToast(c);
        const p = pend(key);
        const maxId = Math.max(0, ...[...p.added, ...dataFor(cid, t.id)].map((r) => +r[pk]).filter((n) => !isNaN(n)));
        const row = Object.fromEntries(t.def.cols.map((x) => [x[0], null]));
        if (pk === '__rid') Object.defineProperty(row, '__rid', { value: maxId + 1, writable: true }); else row[pk] = /uuid|varchar\(36\)/i.test(colDef(pk)?.[1] || '') ? uuid(rng(Date.now())) : maxId + 1;
        p.added.unshift(row);
        gs.page = 0; gs.cell = { pk: String(row[pk]), col: t.def.cols[1]?.[0] || pk };
        paint(); wrap.scrollTop = 0;
        const td = wrap.querySelector(`tr[data-pk="${CSS.escape(String(row[pk]))}"] td[data-c="${CSS.escape(gs.cell.col)}"]`);
        if (td) startEdit(td);
        return;
      }
      if (tg.closest('[data-db-delrows]')) {
        if (readOnly(c)) return blockedToast(c);
        const p = pend(key);
        gs.sel.forEach((id) => { const a = p.added.findIndex((r) => String(r[pk]) === id); if (a >= 0) p.added.splice(a, 1); else p.deleted.add(id); });
        gs.sel.clear(); return paint();
      }
      if (tg.closest('[data-db-review]')) return reviewSheet(cid, t, paint);
      if (tg.closest('[data-db-discard]')) { delete S.pending[key]; paint(); return toast({ title: 'Changes discarded', ic: 'arrow-back-up' }); }
      if (tg.closest('[data-db-commit]')) return commit(cid, t, paint);
      const step = tg.closest('[data-db-step]'); if (step) return stepRow(+step.dataset.dbStep);
      const cr = tg.closest('[data-db-copyrow]'); if (cr) return copyRow(cr.dataset.dbCopyrow);
      const jump = tg.closest('[data-db-jump]');
      if (jump) { const [tb, col, ...v] = jump.dataset.dbJump.split(':'); const target = tablesOf(cid).find((x) => x.name === tb); if (target) App.go(`/data/${cid}/${encodeURIComponent(target.id)}?f=${encodeURIComponent(`${col}:=:${v.join(':')}`)}`); return; }
      const sortTh = tg.closest('th[data-col]');
      if (sortTh && !tg.closest('.dbg-rs')) { const col = sortTh.dataset.col; gs.sort = gs.sort?.col !== col ? { col, dir: 1 } : gs.sort.dir === 1 ? { col, dir: -1 } : null; return paint(); }
      if (tg.closest('[data-db-all]')) { const rows = visibleRows(cid, t).slice(gs.page * gs.size, (gs.page + 1) * gs.size); const on = tg.checked; rows.forEach((r) => (on ? gs.sel.add(String(r[pk])) : gs.sel.delete(String(r[pk])))); return paint(); }
      const rn = tg.closest('td.dbg-rn');
      if (rn) { const id = rn.parentElement.dataset.pk; if (e.metaKey || e.shiftKey) gs.sel.has(id) ? gs.sel.delete(id) : gs.sel.add(id); else { gs.sel = new Set(gs.sel.size === 1 && gs.sel.has(id) ? [] : [id]); } gs.cell = null; return paint(); }
      const td = tg.closest('td[data-c]');
      if (td && !td.classList.contains('is-editing')) {
        const id = td.parentElement.dataset.pk;
        gs.cell = { pk: id, col: td.dataset.c };
        if (e.metaKey) gs.sel.has(id) ? gs.sel.delete(id) : gs.sel.add(id); else if (!gs.sel.has(id)) gs.sel = new Set();
        $$('td.is-cell', wrap).forEach((x) => x.classList.remove('is-cell')); td.classList.add('is-cell');
        const ins = $('[data-inspector]', shell); if (ins) ins.innerHTML = inspectorHTML(cid, t);
        $('[data-grid-foot]', shell).innerHTML = footHTML(cid, t);
        wrap.focus({ preventScroll: true });
      }
    });
    shell.addEventListener('dblclick', (e) => { const td = e.target.closest('td[data-c]'); if (td && !e.target.closest('.dbg-jump')) startEdit(td); });
    shell.addEventListener('change', (e) => { if (e.target.matches('[data-db-size]')) { gs.size = +e.target.value; gs.page = 0; paint(); } });

    // keyboard on the grid: arrows move, Enter edits, Delete sets NULL, ⌘C copies
    wrap.addEventListener('keydown', (e) => {
      if (e.target !== wrap || !gs.cell) return;
      const cols = t.def.cols.filter((x) => !gs.hidden.has(x[0])).map((x) => x[0]);
      const rows = visibleRows(cid, t).slice(gs.page * gs.size, (gs.page + 1) * gs.size).map((r) => String(r[pk]));
      let ri = rows.indexOf(gs.cell.pk), ci = cols.indexOf(gs.cell.col);
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[e.key]) {
        e.preventDefault();
        ri = Math.max(0, Math.min(rows.length - 1, ri + moves[e.key][0])); ci = Math.max(0, Math.min(cols.length - 1, ci + moves[e.key][1]));
        gs.cell = { pk: rows[ri], col: cols[ci] };
        $$('td.is-cell', wrap).forEach((x) => x.classList.remove('is-cell'));
        const td = wrap.querySelector(`tr[data-pk="${CSS.escape(gs.cell.pk)}"] td[data-c="${CSS.escape(gs.cell.col)}"]`);
        td?.classList.add('is-cell'); td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const ins = $('[data-inspector]', shell); if (ins) ins.innerHTML = inspectorHTML(cid, t);
      } else if (e.key === 'Enter') { e.preventDefault(); const td = $('td.is-cell', wrap); if (td) startEdit(td); }
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (readOnly(c)) return blockedToast(c);
        const def = colDef(gs.cell.col);
        if ((def[2] || '').includes('null')) { setEdit(gs.cell.pk, gs.cell.col, null); paint(); } else toast({ title: `${def[0]} can’t be NULL`, body: `The column is declared not null.`, tone: 'warn' });
      } else if (e.key.toLowerCase() === 'c' && e.metaKey) {
        const v = rowById(gs.cell.pk)?.[gs.cell.col];
        navigator.clipboard?.writeText(raw(v)).catch(() => {}); toast({ title: 'Copied', body: raw(v).slice(0, 80), ic: 'copy', ms: 1600 });
      }
    });

    // column resize
    shell.addEventListener('mousedown', (e) => {
      const rs = e.target.closest('[data-rs]'); if (!rs) return;
      e.preventDefault();
      const name = rs.dataset.rs, colEl = wrap.querySelector(`col[data-colw="${CSS.escape(name)}"]`), table = $('table', wrap);
      const x0 = e.clientX, w0 = colEl.offsetWidth || parseFloat(colEl.style.width), tw0 = table.offsetWidth;
      document.body.classList.add('db-resizing');
      const move = (ev) => { const w = Math.max(64, w0 + ev.clientX - x0); colEl.style.width = w + 'px'; table.style.width = tw0 + (w - w0) + 'px'; gs.w[name] = w; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('db-resizing'); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });

    function stepRow(d) {
      const rows = visibleRows(cid, t).slice(gs.page * gs.size, (gs.page + 1) * gs.size).map((r) => String(r[pk]));
      const cur = gs.cell?.pk || [...gs.sel][0];
      const i = Math.max(0, Math.min(rows.length - 1, rows.indexOf(cur) + d));
      gs.cell = { pk: rows[i], col: gs.cell?.col || pk };
      paint();
      wrap.querySelector(`tr[data-pk="${CSS.escape(rows[i])}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    function copyRow(kind) {
      const id = gs.cell?.pk || [...gs.sel][0], row = rowById(id); if (!row) return;
      const ed = S.pending[key]?.edits[id] || {};
      const r = { ...row, ...Object.fromEntries(Object.entries(ed).map(([k, v]) => [k, v.new])) };
      const text = kind === 'json' ? JSON.stringify(r, null, 2) : `insert into "${t.schema}"."${t.name}" (${Object.keys(r).map((k) => `"${k}"`).join(', ')})\nvalues (${Object.values(r).map(sqlLit).join(', ')});`;
      navigator.clipboard?.writeText(text).catch(() => {});
      toast({ title: kind === 'json' ? 'Row copied as JSON' : 'Row copied as an insert statement', ic: 'copy', ms: 1800 });
    }

    App.menu('db-cell', (td) => {
      const id = td.closest('tr').dataset.pk, col = td.dataset.c, def = colDef(col), v = rowById(id)?.[col];
      gs.cell = { pk: id, col };
      return [
        { label: 'Edit cell', icon: 'pencil', kbd: '↵', run: () => startEdit(wrap.querySelector(`tr[data-pk="${CSS.escape(id)}"] td[data-c="${CSS.escape(col)}"]`)) },
        { label: 'Set to NULL', icon: 'circle-off', disabled: !(def[2] || '').includes('null'), run: () => { if (readOnly(c)) return blockedToast(c); setEdit(id, col, null); paint(); } },
        { sep: true },
        { label: 'Copy value', icon: 'copy', kbd: '⌘C', run: () => { navigator.clipboard?.writeText(raw(v)).catch(() => {}); toast({ title: 'Copied', ic: 'copy', ms: 1500 }); } },
        { label: 'Copy row as JSON', icon: 'braces', run: () => copyRow('json') },
        { label: 'Copy row as insert', icon: 'sql', run: () => copyRow('sql') },
        { sep: true },
        { label: `Filter where ${col} = this`, icon: 'filter', run: () => { gs.filters.push({ col, op: v === null ? 'null' : '=', val: raw(v) }); gs.page = 0; paint(); } },
        { label: `Filter where ${col} ≠ this`, icon: 'filter-x', run: () => { gs.filters.push({ col, op: v === null ? 'notnull' : '!=', val: raw(v) }); gs.page = 0; paint(); } },
        { sep: true },
        { label: 'Duplicate row', icon: 'copy-plus', run: () => { if (readOnly(c)) return blockedToast(c); const p = pend(key); const src = rowById(id); const maxId = Math.max(...dataFor(cid, t.id).map((r) => +r[pk]).filter((n) => !isNaN(n)), ...p.added.map((r) => +r[pk])); p.added.unshift({ ...src, [pk]: isNaN(maxId) ? uuid(rng(Date.now())) : maxId + 1 }); paint(); } },
        { label: 'Delete row', icon: 'trash', danger: true, run: () => { if (readOnly(c)) return blockedToast(c); const p = pend(key); const a = p.added.findIndex((r) => String(r[pk]) === id); if (a >= 0) p.added.splice(a, 1); else p.deleted.add(id); paint(); } },
      ];
    });
    App.menu('db-col', (th) => {
      const col = th.dataset.col;
      return [
        { heading: col },
        { label: 'Sort ascending', icon: 'sort-ascending', run: () => { gs.sort = { col, dir: 1 }; paint(); } },
        { label: 'Sort descending', icon: 'sort-descending', run: () => { gs.sort = { col, dir: -1 }; paint(); } },
        { label: 'Filter by this column…', icon: 'filter-plus', run: () => filterPop($('[data-db-addfilter]', shell), cid, t, null, paint, col) },
        { sep: true },
        { label: 'Hide column', icon: 'eye-off', run: () => { gs.hidden.add(col); paint(); } },
        { label: 'Reset width', icon: 'arrows-horizontal', run: () => { delete gs.w[col]; paint(); } },
        { label: 'Copy name', icon: 'copy', run: () => { navigator.clipboard?.writeText(col).catch(() => {}); toast({ title: 'Copied', body: col, ic: 'copy', ms: 1500 }); } },
      ];
    });

    App.on('key', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (pendingCount(key)) commit(cid, t, paint); else toast({ title: 'Nothing to commit', ms: 1400 }); }
      if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); filterPop($('[data-db-addfilter]', shell), cid, t, null, paint); }
      if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); gs.inspector = !gs.inspector; App.rerender(); }
      if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); App.actions['db-refresh'](); }
    });
  }

  function filterPop(anchor, cid, t, idx, paint, presetCol) {
    const gs = gridState(cid, t.id);
    const f = idx != null ? gs.filters[idx] : { col: presetCol || t.def.cols[0][0], op: '=', val: '' };
    dbPop(anchor, `<form class="dbf-pop" data-dbf>
      <div class="menu-label">${idx != null ? 'Edit filter' : 'Add filter'}</div>
      <div class="dbf-grid">
        <select class="select" name="col" aria-label="Column">${t.def.cols.map((c) => `<option value="${esc(c[0])}" ${c[0] === f.col ? 'selected' : ''}>${esc(c[0])}</option>`).join('')}</select>
        <select class="select" name="op" aria-label="Operator">${OPS.map((o) => `<option value="${o[0]}" ${o[0] === f.op ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>
        <input class="input mono" name="val" placeholder="Value" value="${esc(f.val)}" aria-label="Value" autocomplete="off">
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><span class="meta grow">Filters combine with and.</span><button type="button" class="btn btn-sm" data-cancel>Cancel</button><button class="btn btn-brand btn-sm">${idx != null ? 'Update' : 'Apply'}</button></div>
    </form>`, (el) => {
      const form = $('form', el), val = form.elements.val, op = form.elements.op;
      const sync = () => (val.disabled = ['null', 'notnull'].includes(op.value));
      op.onchange = sync; sync();
      setTimeout(() => (val.disabled ? op : val).focus(), 30);
      $('[data-cancel]', el).onclick = dbPopClose;
      form.onsubmit = (e) => {
        e.preventDefault();
        const nf = { col: form.elements.col.value, op: op.value, val: val.value };
        if (!['null', 'notnull'].includes(nf.op) && !nf.val) { val.classList.add('is-error'); val.focus(); return; }
        if (idx != null) gs.filters[idx] = nf; else gs.filters.push(nf);
        gs.page = 0; dbPopClose(); paint();
      };
    });
  }
  function colsPop(anchor, t, gs, paint) {
    dbPop(anchor, `<div class="menu-label">Columns</div>${t.def.cols.map((c) => `<label class="menu-item dbc-item"><input type="checkbox" class="check" data-c="${esc(c[0])}" ${gs.hidden.has(c[0]) ? '' : 'checked'}><span class="grow">${esc(c[0])}</span><span class="mono-sm ink-3">${esc(c[1])}</span></label>`).join('')}<div class="menu-sep"></div><button class="menu-item" data-showall>${icon('eye')}Show all columns</button>`, (el) => {
      el.addEventListener('change', (e) => { const n = e.target.dataset.c; if (e.target.checked) gs.hidden.delete(n); else gs.hidden.add(n); paint(); });
      $('[data-showall]', el).onclick = () => { gs.hidden.clear(); dbPopClose(); paint(); };
    });
  }
  function reviewSheet(cid, t, paint) {
    const sql = pendingSQL(cid, t);
    sheet({
      title: `Review ${pendingCount(`${cid}|${t.id}`)} changes`, width: 640,
      body: `<p class="meta" style="margin:0 0 10px">These statements run in one transaction on <b class="ink">${esc(conn(cid).name)}</b>. If any of them fails, nothing is written.</p><pre class="code db-review selectable">${hl(sql, cid)}</pre>`,
      foot: `<button class="btn btn-ghost" data-copy="${esc(sql)}">${icon('copy')}Copy SQL</button><div class="right"><button class="btn" data-close>Keep editing</button><button class="btn btn-brand" data-ok>Commit<span class="kbd">⌘S</span></button></div>`,
      onMount(el, close) { $('[data-ok]', el).onclick = () => { close(); commit(cid, t, paint); }; },
    });
  }
  function commit(cid, t, paint) {
    const c = conn(cid), key = `${cid}|${t.id}`, p = S.pending[key];
    if (!p) return;
    if (readOnly(c)) return blockedToast(c);
    const n = pendingCount(key), pk = pkCol(t), rows = dataFor(cid, t.id);
    for (const [id, cols] of Object.entries(p.edits)) {
      const r = rows.find((x) => String(x[pk]) === id) || p.added.find((x) => String(x[pk]) === id);
      if (r) for (const [col, e] of Object.entries(cols)) r[col] = e.new;
    }
    rows.unshift(...p.added);
    S.cache[key] = rows.filter((r) => !p.deleted.has(String(r[pk])));
    delete S.pending[key];
    gridState(cid, t.id).sel.clear();
    paint?.();
    toast({ title: `Committed ${n} change${n > 1 ? 's' : ''} to ${t.name}`, body: `One transaction · ${11 + (n % 9)} ms`, tone: 'ok' });
  }

  /* ---------- structure ---------- */
  function structureHTML(cid, t) {
    const cols = t.def.cols;
    const fks = cols.filter((c) => (c[2] || '').startsWith('fk:'));
    const uniq = cols.filter((c) => (c[2] || '').includes('unique'));
    const pk = pkCol(t);
    const defaults = { id: `nextval('${t.name}_id_seq')`, created_at: 'now()', placed_at: 'now()', status: "'pending'", active: 'true', marketing_opt_in: 'false', currency: "'EUR'", stock: '0' };
    const indexes = [
      ...(pk === '__rid' ? [] : [{ name: `${t.name}_pkey`, cols: pk, kind: 'btree', unique: true, size: '1.1 MB' }]),
      ...fks.map((c) => ({ name: `${t.name}_${c[0]}_idx`, cols: c[0], kind: 'btree', size: '880 kB' })),
      ...uniq.map((c) => ({ name: `${t.name}_${c[0]}_key`, cols: c[0], kind: 'btree', unique: true, size: '640 kB' })),
      ...(t.name === 'orders' ? [{ name: 'orders_placed_at_brin', cols: 'placed_at', kind: 'brin', size: '24 kB' }, { name: 'orders_status_partial_idx', cols: "status where status = 'pending'", kind: 'btree', size: '16 kB' }] : []),
    ];
    const ddl = `create table "${t.schema}"."${t.name}" (\n${cols.map((c) => `  "${c[0]}" ${c[1]}${(c[2] || '').includes('null') ? '' : ' not null'}${defaults[c[0]] ? ' default ' + defaults[c[0]] : ''}`).join(',\n')}${pk === '__rid' ? '' : `,\n  primary key ("${pk}")`}${fks.map((c) => { const [tb, col] = c[2].slice(3).split('.'); return `,\n  foreign key ("${c[0]}") references "${tb}" ("${col}")`; }).join('')}\n);`;
    return `<div class="dbg-shell"><div class="dbg-bar">
        <div class="seg seg-sm" data-seg-manual><button aria-pressed="false" data-go="/data/${cid}/${encodeURIComponent(t.id)}">${icon('table', 'sm')}Data</button><button aria-pressed="true" data-go="/data/${cid}/${encodeURIComponent(t.id)}/structure">${icon('columns', 'sm')}Structure</button></div>
        <span class="meta">${fmt.num(t.def.rows)} rows · ${fmt.mb(t.def.sizeMB)} on disk · ${indexes.length} indexes</span>
        <div class="row right gap-4"><button class="btn btn-sm" data-act="db-add-column" data-arg="${esc(t.id)}">${icon('column-insert-right', 'sm')}Add column</button><button class="btn btn-ghost btn-sm" data-copy="${esc(ddl)}">${icon('copy', 'sm')}Copy DDL</button></div>
      </div>
      <div class="db-struct">
        <section><h3 class="h-sub">Columns</h3>
          <table class="tbl db-struct-tbl"><thead><tr><th>Name</th><th>Type</th><th>Nullable</th><th>Default</th><th>Key</th><th class="r"></th></tr></thead><tbody>
          ${cols.map((c) => { const fl = c[2] || ''; return `<tr><td><span class="mono ink">${esc(c[0])}</span></td><td><span class="mono brand-ink">${esc(c[1])}</span></td><td>${fl.includes('null') ? '<span class="meta">nullable</span>' : '<span class="ink-3">not null</span>'}</td><td><span class="mono-sm ink-3">${esc(defaults[c[0]] || '—')}</span></td><td>${fl === 'pk' ? `<span class="chip">${icon('key')}Primary</span>` : fl.startsWith('fk:') ? `<a class="chip" data-go="/data/${cid}/${encodeURIComponent(fl.slice(3).split('.')[0])}/structure">${icon('link')}${esc(fl.slice(3))}</a>` : fl.includes('unique') ? '<span class="chip">Unique</span>' : ''}</td><td class="r"><span class="row-actions"><button class="btn btn-ghost btn-icon btn-sm" data-tip="Rename column">${icon('pencil')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="db-drop-col" data-arg="${esc(c[0])}" data-tip="Drop column">${icon('trash')}</button></span></td></tr>`; }).join('')}
          </tbody></table></section>
        <section><h3 class="h-sub">Indexes</h3>
          <table class="tbl db-struct-tbl"><thead><tr><th>Name</th><th>Columns</th><th>Method</th><th>Unique</th><th class="num">Size</th></tr></thead><tbody>
          ${indexes.map((ix) => `<tr><td><span class="mono ink">${esc(ix.name)}</span></td><td><span class="mono-sm">${hl(ix.cols, cid)}</span></td><td>${ix.kind}</td><td>${ix.unique ? icon('check', 'ok-ink') : '<span class="ink-4">—</span>'}</td><td class="num">${ix.size}</td></tr>`).join('')}
          </tbody></table></section>
        ${fks.length ? `<section><h3 class="h-sub">Foreign keys</h3><table class="tbl db-struct-tbl"><thead><tr><th>Constraint</th><th>Column</th><th>References</th><th>On delete</th></tr></thead><tbody>
          ${fks.map((c) => `<tr><td><span class="mono ink">${esc(t.name)}_${esc(c[0])}_fkey</span></td><td><span class="mono">${esc(c[0])}</span></td><td><a class="mono" data-go="/data/${cid}/${encodeURIComponent(c[2].slice(3).split('.')[0])}">${esc(c[2].slice(3))}</a></td><td>${c[0].includes('order') ? 'cascade' : 'restrict'}</td></tr>`).join('')}
          </tbody></table></section>` : ''}
        <section><h3 class="h-sub">Constraints</h3><table class="tbl db-struct-tbl"><thead><tr><th>Name</th><th>Definition</th></tr></thead><tbody>
          ${pk === '__rid' ? `<tr><td colspan="2"><span class="warn-ink row">${icon('alert-triangle', 'sm')}No primary key. Edits match rows by their physical position, so add one before editing in bulk.</span></td></tr>` : `<tr><td><span class="mono ink">${esc(t.name)}_pkey</span></td><td><span class="mono-sm">${hl(`primary key (${pk})`, cid)}</span></td></tr>`}
          ${cols.filter((c) => /cents|stock|quantity/.test(c[0])).map((c) => `<tr><td><span class="mono ink">${esc(t.name)}_${esc(c[0])}_check</span></td><td><span class="mono-sm">${hl(`check (${c[0]} >= 0)`, cid)}</span></td></tr>`).join('')}
          </tbody></table></section>
        <section><h3 class="h-sub">Definition</h3><pre class="code selectable">${hl(ddl, cid)}</pre></section>
      </div></div>`;
  }
  App.act('db-drop-col', (el, col) => {
    const [cid, tid] = App.route.params, c = conn(cid);
    if (readOnly(c)) return blockedToast(c);
    confirmSheet({ title: `Drop column ${col}?`, body: `Every value in <b>${esc(tid)}.${esc(col)}</b> is deleted. Indexes and constraints that use it are dropped too. This can’t be undone.`, action: 'Drop column', onConfirm: () => toast({ title: `Dropped ${col}`, body: `alter table ${tid} drop column ${col}`, tone: 'ok' }) });
  });
  App.act('db-add-column', (el, tid) => {
    const cid = App.route.params[0], c = conn(cid);
    if (readOnly(c)) return blockedToast(c);
    const types = ['text', 'integer', 'bigint', 'boolean', 'numeric(12,2)', 'timestamptz', 'date', 'uuid', 'jsonb', 'citext'];
    sheet({
      title: `Add column to ${tid}`, ic: 'column-insert-right', width: 540,
      body: `<div class="col gap-16"><div class="row gap-12"><label class="field grow"><span class="label">Name</span><input class="input mono" name="n" placeholder="gift_message" autocomplete="off"></label><label class="field" style="width:170px"><span class="label">Type</span><select class="select" name="t">${types.map((x) => `<option>${x}</option>`).join('')}</select></label></div>
        <div class="row gap-12"><label class="field grow"><span class="label">Default</span><input class="input mono" name="d" placeholder="none"></label><label class="row" style="margin-top:22px"><span class="switch"><input type="checkbox" name="nn"><span></span></span>Not null</label></div>
        <div class="field"><span class="label">Runs as</span><pre class="code" data-preview></pre><span class="hint">Adding a column with a constant default is instant on PostgreSQL 11 and later.</span></div></div>`,
      foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Add column</button></div>`,
      onMount(el, close) {
        const f = (n) => $(`[name=${n}]`, el);
        const sql = () => `alter table "public"."${tid}"\n  add column "${f('n').value || 'column_name'}" ${f('t').value}${f('nn').checked ? ' not null' : ''}${f('d').value ? ' default ' + f('d').value : ''};`;
        const draw = () => ($('[data-preview]', el).innerHTML = hl(sql(), cid));
        el.addEventListener('input', draw); el.addEventListener('change', draw); draw();
        $('[data-ok]', el).onclick = () => { if (!f('n').value) { f('n').classList.add('is-error'); f('n').focus(); return; } close(); toast({ title: `Added ${f('n').value} to ${tid}`, body: '4 ms', tone: 'ok' }); };
      },
    });
  });

  /* ---------- SQL editor ---------- */
  function editorHTML(cid, q) {
    const c = conn(cid);
    return `<div class="sqlw" data-sqlw data-q="${q.id}" style="--ed-h:${q.edH || 42}%">
      <div class="dbg-bar">
        <button class="btn btn-brand btn-sm" data-sql-run>${icon('player-play', 'sm')}Run<span class="kbd">⌘↵</span></button>
        <button class="btn btn-sm hide" data-sql-runsel>${icon('player-play', 'sm')}Run selection</button>
        <button class="btn btn-ghost btn-sm" data-sql-explain>${icon('chart-dots-3', 'sm')}Explain</button>
        <button class="btn btn-ghost btn-sm" data-sql-format>${icon('align-left', 'sm')}Format<span class="kbd">⌘⇧F</span></button>
        <span class="vsep"></span>
        <button class="btn btn-ghost btn-icon btn-sm" data-sql-save aria-label="Save query" data-tip="Save query">${icon('bookmark')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-go="/data/${cid}/history" aria-label="History" data-tip="Query history">${icon('history')}</button>
        <div class="row right">
          <select class="select dbg-size" aria-label="Row limit"><option>Limit 100</option><option selected>Limit 1,000</option><option>No limit</option></select>
          <span class="chip">${tile(c, 'db-tile-xs')}${esc(c.name)}</span>
        </div>
      </div>
      <div class="sqled" data-sqled>
        <div class="sqled-gutter" data-gutter aria-hidden="true"></div>
        <div class="sqled-code">
          <pre class="sqled-hl" data-hl aria-hidden="true"></pre>
          <textarea class="sqled-ta" data-ta spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="SQL">${esc(q.sql)}</textarea>
          <div class="sqlac hide" data-ac role="listbox"></div>
        </div>
      </div>
      <div class="sqlw-split" data-split title="Drag to resize" aria-hidden="true"></div>
      <div class="sqlres" data-res>${resultsHTML(cid, q)}</div>
    </div>`;
  }
  function resultsHTML(cid, q) {
    const R = q.result;
    if (q.running) return `<div class="sqlres-tabs"><span class="meta row">${icon('loader-2', 'sm db-spin')}Running…</span><button class="btn btn-ghost btn-sm right" data-sql-cancel>Cancel</button></div><div class="dbg-skel">${Array.from({ length: 6 }, (_, r) => `<div class="dbg-skel-row">${Array.from({ length: 4 }, (_, k) => `<span class="skel" style="width:${40 + ((r * 13 + k * 29) % 50)}%"></span>`).join('')}</div>`).join('')}</div>`;
    if (!R) return `<div class="empty" style="padding:40px">${icon('sql', 'xl')}<h2 class="h-sec">Run a query to see results here</h2><p>Press <span class="kbd">⌘</span> <span class="kbd">↵</span> to run everything, or select a statement to run just that part.</p></div>`;
    const tabs = R.sets.map((s, i) => `<button class="tab ${s.error ? 'bad-ink' : ''}" aria-selected="${R.active === i}" data-res-tab="${i}">${s.error ? icon('alert-circle', 'sm') : s.plan ? icon('chart-dots-3', 'sm') : icon('table', 'sm')}${esc(s.title)}${s.rows ? `<span class="count">${fmt.num(s.rows.length)}</span>` : ''}</button>`).join('') + `<button class="tab" aria-selected="${R.active === -1}" data-res-tab="-1">${icon('message', 'sm')}Messages<span class="count">${R.messages.length}</span></button>`;
    const s = R.sets[R.active];
    let body;
    if (R.active === -1 || !s) body = `<div class="sqlmsg selectable">${R.messages.map((m) => `<div class="sqlmsg-row ${m.error ? 'is-bad' : ''}">${icon(m.error ? 'alert-circle' : 'check', 'sm')}<span class="mono-sm grow">${esc(m.text)}</span><span class="meta num">${m.ms} ms</span></div>`).join('')}</div>`;
    else if (s.error) body = `<div class="sqlerr"><div class="banner banner-bad">${icon('alert-circle')}<span><b>${esc(s.error)}</b>${s.hint ? `<br><span style="opacity:.85">${esc(s.hint)}</span>` : ''}</span></div>${s.at != null ? `<pre class="code selectable" style="margin-top:10px">${hl(s.sql, cid)}\n${' '.repeat(s.at)}<span class="bad-ink">^</span></pre>` : ''}</div>`;
    else if (s.plan) body = planHTML(s.plan);
    else body = `<div class="dbg-wrap"><table class="dbg dbg-ro" style="width:${52 + s.cols.length * 160}px"><colgroup><col style="width:52px">${s.cols.map(() => '<col style="width:160px">').join('')}</colgroup><thead><tr><th class="dbg-rn"></th>${s.cols.map((c) => `<th class="${isNum(c[1]) ? 'r' : ''}"><div class="dbg-th"><span class="dbg-th-name">${esc(c[0])}</span><span class="dbg-th-type">${esc(c[1])}</span></div></th>`).join('')}</tr></thead><tbody>${s.rows.map((r, i) => `<tr><td class="dbg-rn">${i + 1}</td>${s.cols.map((c) => `<td class="${isNum(c[1]) ? 'r' : ''}">${cellHTML(r[c[0]], c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const status = s && !s.error && R.active !== -1 ? `${s.rows ? fmt.num(s.rows.length) + ' rows · ' : ''}${s.ms} ms` : `${R.messages.length} statement${R.messages.length > 1 ? 's' : ''} · ${R.messages.reduce((a, m) => a + m.ms, 0)} ms`;
    return `<div class="sqlres-tabs"><div class="row" style="gap:0">${tabs}</div><span class="row right gap-4"><span class="meta num">${status}</span>${s?.rows ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="db-export" aria-label="Export results" data-tip="Export results">${icon('table-export')}</button><button class="btn btn-ghost btn-icon btn-sm" data-copy="${esc(s.cols.map((c) => c[0]).join('\t'))}" aria-label="Copy" data-tip="Copy as TSV">${icon('copy')}</button>` : ''}</span></div><div class="sqlres-body">${body}</div>`;
  }
  function planHTML(plan) {
    const max = plan[0].ms;
    return `<div class="sqlplan">${plan.map((p) => `<div class="sqlplan-row" style="--d:${p.depth}"><span class="sqlplan-node">${p.depth ? icon('corner-down-right', 'sm ink-4') : ''}<b class="ink">${esc(p.op)}</b><span class="mono-sm ink-3 truncate">${esc(p.detail)}</span></span><span class="sqlplan-bar"><i style="transform:scaleX(${p.ms / max})"></i></span><span class="num meta" style="width:110px;text-align:right">${fmt.num(p.rows)} rows</span><span class="num ink" style="width:64px;text-align:right">${p.ms.toFixed(1)} ms</span></div>`).join('')}
      <div class="banner" style="margin:12px 16px 0">${icon('bulb')}<span>Most of the time goes to the sequential scan on <span class="mono-sm">orders</span>. An index on <span class="mono-sm">placed_at</span> would let Postgres skip about 96% of rows.</span><button class="btn btn-sm right" data-copy="create index concurrently orders_placed_at_idx on orders (placed_at);">Copy index SQL</button></div></div>`;
  }
  function execute(cid, sql, { explain = false } = {}) {
    const c = conn(cid);
    const stmts = sql.split(/;\s*(?:\n|$)/).map((s) => s.replace(/--[^\n]*/g, '').trim()).filter(Boolean);
    const sets = [], messages = [];
    stmts.forEach((st, i) => {
      const lower = st.toLowerCase();
      const ms = 2 + (hash(st) % 60);
      if (explain || lower.startsWith('explain')) {
        const plan = [
          { depth: 0, op: 'Sort', detail: 'key: revenue desc', rows: 6, ms: 40.8 },
          { depth: 1, op: 'HashAggregate', detail: 'group key: status', rows: 6, ms: 40.6 },
          { depth: 2, op: 'Seq Scan on orders', detail: "filter: placed_at > (now() - '7 days')", rows: 1904, ms: 38.9 },
        ];
        sets.push({ title: 'Plan', plan, ms: 41 }); messages.push({ text: 'EXPLAIN ANALYZE', ms: 41 }); return;
      }
      if (/^(update|insert|delete|alter|drop|truncate|create)/.test(lower)) {
        if (readOnly(c)) { sets.push({ title: `Result ${i + 1}`, error: 'cannot execute ' + lower.split(/\s/)[0].toUpperCase() + ' in a read-only transaction', hint: 'billing-prod is in safe mode. Allow writes from the banner above to run this.', ms }); messages.push({ text: 'ERROR: read-only transaction', ms: 1, error: true }); return; }
        messages.push({ text: `${lower.split(/\s/)[0].toUpperCase()} ${lower.startsWith('insert') ? '0 1' : 1}`, ms }); return;
      }
      const m = lower.match(/from\s+("?[\w.]+"?)/);
      const tname = m && m[1].replace(/"/g, '').replace(/^public\./, '');
      const t = tname && tablesOf(cid).find((x) => x.id.toLowerCase() === tname || x.name.toLowerCase() === tname);
      if (tname && !t) {
        const at = st.toLowerCase().indexOf(tname);
        sets.push({ title: `Result ${i + 1}`, error: `relation "${tname}" does not exist`, hint: `Did you mean ${tablesOf(cid).map((x) => x.name).sort((a, b) => lev(a, tname) - lev(b, tname))[0]}?`, sql: st, at, ms: 1 });
        messages.push({ text: `ERROR: relation "${tname}" does not exist`, ms: 1, error: true }); return;
      }
      if (/group by status/.test(lower) && t?.name === 'orders') {
        const agg = {};
        DB.orders.forEach((o) => { (agg[o.status] ||= { status: o.status, count: 0, revenue: 0 }); agg[o.status].count++; agg[o.status].revenue += o.total_cents / 100; });
        const rows = Object.values(agg).map((a) => ({ ...a, revenue: +a.revenue.toFixed(2) })).sort((a, b) => b.revenue - a.revenue);
        sets.push({ title: `Result ${i + 1}`, cols: [['status', 'order_status'], ['count', 'bigint'], ['revenue', 'numeric']], rows, ms });
      } else if (t) {
        const lim = +(lower.match(/limit\s+(\d+)/)?.[1] || 100);
        const sel = lower.match(/^select\s+(.+?)\s+from/s)?.[1].trim();
        let cols = t.def.cols;
        if (sel && sel !== '*') { const want = sel.split(',').map((x) => x.trim().split(/\s+/)[0]); const picked = cols.filter((c) => want.includes(c[0].toLowerCase())); if (picked.length) cols = picked; }
        let rows = dataFor(cid, t.id);
        const w = lower.match(/where\s+(\w+)\s+(ilike|like|=)\s+'([^']*)'/);
        if (w) rows = rows.filter((r) => { const v = String(r[w[1]] ?? ''); const pat = w[3].replace(/%/g, ''); return w[2] === '=' ? v === w[3] : v.toLowerCase().includes(pat.toLowerCase()); });
        sets.push({ title: `Result ${i + 1}`, cols, rows: rows.slice(0, lim), ms });
      } else {
        sets.push({ title: `Result ${i + 1}`, cols: [['?column?', 'integer']], rows: [{ '?column?': 1 }], ms: 1 });
      }
      messages.push({ text: `SELECT ${sets.at(-1).rows?.length ?? 0}`, ms });
    });
    const firstErr = sets.findIndex((s) => s.error);
    return { sets, messages, active: firstErr >= 0 ? firstErr : sets.length ? 0 : -1 };
  }
  function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
  function formatSQL(sql) {
    return sql.split(/;\s*/).filter((s) => s.trim()).map((s) => s.replace(/\s+/g, ' ').trim()
      .replace(/\s+(from|where|group by|order by|having|limit|left join|inner join|join|union all|returning|set|values)\b/gi, (m, k) => '\n' + k.toLowerCase())
      .replace(/\s+(and|or)\s+/gi, (m, k) => '\n  ' + k.toLowerCase() + ' ')
      .replace(/^select\b/i, 'select')).join(';\n\n') + ';';
  }
  function mountEditor(root, cid) {
    const W = $('[data-sqlw]', root); if (!W) return;
    const q = S.queries[cid].find((x) => x.id === +W.dataset.q);
    const ta = $('[data-ta]', W), pre = $('[data-hl]', W), gut = $('[data-gutter]', W), ac = $('[data-ac]', W), res = $('[data-res]', W);
    const draw = () => {
      pre.innerHTML = hl(ta.value, cid) + '\n';
      const n = ta.value.split('\n').length;
      const cur = ta.value.slice(0, ta.selectionStart).split('\n').length;
      gut.innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i + 1 === cur ? 'is-cur' : ''}">${i + 1}</span>`).join('');
      q.sql = ta.value;
    };
    const sync = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; };
    ta.addEventListener('scroll', sync);
    const paintRes = () => { res.innerHTML = resultsHTML(cid, q); };
    let runTimer;
    const run = (opts = {}) => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      const sql = opts.all || !sel.trim() ? ta.value : sel;
      if (!sql.trim()) return toast({ title: 'Nothing to run', ms: 1400 });
      q.running = true; paintRes();
      clearTimeout(runTimer);
      runTimer = setTimeout(() => {
        q.running = false; q.result = execute(cid, sql, opts);
        DB.queryHistory.unshift({ sql: sql.trim(), at: Date.now(), ms: q.result.messages.reduce((a, m) => a + m.ms, 0), rows: q.result.sets[0]?.rows?.length ?? 0, conn: conn(cid).name, error: q.result.sets.some((s) => s.error) });
        paintRes();
      }, opts.explain ? 520 : 340);
    };
    App.cleanup(() => clearTimeout(runTimer));
    W.addEventListener('click', (e) => {
      if (e.target.closest('[data-sql-run]')) run({ all: true });
      if (e.target.closest('[data-sql-runsel]')) run();
      if (e.target.closest('[data-sql-explain]')) run({ explain: true, all: true });
      if (e.target.closest('[data-sql-format]')) { ta.value = formatSQL(ta.value); draw(); }
      if (e.target.closest('[data-sql-cancel]')) { clearTimeout(runTimer); q.running = false; q.result = { sets: [], messages: [{ text: 'canceling statement due to user request', ms: 0, error: true }], active: -1 }; paintRes(); }
      if (e.target.closest('[data-sql-save]')) {
        sheet({ title: 'Save query', ic: 'bookmark', width: 440, body: `<label class="field"><span class="label">Name</span><input class="input" value="Query ${q.id} on ${esc(conn(cid).name)}" data-name></label>`, foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Save</button></div>`, onMount(el, close) { $('[data-ok]', el).onclick = () => { const name = $('[data-name]', el).value; DB.savedQueries.unshift({ name, conn: conn(cid).name, sql: ta.value }); const tab = S.tabs[cid].find((t) => t.key === 'query:' + q.id); if (tab) tab.title = name; close(); App.rerender(); toast({ title: 'Query saved', body: name, tone: 'ok' }); }; } });
      }
      const rt = e.target.closest('[data-res-tab]'); if (rt && q.result) { q.result.active = +rt.dataset.resTab; paintRes(); }
    });

    // autocomplete from the live schema
    const tables = tablesOf(cid);
    const words = [...tables.map((t) => ({ w: t.name, kind: 'table', meta: fmt.num(t.def.rows) + ' rows' })), ...[...new Map(tables.flatMap((t) => t.def.cols.map((c) => [c[0], { w: c[0], kind: 'column', meta: `${t.name} · ${c[1]}` }]))).values()], ...[...KW].map((k) => ({ w: k, kind: 'keyword', meta: '' }))];
    let items = [], ai = 0;
    const measure = document.createElement('span'); measure.className = 'sqled-measure'; measure.textContent = 'MMMMMMMMMM'; W.append(measure);
    const cw = measure.offsetWidth / 10 || 7.4;
    const word = () => { const before = ta.value.slice(0, ta.selectionStart); const m = before.match(/[A-Za-z_][\w]*$/); return m ? m[0] : ''; };
    const closeAc = () => { ac.classList.add('hide'); items = []; };
    const openAc = (force) => {
      const w = word();
      if (!force && w.length < 2) return closeAc();
      const lw = w.toLowerCase();
      items = words.filter((x) => x.w.toLowerCase().startsWith(lw) && x.w.toLowerCase() !== lw).sort((a, b) => ({ table: 0, column: 1, keyword: 2 }[a.kind] - { table: 0, column: 1, keyword: 2 }[b.kind])).slice(0, 8);
      if (!items.length) return closeAc();
      ai = 0;
      const before = ta.value.slice(0, ta.selectionStart).split('\n');
      const line = before.length - 1, colN = before.at(-1).length - w.length;
      ac.style.left = Math.min(ta.clientWidth - 260, 12 + colN * cw - ta.scrollLeft) + 'px';
      ac.style.top = 10 + (line + 1) * 20 - ta.scrollTop + 'px';
      drawAc(); ac.classList.remove('hide');
    };
    const drawAc = () => (ac.innerHTML = items.map((x, i) => `<button class="sqlac-item ${i === ai ? 'is-active' : ''}" data-i="${i}" role="option">${icon(x.kind === 'table' ? 'table' : x.kind === 'column' ? 'column-insert-right' : 'letter-case', 'sm')}<span class="mono-sm">${esc(x.w)}</span><span class="meta truncate">${esc(x.meta)}</span></button>`).join('') + `<div class="sqlac-foot meta"><span class="kbd">↵</span> insert <span class="kbd">esc</span> close</div>`);
    const accept = () => {
      const it = items[ai]; if (!it) return;
      const w = word(), s = ta.selectionStart;
      ta.setRangeText(it.w, s - w.length, s, 'end');
      closeAc(); draw();
    };
    ac.addEventListener('mousedown', (e) => { const b = e.target.closest('.sqlac-item'); if (b) { e.preventDefault(); ai = +b.dataset.i; accept(); ta.focus(); } });
    ta.addEventListener('input', () => { draw(); openAc(false); });
    ta.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!ac.classList.contains('hide')) {
        if (e.key === 'ArrowDown') { e.preventDefault(); ai = (ai + 1) % items.length; return drawAc(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); ai = (ai - 1 + items.length) % items.length; return drawAc(); }
        if ((e.key === 'Enter' && !mod) || e.key === 'Tab') { e.preventDefault(); return accept(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeAc(); }
      }
      if (mod && e.key === 'Enter') { e.preventDefault(); run(); }
      else if (e.ctrlKey && e.key === ' ') { e.preventDefault(); openAc(true); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); ta.value = formatSQL(ta.value); draw(); }
      else if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); draw(); }
    });
    ta.addEventListener('blur', () => setTimeout(closeAc, 120));
    const selBtn = $('[data-sql-runsel]', W);
    const onSel = () => { selBtn.classList.toggle('hide', ta.selectionStart === ta.selectionEnd); draw(); };
    ta.addEventListener('keyup', onSel); ta.addEventListener('mouseup', onSel);

    // drag the split between editor and results
    $('[data-split]', W).addEventListener('mousedown', (e) => {
      e.preventDefault();
      const r = W.getBoundingClientRect();
      document.body.classList.add('db-resizing-v');
      const move = (ev) => { const p = Math.max(18, Math.min(78, ((ev.clientY - r.top - 44) / (r.height - 44)) * 100)); W.style.setProperty('--ed-h', p + '%'); q.edH = p; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('db-resizing-v'); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    draw();
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); draw(); }, 40);
    App.on('key', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('[data-sql-save]', W).click(); } });
  }

  /* ---------- history ---------- */
  function historyHTML(cid) {
    const c = conn(cid);
    const day = (t) => { const d = (DB.now - t) / DB.day; return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : 'Earlier this week'; };
    const items = DB.queryHistory.map((h, i) => ({ ...h, i })).filter((h) => h.conn === c.name);
    const others = DB.queryHistory.length - items.length;
    let g = '';
    return `<div class="dbh">
      <div class="dbg-bar"><div class="search" style="width:260px">${icon('search')}<input class="input" placeholder="Search history" data-dbh-q aria-label="Search history"></div><span class="meta">${items.length} queries on ${esc(c.name)}${others ? ` · ${others} on other connections` : ''}</span><button class="btn btn-ghost btn-sm right">${icon('trash', 'sm')}Clear history</button></div>
      <div class="dbh-body">
        <div class="dbh-list" data-dbh-list>
          ${items.length ? items.map((h) => (day(h.at) !== g ? `<div class="dbh-day label">${(g = day(h.at))}</div>` : '') + `<div class="dbh-item" data-q="${esc(h.sql.toLowerCase())}">
            <pre class="dbh-sql selectable">${hl(h.sql, cid)}</pre>
            <div class="row dbh-meta"><span class="meta">${new Date(h.at).toTimeString().slice(0, 5)}</span><span class="meta num">${fmt.num(h.rows)} rows · ${h.ms} ms</span>${h.error ? '<span class="chip chip-bad">Failed</span>' : ''}
              <span class="row right gap-4"><button class="btn btn-ghost btn-sm" data-act="db-open-history" data-arg="${h.i}">${icon('pencil', 'sm')}Open in editor</button><button class="btn btn-ghost btn-sm" data-act="db-rerun" data-arg="${h.i}">${icon('player-play', 'sm')}Run again</button><button class="btn btn-ghost btn-icon btn-sm" data-copy="${esc(h.sql)}" aria-label="Copy" data-tip="Copy SQL">${icon('copy')}</button></span></div></div>`).join('') : `<div class="empty">${icon('history', 'xl')}<h2 class="h-sec">No queries on ${esc(c.name)} yet</h2><p>Everything you run is kept here, with its timing and row count.</p><button class="btn" data-act="db-new-query">New query</button></div>`}
        </div>
        <aside class="dbh-saved"><h3 class="h-sub" style="margin-bottom:8px">Saved queries</h3>${DB.savedQueries.map((s) => `<button class="db-saved" data-act="db-open-saved" data-arg="${esc(s.name)}">${icon('bookmark', 'ink-3')}<span class="grow truncate">${esc(s.name)}</span><span class="meta">${esc(s.conn)}</span></button>`).join('')}</aside>
      </div></div>`;
  }
  function openSQLTab(cid, sql, runNow) {
    const qs = (S.queries[cid] ||= []);
    const id = (qs.at(-1)?.id || 0) + 1;
    const q = { id, sql, result: null };
    if (runNow) q.result = execute(cid, sql);
    qs.push(q);
    App.go(`/data/${cid}/query?t=${id}`);
  }
  const savedSQL = {
    'Revenue last 7 days': DB.queryHistory[0].sql,
    'Stuck pending orders': "select id, customer_id, total_cents, placed_at\nfrom orders\nwhere status = 'pending'\n  and placed_at < now() - interval '2 hours'\norder by placed_at;",
    'Top customers by lifetime value': 'select id, full_name, email, lifetime_cents\nfrom customers\norder by lifetime_cents desc\nlimit 25;',
    'Hourly events': DB.queryHistory[3].sql,
  };
  const connByName = (n) => DB.connections.find((c) => c.name === n) || conn('shop-pg');
  App.act('db-open-history', (el, i) => { const h = DB.queryHistory[+i]; openSQLTab(connByName(h.conn).id, h.sql); });
  App.act('db-rerun', (el, i) => { const h = DB.queryHistory[+i]; openSQLTab(connByName(h.conn).id, h.sql, true); });
  App.act('db-open-saved', (el, name) => { const s = DB.savedQueries.find((x) => x.name === name); openSQLTab(connByName(s.conn).id, s.sql || savedSQL[name] || `-- ${name}\n`); });
  App.act('db-view-sql', (el, v) => openSQLTab(App.route.params[0], `select * from ${v}\nlimit 100;`, true));

  /* ---------- schema diagram ---------- */
  const NW = 232, RH = 22, HH = 34;
  function layout(cid) {
    const ts = tablesOf(cid);
    const ref = (t) => t.def.cols.filter((c) => (c[2] || '').startsWith('fk:')).map((c) => c[2].slice(3).split('.')[0]).filter((n) => n !== t.name && ts.some((x) => x.name === n));
    const layer = {};
    const depth = (t, seen = new Set()) => { if (layer[t.name] != null) return layer[t.name]; if (seen.has(t.name)) return 0; seen.add(t.name); const r = ref(t); return (layer[t.name] = r.length ? 1 + Math.max(...r.map((n) => depth(ts.find((x) => x.name === n), seen))) : 0); };
    ts.forEach((t) => depth(t));
    const ys = {};
    ts.forEach((t) => {
      const k = `${cid}|${t.id}`;
      if (S.nodePos[k]) return;
      const L = layer[t.name];
      ys[L] ??= 40;
      S.nodePos[k] = [40 + L * (NW + 110), ys[L]];
      ys[L] += HH + t.def.cols.length * RH + 36;
    });
    return ts;
  }
  function diagramHTML(cid) {
    const ts = layout(cid);
    const cam = (S.cam[cid] ||= { x: 0, y: 0, z: 1 });
    return `<div class="erd" data-erd>
      <div class="erd-tools">
        <div class="btn-group"><button class="btn btn-sm btn-icon" data-erd-zoom="-1" aria-label="Zoom out" data-tip="Zoom out" data-kbd="⌘−">${icon('minus')}</button><button class="btn btn-sm" data-erd-zoom="0" data-erd-z style="min-width:56px">${Math.round(cam.z * 100)}%</button><button class="btn btn-sm btn-icon" data-erd-zoom="1" aria-label="Zoom in" data-tip="Zoom in" data-kbd="⌘+">${icon('plus')}</button></div>
        <button class="btn btn-sm" data-erd-fit>${icon('maximize', 'sm')}Fit</button>
        <button class="btn btn-sm" data-erd-layout>${icon('layout-distribute-vertical', 'sm')}Auto layout</button>
        <span class="vsep"></span>
        <button class="btn btn-ghost btn-sm" data-act="db-erd-export">${icon('photo', 'sm')}Export image</button>
      </div>
      <div class="erd-stage" data-stage style="transform:translate(${cam.x}px,${cam.y}px) scale(${cam.z})">
        <svg class="erd-lines" data-lines width="4000" height="3000" aria-hidden="true"></svg>
        ${ts.map((t) => { const [x, y] = S.nodePos[`${cid}|${t.id}`]; return `<div class="erd-node" data-node="${esc(t.id)}" data-name="${esc(t.name)}" style="transform:translate(${x}px,${y}px);width:${NW}px">
          <div class="erd-head" data-drag>${icon('table', 'sm')}<b class="truncate">${esc(t.name)}</b><span class="meta right num">${t.def.rows >= 1e3 ? Math.round(t.def.rows / 1e3) + 'k' : t.def.rows}</span></div>
          ${t.def.cols.map((c) => `<div class="erd-col" data-col="${esc(c[0])}">${(c[2] || '') === 'pk' ? icon('key', 'sm erd-pk') : (c[2] || '').startsWith('fk:') ? icon('link', 'sm erd-fk') : '<i class="erd-sp"></i>'}<span class="mono-sm truncate ink">${esc(c[0])}</span><span class="mono-sm ink-3 right truncate">${esc(c[1])}</span></div>`).join('')}
          <button class="erd-open" data-go="/data/${cid}/${encodeURIComponent(t.id)}" data-tip="Open rows">${icon('table', 'sm')}</button>
        </div>`; }).join('')}
      </div>
      <div class="erd-legend meta">${icon('key', 'sm erd-pk')}Primary key ${icon('link', 'sm erd-fk')}Foreign key · Drag tables to arrange, drag the canvas to pan, pinch or ⌘ scroll to zoom</div>
    </div>`;
  }
  function mountDiagram(root, cid) {
    const E = $('[data-erd]', root); if (!E) return;
    const stage = $('[data-stage]', E), svg = $('[data-lines]', E), cam = S.cam[cid];
    const ts = tablesOf(cid);
    const apply = () => { stage.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.z})`; $('[data-erd-z]', E).textContent = Math.round(cam.z * 100) + '%'; };
    const lines = () => {
      const paths = [];
      ts.forEach((t) => t.def.cols.forEach((c, ci) => {
        const fl = c[2] || ''; if (!fl.startsWith('fk:')) return;
        const [tb, col] = fl.slice(3).split('.');
        const target = ts.find((x) => x.name === tb); if (!target) return;
        const [sx, sy] = S.nodePos[`${cid}|${t.id}`], [tx, ty] = S.nodePos[`${cid}|${target.id}`];
        const ti = Math.max(0, target.def.cols.findIndex((x) => x[0] === col));
        const y1 = sy + HH + ci * RH + RH / 2, y2 = ty + HH + ti * RH + RH / 2;
        const leftToRight = tx + NW < sx;
        const x1 = leftToRight ? sx : sx + NW, x2 = leftToRight ? tx + NW : tx;
        const dx = Math.max(40, Math.abs(x1 - x2) / 2) * (leftToRight ? -1 : 1);
        paths.push(`<path d="M${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" data-from="${esc(t.name)}" data-to="${esc(tb)}"/><circle cx="${x2}" cy="${y2}" r="3"/><path class="erd-many" d="M${x1} ${y1 - 5} L${x1 + (leftToRight ? -9 : 9)} ${y1} L${x1} ${y1 + 5}"/>`);
      }));
      svg.innerHTML = paths.join('');
    };
    lines();
    const fit = () => {
      const xs = ts.map((t) => S.nodePos[`${cid}|${t.id}`]);
      const maxX = Math.max(...xs.map((p) => p[0])) + NW + 40, maxY = Math.max(...ts.map((t) => S.nodePos[`${cid}|${t.id}`][1] + HH + t.def.cols.length * RH)) + 40;
      cam.z = Math.min(1.2, Math.max(0.4, Math.min(E.clientWidth / maxX, (E.clientHeight - 50) / maxY)));
      cam.x = (E.clientWidth - maxX * cam.z) / 2; cam.y = 46; apply();
    };
    if (!cam.fitted) { cam.fitted = true; requestAnimationFrame(fit); }
    E.addEventListener('click', (e) => {
      const z = e.target.closest('[data-erd-zoom]');
      if (z) { const d = +z.dataset.erdZoom; cam.z = d ? Math.max(0.3, Math.min(2, cam.z * (d > 0 ? 1.2 : 1 / 1.2))) : 1; apply(); }
      if (e.target.closest('[data-erd-fit]')) fit();
      if (e.target.closest('[data-erd-layout]')) { ts.forEach((t) => delete S.nodePos[`${cid}|${t.id}`]); layout(cid); $$('.erd-node', E).forEach((n) => { const [x, y] = S.nodePos[`${cid}|${n.dataset.node}`]; n.style.transition = 'transform 420ms var(--ease)'; n.style.transform = `translate(${x}px,${y}px)`; setTimeout(() => (n.style.transition = ''), 440); }); lines(); setTimeout(fit, 60); }
    });
    E.addEventListener('mouseover', (e) => {
      const n = e.target.closest('.erd-node'); const name = n?.dataset.name;
      $$('path[data-from]', svg).forEach((p) => p.classList.toggle('is-hot', !!name && (p.dataset.from === name || p.dataset.to === name)));
      E.classList.toggle('has-hot', !!name);
    });
    E.addEventListener('mousedown', (e) => {
      if (e.target.closest('.erd-tools, .erd-open, button')) return;
      const head = e.target.closest('[data-drag]');
      const x0 = e.clientX, y0 = e.clientY;
      if (head) {
        const node = head.closest('.erd-node'), k = `${cid}|${node.dataset.node}`, [px, py] = S.nodePos[k];
        node.classList.add('is-drag');
        const move = (ev) => { S.nodePos[k] = [px + (ev.clientX - x0) / cam.z, py + (ev.clientY - y0) / cam.z]; node.style.transform = `translate(${S.nodePos[k][0]}px,${S.nodePos[k][1]}px)`; lines(); };
        const up = () => { node.classList.remove('is-drag'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      } else if (!e.target.closest('.erd-node')) {
        const cx = cam.x, cy = cam.y; E.classList.add('is-pan');
        const move = (ev) => { cam.x = cx + ev.clientX - x0; cam.y = cy + ev.clientY - y0; apply(); };
        const up = () => { E.classList.remove('is-pan'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      }
    });
    E.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = E.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        const z = Math.max(0.3, Math.min(2, cam.z * Math.exp(-e.deltaY * 0.008)));
        cam.x = mx - ((mx - cam.x) * z) / cam.z; cam.y = my - ((my - cam.y) * z) / cam.z; cam.z = z;
      } else { cam.x -= e.deltaX; cam.y -= e.deltaY; }
      apply();
    }, { passive: false });
  }
  App.act('db-erd-export', () => toast({ title: 'Saved shop-postgres-schema.png', body: 'In Downloads · 2880 × 1800', tone: 'ok' }));

  /* ---------- Redis key browser ---------- */
  const REDIS = [
    { k: 'session:9f2c41e0b7', t: 'hash', ttl: 1742, mem: 1240, v: { user_id: '10483', cart_id: 'c_81f2a0', csrf: 'd1e0c4a9f8b2', created_at: '2026-10-17T09:12:44Z', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) Safari/605.1.15' } },
    { k: 'session:2a77be04c1', t: 'hash', ttl: 911, mem: 1188, v: { user_id: '10294', cart_id: 'c_40d9e1', csrf: '7b3e09d2a1c4', created_at: '2026-10-17T10:41:02Z', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0) Mobile/15E148' } },
    { k: 'cart:c_81f2a0', t: 'hash', ttl: 86120, mem: 412, v: { 'TEE-BLK-M': '2', 'CAP-NVY': '1', updated_at: '2026-10-17T11:58:20Z' } },
    { k: 'products:category:tees', t: 'string', ttl: 287, mem: 6820, v: '[{"id":12,"sku":"TEE-BLK-M","title":"Heavyweight tee, black","price_cents":3800},{"id":13,"sku":"TEE-WHT-L","title":"Heavyweight tee, white","price_cents":3800},{"id":19,"sku":"TEE-OLV-S","title":"Garment-dyed tee, olive","price_cents":4200}]' },
    { k: 'queue:default', t: 'list', ttl: -1, mem: 2304, v: ['{"job":"send_receipt","order_id":48213,"attempt":1}', '{"job":"sync_inventory","sku":"TEE-BLK-M"}', '{"job":"send_receipt","order_id":48212,"attempt":1}', '{"job":"refresh_lifetime_value","customer_id":10483}'] },
    { k: 'queue:retry', t: 'zset', ttl: -1, mem: 640, v: [['{"job":"capture_payment","order_id":48211}', 1792231653], ['{"job":"capture_payment","order_id":48209}', 1792231671]] },
    { k: 'ratelimit:api:10.0.4.12', t: 'string', ttl: 41, mem: 56, v: '87' },
    { k: 'ratelimit:api:10.0.7.201', t: 'string', ttl: 12, mem: 56, v: '311' },
    { k: 'leaderboard:referrals', t: 'zset', ttl: -1, mem: 980, v: [['amara.okafor', 42], ['lucas.lindqvist', 31], ['yuki.tanaka', 27], ['sofia.moreau', 19], ['mateo.alvarez', 12]] },
    { k: 'online_users', t: 'set', ttl: -1, mem: 520, v: ['10483', '10294', '10301', '10522', '10647', '10233'] },
    { k: 'events:checkout', t: 'stream', ttl: -1, mem: 4096, v: [['1792231629012-0', { order_id: '48213', total_cents: '7600', step: 'paid' }], ['1792231588410-0', { order_id: '48212', total_cents: '4200', step: 'paid' }], ['1792231560007-0', { order_id: '48211', total_cents: '12900', step: 'payment_failed' }]] },
    { k: 'feature_flags', t: 'hash', ttl: -1, mem: 300, v: { checkout_one_page: 'on', free_shipping_banner: 'off', size_guide_modal: 'on' } },
    { k: 'lock:inventory:TEE-BLK-M', t: 'string', ttl: 3, mem: 64, v: 'worker-7f2c' },
    { k: 'stats:orders:today', t: 'string', ttl: 43120, mem: 56, v: '214' },
  ];
  const RT = { hash: 'Hash', string: 'String', list: 'List', set: 'Set', zset: 'Sorted set', stream: 'Stream' };
  const ttlText = (s) => (s < 0 ? 'No expiry' : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);
  function redisHTML(c) {
    return `<div class="rds" data-rds>
      <div class="dbg-bar"><div class="search" style="width:280px">${icon('search')}<input class="input mono" value="*" data-rds-q aria-label="Key pattern"></div>
        <div class="seg seg-sm" data-rds-type><button aria-pressed="true" data-t="">All</button>${Object.entries(RT).map(([k, v]) => `<button aria-pressed="false" data-t="${k}">${v}</button>`).join('')}</div>
        <span class="meta right num">Showing <span data-rds-n>${REDIS.length}</span> of ${fmt.num(c.keys)} keys · db 0 · 2.1 MB</span>
        <button class="btn btn-sm" data-rds-add>${icon('plus', 'sm')}Add key</button></div>
      <div class="rds-body"><div class="rds-list" data-rds-list></div><div class="rds-val" data-rds-val></div></div>
      <div class="rds-cli"><div class="rds-cli-log mono-sm selectable" data-rds-log>${S.redisLog.join('')}</div><div class="rds-cli-in"><span class="mono-sm brand-ink">redis.shop.containeria.local:6379&gt;</span><input class="mono" data-rds-cmd placeholder="GET stats:orders:today" aria-label="Redis command" autocomplete="off" spellcheck="false"></div></div>
    </div>`;
  }
  function mountRedis(root) {
    const R = $('[data-rds]', root); if (!R) return;
    const list = $('[data-rds-list]', R), val = $('[data-rds-val]', R), q = $('[data-rds-q]', R);
    let type = '';
    const match = (k) => { const p = q.value.trim() || '*'; return new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(k); };
    const drawList = () => {
      const keys = REDIS.filter((x) => match(x.k) && (!type || x.t === type));
      $('[data-rds-n]', R).textContent = keys.length;
      list.innerHTML = keys.map((x) => `<button class="rds-key ${x.k === S.redisSel ? 'is-active' : ''}" data-k="${esc(x.k)}"><span class="chip chip-line rds-type">${RT[x.t]}</span><span class="mono-sm truncate grow ink">${esc(x.k)}</span><span class="meta num ${x.ttl >= 0 && x.ttl < 60 ? 'warn-ink' : ''}">${ttlText(x.ttl)}</span></button>`).join('') || `<div class="empty" style="padding:32px">${icon('key-off', 'lg')}<p>No keys match <span class="mono-sm">${esc(q.value)}</span>.</p></div>`;
    };
    const drawVal = () => {
      const x = REDIS.find((r) => r.k === S.redisSel);
      if (!x) { val.innerHTML = `<div class="empty">${icon('key', 'xl')}<p>Select a key to see its value.</p></div>`; return; }
      let body;
      if (x.t === 'hash') body = `<table class="tbl"><thead><tr><th>Field</th><th>Value</th><th class="r"></th></tr></thead><tbody>${Object.entries(x.v).map(([f, v]) => `<tr><td><span class="mono ink">${esc(f)}</span></td><td style="max-width:420px"><span class="mono truncate" style="display:block">${esc(v)}</span></td><td class="r"><span class="row-actions"><button class="btn btn-ghost btn-icon btn-sm" data-copy="${esc(v)}" data-tip="Copy value">${icon('copy')}</button><button class="btn btn-ghost btn-icon btn-sm" data-tip="Edit field">${icon('pencil')}</button><button class="btn btn-ghost btn-icon btn-sm" data-tip="Delete field">${icon('trash')}</button></span></td></tr>`).join('')}</tbody></table>`;
      else if (x.t === 'string') { let pretty = x.v; try { pretty = JSON.stringify(JSON.parse(x.v), null, 2); } catch {} body = `<div style="padding:16px 20px"><div class="row" style="margin-bottom:8px"><span class="label">${pretty !== x.v ? 'JSON · formatted for reading' : 'Text'}</span></div><pre class="code selectable">${pretty !== x.v ? hlJSON(pretty) : esc(x.v)}</pre></div>`; }
      else if (x.t === 'list' || x.t === 'set') body = `<table class="tbl"><thead><tr><th class="num" style="width:60px">${x.t === 'list' ? 'Index' : '#'}</th><th>Value</th></tr></thead><tbody>${x.v.map((v, i) => `<tr><td class="num">${i}</td><td><span class="mono">${esc(v)}</span></td></tr>`).join('')}</tbody></table>`;
      else if (x.t === 'zset') body = `<table class="tbl"><thead><tr><th>Member</th><th class="num">Score</th></tr></thead><tbody>${x.v.map(([m, s]) => `<tr><td><span class="mono ink">${esc(m)}</span></td><td class="num">${fmt.num(s)}</td></tr>`).join('')}</tbody></table>`;
      else body = `<table class="tbl"><thead><tr><th>Entry ID</th><th>Fields</th></tr></thead><tbody>${x.v.map(([id, f]) => `<tr><td><span class="mono-sm ink-3">${esc(id)}</span></td><td><span class="row gap-4" style="flex-wrap:wrap">${Object.entries(f).map(([k, v]) => `<span class="chip chip-mono">${esc(k)}=${esc(v)}</span>`).join('')}</span></td></tr>`).join('')}</tbody></table>`;
      val.innerHTML = `<div class="rds-val-head"><div class="col" style="gap:2px;min-width:0"><b class="mono ink truncate" style="font-size:var(--t-14)">${esc(x.k)}</b><span class="meta">${RT[x.t]} · ${x.t === 'hash' ? Object.keys(x.v).length + ' fields' : Array.isArray(x.v) ? x.v.length + ' items' : x.v.length + ' bytes'} · ${fmt.num(x.mem)} B in memory · ${x.ttl < 0 ? 'no expiry' : `expires in ${ttlText(x.ttl)}`}</span></div>
        <span class="row right gap-4"><button class="btn btn-sm" data-rds-ttl>${icon('clock', 'sm')}Set TTL</button><button class="btn btn-ghost btn-icon btn-sm" data-copy="${esc(x.k)}" data-tip="Copy key">${icon('copy')}</button><button class="btn btn-ghost btn-icon btn-sm" data-tip="Rename">${icon('pencil')}</button><button class="btn btn-danger-ghost btn-icon btn-sm" data-rds-del data-tip="Delete key">${icon('trash')}</button></span></div><div class="rds-val-body">${body}</div>`;
    };
    drawList(); drawVal();
    q.addEventListener('input', drawList);
    R.addEventListener('click', (e) => {
      const k = e.target.closest('.rds-key'); if (k) { S.redisSel = k.dataset.k; drawList(); drawVal(); }
      const t = e.target.closest('[data-rds-type] button'); if (t) { type = t.dataset.t; drawList(); }
      if (e.target.closest('[data-rds-del]')) confirmSheet({ title: `Delete ${S.redisSel}?`, body: 'The key and its value are removed from db 0 right away.', action: 'Delete key', onConfirm() { REDIS.splice(REDIS.findIndex((x) => x.k === S.redisSel), 1); S.redisSel = REDIS[0]?.k; drawList(); drawVal(); toast({ title: 'Key deleted', tone: 'ok' }); } });
      if (e.target.closest('[data-rds-ttl]')) toast({ title: `EXPIRE ${S.redisSel} 3600`, body: 'Expires in 1 hour', tone: 'ok' });
      if (e.target.closest('[data-rds-add]')) sheet({ title: 'Add key', ic: 'key', width: 480, body: `<div class="col gap-12"><label class="field"><span class="label">Key</span><input class="input mono" placeholder="feature_flags:new_checkout"></label><label class="field"><span class="label">Type</span><select class="select">${Object.values(RT).map((v) => `<option>${v}</option>`).join('')}</select></label><label class="field"><span class="label">Value</span><textarea class="textarea mono"></textarea></label><label class="field"><span class="label">Expires after</span><div class="input-group"><input class="input" placeholder="Never"><span class="input-addon">seconds</span></div></label></div>`, foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-close>Add key</button></div>` });
    });
    const cmd = $('[data-rds-cmd]', R), log = $('[data-rds-log]', R);
    log.scrollTop = log.scrollHeight;
    cmd.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !cmd.value.trim()) return;
      const [op, ...args] = cmd.value.trim().split(/\s+/);
      const x = REDIS.find((r) => r.k === args[0]);
      const out = { PING: 'PONG', DBSIZE: '(integer) 1284', GET: x ? `"${x.v}"` : '(nil)', TTL: x ? `(integer) ${x.ttl}` : '(integer) -2', TYPE: x ? x.t : 'none', HGETALL: x?.t === 'hash' ? Object.entries(x.v).map(([k, v], i) => `${i * 2 + 1}) "${k}"\n${i * 2 + 2}) "${v}"`).join('\n') : '(empty array)', KEYS: REDIS.filter((r) => match.call(null, r.k)).map((r, i) => `${i + 1}) "${r.k}"`).join('\n'), INFO: '# Server\nredis_version:7.4.1\nuptime_in_seconds:11520\nconnected_clients:6\nused_memory_human:2.10M' }[op.toUpperCase()] ?? `(error) ERR unknown command '${op}'`;
      S.redisLog.push(`<div><span class="brand-ink">&gt;</span> ${esc(cmd.value)}</div><div class="${out.startsWith('(error)') ? 'bad-ink' : 'ink-3'}" style="white-space:pre-wrap">${esc(out)}</div>`);
      log.innerHTML = S.redisLog.join(''); log.scrollTop = log.scrollHeight; cmd.value = '';
    });
  }
  const hlJSON = (s) => esc(s).replace(/(&quot;[^&]*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g, (m, str, colon, num, lit) => (str ? `<span class="${colon ? 'sx-col' : 'sx-str'}">${str}</span>${colon || ''}` : num ? `<span class="sx-num">${num}</span>` : `<span class="sx-kw">${lit}</span>`));

  /* ---------- new / edit connection ---------- */
  function parseURL(s) {
    const m = s.trim().match(/^([a-z0-9+]+):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?]+)(?::(\d+))?(?:\/([^?]*))?(?:\?(.*))?$/i);
    if (!m) return null;
    const [, scheme, user, pass, host, port, db, qs] = m;
    let kind = { postgres: 'postgres', postgresql: 'postgres', mysql: 'mysql', mariadb: 'mariadb', mongodb: 'mongodb', 'mongodb+srv': 'mongodb', redis: 'redis', rediss: 'redis', clickhouse: 'clickhouse', libsql: 'turso', sqlserver: 'mssql', mssql: 'mssql' }[scheme.toLowerCase()];
    if (/neon\.tech$/.test(host)) kind = 'neon';
    if (/supabase\.(co|com)$/.test(host)) kind = 'supabase';
    if (/psdb\.cloud$|planetscale/.test(host)) kind = 'planetscale';
    const params = new URLSearchParams(qs || '');
    return { kind, user: decodeURIComponent(user || ''), pass: decodeURIComponent(pass || ''), host, port: port || '', db: decodeURIComponent(db || ''), ssl: params.get('sslmode') || (params.get('ssl') === 'true' ? 'require' : '') };
  }
  function connectionSheet(existing) {
    let eng = ENGINES.find((e) => e.id === (existing?.provider?.toLowerCase() || existing?.kind)) || null;
    const v = existing ? { name: existing.name, host: existing.host, port: existing.port || '', user: existing.user || '', db: existing.db || '', env: existing.env || 'local' } : { name: '', host: '', port: '', user: '', db: '', env: 'local' };
    const s = sheet({
      title: existing ? `Edit ${existing.name}` : 'New connection', ic: 'database-plus', width: 640,
      body: '<div data-ncs></div>',
      foot: `<button class="btn" data-nc-test disabled>${icon('plug-connected')}Test connection</button><span class="meta" data-nc-status></span><div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-nc-save disabled>${existing ? 'Save' : 'Save and connect'}</button></div>`,
      onMount(el, close) {
        const box = $('[data-ncs]', el);
        const field = (n) => $(`[name="${n}"]`, el);
        const read = () => { ['name', 'host', 'port', 'user', 'db'].forEach((k) => { if (field(k)) v[k] = field(k).value; }); };
        const draw = () => {
          if (!eng) {
            box.innerHTML = `<label class="field"><span class="label">Paste a connection string</span><input class="input mono" data-nc-url placeholder="postgres://user:password@host:5432/database?sslmode=require" autocomplete="off" spellcheck="false"><span class="hint">Containeria fills in the form and picks the engine for you.</span></label>
              <div class="label" style="margin:18px 0 8px">Or choose an engine</div>
              <div class="nc-grid">${ENGINES.map((e) => `<button class="nc-engine" data-eng="${e.id}">${tile(e, 'tile-lg')}<span>${esc(e.name)}</span></button>`).join('')}</div>`;
            $('[data-nc-test]', el).disabled = true; $('[data-nc-save]', el).disabled = true;
            const url = $('[data-nc-url]', box);
            url.addEventListener('input', () => {
              const p = parseURL(url.value);
              if (!p?.kind) { url.classList.toggle('is-error', url.value.length > 12 && !p); return; }
              eng = ENGINES.find((e) => e.id === p.kind);
              Object.assign(v, { host: p.host, port: p.port || eng.port || '', user: p.user, db: p.db, pass: p.pass, ssl: p.ssl, name: v.name || p.host.split('.')[0] });
              draw();
              toast({ title: `Filled in from the ${eng.name} URL`, ic: 'wand', ms: 1800 });
            });
            setTimeout(() => url.focus(), 40);
            return;
          }
          const fileLike = eng.file || eng.url;
          box.innerHTML = `<div class="nc-chosen">${tile(eng, 'tile-lg')}<div class="grow"><b class="ink">${esc(eng.name)}</b><div class="meta">${eng.file ? 'A database file on your Mac' : eng.url ? 'Connect with a database URL and auth token' : eng.region ? 'AWS region and credentials from your profile' : `Default port ${eng.port}`}</div></div>${existing ? '' : `<button class="btn btn-ghost btn-sm" data-nc-back>Change engine</button>`}</div>
            <div class="nc-form">
              <label class="field nc-span"><span class="label">Name</span><input class="input" name="name" value="${esc(v.name)}" placeholder="billing-staging"></label>
              ${eng.file ? `<label class="field nc-span"><span class="label">File</span><div class="input-group"><input class="input mono" name="host" value="${esc(v.host)}" placeholder="~/Projects/app/dev.sqlite"><button class="btn" type="button">Choose…</button></div></label>`
              : eng.url ? `<label class="field nc-span"><span class="label">Database URL</span><input class="input mono" name="host" value="${esc(v.host)}" placeholder="libsql://edge-cache-you.turso.io"></label><label class="field nc-span"><span class="label">Auth token</span><input class="input mono" type="password" name="pass" placeholder="eyJhbGciOi…"></label>`
              : eng.region ? `<label class="field"><span class="label">Region</span><select class="select" name="host"><option>eu-central-1</option><option>us-east-1</option><option>us-west-2</option><option>ap-northeast-1</option></select></label><label class="field"><span class="label">AWS profile</span><select class="select" name="user"><option>default</option><option>shop-prod</option></select></label>`
              : `<label class="field nc-host"><span class="label">Host</span><input class="input mono" name="host" value="${esc(v.host)}" placeholder="localhost" spellcheck="false"></label>
                 <label class="field"><span class="label">Port</span><input class="input mono" name="port" value="${esc(v.port || eng.port || '')}" inputmode="numeric"></label>
                 <label class="field"><span class="label">User</span><input class="input mono" name="user" value="${esc(v.user || eng.user || '')}" spellcheck="false"></label>
                 <label class="field"><span class="label">Password</span><div class="input-group"><input class="input mono" type="password" name="pass" value="${esc(v.pass || '')}" placeholder="Stored in Keychain"><button class="btn btn-icon" type="button" data-nc-eye aria-label="Show password" data-tip="Show password">${icon('eye')}</button></div></label>
                 <label class="field nc-span"><span class="label">Database</span><input class="input mono" name="db" value="${esc(v.db)}" placeholder="${eng.id === 'redis' ? '0' : 'postgres'}"></label>`}
            </div>
            ${fileLike || eng.region ? '' : `<details class="nc-more" ${v.ssl ? 'open' : ''}><summary>${icon('chevron-right', 'sm dbt-chev')}SSL and SSH tunnel</summary>
              <div class="nc-form" style="margin-top:12px">
                <label class="field"><span class="label">SSL mode</span><select class="select" name="ssl">${['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].map((m) => `<option ${m === (v.ssl || (/neon|supabase|planetscale/.test(eng.id) ? 'require' : 'prefer')) ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
                <label class="field"><span class="label">CA certificate</span><div class="input-group"><input class="input mono" placeholder="System default"><button class="btn" type="button">Choose…</button></div></label>
                <label class="row nc-span" style="margin-top:4px"><span class="switch"><input type="checkbox" data-nc-ssh><span></span></span><span class="ink">Connect through an SSH tunnel</span></label>
                <div class="nc-span nc-form hide" data-nc-sshf style="margin:0">
                  <label class="field"><span class="label">SSH host</span><input class="input mono" placeholder="bastion.example.com"></label>
                  <label class="field"><span class="label">SSH user</span><input class="input mono" placeholder="ubuntu"></label>
                  <label class="field nc-span"><span class="label">Private key</span><div class="input-group"><input class="input mono" value="~/.ssh/id_ed25519"><button class="btn" type="button">Choose…</button></div><span class="hint">Or use the SSH agent from 1Password or Secretive.</span></label>
                </div>
              </div></details>`}
            <div class="field" style="margin-top:16px"><span class="label">Environment</span>
              <div class="row"><div class="seg" data-nc-env>${['local', 'staging', 'production'].map((e) => `<button aria-pressed="${v.env === e}" data-e="${e}">${e[0].toUpperCase() + e.slice(1)}</button>`).join('')}</div>
              <span class="hint" data-nc-envhint>${v.env === 'production' ? `${icon('lock', 'sm')} Opens read-only. You can allow writes for 15 minutes at a time.` : v.env === 'staging' ? 'Shown with an amber label so it’s never mistaken for local.' : 'No restrictions.'}</span></div></div>
            <div data-nc-result></div>`;
          $$('.seg', box).forEach(segThumb);
          $('[data-nc-test]', el).disabled = false; $('[data-nc-save]', el).disabled = false;
          $('[data-nc-back]', box)?.addEventListener('click', () => { read(); eng = null; draw(); });
          $('[data-nc-eye]', box)?.addEventListener('click', (e) => { const p = field('pass'); p.type = p.type === 'password' ? 'text' : 'password'; e.currentTarget.innerHTML = icon(p.type === 'password' ? 'eye' : 'eye-off'); });
          $('[data-nc-ssh]', box)?.addEventListener('change', (e) => $('[data-nc-sshf]', box).classList.toggle('hide', !e.target.checked));
          $('[data-nc-env]', box).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; v.env = b.dataset.e; $('[data-nc-envhint]', box).innerHTML = v.env === 'production' ? `${icon('lock', 'sm')} Opens read-only. You can allow writes for 15 minutes at a time.` : v.env === 'staging' ? 'Shown with an amber label so it’s never mistaken for local.' : 'No restrictions.'; });
          setTimeout(() => field('name')?.focus(), 40);
        };
        box.addEventListener('click', (e) => { const b = e.target.closest('[data-eng]'); if (b) { eng = ENGINES.find((x) => x.id === b.dataset.eng); v.port = eng.port || ''; draw(); } });
        draw();
        $('[data-nc-test]', el).onclick = (e) => {
          read();
          const btn = e.currentTarget, out = $('[data-nc-result]', el), status = $('[data-nc-status]', el);
          if (!v.host) { field('host')?.classList.add('is-error'); field('host')?.focus(); out.innerHTML = `<div class="banner banner-bad" style="margin-top:14px">${icon('alert-circle')}<span>Enter a host to test the connection.</span></div>`; return; }
          btn.classList.add('is-loading'); btn.innerHTML = `${icon('loader-2')}Testing…`; status.textContent = ''; out.innerHTML = '';
          setTimeout(() => {
            btn.classList.remove('is-loading'); btn.innerHTML = `${icon('plug-connected')}Test connection`;
            const local = /localhost|127\.0\.0\.1|containeria\.local|\.sqlite|\.db$|^~|^\//.test(v.host);
            const pass = field('pass')?.value;
            if (!local && !pass && !eng.region && !eng.file) { out.innerHTML = `<div class="banner banner-bad" style="margin-top:14px">${icon('alert-circle')}<span><b>Login failed.</b> ${esc(eng.name)} at <span class="mono-sm">${esc(v.host)}</span> answered, but rejected the empty password for <span class="mono-sm">${esc(v.user || 'user')}</span>.</span></div>`; return; }
            const ms = 18 + (hash(v.host) % 140);
            out.innerHTML = `<div class="banner banner-ok" style="margin-top:14px">${icon('circle-check')}<span><b>Connected in ${ms} ms.</b> ${esc(eng.name)} ${eng.id === 'mysql' || eng.id === 'planetscale' ? '8.0.39' : eng.id === 'sqlite' ? '3.47.2' : '17.2'}${v.db ? ` · database <span class="mono-sm">${esc(v.db)}</span>` : ''}${v.env === 'production' ? ' · will open read-only' : ''}</span></div>`;
          }, 900);
        };
        $('[data-nc-save]', el).onclick = () => {
          read();
          if (!v.name) { field('name').classList.add('is-error'); field('name').focus(); return; }
          if (!v.host && !eng.region) { field('host')?.classList.add('is-error'); field('host')?.focus(); return; }
          if (existing) { Object.assign(existing, { name: v.name, host: v.host, port: +v.port || existing.port, user: v.user, db: v.db, env: v.env, readOnly: v.env === 'production' }); close(); App.rerender(); toast({ title: 'Connection saved', tone: 'ok' }); return; }
          const id = v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          DB.connections.push({ id, name: v.name, kind: ['neon', 'supabase'].includes(eng.id) ? 'postgres' : eng.id === 'planetscale' ? 'mysql' : eng.id === 'turso' ? 'sqlite' : eng.id, provider: ['neon', 'supabase', 'turso', 'planetscale'].includes(eng.id) ? eng.name : undefined, host: v.host, port: +v.port || undefined, db: v.db, user: v.user, from: eng.file ? 'file' : 'saved', env: v.env, readOnly: v.env === 'production', mono: eng.mono, icon: eng.icon, th: eng.th, tables: 0, sizeMB: 0 });
          SCHEMAS[id] = SCHEMAS['shop-pg'];
          close(); App.go('/data/' + id);
        };
      },
    });
    return s;
  }
  App.act('new-connection', () => connectionSheet());

  /* ---------- import and export ---------- */
  function progressRun(el, label, done) {
    const bar = $('[data-prog]', el), txt = $('[data-prog-t]', el);
    $('[data-prog-wrap]', el).classList.remove('hide');
    let p = 0;
    const id = setInterval(() => {
      p = Math.min(1, p + 0.07 + Math.random() * 0.09);
      bar.style.transform = `scaleX(${p})`;
      txt.textContent = `${label} ${Math.round(p * 100)}%`;
      if (p >= 1) { clearInterval(id); setTimeout(done, 240); }
    }, 120);
  }
  App.act('db-export', () => {
    const [cid, tid] = App.route.params;
    const t = cid && findTable(cid, tid) || (cid && tablesOf(cid)[0]);
    const name = t?.name || 'results';
    const gs = t && gridState(cid, t.id);
    sheet({
      title: `Export ${name}`, ic: 'table-export', width: 560,
      body: `<div class="col gap-16">
        <div class="field"><span class="label">Format</span><div class="seg" data-ex-fmt><button aria-pressed="true" data-f="csv">CSV</button><button aria-pressed="false" data-f="json">JSON</button><button aria-pressed="false" data-f="sql">SQL inserts</button><button aria-pressed="false" data-f="parquet">Parquet</button><button aria-pressed="false" data-f="xlsx">Excel</button></div></div>
        <div class="field"><span class="label">Rows</span>
          <label class="row"><input type="radio" class="radio" name="scope" checked>All ${t ? fmt.num(t.def.rows) : ''} rows</label>
          ${gs?.filters.length ? `<label class="row"><input type="radio" class="radio" name="scope">Rows matching the current filters</label>` : ''}
          <label class="row"><input type="radio" class="radio" name="scope">This page only (${gs?.size || 100} rows)</label>
          ${gs?.sel.size ? `<label class="row"><input type="radio" class="radio" name="scope">${gs.sel.size} selected rows</label>` : ''}
        </div>
        <div class="row gap-16" data-ex-csv>
          <label class="field" style="width:140px"><span class="label">Delimiter</span><select class="select"><option>Comma</option><option>Tab</option><option>Semicolon</option></select></label>
          <label class="field" style="width:140px"><span class="label">NULL as</span><input class="input mono" placeholder="empty"></label>
          <label class="row" style="margin-top:22px"><span class="switch"><input type="checkbox" checked><span></span></span>Header row</label>
        </div>
        <label class="field"><span class="label">Save to</span><div class="input-group"><input class="input mono" data-ex-path value="~/Downloads/${esc(name)}.csv"><button class="btn" type="button">Choose…</button></div></label>
        <div class="col hide" data-prog-wrap style="gap:6px"><div class="progress"><i data-prog style="transform:scaleX(0)"></i></div><span class="meta num" data-prog-t></span></div>
      </div>`,
      foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Export</button></div>`,
      onMount(el, close) {
        const path = $('[data-ex-path]', el);
        $('[data-ex-fmt]', el).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; path.value = path.value.replace(/\.\w+$/, '.' + b.dataset.f); $('[data-ex-csv]', el).classList.toggle('hide', b.dataset.f !== 'csv'); });
        $('[data-ok]', el).onclick = (e) => { e.currentTarget.disabled = true; progressRun(el, 'Writing', () => { close(); toast({ title: `Exported ${path.value.split('/').pop()}`, body: `${t ? fmt.num(t.def.rows) : ''} rows · saved to ${path.value.replace(/\/[^/]+$/, '')}`, tone: 'ok', actionLabel: 'Show in Finder' }); }); };
      },
    });
  });
  App.act('db-import', () => {
    const [cid, tid] = App.route.params;
    const t = (cid && findTable(cid, tid)) || (cid && tablesOf(cid)[0]);
    if (cid && readOnly(conn(cid))) return blockedToast(conn(cid));
    sheet({
      title: `Import into ${t?.name || 'a table'}`, ic: 'table-import', width: 640,
      body: `<div class="col gap-16">
        <div class="db-imp-drop" data-imp-drop>${icon('file-upload', 'xl')}<b class="ink">Drop a CSV, JSON, SQL or Parquet file</b><span class="meta">or <button class="btn btn-sm" data-imp-pick type="button">Choose file…</button></span></div>
        <div class="hide col gap-12" data-imp-preview>
          <div class="row"><span class="tile" style="--th:150">${icon('file-text')}</span><b class="ink">orders-backfill.csv</b><span class="meta">1,240 rows · 82 KB · comma separated, header row</span></div>
          <div class="field"><span class="label">Column mapping</span>
          <table class="tbl"><thead><tr><th>In the file</th><th>Sample</th><th>Goes into</th></tr></thead><tbody>
            ${(t?.def.cols || []).slice(0, 6).map((c, i) => `<tr><td><span class="mono">${esc(i === 2 ? 'order_state' : c[0])}</span></td><td><span class="mono-sm ink-3">${esc(raw(dataFor(cid, t.id)[i]?.[c[0]]).slice(0, 22))}</span></td><td><select class="select" style="height:24px;width:180px"><option>${esc(c[0])}</option><option>Skip this column</option></select>${i === 2 ? ' <span class="chip chip-warn" style="margin-left:6px">Name differs</span>' : ''}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="field"><span class="label">When a row already exists</span><div class="seg"><button aria-pressed="true">Skip it</button><button aria-pressed="false">Update it</button><button aria-pressed="false">Fail the import</button></div></div>
          <div class="col hide" data-prog-wrap style="gap:6px"><div class="progress"><i data-prog style="transform:scaleX(0)"></i></div><span class="meta num" data-prog-t></span></div>
        </div></div>`,
      foot: `<span class="meta">Runs in one transaction. Nothing is written if a row fails.</span><div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok disabled>Import 1,240 rows</button></div>`,
      onMount(el, close) {
        const show = () => { $('[data-imp-drop]', el).classList.add('hide'); $('[data-imp-preview]', el).classList.remove('hide'); $('[data-ok]', el).disabled = false; $$('.seg', el).forEach(segThumb); };
        $('[data-imp-pick]', el).onclick = show;
        const d = $('[data-imp-drop]', el);
        d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('is-over'); });
        d.addEventListener('dragleave', () => d.classList.remove('is-over'));
        d.addEventListener('drop', (e) => { e.preventDefault(); show(); });
        $('[data-ok]', el).onclick = (e) => { e.currentTarget.disabled = true; progressRun(el, 'Importing', () => { close(); toast({ title: `Imported 1,240 rows into ${t?.name}`, body: '1 transaction · 0.8 s', tone: 'ok' }); }); };
      },
    });
  });
  App.act('db-refresh', () => {
    const [cid, tid] = App.route.params;
    if (cid && tid) { const gs = gridState(cid, tid); gs.ms = 6 + Math.floor(Math.random() * 30); }
    toast({ title: 'Refreshed', body: 'Schema and rows reloaded', ic: 'refresh', ms: 1400 });
    $('[data-grid-shell]')?._paint?.();
  });

  /* ---------- menus ---------- */
  App.menu('db-conn', () => {
    const cid = App.route.params[0], c = conn(cid);
    return [
      { heading: `${c.name} · ${engineVersion[cid] || engineName(c)}` },
      { label: 'New query', icon: 'sql', kbd: '⌘T', act: 'db-new-query' },
      { label: 'Schema diagram', icon: 'schema', run: () => App.go(`/data/${cid}/diagram`) },
      { label: 'Query history', icon: 'history', run: () => App.go(`/data/${cid}/history`) },
      { sep: true },
      { label: 'Import data…', icon: 'table-import', act: 'db-import' },
      { label: 'Export…', icon: 'table-export', act: 'db-export' },
      { label: 'Refresh schema', icon: 'refresh', act: 'db-refresh' },
      { sep: true },
      { label: 'Edit connection…', icon: 'pencil', run: () => connectionSheet(c) },
      ...(c.container ? [{ label: `Open container ${c.container}`, icon: 'cx-container', run: () => App.go('/containers/' + c.container) }] : []),
      { label: 'Disconnect', icon: 'plug-off', run: () => { S.connected.delete(cid); App.go('/data'); toast({ title: `Disconnected from ${c.name}` }); } },
    ];
  });
  App.menu('db-switch', () => DB.connections.map((c) => ({ label: c.name, icon: c.env === 'production' ? 'lock' : 'cx-data', checked: c.id === App.route.params[0], run: () => App.go('/data/' + c.id) })));
  App.menu('db-table', (el) => {
    const cid = App.route.params[0], tid = el.dataset.t, c = conn(cid), t = findTable(cid, tid);
    return [
      { label: 'Open rows', icon: 'table', run: () => App.go(`/data/${cid}/${encodeURIComponent(tid)}`) },
      { label: 'Open structure', icon: 'columns', run: () => App.go(`/data/${cid}/${encodeURIComponent(tid)}/structure`) },
      { label: 'New query on this table', icon: 'sql', run: () => openSQLTab(cid, `select *\nfrom ${qname(t)}\nlimit 100;`) },
      { sep: true },
      { label: 'Import into…', icon: 'table-import', act: 'db-import' },
      { label: 'Export…', icon: 'table-export', act: 'db-export' },
      { label: 'Copy name', icon: 'copy', run: () => { navigator.clipboard?.writeText(qname(t)).catch(() => {}); toast({ title: 'Copied', body: qname(t), ic: 'copy', ms: 1500 }); } },
      { sep: true },
      { label: 'Truncate…', icon: 'eraser', danger: true, run: () => (readOnly(c) ? blockedToast(c) : confirmSheet({ title: `Truncate ${t.name}?`, body: `All ${fmt.num(t.def.rows)} rows in <b>${esc(qname(t))}</b> are deleted. The table and its structure stay. This can’t be undone.`, action: 'Truncate table', onConfirm: () => toast({ title: `${t.name} truncated`, tone: 'ok' }) })) },
      { label: 'Drop table…', icon: 'trash', danger: true, run: () => (readOnly(c) ? blockedToast(c) : confirmSheet({ title: `Drop ${t.name}?`, body: `<b>${esc(qname(t))}</b> and its ${fmt.num(t.def.rows)} rows are deleted, along with its indexes. Foreign keys pointing at it block the drop unless you cascade. This can’t be undone.`, action: 'Drop table', onConfirm: () => toast({ title: `${t.name} dropped`, tone: 'ok' }) })) },
    ];
  });

  /* ---------- the view ---------- */
  App.view('data', {
    title: 'Data',
    get flush() { return App.route.name === 'data' && App.route.params.length > 0; },
    crumbs(ctx) {
      const [cid, sub, sub2] = ctx.params;
      if (!cid) return '<b>Data</b>';
      const c = conn(cid);
      if (!c) return `<a data-go="/data">Data</a>`;
      const t = sub && !['query', 'diagram', 'history'].includes(sub) ? findTable(cid, sub) : null;
      const leaf = c.kind === 'redis' ? 'Keys' : sub === 'query' ? (S.tabs[cid]?.find((x) => x.key === 'query:' + (ctx.query.t || 1))?.title || 'Query') : sub === 'diagram' ? 'Schema diagram' : sub === 'history' ? 'History' : t ? qname(t) + (sub2 === 'structure' ? ' structure' : '') : tablesOf(cid)[0] ? qname(tablesOf(cid)[0]) : '';
      return `<a data-go="/data">Data</a>${icon('chevron-right')}<button data-menu="db-switch" class="row" style="gap:6px">${tile(c, 'db-tile-xs')}${esc(c.name)}${c.env === 'production' ? icon('lock', 'sm') : ''}</button>${leaf && S.connected.has(cid) ? `${icon('chevron-right')}<b>${esc(leaf)}</b>` : ''}`;
    },
    tools(ctx) {
      const [cid] = ctx.params;
      if (!cid || !conn(cid) || !S.connected.has(cid)) return '';
      if (conn(cid).kind === 'redis') return `<button class="btn btn-ghost btn-icon" data-act="db-refresh" aria-label="Refresh" data-tip="Refresh">${icon('refresh')}</button><button class="btn btn-ghost btn-icon" data-menu="db-conn" data-align="end" aria-label="Connection" data-tip="Connection">${icon('dots')}</button>`;
      return `<button class="btn btn-ghost btn-icon" data-act="db-import" aria-label="Import" data-tip="Import data">${icon('table-import')}</button>
        <button class="btn btn-ghost btn-icon" data-act="db-export" aria-label="Export" data-tip="Export">${icon('table-export')}</button>
        <button class="btn btn-ghost btn-icon" data-go="/data/${cid}/diagram" aria-label="Schema diagram" data-tip="Schema diagram">${icon('schema')}</button>
        <button class="btn btn-sm" data-act="db-new-query">${icon('sql', 'sm')}New query<span class="kbd">⌘T</span></button>
        <button class="btn btn-ghost btn-icon" data-menu="db-conn" data-align="end" aria-label="Connection" data-tip="Connection">${icon('dots')}</button>`;
    },
    render(ctx) { return ctx.params.length ? workspace(ctx) : home(); },
    mount(root, ctx) {
      const [cid, sub] = ctx.params;
      App.on('key', (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); App.actions['new-connection'](); }
        if (cid && S.connected.has(cid) && mod && !e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); App.actions['db-new-query'](); }
      });
      App.cleanup(dbPopClose);
      if (!cid) return mountHome(root);
      const c = conn(cid);
      if (!c) return;
      if (!S.connected.has(cid)) {
        if (S.failing.has(cid) && S.connecting !== cid) return;
        const id = setTimeout(() => { S.connected.add(cid); S.connecting = null; App.rerender(); toast({ title: `Connected to ${c.name}`, body: engineVersion[cid] || engineName(c), tone: 'ok', ms: 2000 }); }, 900);
        App.cleanup(() => clearTimeout(id));
        return;
      }
      if (c.kind === 'redis') return mountRedis(root);
      // tree filter
      const tq = $('[data-db-treeq]', root);
      tq?.addEventListener('input', () => {
        const s = tq.value.trim().toLowerCase();
        $$('.dbt-table', root).forEach((b) => b.classList.toggle('hide', !!s && !b.dataset.name.includes(s)));
        if (s) $$('details.dbt-group', root).forEach((d) => (d.open = true));
      });
      if (sub === 'query') return mountEditor(root, cid);
      if (sub === 'diagram') return mountDiagram(root, cid);
      if (sub === 'history') {
        const q = $('[data-dbh-q]', root);
        q?.addEventListener('input', () => $$('.dbh-item', root).forEach((it) => it.classList.toggle('hide', !it.dataset.q.includes(q.value.toLowerCase()))));
        return;
      }
      const t = findTable(cid, sub || tablesOf(cid)[0].id);
      if (t && ctx.params[2] !== 'structure') mountGrid(root, cid, t);
      $('.dbt-table.is-active', root)?.scrollIntoView({ block: 'nearest' });
    },
  });
})();
