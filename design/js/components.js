// Shared panes used by containers, pods, machines and volumes: terminal, files, logs.

/* ---------- terminal ---------- */
// terminalPane({ user, host, cwd, shell, lines: [{ cmd, out }], note }) → html; mountTerminal(rootEl)
function terminalPane({ user = 'root', host = 'container', cwd = '/', shell = 'sh', lines = [], note = '' } = {}) {
  const prompt = (c) => `<span class="term-ps"><span class="term-user">${esc(user)}@${esc(host)}</span>:<span class="term-cwd">${esc(c)}</span>${user === 'root' ? '#' : '$'}</span>`;
  return `<div class="term" data-term data-user="${esc(user)}" data-host="${esc(host)}" data-cwd="${esc(cwd)}" data-shell="${esc(shell)}" tabindex="0" aria-label="Terminal">
    <div class="term-scroll selectable">${note ? `<div class="term-note">${note}</div>` : ''}${lines.map((l) => `<div>${prompt(l.cwd || cwd)} ${esc(l.cmd)}</div>${l.out ? `<div class="term-out">${l.out}</div>` : ''}`).join('')}
      <div class="term-line">${prompt(cwd)} <span class="term-input" contenteditable="true" spellcheck="false" aria-label="Command"></span></div>
    </div></div>`;
}
const termCmds = {
  help: () => 'Try: ls, pwd, whoami, ps, env, uname -a, df -h, clear',
  pwd: (t) => t.dataset.cwd,
  whoami: (t) => t.dataset.user,
  'uname -a': () => `Linux ${'containeria'} 6.12.8-containeria #1 SMP PREEMPT aarch64 GNU/Linux`,
  ls: () => '<span class="term-dir">bin</span>  <span class="term-dir">etc</span>  <span class="term-dir">app</span>  <span class="term-dir">home</span>  <span class="term-dir">usr</span>  <span class="term-dir">var</span>  package.json  go.mod',
  ps: () => 'PID   USER     TIME  COMMAND\n    1 root      0:04 air -c .air.toml\n   18 root      0:31 /tmp/bin/api\n   97 root      0:00 sh\n  104 root      0:00 ps',
  env: () => 'HOSTNAME=8b21de90a1f3\nPATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin\nDATABASE_URL=postgres://shop:••••••@postgres:5432/shop\nREDIS_URL=redis://redis:6379/0\nGOPATH=/go',
  'df -h': () => 'Filesystem      Size  Used Avail Use% Mounted on\noverlay         118G   42G   76G  36% /\ntmpfs            64M     0   64M   0% /dev\n/mnt/mac        926G  512G  414G  56% /app',
};
function mountTerminal(root) {
  $$('[data-term]', root).forEach((t) => {
    const input = $('.term-input', t), scroll = $('.term-scroll', t);
    t.addEventListener('click', () => { if (!getSelection().toString()) placeCaret(input); });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const cmd = input.textContent.trim();
      const line = input.parentElement;
      const echo = document.createElement('div');
      echo.innerHTML = line.innerHTML.replace(/<span class="term-input"[^>]*>.*<\/span>/, esc(cmd));
      line.before(echo);
      if (cmd === 'clear') { $$(':scope > div:not(.term-line)', scroll).forEach((d) => d.remove()); }
      else if (cmd) {
        const out = document.createElement('div'); out.className = 'term-out';
        out.innerHTML = termCmds[cmd]?.(t) ?? `${esc(t.dataset.shell)}: ${esc(cmd.split(' ')[0])}: command not found`;
        line.before(out);
      }
      input.textContent = '';
      scroll.scrollTop = scroll.scrollHeight;
    });
    setTimeout(() => { scroll.scrollTop = scroll.scrollHeight; }, 0);
  });
}
function placeCaret(el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

/* ---------- files ---------- */
// filesPane({ path, entries: [{ name, dir, size, modified, mode }], preview: { name, text, lang } , finder }) → html; mountFiles(rootEl)
const fakeFS = {
  'node-app': { path: '/app', entries: [
    { name: '.next', dir: true, modified: '12:06' }, { name: 'node_modules', dir: true, modified: 'Oct 5' }, { name: 'public', dir: true, modified: 'Oct 11' }, { name: 'src', dir: true, modified: '11:52' },
    { name: '.env.local', size: '412 B', modified: 'Oct 14', mode: '-rw-------' }, { name: 'next.config.ts', size: '1.1 KB', modified: 'Oct 9', mode: '-rw-r--r--' },
    { name: 'package.json', size: '2.3 KB', modified: 'Oct 12', mode: '-rw-r--r--' }, { name: 'pnpm-lock.yaml', size: '284 KB', modified: 'Oct 12', mode: '-rw-r--r--' }, { name: 'tsconfig.json', size: '640 B', modified: 'Sep 30', mode: '-rw-r--r--' },
  ], preview: { name: 'package.json', text: '{\n  "name": "shop-web",\n  "private": true,\n  "scripts": {\n    "dev": "next dev --turbo",\n    "build": "next build",\n    "start": "next start"\n  },\n  "dependencies": {\n    "next": "15.1.4",\n    "react": "19.0.0",\n    "react-dom": "19.0.0",\n    "@tanstack/react-query": "5.64.1"\n  }\n}' } },
  'go-app': { path: '/app', entries: [
    { name: 'cmd', dir: true, modified: 'Oct 10' }, { name: 'internal', dir: true, modified: '11:40' }, { name: 'migrations', dir: true, modified: 'Oct 8' }, { name: 'tmp', dir: true, modified: '12:04' },
    { name: '.air.toml', size: '818 B', modified: 'Sep 21', mode: '-rw-r--r--' }, { name: 'Dockerfile', size: '604 B', modified: 'Oct 2', mode: '-rw-r--r--' }, { name: 'go.mod', size: '1.4 KB', modified: 'Oct 12', mode: '-rw-r--r--' }, { name: 'go.sum', size: '18 KB', modified: 'Oct 12', mode: '-rw-r--r--' }, { name: 'main.go', size: '2.9 KB', modified: '11:40', mode: '-rw-r--r--' },
  ], preview: { name: 'main.go', text: 'package main\n\nimport (\n\t"log/slog"\n\t"net/http"\n\n\t"shop/internal/api"\n\t"shop/internal/store"\n)\n\nfunc main() {\n\tdb := store.MustOpen(env("DATABASE_URL"))\n\tdefer db.Close()\n\n\tsrv := api.New(db)\n\tslog.Info("server listening on :8080")\n\thttp.ListenAndServe(":8080", srv)\n}' } },
  'postgres-data': { path: '/var/lib/postgresql/data', entries: [
    { name: 'base', dir: true, modified: '12:07' }, { name: 'global', dir: true, modified: '12:07' }, { name: 'pg_wal', dir: true, modified: '12:09' }, { name: 'pg_stat', dir: true, modified: '09:01' }, { name: 'pg_xact', dir: true, modified: '12:07' },
    { name: 'PG_VERSION', size: '3 B', modified: 'Aug 12', mode: '-rw-------' }, { name: 'pg_hba.conf', size: '5.6 KB', modified: 'Aug 12', mode: '-rw-------' }, { name: 'postgresql.auto.conf', size: '88 B', modified: 'Aug 12', mode: '-rw-------' }, { name: 'postgresql.conf', size: '29 KB', modified: 'Aug 12', mode: '-rw-------' }, { name: 'postmaster.pid', size: '94 B', modified: '09:01', mode: '-rw-------' },
  ], preview: { name: 'postgresql.conf', text: "# Connection settings\nlisten_addresses = '*'\nmax_connections = 100\n\n# Memory\nshared_buffers = 128MB\nwork_mem = 4MB\n\n# WAL\nwal_level = replica\nmax_wal_size = 1GB\n\n# Logging\nlog_min_duration_statement = 250ms" } },
  'linux-home': { path: '/home/mannobeats', entries: [
    { name: '.cache', dir: true, modified: 'Oct 16' }, { name: '.config', dir: true, modified: 'Oct 15' }, { name: '.ssh', dir: true, modified: 'Oct 1' }, { name: 'projects', dir: true, modified: '11:58' }, { name: 'Mac', dir: true, modified: '—' },
    { name: '.bashrc', size: '3.7 KB', modified: 'Oct 1', mode: '-rw-r--r--' }, { name: '.profile', size: '807 B', modified: 'Oct 1', mode: '-rw-r--r--' }, { name: 'setup.sh', size: '1.2 KB', modified: 'Oct 2', mode: '-rwxr-xr-x' },
  ], preview: { name: 'setup.sh', text: '#!/usr/bin/env bash\nset -euo pipefail\n\nsudo apt-get update\nsudo apt-get install -y build-essential git curl\ncurl -fsSL https://sh.rustup.rs | sh -s -- -y\necho "ready"' } },
  volume: { path: '/', entries: [
    { name: 'base', dir: true, modified: '12:07' }, { name: 'global', dir: true, modified: '12:07' }, { name: 'pg_wal', dir: true, modified: '12:09' }, { name: 'pg_logical', dir: true, modified: 'Aug 12' },
    { name: 'PG_VERSION', size: '3 B', modified: 'Aug 12', mode: '-rw-------' }, { name: 'postgresql.conf', size: '29 KB', modified: 'Aug 12', mode: '-rw-------' },
  ], preview: { name: 'PG_VERSION', text: '17' } },
};
function filesPane({ path = '/', entries = [], preview, finder = '' } = {}) {
  const crumbs = path.split('/').filter(Boolean);
  return `<div class="files" data-files data-path="${esc(path)}">
    <div class="files-bar">
      <div class="files-crumbs"><button class="btn btn-ghost btn-sm" data-files-root>${icon('folder', 'sm')}/</button>${crumbs.map((c) => `${icon('chevron-right', 'sm ink-3')}<button class="btn btn-ghost btn-sm">${esc(c)}</button>`).join('')}</div>
      <div class="row right gap-4">
        <button class="btn btn-ghost btn-icon btn-sm" data-tip="New folder">${icon('folder-plus')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-tip="Upload files">${icon('upload')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-tip="Refresh">${icon('refresh')}</button>
        ${finder ? `<button class="btn btn-sm" data-copy="${esc(finder)}" data-tip="${esc(finder)}">${icon('folder-open', 'sm')}Open in Finder</button>` : ''}
      </div>
    </div>
    <div class="files-body">
      <div class="files-list" role="grid">
        <div class="files-row files-head"><span>Name</span><span>Size</span><span>Modified</span><span>Mode</span></div>
        ${path !== '/' ? `<div class="files-row" data-files-up role="row"><span class="row">${icon('corner-left-up', 'ink-3')}<span>..</span></span><span></span><span></span><span></span></div>` : ''}
        ${entries.map((e, i) => `<div class="files-row ${preview && e.name === preview.name ? 'is-selected' : ''}" role="row" tabindex="-1" draggable="true" data-file="${esc(e.name)}" data-dir="${e.dir ? 1 : ''}" data-ctx="file">
          <span class="row">${icon(e.dir ? 'folder' : fileIcon(e.name), e.dir ? 'files-dir' : 'ink-3')}<span class="truncate">${esc(e.name)}</span></span>
          <span class="num meta">${e.dir ? '—' : esc(e.size)}</span><span class="meta">${esc(e.modified)}</span><span class="mono-sm ink-3">${esc(e.mode || 'drwxr-xr-x')}</span></div>`).join('')}
      </div>
      ${preview ? `<div class="files-preview"><div class="row files-preview-head">${icon(fileIcon(preview.name), 'ink-3')}<b class="ink truncate">${esc(preview.name)}</b><button class="btn btn-ghost btn-icon btn-sm right" data-tip="Download">${icon('download')}</button><button class="btn btn-ghost btn-icon btn-sm" data-tip="Edit">${icon('pencil')}</button></div><pre class="files-code selectable">${esc(preview.text)}</pre></div>` : ''}
    </div>
    <div class="files-drop">${icon('upload', 'xl')}<b>Drop to copy into ${esc(path)}</b></div>
  </div>`;
}
function fileIcon(n) { return /\.(json|ts|js|go|toml|ya?ml|conf|sh)$/.test(n) || /^(Dockerfile|go\.mod|go\.sum)$/.test(n) ? 'file-code' : /\.(png|jpg|svg)$/.test(n) ? 'photo' : 'file'; }
function mountFiles(root) {
  $$('[data-files]', root).forEach((f) => {
    f.addEventListener('click', (e) => {
      const r = e.target.closest('.files-row[data-file]'); if (!r) return;
      $$('.files-row', f).forEach((x) => x.classList.toggle('is-selected', x === r));
    });
    f.addEventListener('dblclick', (e) => { const r = e.target.closest('.files-row[data-dir="1"]'); if (r) toast({ title: `Opening ${r.dataset.file}/`, ic: 'folder' }); });
    let depth = 0;
    f.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { depth++; f.classList.add('is-drop'); } });
    f.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; f.classList.remove('is-drop'); } });
    f.addEventListener('dragover', (e) => e.preventDefault());
    f.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; f.classList.remove('is-drop'); const n = e.dataTransfer.files.length; if (n) toast({ title: `Copied ${n} file${n > 1 ? 's' : ''} into ${f.dataset.path}`, tone: 'ok' }); });
  });
}
App.menu('file', (el) => [
  { label: 'Open', icon: 'file' }, { label: 'Download to Mac', icon: 'download' }, { label: 'Open in Finder', icon: 'folder-open' },
  { sep: true }, { label: 'Copy path', icon: 'copy', run: () => toast({ title: 'Copied', body: el.closest('[data-files]').dataset.path + '/' + el.dataset.file, ic: 'copy' }) }, { label: 'Rename', icon: 'pencil' },
  { sep: true }, { label: 'Delete', icon: 'trash', danger: true },
]);

