// Kubernetes: single-node k3s inside the engine.
let k8sNs = 'all';
const K = () => DB.kube;
const inNs = (x) => k8sNs === 'all' || x.ns === k8sNs;
const podBad = (p) => p.status === 'CrashLoopBackOff' || p.status === 'Error' || p.status === 'ImagePullBackOff';
const k8sIngress = [
  { name: 'storefront', ns: 'shop-staging', host: 'storefront.k8s.containeria.local', path: '/', svc: 'storefront:80', tls: true, cls: 'traefik' },
  { name: 'checkout', ns: 'shop-staging', host: 'storefront.k8s.containeria.local', path: '/checkout', svc: 'checkout:8080', tls: true, cls: 'traefik' },
  { name: 'prometheus', ns: 'monitoring', host: 'prometheus.k8s.containeria.local', path: '/', svc: 'prometheus-server:80', tls: false, cls: 'traefik' },
];
const k8sConfig = [
  { name: 'storefront-env', ns: 'shop-staging', kind: 'ConfigMap', keys: ['API_URL', 'NEXT_PUBLIC_REGION', 'LOG_LEVEL'], age: 6 * DB.day },
  { name: 'checkout-secrets', ns: 'shop-staging', kind: 'Secret', type: 'Opaque', keys: ['STRIPE_KEY', 'DATABASE_URL'], age: 6 * DB.day },
  { name: 'orders-db-credentials', ns: 'shop-staging', kind: 'Secret', type: 'Opaque', keys: ['username', 'password'], age: 6 * DB.day },
  { name: 'prometheus-server', ns: 'monitoring', kind: 'ConfigMap', keys: ['prometheus.yml', 'alerting_rules.yml'], age: 6 * DB.day },
  { name: 'coredns', ns: 'kube-system', kind: 'ConfigMap', keys: ['Corefile', 'NodeHosts'], age: 6 * DB.day },
  { name: 'k3s-serving', ns: 'kube-system', kind: 'Secret', type: 'kubernetes.io/tls', keys: ['tls.crt', 'tls.key'], age: 6 * DB.day },
];
const k8sAge = (ms) => fmt.dur(Date.now() - ms);

