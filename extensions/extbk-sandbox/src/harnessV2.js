/**
 * harnessV2.js — the page that runs a v2 extension, against the real host.
 *
 * The v1 harness beside this one builds a context object by hand:
 * `{ registerHook, storage, navigate, toast, openBrowser, … }`. That is the
 * v1 shape, and it is the only shape the sandbox could offer. So the tool for
 * developing extensions could not run a v2 extension at all — Cloud Backup,
 * the only real one and the file every author copies, failed at activate()
 * with "Cannot read properties of undefined (reading 'register')", because
 * `authno.commands` was not a thing the sandbox had ever heard of.
 *
 * A hand-written mock of a host is a second implementation of that host, and
 * the first thing a second implementation does is drift. So this one does not
 * mock anything: `BOOTSTRAP_V2` and `createHostRouter` here are the app's own
 * files, vendored and checked by `npm run check:vendored`. What the extension
 * talks to in the sandbox is what it talks to on a phone, down to the wire
 * method names — which is also why refusing a permission here refuses it the
 * way the app does, rather than the way a mock imagines.
 *
 * The frame is a real one too: `sandbox="allow-scripts"` with no
 * allow-same-origin, an opaque origin, and one postMessage channel out.
 */

export function harnessV2Html(manifest, modules, entry) {
  const payload = JSON.stringify({ manifest, modules, entry });
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
  html,body{margin:0;background:#0f0f11;color:#e4e4f0;
    font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  #banner{padding:8px 12px;border-bottom:1px solid #2e2e38;background:#16161c;
    font-size:12px;color:#8b8b9e;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  #banner b{color:#e4e4f0;font-weight:600}
  .ok{color:#22c55e} .err{color:#ef4444} .warn{color:#f59e0b}
  #err{margin:12px;padding:12px 14px;border-radius:8px;border:1px solid #ef444455;
    background:#ef444414;color:#fca5a5;white-space:pre-wrap;font-family:ui-monospace,monospace;
    font-size:12px;display:none}
  #page{width:100%;border:0;height:calc(100vh - 39px);display:none;background:transparent}
  #idle{padding:22px 16px;color:#6b6b80}
  #idle code{color:#a78bfa;font-family:ui-monospace,monospace}
</style></head>
<body>
<div id="banner"><span id="state">starting…</span></div>
<pre id="err"></pre>
<div id="idle">
  <code>activate(authno)</code> is running against the app's real host protocol.<br>
  Fire a hook, invoke a command, or open one of this extension's pages from the left.
</div>
<iframe id="page" sandbox="allow-scripts"></iframe>

<script src="/api/protocol.js"></script>
<script>
const PAYLOAD = ${payload};
const banner = document.getElementById('state');
const errBox = document.getElementById('err');
const idle   = document.getElementById('idle');
const pageEl = document.getElementById('page');

const post = (type, data) => parent.postMessage({ __sandbox: true, type, ...data }, '*');
const logLine = (level, text) => post('log', { level, text });

function fail(what, e) {
  errBox.style.display = 'block';
  errBox.textContent = what + '\\n\\n' + (e?.stack || e?.message || String(e));
  banner.innerHTML = '<span class="err">✖ ' + what + '</span>';
  logLine('err', what + ': ' + (e?.message ?? e));
}

// ── The extension's frame ──────────────────────────────────────────────────

let router = null;
let extFrame = null;
let hooks = [];
let commands = [];

async function boot() {
  if (router) { try { await router.teardown(); } catch {} router = null; }
  if (extFrame) { extFrame.remove(); extFrame = null; }
  errBox.style.display = 'none';
  pageEl.style.display = 'none';
  idle.style.display = '';
  hooks = [];
  commands = [];

  const { manifest, modules, entry } = PAYLOAD;

  extFrame = document.createElement('iframe');
  extFrame.setAttribute('sandbox', 'allow-scripts');
  extFrame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
  extFrame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><scr'
    + 'ipt>' + window.BOOTSTRAP_V2 + '</scr' + 'ipt></head><body></body></html>';

  const send = (m) => { try { extFrame.contentWindow?.postMessage(m, '*'); } catch {} };

  router = window.createHostRouter({
    post: send,
    payload: () => ({ modules, entry, manifest, app: { name: 'AuthNo', version: 'sandbox', platform: 'sandbox' } }),
    // The router calls this for every hook the frame registers; the handler
    // stays in the frame and only the name crosses. The off() it returns is
    // called on teardown.
    registerHook: (name) => { hooks.push(name); post('registered', { hooks, commands }); return () => {}; },
    onReady: () => {
      banner.innerHTML = '<span class="ok">✔ activated</span> · <b>' + manifest.id + '</b> v' + manifest.version
        + ' · <span class="warn">apiVersion 2</span>'
        + ' · ' + hooks.length + ' hook(s) · ' + commands.length + ' command(s)';
      post('activated', { hooks, commands });
    },
    dispatch: async (method, args) => {
      // Registering a command is about this conversation, like registerHook —
      // the handler stays in the frame and fire() reaches it by name.
      if (method === 'commands.register') {
        commands.push(String(args[0]));
        post('registered', { hooks, commands });
        return true;
      }
      // Not logged here: the server records every call with its outcome and
      // broadcasts it. Tracing on this side as well produced two rows per
      // call, the first of them with no outcome yet.
      return hostCall(method, args);
    },
  });

  window.addEventListener('message', (e) => {
    if (e.source === extFrame?.contentWindow) router?.onMessage(e.data);
  });

  document.body.appendChild(extFrame);
}

/**
 * One host method, answered by the dev server.
 *
 * Everything goes over /api/host so the permission gate, the mock library and
 * the request log live in one place the author can see and change, rather than
 * being scattered through a browser-side mock.
 */
async function hostCall(method, args) {
  const r = await fetch('/api/host', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  const body = await r.json();
  if (body.error) {
    const err = new Error(body.error);
    err.name = body.name ?? 'Error';
    throw err;
  }
  return body.result;
}

// ── What the left pane asks for ────────────────────────────────────────────

window.addEventListener('message', async (e) => {
  const msg = e.data;
  if (!msg || !msg.__sandboxCmd) return;

  if (msg.cmd === 'reload') { boot(); return; }

  // One call for both. fire() is 'the host has a name the frame gave it and
  // wants the handler behind it run' — a hook the bus fired and a command a
  // button invoked are the same thing from here.
  if (msg.cmd === 'hook' || msg.cmd === 'command') {
    const out = await router?.fire?.(msg.name, [msg.args ?? {}]);
    post(msg.cmd + '-result', { name: msg.name, result: out === undefined ? null : out });
    return;
  }

  if (msg.cmd === 'page') { openPage(msg.pageId); return; }
});

/** A ui-file page, in its own frame, exactly as ExtensionPage renders one. */
function openPage(pageId) {
  const page = PAYLOAD.manifest.pages?.[pageId];
  if (!page) { logLine('err', 'No page "' + pageId + '" in the manifest'); return; }
  idle.style.display = 'none';
  pageEl.style.display = 'block';
  pageEl.src = '/page/' + encodeURIComponent(pageId);
  post('page-opened', { pageId });
}

boot().catch((e) => fail('Could not start the extension', e));
</script>
</body></html>`;
}
