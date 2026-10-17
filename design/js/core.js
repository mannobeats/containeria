// Containeria prototype core: router, layers, helpers. Plain DOM, no build step.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => (name.startsWith('cx-') ? cxIcon(name, cls) : `<i class="ti ti-${name} ${cls}" aria-hidden="true"></i>`);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// a container, image, connection or machine gets a face: its real logo, or Containeria's own icon for the object
function tile(o, size = '', extra = '') {
  const key = logoKey(o);
  if (key) return `<span class="tile is-logo ${size} ${extra}">${logoImg(key)}</span>`;
  const ic = o.icon || (o.repo || o.ref ? 'cx-image' : o.distro ? 'cx-machine' : o.kind ? 'cx-data' : 'cx-container');
  return `<span class="tile ${size} ${extra}">${icon(ic)}</span>`;
}

const fmt = {
  mb(mb) { if (mb == null) return '—'; if (mb >= 1024) return (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB'; return Math.round(mb) + ' MB'; },
  gb(gb) { return (gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)) + ' GB'; },
  pct(v) { return (v < 10 ? v.toFixed(1) : Math.round(v)) + '%'; },
  num(n) { return n == null ? '—' : n.toLocaleString('en-US'); },
  ago(t) {
    const s = Math.max(1, (Date.now() - t) / 1000);
    if (s < 60) return `${Math.round(s)}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  },
  dur(t) {
    const s = Math.max(1, (Date.now() - t) / 1000);
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
    return `${Math.round(s / 86400)}d`;
  },
  date(t) { return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); },
  money(c, cur = 'EUR') { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format(c / 100); },
};

const App = (window.App = {
  views: {}, actions: {}, menus: {}, palette: [],
  route: { name: '', params: [], query: {} },
  _cleanups: [],
  _listeners: {},

  view(name, def) { this.views[name] = def; },
  act(name, fn) { this.actions[name] = fn; },
  menu(name, fn) { this.menus[name] = fn; },

  // events that views subscribe to; removed on navigation
  on(evt, fn) { (this._listeners[evt] ||= new Set()).add(fn); this._cleanups.push(() => this._listeners[evt].delete(fn)); },
  emit(evt, data) { this._listeners[evt]?.forEach((fn) => fn(data)); },
  every(ms, fn) { const id = setInterval(fn, ms); this._cleanups.push(() => clearInterval(id)); return id; },
  cleanup(fn) { this._cleanups.push(fn); },

  go(path) { if (location.hash === '#' + path) this.render(); else location.hash = path; },
  parse() {
    const [p, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const segs = p.split('/').filter(Boolean).map(decodeURIComponent);
    return { name: segs[0] || 'containers', params: segs.slice(1), query: Object.fromEntries(new URLSearchParams(qs || '')) };
  },
  render() {
    this._cleanups.splice(0).forEach((fn) => fn());
    closeLayers();
    const r = (this.route = this.parse());
    const v = this.views[r.name] || this.views.containers;
    const ctx = { ...r };
    const topbar = $('.topbar'), view = $('.view');
    topbar.innerHTML = `<div class="crumbs">${v.crumbs ? v.crumbs(ctx) : `<b>${esc(v.title)}</b>`}</div><div class="tools">${v.tools ? v.tools(ctx) : ''}</div>`;
    view.className = 'view view-enter' + (v.flush ? ' is-flush' : '');
    view.innerHTML = v.render(ctx);
    view.scrollTop = 0;
    $$('.sb-item[data-go]').forEach((a) => a.classList.toggle('is-active', a.dataset.go.replace(/^\//, '').split('/')[0] === (v.nav || r.name) && (!a.dataset.match || location.hash.includes(a.dataset.match)) && (!a.dataset.exact || location.hash.split('?')[0] === a.dataset.exact)));
    $$('.seg', view).forEach(segThumb);
    $$('.seg', topbar).forEach(segThumb);
    const out = v.mount?.(view, ctx);
    if (typeof out === 'function') this._cleanups.push(out);
    renderEngineOverlay();
  },
  rerender() { const y = $('.view').scrollTop; this.render(); $('.view').scrollTop = y; },
});

/* ---------- segmented controls ---------- */
function segThumb(seg) {
  let thumb = $('.seg-thumb', seg);
  if (!thumb) { thumb = document.createElement('span'); thumb.className = 'seg-thumb'; seg.prepend(thumb); }
  const on = $('button[aria-pressed="true"]', seg);
  if (!on) { thumb.style.opacity = 0; return; }
  thumb.style.opacity = 1;
  requestAnimationFrame(() => { thumb.style.width = on.offsetWidth + 'px'; thumb.style.transform = `translateX(${on.offsetLeft - 2}px)`; thumb.style.left = '2px'; });
}

/* ---------- floating layers ---------- */
let openMenu = null;
function closeLayers() { closeMenu(); $('.palette-wrap')?.remove(); closeTray(); }
function closeMenu() { if (openMenu) { openMenu.el.remove(); openMenu.anchor?.classList.remove('is-on'); openMenu = null; } }

function showMenu(anchor, items, { align = 'start', at } = {}) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu float'; el.setAttribute('role', 'menu');
  el.innerHTML = items.map((it, i) => {
    if (it.sep) return '<div class="menu-sep"></div>';
    if (it.heading) return `<div class="menu-label">${esc(it.heading)}</div>`;
    return `<button class="menu-item ${it.danger ? 'is-danger' : ''} ${it.checked ? 'is-checked' : ''}" role="menuitem" data-i="${i}" ${it.disabled ? 'disabled style="opacity:.4"' : ''}>${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.kbd ? `<span class="menu-kbd">${esc(it.kbd)}</span>` : ''}</button>`;
  }).join('');
  document.body.append(el);
  const r = at ? { left: at.x, right: at.x, bottom: at.y, top: at.y } : anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = align === 'end' ? r.right - w : r.left, y = r.bottom + 4;
  if (x + w > innerWidth - 8) x = innerWidth - w - 8;
  if (y + h > innerHeight - 8) { y = (at ? at.y : r.top) - h - 4; el.style.transformOrigin = 'bottom left'; }
  el.style.left = Math.max(8, x) + 'px'; el.style.top = Math.max(8, y) + 'px';
  anchor?.classList.add('is-on');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.menu-item'); if (!b) return;
    const it = items[+b.dataset.i]; closeMenu();
    if (it.run) it.run(anchor); else if (it.act) App.actions[it.act]?.(anchor, it.arg);
  });
  openMenu = { el, anchor };
  $('.menu-item', el)?.focus({ preventScroll: true });
}

/* ---------- tooltips ---------- */
const tipEl = Object.assign(document.createElement('div'), { className: 'tip', role: 'tooltip' });
let tipTimer, tipFor;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t === tipFor) return;
  clearTimeout(tipTimer); tipEl.classList.remove('is-on'); tipFor = t;
  if (!t) return;
  tipTimer = setTimeout(() => {
    if (!document.body.contains(t)) return;
    tipEl.innerHTML = esc(t.dataset.tip) + (t.dataset.kbd ? `<span class="kbd">${esc(t.dataset.kbd)}</span>` : '');
    document.body.append(tipEl);
    const r = t.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + 6;
    if (y + h > innerHeight - 6) y = r.top - h - 6;
    tipEl.style.left = Math.min(innerWidth - w - 6, Math.max(6, x)) + 'px'; tipEl.style.top = y + 'px';
    tipEl.classList.add('is-on');
  }, 450);
});
document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tipEl.classList.remove('is-on'); });

/* ---------- toasts ---------- */
function toast({ title, body = '', tone = '', ic, action, actionLabel, ms = 3200 }) {
  const box = $('.toasts');
  const el = document.createElement('div');
  el.className = `toast ${tone ? 'is-' + tone : ''}`;
  el.innerHTML = `${icon(ic || { ok: 'circle-check', bad: 'alert-circle', warn: 'alert-triangle' }[tone] || 'info-circle')}<div class="grow"><b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ''}</div>${actionLabel ? `<button class="btn btn-sm">${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) $('.btn', el).onclick = () => { action?.(); leave(); };
  const leave = () => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 180); };
  box.append(el);
  setTimeout(leave, ms);
}

/* ---------- sheets (macOS sheet: drops from the window's top) ---------- */
function sheet({ title, ic, body, foot = '', width, onMount }) {
  const win = $('.window');
  const scrim = Object.assign(document.createElement('div'), { className: 'scrim' });
  const el = document.createElement('div');
  el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  if (width) el.style.width = `min(${width}px, calc(100% - 48px))`;
  el.innerHTML = `<div class="sheet-head">${ic ? `<span class="tile tile-lg" style="--th:255">${icon(ic)}</span>` : ''}<h2 class="h-sec grow">${esc(title)}</h2><button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close" data-tip="Close" data-kbd="esc">${icon('x')}</button></div><div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
  win.append(scrim, el);
  const close = () => { el.classList.add('is-closing'); scrim.style.transition = 'opacity 140ms'; scrim.style.opacity = 0; setTimeout(() => { el.remove(); scrim.remove(); }, 140); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  scrim.onclick = close;
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  $$('.seg', el).forEach(segThumb);
  onMount?.(el, close);
  setTimeout(() => $('input:not([type=checkbox]):not([type=radio]), textarea', el)?.focus(), 60);
  return { el, close };
}

function confirmSheet({ title, body, action, danger = true, onConfirm }) {
  sheet({
    title, width: 440,
    body: `<p style="margin:0;color:var(--ink-2)">${body}</p>`,
    foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-brand'}" data-ok>${esc(action)}</button></div>`,
    onMount(el, close) { $('[data-ok]', el).onclick = () => { close(); onConfirm?.(); }; setTimeout(() => $('[data-ok]', el).focus(), 60); },
  });
}

/* ---------- charts (uPlot, the library the app ships) ---------- */
const probe = document.createElement('i');
function cssColor(token, alpha) {
  if (!probe.isConnected) { probe.style.display = 'none'; document.body.append(probe); }
  probe.style.color = `var(${token})`;
  const c = getComputedStyle(probe).color;
  if (alpha == null) return c;
  return c.startsWith('oklch(') ? c.replace(/\)$/, ` / ${alpha})`).replace(/ \/ [\d.]+ \/ /, ' / ') : c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
}

const hhmm = (u, v) => v.map((x) => new Date(x * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
function chart(el, { series, data, height = 160, yFmt = (v) => v, max, min = 0, xFmt = hhmm, bars = false, spark = false }) {
  const ink3 = cssColor('--ink-3'), line = cssColor('--line');
  const font = '11px Geist, system-ui';
  const opts = {
    width: el.clientWidth || 600, height,
    padding: spark ? [4, 0, 2, 0] : [8, 4, 0, 0],
    cursor: { y: false, points: { size: 7, width: 2, fill: cssColor('--surface') } },
    legend: { show: false },
    scales: { x: { time: true }, y: { range: (u, lo, hi) => [min, max ?? Math.max(hi * 1.15, 1)] } },
    axes: [
      { show: !spark, stroke: ink3, font, grid: { show: false }, ticks: { show: false }, size: 26, values: xFmt, space: 80 },
      { show: !spark, stroke: ink3, font, grid: { show: !spark, stroke: line, width: 1 }, ticks: { show: false }, size: 62, values: (u, vals) => vals.map(yFmt), splits: (u, ax, lo, hi) => [lo, (lo + hi) / 2, hi] },
    ],
    series: [{}, ...series.map((s) => {
      const o = { label: s.label, stroke: cssColor(s.color || '--s1'), width: 1.5, points: { show: false }, value: (u, v) => (v == null ? '—' : yFmt(v)) };
      if (s.fill !== false) o.fill = cssColor(s.color || '--s1', s.fillAlpha ?? .12);
      if (bars) o.paths = uPlot.paths.bars({ size: [0.6, 8] });
      return o;
    })],
    hooks: { setCursor: [(u) => tipFor_chart(u, el, series, yFmt)] },
  };
  const u = new uPlot(opts, data, el);
  const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
  ro.observe(el);
  App.cleanup(() => { ro.disconnect(); u.destroy(); });
  return u;
}
function tipFor_chart(u, el, series, yFmt) {
  let t = el._tip;
  if (!t) { t = el._tip = Object.assign(document.createElement('div'), { className: 'chart-tip' }); el.style.position = 'relative'; el.append(t); }
  const i = u.cursor.idx;
  if (i == null) { t.style.opacity = 0; return; }
  const time = new Date(u.data[0][i] * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  t.innerHTML = `<div class="meta">${time}</div>` + series.map((s, k) => `<div class="row" style="gap:6px"><span style="width:8px;height:2px;border-radius:2px;background:${u.series[k + 1].stroke()}"></span><span class="grow">${esc(s.label)}</span><b class="num">${yFmt(u.data[k + 1][i] ?? 0)}</b></div>`).join('');
  const x = u.valToPos(u.data[0][i], 'x');
  t.style.opacity = 1;
  t.style.transform = `translateX(${Math.min(x + 54, el.clientWidth - 150)}px)`;
}

// rolling series: n points ending now, one per `step` seconds
function series(n, step, gen) {
  const t0 = Math.floor(Date.now() / 1000) - n * step;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) { xs.push(t0 + i * step); ys.push(gen(i)); }
  return [xs, ys];
}
function wave(base, amp, seed = 1) { let v = base, d = 0; return () => { d = d * .7 + (Math.random() - .5) * amp * .5; v = Math.max(0, v + d + (base - v) * .12); return v; }; }

/* ---------- live stats simulation ---------- */
const live = {
  tick() {
    for (const c of DB.containers) {
      if (c.state !== 'running') { c.cpu = 0; continue; }
      c._baseCpu ??= c.cpu; c._baseMem ??= c.memMB;
      c.cpu = Math.max(0.05, c._baseCpu * (0.7 + Math.random() * 0.6));
      c.memMB = Math.max(4, c.memMB + (c._baseMem - c.memMB) * 0.3 + (Math.random() - .5) * c._baseMem * 0.03);
    }
    App.emit('stats');
    paintLedgers();
    paintTrayMem();
  },
};
setInterval(() => live.tick(), 1600);

/* ---------- the memory ledger (signature) ---------- */
function ledgerData() {
  const total = DB.engine.memGB * 1024;
  const segs = DB.projects.map((p) => {
    const mb = DB.containers.filter((c) => c.project === p.id && c.state === 'running').reduce((a, c) => a + c.memMB, 0);
    return { id: p.id ?? 'standalone', name: p.name, color: p.color, mb };
  });
  const k8s = DB.kube.enabled ? DB.kube.pods.reduce((a, p) => a + p.memMB, 0) : 0;
  const mach = DB.machines.filter((m) => m.state === 'running').reduce((a, m) => a + m.memMB, 0);
  segs.push({ id: 'k8s', name: 'Kubernetes', color: 's5', mb: k8s });
  segs.push({ id: 'machines', name: 'Linux machines', color: 's4', mb: mach });
  const engineMB = 180;
  segs.push({ id: 'engine', name: 'Engine', color: 'ink-4', mb: engineMB });
  const used = segs.reduce((a, s) => a + s.mb, 0);
  if (DB.engine.state !== 'running') return { total, segs: segs.map((x) => ({ ...x, mb: 0 })), used: 0, returned: total, free: 0 };
  const returned = DB.engine.returnedGB * 1024;
  return { total, segs, used, returned, free: Math.max(0, total - used - returned) };
}
function ledgerHTML(size = '', { interactive = false } = {}) {
  const d = ledgerData();
  return `<div class="ledger ${size}" data-ledger ${interactive ? 'data-interactive' : ''} role="img" aria-label="Engine memory: ${fmt.mb(d.used)} used of ${fmt.mb(d.total)}, ${fmt.mb(d.returned)} returned to macOS">${d.segs.map((s) => `<span data-seg="${s.id}" style="--w:${(s.mb / d.total) * 100};--c:var(--${s.color})" ${interactive ? `data-tip="${esc(s.name)} · ${fmt.mb(s.mb)}"` : ''}></span>`).join('')}<span class="is-free"></span><span class="is-returned" style="--w:${(d.returned / d.total) * 100};width:calc(var(--w) * 1%);flex:none" ${interactive ? `data-tip="Returned to macOS · ${fmt.mb(d.returned)}"` : ''}></span></div>`;
}
function paintLedgers() {
  const d = ledgerData();
  $$('[data-ledger]').forEach((L) => d.segs.forEach((s) => { const el = L.querySelector(`[data-seg="${s.id}"]`); if (el) { el.style.setProperty('--w', (s.mb / d.total) * 100); if (el.dataset.tip) el.dataset.tip = `${s.name} · ${fmt.mb(s.mb)}`; } }));
  $$('[data-mem-used]').forEach((e) => (e.textContent = fmt.mb(d.used)));
}

/* ---------- engine state overlay ---------- */
function renderEngineOverlay() {
  $('.engine-off')?.remove();
  const s = DB.engine.state;
  const eng = $('.sb-engine');
  eng.className = 'sb-engine is-' + s;
  $('[data-engine-state]').textContent = { running: `Running · ${fmt.dur(DB.engine.uptime)}`, stopped: 'Stopped', starting: 'Starting…', updating: 'Updating…' }[s];
  const v = App.views[App.route.name];
  if (s === 'running' || v?.always) return;
  const el = document.createElement('div');
  el.className = 'engine-off';
  el.innerHTML = s === 'starting'
    ? `<div class="empty" style="width:360px">${engineMark(48)}<h2 class="h-sec">Starting the engine</h2><p>Booting the Linux VM and Docker. Usually about 2 seconds.</p><div class="progress" style="width:240px;margin-top:6px"><i style="transform:scaleX(.62)"></i></div><p class="meta" style="margin-top:2px">Mounting ~/ with VirtioFS</p></div>`
    : `<div class="empty">${engineMark(48)}<h2 class="h-sec">The engine is stopped</h2><p>Containers, Kubernetes and Linux machines run inside it. Your data is kept while it's off.</p><div class="row" style="margin-top:6px"><button class="btn btn-brand btn-lg" data-act="engine-start">${icon('player-play')}Start engine</button><button class="btn btn-lg" data-go="/settings/engine">Engine settings</button></div></div>`;
  $('.main').append(el);
}
App.act('engine-start', () => {
  DB.engine.state = 'starting'; renderEngineOverlay();
  setTimeout(() => { DB.engine.state = 'running'; DB.engine.uptime = Date.now(); App.rerender(); toast({ title: 'Engine started in 2.1 s', tone: 'ok' }); }, 2100);
});
App.act('engine-stop', () => {
  confirmSheet({ title: 'Stop the engine?', body: '9 running containers, 7 Kubernetes pods and 2 Linux machines will stop. Volumes and images are kept.', action: 'Stop engine', onConfirm() { DB.engine.state = 'stopped'; App.rerender(); toast({ title: 'Engine stopped', body: '5.6 GB of memory returned to macOS' }); } });
});
App.act('engine-restart', () => { DB.engine.state = 'starting'; renderEngineOverlay(); setTimeout(() => { DB.engine.state = 'running'; DB.engine.uptime = Date.now(); App.rerender(); toast({ title: 'Engine restarted', tone: 'ok' }); }, 2100); });

// the app mark: three stacked rounded containers
function engineMark(size = 28) {
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="oklch(.70 .16 255)"/><stop offset="1" stop-color="oklch(.52 .20 262)"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#lg-a)"/><rect x="7" y="7.5" width="18" height="4.6" rx="2.3" fill="white" opacity=".55"/><rect x="7" y="13.7" width="18" height="4.6" rx="2.3" fill="white" opacity=".78"/><rect x="7" y="19.9" width="18" height="4.6" rx="2.3" fill="white"/></svg>`;
}

/* ---------- command palette ---------- */
function paletteItems() {
  const go = (label, path, ic, meta = '') => ({ group: 'Go to', label, ic, meta, run: () => App.go(path) });
  return [
    { group: 'Actions', label: 'Run container…', ic: 'player-play', kbd: '⌘N', run: () => App.actions['run-container']?.() },
    { group: 'Actions', label: 'Pull image…', ic: 'download', run: () => App.actions['pull-image']?.() },
    { group: 'Actions', label: 'New database connection…', ic: 'database-plus', run: () => App.actions['new-connection']?.() },
    { group: 'Actions', label: 'New Linux machine…', ic: 'device-desktop-plus', run: () => App.actions['new-machine']?.() },
    { group: 'Actions', label: 'Clean up unused images', ic: 'trash', meta: '2.4 GB', run: () => App.actions['prune-images']?.() },
    { group: 'Actions', label: 'Restart engine', ic: 'refresh', run: () => App.actions['engine-restart']() },
    { group: 'Actions', label: 'Toggle appearance', ic: 'contrast', kbd: '⌘⇧L', run: () => cycleTheme() },
    go('Containers', '/containers', 'cx-container'), go('Images', '/images', 'cx-image'), go('Volumes', '/volumes', 'cx-volume'), go('Networks', '/networks', 'cx-network'),
    go('Kubernetes', '/kubernetes', 'cx-kube'), go('Linux machines', '/machines', 'cx-machine'), go('Data', '/data', 'cx-data'),
    go('Domains', '/domains', 'cx-domain'), go('Activity', '/activity', 'cx-activity'), go('Settings', '/settings', 'cx-settings', '⌘,'),
    ...DB.containers.map((c) => ({ group: 'Containers', label: c.name, tile: c, meta: c.state === 'running' ? 'Running' : c.exitCode ? `Exited (${c.exitCode})` : 'Stopped', run: () => App.go('/containers/' + c.name) })),
    ...DB.containers.filter((c) => c.state === 'running').map((c) => ({ group: 'Open a shell', label: `Terminal in ${c.name}`, ic: 'terminal-2', run: () => App.go(`/containers/${c.name}/terminal`) })),
    ...DB.connections.map((c) => ({ group: 'Databases', label: c.name, tile: c, meta: c.provider || c.kind, run: () => App.go('/data/' + c.id) })),
    ...Object.keys(DB.schema.public).map((t) => ({ group: 'Tables in shop-postgres', label: 'public.' + t, ic: 'table', meta: fmt.num(DB.schema.public[t].rows) + ' rows', run: () => App.go(`/data/shop-pg/${t}`) })),
    ...DB.images.filter((i) => !i.dangling).map((i) => ({ group: 'Images', label: `${i.repo}:${i.tag}`, tile: i, meta: fmt.mb(i.sizeMB), run: () => App.go('/images/' + encodeURIComponent(i.repo + ':' + i.tag)) })),
    ...DB.machines.map((m) => ({ group: 'Linux machines', label: m.name, tile: m, meta: `${m.distro} ${m.version}`, run: () => App.go('/machines/' + m.name) })),
  ];
}
function openPalette(prefill = '') {
  closeLayers();
  const wrap = document.createElement('div');
  wrap.className = 'palette-wrap';
  wrap.innerHTML = `<div class="palette" role="dialog" aria-label="Command palette"><div class="palette-in">${icon('search')}<input placeholder="Search containers, tables, images, actions" value="${esc(prefill)}" aria-label="Search"><span class="kbd">esc</span></div><div class="palette-list" role="listbox"></div><div class="palette-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> move</span><span><span class="kbd">↵</span> open</span><span><span class="kbd">⌘</span><span class="kbd">↵</span> open in new window</span><span class="right">Containeria</span></div></div>`;
  $('.window').append(wrap);
  const input = $('input', wrap), list = $('.palette-list', wrap);
  const all = paletteItems();
  let shown = [], active = 0;
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = q ? all.filter((it) => (it.label + ' ' + it.group + ' ' + (it.meta || '')).toLowerCase().includes(q)).slice(0, 40) : all.filter((it) => ['Actions', 'Go to'].includes(it.group) || (it.group === 'Containers' && it.meta === 'Running')).slice(0, 26);
    active = Math.min(active, Math.max(0, shown.length - 1));
    let g = '';
    list.innerHTML = shown.length ? shown.map((it, i) => (it.group !== g ? `<div class="palette-group">${esc((g = it.group))}</div>` : '') + `<button class="palette-item ${i === active ? 'is-active' : ''}" data-i="${i}" role="option">${it.tile ? tile(it.tile) : icon(it.ic)}<span class="truncate">${esc(it.label)}</span>${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ''}${it.kbd ? `<span class="kbd" ${it.meta ? '' : 'style="margin-left:auto"'}>${esc(it.kbd)}</span>` : ''}</button>`).join('') : `<div class="empty" style="padding:32px">${icon('search', 'lg')}<p>Nothing matches “${esc(input.value)}”.</p></div>`;
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };
  const run = (i) => { const it = shown[i]; if (!it) return; wrap.remove(); it.run(); };
  input.addEventListener('input', () => { active = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(shown.length - 1, active + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter') run(active);
    if (e.key === 'Escape') wrap.remove();
  });
  list.addEventListener('mousemove', (e) => { const b = e.target.closest('.palette-item'); if (b && +b.dataset.i !== active) { active = +b.dataset.i; $$('.palette-item', list).forEach((x) => x.classList.toggle('is-active', +x.dataset.i === active)); } });
  list.addEventListener('click', (e) => { const b = e.target.closest('.palette-item'); if (b) run(+b.dataset.i); });
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap.remove(); });
  draw(); input.focus();
}

/* ---------- menu bar popover (tray) ---------- */
function closeTray() { $('.tray')?.remove(); $('.mb-tray')?.classList.remove('is-on'); }
function paintTrayMem() { const d = ledgerData(); $$('.mb-mem').forEach((e) => (e.textContent = DB.engine.state === 'running' ? fmt.mb(d.used) : 'Off')); }
function openTray() {
  if ($('.tray')) return closeTray();
  closeMenu();
  const btn = $('.mb-tray'); btn.classList.add('is-on');
  const d = ledgerData();
  const running = DB.containers.filter((c) => c.state === 'running');
  const crashed = DB.containers.filter((c) => c.exitCode);
  const el = document.createElement('div');
  el.className = 'tray';
  const on = DB.engine.state === 'running';
  el.innerHTML = `
    <div class="tray-head">${engineMark(26)}<div class="grow"><b class="ink" style="font-weight:600">Containeria</b><div class="meta">${on ? `Engine running · ${running.length} containers` : 'Engine stopped'}</div></div>
      <label class="switch" data-tip="${on ? 'Stop engine' : 'Start engine'}"><input type="checkbox" ${on ? 'checked' : ''} data-tray-engine aria-label="Engine"><span></span></label></div>
    ${on ? `<div style="padding:0 14px 12px"><div class="row" style="justify-content:space-between;margin-bottom:6px"><span class="meta"><b class="ink num" data-mem-used>${fmt.mb(d.used)}</b> of ${DB.engine.memGB} GB</span><span class="meta">${fmt.mb(d.returned)} returned to macOS</span></div>${ledgerHTML('ledger-sm')}</div>` : ''}
    ${crashed.length ? `<div class="tray-sec"><div class="menu-label">Needs attention</div>${crashed.map((c) => `<button class="tray-row" data-go="/containers/${c.name}/logs">${tile(c, '', 'is-bad')}<span class="truncate">${esc(c.name)}</span><span class="meta bad-ink">Exited (${c.exitCode}) ${fmt.ago(c.finished)}</span></button>`).join('')}</div>` : ''}
    ${on ? DB.projects.map((p) => { const cs = running.filter((c) => c.project === p.id); if (!cs.length) return ''; return `<div class="tray-sec"><div class="menu-label row">${esc(p.name)}<span class="right meta num">${fmt.mb(cs.reduce((a, c) => a + c.memMB, 0))}</span></div>${cs.slice(0, 5).map((c) => `<button class="tray-row" data-go="/containers/${c.name}">${tile(c)}<span class="truncate grow">${esc(c.service || c.name)}</span>${c.ports[0] ? `<span class="tray-act btn btn-ghost btn-icon btn-sm" data-tip="Open localhost:${c.ports[0].host}">${icon('external-link', 'sm')}</span>` : ''}<span class="tray-act btn btn-ghost btn-icon btn-sm" data-tip="Terminal">${icon('terminal-2', 'sm')}</span><span class="meta tray-mem">${fmt.mb(c.memMB)}</span></button>`).join('')}</div>`; }).join('') : ''}
    <div class="tray-sec">
      <button class="tray-row" data-tray-open>${icon('app-window')}Open Containeria<span class="meta">⌘⇧O</span></button>
      <button class="tray-row" data-go="/data">${icon('cx-data')}Data browser</button>
      <button class="tray-row" data-go="/settings">${icon('cx-settings')}Settings…<span class="meta">⌘,</span></button>
    </div>
    <div class="tray-sec"><button class="tray-row" data-tray-quit>${icon('power')}Quit Containeria<span class="meta">⌘Q</span></button></div>`;
  document.body.append(el);
  const r = btn.getBoundingClientRect();
  el.style.left = Math.min(innerWidth - 348, r.right - 340 + 20) + 'px';
  $('[data-tray-engine]', el).onchange = (e) => { closeTray(); App.actions[e.target.checked ? 'engine-start' : 'engine-stop'](); };
  $('[data-tray-quit]', el).onclick = () => { closeTray(); toast({ title: 'The engine keeps running', body: 'Quitting the window frees about 90 MB. Containers stay up.', ic: 'info-circle' }); };
  $('[data-tray-open]', el).onclick = closeTray;
}

/* ---------- theme and accent ---------- */
const themes = ['system', 'light', 'dark'];
function setTheme(t) { App.theme = t; if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; localStorage.setItem('cx-theme', t); App.rerender(); }
function cycleTheme() {
  const cur = App.theme || 'system';
  const isDark = cur === 'dark' || (cur === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  setTheme(isDark ? 'light' : 'dark');
}
function setAccent(h, c = 1) { document.documentElement.style.setProperty('--brand-h', h); document.documentElement.style.setProperty('--brand-c', c); localStorage.setItem('cx-accent', JSON.stringify([h, c])); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((App.theme || 'system') === 'system') App.rerender(); });

/* ---------- global events ---------- */
document.addEventListener('click', (e) => {
  const t = e.target;
  if (openMenu && !t.closest('.menu')) { const same = t.closest('[data-menu]') === openMenu.anchor; closeMenu(); if (same) return; }
  if ($('.tray') && !t.closest('.tray') && !t.closest('.mb-tray')) closeTray();
  const seg = t.closest('.seg button');
  if (seg && !seg.closest('[data-seg-manual]')) { $$('button', seg.parentElement).forEach((b) => b.setAttribute('aria-pressed', b === seg)); segThumb(seg.parentElement); }
  // the innermost interactive element decides what a click means
  const hit = t.closest('[data-go],[data-act],[data-menu],[data-copy],a[href],input,label,select,textarea');
  if (!hit) return;
  if (hit.matches('[data-menu]')) { e.preventDefault(); e.stopPropagation(); const items = App.menus[hit.dataset.menu]?.(hit); if (items) showMenu(hit, items, { align: hit.dataset.align || 'start' }); return; }
  if (hit.matches('[data-copy]')) { navigator.clipboard?.writeText(hit.dataset.copy).catch(() => {}); toast({ title: 'Copied', body: hit.dataset.copy, ic: 'copy', ms: 1800 }); return; }
  if (hit.matches('[data-act]')) { if (!hit.matches('input,label')) e.preventDefault(); App.actions[hit.dataset.act]?.(hit, hit.dataset.arg, e); return; }
  if (hit.matches('[data-go]')) { e.preventDefault(); closeTray(); App.go(hit.dataset.go); }
});
document.addEventListener('contextmenu', (e) => {
  const c = e.target.closest('[data-ctx]');
  if (!c) return;
  e.preventDefault();
  const items = App.menus[c.dataset.ctx]?.(c);
  if (items) showMenu(c, items, { at: { x: e.clientX, y: e.clientY } });
});
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const typing = e.target.closest('input, textarea, [contenteditable]');
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('.palette-wrap') ? $('.palette-wrap').remove() : openPalette(); return; }
  if (mod && e.key === ',') { e.preventDefault(); App.go('/settings'); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); cycleTheme(); return; }
  if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); App.actions['run-container']?.(); return; }
  if (mod && e.key === '\\') { e.preventDefault(); $('.window').classList.toggle('is-collapsed'); return; }
  if (mod && /^[1-9]$/.test(e.key)) { const items = $$('.sb-nav > .sb-group .sb-item[data-go]'); const it = items[+e.key - 1]; if (it) { e.preventDefault(); App.go(it.dataset.go); } return; }
  if (e.key === 'Escape') { if (openMenu) closeMenu(); else if ($('.tray')) closeTray(); }
  if (!typing && e.key === '/' ) { const s = $('.view .search input'); if (s) { e.preventDefault(); s.focus(); } }
  App.emit('key', e);
});
addEventListener('hashchange', () => App.render());
addEventListener('resize', () => { closeMenu(); $$('.seg').forEach(segThumb); });
