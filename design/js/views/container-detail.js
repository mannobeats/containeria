// Container detail: overview, logs, terminal, files, stats, inspect.
const cdTabs = [
  ['overview', 'Overview', 'layout-list'],
  ['logs', 'Logs', 'file-text'],
  ['terminal', 'Terminal', 'terminal-2'],
  ['files', 'Files', 'folder'],
  ['stats', 'Stats', 'chart-line'],
  ['inspect', 'Inspect', 'braces'],
];

function cdLogs(c) {
  if (DB.logs[c.name]) return DB.logs[c.name];
  if (c.exitCode) return [
    ['12:05:58.101', 'info', 'stripe-mock 0.188.0'],
    ['12:05:58.102', 'info', 'Using OpenAPI spec embedded in binary'],
    ['12:05:58.140', 'info', 'Loaded 541 fixtures'],
    ['12:05:58.141', 'error', 'listen tcp :12111: bind: address already in use'],
    ['12:05:58.141', 'error', 'exit status 1'],
    ['12:06:03.402', 'info', 'restarting (attempt 5 of 5, policy on-failure:5)'],
    ['12:06:03.455', 'error', 'listen tcp :12111: bind: address already in use'],
    ['12:06:03.455', 'error', 'giving up after 5 restarts'],
  ];
  const base = c.image.split('/').pop();
  return [
    ['12:04:09.877', 'info', `${base} ${c.tag} starting`],
    ['12:04:10.004', 'info', `PID 1: ${c.cmd}`],
    ['12:04:10.731', 'info', c.ports[0] ? `listening on 0.0.0.0:${c.ports[0].ctr}` : 'ready'],
    ['12:04:11.002', 'debug', 'config loaded from environment (12 keys)'],
    ['12:06:30.410', 'info', 'checkpoint complete: wrote 42 buffers (0.3%)'],
    ['12:07:12.993', c.health === 'unhealthy' ? 'warn' : 'info', c.health === 'unhealthy' ? 'health check GET /health/ready returned 503 after 5.0s' : 'health check passed'],
    ['12:08:01.215', 'info', 'connection received: host=172.20.0.3 port=51842'],
  ];
}
const cdLive = {
  'shop-api': [['info', 'GET /v1/products?category=tees 200 7.4ms'], ['info', 'GET /healthz 200 0.2ms'], ['debug', 'cache hit products:category:tees ttl=212s'], ['info', 'POST /v1/cart/items 201 10.8ms'], ['warn', 'slow query 388ms: select * from inventory_moves where product_id = $1'], ['info', 'GET /v1/orders?customer=10231 200 5.1ms']],
};

function cdHeader(c) {
  const on = c.state === 'running';
  const proj = DB.projects.find((p) => p.id === c.project);
  return `<div class="cd-head">
    ${tile(c, 'tile-xl', c.exitCode ? 'is-bad' : on ? '' : 'is-off')}
    <div class="grow">
      <div class="row"><h1 class="h-page truncate">${esc(c.name)}</h1>${c.health === 'unhealthy' ? `<span class="chip chip-warn">${icon('alert-triangle')}Unhealthy</span>` : ''}${c.exitCode ? `<span class="chip chip-bad">${icon('alert-circle')}Exited (${c.exitCode})</span>` : ''}</div>
      <div class="cd-sub">
        <span class="mono-sm">${esc(c.image)}:${esc(c.tag)}</span>
        ${proj ? `<span>${esc(proj.name)} · ${esc(c.service)}</span>` : '<span>Standalone</span>'}
        <span>${on ? `Up ${fmt.dur(c.started)}` : `Exited ${fmt.ago(c.finished)}`}</span>
        <button class="cd-domain" data-copy="${esc(c.domain)}" data-tip="Copy domain">${icon('cx-domain', 'sm')}${esc(c.domain)}</button>
      </div>
    </div>
    <div class="row cd-actions">
      ${c.db ? `<button class="btn" data-act="ct-open-data" data-arg="${c.name}">${icon('cx-data')}Open in Data</button>` : ''}
      ${on && c.ports[0] ? `<a class="btn" href="http://localhost:${c.ports[0].host}" target="_blank" rel="noopener" data-tip="https://${esc(c.domain)}">${icon('external-link')}Open</a>` : ''}
      <button class="btn btn-icon" data-act="ct-restart" data-arg="${c.name}" data-tip="Restart" data-kbd="⌘R">${icon('refresh')}</button>
      ${on ? `<button class="btn" data-act="ct-toggle" data-arg="${c.name}">${icon('player-stop')}Stop</button>` : `<button class="btn btn-brand" data-act="ct-toggle" data-arg="${c.name}">${icon('player-play')}Start</button>`}
      <button class="btn btn-icon" data-menu="container" data-name="${c.name}" data-align="end" aria-label="More">${icon('dots')}</button>
    </div>
  </div>`;
}

