/**
 * harness.js — the page that actually runs the extension.
 *
 * This is the part the sandbox was missing. Previously the "extension pane"
 * was `<iframe src="/ext/index.js">`, which makes a browser display JavaScript
 * as text. activate() was never called, no context object was ever built, and
 * the hook bus the header comment advertised did not exist. You could not
 * discover a single runtime bug in the sandbox because nothing ran.
 *
 * The harness below imports the entry point as a module and calls activate()
 * with a context whose shape matches src/utils/extensionRuntime.js. UI pages
 * are rendered in a nested sandboxed frame with window.AuthnoHostAPI installed,
 * mirroring how ExtensionPage.jsx does it on device.
 */

export function harnessHtml(manifest) {
  const m = JSON.stringify(manifest);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
  html,body{margin:0;background:#0f0f11;color:#e4e4f0;
    font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  #banner{padding:8px 12px;border-bottom:1px solid #2e2e38;background:#16161c;
    font-size:12px;color:#8b8b9e;display:flex;gap:8px;align-items:center}
  #banner b{color:#e4e4f0;font-weight:600}
  .ok{color:#22c55e} .err{color:#ef4444}
  #err{margin:12px;padding:12px 14px;border-radius:8px;border:1px solid #ef444455;
    background:#ef444414;color:#fca5a5;white-space:pre-wrap;font-family:ui-monospace,monospace;
    font-size:12px;display:none}
  #page{width:100%;border:0;height:calc(100vh - 39px);display:none;background:transparent}
  #idle{padding:22px 16px;color:#6b6b80}
</style></head>
<body>
<div id="banner"><span id="state">starting…</span></div>
<pre id="err"></pre>
<div id="idle">activate() is running. Fire a hook from the left panel, or open one of this extension's pages.</div>
<iframe id="page" sandbox="allow-scripts allow-same-origin"></iframe>

<script type="module">
const MANIFEST = ${m};
const post = (type, data) => parent.postMessage({ __sandbox: true, type, ...data }, '*');
const banner = document.getElementById('state');
const errBox = document.getElementById('err');

function fail(where, e) {
  const msg = (e && e.stack) || String(e);
  errBox.textContent = where + '\\n\\n' + msg;
  errBox.style.display = 'block';
  banner.innerHTML = '<span class="err">✘ ' + where + '</span>';
  post('log', { level: 'err', text: where + ': ' + (e?.message ?? e) });
}

// ── Server-backed storage, so values survive a reload the way they survive an
//    app restart on device. Same six methods as the real ExtStorage.
const api = (p, body) => fetch(p, body
  ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  : undefined).then(r => r.json());

const storage = {
  async get(k)            { return (await api('/api/storage/get?key=' + encodeURIComponent(k))).value; },
  async set(k, v)         { await api('/api/storage/set', { key: k, value: v === null || v === undefined ? null : String(v) }); },
  async remove(k)         { return storage.set(k, null); },
  async getJSON(k, fb = null) {
    const raw = await storage.get(k);
    if (raw === null || raw === undefined) return fb;
    try { return JSON.parse(raw); } catch { return fb; }
  },
  async setJSON(k, v)     { return storage.set(k, JSON.stringify(v)); },
  async keys()            { return (await api('/api/storage/keys')).keys; },
};

// ── Hook bus, mirroring src/utils/sessionHooks.js: sequential, awaited, and a
//    throwing handler never blocks the next one.
const hooks = {};
function registerHook(name, handler) {
  if (typeof handler !== 'function') return () => {};
  (hooks[name] ??= []).push(handler);
  post('hook-registered', { name, count: hooks[name].length });
  return () => {
    const i = hooks[name].indexOf(handler);
    if (i !== -1) hooks[name].splice(i, 1);
  };
}
async function fire(name, payload) {
  const list = hooks[name] ?? [];
  post('log', { level: list.length ? 'ok' : 'warn',
    text: list.length ? \`fired \${name} → \${list.length} handler(s)\` : \`fired \${name} → nobody is listening\` });
  for (const fn of list) {
    try { await fn(payload); }
    catch (e) { post('log', { level: 'err', text: \`\${name} handler threw: \${e.message}\` }); }
  }
}

// ── UI pages, in a nested frame with the host bridge installed ──────────────
async function openPage(pageId) {
  const def = MANIFEST.contributes?.pages?.[pageId];
  if (!def) return post('log', { level: 'err', text: \`no page "\${pageId}" in the manifest\` });
  if (def.type !== 'ui-file') {
    return post('log', { level: 'warn', text: \`page "\${pageId}" is type \${def.type}; the sandbox only renders ui-file pages\` });
  }
  const code = await fetch('/ext/' + def.file).then(r => r.ok ? r.text() : Promise.reject(new Error(def.file + ' — ' + r.status)));
  const bridge = await fetch('/api/bridge.js').then(r => r.text());
  const frame = document.getElementById('page');
  document.getElementById('idle').style.display = 'none';
  frame.style.display = 'block';
  frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<style>html,body{margin:0;background:transparent;color:#e4e4f0;font:14px system-ui}</style>'
    + '<scr' + 'ipt>' + bridge + '</scr' + 'ipt></head><body><scr' + 'ipt type="module">'
    + code + '</scr' + 'ipt></body></html>';
  post('log', { level: 'ok', text: \`opened page "\${pageId}" (\${def.file})\` });
}

// ── Run activate() ──────────────────────────────────────────────────────────
let deactivate = null;
const ownedUnsubs = [];

async function boot() {
  try {
    if (deactivate) { try { deactivate(); } catch {} deactivate = null; }
    for (const off of ownedUnsubs.splice(0)) { try { off(); } catch {} }
    for (const k of Object.keys(hooks)) delete hooks[k];

    // Cache-bust so a reload picks up the edit.
    const mod = await import('/ext/index.js?t=' + Date.now());
    if (typeof mod.activate !== 'function') {
      throw new Error('index.js has no exported activate() function.\\n'
        + 'It must be a named export: export function activate(ctx) { … }\\n'
        + '(export default will not be found.)');
    }

    const tracked = (name, fn) => { const off = registerHook(name, fn); ownedUnsubs.push(off); return off; };

    const result = mod.activate({
      registerHook: tracked,
      storage,
      navigate: (_ext, pageId) => openPage(pageId),
      extension: MANIFEST,
      toast: (msg, opts = {}) => post('toast', { text: String(msg), variant: opts.variant ?? 'info' }),
      openBrowser: async (url) => { post('log', { level: 'warn', text: 'openBrowser → ' + url + ' (stubbed)' }); window.open(url, '_blank', 'noopener'); },
      closeBrowser: async () => post('log', { level: 'warn', text: 'closeBrowser (stubbed)' }),
      googleSignIn: async () => { throw new Error('googleSignIn is native-only and is not simulated in the sandbox'); },
      app: { name: 'AuthNo', version: 'sandbox', platform: 'android' },
    });

    if (result && typeof result.then === 'function') {
      post('log', { level: 'warn', text: 'activate() returned a Promise — it must be synchronous, or your teardown never runs on device' });
    }
    deactivate = typeof result === 'function' ? result : null;

    banner.innerHTML = '<span class="ok">✔ activated</span> · <b>' + MANIFEST.id + '</b> v' + MANIFEST.version
      + ' · ' + Object.keys(hooks).length + ' hook(s)';
    errBox.style.display = 'none';
    post('activated', { hooks: Object.fromEntries(Object.entries(hooks).map(([k, v]) => [k, v.length])) });
  } catch (e) {
    fail('activate() failed', e);
  }
}

// The nested ui-file frame posts api-call to ITS parent, which is this
// harness. Dispatch against the same allow-list the device bridge uses; an
// unknown method must reject here exactly as it would there.
async function handleBridge(method, args) {
  switch (method) {
    case 'storage.get':   return storage.get(args[0]);
    case 'storage.set':   return storage.set(args[0], args[1]);
    case 'navigate':      return openPage(args[0]);
    case 'host.toast':    post('toast', { text: String(args[0]), variant: args[1]?.variant ?? 'info' }); return null;
    case 'openBrowser':   window.open(args[0], '_blank', 'noopener'); return null;
    case 'closeBrowser':  return null;
    case 'host.getSession':  return (await api('/api/session')).slim;
    case 'getSessions':      return (await api('/api/sessions')).sessions;
    case 'host.getConfig':   return (await api('/api/config')).config;
    case 'host.setConfig':   return (await api('/api/config', { patch: args[0] })).config;
    case 'host.getAppInfo':  return { name: 'AuthNo', version: 'sandbox', platform: 'android' };
    case 'exportSessionAs':  return { filename: 'mock.' + args[1], base64: '', mimeType: 'text/plain' };
    case 'importSession':
    case 'encodeSession':
    case 'host.encodeSession':
    case 'host.setBookExternalId':
      post('log', { level: 'warn', text: method + ' is stubbed in the sandbox' });
      return null;
    default:
      throw new Error('Unknown bridge method: ' + method);
  }
}

window.addEventListener('message', async (e) => {
  const m = e.data;

  if (m && m.type === 'api-call') {
    const frame = document.getElementById('page');
    if (e.source !== frame.contentWindow) return;
    try {
      const result = await handleBridge(m.method, m.args ?? []);
      frame.contentWindow.postMessage({ type: 'api-result', id: m.id, result }, '*');
    } catch (err) {
      frame.contentWindow.postMessage({ type: 'api-result', id: m.id, error: err.message }, '*');
      post('log', { level: 'err', text: 'bridge: ' + err.message });
    }
    return;
  }
  if (m && m.type === 'ext-close') {
    document.getElementById('page').style.display = 'none';
    document.getElementById('idle').style.display = 'block';
    return;
  }

  if (!m || !m.__sandboxCmd) return;
  if (m.cmd === 'fire')   fire(m.name, m.payload);
  if (m.cmd === 'reload') boot();
  if (m.cmd === 'page')   openPage(m.pageId).catch((err) => fail('opening page', err));
});

window.addEventListener('error', (e) => post('log', { level: 'err', text: 'uncaught: ' + e.message }));
window.addEventListener('unhandledrejection', (e) => post('log', { level: 'err', text: 'unhandled rejection: ' + (e.reason?.message ?? e.reason) }));

boot();
</script>
</body></html>`;
}

/**
 * The bridge script injected into ui-file pages, kept byte-comparable with the
 * one ExtensionPage.jsx builds so a page that works here works on device.
 */
export function bridgeJs() {
  return `(function(){
  var _p = {}, _seq = 0;
  function call(method, args) {
    return new Promise(function (res, rej) {
      var id = ++_seq; _p[id] = { res: res, rej: rej };
      window.parent.postMessage({ type: 'api-call', id: id, method: method, args: args }, '*');
    });
  }
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || m.type !== 'api-result') return;
    var p = _p[m.id]; if (!p) return; delete _p[m.id];
    if (m.error) p.rej(new Error(m.error)); else p.res(m.result);
  });
  window.AuthnoHostAPI = {
    version: 2,
    extension: window.__EXT_MANIFEST__ || {},
    storage: {
      get:     function (k)    { return call('storage.get', [k]); },
      set:     function (k, v) { return call('storage.set', [k, v]); },
      remove:  function (k)    { return call('storage.set', [k, null]); },
      getJSON: function (k, f) { return call('storage.get', [k]).then(function (v) {
        if (v === null || v === undefined) return f === undefined ? null : f;
        try { return JSON.parse(v); } catch (e) { return f === undefined ? null : f; } }); },
      setJSON: function (k, v) { return call('storage.set', [k, JSON.stringify(v)]); },
    },
    navigate:     function (id)        { return call('navigate', [id]); },
    close:        function ()          { window.parent.postMessage({ type: 'ext-close' }, '*'); },
    toast:        function (m, o)      { return call('host.toast', [m, o || {}]); },
    openBrowser:  function (u)         { return call('openBrowser', [u]); },
    closeBrowser: function ()          { return call('closeBrowser', []); },
    getSession:   function ()          { return call('host.getSession', []); },
    getSessions:  function ()          { return call('getSessions', []); },
    encodeSession:function (s)         { return call('host.encodeSession', [s]); },
    exportSessionAs: function (s, f)   { return call('exportSessionAs', [s, f]); },
    importSession:   function (b)      { return call('importSession', [b]); },
    setBookExternalId: function (b, x) { return call('host.setBookExternalId', [b, x]); },
    getConfig:    function ()          { return call('host.getConfig', []); },
    setConfig:    function (p)         { return call('host.setConfig', [p]); },
    getAppInfo:   function ()          { return call('host.getAppInfo', []); },
  };
})();`;
}
