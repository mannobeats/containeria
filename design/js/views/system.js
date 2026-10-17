// System screens: Domains, Activity, Settings, First launch, and the Run container / Compose / shortcuts / diagnostics sheets.
const sys = { caTrusted: false, wildcard: true, directIP: true, httpsAll: true, range: '5m' };

/* ---------- small builders ---------- */
const swi = (on, label, attrs = '') => `<label class="switch"><input type="checkbox" ${on ? 'checked' : ''} aria-label="${esc(label)}" ${attrs}><span></span></label>`;
const setRow = (label, control, hint = '', attrs = '') => `<div class="set-row" ${attrs}><div class="set-row-text"><span class="ink">${label}</span>${hint ? `<span class="hint">${hint}</span>` : ''}</div><div class="set-row-ctl">${control}</div></div>`;
const setSec = (title, rows, note = '') => `<section class="set-sec">${title ? `<h3 class="h-sub">${title}</h3>` : ''}<div class="set-group">${rows}</div>${note ? `<p class="set-note">${note}</p>` : ''}</section>`;
const sel = (opts, value, attrs = '') => `<select class="select" ${attrs}>${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
const seg2 = (opts, value, attrs = '', sm = true) => `<div class="seg ${sm ? 'seg-sm' : ''}" ${attrs}>${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<button type="button" aria-pressed="${v === value}" data-v="${esc(v)}">${l}</button>`; }).join('')}</div>`;
const unitOf = (n, unit) => (+n === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit);
const slider = ({ key, min, max, step = 1, value, unit }) => `<div class="set-slider"><input type="range" class="range" min="${min}" max="${max}" step="${step}" value="${value}" data-key="${key}" data-unit="${unit}" aria-label="${key}"><output class="num ink">${value} ${unitOf(value, unit)}</output></div><div class="set-ticks"><span>${min} ${unitOf(min, unit)}</span><span>${max} ${unit}</span></div>`;
function ranges(root) {
  $$('.range', root).forEach((r) => {
    const out = r.parentElement.querySelector('output');
    const upd = () => { r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'); if (out && r.dataset.unit) out.textContent = `${r.value} ${unitOf(r.value, r.dataset.unit)}`; };
    upd(); r.addEventListener('input', upd);
  });
}
App.act('sys-open-url', (el, url) => toast({ title: 'Opened in your browser', body: url, ic: 'external-link', ms: 2200 }));

/* ======================================================================
   Domains
   ====================================================================== */
const kindMeta = {
  custom: { label: 'Your routes', ic: 'route' },
  container: { label: 'Containers', ic: 'cx-container' },
  kubernetes: { label: 'Kubernetes services', ic: 'cx-kube' },
  machine: { label: 'Linux machines', ic: 'cx-machine' },
};
function domainRow(d) {
  const ctr = DB.containers.find((c) => c.name === d.target);
  const mach = DB.machines.find((m) => m.name === d.target);
  const face = ctr ? tile(ctr) : mach ? tile(mach) : `<span class="tile" style="--th:200">${icon('cx-kube')}</span>`;
  const scheme = d.https ? 'https' : 'http';
  const url = `${scheme}://${d.host}`;
  const lock = d.https
    ? sys.caTrusted ? `<span class="row gap-4" data-tip="Signed by the Containeria local certificate">${icon('lock', 'sm')}HTTPS</span>` : `<span class="row gap-4 ink-3" data-tip="Browsers warn until you trust the local certificate">${icon('lock-open', 'sm')}Untrusted</span>`
    : `<span class="row gap-4 ink-3">${icon('world', 'sm')}HTTP</span>`;
  return `<tr class="${d.up ? '' : 'is-off'}" data-ctx="domain-row" data-host="${esc(d.host)}" data-kind="${d.kind}">
    <td><span class="row"><span class="ink truncate" style="max-width:340px">${esc(d.host)}</span>${d.auto ? '' : '<span class="chip">Custom</span>'}</span></td>
    <td><span class="row">${face}<span class="truncate">${esc(d.target)}</span>${d.port ? `<span class="mono-sm ink-3">:${d.port}</span>` : ''}</span></td>
    <td>${lock}</td>
    <td>${d.up ? 'Up' : 'Stopped'}</td>
    <td class="r"><span class="row-actions">
      <button class="btn btn-ghost btn-icon btn-sm" data-act="sys-open-url" data-arg="${url}" data-tip="Open ${url} ↗" ${d.up ? '' : 'disabled'}>${icon('external-link')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-copy="${url}" data-tip="Copy URL">${icon('copy')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-menu="domain-row" data-host="${esc(d.host)}" data-kind="${d.kind}" data-align="end" aria-label="More" data-tip="More">${icon('dots')}</button>
    </span></td></tr>`;
}
App.view('domains', {
  title: 'Domains',
  tools: () => `<button class="btn btn-ghost btn-icon" data-go="/settings/network" data-tip="Network settings">${icon('settings')}</button>`,
  render() {
    const up = DB.domains.filter((d) => d.up).length;
    const groups = ['custom', 'container', 'kubernetes', 'machine'];
    return `
    <div class="page-head"><h1 class="h-page">Domains</h1><button class="btn btn-brand" data-act="add-route">${icon('plus')}Add route</button></div>
    <div class="sys-lede"><p><b class="ink num">${up} of ${DB.domains.length}</b> routes are up. Every container, service and machine gets a name under <span class="mono ink">.${esc(DB.engine.domain)}</span>, no ports to remember.</p></div>
    <div style="padding:0 20px 16px">
      ${sys.caTrusted
        ? `<div class="banner banner-ok">${icon('shield-check')}<span class="grow"><b>HTTPS is trusted.</b> The Containeria certificate authority lives in your login keychain and expires Oct 2036.</span><button class="btn btn-sm btn-ghost" data-act="untrust-ca">Remove</button></div>`
        : `<div class="banner banner-warn">${icon('shield-lock')}<span class="grow"><b>Browsers will warn on https:// links.</b> Trust the local certificate authority once. It's created on this Mac and never leaves it.</span><button class="btn btn-sm" data-act="trust-ca">${icon('certificate', 'sm')}Trust certificate</button></div>`}
    </div>
    <div class="tbl-wrap"><table class="tbl sys-domains">
      <thead><tr><th>Domain</th><th>Points to</th><th style="width:120px">HTTPS</th><th style="width:90px">Status</th><th style="width:96px"></th></tr></thead>
      <tbody>${groups.map((k) => { const ds = DB.domains.filter((d) => d.kind === k); if (!ds.length) return ''; return `<tr class="sys-group"><td colspan="5"><span class="row">${icon(kindMeta[k].ic, 'sm ink-3')}<span>${kindMeta[k].label}</span><span class="ink-3 num">${ds.length}</span></span></td></tr>${ds.map(domainRow).join('')}`; }).join('')}</tbody>
    </table></div>
    <div class="sys-settings">
      <h2 class="h-sec">Name resolution</h2>
      ${setSec('', [
        setRow('Top-level domain', `<input class="input mono" style="width:200px" value="${esc(DB.engine.domain)}" aria-label="Top-level domain">`, 'Resolved by Containeria’s DNS on this Mac only.'),
        setRow('Wildcard subdomains', swi(sys.wildcard, 'Wildcard subdomains', 'data-sys="wildcard"'), '<span class="mono-sm">*.web.shop.containeria.local</span> reaches the same container.'),
        setRow('HTTPS for every domain', swi(sys.httpsAll, 'HTTPS for every domain', 'data-sys="httpsAll"'), 'Certificates are issued on the fly by the local authority.'),
        setRow('Direct container IP access', swi(sys.directIP, 'Direct container IP access', 'data-sys="directIP"'), 'Reach 172.20.0.3 from macOS without publishing ports.'),
      ].join(''))}
    </div>`;
  },
  mount(root) {
    $$('[data-sys]', root).forEach((i) => (i.onchange = () => { sys[i.dataset.sys] = i.checked; toast({ title: `${i.getAttribute('aria-label')} ${i.checked ? 'on' : 'off'}`, ic: 'world-cog', ms: 1800 }); }));
  },
});
App.act('trust-ca', (el) => {
  el.classList.add('is-loading'); el.innerHTML = `${icon('loader-2', 'sm')}Waiting for macOS`;
  setTimeout(() => { sys.caTrusted = true; App.rerender(); toast({ title: 'Certificate trusted', body: 'https:// works in Safari, Chrome and Firefox now.', tone: 'ok' }); }, 1300);
});
App.act('untrust-ca', () => confirmSheet({ title: 'Remove the local certificate?', body: 'Browsers will show warnings on every https://*.containeria.local link until you trust it again.', action: 'Remove certificate', onConfirm() { sys.caTrusted = false; App.rerender(); } }));
App.menu('domain-row', (el) => {
  const d = DB.domains.find((x) => x.host === el.dataset.host);
  if (!d) return [];
  const url = `${d.https ? 'https' : 'http'}://${d.host}`;
  return [
    { label: 'Open in browser', icon: 'external-link', disabled: !d.up, run: () => App.actions['sys-open-url'](el, url) },
    { label: 'Copy URL', icon: 'copy', run: () => { navigator.clipboard?.writeText(url).catch(() => {}); toast({ title: 'Copied', body: url, ic: 'copy' }); } },
    { label: 'Copy curl command', icon: 'terminal-2', run: () => toast({ title: 'Copied', body: `curl -sS ${url}`, ic: 'copy' }) },
    ...(d.kind === 'container' ? [{ label: 'Show container', icon: 'cx-container', run: () => App.go('/containers/' + d.target) }] : []),
    ...(d.auto ? [] : [{ sep: true }, { label: 'Edit route…', icon: 'pencil', run: () => addRoute(d) }, { label: 'Remove route', icon: 'trash', danger: true, run: () => confirmSheet({ title: `Remove ${d.host}?`, body: `Requests to ${d.host} stop reaching ${d.target}. The container keeps running.`, action: 'Remove route', onConfirm() { DB.domains.splice(DB.domains.indexOf(d), 1); App.rerender(); toast({ title: 'Route removed', body: d.host }); } }) }]),
  ];
});
function addRoute(edit) {
  const running = DB.containers.filter((c) => c.state === 'running');
  sheet({
    title: edit ? 'Edit route' : 'Add route', ic: 'route', width: 500,
    body: `<div class="col gap-16">
      <div class="field"><span class="label">Domain</span><input class="input mono" data-f="host" placeholder="shop.test" value="${esc(edit?.host || '')}"><span class="hint">Any name works: <span class="mono-sm">.test</span>, <span class="mono-sm">.local</span> or your own. Containeria answers for it on this Mac.</span></div>
      <div class="row gap-12" style="align-items:flex-start">
        <div class="field grow"><span class="label">Points to</span>${sel(running.map((c) => c.name), edit?.target || 'shop-web', 'data-f="target"')}</div>
        <div class="field" style="width:110px"><span class="label">Port</span><input class="input mono num" data-f="port" value="${edit?.port || 3000}" inputmode="numeric"></div>
      </div>
      <label class="row">${swi(edit ? edit.https : true, 'HTTPS', 'data-f="https"')}<span class="ink">Serve over HTTPS</span></label>
    </div>`,
    foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>${edit ? 'Save route' : 'Add route'}</button></div>`,
    onMount(el, close) {
      const f = (k) => $(`[data-f="${k}"]`, el);
      $('[data-ok]', el).onclick = () => {
        const host = f('host').value.trim();
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) { f('host').classList.add('is-error'); if (!$('.err', el)) f('host').insertAdjacentHTML('afterend', `<span class="err">${icon('alert-circle', 'sm')}Use a name like shop.test</span>`); return; }
        const d = { host, target: f('target').value, kind: 'custom', port: +f('port').value || null, https: f('https').checked, auto: false, up: true };
        if (edit) Object.assign(edit, d); else DB.domains.push(d);
        close(); App.rerender();
        toast({ title: edit ? 'Route saved' : 'Route added', body: `${d.https ? 'https' : 'http'}://${host} → ${d.target}:${d.port}`, tone: 'ok' });
      };
    },
  });
}
App.act('add-route', () => addRoute());

/* ======================================================================
   Activity
   ====================================================================== */
const rangeCfg = { '5m': [150, 2], '1h': [120, 30], '24h': [144, 600] };
function diskBreakdown() {
  const images = DB.images.reduce((a, i) => a + i.sizeMB, 0);
  const dangling = DB.images.filter((i) => i.dangling).reduce((a, i) => a + i.sizeMB, 0);
  const volumes = DB.volumes.reduce((a, v) => a + v.sizeMB, 0);
  const unusedVol = DB.volumes.filter((v) => !v.usedBy.length).reduce((a, v) => a + v.sizeMB, 0);
  const machines = DB.machines.reduce((a, m) => a + m.diskGB * 1024, 0);
  const cache = 3.8 * 1024;
  const used = DB.engine.diskUsedGB * 1024;
  return [
    { id: 'images', label: 'Images', mb: images, color: 's1', free: dangling, freeLabel: `${fmt.mb(dangling)} in 2 untagged images`, act: 'prune-images', actLabel: 'Remove untagged' },
    { id: 'volumes', label: 'Volumes', mb: volumes, color: 's2', free: unusedVol, freeLabel: `${fmt.mb(unusedVol)} in 1 unused volume`, act: 'sys-prune-volumes', actLabel: 'Remove unused' },
    { id: 'cache', label: 'Build cache', mb: cache, color: 's3', free: 3.1 * 1024, freeLabel: '3.1 GB not used in 30 days', act: 'sys-prune-cache', actLabel: 'Clear cache' },
    { id: 'machines', label: 'Linux machines', mb: machines, color: 's4' },
    { id: 'other', label: 'Engine and logs', mb: Math.max(0, used - images - volumes - machines - cache), color: 'ink-4' },
  ];
}
function consumers() {
  const rows = [
    ...DB.containers.filter((c) => c.state === 'running').map((c) => ({ id: 'c:' + c.name, face: tile(c), name: c.name, kind: 'Container', group: DB.projects.find((p) => p.id === c.project)?.name || 'Standalone', cpu: c.cpu, mb: c.memMB, go: '/containers/' + c.name })),
    ...DB.kube.pods.filter((p) => p.memMB).map((p) => ({ id: 'p:' + p.name, face: `<span class="tile" style="--th:335">${icon('cx-kube')}</span>`, name: p.name, kind: 'Pod', group: p.ns, cpu: p.cpu / 10, mb: p.memMB, go: '/kubernetes' })),
    ...DB.machines.filter((m) => m.state === 'running').map((m) => ({ id: 'm:' + m.name, face: tile(m), name: m.name, kind: 'Machine', group: `${m.distro} ${m.version}`, cpu: m.cpu, mb: m.memMB, go: '/machines/' + m.name })),
  ];
  return rows.sort((a, b) => b.mb - a.mb);
}
App.view('cx-activity', {
  title: 'Activity',
  tools: () => `<button class="btn btn-ghost btn-icon" data-go="/settings/engine" data-tip="Engine settings">${icon('adjustments')}</button>`,
  render() {
    const d = ledgerData();
    const legend = d.segs.filter((s) => s.mb > 0);
    const disk = diskBreakdown();
    const diskTotal = DB.engine.diskGB * 1024;
    const top = consumers().slice(0, 10);
    return `
    <section class="act-hero">
      <div class="act-answer">
        <div><span class="act-big num" data-mem-used>${fmt.mb(d.used)}</span><span class="act-of">in use of ${DB.engine.memGB} GB</span></div>
        <p>${fmt.mb(d.returned)} went back to macOS. Docker Desktop would hold all ${DB.engine.memGB} GB.</p>
      </div>
      ${ledgerHTML('ledger-lg', { interactive: true })}
      <div class="act-legend">
        ${legend.map((s) => `<span class="act-key" data-key="${s.id}"><i style="background:var(--${s.color})"></i>${esc(s.name)}<b class="num" data-legend="${s.id}">${fmt.mb(s.mb)}</b></span>`).join('')}
        <span class="act-key"><i class="is-returned"></i>Returned to macOS<b class="num">${fmt.mb(d.returned)}</b></span>
        <span class="act-key"><i class="is-free"></i>Free<b class="num" data-legend="free">${fmt.mb(d.free)}</b></span>
      </div>
    </section>

    <section class="act-sec">
      <div class="act-sec-head"><h2 class="h-sec">Engine</h2>${seg2([['5m', 'Last 5 min'], ['1h', '1 hour'], ['24h', '24 hours']], sys.range, 'data-act-range')}</div>
      <div class="act-charts">
        ${[['cpu', 'CPU', `${(DB.containers.reduce((a, c) => a + c.cpu, 0) / DB.engine.cpus).toFixed(1)}%`, `of ${DB.engine.cpus} cores`],
           ['mem', 'Memory', fmt.mb(d.used), `${fmt.mb(d.returned)} returned`],
           ['net', 'Network', '1.8 MB/s', 'in · 0.6 MB/s out'],
           ['disk', 'Disk', '4.2 MB/s', 'read · 1.1 MB/s write']].map(([id, label, val, sub]) => `
          <div class="act-chart"><div class="row"><span class="label">${label}</span></div><div class="row" style="align-items:baseline;gap:6px"><b class="act-val num" data-val="${id}">${val}</b><span class="meta">${sub}</span></div><div class="act-plot" data-chart="${id}"></div></div>`).join('')}
      </div>
    </section>

    <section class="act-sec">
      <div class="act-sec-head"><h2 class="h-sec">Top consumers</h2><span class="meta">Containers, pods and machines, by memory</span></div>
      <table class="tbl act-top">
        <thead><tr><th>Name</th><th>Kind</th><th>Project</th><th class="num" style="width:90px">CPU</th><th class="num" style="width:150px">Memory</th></tr></thead>
        <tbody>${top.map((r) => `<tr data-go="${r.go}" data-row="${esc(r.id)}"><td><span class="row">${r.face}<span class="ink truncate">${esc(r.name)}</span></span></td><td><span class="chip">${r.kind}</span></td><td class="ink-3">${esc(r.group)}</td><td class="num" data-cpu>${fmt.pct(r.cpu)}</td><td class="num"><span class="row" style="justify-content:flex-end"><span data-mb>${fmt.mb(r.mb)}</span><span class="meter ${r.mb > 1024 ? 'is-warn' : ''}" style="--v:${Math.min(1, r.mb / 1400)}"><i></i></span></span></td></tr>`).join('')}</tbody>
      </table>
    </section>

    <section class="act-sec">
      <div class="act-sec-head"><h2 class="h-sec">Disk</h2><span class="meta"><b class="ink num">${DB.engine.diskUsedGB} GB</b> of ${DB.engine.diskGB} GB</span><button class="btn btn-sm right" data-go="/settings/engine">Resize disk</button></div>
      <div class="ledger ledger-lg act-disk" role="img" aria-label="Disk usage">${disk.map((s) => `<span style="--w:${(s.mb / diskTotal) * 100};--c:var(--${s.color})" data-tip="${s.label} · ${fmt.mb(s.mb)}"></span>`).join('')}<span class="is-free"></span></div>
      <div class="act-disk-rows">${disk.map((s) => `<div class="act-disk-row"><span class="act-key"><i style="background:var(--${s.color})"></i><span class="ink">${s.label}</span></span><b class="num ink">${fmt.mb(s.mb)}</b><span class="meta grow">${s.free ? s.freeLabel : ''}</span>${s.act ? `<button class="btn btn-sm" data-act="${s.act}">${s.actLabel}</button>` : '<span></span>'}</div>`).join('')}</div>
    </section>`;
  },
  mount(root) {
    const [n, step] = rangeCfg[sys.range];
    const d = ledgerData();
    const usedGB = d.used / 1024, retGB = d.returned / 1024;
    const mk = (id, sers, gens, o) => { const xs = series(n, step, () => 0)[0]; const data = [xs, ...gens.map((g) => xs.map((_, i) => g(i)))]; const u = chart($(`[data-chart="${id}"]`, root), { series: sers, data, height: 120, ...o }); return { u, data, gens }; };
    const charts = [
      mk('cpu', [{ label: 'CPU', color: '--s1' }], [wave(5.5, 2.4, 1.3)], { yFmt: (v) => Math.round(v) + '%', max: 25 }),
      mk('mem', [{ label: 'Used', color: '--s1' }, { label: 'Returned to macOS', color: '--ink-4', fillAlpha: .08 }], [wave(usedGB, .12, .7), wave(retGB, .1, .4)], { yFmt: (v) => v.toFixed(1) + ' GB', max: DB.engine.memGB }),
      mk('net', [{ label: 'In', color: '--s2' }, { label: 'Out', color: '--s3', fillAlpha: .06 }], [wave(1.8, 1.4, 1.1), wave(.6, .5, .9)], { yFmt: (v) => v.toFixed(1) + ' MB/s' }),
      mk('disk', [{ label: 'Read', color: '--s4' }, { label: 'Write', color: '--s6', fillAlpha: .06 }], [wave(4.2, 3, 1.7), wave(1.1, .9, 1.2)], { yFmt: (v) => v.toFixed(1) + ' MB/s' }),
    ];
    $('[data-act-range]', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.v !== sys.range) { sys.range = b.dataset.v; setTimeout(() => App.rerender(), 230); } });
    if (sys.range === '5m') App.every(2000, () => charts.forEach((c, k) => {
      c.data[0].push(c.data[0].at(-1) + step); c.data[0].shift();
      c.gens.forEach((g, j) => { c.data[j + 1].push(g(c.data[0].length)); c.data[j + 1].shift(); });
      c.u.setData(c.data);
      const v = c.data[1].at(-1);
      $(`[data-val="${['cpu', 'mem', 'net', 'disk'][k]}"]`, root).textContent = [Math.max(.1, v).toFixed(1) + '%', v.toFixed(1) + ' GB', v.toFixed(1) + ' MB/s', v.toFixed(1) + ' MB/s'][k];
    }));
    App.on('stats', () => {
      const L = ledgerData();
      L.segs.forEach((s) => { const e = $(`[data-legend="${s.id}"]`, root); if (e) e.textContent = fmt.mb(s.mb); });
      const f = $('[data-legend="free"]', root); if (f) f.textContent = fmt.mb(L.free);
      for (const r of consumers()) { const tr = root.querySelector(`[data-row="${CSS.escape(r.id)}"]`); if (!tr) continue; $('[data-cpu]', tr).textContent = fmt.pct(r.cpu); $('[data-mb]', tr).textContent = fmt.mb(r.mb); $('.meter', tr).style.setProperty('--v', Math.min(1, r.mb / 1400)); }
    });
    // legend hover lights the ledger segment
    $$('.act-key[data-key]', root).forEach((k) => {
      k.onmouseenter = () => { const L = $('.act-hero [data-ledger]', root); L.classList.add('is-dim'); $(`[data-seg="${k.dataset.key}"]`, L)?.classList.add('is-hot'); };
      k.onmouseleave = () => { const L = $('.act-hero [data-ledger]', root); L.classList.remove('is-dim'); $$('.is-hot', L).forEach((s) => s.classList.remove('is-hot')); };
    });
  },
});
App.act('sys-prune-volumes', () => confirmSheet({ title: 'Remove 1 unused volume?', body: 'The anonymous volume 7c1e94b0a2d3 (64 MB) isn’t attached to any container. Its data is deleted and can’t be recovered.', action: 'Remove volume', onConfirm() { const i = DB.volumes.findIndex((v) => !v.usedBy.length); if (i >= 0) DB.volumes.splice(i, 1); App.rerender(); toast({ title: '64 MB freed', tone: 'ok' }); } }));
App.act('sys-prune-cache', () => confirmSheet({ title: 'Clear the build cache?', body: 'Layers not used in 30 days are removed (3.1 GB). The next build of shop-web may take longer.', action: 'Clear cache', onConfirm() { toast({ title: '3.1 GB freed', body: 'Build cache cleared', tone: 'ok' }); } }));
if (!App.actions['prune-images']) App.act('prune-images', () => confirmSheet({ title: 'Remove 2 untagged images?', body: 'They aren’t used by any container. 2.3 GB is freed.', action: 'Remove images', onConfirm() { DB.images = DB.images.filter((i) => !i.dangling); App.rerender(); toast({ title: '2.3 GB freed', tone: 'ok' }); } }));

