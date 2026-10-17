// Linux machines: full distros running as lightweight system containers inside the engine.
const machFace = (m, size = '') => tile({ ...m, mono: m.mono || (m.icon ? '' : m.distro.slice(0, 2)) }, size, m.state === 'running' ? '' : 'is-off');
const sshCmd = (m) => `ssh ${m.name}@containeria`;

App.view('machines', {
  title: 'Linux machines',
  get flush() { return !!App.parse().params[0]; },
  crumbs: ({ params }) => params[0] ? `<a href="#/machines" data-go="/machines">Linux machines</a>${icon('chevron-right')}<b>${params[0] === 'engine' ? 'Engine VM' : esc(params[0])}</b>` : '<b>Linux machines</b>',
  render(ctx) {
    if (ctx.params[0] === 'engine') return engineShell();
    if (ctx.params[0]) return machineDetail(ctx.params[0], ctx.query.tab || 'overview');
    const ms = DB.machines, on = ms.filter((m) => m.state === 'running');
    if (!ms.length) return `<div class="empty" style="padding-top:96px">${tile({ icon: 'cx-machine', th: 255 }, 'tile-xl')}<h2 class="h-sec">No Linux machines yet</h2><p>A full Ubuntu, Debian, Fedora or Arch system that boots in about a second and shares your Mac’s files.</p><button class="btn btn-brand btn-lg" data-act="new-machine">${icon('plus')}New machine</button></div>`;
    return `
      <div class="page-head"><h1 class="h-page">Linux machines</h1><button class="btn btn-brand" data-act="new-machine">${icon('plus')}New machine</button></div>
      <section class="rs-answer"><p class="rs-lede">${on.length} of ${ms.length} running, using <b class="ink num">${fmt.mb(on.reduce((a, m) => a + m.memMB, 0))}</b>. Each one mounts your Mac home at <code class="mono">/Users/mannobeats</code> and answers at <code class="mono">&lt;name&gt;.${DB.engine.domain}</code>.</p></section>
      <div class="mach-grid">
        ${ms.map((m) => `<article class="mach-card ${m.state === 'running' ? '' : 'is-off'}" data-go="/machines/${esc(m.name)}" data-ctx="machine" data-id="${esc(m.name)}" tabindex="0">
          <div class="row">${machFace(m, 'tile-lg')}<div class="col grow" style="gap:1px"><b class="ink truncate" style="font-size:var(--t-14);font-weight:600">${esc(m.name)}</b><span class="meta">${esc(m.distro)} ${esc(m.version)}</span></div>
            <button class="btn btn-ghost btn-icon btn-sm" data-menu="machine" data-id="${esc(m.name)}" data-align="end" data-tip="More">${icon('dots')}</button></div>
          <dl class="mach-kv">
            <dt>State</dt><dd>${m.state === 'running' ? `<span class="row gap-4">${icon('player-play', 'sm ok-ink')}Up ${fmt.dur(m.started)}</span>` : '<span class="ink-3">Stopped</span>'}</dd>
            <dt>Arch</dt><dd>${m.arch === 'amd64' ? `<span data-tip="Runs x86-64 binaries on Apple silicon through Rosetta">amd64 · Rosetta</span>` : 'arm64'}</dd>
            <dt>IP</dt><dd><code class="mono-sm">${esc(m.ip)}</code></dd>
            <dt>Disk</dt><dd class="num">${m.diskGB} GB</dd>
            ${m.state === 'running' ? `<dt>Usage</dt><dd class="num">${fmt.pct(m.cpu)} CPU · ${fmt.mb(m.memMB)}</dd>` : ''}
          </dl>
          <button class="mach-ssh" data-copy="${esc(sshCmd(m))}" data-tip="Copy ssh command">${icon('terminal', 'sm')}<code class="mono-sm truncate">${esc(sshCmd(m))}</code>${icon('copy', 'sm')}</button>
          <div class="row mach-actions">
            ${m.state === 'running'
              ? `<button class="btn btn-sm" data-go="/machines/${esc(m.name)}?tab=terminal">${icon('terminal-2', 'sm')}Terminal</button><button class="btn btn-sm" data-go="/machines/${esc(m.name)}?tab=files">${icon('folder', 'sm')}Files</button><button class="btn btn-ghost btn-sm right" data-act="machine-stop" data-arg="${esc(m.name)}">${icon('player-stop', 'sm')}Stop</button>`
              : `<button class="btn btn-sm" data-act="machine-start" data-arg="${esc(m.name)}">${icon('player-play', 'sm')}Start</button>`}
          </div>
        </article>`).join('')}
        <button class="mach-card mach-new" data-act="new-machine">${icon('plus', 'lg')}<b>New machine</b><span class="meta">Ubuntu, Debian, Fedora, Arch and 5 more</span></button>
      </div>`;
  },
  mount(root, ctx) {
    mountTerminal(root); mountFiles(root);
    if (ctx.params[0] && ctx.params[0] !== 'engine' && (ctx.query.tab || 'overview') === 'overview') {
      const m = DB.machines.find((x) => x.name === ctx.params[0]);
      const c = $('[data-mchart="cpu"]', root), mm = $('[data-mchart="mem"]', root);
      if (m && m.state === 'running' && c) {
        chart(c, { series: [{ label: 'CPU', color: '--s1' }], data: series(60, 5, wave(m.cpu, m.cpu * 0.8)), height: 120, yFmt: (v) => fmt.pct(v) });
        chart(mm, { series: [{ label: 'Memory', color: '--s4' }], data: series(60, 5, wave(m.memMB, m.memMB * 0.08)), height: 120, yFmt: (v) => fmt.mb(v) });
      }
    }
  },
});