/* ---------- logs ---------- */
// logPane({ lines: [[time, level, text]], source }) → html; mountLogs(rootEl, { live: [lines to append] })
function logLine([t, lvl, txt], q = '') {
  let body = esc(txt);
  if (q) body = body.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
  return `<div class="log is-${lvl}"><span class="log-t">${t}</span><span class="log-l">${lvl}</span><span class="log-m">${body}</span></div>`;
}
function logPane({ lines = [], source = '' } = {}) {
  const errs = lines.filter((l) => l[1] === 'error').length, warns = lines.filter((l) => l[1] === 'warn').length;
  return `<div class="logs" data-logs>
    <div class="logs-bar">
      <div class="search" style="width:240px">${icon('search')}<input class="input" placeholder="Filter logs" data-logs-q aria-label="Filter logs"><span class="kbd">/</span></div>
      <div class="seg seg-sm" data-logs-level><button aria-pressed="true" data-l="all">All</button><button aria-pressed="false" data-l="error">Errors <span class="count">${errs}</span></button><button aria-pressed="false" data-l="warn">Warnings <span class="count">${warns}</span></button></div>
      <div class="row right gap-4">
        <button class="btn btn-ghost btn-icon btn-sm is-on" data-logs-toggle="ts" data-tip="Timestamps">${icon('clock')}</button>
        <button class="btn btn-ghost btn-icon btn-sm is-on" data-logs-toggle="wrap" data-tip="Wrap lines">${icon('text-wrap')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-tip="Clear">${icon('clear-all')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-tip="Save to file">${icon('download')}</button>
        <button class="btn btn-sm is-follow" data-logs-follow>${icon('arrow-bar-to-down', 'sm')}Following</button>
      </div>
    </div>
    <div class="logs-body selectable" data-logs-body>${lines.map((l) => logLine(l)).join('')}</div>
  </div>`;
}
function mountLogs(root, { live = [] } = {}) {
  $$('[data-logs]', root).forEach((L) => {
    const body = $('[data-logs-body]', L), q = $('[data-logs-q]', L), follow = $('[data-logs-follow]', L);
    let level = 'all', following = true, all = $$('.log', body).map((d) => [d.children[0].textContent, d.children[1].textContent, d.children[2].textContent]);
    const draw = () => {
      const s = q.value.trim();
      body.innerHTML = all.filter((l) => (level === 'all' || l[1] === level) && (!s || l[2].toLowerCase().includes(s.toLowerCase()))).map((l) => logLine(l, s)).join('') || `<div class="empty" style="padding:40px">${icon('filter-off', 'lg')}<p>No lines match.</p></div>`;
      if (following) body.scrollTop = body.scrollHeight;
    };
    q.addEventListener('input', draw);
    $('[data-logs-level]', L).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { level = b.dataset.l; draw(); } });
    L.addEventListener('click', (e) => {
      const t = e.target.closest('[data-logs-toggle]');
      if (t) { t.classList.toggle('is-on'); L.classList.toggle('no-' + t.dataset.logsToggle, !t.classList.contains('is-on')); }
    });
    follow.onclick = () => { following = !following; follow.classList.toggle('is-follow', following); follow.innerHTML = following ? `${icon('arrow-bar-to-down', 'sm')}Following` : `${icon('player-pause', 'sm')}Paused`; if (following) body.scrollTop = body.scrollHeight; };
    body.addEventListener('wheel', () => { if (following && body.scrollTop + body.clientHeight < body.scrollHeight - 40) follow.click(); }, { passive: true });
    let i = 0;
    if (live.length) App.every(2200, () => {
      const l = live[i++ % live.length];
      const t = new Date().toTimeString().slice(0, 8) + '.' + String(Date.now() % 1000).padStart(3, '0');
      all.push([t, l[0], l[1]]);
      const s = q.value.trim();
      if ((level === 'all' || l[0] === level) && (!s || l[1].includes(s))) {
        body.insertAdjacentHTML('beforeend', logLine([t, l[0], l[1]], s));
        body.lastElementChild.classList.add('is-new');
        if (following) body.scrollTop = body.scrollHeight;
      }
    });
    body.scrollTop = body.scrollHeight;
  });
}