/* ======================================================================
   Settings
   ====================================================================== */
const SHORTCUTS = [
  ['General', [['Command palette', '⌘K'], ['Settings', '⌘,'], ['Run container', '⌘N'], ['Toggle sidebar', '⌘\\'], ['Toggle appearance', '⌘⇧L'], ['Jump to a section', '⌘1 … ⌘6'], ['Filter the current list', '/'], ['Keyboard shortcuts', '⌘/'], ['Menu bar popover, from any app', '⌥⌘C']]],
  ['Containers', [['Start or stop', '⌘.'], ['Restart', '⌘⇧R'], ['Open terminal', '⌘T'], ['Show logs', '⌘L'], ['Open in browser', '⌘O'], ['Copy domain', '⌘⇧C'], ['Delete', '⌘⌫']]],
  ['Data', [['Run query', '⌘↵'], ['Run selection', '⌘⇧↵'], ['Commit changes', '⌘S'], ['Discard changes', '⌘⇧⌫'], ['Undo edit', '⌘Z'], ['Filter rows', '⌘F'], ['New query tab', '⌘T'], ['Export results', '⌘⇧E']]],
  ['Logs and terminal', [['Search logs', '/'], ['Pause or follow', 'Space'], ['Jump to latest', '⌘↓'], ['Open in Terminal app', '⌘⇧T']]],
];
const kbds = (k) => k.split(' … ').map((p) => `<span class="kbd">${esc(p)}</span>`).join('<span class="meta"> … </span>');
const shortcutsHTML = () => SHORTCUTS.map(([g, list]) => `<section class="set-sec"><h3 class="h-sub">${g}</h3><div class="set-group">${list.map(([l, k]) => `<div class="set-row"><span class="ink">${l}</span><span class="set-row-ctl">${kbds(k)}</span></div>`).join('')}</div></section>`).join('');

