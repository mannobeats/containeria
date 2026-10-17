// Containers: the memory ledger over the list, grouped by Compose project.
const ctState = { filter: 'all', q: '', collapsed: new Set(), selected: new Set(), grouped: true };

const ctRunning = (c) => c.state === 'running';
function ctStatus(c) {
  if (c.state === 'running') {
    if (c.health === 'unhealthy') return `<span class="row gap-4 warn-ink" data-tip="Health check failing · ${c.restarts} restarts">${icon('alert-triangle', 'sm')}Unhealthy</span>`;
    return `<span class="ink-3">Up ${fmt.dur(c.started)}</span>`;
  }
  if (c.state === 'paused') return `<span class="ink-3">Paused</span>`;
  if (c.exitCode) return `<span class="row gap-4 bad-ink" data-tip="${esc(c.error || 'Exited with code ' + c.exitCode)}">${icon('alert-circle', 'sm')}Exited (${c.exitCode}) · ${fmt.ago(c.finished)}</span>`;
  return `<span class="ink-3">Exited · ${fmt.ago(c.finished)}</span>`;
}
function ctPorts(c) {
  if (!c.ports.length) return '<span class="ink-4">—</span>';
  return c.ports.map((p) => `<a class="chip chip-mono" href="http://localhost:${p.host}" target="_blank" rel="noopener" data-tip="Open localhost:${p.host} ↗">${p.host}${p.host !== p.ctr ? `<span class="ink-3">:${p.ctr}</span>` : ''}</a>`).join(' ');
}
function ctRow(c, i) {
  const on = ctRunning(c), sel = ctState.selected.has(c.name);
  return `<tr class="ct-row ${on ? '' : 'is-off'} ${sel ? 'is-selected' : ''} enter" style="--i:${i}" data-go="/containers/${c.name}" data-ctx="container" data-name="${c.name}" data-proj="${c.project ?? 'standalone'}">
    <td class="ct-check"><input type="checkbox" class="check" data-act="ct-select" data-arg="${c.name}" ${sel ? 'checked' : ''} aria-label="Select ${c.name}"></td>
    <td><div class="row">${tile(c, '', c.exitCode ? 'is-bad' : on ? '' : 'is-off')}<span class="ct-name truncate">${esc(c.name)}</span>${c.db ? `<button class="btn btn-ghost btn-icon btn-sm ct-db" data-act="ct-open-data" data-arg="${c.name}" data-tip="Open in Data">${icon('cx-data', 'sm')}</button>` : ''}</div></td>
    <td><span class="mono-sm ink-3 truncate" style="display:block;max-width:220px">${esc(c.image)}:${esc(c.tag)}</span></td>
    <td>${ctPorts(c)}</td>
    <td class="num" data-cpu="${c.name}">${on ? fmt.pct(c.cpu) : '<span class="ink-4">—</span>'}</td>
    <td class="num" data-mem="${c.name}">${on ? fmt.mb(c.memMB) : '<span class="ink-4">—</span>'}</td>
    <td>${ctStatus(c)}</td>
    <td class="r"><div class="row-actions">
      ${on ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="ct-toggle" data-arg="${c.name}" data-tip="Stop">${icon('player-stop')}</button>` : `<button class="btn btn-ghost btn-icon btn-sm" data-act="ct-toggle" data-arg="${c.name}" data-tip="Start">${icon('player-play')}</button>`}
      <button class="btn btn-ghost btn-icon btn-sm" data-act="ct-restart" data-arg="${c.name}" data-tip="Restart">${icon('refresh')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-go="/containers/${c.name}/terminal" data-tip="Terminal" ${on ? '' : 'disabled'}>${icon('terminal-2')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-menu="container" data-name="${c.name}" data-align="end" aria-label="More">${icon('dots')}</button>
    </div></td></tr>`;
}

function ctList() {
  const q = ctState.q.toLowerCase();
  const list = DB.containers.filter((c) => (ctState.filter === 'all' || (ctState.filter === 'running') === ctRunning(c)) && (!q || (c.name + c.image + c.tag + (c.project || '')).toLowerCase().includes(q)));
  if (!list.length) return `<tr><td colspan="8"><div class="empty">${icon(q ? 'search' : 'cx-container', 'xl')}<h2 class="h-sec">${q ? `No containers match “${esc(ctState.q)}”` : ctState.filter === 'running' ? 'Nothing is running' : 'No stopped containers'}</h2>${q ? `<button class="btn" data-act="ct-clear-q">Clear search</button>` : ''}</div></td></tr>`;
  if (!ctState.grouped) return list.map(ctRow).join('');
  let i = 0;
  return DB.projects.map((p) => {
    const cs = list.filter((c) => c.project === p.id);
    if (!cs.length) return '';
    const pid = p.id ?? 'standalone', closed = ctState.collapsed.has(pid);
    const all = DB.containers.filter((c) => c.project === p.id), up = all.filter(ctRunning);
    const mem = up.reduce((a, c) => a + c.memMB, 0);
    return `<tr class="ct-group" data-proj="${pid}" data-ctx="${p.id ? 'project' : ''}" data-id="${pid}">
      <td colspan="8"><div class="row">
        <button class="btn btn-ghost btn-icon btn-sm ct-caret ${closed ? 'is-closed' : ''}" data-act="ct-collapse" data-arg="${pid}" aria-label="${closed ? 'Expand' : 'Collapse'} ${esc(p.name)}" aria-expanded="${!closed}">${icon('chevron-down', 'sm')}</button>
        <span class="ct-key" style="--c:var(--${p.color})"></span>
        <b class="ink">${esc(p.name)}</b>
        ${p.path ? `<span class="mono-sm ink-3">${esc(p.path)}</span>` : ''}
        <span class="meta">${up.length} of ${all.length} running</span>
        <span class="meta num right" data-proj-mem="${pid}">${up.length ? fmt.mb(mem) : ''}</span>
        ${p.id ? `<div class="row-actions ct-group-actions">
          ${up.length ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="proj-stop" data-arg="${pid}" data-tip="Stop project">${icon('player-stop')}</button>` : `<button class="btn btn-ghost btn-icon btn-sm" data-act="proj-start" data-arg="${pid}" data-tip="Start project">${icon('player-play')}</button>`}
          <button class="btn btn-ghost btn-icon btn-sm" data-act="proj-restart" data-arg="${pid}" data-tip="Restart project">${icon('refresh')}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="proj-logs" data-arg="${pid}" data-tip="Combined logs">${icon('file-text')}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-menu="project" data-id="${pid}" data-align="end" aria-label="More">${icon('dots')}</button>
        </div>` : '<span style="width:116px"></span>'}
      </div></td></tr>` + (closed ? '' : cs.map((c) => ctRow(c, i++)).join(''));
  }).join('');
}