App.menu('machine', (el) => {
  const m = DB.machines.find((x) => x.name === el.dataset.id), on = m.state === 'running';
  return [
    on ? { label: 'Open terminal', icon: 'terminal-2', run: () => App.go(`/machines/${m.name}?tab=terminal`) } : { label: 'Start', icon: 'player-play', act: 'machine-start', arg: m.name },
    { label: 'Browse files', icon: 'folder', run: () => App.go(`/machines/${m.name}?tab=files`) },
    { label: 'Open in Terminal.app', icon: 'external-link', disabled: !on, run: () => toast({ title: `Opening ${sshCmd(m)}`, ic: 'terminal' }) },
    { label: 'Open in VS Code', icon: 'code', disabled: !on, run: () => toast({ title: 'Opening Remote SSH in VS Code', body: m.name, ic: 'code' }) },
    { label: 'Copy ssh command', icon: 'copy', run: () => { navigator.clipboard?.writeText(sshCmd(m)).catch(() => {}); toast({ title: 'Copied', body: sshCmd(m), ic: 'copy' }); } },
    { sep: true },
    on ? { label: 'Restart', icon: 'refresh', run: () => toast({ title: `Restarting ${m.name}`, ic: 'refresh' }) } : null,
    on ? { label: 'Stop', icon: 'player-stop', act: 'machine-stop', arg: m.name } : null,
    { label: 'Clone…', icon: 'copy-plus', run: () => toast({ title: `Cloning ${m.name}`, body: `${m.diskGB} GB copied with copy-on-write, takes under a second` }) },
    { label: 'Export as .tar.zst…', icon: 'file-export', run: () => toast({ title: `Exporting ${m.name}`, body: `~/Downloads/${m.name}.tar.zst` }) },
    { sep: true },
    { label: 'Delete machine', icon: 'trash', danger: true, act: 'machine-delete', arg: m.name },
  ].filter(Boolean);
});
App.act('machine-start', (el, n) => {
  const m = DB.machines.find((x) => x.name === n);
  el?.classList.add('is-loading');
  setTimeout(() => { Object.assign(m, { state: 'running', started: Date.now(), cpu: 0.6, memMB: 96, ip: '198.19.249.' + (30 + DB.machines.indexOf(m)) }); App.rerender(); toast({ title: `${n} started in 0.9 s`, tone: 'ok' }); }, 700);
});
App.act('machine-stop', (el, n) => {
  const m = DB.machines.find((x) => x.name === n);
  Object.assign(m, { state: 'stopped', cpu: 0, memMB: 0 }); App.rerender();
  toast({ title: `Stopped ${n}`, body: 'Its memory went back to macOS', actionLabel: 'Undo', action: () => App.actions['machine-start'](null, n) });
});
App.act('machine-delete', (el, n) => {
  const m = DB.machines.find((x) => x.name === n);
  confirmSheet({ title: `Delete ${n}?`, body: `Its ${m.diskGB} GB disk, installed packages and everything in <code class="mono-sm">/home/${esc(m.user)}</code> are deleted and can’t be recovered. Files in your Mac home aren’t touched.`, action: 'Delete machine', onConfirm() { DB.machines.splice(DB.machines.indexOf(m), 1); App.go('/machines'); toast({ title: `Deleted ${n}`, body: `${m.diskGB} GB freed`, tone: 'ok' }); } });
});