function cdOverview(c) {
  const on = c.state === 'running';
  const conn = DB.connections.find((x) => x.container === c.name);
  const proj = DB.projects.find((p) => p.id === c.project);
  const mates = DB.containers.filter((x) => x.project && x.project === c.project && x !== c);
  const env = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin', HOSTNAME: c.id, ...(c.env || {}), ...(c.name === 'shop-api' ? { DATABASE_URL: 'postgres://shop:shop_dev_pw@postgres:5432/shop', REDIS_URL: 'redis://redis:6379/0', PAYMENTS_URL: 'http://payments-mock:12111', LOG_LEVEL: 'debug' } : {}) };
  const secret = (k) => /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL/.test(k);
  const vol = DB.volumes.find((v) => v.usedBy.includes(c.name));
  return `<div class="cd-over">
    <div class="cd-main">
      ${c.exitCode ? `<div class="banner banner-bad">${icon('alert-circle')}<span class="grow"><b>Crashed after 5 restarts.</b> <span class="mono-sm">${esc(c.error)}</span><br><span style="opacity:.85">Port 12111 is held by <b>node</b> (PID 48121) on your Mac.</span></span><button class="btn btn-sm" data-act="ct-fix-port" data-arg="${c.name}">Use port 12112</button><button class="btn btn-sm" data-go="/containers/${c.name}/logs">Logs</button></div>` : ''}
      ${conn ? `<div class="banner banner-brand cd-db">${tile(conn)}<span class="grow"><b>${conn.kind === 'postgres' ? 'PostgreSQL 17' : conn.kind === 'mysql' ? 'MySQL 8.4' : conn.kind === 'redis' ? 'Redis 7.4' : 'ClickHouse 25.1'} is running here.</b> Credentials found in ${conn.kind === 'redis' ? 'the default config' : `<span class="mono-sm">${Object.keys(c.env || {}).slice(0, 2).join(', ') || 'env'}</span>`}, so you can browse it without setting anything up.</span><button class="btn btn-brand btn-sm" data-go="/data/${conn.id}">Open ${esc(conn.db === '0' ? 'keys' : conn.db)}</button></div>` : ''}

      <section class="cd-sec"><h2 class="h-sub">Details</h2>
        <dl class="kv">
          <dt>Image</dt><dd><button class="chip chip-mono" data-go="/images/${encodeURIComponent(c.image + ':' + c.tag)}">${esc(c.image)}:${esc(c.tag)}</button></dd>
          <dt>Command</dt><dd class="mono">${esc(c.cmd)}</dd>
          <dt>Container ID</dt><dd class="mono ink-3">${c.id}<button class="btn btn-ghost btn-icon btn-sm" data-copy="${c.id}" data-tip="Copy">${icon('copy', 'sm')}</button></dd>
          <dt>Created</dt><dd>${fmt.date((c.started || c.finished) - 9 * 3600e3)}</dd>
          <dt>${on ? 'Started' : 'Finished'}</dt><dd>${fmt.date(on ? c.started : c.finished)} <span class="ink-3">${on ? fmt.ago(c.started) : fmt.ago(c.finished)}</span></dd>
          <dt>Restart policy</dt><dd>${c.exitCode ? 'on-failure, max 5' : c.project ? 'unless-stopped' : 'no'}${c.restarts ? ` <span class="ink-3">· ${c.restarts} restarts</span>` : ''}</dd>
          <dt>Platform</dt><dd>linux/${c.image.includes('stripe') ? 'amd64 <span class="ink-3">· Rosetta</span>' : 'arm64'}</dd>
          <dt>IP address</dt><dd class="mono">${on ? '172.20.0.' + (3 + DB.containers.indexOf(c)) : '—'}</dd>
          <dt>Domain</dt><dd><a href="https://${esc(c.domain)}" target="_blank" rel="noopener">${esc(c.domain)}</a>${icon('lock', 'sm ok-ink')}<span class="meta">HTTPS</span></dd>
        </dl>
      </section>

      <section class="cd-sec"><h2 class="h-sub">Ports</h2>
        ${c.ports.length ? `<table class="tbl cd-mini"><thead><tr><th>Mac</th><th>Container</th><th>Protocol</th><th>Also at</th><th></th></tr></thead><tbody>${c.ports.map((p) => `<tr><td class="mono">localhost:${p.host}</td><td class="mono">${p.ctr}</td><td>TCP</td><td class="mono-sm ink-3">${esc(c.domain)}:${p.ctr}</td><td class="r"><a class="btn btn-ghost btn-sm" href="http://localhost:${p.host}" target="_blank" rel="noopener">Open ↗</a></td></tr>`).join('')}</tbody></table>`
          : `<p class="meta">No published ports. It’s still reachable from your Mac at <span class="mono-sm">${esc(c.domain)}</span>.</p>`}
      </section>

      <section class="cd-sec"><h2 class="h-sub">Mounts</h2>
        <table class="tbl cd-mini"><thead><tr><th>Source</th><th>Destination</th><th>Mode</th></tr></thead><tbody>
          ${vol ? `<tr data-go="/volumes/${vol.name}"><td><span class="row">${icon('cx-volume', 'sm ink-3')}<span class="mono-sm">${esc(vol.name)}</span></span></td><td class="mono-sm">${esc(vol.mount)}</td><td>rw</td></tr>` : ''}
          ${proj ? `<tr><td><span class="row">${icon('folder', 'sm ink-3')}<span class="mono-sm">${esc(proj.path)}/${esc(c.service)}</span></span></td><td class="mono-sm">/app</td><td>rw · VirtioFS</td></tr>` : ''}
          ${!vol && !proj ? `<tr><td colspan="3" class="ink-3">No mounts</td></tr>` : ''}
        </tbody></table>
      </section>

      <section class="cd-sec"><div class="row"><h2 class="h-sub">Environment</h2><span class="meta">${Object.keys(env).length} variables</span><button class="btn btn-ghost btn-sm right" data-act="cd-reveal">${icon('eye', 'sm')}Reveal values</button></div>
        <table class="tbl cd-mini cd-env"><tbody>${Object.entries(env).map(([k, v]) => `<tr><td class="mono-sm ink" style="width:38%">${esc(k)}</td><td class="mono-sm"><span class="${secret(k) ? 'cd-secret' : ''}" data-v="${esc(v)}">${secret(k) ? '••••••••••••' : esc(v)}</span></td><td class="r" style="width:40px"><button class="btn btn-ghost btn-icon btn-sm" data-copy="${esc(k)}=${esc(v)}" data-tip="Copy">${icon('copy', 'sm')}</button></td></tr>`).join('')}</tbody></table>
      </section>
    </div>

    <aside class="cd-side">
      <section class="cd-sec">
        <div class="row"><h2 class="h-sub">CPU</h2><b class="right ink num" data-cd-cpu>${on ? fmt.pct(c.cpu) : '—'}</b></div>
        <div class="cd-spark" data-spark="cpu"></div>
      </section>
      <section class="cd-sec">
        <div class="row"><h2 class="h-sub">Memory</h2><b class="right ink num" data-cd-mem>${on ? fmt.mb(c.memMB) : '—'}</b></div>
        <div class="cd-spark" data-spark="mem"></div>
        <p class="meta" style="margin:6px 0 0">No limit set. The engine returns unused memory to macOS.</p>
      </section>
      ${c.health ? `<section class="cd-sec"><div class="row"><h2 class="h-sub">Health check</h2><span class="right meta">every 10s</span></div>
        <div class="cd-health">${Array.from({ length: 30 }, (_, i) => `<i class="${c.health === 'unhealthy' && (i > 25 || i === 19) ? 'is-bad' : ''}"></i>`).join('')}</div>
        <p class="meta" style="margin:6px 0 0">${c.health === 'unhealthy' ? '<span class="warn-ink">Failing for 40s.</span> GET /health/ready returned 503.' : 'Passing. Last check 3s ago.'}</p></section>` : ''}
      ${proj ? `<section class="cd-sec"><div class="row"><h2 class="h-sub">${esc(proj.name)}</h2><span class="right meta">${mates.length + 1} services</span></div>
        <div class="cd-mates">${mates.map((m) => `<button class="cd-mate" data-go="/containers/${m.name}">${tile(m, '', m.state === 'running' ? '' : 'is-off')}<span class="truncate">${esc(m.service)}</span><span class="meta right">${m.state === 'running' ? fmt.mb(m.memMB) : 'Stopped'}</span></button>`).join('')}</div>
        <p class="meta mono-sm" style="margin:8px 0 0">${esc(proj.path)}/compose.yaml</p></section>` : ''}
    </aside>
  </div>`;
}