function ctAnswer() {
  const d = ledgerData();
  const up = DB.containers.filter(ctRunning);
  const top = d.segs.filter((s) => !['engine'].includes(s.id)).sort((a, b) => b.mb - a.mb)[0];
  return `<b class="ink">${up.length} of ${DB.containers.length}</b> containers running, using <b class="ink num" data-mem-used>${fmt.mb(d.used)}</b> of the engine’s ${DB.engine.memGB} GB. <b class="ink">${esc(top.name)}</b> uses the most. <span class="ct-returned">${fmt.mb(d.returned)} went back to macOS.</span>`;
}
function ctLegend() {
  const d = ledgerData();
  return d.segs.filter((s) => s.mb > 0).map((s) => `<button class="ct-legend-item" data-seg-key="${s.id}"><span class="ct-key" style="--c:var(--${s.color})"></span>${esc(s.name)}<span class="num ink-3" data-legend-mb="${s.id}">${fmt.mb(s.mb)}</span></button>`).join('') +
    `<span class="ct-legend-item is-static"><span class="ct-key is-returned"></span>Returned to macOS<span class="num ink-3">${fmt.mb(d.returned)}</span></span>`;
}

App.view('containers', {
  title: 'Containers',
  crumbs: (ctx) => (ctx.params[0] ? ContainerDetail.crumbs(ctx) : '<b>Containers</b>'),
  tools: (ctx) => (ctx.params[0] ? ContainerDetail.tools(ctx) : `
    <button class="btn btn-ghost btn-icon" data-act="open-compose" data-tip="Open Compose file" data-kbd="⌘O">${icon('file-plus')}</button>
    <button class="btn btn-ghost btn-icon" data-menu="ct-view" data-align="end" data-tip="View options">${icon('adjustments-horizontal')}</button>`),
  get flush() { return !!App.route.params[0]; },
  render(ctx) {
    if (ctx.params[0]) return ContainerDetail.render(ctx);
    const crashed = DB.containers.filter((c) => c.exitCode);
    const n = { all: DB.containers.length, running: DB.containers.filter(ctRunning).length };
    n.stopped = n.all - n.running;
    if (!DB.containers.length) return `<div class="empty" style="height:100%">${tile({ icon: 'cx-container', th: 255 }, 'tile-xl')}<h2 class="h-sec">No containers yet</h2><p>Run one from an image, or start a Compose project.</p><div class="row"><button class="btn btn-brand btn-lg" data-act="run-container">Run container</button><button class="btn btn-lg" data-act="open-compose">Open Compose file</button></div></div>`;
    return `
      <section class="ct-hero">
        <div class="row ct-hero-top"><h1 class="h-page">Containers</h1>
          <button class="btn btn-brand right" data-act="run-container">${icon('player-play')}Run container<span class="kbd">⌘N</span></button></div>
        <p class="ct-answer" data-ct-answer>${ctAnswer()}</p>
        ${ledgerHTML('ledger-lg', { interactive: true })}
        <div class="ct-legend">${ctLegend()}</div>
      </section>
      ${crashed.map((c) => `<div class="banner banner-bad ct-crash">${icon('alert-circle')}<span class="grow"><b>${esc(c.name)}</b> exited with code ${c.exitCode} ${fmt.ago(c.finished)}. <span class="mono-sm">${esc(c.error)}</span></span><button class="btn btn-sm" data-go="/containers/${c.name}/logs">View logs</button><button class="btn btn-sm" data-act="ct-fix-port" data-arg="${c.name}">Use port 12112</button></div>`).join('')}
      <div class="toolbar ct-toolbar">
        <div class="seg" data-ct-filter>
          <button aria-pressed="${ctState.filter === 'all'}" data-f="all">All <span class="count">${n.all}</span></button>
          <button aria-pressed="${ctState.filter === 'running'}" data-f="running">Running <span class="count">${n.running}</span></button>
          <button aria-pressed="${ctState.filter === 'stopped'}" data-f="stopped">Stopped <span class="count">${n.stopped}</span></button>
        </div>
        <div class="search">${icon('search')}<input class="input" placeholder="Filter containers" value="${esc(ctState.q)}" data-ct-q aria-label="Filter containers"><span class="kbd">/</span></div>
      </div>
      <div class="ct-table-wrap">
        <table class="tbl ct-table">
          <colgroup><col style="width:44px"><col><col style="width:22%"><col style="width:150px"><col style="width:76px"><col style="width:92px"><col style="width:190px"><col style="width:132px"></colgroup>
          <thead><tr><th class="ct-check"><input type="checkbox" class="check" data-act="ct-select-all" aria-label="Select all"></th><th>Name</th><th>Image</th><th>Ports</th><th class="r">CPU</th><th class="r">Memory</th><th>Status</th><th></th></tr></thead>
          <tbody data-ct-body>${ctList()}</tbody>
        </table>
      </div>
      <div class="ct-bulk ${ctState.selected.size ? 'is-on' : ''}" data-ct-bulk>${ctBulk()}</div>`;
  },
  mount(root, ctx) {
    if (ctx.params[0]) return ContainerDetail.mount(root, ctx);
    const body = $('[data-ct-body]', root);
    const redraw = () => { body.innerHTML = ctList(); };
    $('[data-ct-q]', root).addEventListener('input', (e) => { ctState.q = e.target.value; redraw(); });
    $('[data-ct-filter]', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { ctState.filter = b.dataset.f; redraw(); } });

    // ledger ↔ rows: hovering a project lights it up in both places
    const ledger = $('[data-ledger]', root);
    const focus = (pid) => {
      ledger.classList.toggle('is-dim', !!pid);
      $$('[data-seg]', ledger).forEach((s) => s.classList.toggle('is-hot', s.dataset.seg === pid));
      body.classList.toggle('is-focus', !!pid);
      $$('tr[data-proj]', body).forEach((r) => r.classList.toggle('is-hot', r.dataset.proj === pid));
    };
    root.addEventListener('mouseover', (e) => {
      const seg = e.target.closest('[data-seg],[data-seg-key]');
      const row = e.target.closest('tr[data-proj]');
      focus(seg ? seg.dataset.seg || seg.dataset.segKey : row && ctState.grouped ? row.dataset.proj : null);
    });
    root.addEventListener('mouseleave', () => focus(null));

    App.on('stats', () => {
      for (const c of DB.containers) {
        if (!ctRunning(c)) continue;
        const cpu = $(`[data-cpu="${c.name}"]`, root), mem = $(`[data-mem="${c.name}"]`, root);
        if (cpu) cpu.textContent = fmt.pct(c.cpu);
        if (mem) mem.textContent = fmt.mb(c.memMB);
      }
      const d = ledgerData();
      d.segs.forEach((s) => { const e = $(`[data-legend-mb="${s.id}"]`, root); if (e) e.textContent = fmt.mb(s.mb); const p = $(`[data-proj-mem="${s.id}"]`, root); if (p && p.textContent) p.textContent = fmt.mb(s.mb); });
    });
  },
});