const ACCENTS = [['Blue', 255, 1], ['Purple', 300, 1], ['Pink', 350, 1], ['Red', 25, 1], ['Orange', 55, 1], ['Yellow', 90, .9], ['Green', 150, .9], ['Graphite', 255, 0]];
const PANES = [
  ['general', 'General', 'settings'], ['engine', 'Engine', 'cpu'], ['network', 'Network', 'cx-domain'], ['kubernetes', 'Kubernetes', 'cx-kube'], ['data', 'Data', 'table'],
  ['appearance', 'Appearance', 'palette'], ['shortcuts', 'Shortcuts', 'keyboard'], ['updates', 'Updates', 'download'], ['advanced', 'Advanced', 'tool'], ['about', 'About', 'info-circle'],
];
const volTotal = () => DB.volumes.reduce((a, v) => a + v.sizeMB, 0);
const settingsPanes = {
  general: () => setSec('', [
    setRow('Open at login', swi(true, 'Open at login')),
    setRow('Show in menu bar', swi(true, 'Show in menu bar'), 'The engine stays reachable from the menu bar when the window is closed.'),
    setRow('Memory in the menu bar', swi(true, 'Memory in the menu bar'), 'Shows how much the engine uses next to the icon.'),
    setRow('Keep the engine running when the window closes', swi(true, 'Keep engine running'), 'Closing the window frees about 90 MB. Containers stay up.'),
    setRow('Terminal app', sel(['Terminal', 'iTerm2', 'Ghostty', 'Warp', 'WezTerm'], 'Ghostty', 'style="width:160px"'), 'Used by “Open in terminal app”.'),
  ].join('')) + setSec('Notifications', [
    setRow('A container crashes', swi(true, 'Container crashes')),
    setRow('A health check fails', swi(true, 'Health check fails')),
    setRow('A long pull or build finishes', swi(true, 'Pull or build finishes'), 'Only when the window isn’t in front.'),
    setRow('Memory pressure', swi(false, 'Memory pressure'), 'When the engine is above 90% of its memory for a minute.'),
  ].join('')),

  engine: () => `<div class="set-mac">${icon('device-laptop')}<span>This Mac: <b class="ink">Apple M3 Pro</b>, 12 cores, 36 GB memory</span></div>` + setSec('Resources', [
    `<div class="set-row set-row-block"><div class="set-row-text"><span class="ink">CPUs</span><span class="hint">Containers share them. Idle cores cost nothing.</span></div>${slider({ key: 'cpus', min: 1, max: DB.engine.cpuMax, value: DB.engine.cpus, unit: 'cores' })}</div>`,
    `<div class="set-row set-row-block"><div class="set-row-text"><span class="ink">Memory limit</span><span class="hint">A ceiling, not a reservation. Recommended for this Mac: 8 GB.</span></div>${slider({ key: 'memGB', min: 2, max: DB.engine.memMaxGB, value: DB.engine.memGB, unit: 'GB' })}</div>`,
    setRow('Return unused memory to macOS', swi(true, 'Return unused memory to macOS', 'data-key="balloon"'), `Free pages go back within seconds. Right now that’s ${fmt.gb(DB.engine.returnedGB)}. Off pins the full limit.`),
    `<div class="set-row set-row-block"><div class="set-row-text"><span class="ink">Disk size</span><span class="hint">${DB.engine.diskUsedGB} GB used. The disk can grow but not shrink.</span></div>${slider({ key: 'diskGB', min: 120, max: 512, step: 8, value: DB.engine.diskGB, unit: 'GB' })}</div>`,
  ].join('')) + setSec('Virtual machine', [
    setRow('Run x86 images with Rosetta', swi(DB.engine.rosetta, 'Rosetta', 'data-key="rosetta"'), 'linux/amd64 images run at near-native speed.'),
    setRow('Virtualization', sel([['vz', 'Apple Virtualization (VZ)'], ['qemu', 'QEMU']], 'vz', 'data-key="vm" style="width:220px"')),
    setRow('File sharing', sel([['virtiofs', 'VirtioFS'], ['sshfs', 'SSHFS'], ['9p', '9p']], 'virtiofs', 'data-key="mount" style="width:220px"'), 'Your home folder is shared at the same path inside containers.'),
    setRow('Engine shell', `<button class="btn btn-sm" data-go="/machines/engine">${icon('terminal-2', 'sm')}Open shell</button>`, `Kernel ${DB.engine.kernel}`),
  ].join('')) + `<div class="set-pending" hidden><span class="grow" data-pending-text></span><button class="btn btn-sm btn-ghost" data-pending-discard>Discard</button><button class="btn btn-sm btn-brand" data-pending-apply>Apply and restart</button></div>`,

  network: () => setSec('Domains', [
    setRow('Top-level domain', `<input class="input mono" style="width:200px" value="${esc(DB.engine.domain)}" aria-label="Top-level domain">`),
    setRow('HTTPS for every domain', swi(true, 'HTTPS'), sys.caTrusted ? 'Local certificate trusted.' : '<span class="warn-ink">Local certificate not trusted yet.</span>'),
    setRow('Manage routes', `<button class="btn btn-sm" data-go="/domains">Open Domains</button>`),
  ].join('')) + setSec('Ports and traffic', [
    setRow('Forward published ports to localhost', swi(true, 'Forward ports'), '<span class="mono-sm">-p 3000:3000</span> answers on localhost:3000.'),
    setRow('Direct container IP access', swi(sys.directIP, 'Direct IP')),
    setRow('IPv6', swi(false, 'IPv6')),
    setRow('Use macOS proxy settings', swi(true, 'macOS proxy'), 'Containers inherit the system proxy and its exceptions.'),
    setRow('DNS', sel([['mac', 'Same as macOS'], ['1.1.1.1', 'Cloudflare (1.1.1.1)'], ['custom', 'Custom…']], 'mac', 'style="width:200px"')),
  ].join('')),

  kubernetes: () => setSec('', [
    setRow('Kubernetes', swi(DB.kube.enabled, 'Kubernetes', 'data-kube'), `A single-node k3s cluster inside the engine. Uses about 380 MB when on.`),
    setRow('Version', sel(['v1.31.4+k3s1', 'v1.32.0+k3s1', 'v1.30.8+k3s1'], DB.kube.version, 'style="width:180px"')),
    setRow('Expose services as domains', swi(true, 'Expose services'), '<span class="mono-sm">storefront.k8s.containeria.local</span>'),
    setRow('Switch kubectl to this cluster', swi(true, 'kubectl context'), `Context “${DB.kube.context}”.`),
    setRow('Use images built with docker', swi(true, 'Shared images'), 'No registry push between docker build and a pod.'),
  ].join('')) + setSec('', setRow('Reset cluster', `<button class="btn btn-sm btn-danger-ghost" data-act="sys-reset-k8s">Reset cluster…</button>`, 'Deletes every workload and namespace. Images are kept.')),

  data: () => setSec('', [
    setRow('Rows per page', sel(['100', '500', '1000', '5000'], '500', 'style="width:110px"')),
    setRow('Open production connections read-only', swi(true, 'Read-only production'), 'Writes need an explicit unlock that lasts 10 minutes.'),
    setRow('Confirm destructive statements', swi(true, 'Confirm destructive'), '<span class="mono-sm">DROP</span>, <span class="mono-sm">TRUNCATE</span>, and <span class="mono-sm">DELETE</span> or <span class="mono-sm">UPDATE</span> without <span class="mono-sm">WHERE</span>.'),
    setRow('Query timeout', sel(['10 s', '30 s', '2 min', 'None'], '30 s', 'style="width:110px"')),
    setRow('Show null as', sel(['NULL', 'empty', '∅'], 'NULL', 'style="width:110px"')),
    setRow('Passwords', `<span class="row ink-3">${icon('lock', 'sm')}macOS Keychain</span>`, 'Always stored in the Keychain, never in a file.'),
    setRow('Detect databases in containers', swi(true, 'Detect databases'), 'Postgres, MySQL, Redis, Mongo and ClickHouse containers appear in Data with their credentials.'),
  ].join('')),

  appearance: () => {
    const cur = App.theme || localStorage.getItem('cx-theme') || 'system';
    const acc = JSON.parse(localStorage.getItem('cx-accent') || '[255,1]');
    const preview = (t) => `<span class="theme-prev is-${t}"><span class="tp-side"></span><span class="tp-main"><i></i><i></i><i></i></span></span>`;
    return setSec('Appearance', `<div class="set-row set-row-block"><div class="theme-pick">${[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([t, l]) => `<button class="theme-opt ${cur === t ? 'is-on' : ''}" data-theme-set="${t}" aria-pressed="${cur === t}">${preview(t)}<span>${l}</span></button>`).join('')}</div></div>`
      + setRow('Accent color', `<div class="accents">${ACCENTS.map(([n, h, c]) => `<button class="accent ${acc[0] === h && acc[1] === c ? 'is-on' : ''}" style="--ah:${h};--ac:${c}" data-accent="${h},${c}" data-tip="${n}" aria-label="${n}"></button>`).join('')}</div>`, 'Follows the macOS accent color by default.'))
      + setSec('Layout', [
        setRow('Density', seg2(['Comfortable', 'Compact'], 'Comfortable')),
        setRow('Text size', seg2(['Small', 'Default', 'Large'], 'Default')),
        setRow('Show image icons in lists', swi(true, 'Image icons')),
      ].join(''));
  },

  shortcuts: () => shortcutsHTML(),

  updates: () => setSec('', [
    setRow('Version', `<span class="ink num">${DB.engine.version}</span>`, 'Up to date. Last checked today at 09:14.'),
    setRow('Channel', seg2(['Stable', 'Beta'], 'Stable')),
    setRow('Install updates automatically', swi(true, 'Auto update'), 'Updates install when you quit. Containers keep running during the restart.'),
    setRow('', `<button class="btn btn-sm" data-act="sys-check-updates">Check now</button>`),
  ].join('')) + setSec('What’s new in 1.4', `<ul class="set-notes"><li>The engine now returns free memory to macOS within 5 seconds.</li><li>Data browser: stage edits across several tables and commit them in one transaction.</li><li>Linux machines can run amd64 distros through Rosetta.</li><li>Fixed: Compose projects with a dot in the folder name lost their domain.</li></ul>`),

  advanced: () => setSec('Command line tools', [
    ...[['cx', 'Containeria CLI', false], ['docker', 'Docker CLI 27.4', true], ['docker compose', 'Compose v2.32', true], ['docker buildx', 'Buildx 0.19', true], ['kubectl', 'kubectl 1.31', true]].map(([b, l, on]) => setRow(`<span class="mono">${b}</span>`, on ? `<span class="row ink-3">${icon('circle-check', 'sm ok-ink')}Linked</span>` : `<button class="btn btn-sm" data-act="sys-install-cli">Install</button>`, `${l} · /usr/local/bin/${b.split(' ')[0]}`)),
  ].join('')) + setSec('Docker', [
    setRow('Docker context', sel([['containeria', 'containeria (this app)'], ['desktop-linux', 'desktop-linux (Docker Desktop)'], ['colima', 'colima']], 'containeria', 'style="width:240px"')),
    setRow('Socket', `<button class="btn btn-sm" data-copy="${esc(DB.engine.socket)}">${icon('copy', 'sm')}Copy path</button>`, `<span class="mono-sm">${esc(DB.engine.socket)}</span>`),
    setRow('Import from Docker Desktop', `<button class="btn btn-sm" data-go="/welcome/migrate">Import…</button>`, `${DB.migration.app} found with ${DB.migration.containers} containers.`),
    setRow('Diagnostics', `<button class="btn btn-sm" data-act="diagnostics">Collect…</button>`, 'A zip with engine logs and configuration, for bug reports.'),
  ].join('')) + setSec('Danger zone', setRow('Reset all data', `<button class="btn btn-sm btn-danger-ghost" data-act="sys-reset-all">Reset…</button>`, `Deletes every container, image, volume, the Kubernetes cluster and Linux machines.`)),

  about: () => `<div class="about">${engineMark(72)}<h2 class="h-big">Containeria</h2><p class="meta">Version ${DB.engine.version} (1420) · Free and open source under Apache-2.0</p>
    <div class="row" style="justify-content:center;margin-top:4px"><button class="btn btn-sm" data-act="sys-open-url" data-arg="https://github.com/containeria/containeria">${icon('brand-github', 'sm')}Source code ↗</button><button class="btn btn-sm" data-act="sys-open-url" data-arg="https://containeria.dev/docs">Documentation ↗</button></div></div>`
    + setSec('Engine', `<dl class="kv set-kv"><dt>Engine</dt><dd class="num">${DB.engine.version}</dd><dt>Virtualization</dt><dd>${DB.engine.vm}</dd><dt>Kernel</dt><dd class="mono-sm">${DB.engine.kernel}</dd><dt>Docker API</dt><dd class="num">${DB.engine.dockerApi}</dd><dt>containerd</dt><dd class="num">${DB.engine.containerd}</dd><dt>Kubernetes</dt><dd class="mono-sm">${DB.engine.k3s}</dd></dl>`)
    + setSec('Built on', `<dl class="kv set-kv">${[['Colima', 'MIT'], ['Lima', 'Apache-2.0'], ['Docker Engine (Moby)', 'Apache-2.0'], ['containerd', 'Apache-2.0'], ['k3s', 'Apache-2.0'], ['Tauri', 'MIT / Apache-2.0'], ['Geist and Geist Mono', 'OFL-1.1'], ['Tabler Icons', 'MIT'], ['uPlot', 'MIT']].map(([n, l]) => `<dt class="ink">${n}</dt><dd class="ink-3">${l}</dd>`).join('')}</dl>`),
};
App.view('settings', {
  title: 'Settings',
  crumbs: (ctx) => { const p = PANES.find((x) => x[0] === (ctx.params[0] || 'general')) || PANES[0]; return `<button data-go="/settings">Settings</button>${icon('chevron-right')}<b>${p[1]}</b>`; },
  flush: true,
  render(ctx) {
    const pane = settingsPanes[ctx.params[0]] ? ctx.params[0] : 'general';
    return `<div class="set">
      <nav class="set-nav" aria-label="Settings sections">${PANES.map(([id, l, ic]) => `<button class="set-item ${id === pane ? 'is-active' : ''}" data-go="/settings/${id}" ${id === pane ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></button>`).join('')}</nav>
      <div class="set-main"><div class="set-form" data-pane="${pane}"><h1 class="h-page set-title">${PANES.find((p) => p[0] === pane)[1]}</h1>${settingsPanes[pane]()}</div></div>
    </div>`;
  },
  mount(root, ctx) {
    ranges(root);
    $$('.seg', root).forEach(segThumb);
    // appearance
    $$('[data-theme-set]', root).forEach((b) => (b.onclick = () => setTheme(b.dataset.themeSet)));
    $$('[data-accent]', root).forEach((b) => (b.onclick = () => { const [h, c] = b.dataset.accent.split(',').map(Number); setAccent(h, c); $$('.accent', root).forEach((x) => x.classList.toggle('is-on', x === b)); }));
    // kubernetes toggle
    const k = $('[data-kube]', root);
    if (k) k.onchange = () => { DB.kube.enabled = k.checked; toast({ title: k.checked ? 'Starting Kubernetes' : 'Kubernetes stopped', body: k.checked ? 'Ready in about 20 seconds' : 'About 380 MB returned to macOS', ic: 'cx-kube' }); };
    // engine: pending changes need a restart
    const bar = $('.set-pending', root);
    if (bar) {
      const labels = { cpus: ['CPUs', ''], memGB: ['memory', ' GB'], diskGB: ['disk', ' GB'] };
      const read = () => {
        const out = [];
        $$('[data-key]', root).forEach((i) => {
          const key = i.dataset.key;
          if (labels[key] && +i.value !== DB.engine[key]) out.push([key, `${labels[key][0]} ${DB.engine[key]} → ${i.value}${labels[key][1]}`, +i.value]);
          if (key === 'rosetta' && i.checked !== DB.engine.rosetta) out.push([key, `Rosetta ${i.checked ? 'on' : 'off'}`, i.checked]);
          if ((key === 'vm' && i.value !== 'vz') || (key === 'mount' && i.value !== 'virtiofs')) out.push([key, `${key === 'vm' ? 'virtualization' : 'file sharing'} ${i.options[i.selectedIndex].text}`, i.value]);
        });
        return out;
      };
      const sync = () => { const ch = read(); bar.hidden = !ch.length; $('[data-pending-text]', bar).innerHTML = `${icon('refresh', 'sm')} Restart the engine to apply: ${ch.map((c) => c[1]).join(', ')}`; };
      root.addEventListener('input', sync); root.addEventListener('change', sync);
      $('[data-pending-discard]', bar).onclick = () => App.rerender();
      $('[data-pending-apply]', bar).onclick = () => { for (const [key, , v] of read()) if (['cpus', 'memGB', 'diskGB', 'rosetta'].includes(key)) DB.engine[key] = v; App.actions['engine-restart'](); };
    }
  },
});
App.act('sys-check-updates', (el) => { el.classList.add('is-loading'); el.innerHTML = `${icon('loader-2', 'sm')}Checking`; setTimeout(() => { el.classList.remove('is-loading'); el.textContent = 'Check now'; toast({ title: 'Containeria is up to date', body: `Version ${DB.engine.version}`, tone: 'ok' }); }, 1200); });
App.act('sys-install-cli', (el) => { el.classList.add('is-loading'); el.innerHTML = `${icon('loader-2', 'sm')}Installing`; setTimeout(() => { el.outerHTML = `<span class="row ink-3">${icon('circle-check', 'sm ok-ink')}Linked</span>`; toast({ title: 'cx installed', body: 'Try cx ps in a new terminal', tone: 'ok' }); }, 1100); });
App.act('sys-reset-k8s', () => confirmSheet({ title: 'Reset the Kubernetes cluster?', body: `All ${DB.kube.pods.length} pods, ${DB.kube.deployments.length} deployments, ${DB.kube.services.length} services and the shop-staging and monitoring namespaces are deleted. Images are kept.`, action: 'Reset cluster', onConfirm() { toast({ title: 'Cluster reset', body: 'A fresh cluster is starting', ic: 'cx-kube' }); } }));
App.act('sys-reset-all', () => confirmSheet({ title: 'Reset all Containeria data?', body: `This deletes ${DB.containers.length} containers, ${DB.images.length} images, ${DB.volumes.length} volumes (${fmt.mb(volTotal())} of data), the Kubernetes cluster and ${DB.machines.length} Linux machines. Database connections and settings are kept. It can’t be undone.`, action: 'Delete everything', onConfirm() { toast({ title: 'Reset started', body: 'The engine restarts with an empty disk', ic: 'refresh' }); } }));

/* ======================================================================
   First launch
   ====================================================================== */
const WZ = ['welcome', 'resources', 'migrate', 'cli', 'done'];
const wzNames = { welcome: 'Welcome', resources: 'Resources', migrate: 'Import', cli: 'Command line', done: 'Done' };
const wz = { imported: false, importing: false };
App.view('welcome', {
  title: 'Welcome', always: true, flush: true,
  crumbs: () => `<b>Set up Containeria</b>`,
  tools: () => `<button class="btn btn-ghost btn-sm" data-go="/containers">Skip setup</button>`,
  render(ctx) {
    const step = WZ.includes(ctx.params[0]) ? ctx.params[0] : 'welcome';
    const i = WZ.indexOf(step);
    const nav = (back, next, nextLabel, extra = '') => `<div class="wz-foot">${back ? `<button class="btn btn-lg btn-ghost" data-go="/welcome/${back}">${icon('arrow-left')}Back</button>` : '<span></span>'}<span class="grow"></span>${extra}${next ? `<button class="btn btn-lg btn-brand" data-go="/welcome/${next}">${nextLabel}</button>` : ''}</div>`;
    const steps = `<ol class="wz-steps">${WZ.map((s, k) => `<li class="${k < i ? 'is-done' : k === i ? 'is-now' : ''}">${k < i ? icon('check', 'sm') : ''}${wzNames[s]}</li>`).join('')}</ol>`;
    const m = DB.migration;
    const body = {
      welcome: `<div class="wz-hero">${engineMark(72)}<h1 class="h-big">Containers, Kubernetes and Linux on your Mac</h1><p>Containeria runs them in one small virtual machine that gives memory back to macOS when it’s idle. It works with the docker CLI, Compose and every tool that expects them.</p></div>
        <div class="wz-foot wz-foot-center"><button class="btn btn-lg btn-brand" data-go="/welcome/resources">Get started</button></div>`,
      resources: `<h1 class="h-big">How much can the engine use?</h1><p class="wz-lede">These are ceilings. The engine starts small and only grows when containers need it.</p>
        <div class="set-mac">${icon('device-laptop')}<span>This Mac: <b class="ink">Apple M3 Pro</b>, 12 cores, 36 GB memory</span></div>
        ${setSec('', [
          `<div class="set-row set-row-block"><div class="set-row-text"><span class="ink">CPUs</span><span class="hint">Recommended: 6</span></div>${slider({ key: 'cpus', min: 1, max: 12, value: 6, unit: 'cores' })}</div>`,
          `<div class="set-row set-row-block"><div class="set-row-text"><span class="ink">Memory limit</span><span class="hint">Recommended: 8 GB. Unused memory goes back to macOS.</span></div>${slider({ key: 'memGB', min: 2, max: 32, value: 8, unit: 'GB' })}</div>`,
          setRow('Run x86 images with Rosetta', swi(true, 'Rosetta')),
        ].join(''))}
        ${nav('welcome', 'migrate', 'Continue')}`,
      migrate: wz.importing || wz.imported
        ? `<h1 class="h-big">${wz.imported ? 'Imported from Docker Desktop' : 'Importing from Docker Desktop'}</h1><p class="wz-lede">${wz.imported ? `${m.containers} containers, ${m.images} images and ${m.volumes} volumes are here. Docker Desktop wasn’t changed.` : 'Docker Desktop is paused while its data is copied. This takes a few minutes for 18 GB.'}</p>
          <div class="wz-progress">${[['Images', m.images, 'cx-image'], ['Volumes', m.volumes, 'cx-volume'], ['Containers', m.containers, 'cx-container']].map(([l, n, ic], k) => `<div class="wz-prog-row">${icon(ic, 'ink-3')}<span class="ink grow">${n} ${l.toLowerCase()}</span><span class="meta num" data-prog-label="${k}">${wz.imported ? 'Done' : 'Waiting'}</span><div class="progress"><i data-prog="${k}" style="transform:scaleX(${wz.imported ? 1 : 0})"></i></div></div>`).join('')}</div>
          ${wz.imported ? `<div class="banner banner-ok" style="margin-top:16px">${icon('circle-check')}<span>You can quit Docker Desktop. That frees about ${m.memGB} GB of memory.</span></div>` : ''}
          ${nav(wz.imported ? 'resources' : '', wz.imported ? 'cli' : '', 'Continue')}`
        : `<h1 class="h-big">Bring your containers over</h1><p class="wz-lede">${m.app} is installed. Copy its data so nothing has to be pulled or rebuilt.</p>
          <div class="set-group wz-pick">${[['containers', `${m.containers} containers`, 'Recreated with the same names, ports and Compose projects.', 'cx-container'], ['images', `${m.images} images`, 'Copied locally, no registry pulls.', 'cx-image'], ['volumes', `${m.volumes} volumes`, 'Data is copied. The originals are kept.', 'cx-volume']].map(([k, l, h, ic]) => `<label class="set-row"><span class="row gap-12">${icon(ic, 'lg ink-3')}<span class="set-row-text"><span class="ink">${l}</span><span class="hint">${h}</span></span></span><input type="checkbox" class="check" checked data-mig="${k}" aria-label="${l}"></label>`).join('')}</div>
          <p class="set-note">${m.sizeGB} GB in total. Docker Desktop is paused during the copy and not modified.</p>
          ${nav('resources', '', '', `<button class="btn btn-lg" data-go="/welcome/cli">Skip</button><button class="btn btn-lg btn-brand" data-act="wz-import">Import ${m.sizeGB} GB</button>`)}`,
      cli: `<h1 class="h-big">Use it from the terminal</h1><p class="wz-lede">The tools you already use point at Containeria. Switch back any time in Settings.</p>
        <div class="set-group wz-pick">${[['docker', 'Points to Docker Desktop now', true], ['docker compose', 'Compose v2.32', true], ['docker buildx', 'Buildx 0.19', true], ['kubectl', 'For the built-in cluster', true], ['cx', 'Containeria CLI: cx ps, cx shell, cx open', true]].map(([b, h, on]) => `<label class="set-row"><span class="set-row-text"><span class="mono ink">${b}</span><span class="hint">${h}</span></span><input type="checkbox" class="check" ${on ? 'checked' : ''} aria-label="${b}"></label>`).join('')}</div>
        <p class="set-note">${icon('lock', 'sm')} macOS asks for your password once to link them in /usr/local/bin.</p>
        ${nav('migrate', 'done', 'Install tools')}`,
      done: `<div class="wz-hero">${icon('circle-check', 'wz-check')}<h1 class="h-big">You’re set</h1><p>The engine is running. Find any container, table or setting from the palette.</p>
        <div class="wz-try"><span class="kbd">⌘</span><span class="kbd">K</span></div><p class="meta">Press it now to start</p></div>
        <div class="wz-foot wz-foot-center"><button class="btn btn-lg" data-go="/containers">Open Containeria</button></div>`,
    }[step];
    return `<div class="wz">${steps}<div class="wz-body enter" data-step="${step}">${body}</div></div>`;
  },
  mount(root, ctx) {
    ranges(root);
    if ((ctx.params[0] || 'welcome') !== 'done') return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { history.replaceState(null, '', '#/containers'); App.render(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  },
});
App.act('wz-import', () => {
  wz.importing = true; App.rerender();
  const parts = [0, 0, 0];
  const id = setInterval(() => {
    const k = parts.findIndex((p) => p < 1);
    if (k < 0) { clearInterval(id); wz.importing = false; wz.imported = true; if (App.route.name === 'welcome') App.rerender(); toast({ title: 'Import finished', body: `${DB.migration.containers} containers, ${DB.migration.images} images, ${DB.migration.volumes} volumes`, tone: 'ok' }); return; }
    parts[k] = Math.min(1, parts[k] + 0.08 + Math.random() * 0.1);
    const bar = $(`[data-prog="${k}"]`), lab = $(`[data-prog-label="${k}"]`);
    if (bar) bar.style.transform = `scaleX(${parts[k]})`;
    if (lab) lab.textContent = parts[k] >= 1 ? 'Done' : Math.round(parts[k] * 100) + '%';
  }, 160);
});

/* ======================================================================
   Run container sheet
   ====================================================================== */
const SYS_HUB = [
  { ref: 'nginx:alpine', desc: 'Official · web server', mono: 'Nx', th: 150, port: 80 },
  { ref: 'postgres:17', desc: 'Official · local image', mono: 'Pg', th: 240, port: 5432, env: [['POSTGRES_PASSWORD', 'postgres', true], ['POSTGRES_DB', 'app', false]], vol: '/var/lib/postgresql/data' },
  { ref: 'redis:7.4-alpine', desc: 'Official · local image', mono: 'Rd', th: 25, port: 6379 },
  { ref: 'mysql:8.4', desc: 'Official · local image', mono: 'My', th: 230, port: 3306, env: [['MYSQL_ROOT_PASSWORD', 'root', true]] },
  { ref: 'mongo:8.0', desc: 'Official · local image', mono: 'Mg', th: 145, port: 27017 },
  { ref: 'rabbitmq:4-management', desc: 'Official · message broker', mono: 'Rb', th: 55, port: 15672 },
  { ref: 'minio/minio:latest', desc: 'S3-compatible storage · local image', mono: 'Mn', th: 5, port: 9001 },
  { ref: 'python:3.13-slim', desc: 'Official · runtime', mono: 'Py', th: 230 },
  { ref: 'ghcr.io/open-webui/open-webui:main', desc: 'GitHub registry', mono: 'Ow', th: 270, port: 8080 },
];
const usedPorts = () => Object.fromEntries(DB.containers.filter((c) => c.state === 'running').flatMap((c) => c.ports.map((p) => [p.host, c.name])));
const freePort = (p) => { const u = usedPorts(); while (u[p]) p++; return p; };
const portRow = (h = '', c = '') => `<div class="run-line" data-port><input class="input mono num" placeholder="Mac port" value="${h}" data-host-port aria-label="Port on your Mac"><span class="ink-3">${icon('arrow-right', 'sm')}</span><input class="input mono num" placeholder="Container" value="${c}" data-ctr-port aria-label="Container port">${sel(['tcp', 'udp'], 'tcp', 'style="width:76px" aria-label="Protocol"')}<button class="btn btn-ghost btn-icon btn-sm" data-rm data-tip="Remove">${icon('minus')}</button></div><div class="run-conflict" hidden></div>`;
const envRow = (k = '', v = '', secret = false) => `<div class="run-line" data-env><input class="input mono" placeholder="KEY" value="${esc(k)}" aria-label="Variable name"><input class="input mono" type="${secret ? 'password' : 'text'}" placeholder="value" value="${esc(v)}" aria-label="Value"><button class="btn btn-ghost btn-icon btn-sm ${secret ? 'is-on' : ''}" data-secret data-tip="${secret ? 'Secret: hidden in the UI and logs' : 'Mark as secret'}">${icon(secret ? 'lock' : 'lock-open')}</button><button class="btn btn-ghost btn-icon btn-sm" data-rm data-tip="Remove">${icon('minus')}</button></div>`;
const volRow = (src = '', dst = '', folder = false) => `<div class="run-line" data-vol>${folder ? `<button class="btn run-folder" data-pick-folder>${icon('folder', 'sm')}<span class="truncate">${esc(src || 'Choose folder…')}</span></button>` : sel([['', 'New volume'], ...DB.volumes.map((v) => v.name)], src, 'aria-label="Volume"')}<input class="input mono" placeholder="/path/in/container" value="${esc(dst)}" aria-label="Container path"><label class="row gap-4 meta" style="white-space:nowrap"><input type="checkbox" class="check">Read-only</label><button class="btn btn-ghost btn-icon btn-sm" data-rm data-tip="Remove">${icon('minus')}</button></div>`;
App.act('run-container', (el0, preset) => {
  const nets = DB.networks.filter((n) => n.driver === 'bridge').map((n) => n.name);
  sheet({
    title: 'Run container', ic: 'player-play', width: 620,
    body: `<div class="col gap-16 run">
      <div class="field" style="position:relative"><span class="label">Image</span>
        <div class="search">${icon('search')}<input class="input mono" data-image placeholder="nginx:alpine, postgres:17, ghcr.io/…" autocomplete="off" aria-label="Image"></div>
        <div class="run-suggest" data-suggest hidden></div>
        <span class="err" data-image-err hidden>${icon('alert-circle', 'sm')}Choose an image to run</span>
      </div>
      <div class="row gap-12" style="align-items:flex-start">
        <div class="field grow"><span class="label">Name</span><input class="input mono" data-name placeholder="Generated from the image" aria-label="Name"><span class="hint" data-domain>Reachable at <span class="mono-sm">&lt;name&gt;.${DB.engine.domain}</span></span></div>
        <div class="field" style="width:200px"><span class="label">Network</span>${sel(nets, 'bridge', 'data-net')}</div>
      </div>
      <div class="run-sec"><div class="row"><span class="h-sub">Ports</span><button class="btn btn-ghost btn-sm right" data-add="port">${icon('plus', 'sm')}Add port</button></div><div data-list="port"></div></div>
      <div class="run-sec"><div class="row"><span class="h-sub">Environment</span><button class="btn btn-ghost btn-sm right" data-add-envfile>${icon('file-text', 'sm')}Import .env</button><button class="btn btn-ghost btn-sm" data-add="env">${icon('plus', 'sm')}Add variable</button></div><div data-list="env"></div></div>
      <div class="run-sec"><div class="row"><span class="h-sub">Storage</span><button class="btn btn-ghost btn-sm right" data-add="folder">${icon('folder-plus', 'sm')}Folder from Mac</button><button class="btn btn-ghost btn-sm" data-add="vol">${icon('plus', 'sm')}Volume</button></div><div data-list="vol"></div></div>
      <div class="run-grid">
        <div class="field"><span class="label">Restart</span>${seg2([['no', 'Never'], ['on-failure', 'On failure'], ['unless-stopped', 'Unless stopped'], ['always', 'Always']], 'unless-stopped')}</div>
        <div class="field"><span class="label">Platform</span>${seg2([['arm64', 'arm64'], ['amd64', 'amd64 · Rosetta']], 'arm64')}</div>
      </div>
      <div class="field"><span class="label">Command</span><input class="input mono" placeholder="Image default" aria-label="Command override"></div>
      <details class="run-more"><summary>${icon('chevron-right', 'sm')}Resource limits</summary>
        <div class="run-grid" style="margin-top:10px">
          <div class="field"><span class="label">CPU limit</span>${slider({ key: 'cpu', min: 1, max: DB.engine.cpus, value: DB.engine.cpus, unit: 'cores' })}</div>
          <div class="field"><span class="label">Memory limit</span><div class="input-group"><input class="input mono num" placeholder="No limit" aria-label="Memory limit"><span class="input-addon">MB</span></div></div>
        </div>
      </details>
      <label class="row"><input type="checkbox" class="check" checked data-open>Open in browser when it’s ready</label>
    </div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-copy-cmd data-tip="Copy as docker run">${icon('terminal-2', 'sm')}Copy as docker run</button><div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-run>Run<span class="kbd">⌘↵</span></button></div>`,
    onMount(el, close) {
      ranges(el);
      const img = $('[data-image]', el), sug = $('[data-suggest]', el), name = $('[data-name]', el);
      const list = (k) => $(`[data-list="${k}"]`, el);
      const add = (k, html) => list(k).insertAdjacentHTML('beforeend', html);
      const checkPorts = () => {
        const used = usedPorts();
        $$('[data-port]', el).forEach((r) => {
          const p = +$('[data-host-port]', r).value, warn = r.nextElementSibling;
          if (used[p]) { const alt = freePort(p); warn.hidden = false; warn.innerHTML = `${icon('alert-triangle', 'sm')}<span>${p} is in use by ${esc(used[p])}.</span><button class="btn btn-sm" data-use="${alt}">Use ${alt}</button>`; }
          else warn.hidden = true;
        });
      };
      const pick = (h) => {
        img.value = h.ref; sug.hidden = true; $('[data-image-err]', el).hidden = true; img.classList.remove('is-error');
        const base = h.ref.split('/').pop().split(':')[0];
        name.placeholder = `${base}-1`; name.dispatchEvent(new Event('input'));
        list('port').innerHTML = h.port ? portRow(h.port, h.port) : '';
        list('env').innerHTML = (h.env || []).map(([k, v, s]) => envRow(k, v, s)).join('');
        list('vol').innerHTML = h.vol ? volRow('', h.vol) : '';
        checkPorts();
      };
      const drawSug = () => {
        const q = img.value.trim().toLowerCase();
        const hits = SYS_HUB.filter((h) => !q || h.ref.includes(q)).slice(0, 7);
        sug.hidden = !hits.length || document.activeElement !== img;
        sug.innerHTML = hits.map((h, i) => `<button class="run-sug" data-i="${SYS_HUB.indexOf(h)}">${tile(h)}<span class="mono ink truncate">${esc(h.ref)}</span><span class="meta right">${esc(h.desc)}</span></button>`).join('');
      };
      img.addEventListener('focus', drawSug); img.addEventListener('input', drawSug);
      img.addEventListener('blur', () => setTimeout(() => (sug.hidden = true), 150));
      img.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !sug.hidden && sug.firstElementChild) { e.preventDefault(); pick(SYS_HUB[+sug.firstElementChild.dataset.i]); } });
      sug.addEventListener('mousedown', (e) => { const b = e.target.closest('.run-sug'); if (b) { e.preventDefault(); pick(SYS_HUB[+b.dataset.i]); } });
      name.addEventListener('input', () => { const n = (name.value || name.placeholder || '').trim(); $('[data-domain]', el).innerHTML = n && !n.startsWith('Generated') ? `Reachable at <span class="mono-sm ink">${esc(n)}.${DB.engine.domain}</span>` : `Reachable at <span class="mono-sm">&lt;name&gt;.${DB.engine.domain}</span>`; });
      el.addEventListener('input', (e) => { if (e.target.matches('[data-host-port]')) checkPorts(); });
      el.addEventListener('click', (e) => {
        const t = e.target;
        const a = t.closest('[data-add]');
        if (a) { const k = a.dataset.add; if (k === 'port') add('port', portRow(freePort(8080), 80)); if (k === 'env') add('env', envRow()); if (k === 'vol') add('vol', volRow()); if (k === 'folder') add('vol', volRow('', '/srv', true)); checkPorts(); }
        const rm = t.closest('[data-rm]'); if (rm) { const line = rm.closest('.run-line'); if (line.nextElementSibling?.classList.contains('run-conflict')) line.nextElementSibling.remove(); line.remove(); }
        const sc = t.closest('[data-secret]'); if (sc) { const v = sc.previousElementSibling; const on = v.type !== 'password'; v.type = on ? 'password' : 'text'; sc.classList.toggle('is-on', on); sc.innerHTML = icon(on ? 'lock' : 'lock-open'); sc.dataset.tip = on ? 'Secret: hidden in the UI and logs' : 'Mark as secret'; }
        const use = t.closest('[data-use]'); if (use) { use.closest('.run-conflict').previousElementSibling.querySelector('[data-host-port]').value = use.dataset.use; checkPorts(); }
        const pf = t.closest('[data-pick-folder]'); if (pf) { $('span', pf).textContent = '~/Code/site'; pf.dataset.tip = '~/Code/site'; }
        if (t.closest('[data-add-envfile]')) { add('env', envRow('API_URL', 'http://api.shop.containeria.local') + envRow('STRIPE_KEY', 'sk_test_51Qx…', true)); toast({ title: 'Imported 2 variables from .env', ic: 'file-text', ms: 1800 }); }
        if (t.closest('[data-copy-cmd]')) { const cmd = `docker run -d --name ${name.value || name.placeholder} ${$$('[data-port]', el).map((r) => `-p ${$('[data-host-port]', r).value}:${$('[data-ctr-port]', r).value}`).join(' ')} ${img.value || '<image>'}`.replace(/\s+/g, ' '); navigator.clipboard?.writeText(cmd).catch(() => {}); toast({ title: 'Copied', body: cmd, ic: 'copy' }); }
      });
      const run = () => {
        if (!img.value.trim()) { img.classList.add('is-error'); $('[data-image-err]', el).hidden = false; img.focus(); return; }
        const conflict = $$('.run-conflict', el).find((w) => !w.hidden);
        if (conflict) { conflict.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 220 }); return; }
        const ref = img.value.trim(), [repo, tag = 'latest'] = ref.split(/:(?=[^/]+$)/);
        const n = (name.value || name.placeholder).trim();
        const h = SYS_HUB.find((x) => x.ref === ref) || { mono: repo.split('/').pop().slice(0, 2).replace(/^./, (c) => c.toUpperCase()), th: 200 };
        const ports = $$('[data-port]', el).map((r) => ({ host: +$('[data-host-port]', r).value, ctr: +$('[data-ctr-port]', r).value })).filter((p) => p.host);
        DB.containers.unshift({ id: Math.random().toString(16).slice(2, 14), name: n, project: null, image: repo, tag, mono: h.mono, th: h.th, state: 'running', started: Date.now(), cpu: 0.6, memMB: 24, memLimitMB: 0, ports, restarts: 0, health: null, domain: `${n}.${DB.engine.domain}`, cmd: '' });
        close(); App.rerender();
        toast({ title: `${n} is running`, body: `${n}.${DB.engine.domain}${ports[0] ? ` · localhost:${ports[0].host}` : ''}`, tone: 'ok', actionLabel: 'Show', action: () => App.go('/containers/' + n), ms: 5000 });
      };
      $('[data-run]', el).onclick = run;
      el.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
      if (typeof preset === 'string' && preset.includes(':')) pick(SYS_HUB.find((h) => h.ref === preset) || { ref: preset });
    },
  });
});