/* new machine sheet */
App.act('new-machine', () => {
  let d = DB.distros[0];
  sheet({
    title: 'New Linux machine', width: 600,
    body: `<div class="col gap-16">
      <div class="field"><span class="label">Distribution</span><div class="distro-grid" role="radiogroup">${DB.distros.map((x, i) => `<button class="distro-opt ${i === 0 ? 'is-on' : ''}" role="radio" aria-checked="${i === 0}" data-d="${i}">${tile(x, 'tile-lg')}<b>${esc(x.name)}</b><span class="meta">${esc(x.versions[0])}</span></button>`).join('')}</div></div>
      <div class="rs-opts-grid">
        <div class="field"><span class="label">Version</span><select class="select" data-ver></select></div>
        <div class="field"><span class="label">Name</span><input class="input mono" data-name value="ubuntu"><span class="hint" data-host>ubuntu.${DB.engine.domain}</span></div>
      </div>
      <div class="field"><span class="label">Architecture</span><div class="seg" data-arch><button aria-pressed="true">arm64 · native</button><button aria-pressed="false">amd64 · Rosetta</button></div><span class="hint">Pick amd64 only for software that has no ARM build. Rosetta runs it at about 80% native speed.</span></div>
      <div class="rs-opts-grid">
        <div class="field"><span class="label">Username</span><input class="input mono" value="mannobeats"><span class="hint">Same as your Mac, with passwordless sudo</span></div>
        <div class="field"><span class="label">Disk</span><input class="input" value="Grows as needed, up to 64 GB" disabled></div>
      </div>
      <label class="row"><span class="switch"><input type="checkbox" checked><span></span></span><span class="grow">Mount my Mac home folder <span class="meta">read and write at /Users/mannobeats</span></span></label>
      <label class="row"><span class="switch"><input type="checkbox" checked><span></span></span><span class="grow">Start with the engine</span></label>
      <details class="rs-details"><summary>${icon('chevron-right', 'sm')}Cloud-init <span class="meta">optional</span></summary><textarea class="textarea mono" rows="6" spellcheck="false" style="margin-top:8px">#cloud-config\npackages:\n  - build-essential\n  - git\nruncmd:\n  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -</textarea></details>
    </div>`,
    foot: `<span class="meta">Downloads about 120 MB once, then boots in about a second.</span><div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Create machine</button></div>`,
    onMount(s, close) {
      const ver = $('[data-ver]', s), name = $('[data-name]', s), host = $('[data-host]', s);
      const slug = (x) => x.name.toLowerCase().split(' ')[0];
      const fill = () => { ver.innerHTML = d.versions.map((v) => `<option>${esc(v)}</option>`).join(''); if (!name.dataset.touched) name.value = DB.machines.some((m) => m.name === slug(d)) ? slug(d) + '-2' : slug(d); host.textContent = `${name.value}.${DB.engine.domain}`; };
      $('.distro-grid', s).addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; d = DB.distros[+b.dataset.d]; $$('.distro-opt', s).forEach((o) => { o.classList.toggle('is-on', o === b); o.setAttribute('aria-checked', o === b); }); fill(); });
      name.addEventListener('input', () => { name.dataset.touched = 1; const v = name.value.trim(), bad = !/^[a-z][a-z0-9-]{0,30}$/.test(v), dup = DB.machines.some((m) => m.name === v); name.classList.toggle('is-error', bad || dup); host.textContent = dup ? 'A machine with this name exists' : bad ? 'Lowercase letters, numbers and dashes' : `${v}.${DB.engine.domain}`; host.className = bad || dup ? 'err' : 'hint'; $('[data-ok]', s).disabled = bad || dup; });
      fill();
      $('[data-ok]', s).onclick = () => {
        const btn = $('[data-ok]', s), amd = $('[data-arch] button[aria-pressed="true"]', s).textContent.startsWith('amd');
        btn.classList.add('is-loading'); btn.innerHTML = `${icon('loader-2')}Downloading ${esc(d.name)}…`;
        setTimeout(() => {
          const n = name.value.trim();
          DB.machines.push({ name: n, distro: d.name, version: ver.value, icon: d.icon, mono: d.mono, th: d.th, arch: amd ? 'amd64' : 'arm64', state: 'running', cpu: 0.8, memMB: 88, diskGB: 1.1, ip: '198.19.249.' + (40 + DB.machines.length), user: 'mannobeats', started: Date.now(), domain: `${n}.${DB.engine.domain}`, rosetta: amd });
          close(); App.go(`/machines/${n}?tab=terminal`); toast({ title: `${n} is ready`, body: `${d.name} ${ver.value} booted in 1.1 s`, tone: 'ok' });
        }, 1600);
      };
    },
  });
});

