// Images, volumes and networks. Also defines small detail-page helpers reused by kubernetes.js and machines.js.

/* ---------- shared detail helpers ---------- */
function rsHead({ face, title, meta = '', actions = '' }) {
  return `<div class="rs-head">${face}<div class="col gap-4 grow"><h1 class="h-page truncate selectable">${esc(title)}</h1><div class="rs-meta">${meta}</div></div><div class="row">${actions}</div></div>`;
}
function rsTabs(base, tabs, cur) {
  return `<div class="tabs" role="tablist">${tabs.map(([k, label, count]) => `<button class="tab" role="tab" aria-selected="${k === cur}" data-go="${base}?tab=${k}">${esc(label)}${count != null ? `<span class="count">${count}</span>` : ''}</button>`).join('')}</div>`;
}
function rsTiles(names, max = 4) {
  const cs = names.map((n) => DB.containers.find((c) => c.name === n)).filter(Boolean);
  if (!cs.length) return '<span class="ink-3">Unused</span>';
  return `<span class="rs-tiles">${cs.slice(0, max).map((c) => `<span data-tip="${esc(c.name)}">${tile(c, '', c.state === 'running' ? '' : 'is-off')}</span>`).join('')}</span>${cs.length === 1 ? `<span class="truncate">${esc(cs[0].name)}</span>` : `<span class="meta">${cs.length} containers</span>`}`;
}
// filter table rows by text and a data-f value, in place
function rsFilter(root, { attr = 'f' } = {}) {
  const q = $('.toolbar .search input', root), seg = $('[data-rs-seg]', root);
  const rows = $$('tbody tr[data-text]', root), empty = $('[data-rs-empty]', root);
  const apply = () => {
    const s = (q?.value || '').trim().toLowerCase(), f = $('button[aria-pressed="true"]', seg || document.createElement('i'))?.dataset.f || 'all';
    let n = 0;
    rows.forEach((r) => { const ok = (f === 'all' || r.dataset[attr].split(' ').includes(f)) && (!s || r.dataset.text.includes(s)); r.classList.toggle('hide', !ok); n += ok; });
    empty?.classList.toggle('hide', n > 0);
  };
  q?.addEventListener('input', apply);
  seg?.addEventListener('click', (e) => { if (e.target.closest('button')) setTimeout(apply); });
}
const rsUsers = (img) => DB.containers.filter((c) => c.image === img.repo && c.tag === img.tag);
const imgRef = (i) => (i.dangling ? i.id.slice(7, 19) : `${i.repo}:${i.tag}`);
const imgKind = (i) => (i.dangling ? 'dangling' : rsUsers(i).length ? 'used' : 'unused');

/* ---------- images ---------- */
function imageStats() {
  const sum = (a) => a.reduce((s, i) => s + i.sizeMB, 0);
  const used = DB.images.filter((i) => imgKind(i) === 'used'), unused = DB.images.filter((i) => imgKind(i) === 'unused'), dangling = DB.images.filter((i) => i.dangling);
  return { total: sum(DB.images), used: sum(used), unused: sum(unused), dangling: sum(dangling), nUsed: used.length, nUnused: unused.length, nDangling: dangling.length, reclaim: sum(unused) + sum(dangling) };
}