App.view('kubernetes', {
  title: 'Kubernetes',
  get flush() { return App.parse().params[0] === 'pod'; },
  crumbs: ({ params }) => params[0] === 'pod' ? `<a href="#/kubernetes" data-go="/kubernetes">Kubernetes</a>${icon('chevron-right')}<b>${esc(params[1])}</b>` : '<b>Kubernetes</b>',
  tools: ({ params }) => K().enabled && params[0] !== 'pod' ? `<button class="btn btn-ghost btn-icon" data-copy="kubectl config use-context ${K().context}" data-tip="Copy kubectl context command">${icon('copy')}</button><button class="btn btn-ghost btn-icon" data-menu="k8s-cluster" data-align="end" data-tip="Cluster">${icon('dots')}</button>` : '',
  render(ctx) {
    if (ctx.params[0] === 'pod') return podDetail(ctx.params[1], ctx.query.tab || 'logs');
    const k = K();
    if (!k.enabled) return `<div class="empty" style="padding-top:96px">${tile({ icon: 'cx-kube', th: 255 }, 'tile-xl')}<h2 class="h-sec">Kubernetes is off</h2><p>Turn it on to run a single-node k3s cluster inside the engine. It uses about 400 MB and shares images with Docker, so local builds deploy without a registry.</p><button class="btn btn-brand btn-lg" data-act="k8s-enable">${icon('power')}Turn on Kubernetes</button></div>`;
    if (k.starting) return `<div class="page-head"><h1 class="h-page">Kubernetes</h1></div><div class="page"><p class="meta">Starting k3s ${esc(k.version)}…</p><div class="progress is-indeterminate" style="width:240px;margin:8px 0 24px"><i></i></div>${Array.from({ length: 6 }, (_, i) => `<div class="row" style="height:36px;border-bottom:.5px solid var(--line)"><span class="skel" style="width:${180 + (i * 37) % 120}px"></span><span class="skel right" style="width:60px"></span></div>`).join('')}</div>`;
    const tab = ctx.params[0] || 'pods';
    const pods = k.pods.filter(inNs).sort((a, b) => podBad(b) - podBad(a));
    const bad = k.pods.filter(podBad);
    const count = { pods: pods.length, deployments: k.deployments.filter(inNs).length, services: k.services.filter(inNs).length, ingress: k8sIngress.filter(inNs).length, config: k8sConfig.filter(inNs).length };
    return `
      <div class="rs-head" style="padding-bottom:12px">
        ${tile({ icon: 'cx-kube', th: 255 }, 'tile-lg')}
        <div class="col gap-4 grow"><h1 class="h-page">Kubernetes</h1><div class="rs-meta"><span>k3s ${esc(k.version)}</span><span>Context <code class="mono-sm">${esc(k.context)}</code></span><span>${k.nodes} node</span><span>${k.pods.reduce((a, p) => a + p.memMB, 0)} MB</span></div></div>
        <label class="row" data-tip="Stop the cluster. Workloads come back when you turn it on."><span class="meta">Running</span><span class="switch"><input type="checkbox" checked data-k8s-toggle aria-label="Kubernetes"><span></span></span></label>
        <button class="btn btn-brand" data-act="k8s-apply">${icon('file-upload')}Apply YAML</button>
      </div>
      ${bad.length ? `<div style="padding:0 20px 14px"><div class="banner banner-bad">${icon('alert-triangle')}<span class="grow"><b>${esc(bad[0].name)}</b> is crash-looping in ${esc(bad[0].ns)}: back-off restarting failed container, exit code 1, ${bad[0].restarts} restarts.</span><button class="btn btn-sm" data-go="/kubernetes/pod/${esc(bad[0].name)}?tab=logs">View logs</button><button class="btn btn-sm" data-act="k8s-describe" data-arg="${esc(bad[0].name)}">Describe</button></div></div>` : ''}
      <div class="tabs" role="tablist">${[['pods', 'Pods'], ['deployments', 'Deployments'], ['services', 'Services'], ['ingress', 'Ingress'], ['config', 'Config and secrets']].map(([kk, l]) => `<button class="tab" role="tab" aria-selected="${tab === kk}" data-go="/kubernetes/${kk}">${l}<span class="count">${count[kk]}</span></button>`).join('')}</div>
      <div class="toolbar" style="padding-top:12px">
        <button class="btn" data-menu="k8s-ns">${icon('box', 'sm')}${k8sNs === 'all' ? 'All namespaces' : esc(k8sNs)}${icon('selector', 'sm ink-3')}</button>
        <div class="search">${icon('search')}<input class="input" placeholder="Filter ${tab === 'config' ? 'config' : tab}" aria-label="Filter"><span class="kbd">/</span></div>
      </div>
      <div class="tbl-wrap">${({ pods: podTable, deployments: deployTable, services: svcTable, ingress: ingressTable, config: configTable }[tab] || podTable)(pods)}
        <div class="empty hide" data-rs-empty>${icon('filter-off', 'lg')}<p>Nothing in ${k8sNs === 'all' ? 'any namespace' : esc(k8sNs)} matches.</p></div></div>`;
  },
  mount(root, ctx) {
    if (ctx.params[0] === 'pod') { mountLogs(root, { live: podLive(ctx.params[1]) }); mountTerminal(root); return; }
    rsFilter(root);
    const t = $('[data-k8s-toggle]', root);
    if (t) t.onchange = () => { t.checked = true; confirmSheet({ title: 'Turn off Kubernetes?', body: `${K().pods.length} pods stop and ${K().pods.reduce((a, p) => a + p.memMB, 0)} MB goes back to macOS. Deployments, services and volumes are kept.`, action: 'Turn off', onConfirm() { K().enabled = false; App.rerender(); toast({ title: 'Kubernetes is off', body: 'Memory returned to macOS' }); } }); };
  },
});