/* ---------- Open Compose project ---------- */
App.act('open-compose', () => {
  const svcs = [['web', 'node:22-alpine', '3000', 'api'], ['api', 'golang:1.24', '8080', 'db'], ['db', 'postgres:17', '5432', '—']];
  sheet({
    title: 'Open Compose project', ic: 'cx-image', width: 560,
    body: `<div data-compose-pick class="run-drop" tabindex="0">${icon('file-code', 'xl')}<b class="ink">Drop a compose.yaml here</b><span class="meta">or</span><button class="btn" data-choose>Choose file…</button></div>
      <div data-compose-parsed hidden class="col gap-16">
        <div class="row"><span class="tile tile-lg" style="--th:255">${icon('file-code')}</span><div class="grow"><b class="ink">compose.yaml</b><div class="meta mono-sm">~/Code/blog</div></div><button class="btn btn-ghost btn-sm" data-choose>Change</button></div>
        <div class="field"><span class="label">Project name</span><input class="input mono" value="blog" aria-label="Project name"><span class="hint">Domains become <span class="mono-sm">web.blog.${DB.engine.domain}</span></span></div>
        <table class="tbl run-tbl"><thead><tr><th>Service</th><th>Image</th><th class="num">Port</th><th>Depends on</th></tr></thead><tbody>${svcs.map(([s, i, p, d]) => `<tr><td class="ink">${s}</td><td class="mono-sm">${i}</td><td class="num">${p}</td><td class="ink-3">${d}</td></tr>`).join('')}</tbody></table>
        <div class="banner">${icon('file-text')}<span>Uses <span class="mono-sm">.env</span> with 6 variables. 2 images will be pulled (512 MB).</span></div>
      </div>`,
    foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-start disabled>Start project</button></div>`,
    onMount(el, close) {
      const show = () => { $('[data-compose-pick]', el).hidden = true; $('[data-compose-parsed]', el).hidden = false; $('[data-start]', el).disabled = false; };
      $$('[data-choose]', el).forEach((b) => (b.onclick = show));
      const drop = $('[data-compose-pick]', el);
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); show(); });
      $('[data-start]', el).onclick = () => { close(); toast({ title: 'blog is starting', body: '3 services · pulling 2 images', ic: 'cx-image', ms: 4000 }); };
    },
  });
});

/* ---------- shortcuts and diagnostics ---------- */
App.act('shortcuts', () => sheet({ title: 'Keyboard shortcuts', ic: 'keyboard', width: 560, body: `<div class="set-form" style="padding:0">${shortcutsHTML()}</div>` }));
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); e.stopPropagation(); App.actions.shortcuts(); } }, true);

App.act('diagnostics', () => sheet({
  title: 'Collect diagnostics', ic: 'bug', width: 500,
  body: `<div data-diag-pick class="col gap-12"><p style="margin:0">A zip you can attach to a bug report. Nothing is sent anywhere.</p>
    <div class="diag-cols"><div><span class="label">Included</span><ul class="diag-list">${['Engine and VM logs, last 24 hours', 'Engine settings and versions', 'Container and image list, without environment values', 'Network and DNS configuration', 'macOS version and Mac model'].map((x) => `<li>${icon('check', 'sm ok-ink')}${x}</li>`).join('')}</ul></div>
    <div><span class="label">Never included</span><ul class="diag-list">${['Environment variables and secrets', 'Volume and file contents', 'Database rows and queries', 'Passwords from the Keychain'].map((x) => `<li>${icon('x', 'sm ink-3')}${x}</li>`).join('')}</ul></div></div></div>
    <div data-diag-run hidden class="col gap-12"><div class="row"><span class="ink grow" data-diag-step>Reading engine logs</span><span class="meta num" data-diag-pct>0%</span></div><div class="progress"><i data-diag-bar style="transform:scaleX(0)"></i></div></div>`,
  foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-diag>Collect</button></div>`,
  onMount(el, close) {
    $('[data-diag]', el).onclick = (e) => {
      e.currentTarget.disabled = true;
      $('[data-diag-pick]', el).hidden = true; $('[data-diag-run]', el).hidden = false;
      const steps = ['Reading engine logs', 'Listing containers', 'Checking network', 'Writing zip'];
      let p = 0;
      const id = setInterval(() => {
        p = Math.min(1, p + 0.07);
        $('[data-diag-bar]', el).style.transform = `scaleX(${p})`; $('[data-diag-pct]', el).textContent = Math.round(p * 100) + '%';
        $('[data-diag-step]', el).textContent = steps[Math.min(3, Math.floor(p * 4))];
        if (p >= 1) { clearInterval(id); close(); toast({ title: 'Saved containeria-diagnostics-2026-10-17.zip', body: 'In your Downloads folder · 4.8 MB', tone: 'ok', actionLabel: 'Show in Finder', ms: 6000 }); }
      }, 120);
    };
  },
}));