function ctBulk() {
  const n = ctState.selected.size;
  return `<b class="ink">${n} selected</b><span class="vsep"></span>
    <button class="btn btn-ghost btn-sm" data-act="bulk" data-arg="start">${icon('player-play', 'sm')}Start</button>
    <button class="btn btn-ghost btn-sm" data-act="bulk" data-arg="stop">${icon('player-stop', 'sm')}Stop</button>
    <button class="btn btn-ghost btn-sm" data-act="bulk" data-arg="restart">${icon('refresh', 'sm')}Restart</button>
    <button class="btn btn-danger-ghost btn-sm" data-act="bulk" data-arg="delete">${icon('trash', 'sm')}Delete</button>
    <button class="btn btn-ghost btn-icon btn-sm" data-act="bulk" data-arg="clear" data-tip="Clear selection" data-kbd="esc">${icon('x')}</button>`;
}
function ctPaintSelection() {
  const bar = $('[data-ct-bulk]');
  if (!bar) return;
  bar.innerHTML = ctBulk(); bar.classList.toggle('is-on', ctState.selected.size > 0);
  $$('tr.ct-row').forEach((r) => { const on = ctState.selected.has(r.dataset.name); r.classList.toggle('is-selected', on); $('.check', r).checked = on; });
  const all = $('[data-act="ct-select-all"]');
  if (all) { all.checked = ctState.selected.size === DB.containers.length; all.indeterminate = ctState.selected.size > 0 && !all.checked; }
}

