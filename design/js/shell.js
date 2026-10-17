// Window chrome: sidebar, macOS menu bar, tray item, prototype controls.
function renderSidebar() {
  const running = DB.containers.filter((c) => c.state === 'running').length;
  const crashed = DB.containers.filter((c) => c.exitCode).length;
  const badPods = DB.kube.pods.filter((p) => p.status === 'CrashLoopBackOff').length;
  const item = (path, ic, label, count = '', extra = '') => `<button class="sb-item" data-go="${path}" ${extra}>${icon(ic)}<span class="truncate">${esc(label)}</span>${count}</button>`;
  const cnt = (n, bad) => (n || n === 0 ? `<span class="count ${bad ? 'is-bad' : ''}" ${bad ? `data-tip="${bad}"` : ''}>${n}</span>` : '');
  $('.sb-nav').innerHTML = `
    <div class="sb-group">
      ${item('/containers', 'cx-container', 'Containers', cnt(running) + (crashed ? `<span class="count is-bad" style="margin-left:6px" data-tip="${crashed} crashed">${icon('alert-triangle', 'sm')}</span>` : ''))}
      ${item('/images', 'cx-image', 'Images', cnt(DB.images.length))}
      ${item('/volumes', 'cx-volume', 'Volumes', cnt(DB.volumes.length))}
      ${item('/networks', 'cx-network', 'Networks', cnt(DB.networks.length))}
      ${item('/kubernetes', 'cx-kube', 'Kubernetes', badPods ? `<span class="count is-bad" data-tip="${badPods} pod crash-looping">${icon('alert-triangle', 'sm')}</span>` : '')}
      ${item('/machines', 'cx-machine', 'Linux machines', cnt(DB.machines.filter((m) => m.state === 'running').length))}
    </div>
    <div class="sb-group">
      <div class="sb-label">Data<button class="btn btn-ghost btn-icon btn-sm right" style="width:20px;height:20px" data-act="new-connection" aria-label="New connection" data-tip="New connection">${icon('plus', 'sm')}</button></div>
      ${item('/data', 'cx-data', 'All connections', cnt(DB.connections.length), 'data-exact="#/data"')}
      ${DB.connections.slice(0, 5).map((c) => `<button class="sb-item" data-go="/data/${c.id}" data-match="/data/${c.id}">${tile(c, 'sub-tile')}<span class="truncate">${esc(c.name)}</span>${c.env === 'production' ? `<span class="count" data-tip="Production, read-only">${icon('lock', 'sm')}</span>` : ''}</button>`).join('')}
    </div>
    <div class="sb-group">
      <div class="sb-label">Mac</div>
      ${item('/domains', 'cx-domain', 'Domains', cnt(DB.domains.filter((d) => d.up).length))}
      ${item('/activity', 'cx-activity', 'Activity')}
      ${item('/settings', 'cx-settings', 'Settings')}
    </div>`;
}