function podTable(pods) {
  return `<table class="tbl"><thead><tr><th>Name</th><th>Namespace</th><th>Status</th><th class="r">Ready</th><th class="r">Restarts</th><th class="r">CPU</th><th class="r">Memory</th><th class="r">Age</th><th class="r"><span class="hide">Actions</span></th></tr></thead><tbody>
    ${pods.map((p) => { const bad = podBad(p), done = p.status === 'Completed'; return `<tr data-go="/kubernetes/pod/${esc(p.name)}" data-ctx="k8s-pod" data-id="${esc(p.name)}" data-f="all" data-text="${esc((p.name + ' ' + p.ns + ' ' + p.status).toLowerCase())}" class="${done ? 'is-off' : ''}">
      <td><span class="row">${tile({ name: p.name, icon: "cx-pod" }, "", bad ? "is-bad" : done ? "is-off" : "")}<span class="ink truncate" style="font-weight:500;max-width:320px">${esc(p.name)}</span></span></td>
      <td><span class="chip">${esc(p.ns)}</span></td>
      <td>${bad ? `<span class="bad-ink row gap-4">${icon('alert-triangle', 'sm')}${esc(p.status)}</span>` : done ? 'Completed' : 'Running'}</td>
      <td class="num">${esc(p.ready)}</td><td class="num ${p.restarts > 5 ? 'bad-ink' : ''}">${p.restarts}</td>
      <td class="num">${p.cpu ? p.cpu + 'm' : '—'}</td><td class="num">${p.memMB ? fmt.mb(p.memMB) : '—'}</td><td class="num ink-3">${k8sAge(p.age)}</td>
      <td class="r"><span class="row-actions"><button class="btn btn-ghost btn-icon btn-sm" data-go="/kubernetes/pod/${esc(p.name)}?tab=logs" data-tip="Logs">${icon('logs')}</button><button class="btn btn-ghost btn-icon btn-sm" data-go="/kubernetes/pod/${esc(p.name)}?tab=terminal" data-tip="Exec shell" ${bad || done ? 'disabled' : ''}>${icon('terminal-2')}</button><button class="btn btn-ghost btn-icon btn-sm" data-menu="k8s-pod" data-id="${esc(p.name)}" data-align="end" data-tip="More">${icon('dots')}</button></span></td></tr>`; }).join('')}
  </tbody></table>`;
}
function deployTable() {
  return `<table class="tbl"><thead><tr><th>Name</th><th>Namespace</th><th>Ready</th><th class="r">Up to date</th><th class="r">Available</th><th>Image</th><th class="r">Age</th><th class="r"><span class="hide">Actions</span></th></tr></thead><tbody>
    ${K().deployments.filter(inNs).map((d) => { const [r, w] = d.ready.split('/').map(Number), bad = r < w; return `<tr data-ctx="k8s-deploy" data-id="${esc(d.name)}" data-f="all" data-text="${esc((d.name + ' ' + d.ns + ' ' + d.image).toLowerCase())}">
      <td><span class="row"><span class="tile ${bad ? 'is-bad' : ''}" style="--th:255">${icon(bad ? 'alert-triangle' : 'cx-image')}</span><span class="ink" style="font-weight:500">${esc(d.name)}</span></span></td><td><span class="chip">${esc(d.ns)}</span></td>
      <td><span class="row"><span class="meter ${bad ? 'is-bad' : ''}" style="--v:${w ? Math.max(r / w, 0.04) : 0}"><i></i></span><span class="num ${bad ? 'bad-ink' : ''}">${esc(d.ready)}</span></span></td>
      <td class="num">${d.upToDate}</td><td class="num">${d.available}</td><td><code class="mono-sm ink-3 truncate">${esc(d.image)}</code></td><td class="num ink-3">${k8sAge(d.age)}</td>
      <td class="r"><span class="row-actions"><button class="btn btn-ghost btn-icon btn-sm" data-act="k8s-scale" data-arg="${esc(d.name)}" data-tip="Scale">${icon('scale')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="k8s-restart" data-arg="${esc(d.name)}" data-tip="Rollout restart">${icon('rotate-clockwise')}</button><button class="btn btn-ghost btn-icon btn-sm" data-menu="k8s-deploy" data-id="${esc(d.name)}" data-align="end" data-tip="More">${icon('dots')}</button></span></td></tr>`; }).join('')}
  </tbody></table>`;
}
function svcTable() {
  return `<table class="tbl"><thead><tr><th>Name</th><th>Namespace</th><th>Type</th><th>Cluster IP</th><th>Ports</th><th>From your Mac</th></tr></thead><tbody>
    ${K().services.filter(inNs).map((s) => `<tr data-f="all" data-text="${esc((s.name + ' ' + s.ns + ' ' + s.type).toLowerCase())}">
      <td><span class="row"><span class="tile" style="--th:200">${icon('route')}</span><span class="ink" style="font-weight:500">${esc(s.name)}</span></span></td><td><span class="chip">${esc(s.ns)}</span></td>
      <td>${esc(s.type)}</td><td><code class="mono-sm">${esc(s.clusterIP)}</code></td><td><code class="mono-sm ink-3">${esc(s.ports)}</code></td>
      <td>${s.external !== '—' ? `<a href="https://${esc(s.external)}" target="_blank" rel="noopener" class="row gap-4">${esc(s.external)}${icon('external-link', 'sm')}</a>` : `<code class="mono-sm ink-3" data-copy="${esc(s.name)}.${esc(s.ns)}.svc.cluster.local" data-tip="Copy in-cluster DNS name">${esc(s.name)}.${esc(s.ns)}.svc</code>`}</td></tr>`).join('')}
  </tbody></table>`;
}
function ingressTable() {
  return `<table class="tbl"><thead><tr><th>Name</th><th>Namespace</th><th>Host</th><th>Path</th><th>Backend</th><th>TLS</th></tr></thead><tbody>
    ${k8sIngress.filter(inNs).map((g) => `<tr data-f="all" data-text="${esc((g.name + ' ' + g.ns + ' ' + g.host).toLowerCase())}">
      <td><span class="row"><span class="tile" style="--th:200">${icon('cx-domain')}</span><span class="ink" style="font-weight:500">${esc(g.name)}</span></span></td><td><span class="chip">${esc(g.ns)}</span></td>
      <td><a href="${g.tls ? 'https' : 'http'}://${esc(g.host)}${esc(g.path)}" target="_blank" rel="noopener">${esc(g.host)}</a></td><td><code class="mono-sm">${esc(g.path)}</code></td><td><code class="mono-sm ink-3">${esc(g.svc)}</code></td>
      <td>${g.tls ? `<span class="row gap-4">${icon('lock', 'sm ok-ink')}Local CA</span>` : '<span class="ink-3">Off</span>'}</td></tr>`).join('')}
  </tbody></table>`;
}
function configTable() {
  return `<table class="tbl"><thead><tr><th>Name</th><th>Namespace</th><th>Kind</th><th>Keys</th><th class="r">Age</th></tr></thead><tbody>
    ${k8sConfig.filter(inNs).map((c) => `<tr data-f="all" data-text="${esc((c.name + ' ' + c.ns + ' ' + c.kind + ' ' + c.keys.join(' ')).toLowerCase())}" data-act="k8s-config" data-arg="${esc(c.name)}">
      <td><span class="row"><span class="tile" style="--th:${c.kind === 'Secret' ? 45 : 255}">${icon(c.kind === 'Secret' ? 'key' : 'file-settings')}</span><span class="ink" style="font-weight:500">${esc(c.name)}</span></span></td><td><span class="chip">${esc(c.ns)}</span></td>
      <td>${c.kind}${c.type ? ` <span class="meta mono-sm">${esc(c.type)}</span>` : ''}</td><td><span class="row gap-4">${c.keys.map((k) => `<span class="chip chip-mono">${esc(k)}</span>`).join('')}</span></td><td class="num ink-3">${k8sAge(c.age)}</td></tr>`).join('')}
  </tbody></table>`;
}

App.menu('k8s-ns', () => [{ heading: 'Namespace' }, { label: 'All namespaces', checked: k8sNs === 'all', run: () => { k8sNs = 'all'; App.rerender(); } }, { sep: true }, ...K().namespaces.map((n) => ({ label: n, checked: k8sNs === n, run: () => { k8sNs = n; App.rerender(); } })), { sep: true }, { label: 'New namespace…', icon: 'plus', run: () => toast({ title: 'kubectl create namespace', ic: 'terminal-2' }) }]);
App.menu('k8s-cluster', () => [
  { heading: `k3s ${K().version}` },
  { label: 'Copy kubeconfig path', icon: 'copy', run: () => toast({ title: 'Copied', body: '~/.kube/config (context containeria)', ic: 'copy' }) },
  { label: 'Open dashboard in browser', icon: 'external-link' },
  { label: 'Kubernetes settings…', icon: 'adjustments', run: () => App.go('/settings/kubernetes') },
  { sep: true },
  { label: 'Reset cluster…', icon: 'trash', danger: true, run: () => confirmSheet({ title: 'Reset the Kubernetes cluster?', body: `Every namespace, deployment, service and persistent volume claim is deleted (${K().pods.length} pods across ${K().namespaces.length} namespaces). Docker containers and images aren’t touched.`, action: 'Reset cluster', onConfirm() { toast({ title: 'Cluster reset', body: 'A fresh k3s cluster is starting', tone: 'ok' }); } }) },
]);
App.menu('k8s-pod', (el) => {
  const p = K().pods.find((x) => x.name === el.dataset.id);
  return [
    { label: 'Logs', icon: 'logs', run: () => App.go(`/kubernetes/pod/${p.name}?tab=logs`) },
    { label: 'Exec shell', icon: 'terminal-2', disabled: podBad(p), run: () => App.go(`/kubernetes/pod/${p.name}?tab=terminal`) },
    { label: 'Port forward…', icon: 'arrows-exchange', act: 'k8s-forward', arg: p.name },
    { label: 'Describe', icon: 'file-text', act: 'k8s-describe', arg: p.name },
    { label: 'Copy name', icon: 'copy', run: () => toast({ title: 'Copied', body: p.name, ic: 'copy' }) },
    { sep: true },
    { label: 'Delete pod', icon: 'trash', danger: true, run: () => confirmSheet({ title: `Delete ${p.name}?`, body: 'Its deployment schedules a replacement right away.', action: 'Delete pod', onConfirm() { toast({ title: 'Pod deleted', body: 'Replacement is starting', tone: 'ok' }); } }) },
  ];
});
App.menu('k8s-deploy', (el) => [
  { label: 'Scale…', icon: 'scale', act: 'k8s-scale', arg: el.dataset.id },
  { label: 'Rollout restart', icon: 'rotate-clockwise', act: 'k8s-restart', arg: el.dataset.id },
  { label: 'Edit YAML', icon: 'code', act: 'k8s-apply' },
  { sep: true },
  { label: 'Delete deployment', icon: 'trash', danger: true, run: () => confirmSheet({ title: `Delete ${el.dataset.id}?`, body: 'Its pods stop and aren’t replaced. Services pointing at it stop answering.', action: 'Delete deployment', onConfirm() { toast({ title: `Deleted ${el.dataset.id}`, tone: 'ok' }); } }) },
]);
App.act('k8s-enable', () => { K().enabled = true; K().starting = true; App.rerender(); setTimeout(() => { K().starting = false; if (App.route.name === 'kubernetes') App.rerender(); toast({ title: 'Kubernetes is running', body: `k3s ${K().version} · context containeria`, tone: 'ok' }); }, 2200); });
App.act('k8s-restart', (el, n) => toast({ title: `Restarting ${n}`, body: 'Rolling out new pods one at a time', ic: 'rotate-clockwise' }));
App.act('k8s-scale', (el, n) => {
  const d = K().deployments.find((x) => x.name === n), cur = +d.ready.split('/')[1];
  sheet({ title: `Scale ${n}`, width: 400,
    body: `<div class="field"><span class="label">Replicas</span><div class="row"><input type="range" class="range" min="0" max="10" value="${cur}" style="--p:${cur * 10}%" data-r><b class="ink num" style="width:24px;text-align:right" data-v>${cur}</b></div><span class="hint">Currently ${esc(d.ready)} ready.</span></div>`,
    foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Scale</button></div>`,
    onMount(s, close) { const r = $('[data-r]', s); r.oninput = () => { $('[data-v]', s).textContent = r.value; r.style.setProperty('--p', r.value * 10 + '%'); }; $('[data-ok]', s).onclick = () => { d.ready = `${Math.min(+r.value, cur)}/${r.value}`; close(); App.rerender(); toast({ title: `${n} scaled to ${r.value}`, tone: 'ok' }); }; } });
});
App.act('k8s-forward', (el, n) => sheet({ title: `Port forward ${n}`, width: 420,
  body: `<div class="rs-opts-grid"><div class="field"><span class="label">Mac port</span><input class="input mono" value="8080" inputmode="numeric"></div><div class="field"><span class="label">Pod port</span><input class="input mono" value="8080" inputmode="numeric"></div></div><p class="meta" style="margin:10px 0 0">Services are already reachable at *.k8s.containeria.local. Forward only for pods without one.</p>`,
  foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Forward</button></div>`,
  onMount(s, close) { $('[data-ok]', s).onclick = () => { close(); toast({ title: 'localhost:8080 → ' + n, tone: 'ok' }); }; } }));
App.act('k8s-describe', (el, n) => App.go(`/kubernetes/pod/${n}?tab=events`));
App.act('k8s-config', (el, n) => {
  const c = k8sConfig.find((x) => x.name === n);
  sheet({ title: n, ic: c.kind === 'Secret' ? 'key' : 'file-settings', width: 540,
    body: `<p class="meta" style="margin:0 0 10px">${c.kind} in ${esc(c.ns)}</p><dl class="kv">${c.keys.map((k) => `<dt class="mono-sm">${esc(k)}</dt><dd>${c.kind === 'Secret' ? `<code class="mono-sm grow" data-secret>••••••••••••</code><button class="btn btn-ghost btn-icon btn-sm" data-tip="Reveal" data-reveal>${icon('eye')}</button><button class="btn btn-ghost btn-icon btn-sm" data-copy="hidden-value" data-tip="Copy value">${icon('copy')}</button>` : `<code class="mono-sm truncate">${k.endsWith('.yml') ? 'global:\\n  scrape_interval: 15s' : k === 'LOG_LEVEL' ? 'info' : k === 'API_URL' ? 'http://checkout:8080' : 'eu-central'}</code>`}</dd>`).join('')}</dl>`,
    onMount(s) { s.addEventListener('click', (e) => { const b = e.target.closest('[data-reveal]'); if (b) { const v = b.previousElementSibling; v.textContent = v.textContent.startsWith('•') ? 'sk_test_51Q…e9Lx' : '••••••••••••'; } }); } });
});
App.act('k8s-apply', () => sheet({ title: 'Apply YAML', ic: 'file-upload', width: 640,
  body: `<div class="field"><span class="label">Manifest</span><textarea class="textarea mono" rows="14" spellcheck="false" style="font-size:var(--mono-13)">apiVersion: apps/v1
kind: Deployment
metadata:
  name: storefront
  namespace: shop-staging
spec:
  replicas: 2
  selector:
    matchLabels: { app: storefront }
  template:
    metadata:
      labels: { app: storefront }
    spec:
      containers:
        - name: web
          image: shop-web:dev   # local image, no registry needed
          ports: [{ containerPort: 3000 }]</textarea><span class="hint">Drop .yaml files here, or paste. Local Docker images work without pushing.</span></div>
    <div class="row" style="margin-top:12px"><span class="label">Namespace</span><select class="select" style="width:200px">${K().namespaces.map((n) => `<option ${n === 'shop-staging' ? 'selected' : ''}>${n}</option>`).join('')}</select><label class="row right"><input type="checkbox" class="check">Dry run</label></div>`,
  foot: `<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-brand" data-ok>Apply</button></div>`,
  onMount(s, close) { $('[data-ok]', s).onclick = () => { close(); toast({ title: 'deployment.apps/storefront configured', tone: 'ok' }); }; } }));

/* pod detail */
const podLogs = {
  checkout: [['12:31:02.118', 'info', 'starting checkout service v0.9.3'], ['12:31:02.240', 'info', 'loading config from /etc/checkout/config.yaml'], ['12:31:02.502', 'error', 'failed to connect to orders-db:5432: password authentication failed for user "checkout"'], ['12:31:02.503', 'error', 'fatal: database unavailable, exiting with code 1']],
  default: [['12:04:11.208', 'info', 'listening on :3000'], ['12:06:42.871', 'info', 'GET / 200 18ms'], ['12:06:43.019', 'info', 'GET /_next/static/chunks/main.js 200 2ms'], ['12:07:09.662', 'info', 'GET /api/cart 200 9ms'], ['12:08:12.342', 'debug', 'revalidated /products in 41ms']],
};
const podLive = (n) => (n.startsWith('checkout') ? [] : [['info', 'GET /healthz 200 0.4ms'], ['info', 'GET /products 200 22ms'], ['debug', 'cache hit products:list']]);
function podDetail(name, tab) {
  const p = K().pods.find((x) => x.name === name);
  if (!p) return `<div class="empty">${icon('cube-off', 'xl')}<h2 class="h-sec">${esc(name)} is gone</h2><p>Pods are replaced when they restart or scale.</p><button class="btn" data-go="/kubernetes">All pods</button></div>`;
  const bad = podBad(p), base = `/kubernetes/pod/${p.name}`;
  const app = p.name.split('-')[0];
  const events = bad
    ? [['Warning', 'BackOff', 'Back-off restarting failed container checkout in pod', '1m'], ['Normal', 'Pulled', 'Container image "shop-checkout:dev" already present on machine', '4m'], ['Warning', 'Failed', 'Error: container exited with code 1', '4m'], ['Normal', 'Created', 'Created container checkout', '51m'], ['Normal', 'Scheduled', 'Successfully assigned shop-staging/' + p.name + ' to containeria', '51m']]
    : [['Normal', 'Started', 'Started container ' + app, k8sAge(p.age)], ['Normal', 'Created', 'Created container ' + app, k8sAge(p.age)], ['Normal', 'Pulled', 'Container image already present on machine', k8sAge(p.age)], ['Normal', 'Scheduled', `Successfully assigned ${p.ns}/${p.name} to containeria`, k8sAge(p.age)]];
  const yaml = `apiVersion: v1\nkind: Pod\nmetadata:\n  name: ${p.name}\n  namespace: ${p.ns}\n  labels:\n    app: ${app}\nspec:\n  nodeName: ${p.node}\n  containers:\n    - name: ${app}\n      image: shop-${app}:dev\n      resources:\n        limits: { memory: 256Mi, cpu: 500m }\nstatus:\n  phase: ${bad ? 'Running' : p.status}\n  podIP: 10.42.0.${(name.length * 7) % 200}\n  containerStatuses:\n    - name: ${app}\n      ready: ${!bad}\n      restartCount: ${p.restarts}${bad ? '\n      state:\n        waiting:\n          reason: CrashLoopBackOff' : ''}`;
  return `${rsHead({
    face: `<span class="tile tile-lg ${bad ? 'is-bad' : ''}" style="--th:255">${icon(bad ? 'alert-triangle' : 'cube')}</span>`, title: p.name,
    meta: `<span class="chip">${esc(p.ns)}</span>${bad ? `<span class="bad-ink">${esc(p.status)} · ${p.restarts} restarts</span>` : `<span>${esc(p.status)} for ${k8sAge(p.age)}</span>`}<span>Node ${esc(p.node)}</span><span class="mono-sm">10.42.0.${(name.length * 7) % 200}</span>`,
    actions: `<button class="btn" data-act="k8s-forward" data-arg="${esc(p.name)}">${icon('arrows-exchange')}Port forward</button><button class="btn btn-ghost btn-icon" data-menu="k8s-pod" data-id="${esc(p.name)}" data-align="end" data-tip="More">${icon('dots')}</button>`,
  })}
  ${rsTabs(base, [['logs', 'Logs'], ['terminal', 'Terminal'], ['events', 'Events', events.length], ['yaml', 'YAML']], tab)}
  <div class="rs-fill">${tab === 'terminal'
    ? (bad ? `<div class="empty">${icon('terminal-2', 'xl')}<h2 class="h-sec">The container isn’t running</h2><p>It exits right after it starts, so there’s nothing to exec into. Check the logs for the reason.</p><button class="btn" data-go="${base}?tab=logs">View logs</button></div>` : terminalPane({ user: 'node', host: p.name.slice(0, 24), cwd: '/app', note: `kubectl exec -it ${p.name} -n ${p.ns} -- sh` }))
    : tab === 'events' ? `<div class="page"><ol class="rs-timeline">${events.map(([type, reason, msg, ago]) => `<li class="${type === 'Warning' ? 'is-bad' : ''}"><span class="rs-tl-dot"></span><div class="grow"><div class="row"><b class="ink">${reason}</b><span class="meta right">${ago} ago</span></div><p>${esc(msg)}</p></div></li>`).join('')}</ol></div>`
    : tab === 'yaml' ? `<div class="page"><div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn btn-sm" data-copy="${esc(yaml)}">${icon('copy', 'sm')}Copy</button><button class="btn btn-sm" data-act="k8s-apply">${icon('pencil', 'sm')}Edit and apply</button></div><pre class="code selectable">${esc(yaml)}</pre></div>`
    : logPane({ lines: podLogs[app] || podLogs.default })}</div>`;
}