function cdStats() {
  return `<div class="cd-stats">
    <div class="row" style="padding:16px 20px 0"><div class="seg seg-sm"><button aria-pressed="true">5 min</button><button aria-pressed="false">1 hour</button><button aria-pressed="false">24 hours</button></div><span class="meta right">Sampled every 2 seconds</span></div>
    <div class="cd-stats-grid">
      <section><div class="row"><h2 class="h-sub">CPU</h2><span class="meta">of 6 cores</span><b class="right ink num" data-cd-cpu></b></div><div data-chart="cpu"></div></section>
      <section><div class="row"><h2 class="h-sub">Memory</h2><span class="meta">no limit</span><b class="right ink num" data-cd-mem></b></div><div data-chart="mem"></div></section>
      <section><div class="row"><h2 class="h-sub">Network</h2><span class="meta">received and sent</span></div><div data-chart="net"></div></section>
      <section><div class="row"><h2 class="h-sub">Disk</h2><span class="meta">read and write</span></div><div data-chart="disk"></div></section>
    </div></div>`;
}

function cdInspect(c) {
  const obj = { Id: c.id + 'f1c9a2e0b7d64e5a8c3b1f0e9d2a7c6b5e4d3c2b1a0f9e8d7', Created: new Date(c.started || c.finished).toISOString(), Path: c.cmd.split(' ')[0], Args: c.cmd.split(' ').slice(1), State: { Status: c.state, Running: c.state === 'running', Pid: 4182, ExitCode: c.exitCode || 0, StartedAt: new Date(c.started || 0).toISOString(), Health: c.health ? { Status: c.health, FailingStreak: c.health === 'unhealthy' ? 4 : 0 } : undefined }, Image: 'sha256:2b7d0e91c4a8', Name: '/' + c.name, RestartCount: c.restarts, Platform: 'linux', HostConfig: { NetworkMode: c.project ? c.project + '_default' : 'bridge', RestartPolicy: { Name: c.project ? 'unless-stopped' : 'no' }, PortBindings: Object.fromEntries(c.ports.map((p) => [p.ctr + '/tcp', [{ HostIp: '', HostPort: String(p.host) }]])) }, Config: { Hostname: c.id, Image: `${c.image}:${c.tag}`, Labels: c.project ? { 'com.docker.compose.project': c.project, 'com.docker.compose.service': c.service, 'dev.containeria.domain': c.domain } : { 'dev.containeria.domain': c.domain } } };
  const json = JSON.stringify(obj, null, 2).replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m]))
    .replace(/("[^"]+")(:)/g, '<span class="j-k">$1</span>$2').replace(/: ("[^"]*")/g, ': <span class="j-s">$1</span>').replace(/: (-?\d+|true|false|null)/g, ': <span class="j-n">$1</span>');
  return `<div class="cd-inspect"><div class="logs-bar"><div class="search" style="width:240px">${icon('search')}<input class="input" placeholder="Find in JSON" aria-label="Find in JSON"></div><button class="btn btn-sm right" data-copy="docker inspect ${c.name}">${icon('copy', 'sm')}Copy JSON</button></div><pre class="cd-json selectable">${json}</pre></div>`;
}