const ctFind = (name) => DB.containers.find((c) => c.name === name);
function ctStart(c) { c.state = 'running'; c.exitCode = 0; c.error = null; c.started = Date.now(); c.cpu = c._baseCpu || 0.5; c.memMB = c._baseMem || 64; }
function ctStop(c) { c.state = 'exited'; c.exitCode = 0; c.finished = Date.now(); }

App.act('ct-select', (el, name, e) => { e.stopPropagation(); ctState.selected.has(name) ? ctState.selected.delete(name) : ctState.selected.add(name); ctPaintSelection(); });
App.act('ct-select-all', (el) => { ctState.selected = el.checked ? new Set(DB.containers.map((c) => c.name)) : new Set(); ctPaintSelection(); });
App.act('ct-collapse', (el, pid) => { ctState.collapsed.has(pid) ? ctState.collapsed.delete(pid) : ctState.collapsed.add(pid); $('[data-ct-body]').innerHTML = ctList(); });
App.act('ct-clear-q', () => { ctState.q = ''; App.rerender(); });
App.act('ct-toggle', (el, name) => {
  const c = ctFind(name);
  if (ctRunning(c)) { ctStop(c); toast({ title: `Stopped ${name}`, body: `${fmt.mb(c._baseMem || 0)} back to the engine`, actionLabel: 'Undo', action: () => { ctStart(c); App.rerender(); } }); }
  else { ctStart(c); toast({ title: `Started ${name}`, body: c.domain, tone: 'ok' }); }
  App.rerender();
});
App.act('ct-restart', (el, name) => { const c = ctFind(name); ctStart(c); App.rerender(); toast({ title: `Restarted ${name}`, tone: 'ok' }); });
App.act('ct-delete', (el, name) => confirmSheet({
  title: `Delete ${name}?`, body: `The container and its writable layer are removed. Volumes${ctFind(name).project ? '' : ' it uses'} are kept. This can't be undone.`, action: 'Delete container',
  onConfirm() { DB.containers.splice(DB.containers.indexOf(ctFind(name)), 1); App.go('/containers'); toast({ title: `Deleted ${name}` }); },
}));
App.act('ct-open-data', (el, name) => { const conn = DB.connections.find((c) => c.container === name); App.go(conn ? '/data/' + conn.id : '/data'); });
App.act('ct-fix-port', (el, name) => { const c = ctFind(name); ctStart(c); c.ports = [{ host: 12112, ctr: 12111 }]; c._baseCpu = 0.2; c._baseMem = 18; c.cpu = .2; c.memMB = 18; App.rerender(); toast({ title: `${name} is running on localhost:12112`, body: 'Port 12111 is held by a process on your Mac (node, PID 48121).', tone: 'ok' }); });
App.act('bulk', (el, op) => {
  const names = [...ctState.selected];
  if (op === 'clear') { ctState.selected.clear(); return ctPaintSelection(); }
  if (op === 'delete') return confirmSheet({ title: `Delete ${names.length} containers?`, body: `${names.join(', ')} will be removed. Volumes are kept.`, action: `Delete ${names.length} containers`, onConfirm() { DB.containers = DB.containers.filter((c) => !ctState.selected.has(c.name)); ctState.selected.clear(); App.rerender(); toast({ title: `Deleted ${names.length} containers` }); } });
  names.forEach((n) => { const c = ctFind(n); op === 'stop' ? ctStop(c) : ctStart(c); });
  ctState.selected.clear(); App.rerender();
  toast({ title: `${{ start: 'Started', stop: 'Stopped', restart: 'Restarted' }[op]} ${names.length} containers`, tone: 'ok' });
});
['start', 'stop', 'restart'].forEach((op) => App.act('proj-' + op, (el, pid) => {
  DB.containers.filter((c) => c.project === pid).forEach((c) => (op === 'stop' ? ctStop(c) : ctStart(c)));
  App.rerender(); toast({ title: `${{ start: 'Started', stop: 'Stopped', restart: 'Restarted' }[op]} ${pid}`, body: op === 'stop' ? 'Memory returned to macOS within a few seconds' : '', tone: op === 'stop' ? '' : 'ok' });
}));
App.act('proj-logs', (el, pid) => App.go(`/containers/${DB.containers.find((c) => c.project === pid).name}/logs?project=1`));