function paintChrome() {
  $('.sb-logo').innerHTML = engineMark(28);
  $('.sb-ledger').innerHTML = ledgerHTML('ledger-sm');
  $('[data-mem-total]').textContent = DB.engine.memGB + ' GB';
  paintLedgers();
  $('.mb-tray').innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="2.5" width="12" height="3" rx="1.5" opacity=".5"/><rect x="2" y="6.5" width="12" height="3" rx="1.5" opacity=".75"/><rect x="2" y="10.5" width="12" height="3" rx="1.5"/></svg><span class="mb-mem"></span>`;
  paintTrayMem();
  const clock = () => ($('.mb-clock').textContent = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
  clock(); setInterval(clock, 30e3);
}

renderSidebar();
paintChrome();

// re-render the sidebar after any state change a view makes
const _render = App.render.bind(App);
App.render = function () { $('.window').classList.toggle('is-onboarding', location.hash.startsWith('#/welcome')); renderSidebar(); $('.sb-ledger').innerHTML = ledgerHTML('ledger-sm'); paintLedgers(); paintTrayMem(); _render(); };

App.act('toggle-sidebar', () => $('.window').classList.toggle('is-collapsed'));
App.act('palette', () => openPalette());
App.act('proto-theme', () => cycleTheme());
App.act('proto-tray', () => openTray());
App.act('proto-engine', (el) => showMenu(el, [
  { heading: 'Show the engine as' },
  { label: 'Running', icon: 'player-play', checked: DB.engine.state === 'running', run: () => { DB.engine.state = 'running'; App.rerender(); } },
  { label: 'Starting', icon: 'loader-2', checked: DB.engine.state === 'starting', run: () => { DB.engine.state = 'starting'; App.rerender(); } },
  { label: 'Stopped', icon: 'player-stop', checked: DB.engine.state === 'stopped', run: () => { DB.engine.state = 'stopped'; App.rerender(); } },
  { sep: true },
  { label: 'Show an error toast', icon: 'alert-circle', run: () => toast({ title: 'Port 5432 is already in use', body: 'Another Postgres on your Mac holds it. Map shop-postgres to 5433 instead?', tone: 'bad', actionLabel: 'Use 5433', action: () => toast({ title: 'shop-postgres now on localhost:5433', tone: 'ok' }), ms: 7000 }) },
  { label: 'Show an update toast', icon: 'download', run: () => toast({ title: 'Containeria 1.5 is ready', body: 'Restart to update. Containers keep running.', ic: 'download', actionLabel: 'Restart', ms: 7000 }) },
]));
document.addEventListener('click', (e) => { if (e.target.closest('.mb-tray')) openTray(); });

App.menu('engine', () => [
  { heading: `Engine ${DB.engine.version} · ${DB.engine.cpus} CPUs · ${DB.engine.memGB} GB` },
  DB.engine.state === 'running' ? { label: 'Stop engine', icon: 'player-stop', act: 'engine-stop' } : { label: 'Start engine', icon: 'player-play', act: 'engine-start' },
  { label: 'Restart engine', icon: 'refresh', act: 'engine-restart' },
  { sep: true },
  { label: 'Copy Docker socket path', icon: 'copy', run: () => { navigator.clipboard?.writeText(DB.engine.socket).catch(() => {}); toast({ title: 'Copied', body: DB.engine.socket, ic: 'copy' }); } },
  { label: 'Open engine shell', icon: 'terminal-2', run: () => App.go('/machines/engine') },
  { label: 'Engine settings…', icon: 'adjustments', run: () => App.go('/settings/engine') },
]);

App.menu('mb-app', () => [
  { label: 'About Containeria', run: () => App.go('/settings/about') },
  { label: 'Check for updates…', run: () => toast({ title: 'Containeria is up to date', body: 'Version 1.4.2', tone: 'ok' }) },
  { sep: true },
  { label: 'Settings…', kbd: '⌘,', run: () => App.go('/settings') },
  { sep: true },
  { label: 'Hide Containeria', kbd: '⌘H' },
  { label: 'Quit Containeria', kbd: '⌘Q' },
]);
App.menu('mb-file', () => [
  { label: 'Run container…', kbd: '⌘N', act: 'run-container' },
  { label: 'Pull image…', kbd: '⌘⇧P', act: 'pull-image' },
  { label: 'Open Compose file…', kbd: '⌘O', act: 'open-compose' },
  { label: 'New Linux machine…', act: 'new-machine' },
  { label: 'New database connection…', kbd: '⌘⇧N', act: 'new-connection' },
  { sep: true },
  { label: 'Import from Docker Desktop…', run: () => App.go('/welcome/migrate') },
  { sep: true },
  { label: 'Close window', kbd: '⌘W' },
]);
App.menu('mb-edit', () => [{ label: 'Undo', kbd: '⌘Z' }, { label: 'Redo', kbd: '⌘⇧Z' }, { sep: true }, { label: 'Cut', kbd: '⌘X' }, { label: 'Copy', kbd: '⌘C' }, { label: 'Paste', kbd: '⌘V' }, { label: 'Select all', kbd: '⌘A' }, { sep: true }, { label: 'Find…', kbd: '⌘F' }]);
App.menu('mb-view', () => [
  { label: 'Command palette', kbd: '⌘K', act: 'palette' },
  { label: 'Toggle sidebar', kbd: '⌘\\', act: 'toggle-sidebar' },
  { label: 'Toggle appearance', kbd: '⌘⇧L', run: () => cycleTheme() },
  { sep: true },
  { label: 'Containers', kbd: '⌘1', run: () => App.go('/containers') },
  { label: 'Images', kbd: '⌘2', run: () => App.go('/images') },
  { label: 'Volumes', kbd: '⌘3', run: () => App.go('/volumes') },
  { label: 'Networks', kbd: '⌘4', run: () => App.go('/networks') },
  { label: 'Kubernetes', kbd: '⌘5', run: () => App.go('/kubernetes') },
  { label: 'Linux machines', kbd: '⌘6', run: () => App.go('/machines') },
]);
App.menu('mb-engine', () => App.menus.engine());
App.menu('mb-window', () => [{ label: 'Minimize', kbd: '⌘M' }, { label: 'Zoom' }, { sep: true }, { label: 'Activity', run: () => App.go('/activity') }, { label: 'Bring all to front' }]);
App.menu('mb-help', () => [{ label: 'Keyboard shortcuts', kbd: '⌘/', act: 'shortcuts' }, { label: 'Documentation ↗' }, { label: 'Report an issue ↗' }, { sep: true }, { label: 'Collect diagnostics…', act: 'diagnostics' }]);

App.menu('proto-screens', () => [
  { heading: 'Docker' },
  { label: 'Containers', run: () => App.go('/containers') },
  { label: 'Container: shop-api (logs)', run: () => App.go('/containers/shop-api/logs') },
  { label: 'Container: shop-postgres', run: () => App.go('/containers/shop-postgres') },
  { label: 'Container: payments-mock (crashed)', run: () => App.go('/containers/payments-mock') },
  { label: 'Images · Volumes · Networks', run: () => App.go('/images') },
  { heading: 'More' },
  { label: 'Kubernetes', run: () => App.go('/kubernetes') },
  { label: 'Linux machines', run: () => App.go('/machines') },
  { label: 'Data: shop-postgres orders', run: () => App.go('/data/shop-pg/orders') },
  { label: 'Data: SQL editor', run: () => App.go('/data/shop-pg/query') },
  { label: 'Data: schema diagram', run: () => App.go('/data/shop-pg/diagram') },
  { label: 'Domains', run: () => App.go('/domains') },
  { label: 'Activity', run: () => App.go('/activity') },
  { label: 'Settings', run: () => App.go('/settings') },
  { label: 'First launch', run: () => App.go('/welcome') },
  { label: 'Icons and logos', run: () => App.go('/icons') },
]);

// prototype-only: the icon and logo sheet, so both sets can be reviewed side by side
App.view('icons', {
  title: 'Icons and logos', always: true,
  crumbs: () => '<b>Icons and logos</b>',
  render: () => {
    const names = Object.keys(CX_ICONS);
    return `<div class="page" style="max-width:1100px">
      <h1 class="h-page">Containeria icons</h1>
      <p class="meta" style="margin:6px 0 20px;max-width:70ch">Drawn for Containeria’s own objects on Tabler’s 24px grid at a 1.5px stroke, so they sit next to Tabler’s UI icons. The soft fill is the object’s body; the accent marks the live part: the edited cell, the running prompt, the used memory.</p>
      <div class="ic-grid">${names.map((n) => `<div class="ic-cell"><span class="tile tile-xl">${cxIcon(n)}</span><b class="ink">${n}</b><span class="ic-sizes">${cxIcon(n, 'sm')}${cxIcon(n)}${cxIcon(n, 'lg')}</span></div>`).join('')}</div>
      <h2 class="h-page" style="margin-top:40px">Logos</h2>
      <p class="meta" style="margin:6px 0 20px;max-width:70ch">Real brand marks, never redrawn: Devicon originals (MIT) first, Simple Icons (CC0) where Devicon has none. Near-black marks get a light version in dark mode. Images with no known logo fall back to Containeria’s container or image icon.</p>
      <div class="ic-grid">${Object.entries(LOGOS).map(([k, t]) => `<div class="ic-cell"><span class="tile tile-lg">${logoImg(k)}</span><span class="meta">${esc(t)}</span></div>`).join('')}</div>
    </div>`;
  },
});