/* machine detail */
function machineDetail(name, tab) {
  const m = DB.machines.find((x) => x.name === name);
  if (!m) return `<div class="empty">${icon('device-desktop-off', 'xl')}<h2 class="h-sec">${esc(name)} was deleted</h2><button class="btn" data-go="/machines">All machines</button></div>`;
  const on = m.state === 'running', base = `/machines/${m.name}`;
  const off = (what) => `<div class="empty">${machFace(m, 'tile-xl')}<h2 class="h-sec">${esc(m.name)} is stopped</h2><p>Start it to use the ${what}. It boots in about a second.</p><button class="btn btn-brand" data-act="machine-start" data-arg="${esc(m.name)}">${icon('player-play')}Start ${esc(m.name)}</button></div>`;
  const body = {
    overview: () => `<div class="rs-cols">
      <section class="col gap-24">
        ${on ? `<div class="rs-sec"><h2 class="h-sub">CPU <span class="meta num">${fmt.pct(m.cpu)}</span></h2><div data-mchart="cpu" class="rs-chart"></div></div><div class="rs-sec"><h2 class="h-sub">Memory <span class="meta num">${fmt.mb(m.memMB)}</span></h2><div data-mchart="mem" class="rs-chart"></div></div>` : `<div class="banner">${icon('player-stop')}<span class="grow">Stopped. It uses no CPU or memory until you start it.</span><button class="btn btn-sm" data-act="machine-start" data-arg="${esc(m.name)}">Start</button></div>`}
        <div class="rs-sec"><h2 class="h-sub">Connect</h2><div class="col gap-12" style="margin-top:8px">
          <button class="mach-ssh" data-copy="${esc(sshCmd(m))}">${icon('terminal', 'sm')}<code class="mono-sm grow">${esc(sshCmd(m))}</code>${icon('copy', 'sm')}</button>
          <button class="mach-ssh" data-copy="containeria shell ${esc(m.name)}">${icon('terminal', 'sm')}<code class="mono-sm grow">containeria shell ${esc(m.name)}</code>${icon('copy', 'sm')}</button>
          <pre class="code selectable"># ~/.ssh/config is set up for you\nHost ${esc(m.name)}\n  HostName ${esc(m.domain)}\n  User ${esc(m.user)}\n  IdentityFile ~/.containeria/ssh/id_ed25519</pre></div></div>
      </section>
      <aside class="rs-sec"><h2 class="h-sub">Details</h2><dl class="kv">
        <dt>Distribution</dt><dd>${esc(m.distro)} ${esc(m.version)}</dd><dt>Architecture</dt><dd>${m.arch === 'amd64' ? 'amd64 via Rosetta' : 'arm64'}</dd>
        <dt>State</dt><dd>${on ? `Up ${fmt.dur(m.started)}` : 'Stopped'}</dd><dt>IP address</dt><dd><code class="mono-sm">${esc(m.ip)}</code></dd>
        <dt>Domain</dt><dd><code class="mono-sm truncate">${esc(m.domain)}</code><button class="btn btn-ghost btn-icon btn-sm" data-copy="${esc(m.domain)}" data-tip="Copy">${icon('copy', 'sm')}</button></dd>
        <dt>User</dt><dd>${esc(m.user)} <span class="meta">sudo, no password</span></dd><dt>Disk</dt><dd class="num">${m.diskGB} GB of 64 GB</dd>
        <dt>Mac home</dt><dd><code class="mono-sm">/Users/mannobeats</code></dd><dt>Files on Mac</dt><dd><code class="mono-sm truncate">~/Containeria/machines/${esc(m.name)}</code></dd></dl></aside>
    </div>`,
    terminal: () => on ? terminalPane({ user: m.user, host: m.name, cwd: '~', shell: 'bash', note: `${esc(m.distro)} ${esc(m.version)} · ${m.arch}${m.arch === 'amd64' ? ' via Rosetta' : ''} · Mac home mounted at /Users/mannobeats`, lines: [{ cmd: 'uname -m', out: m.arch === 'amd64' ? 'x86_64' : 'aarch64' }, { cmd: 'ls', out: '<span class="term-dir">projects</span>  <span class="term-dir">Mac</span>  setup.sh' }] }) : off('terminal'),
    files: () => filesPane({ ...fakeFS['linux-home'], finder: `~/Containeria/machines/${m.name}` }),
    settings: () => `<div class="page" style="max-width:640px">
      <div class="field-row"><span class="label">Name</span><div class="field"><input class="input mono" value="${esc(m.name)}"><span class="hint">Changing it also changes the domain and ssh host.</span></div></div>
      <div class="field-row"><span class="label">Default user</span><div class="field"><input class="input mono" value="${esc(m.user)}"></div></div>
      <div class="field-row"><span class="label">Mac home folder</span><div class="row"><span class="switch"><input type="checkbox" checked><span></span></span><span class="meta">Mounted at /Users/mannobeats</span></div></div>
      <div class="field-row"><span class="label">Start with the engine</span><div class="row"><span class="switch"><input type="checkbox" ${on ? 'checked' : ''}><span></span></span></div></div>
      <div class="field-row"><span class="label">Rosetta</span><div class="row"><span class="switch"><input type="checkbox" ${m.arch === 'amd64' ? 'checked disabled' : 'checked'}><span></span></span><span class="meta">${m.arch === 'amd64' ? 'Required for amd64 machines' : 'Run x86-64 binaries inside this arm64 machine'}</span></div></div>
      <div class="field-row"><span class="label">Delete</span><div class="field"><div><button class="btn btn-danger-ghost" data-act="machine-delete" data-arg="${esc(m.name)}" style="box-shadow:inset 0 0 0 .5px var(--bad)">${icon('trash')}Delete ${esc(m.name)}</button></div><span class="hint">Removes its ${m.diskGB} GB disk. Your Mac home isn’t touched.</span></div></div>
    </div>`,
  };
  return `${rsHead({
    face: machFace(m, 'tile-lg'), title: m.name,
    meta: `<span>${esc(m.distro)} ${esc(m.version)}</span><span>${m.arch === 'amd64' ? 'amd64 · Rosetta' : 'arm64'}</span>${on ? `<span>Up ${fmt.dur(m.started)}</span><span class="mono-sm">${esc(m.ip)}</span>` : '<span>Stopped</span>'}`,
    actions: on ? `<button class="btn" data-act="machine-stop" data-arg="${esc(m.name)}">${icon('player-stop')}Stop</button><button class="btn" data-copy="${esc(sshCmd(m))}" data-tip="Copy ssh command">${icon('terminal')}SSH</button><button class="btn btn-ghost btn-icon" data-menu="machine" data-id="${esc(m.name)}" data-align="end" data-tip="More">${icon('dots')}</button>`
      : `<button class="btn btn-brand" data-act="machine-start" data-arg="${esc(m.name)}">${icon('player-play')}Start</button><button class="btn btn-ghost btn-icon" data-menu="machine" data-id="${esc(m.name)}" data-align="end" data-tip="More">${icon('dots')}</button>`,
  })}
  ${rsTabs(base, [['overview', 'Overview'], ['terminal', 'Terminal'], ['files', 'Files'], ['settings', 'Settings']], tab)}
  <div class="rs-fill ${tab === 'overview' || tab === 'settings' ? 'is-scroll' : ''}">${(body[tab] || body.overview)()}</div>`;
}