App.menu('container', (el) => {
  const c = ctFind(el.dataset.name), on = ctRunning(c);
  return [
    { label: 'Open', icon: 'arrow-up-right', run: () => App.go('/containers/' + c.name) },
    { label: 'Logs', icon: 'file-text', run: () => App.go(`/containers/${c.name}/logs`) },
    { label: 'Terminal', icon: 'terminal-2', disabled: !on, run: () => App.go(`/containers/${c.name}/terminal`) },
    { label: 'Files', icon: 'folder', run: () => App.go(`/containers/${c.name}/files`) },
    ...(c.db ? [{ label: 'Open in Data', icon: 'cx-data', run: () => App.actions['ct-open-data'](null, c.name) }] : []),
    { sep: true },
    ...(c.ports[0] ? [{ label: `Open localhost:${c.ports[0].host}`, icon: 'external-link' }] : []),
    { label: 'Copy domain', icon: 'cx-domain', run: () => { navigator.clipboard?.writeText(c.domain).catch(() => {}); toast({ title: 'Copied', body: c.domain, ic: 'copy' }); } },
    { label: 'Copy ID', icon: 'copy', run: () => toast({ title: 'Copied', body: c.id, ic: 'copy' }) },
    { sep: true },
    on ? { label: 'Stop', icon: 'player-stop', act: 'ct-toggle', arg: c.name } : { label: 'Start', icon: 'player-play', act: 'ct-toggle', arg: c.name },
    { label: 'Restart', icon: 'refresh', act: 'ct-restart', arg: c.name },
    { label: on ? 'Pause' : 'Pause', icon: 'player-pause', disabled: !on },
    { sep: true },
    { label: 'Rename…', icon: 'pencil' },
    { label: 'Recreate', icon: 'rotate-clockwise-2' },
    { label: 'Commit to image…', icon: 'stack-push' },
    { label: 'Export filesystem…', icon: 'file-export' },
    { sep: true },
    { label: 'Delete…', icon: 'trash', danger: true, act: 'ct-delete', arg: c.name },
  ];
});
App.menu('project', (el) => {
  const pid = el.dataset.id, p = DB.projects.find((x) => x.id === pid);
  return [
    { heading: `${p.path}/compose.yaml` },
    { label: 'Open compose.yaml', icon: 'file-code' },
    { label: 'Reveal in Finder', icon: 'folder-open' },
    { label: 'Combined logs', icon: 'file-text', act: 'proj-logs', arg: pid },
    { sep: true },
    { label: 'Pull latest images', icon: 'download' },
    { label: 'Rebuild and restart', icon: 'hammer' },
    { label: 'Restart', icon: 'refresh', act: 'proj-restart', arg: pid },
    { sep: true },
    { label: 'Delete project…', icon: 'trash', danger: true, run: () => confirmSheet({ title: `Delete ${pid}?`, body: `${DB.containers.filter((c) => c.project === pid).length} containers and the ${pid}_default network are removed. Named volumes stay unless you delete them too.`, action: `Delete ${pid}` }) },
  ];
});
App.menu('ct-view', () => [
  { heading: 'Group' },
  { label: 'By Compose project', checked: ctState.grouped, run: () => { ctState.grouped = true; App.rerender(); } },
  { label: 'No grouping', checked: !ctState.grouped, run: () => { ctState.grouped = false; App.rerender(); } },
  { sep: true },
  { label: 'Remove stopped containers…', icon: 'trash', run: () => confirmSheet({ title: 'Remove 5 stopped containers?', body: 'analytics-prometheus, minio, payments-mock, mongo-sandbox and one more are removed. Their volumes stay.', action: 'Remove 5 containers' }) },
]);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ctState.selected.size && App.route.name === 'containers') { ctState.selected.clear(); ctPaintSelection(); } });