const ContainerDetail = {
  crumbs(ctx) {
    const c = ctFind(ctx.params[0]); if (!c) return '<b>Not found</b>';
    const p = DB.projects.find((x) => x.id === c.project);
    return `<a href="#/containers" data-go="/containers">Containers</a>${icon('chevron-right')}${p ? `<span style="padding:2px 4px">${esc(p.name)}</span>${icon('chevron-right')}` : ''}<b>${esc(c.service || c.name)}</b>`;
  },
  tools(ctx) {
    const i = DB.containers.findIndex((c) => c.name === ctx.params[0]);
    const prev = DB.containers[i - 1], next = DB.containers[i + 1];
    return `<button class="btn btn-ghost btn-icon" ${prev ? `data-go="/containers/${prev.name}/${ctx.params[1] || ''}"` : 'disabled'} data-tip="Previous container" data-kbd="⌘[">${icon('chevron-up')}</button><button class="btn btn-ghost btn-icon" ${next ? `data-go="/containers/${next.name}/${ctx.params[1] || ''}"` : 'disabled'} data-tip="Next container" data-kbd="⌘]">${icon('chevron-down')}</button>`;
  },
  render(ctx) {
    const c = ctFind(ctx.params[0]);
    if (!c) return `<div class="empty" style="height:100%">${icon('box-off', 'xl')}<h2 class="h-sec">This container was deleted</h2><button class="btn" data-go="/containers">Back to containers</button></div>`;
    const tab = ctx.params[1] || 'overview', on = c.state === 'running';
    const body = {
      overview: () => `<div class="cd-scroll">${cdOverview(c)}</div>`,
      logs: () => logPane({ lines: cdLogs(c) }),
      terminal: () => on ? `<div class="cd-term-bar"><button class="btn btn-sm" data-menu="cd-shell">${icon('terminal-2', 'sm')}sh · root${icon('chevron-down', 'sm')}</button><label class="row meta" data-tip="Adds curl, htop, strace and vim on top of minimal images without changing them"><span class="switch"><input type="checkbox" data-act="cd-debug"><span></span></span>Debug shell</label><button class="btn btn-sm right" data-copy="cx exec -it ${c.name} sh">${icon('copy', 'sm')}Copy command</button><button class="btn btn-sm">${icon('app-window', 'sm')}Open in Terminal</button></div>${terminalPane({ host: c.id.slice(0, 12), cwd: '/app', lines: [{ cmd: 'ls', out: termCmds.ls() }], note: `Connected to ${esc(c.name)} · type <b>help</b> for commands` })}`
        : `<div class="empty" style="height:100%">${icon('terminal-2', 'xl')}<h2 class="h-sec">${esc(c.name)} isn’t running</h2><p>Start it to open a shell, or use a debug shell on its stopped filesystem.</p><div class="row"><button class="btn btn-brand" data-act="ct-toggle" data-arg="${c.name}">Start container</button><button class="btn">Debug stopped filesystem</button></div></div>`,
      files: () => { const k = /node/.test(c.image) ? 'node-app' : /postgres/.test(c.image) ? 'postgres-data' : 'go-app'; return filesPane({ ...fakeFS[k], finder: `~/Containeria/containers/${c.name}${fakeFS[k].path}` }); },
      stats: () => on ? cdStats() : `<div class="empty" style="height:100%">${icon('chart-line', 'xl')}<h2 class="h-sec">No live stats while it’s stopped</h2><p>Stats from the last run: peak 41% CPU, 96 MB memory.</p></div>`,
      inspect: () => cdInspect(c),
    }[tab]?.() ?? '';
    return `${cdHeader(c)}
      <div class="tabs" role="tablist">${cdTabs.map(([id, label]) => `<button class="tab" role="tab" aria-selected="${tab === id}" data-go="/containers/${c.name}/${id === 'overview' ? '' : id}">${label}${id === 'logs' && c.exitCode ? `<span class="count bad-ink">${cdLogs(c).filter((l) => l[1] === 'error').length}</span>` : ''}</button>`).join('')}</div>
      <div class="cd-body cd-${tab}">${body}</div>`;
  },
  mount(root, ctx) {
    const c = ctFind(ctx.params[0]); if (!c) return;
    const tab = ctx.params[1] || 'overview';
    if (tab === 'logs') mountLogs(root, { live: c.state === 'running' ? cdLive[c.name] || [['info', 'GET /healthz 200 0.4ms'], ['debug', 'tick']] : [] });
    if (tab === 'terminal') { mountTerminal(root); setTimeout(() => { const i = $('.term-input', root); i && placeCaret(i); }, 80); }
    if (tab === 'files') mountFiles(root);
    if (tab === 'overview' && c.state === 'running') {
      const cpu = series(60, 2, wave(c.cpu, c.cpu * .6, 1.3)), mem = series(60, 2, wave(c.memMB, c.memMB * .05, .7));
      const uc = chart($('[data-spark="cpu"]', root), { series: [{ label: 'CPU', color: '--s1' }], data: cpu, height: 64, yFmt: (v) => fmt.pct(v), spark: true });
      const um = chart($('[data-spark="mem"]', root), { series: [{ label: 'Memory', color: '--s2' }], data: mem, height: 64, yFmt: (v) => fmt.mb(v), spark: true });
      App.on('stats', () => {
        const t = Math.floor(Date.now() / 1000);
        [[uc, cpu, c.cpu], [um, mem, c.memMB]].forEach(([u, d, v]) => { d[0].push(t); d[1].push(v); d[0].shift(); d[1].shift(); u.setData(d); });
        $('[data-cd-cpu]', root).textContent = fmt.pct(c.cpu); $('[data-cd-mem]', root).textContent = fmt.mb(c.memMB);
      });
    }
    if (tab === 'stats' && c.state === 'running') {
      const tf = (u, v) => v.map((x) => new Date(x * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
      const cpu = series(150, 2, wave(c.cpu, c.cpu * .6, 1.3)), mem = series(150, 2, wave(c.memMB, c.memMB * .05, .7));
      const rx = series(150, 2, wave(120, 80, 2)), tx = [rx[0], rx[1].map((v) => v * .42 + Math.random() * 10)];
      const rd = series(150, 2, wave(2.4, 2, 3)), wr = [rd[0], rd[1].map((v) => v * 1.8 + Math.random() * .3)];
      const charts = [
        chart($('[data-chart="cpu"]', root), { series: [{ label: 'CPU', color: '--s1' }], data: cpu, height: 170, yFmt: (v) => fmt.pct(v), xFmt: tf }),
        chart($('[data-chart="mem"]', root), { series: [{ label: 'Memory', color: '--s2' }], data: mem, height: 170, yFmt: (v) => fmt.mb(v), xFmt: tf }),
        chart($('[data-chart="net"]', root), { series: [{ label: 'Received', color: '--s1' }, { label: 'Sent', color: '--s3', fill: false }], data: [rx[0], rx[1], tx[1]], height: 170, yFmt: (v) => Math.round(v) + ' KB/s', xFmt: tf }),
        chart($('[data-chart="disk"]', root), { series: [{ label: 'Read', color: '--s4' }, { label: 'Write', color: '--s6', fill: false }], data: [rd[0], rd[1], wr[1]], height: 170, yFmt: (v) => v.toFixed(1) + ' MB/s', xFmt: tf }),
      ];
      App.on('stats', () => {
        const t = Math.floor(Date.now() / 1000);
        const push = (d, ...vs) => { d[0].push(t); d[0].shift(); vs.forEach((v, k) => { d[k + 1].push(v); d[k + 1].shift(); }); };
        push(cpu, c.cpu); push(mem, c.memMB);
        charts[0].setData(cpu); charts[1].setData(mem);
        $('[data-cd-cpu]', root).textContent = fmt.pct(c.cpu); $('[data-cd-mem]', root).textContent = fmt.mb(c.memMB);
      });
      $('[data-cd-cpu]', root).textContent = fmt.pct(c.cpu); $('[data-cd-mem]', root).textContent = fmt.mb(c.memMB);
    }
  },
};

App.act('cd-reveal', (el) => {
  const show = !el.classList.toggle('is-on') ? false : true;
  $$('.cd-secret').forEach((s) => (s.textContent = show ? s.dataset.v : '••••••••••••'));
  el.innerHTML = show ? `${icon('eye-off', 'sm')}Hide values` : `${icon('eye', 'sm')}Reveal values`;
});
App.act('cd-debug', (el) => toast({ title: el.checked ? 'Debug shell on' : 'Debug shell off', body: el.checked ? 'curl, htop, strace and vim are available. The image is unchanged.' : 'Back to the image’s own shell.', ic: 'tool' }));
App.menu('cd-shell', () => [{ heading: 'Shell' }, { label: 'sh', checked: true }, { label: 'bash' }, { label: 'zsh', disabled: true }, { heading: 'User' }, { label: 'root', checked: true }, { label: 'node' }]);
document.addEventListener('keydown', (e) => {
  if (App.route.name !== 'containers' || !App.route.params[0] || !(e.metaKey || e.ctrlKey)) return;
  if (e.key === '[' || e.key === ']') { const b = $$('.topbar .tools .btn')[e.key === '[' ? 0 : 1]; if (b?.dataset.go) { e.preventDefault(); App.go(b.dataset.go); } }
});