/* the engine VM itself */
function engineShell() {
  const e = DB.engine;
  return `${rsHead({
    face: engineMark(36), title: 'Engine VM',
    meta: `<span>Containeria Linux ${esc(e.version)}</span><span>Kernel ${esc(e.kernel)}</span><span>${e.cpus} CPUs · ${e.memGB} GB</span><span>Up ${fmt.dur(e.uptime)}</span>`,
    actions: `<button class="btn" data-act="engine-restart">${icon('refresh')}Restart engine</button><button class="btn" data-go="/settings/engine">${icon('adjustments')}Settings</button>`,
  })}
  <div style="padding:0 20px 12px"><div class="banner banner-warn">${icon('alert-triangle')}<span class="grow">This is the VM that runs Docker, Kubernetes and your machines. Changes outside <code class="mono-sm">/var/lib</code> are reset on the next engine update.</span></div></div>
  <div class="rs-fill rs-bordered">${terminalPane({ user: 'root', host: 'containeria', cwd: '/', note: 'Engine shell · Alpine-based, read-only root', lines: [{ cmd: 'free -m', out: '              total   used   free  shared  buff/cache  available\nMem:           8192   3184   2612      14        2396       4791' }, { cmd: 'rc-status', out: ' containerd     [ started ]\n docker         [ started ]\n k3s            [ started ]\n containeria-dns [ started ]' }] })}</div>`;
}