App.view('images', {
  title: 'Images',
  crumbs: ({ params }) => params[0] ? `<a href="#/images" data-go="/images">Images</a>${icon('chevron-right')}<b>${esc(params[0])}</b>` : '<b>Images</b>',
  tools: ({ params }) => params[0] ? '' : `<button class="btn btn-ghost btn-icon" data-act="build-image" data-tip="Build from Dockerfile">${icon('hammer')}</button>`,
  flush: false,
  render(ctx) {
    if (ctx.params[0]) return imageDetail(ctx.params[0]);
    const s = imageStats();
    if (!DB.images.length) return `<div class="empty">${tile({ icon: 'cx-image', th: 255 }, 'tile-xl')}<h2 class="h-sec">No images yet</h2><p>Images you pull or build show up here.</p><button class="btn btn-brand" data-act="pull-image">${icon('download')}Pull image</button></div>`;
    const rows = [...DB.images].sort((a, b) => (a.dangling - b.dangling) || a.repo.localeCompare(b.repo));
    return `
      <div class="page-head"><h1 class="h-page">Images</h1><button class="btn btn-brand" data-act="pull-image" data-tip="Pull from a registry" data-kbd="⌘⇧P">${icon('download')}Pull image</button></div>
      <section class="rs-answer">
        <p class="rs-lede"><b class="ink num">${fmt.mb(s.total)}</b> across ${DB.images.length} images. <b class="ink num">${fmt.mb(s.reclaim)}</b> isn’t used by any container.</p>
        <div class="rs-usage" role="img" aria-label="Image disk usage">
          <span style="--w:${(s.used / s.total) * 100};--c:var(--s1)" data-tip="In use · ${fmt.mb(s.used)}"></span>
          <span style="--w:${(s.unused / s.total) * 100};--c:var(--s6)" data-tip="Unused · ${fmt.mb(s.unused)}"></span>
          <span class="is-hatch" style="--w:${(s.dangling / s.total) * 100}" data-tip="Dangling build layers · ${fmt.mb(s.dangling)}"></span>
        </div>
        <div class="rs-legend"><span><i style="background:var(--s1)"></i>In use ${fmt.mb(s.used)}</span><span><i style="background:var(--s6)"></i>Unused ${fmt.mb(s.unused)}</span><span><i class="is-hatch"></i>Dangling ${fmt.mb(s.dangling)}</span>
          <button class="btn btn-sm right" data-act="prune-images">${icon('trash', 'sm')}Clean up ${fmt.mb(s.reclaim)}</button></div>
      </section>
      <div class="toolbar">
        <div class="seg" data-rs-seg><button aria-pressed="true" data-f="all">All <span class="count">${DB.images.length}</span></button><button aria-pressed="false" data-f="used">In use <span class="count">${s.nUsed}</span></button><button aria-pressed="false" data-f="unused">Unused <span class="count">${s.nUnused}</span></button><button aria-pressed="false" data-f="dangling">Dangling <span class="count">${s.nDangling}</span></button></div>
        <div class="search right">${icon('search')}<input class="input" placeholder="Filter images" aria-label="Filter images"><span class="kbd">/</span></div>
        <button class="btn btn-ghost btn-icon" data-menu="image-sort" data-align="end" data-tip="Sort">${icon('arrows-sort')}</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Repository</th><th>Tag</th><th>Image ID</th><th>Platform</th><th class="r">Size</th><th>Created</th><th>Used by</th><th class="r"><span class="hide">Actions</span></th></tr></thead>
        <tbody>${rows.map((i) => {
          const users = rsUsers(i), ref = imgRef(i);
          return `<tr data-go="/images/${encodeURIComponent(ref)}" data-ctx="image" data-id="${esc(ref)}" data-f="${imgKind(i)}" data-text="${esc((i.repo + ' ' + i.tag + ' ' + i.id).toLowerCase())}" class="${i.dangling ? 'is-off' : ''}">
            <td><span class="row">${i.dangling ? `<span class="tile" style="--th:0">${icon('cx-layer')}</span>` : tile(i)}<span class="truncate ${i.dangling ? '' : 'ink'}" style="font-weight:500">${i.dangling ? 'Dangling build layer' : esc(i.repo)}</span>${i.local ? '<span class="chip">Built here</span>' : ''}</span></td>
            <td>${i.dangling ? '<span class="ink-3">—</span>' : `<span class="chip chip-mono">${esc(i.tag)}</span>`}</td>
            <td><span class="mono-sm ink-3" data-copy="${esc(i.id)}" data-tip="Copy full ID">${esc(i.id.slice(7, 19))}</span></td>
            <td>${i.arch === 'amd64' ? `<span class="chip chip-warn" data-tip="Runs on Apple silicon through Rosetta">${icon('arrows-exchange')}amd64 · Rosetta</span>` : '<span class="ink-3">arm64</span>'}</td>
            <td class="num">${fmt.mb(i.sizeMB)}</td>
            <td class="ink-3">${fmt.ago(i.created)}</td>
            <td><span class="row">${users.length ? rsTiles(users.map((c) => c.name), 3) : '<span class="ink-3">Unused</span>'}</span></td>
            <td class="r"><span class="row-actions">
              ${i.dangling ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-act="run-image" data-arg="${esc(ref)}" data-tip="Run">${icon('player-play')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="push-image" data-arg="${esc(ref)}" data-tip="Push">${icon('upload')}</button>`}
              <button class="btn btn-ghost btn-icon btn-sm" data-act="delete-image" data-arg="${esc(ref)}" data-tip="${users.length ? 'In use, stop its containers first' : 'Delete'}" ${users.length ? 'disabled' : ''}>${icon('trash')}</button>
              <button class="btn btn-ghost btn-icon btn-sm" data-menu="image" data-id="${esc(ref)}" data-align="end" data-tip="More">${icon('dots')}</button></span></td></tr>`;
        }).join('')}</tbody></table>
        <div class="empty hide" data-rs-empty>${icon('filter-off', 'lg')}<p>No images match this filter.</p></div>
      </div>`;
  },
  mount(root, ctx) { if (!ctx.params[0]) rsFilter(root); },
});

App.menu('image-sort', () => [{ heading: 'Sort by' }, { label: 'Name', checked: true }, { label: 'Size' }, { label: 'Created' }, { sep: true }, { label: 'Group dangling at the end', checked: true }]);
App.menu('image', (el) => {
  const ref = el.dataset.id, img = findImage(ref), used = img && rsUsers(img).length;
  return [
    { label: 'Run…', icon: 'player-play', run: () => App.actions['run-image'](el, ref), disabled: img?.dangling },
    { label: 'Open', icon: 'info-circle', run: () => App.go('/images/' + encodeURIComponent(ref)) },
    { label: 'Copy reference', icon: 'copy', run: () => { navigator.clipboard?.writeText(ref).catch(() => {}); toast({ title: 'Copied', body: ref, ic: 'copy' }); } },
    { sep: true },
    { label: 'Tag…', icon: 'tag', act: 'tag-image', arg: ref },
    { label: 'Push to registry', icon: 'upload', act: 'push-image', arg: ref },
    { label: 'Export as .tar…', icon: 'file-export', run: () => toast({ title: `Exporting ${ref}`, body: `Saving to ~/Downloads/${ref.replace(/[/:]/g, '-')}.tar` }) },
    { label: 'Scan for vulnerabilities', icon: 'shield-check', run: () => toast({ title: `Scanning ${ref}`, body: 'Results appear on the image page.', ic: 'shield-check' }) },
    { sep: true },
    { label: used ? 'Delete (in use)' : 'Delete image', icon: 'trash', danger: true, disabled: used, act: 'delete-image', arg: ref },
  ];
});

function findImage(ref) { return DB.images.find((i) => imgRef(i) === ref); }

App.act('run-image', (el, ref) => { if (App.actions['run-container']) App.actions['run-container'](el, ref); else toast({ title: `Run ${ref}`, ic: 'player-play' }); });
App.act('push-image', (el, ref) => toast({ title: `Pushing ${ref}`, body: 'to ghcr.io/mannobeats · 3 of 7 layers already exist', ic: 'upload' }));
App.act('tag-image', (el, ref) => sheet({
  title: `Tag ${ref}`, width: 440,
  body: `<div class="field"><span class="label">New reference</span><input class="input mono" value="ghcr.io/mannobeats/${esc(ref.split('/').pop())}"><span class="hint">registry/namespace/name:tag</span></div>`,
  foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Add tag</button></div>`,
  onMount(el, close) { $('[data-ok]', el).onclick = () => { close(); toast({ title: 'Tag added', body: $('input', el).value, tone: 'ok' }); }; },
}));
App.act('delete-image', (el, ref) => {
  const img = findImage(ref); if (!img) return;
  confirmSheet({ title: `Delete ${img.dangling ? 'this build layer' : ref}?`, body: `${fmt.mb(img.sizeMB)} is freed. You can pull it again later.`, action: 'Delete image', onConfirm() {
    DB.images.splice(DB.images.indexOf(img), 1);
    if (App.route.params[0]) App.go('/images'); else App.rerender();
    toast({ title: `Deleted ${img.dangling ? 'build layer' : ref}`, body: `${fmt.mb(img.sizeMB)} freed`, tone: 'ok' });
  } });
});
App.act('prune-images', () => {
  const s = imageStats();
  const list = DB.images.filter((i) => imgKind(i) !== 'used');
  sheet({
    title: `Clean up ${fmt.mb(s.reclaim)}?`, width: 480,
    body: `<p style="margin:0 0 12px">These ${list.length} images aren’t used by any container. Deleting them frees <b class="ink">${fmt.mb(s.reclaim)}</b> on the engine disk.</p>
      <div class="rs-list">${list.map((i) => `<label class="rs-list-row"><input type="checkbox" class="check" checked data-mb="${i.sizeMB}" data-ref="${esc(i.id)}"><span class="grow truncate ${i.dangling ? 'ink-3' : 'ink'}">${i.dangling ? `Dangling layer <span class="mono-sm">${esc(i.id.slice(7, 19))}</span>` : esc(imgRef(i))}</span><span class="num meta">${fmt.mb(i.sizeMB)}</span></label>`).join('')}</div>
      <label class="row" style="margin-top:12px"><input type="checkbox" class="check"><span>Also clear the build cache <span class="meta">(1.3 GB)</span></span></label>`,
    foot: `<span class="meta" data-sum></span><div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-danger" data-ok>Delete images</button></div>`,
    onMount(el, close) {
      const sum = () => { const mb = $$('[data-mb]:checked', el).reduce((a, c) => a + +c.dataset.mb, 0); $('[data-sum]', el).textContent = `${fmt.mb(mb)} selected`; $('[data-ok]', el).disabled = !mb; };
      el.addEventListener('change', sum); sum();
      $('[data-ok]', el).onclick = () => {
        const btn = $('[data-ok]', el); btn.classList.add('is-loading'); btn.innerHTML = `${icon('loader-2')}Deleting…`;
        const mb = $$('[data-mb]:checked', el).reduce((a, c) => a + +c.dataset.mb, 0);
        const gone = new Set($$('[data-mb]:checked', el).map((c) => c.dataset.ref));
        setTimeout(() => { DB.images = DB.images.filter((i) => !gone.has(i.id)); close(); App.rerender(); toast({ title: `Freed ${fmt.mb(mb)}`, body: 'Engine disk: 39.2 GB of 120 GB used', tone: 'ok' }); }, 900);
      };
    },
  });
});
App.act('build-image', () => sheet({
  title: 'Build an image', ic: 'hammer', width: 520,
  body: `<div class="col gap-16">
    <div class="field"><span class="label">Dockerfile</span><div class="input-group"><input class="input mono" value="~/Code/shop/web/Dockerfile"><button class="btn">Choose…</button></div></div>
    <div class="field"><span class="label">Context</span><input class="input mono" value="~/Code/shop/web"></div>
    <div class="field"><span class="label">Tag</span><input class="input mono" value="shop-web:dev"></div>
    <div class="field"><span class="label">Platforms</span><div class="row gap-16"><label class="row"><input type="checkbox" class="check" checked>linux/arm64</label><label class="row"><input type="checkbox" class="check">linux/amd64 <span class="meta">via Rosetta</span></label></div></div>
  </div>`,
  foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>${icon('hammer')}Build</button></div>`,
  onMount(el, close) { $('[data-ok]', el).onclick = () => { close(); toast({ title: 'Building shop-web:dev', body: 'Step 4 of 11 · cached', ic: 'hammer' }); }; },
}));

/* pull image sheet: Docker Hub search, tag, platform, live layer progress */
const HUB = [
  { name: 'postgres', desc: 'The PostgreSQL object-relational database system', badge: 'Docker Official Image', stars: '14.1k', pulls: '1B+', tags: ['17', '17-alpine', '16', '15', 'latest'], mono: 'Pg', th: 240 },
  { name: 'redis', desc: 'Redis is the world’s fastest data platform', badge: 'Docker Official Image', stars: '13.0k', pulls: '1B+', tags: ['7.4-alpine', '7.4', '8.0', 'latest'], mono: 'Rd', th: 25 },
  { name: 'nginx', desc: 'Official build of Nginx', badge: 'Docker Official Image', stars: '20.6k', pulls: '1B+', tags: ['1.27-alpine', '1.27', 'stable', 'latest'], mono: 'Ng', th: 150 },
  { name: 'node', desc: 'Node.js is a JavaScript runtime built on V8', badge: 'Docker Official Image', stars: '13.9k', pulls: '1B+', tags: ['22-alpine', '22', '20-alpine', 'lts'], mono: 'Nx', th: 250 },
  { name: 'python', desc: 'Python is an interpreted, interactive, object-oriented language', badge: 'Docker Official Image', stars: '9.9k', pulls: '1B+', tags: ['3.13-slim', '3.13', '3.12-slim'], mono: 'Py', th: 230 },
  { name: 'bitnami/postgresql', desc: 'PostgreSQL packaged by Bitnami', badge: 'Verified publisher', stars: '248', pulls: '500M+', tags: ['17.2.0', '16.6.0', 'latest'], mono: 'Bn', th: 220 },
  { name: 'postgis/postgis', desc: 'PostgreSQL with the PostGIS spatial extension', badge: '', stars: '563', pulls: '100M+', tags: ['17-3.5', '16-3.5'], mono: 'Gi', th: 200 },
  { name: 'timescale/timescaledb', desc: 'Time-series database built on PostgreSQL', badge: 'Verified publisher', stars: '412', pulls: '100M+', tags: ['latest-pg17', '2.17.2-pg16'], mono: 'Ts', th: 50 },
  { name: 'mcr.microsoft.com/mssql/server', desc: 'Microsoft SQL Server for Linux', badge: 'Verified publisher', stars: '—', pulls: '100M+', tags: ['2022-latest', '2019-latest'], mono: 'Ms', th: 15, amd64Only: true },
  { name: 'traefik', desc: 'The cloud native application proxy', badge: 'Docker Official Image', stars: '3.4k', pulls: '1B+', tags: ['v3.3', 'latest'], mono: 'Tr', th: 190 },
];
App.act('pull-image', (el, pre) => {
  let sel = null;
  const s = sheet({
    title: 'Pull an image', width: 600,
    body: `<div class="search" style="margin-bottom:10px">${icon('search')}<input class="input" placeholder="Search Docker Hub or paste ghcr.io/owner/name:tag" value="${esc(typeof pre === 'string' ? pre : '')}" data-q aria-label="Image"></div>
      <div class="rs-hub" data-results role="listbox"></div>
      <div class="rs-pull-opts hide" data-opts></div>`,
    foot: `<span class="meta" data-hint>Pulls go to the engine’s image store.</span><div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok disabled>${icon('download')}Pull</button></div>`,
    onMount(root, close) {
      const q = $('[data-q]', root), list = $('[data-results]', root), opts = $('[data-opts]', root), ok = $('[data-ok]', root);
      const draw = () => {
        const t = q.value.trim().toLowerCase();
        const res = t ? HUB.filter((h) => h.name.includes(t) || h.desc.toLowerCase().includes(t)) : HUB.slice(0, 6);
        const direct = t.includes('/') && t.includes('.') && !res.length;
        list.innerHTML = direct ? `<button class="rs-hub-row is-selected" data-direct>${tile({ icon: 'cx-domain', th: 255 })}<span class="grow"><b class="ink mono">${esc(t)}</b><span class="meta">Pull directly from this registry</span></span></button>`
          : res.length ? res.map((h) => `<button class="rs-hub-row ${sel === h ? 'is-selected' : ''}" data-h="${esc(h.name)}" role="option">${tile(h)}<span class="grow col" style="gap:1px"><span class="row"><b class="ink">${esc(h.name)}</b>${h.badge ? `<span class="chip ${h.badge.startsWith('Docker') ? 'chip-brand' : ''}">${icon(h.badge.startsWith('Docker') ? 'rosette-discount-check' : 'certificate', 'sm')}${esc(h.badge)}</span>` : ''}</span><span class="meta truncate">${esc(h.desc)}</span></span><span class="col meta r" style="gap:1px;align-items:flex-end"><span class="row gap-4">${icon('star', 'sm')}${h.stars}</span><span class="row gap-4">${icon('download', 'sm')}${h.pulls}</span></span></button>`).join('')
          : `<div class="empty" style="padding:28px">${icon('search', 'lg')}<p>No images on Docker Hub match “${esc(q.value)}”.</p></div>`;
        if (direct) { ok.disabled = false; sel = { name: t, tags: [], direct: true }; }
      };
      const pick = (h) => {
        sel = h; draw(); ok.disabled = false;
        opts.classList.remove('hide');
        opts.innerHTML = `<div class="rs-opts-grid">
          <div class="field"><span class="label">Tag</span><select class="select mono" data-tag>${h.tags.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
          <div class="field"><span class="label">Platform</span><div class="seg" ${h.amd64Only ? 'data-seg-manual' : ''}><button aria-pressed="${!h.amd64Only}" ${h.amd64Only ? 'disabled' : ''}>arm64 · native</button><button aria-pressed="${!!h.amd64Only}">amd64 · Rosetta</button></div>${h.amd64Only ? '<span class="hint">This image only ships for amd64. It runs through Rosetta at about 80% native speed.</span>' : ''}</div></div>`;
        $$('.seg', opts).forEach(segThumb);
        $('[data-hint]', root).textContent = `${h.name}:${h.tags[0]} · about ${Math.round(40 + (h.name.length * 37) % 400)} MB`;
        $('[data-tag]', opts).onchange = (e) => ($('[data-hint]', root).textContent = `${h.name}:${e.target.value}`);
      };
      q.addEventListener('input', () => { sel = null; ok.disabled = true; opts.classList.add('hide'); draw(); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = HUB.find((h) => h.name.includes(q.value.trim().toLowerCase())); if (first) pick(first); } });
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (b) pick(HUB.find((h) => h.name === b.dataset.h)); });
      ok.onclick = () => {
        const ref = sel.direct ? sel.name : `${sel.name}:${$('[data-tag]', opts).value}`;
        pullProgress(root, ref, sel, close);
      };
      draw();
      const auto = HUB.find((h) => typeof pre === 'string' && pre && h.name === pre.split(':')[0]); if (auto) pick(auto);
    },
  });
  return s;
});
function pullProgress(root, ref, h, close) {
  const layers = [['a2318d6c47ec', 29.1], ['7b5c3b2e1f90', 4.2], ['e81f0c6a9b33', 61.8], ['1d0a4f27c8b5', 0.4], ['c9e7f6d3a2b1', 18.6], ['5f8e2a1c7d40', 0.1]];
  $('.sheet-head .h-sec', root.closest('.sheet') || root).textContent = `Pulling ${ref}`;
  const body = $('.sheet-body', root.closest('.sheet') || root);
  body.innerHTML = `<p class="meta" style="margin:0 0 10px">${layers.length} layers · ${fmt.mb(layers.reduce((a, l) => a + l[1], 0))} · ${h.amd64Only ? 'linux/amd64 via Rosetta' : 'linux/arm64'}</p>
    <div class="rs-layers-pull">${layers.map(([id, mb]) => `<div class="rs-pl" data-mb="${mb}"><span class="mono-sm ink-3">${id}</span><div class="progress grow"><i style="transform:scaleX(0)"></i></div><span class="meta num" data-st>Waiting</span></div>`).join('')}</div>`;
  const foot = $('.sheet-foot', root.closest('.sheet') || root);
  foot.innerHTML = `<span class="meta" data-total>0%</span><div class="right"><button class="btn" data-bg>Hide</button><button class="btn btn-danger-ghost" data-cancel>Cancel pull</button></div>`;
  const rows = $$('.rs-pl', body), prog = rows.map(() => 0);
  let tick = setInterval(() => {
    if (!body.isConnected) return clearInterval(tick);
    let done = 0;
    rows.forEach((r, i) => {
      if (i > 0 && prog[i - 1] < 0.35 && prog[i] === 0) return;
      const mb = +r.dataset.mb; prog[i] = Math.min(1, prog[i] + Math.max(0.06, 2.4 / (mb + 4)) * (0.6 + Math.random()));
      $('i', r).style.transform = `scaleX(${prog[i]})`;
      $('[data-st]', r).textContent = prog[i] >= 1 ? 'Done' : prog[i] > 0.85 ? 'Extracting' : `${(mb * prog[i]).toFixed(1)} / ${mb} MB`;
      r.classList.toggle('is-done', prog[i] >= 1); done += prog[i];
    });
    const pct = done / rows.length; $('[data-total]', foot).textContent = `${Math.round(pct * 100)}%`;
    if (pct >= 1) {
      clearInterval(tick);
      const [repo, tag = 'latest'] = ref.split(/:(?=[^:]+$)/);
      if (!DB.images.find((i) => i.repo === repo && i.tag === tag)) DB.images.unshift({ repo, tag, id: 'sha256:' + Math.random().toString(16).slice(2, 10), sizeMB: Math.round(layers.reduce((a, l) => a + l[1], 0) * 2.4), created: Date.now() - 6 * DB.day, used: 0, mono: h.mono || repo.slice(0, 2), th: h.th ?? 255, arch: h.amd64Only ? 'amd64' : 'arm64' });
      setTimeout(() => { close(); if (App.route.name === 'images') App.rerender(); toast({ title: `Pulled ${ref}`, tone: 'ok', actionLabel: 'Run', action: () => App.actions['run-image'](null, ref) }); }, 350);
    }
  }, 160);
  $('[data-bg]', foot).onclick = () => { close(); toast({ title: `Pulling ${ref} in the background`, ic: 'download' }); };
  $('[data-cancel]', foot).onclick = () => { clearInterval(tick); close(); toast({ title: 'Pull cancelled', body: ref }); };
}

/* image detail */
function layersFor(img) {
  const alpine = /alpine/.test(img.tag) || /mailpit|stripe|minio/.test(img.repo);
  const runtime = { node: 'RUN apk add --no-cache libc6-compat && corepack enable', golang: 'RUN set -eux; curl -fsSL https://go.dev/dl/go1.24.0.linux-arm64.tar.gz | tar -C /usr/local -xz', postgres: 'RUN set -ex; apt-get update; apt-get install -y --no-install-recommends postgresql-17 postgresql-contrib-17', mysql: 'RUN set -eux; microdnf install -y mysql-community-server-minimal-8.4.3', redis: 'RUN set -eux; apk add --no-cache --virtual .build-deps gcc make musl-dev; make -C /usr/src/redis -j4 install' }[img.repo] || `RUN /bin/sh -c set -eux; install ${img.repo.split('/').pop()} runtime`;
  const t = img.sizeMB;
  return [
    [alpine ? 'ADD alpine-minirootfs-3.21.2-aarch64.tar.gz / # buildkit' : 'ADD rootfs.tar.xz / # debian bookworm-slim', alpine ? 7.8 : Math.min(t * 0.2, 74.8)],
    ['CMD ["/bin/sh"]', 0],
    ['ENV LANG=en_US.utf8 TZ=UTC', 0],
    [runtime, t * 0.58],
    ['RUN groupadd -r app && useradd -r -g app app', 0.02],
    ['COPY docker-entrypoint.sh /usr/local/bin/ # buildkit', 0.01],
    ['WORKDIR /app', 0],
    [`COPY . /app # buildkit`, t * 0.14],
    ['EXPOSE ' + (DB.containers.find((c) => c.image === img.repo)?.ports[0]?.ctr || 8080), 0],
    ['ENTRYPOINT ["docker-entrypoint.sh"]', 0],
  ].map(([cmd, mb]) => ({ cmd, mb: Math.max(0, mb) }));
}
function imageDetail(ref) {
  const img = findImage(ref);
  if (!img) return `<div class="empty">${icon('cx-image', 'xl')}<h2 class="h-sec">${esc(ref)} isn’t on this engine</h2><p>It may have been deleted. Pull it again to use it.</p><button class="btn btn-brand" data-act="pull-image" data-arg="${esc(ref)}">${icon('download')}Pull ${esc(ref)}</button></div>`;
  const users = rsUsers(img), layers = layersFor(img), maxMb = Math.max(...layers.map((l) => l.mb));
  const c0 = DB.containers.find((c) => c.image === img.repo);
  const seed = img.id.charCodeAt(9) + img.id.charCodeAt(10);
  const vul = { critical: img.dangling ? 0 : seed % 2 ? 0 : 1, high: seed % 4, medium: (seed % 7) + 3, low: (seed % 11) + 6 };
  const vt = vul.critical + vul.high + vul.medium + vul.low;
  return `
    ${rsHead({
      face: img.dangling ? `<span class="tile tile-lg" style="--th:0">${icon('cx-layer')}</span>` : tile(img, 'tile-lg'),
      title: img.dangling ? 'Dangling build layer' : `${img.repo}:${img.tag}`,
      meta: `<span class="mono-sm" data-copy="${esc(img.id)}" data-tip="Copy full ID">${esc(img.id.slice(0, 19))}</span><span>${fmt.mb(img.sizeMB)}</span><span>${img.arch === 'amd64' ? 'linux/amd64 via Rosetta' : 'linux/arm64'}</span><span>Created ${fmt.ago(img.created)}</span>`,
      actions: `${img.dangling ? '' : `<button class="btn" data-act="push-image" data-arg="${esc(ref)}">${icon('upload')}Push</button><button class="btn btn-brand" data-act="run-image" data-arg="${esc(ref)}">${icon('player-play')}Run</button>`}<button class="btn btn-ghost btn-icon" data-menu="image" data-id="${esc(ref)}" data-align="end" data-tip="More">${icon('dots')}</button>`,
    })}
    <div class="rs-cols">
      <section class="rs-sec">
        <h2 class="h-sub">Layers <span class="meta">${layers.length}</span></h2>
        <ol class="rs-layers">${layers.map((l, i) => `<li><span class="rs-li-n num">${i + 1}</span><code class="mono-sm truncate selectable" data-tip="${esc(l.cmd)}">${esc(l.cmd)}</code><span class="rs-li-bar"><i style="transform:scaleX(${maxMb ? l.mb / maxMb : 0})"></i></span><span class="num meta">${l.mb >= 0.1 ? fmt.mb(l.mb) : l.mb > 0 ? '< 0.1 MB' : '0 B'}</span></li>`).join('')}</ol>
      </section>
      <aside class="col gap-24">
        <section class="rs-sec"><h2 class="h-sub">Used by</h2>
          ${users.length ? `<div class="rs-list">${users.map((c) => `<button class="rs-list-row" data-go="/containers/${c.name}">${tile(c, '', c.state === 'running' ? '' : 'is-off')}<span class="grow truncate ink">${esc(c.name)}</span><span class="meta">${c.state === 'running' ? `Up ${fmt.dur(c.started)}` : 'Stopped'}</span></button>`).join('')}</div>` : `<p class="meta" style="margin:0">No container uses this image.</p>`}
        </section>
        <section class="rs-sec"><h2 class="h-sub">Config</h2>
          <dl class="kv">
            <dt>Entrypoint</dt><dd><code class="mono-sm">docker-entrypoint.sh</code></dd>
            <dt>Command</dt><dd><code class="mono-sm truncate">${esc(c0?.cmd || '—')}</code></dd>
            <dt>Working dir</dt><dd><code class="mono-sm">/app</code></dd>
            <dt>User</dt><dd>${img.repo === 'postgres' ? 'postgres' : 'root'}</dd>
            <dt>Exposed ports</dt><dd>${c0?.ports.length ? c0.ports.map((p) => `<span class="chip chip-mono">${p.ctr}/tcp</span>`).join('') : '<span class="ink-3">None</span>'}</dd>
            <dt>Environment</dt><dd class="col" style="align-items:flex-start;gap:2px"><code class="mono-sm">PATH=/usr/local/sbin:/usr/local/bin:/usr/bin</code><code class="mono-sm">LANG=en_US.utf8</code><code class="mono-sm">TZ=UTC</code></dd>
            <dt>Labels</dt><dd class="col" style="align-items:flex-start;gap:2px"><code class="mono-sm">org.opencontainers.image.source=github.com/docker-library/${esc(img.repo.split('/').pop())}</code><code class="mono-sm">org.opencontainers.image.version=${esc(img.tag)}</code></dd>
          </dl>
        </section>
        <section class="rs-sec">
          <div class="row"><h2 class="h-sub grow">Vulnerabilities</h2><span class="meta">Scanned 2h ago</span><button class="btn btn-ghost btn-icon btn-sm" data-tip="Scan again" data-act="rescan">${icon('refresh')}</button></div>
          <p style="margin:6px 0 8px">${vul.critical ? `<b class="bad-ink">${vul.critical} critical</b>, ` : ''}${vul.high} high, ${vul.medium} medium and ${vul.low} low across ${vt} findings.</p>
          <div class="rs-vbar" role="img" aria-label="Vulnerabilities by severity">${vul.critical ? `<span style="--w:${vul.critical};--c:var(--bad)" data-tip="Critical · ${vul.critical}"></span>` : ''}<span style="--w:${vul.high};--c:var(--warn)" data-tip="High · ${vul.high}"></span><span style="--w:${vul.medium};--c:var(--s6)" data-tip="Medium · ${vul.medium}"></span><span style="--w:${vul.low};--c:var(--line-strong)" data-tip="Low · ${vul.low}"></span></div>
          <div class="rs-list" style="margin-top:10px">
            ${(vul.critical ? [['CVE-2024-45491', 'critical', 'libexpat1', '2.5.0-1', '2.5.0-1+deb12u1']] : []).concat([['CVE-2024-6119', 'high', 'openssl', '3.0.14-1', '3.0.15-1'], ['CVE-2023-50495', 'medium', 'ncurses-base', '6.4-4', '—'], ['CVE-2024-2236', 'medium', 'libgcrypt20', '1.10.1-3', '—']]).slice(0, 3).map(([id, sev, pkg, v, fix]) => `<div class="rs-list-row"><span class="mono-sm ${sev === 'critical' ? 'bad-ink' : sev === 'high' ? 'warn-ink' : 'ink-3'}" style="width:118px">${id}</span><span class="grow truncate ink">${pkg} <span class="meta mono-sm">${v}</span></span><span class="meta">${fix === '—' ? 'No fix yet' : `Fixed in ${fix}`}</span></div>`).join('')}
          </div>
        </section>
      </aside>
    </div>`;
}
App.act('rescan', (el) => { el.classList.add('is-loading'); setTimeout(() => { el.classList.remove('is-loading'); toast({ title: 'Scan finished', body: 'No new findings', tone: 'ok' }); }, 1200); });

/* ---------- volumes ---------- */
App.view('volumes', {
  title: 'Volumes',
  crumbs: ({ params }) => params[0] ? `<a href="#/volumes" data-go="/volumes">Volumes</a>${icon('chevron-right')}<b>${esc(params[0])}</b>` : '<b>Volumes</b>',
  get flush() { return !!App.parse().params[0]; },
  render(ctx) {
    if (ctx.params[0]) return volumeDetail(ctx.params[0]);
    const total = DB.volumes.reduce((a, v) => a + v.sizeMB, 0);
    const orphan = DB.volumes.filter((v) => !v.usedBy.length);
    if (!DB.volumes.length) return `<div class="empty">${tile({ icon: 'cx-volume', th: 255 }, 'tile-xl')}<h2 class="h-sec">No volumes yet</h2><p>Volumes keep data when containers are recreated.</p><button class="btn btn-brand" data-act="new-volume">${icon('plus')}New volume</button></div>`;
    const proj = (id) => DB.projects.find((p) => p.id === id);
    return `
      <div class="page-head"><h1 class="h-page">Volumes</h1><button class="btn btn-brand" data-act="new-volume">${icon('plus')}New volume</button></div>
      <section class="rs-answer"><p class="rs-lede"><b class="ink num">${fmt.mb(total)}</b> in ${DB.volumes.length} volumes. ${orphan.length ? `${orphan.length} isn’t attached to any container (${fmt.mb(orphan.reduce((a, v) => a + v.sizeMB, 0))}).` : 'All are attached.'}</p>
        <div class="rs-usage" role="img" aria-label="Volume sizes">${[...DB.volumes].sort((a, b) => b.sizeMB - a.sizeMB).map((v) => `<span style="--w:${(v.sizeMB / total) * 100};--c:var(--${proj(v.project)?.color || 's6'})" data-tip="${esc(v.anonymous ? 'Anonymous volume' : v.name)} · ${fmt.mb(v.sizeMB)}"></span>`).join('')}</div>
      </section>
      <div class="toolbar">
        <div class="seg" data-rs-seg><button aria-pressed="true" data-f="all">All <span class="count">${DB.volumes.length}</span></button><button aria-pressed="false" data-f="used">In use <span class="count">${DB.volumes.length - orphan.length}</span></button><button aria-pressed="false" data-f="unused">Unattached <span class="count">${orphan.length}</span></button></div>
        <div class="search right">${icon('search')}<input class="input" placeholder="Filter volumes" aria-label="Filter volumes"><span class="kbd">/</span></div>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Name</th><th>Project</th><th>Used by</th><th>Mounted at</th><th class="r">Size</th><th>Created</th><th class="r"><span class="hide">Actions</span></th></tr></thead>
        <tbody>${DB.volumes.map((v) => `<tr data-go="/volumes/${encodeURIComponent(v.name)}" data-ctx="volume" data-id="${esc(v.name)}" data-f="${v.usedBy.length ? 'used' : 'unused'}" data-text="${esc((v.name + ' ' + (v.project || '') + ' ' + v.usedBy.join(' ')).toLowerCase())}" class="${v.usedBy.length ? '' : 'is-off'}">
          <td><span class="row"><span class="tile" style="--th:255">${icon('cx-volume')}</span>${v.anonymous ? `<span class="mono-sm truncate" style="max-width:140px" data-tip="${esc(v.name)}">${esc(v.name.slice(0, 12))}…</span><span class="chip">Anonymous</span>` : `<span class="ink truncate" style="font-weight:500">${esc(v.name)}</span>`}</span></td>
          <td>${v.project ? `<span class="chip">${esc(v.project)}</span>` : '<span class="ink-3">—</span>'}</td>
          <td><span class="row">${rsTiles(v.usedBy)}</span></td>
          <td><code class="mono-sm ink-3">${esc(v.mount || '—')}</code></td>
          <td class="num">${fmt.mb(v.sizeMB)}</td><td class="ink-3">${fmt.ago(v.created)}</td>
          <td class="r"><span class="row-actions"><button class="btn btn-ghost btn-icon btn-sm" data-copy="~/Containeria/volumes/${esc(v.name)}" data-tip="Copy Finder path">${icon('folder-open')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="backup-volume" data-arg="${esc(v.name)}" data-tip="Back up to .tar">${icon('archive')}</button><button class="btn btn-ghost btn-icon btn-sm" data-menu="volume" data-id="${esc(v.name)}" data-align="end" data-tip="More">${icon('dots')}</button></span></td></tr>`).join('')}</tbody></table>
        <div class="empty hide" data-rs-empty>${icon('filter-off', 'lg')}<p>No volumes match this filter.</p></div></div>`;
  },
  mount(root, ctx) { if (ctx.params[0]) mountFiles(root); else rsFilter(root); },
});
App.menu('volume', (el) => {
  const n = el.dataset.id;
  return [
    { label: 'Browse files', icon: 'folder', run: () => App.go('/volumes/' + encodeURIComponent(n)) },
    { label: 'Copy Finder path', icon: 'copy', run: () => { navigator.clipboard?.writeText(`~/Containeria/volumes/${n}`).catch(() => {}); toast({ title: 'Copied', body: `~/Containeria/volumes/${n}`, ic: 'copy' }); } },
    { sep: true },
    { label: 'Back up to .tar…', icon: 'archive', act: 'backup-volume', arg: n },
    { label: 'Clone…', icon: 'copy-plus', act: 'clone-volume', arg: n },
    { label: 'Restore from .tar…', icon: 'file-upload', run: () => toast({ title: 'Choose a .tar backup to restore', ic: 'file-upload' }) },
    { sep: true },
    { label: 'Delete volume', icon: 'trash', danger: true, act: 'delete-volume', arg: n },
  ];
});
App.act('backup-volume', (el, n) => toast({ title: `Backing up ${n}`, body: `~/Downloads/${n}-${new Date().toISOString().slice(0, 10)}.tar`, ic: 'archive' }));
App.act('clone-volume', (el, n) => sheet({
  title: `Clone ${n}`, width: 440,
  body: `<div class="field"><span class="label">New volume name</span><input class="input mono" value="${esc(n)}_copy"><span class="hint">Copies every file. The original stays attached.</span></div>`,
  foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Clone volume</button></div>`,
  onMount(s, close) { $('[data-ok]', s).onclick = () => { const v = DB.volumes.find((x) => x.name === n); DB.volumes.push({ ...v, name: $('input', s).value, usedBy: [], created: Date.now() }); close(); App.rerender(); toast({ title: 'Volume cloned', body: $('input', s).value, tone: 'ok' }); }; },
}));
App.act('delete-volume', (el, n) => {
  const v = DB.volumes.find((x) => x.name === n);
  confirmSheet({ title: `Delete ${v.anonymous ? 'this anonymous volume' : n}?`, body: v.usedBy.length ? `<b class="ink">${esc(v.usedBy.join(', '))}</b> loses its data at <code class="mono-sm">${esc(v.mount)}</code>. All ${fmt.mb(v.sizeMB)} of files are deleted and can’t be recovered. Back it up first if you might need it.` : `All ${fmt.mb(v.sizeMB)} of files are deleted and can’t be recovered.`, action: 'Delete volume', onConfirm() {
    DB.volumes.splice(DB.volumes.indexOf(v), 1); App.go('/volumes'); toast({ title: `Deleted ${v.anonymous ? 'anonymous volume' : n}`, body: `${fmt.mb(v.sizeMB)} freed`, tone: 'ok' });
  } });
});
App.act('new-volume', () => sheet({
  title: 'New volume', width: 460,
  body: `<div class="col gap-16"><div class="field"><span class="label">Name</span><input class="input mono" placeholder="shop_uploads" data-name></div>
    <div class="field"><span class="label">Driver</span><select class="select"><option>local</option><option>local · tmpfs (in memory)</option><option>local · bind to a Mac folder</option></select></div>
    <div class="field"><span class="label">Labels <span class="meta">optional</span></span><input class="input mono" placeholder="com.example.team=shop"></div></div>`,
  foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok disabled>Create volume</button></div>`,
  onMount(s, close) {
    const name = $('[data-name]', s), ok = $('[data-ok]', s);
    name.oninput = () => { const v = name.value.trim(), bad = v && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(v), dup = DB.volumes.some((x) => x.name === v); ok.disabled = !v || bad || dup; name.classList.toggle('is-error', bad || dup); $('.err', s)?.remove(); if (bad || dup) name.insertAdjacentHTML('afterend', `<span class="err">${icon('alert-circle', 'sm')}${dup ? 'A volume with this name exists.' : 'Use letters, numbers, dots, dashes and underscores.'}</span>`); };
    ok.onclick = () => { DB.volumes.unshift({ name: name.value.trim(), driver: 'local', sizeMB: 0, created: Date.now(), usedBy: [], project: null, mount: '' }); close(); App.rerender(); toast({ title: `Created ${name.value.trim()}`, tone: 'ok' }); };
  },
}));
function volumeDetail(n) {
  const v = DB.volumes.find((x) => x.name === n);
  if (!v) return `<div class="empty">${icon('database-off', 'xl')}<h2 class="h-sec">${esc(n)} was deleted</h2><button class="btn" data-go="/volumes">All volumes</button></div>`;
  const fs = v.name === 'shop_pgdata' ? fakeFS.volume : v.name.includes('node_modules') ? { path: '/', entries: fakeFS['node-app'].entries.slice(0, 3), preview: null } : fakeFS.volume;
  return `${rsHead({
    face: `<span class="tile tile-lg" style="--th:255">${icon('cx-volume')}</span>`, title: v.anonymous ? 'Anonymous volume' : v.name,
    meta: `<span>${fmt.mb(v.sizeMB)}</span><span>${esc(v.driver)} driver</span>${v.usedBy.length ? `<span>Mounted in ${v.usedBy.map((u) => `<a href="#/containers/${esc(u)}" data-go="/containers/${esc(u)}">${esc(u)}</a>`).join(', ')} at <code class="mono-sm">${esc(v.mount)}</code></span>` : '<span>Not attached</span>'}<span>Created ${fmt.ago(v.created)}</span>`,
    actions: `<button class="btn" data-act="backup-volume" data-arg="${esc(n)}">${icon('archive')}Back up</button><button class="btn" data-act="clone-volume" data-arg="${esc(n)}">${icon('copy-plus')}Clone</button><button class="btn btn-ghost btn-icon" data-menu="volume" data-id="${esc(n)}" data-align="end" data-tip="More">${icon('dots')}</button>`,
  })}
  <div class="rs-fill rs-bordered">${filesPane({ ...fs, finder: `~/Containeria/volumes/${v.name}` })}</div>`;
}

/* ---------- networks ---------- */
App.view('networks', {
  title: 'Networks',
  crumbs: ({ params }) => params[0] ? `<a href="#/networks" data-go="/networks">Networks</a>${icon('chevron-right')}<b>${esc(params[0])}</b>` : '<b>Networks</b>',
  render(ctx) {
    if (ctx.params[0]) return networkDetail(ctx.params[0]);
    const user = DB.networks.filter((n) => !n.builtin);
    return `
      <div class="page-head"><h1 class="h-page">Networks</h1><button class="btn btn-brand" data-act="new-network">${icon('plus')}New network</button></div>
      <section class="rs-answer"><p class="rs-lede">${user.length} project networks and ${DB.networks.length - user.length} built in. Containers reach each other by service name, and you reach them from the Mac at <code class="mono">*.${DB.engine.domain}</code>.</p></section>
      <div class="toolbar"><div class="search">${icon('search')}<input class="input" placeholder="Filter networks" aria-label="Filter networks"><span class="kbd">/</span></div></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Name</th><th>Driver</th><th>Subnet</th><th>Gateway</th><th>Containers</th><th class="r"><span class="hide">Actions</span></th></tr></thead>
        <tbody>${DB.networks.map((n) => `<tr data-go="/networks/${encodeURIComponent(n.name)}" data-ctx="network" data-id="${esc(n.name)}" data-f="all" data-text="${esc((n.name + ' ' + n.driver + ' ' + n.subnet + ' ' + n.containers.join(' ')).toLowerCase())}">
          <td><span class="row"><span class="tile" style="--th:${n.builtin ? 0 : 200}">${icon('cx-network')}</span><span class="ink" style="font-weight:500">${esc(n.name)}</span>${n.builtin ? '<span class="chip">Built in</span>' : n.project ? `<span class="chip">${esc(n.project)}</span>` : ''}</span></td>
          <td>${esc(n.driver)}</td><td><code class="mono-sm">${esc(n.subnet)}</code></td><td><code class="mono-sm ink-3">${esc(n.gateway)}</code></td>
          <td><span class="row">${n.containers.length ? rsTiles(n.containers, 5) : '<span class="ink-3">None</span>'}</span></td>
          <td class="r"><span class="row-actions"><button class="btn btn-ghost btn-icon btn-sm" data-menu="network" data-id="${esc(n.name)}" data-align="end" data-tip="More">${icon('dots')}</button></span></td></tr>`).join('')}</tbody></table>
        <div class="empty hide" data-rs-empty>${icon('filter-off', 'lg')}<p>No networks match.</p></div></div>`;
  },
  mount(root, ctx) { if (!ctx.params[0]) rsFilter(root); },
});
App.menu('network', (el) => {
  const n = DB.networks.find((x) => x.name === el.dataset.id);
  return [
    { label: 'Open', icon: 'info-circle', run: () => App.go('/networks/' + encodeURIComponent(n.name)) },
    { label: 'Connect a container…', icon: 'link', act: 'connect-network', arg: n.name, disabled: n.driver === 'null' },
    { label: 'Copy subnet', icon: 'copy', run: () => toast({ title: 'Copied', body: n.subnet, ic: 'copy' }) },
    { sep: true },
    { label: n.builtin ? 'Built-in networks can’t be deleted' : 'Delete network', icon: 'trash', danger: !n.builtin, disabled: n.builtin, run: () => confirmSheet({ title: `Delete ${n.name}?`, body: n.containers.length ? `${n.containers.length} containers are disconnected from it first. They lose the DNS names ${esc(n.containers.slice(0, 2).join(', '))}${n.containers.length > 2 ? '…' : ''} on this network.` : 'No container uses it.', action: 'Delete network', onConfirm() { DB.networks.splice(DB.networks.indexOf(n), 1); App.go('/networks'); toast({ title: `Deleted ${n.name}`, tone: 'ok' }); } }) },
  ];
});
App.act('connect-network', (el, name) => sheet({
  title: `Connect to ${name}`, width: 440,
  body: `<div class="field"><span class="label">Container</span><select class="select">${DB.containers.filter((c) => !DB.networks.find((n) => n.name === name).containers.includes(c.name)).map((c) => `<option>${esc(c.name)}</option>`).join('')}</select></div><div class="field" style="margin-top:12px"><span class="label">Aliases <span class="meta">optional</span></span><input class="input mono" placeholder="api, backend"></div>`,
  foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Connect</button></div>`,
  onMount(s, close) { $('[data-ok]', s).onclick = () => { DB.networks.find((n) => n.name === name).containers.push($('select', s).value); close(); App.rerender(); toast({ title: `${$('select', s).value} joined ${name}`, tone: 'ok' }); }; },
}));
App.act('new-network', () => sheet({
  title: 'New network', width: 500,
  body: `<div class="col gap-16">
    <div class="field"><span class="label">Name</span><input class="input mono" placeholder="payments_net"></div>
    <div class="field"><span class="label">Driver</span><div class="seg"><button aria-pressed="true">bridge</button><button aria-pressed="false">macvlan</button><button aria-pressed="false">ipvlan</button></div></div>
    <div class="rs-opts-grid"><div class="field"><span class="label">Subnet <span class="meta">optional</span></span><input class="input mono" placeholder="172.23.0.0/16"></div><div class="field"><span class="label">Gateway <span class="meta">optional</span></span><input class="input mono" placeholder="172.23.0.1"></div></div>
    <label class="row"><span class="switch"><input type="checkbox"><span></span></span><span class="grow">Internal only <span class="meta">no access to the internet</span></span></label>
    <label class="row"><span class="switch"><input type="checkbox"><span></span></span><span class="grow">IPv6</span></label></div>`,
  foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Create network</button></div>`,
  onMount(s, close) { $('[data-ok]', s).onclick = () => { const name = $('input', s).value.trim() || 'payments_net'; DB.networks.push({ name, driver: 'bridge', subnet: '172.23.0.0/16', gateway: '172.23.0.1', containers: [], scope: 'local' }); close(); App.rerender(); toast({ title: `Created ${name}`, tone: 'ok' }); }; },
}));
function networkDetail(name) {
  const n = DB.networks.find((x) => x.name === name);
  if (!n) return `<div class="empty">${icon('cx-network', 'xl')}<h2 class="h-sec">${esc(name)} was deleted</h2><button class="btn" data-go="/networks">All networks</button></div>`;
  const base = n.subnet.split('.').slice(0, 3).join('.');
  return `${rsHead({
    face: `<span class="tile tile-lg" style="--th:${n.builtin ? 0 : 200}">${icon('cx-network')}</span>`, title: n.name,
    meta: `<span>${esc(n.driver)}</span><span class="mono-sm">${esc(n.subnet)}</span><span>${n.containers.length} containers</span>`,
    actions: `<button class="btn" data-act="connect-network" data-arg="${esc(n.name)}" ${n.driver === 'null' ? 'disabled' : ''}>${icon('link')}Connect container</button><button class="btn btn-ghost btn-icon" data-menu="network" data-id="${esc(n.name)}" data-align="end" data-tip="More">${icon('dots')}</button>`,
  })}
  <div class="rs-cols">
    <section class="rs-sec"><h2 class="h-sub">Connected containers</h2>
      ${n.containers.length ? `<table class="tbl rs-tbl-in"><thead><tr><th>Container</th><th>IPv4</th><th>DNS names</th><th>MAC</th></tr></thead><tbody>${n.containers.map((cn, i) => { const c = DB.containers.find((x) => x.name === cn); return `<tr data-go="/containers/${esc(cn)}" class="${c?.state === 'running' ? '' : 'is-off'}"><td><span class="row">${c ? tile(c, '', c.state === 'running' ? '' : 'is-off') : ''}<span class="ink">${esc(cn)}</span></span></td><td><code class="mono-sm">${c?.state === 'running' ? `${base}.${i + 2}` : '—'}</code></td><td><span class="row gap-4">${c?.service ? `<span class="chip chip-mono">${esc(c.service)}</span>` : ''}<span class="chip chip-mono">${esc(cn)}</span></span></td><td><code class="mono-sm ink-3">02:42:ac:${(20 + i).toString(16)}:00:0${i + 2}</code></td></tr>`; }).join('')}</tbody></table>`
        : `<div class="empty" style="padding:32px">${icon('plug-connected-x', 'lg')}<p>No containers on this network.</p></div>`}
    </section>
    <aside class="rs-sec"><h2 class="h-sub">Details</h2><dl class="kv">
      <dt>Driver</dt><dd>${esc(n.driver)}</dd><dt>Subnet</dt><dd><code class="mono-sm">${esc(n.subnet)}</code></dd><dt>Gateway</dt><dd><code class="mono-sm">${esc(n.gateway)}</code></dd>
      <dt>Scope</dt><dd>${esc(n.scope)}</dd><dt>Internal</dt><dd>No</dd><dt>IPv6</dt><dd>Off</dd>
      <dt>Reach from Mac</dt><dd>${n.driver === 'bridge' ? 'Direct IP routing' : 'Not routed'}</dd></dl></aside>
  </div>`;
}
