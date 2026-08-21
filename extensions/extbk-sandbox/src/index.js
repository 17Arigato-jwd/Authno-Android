#!/usr/bin/env node
/**
 * extbk-sandbox — v2.0.0
 *
 * Local development server for AuthNo .extbk extensions.
 *
 *   • Serves the bundled React app at /app/ (if present) — run your code immediately
 *   • Serves extension source files under /ext/ with hot-reload via WebSocket
 *   • Mock AuthNo session API — simulates sessionHooks, storage, and navigation
 *   • Split-pane UI: React app preview on the left, extension sandbox on the right
 *   • Browser UI at http://localhost:<port>
 *
 * Usage:
 *   extbk-sandbox [extDir] [--port 3747]
 *
 * The bundled app/ directory is co-located with this install (placed there by CI).
 * If absent, the left pane shows a placeholder and only the extension sandbox runs.
 */

import path              from 'path';
import fs                from 'fs';
import http              from 'http';
import { fileURLToPath } from 'url';
import { program }       from 'commander';
import express           from 'express';
import { WebSocketServer } from 'ws';
import chokidar          from 'chokidar';
import chalk             from 'chalk';
import { harnessHtml, bridgeJs } from './harness.js';
import { harnessV2Html } from './harnessV2.js';
import { SandboxHost } from './hostV2.js';
import { planModuleGraph, rewriteSpecifiers } from './moduleGraph.js';
import { makeLibrary, slimSession, sessionList, HOOKS } from './mock.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = path.resolve(__dirname, '..');

const DEFAULT_PORT = 3747;

program
  .name('extbk-sandbox')
  .description('AuthNo extension dev server — hot reload + React preview + mock API')
  .version('2.0.0')
  .argument('[extDir]', 'Extension source directory (must contain manifest.json + index.js)', '.')
  .option('-p, --port <port>', 'Port to listen on', String(DEFAULT_PORT))
  .parse();

const [extDir]       = program.args;
const { port: portStr } = program.opts();
const port           = parseInt(portStr, 10);
const src            = path.resolve(extDir ?? '.');
// The bundled-app pane is gone. It served a compiled copy of AuthNo itself
// beside the extension — half the screen, most of the installer's size, and
// nothing an extension author can act on. What replaced it is the space: the
// permission switches, the command list and the host-call log all needed room,
// and all three are about the extension rather than the app around it.

// ─── Validate extension directory ─────────────────────────────────────────────

if (!fs.existsSync(path.join(src, 'manifest.json')))
  fatal(`No manifest.json found in ${src}`);
if (!fs.existsSync(path.join(src, 'index.js')))
  fatal(`No index.js found in ${src}`);

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
} catch (e) {
  fatal(`manifest.json parse error: ${e.message}`);
}

const IS_V2 = manifest.apiVersion === 2;

/**
 * The extension's modules, planned the way the app plans them.
 *
 * A v2 extension is a module graph, not one file: the entry imports siblings
 * and the host loads all of them into the frame with the specifiers rewritten.
 * Reading only index.js — which is what the v1 path does — gets you an
 * extension that fails on its first import.
 */
function planGraph(entry) {
  const files = {};
  const walk = (dir, prefix = '') => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      if (name.name.startsWith('.') || name.name === 'node_modules' || name.name === 'test') continue;
      const full = path.join(dir, name.name);
      const rel = prefix ? `${prefix}/${name.name}` : name.name;
      if (name.isDirectory()) walk(full, rel);
      else if (rel.endsWith('.js')) files[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(src);

  const { order, missing, cycle } = planModuleGraph(files, entry);
  if (cycle) throw new Error(`${entry} has a circular import: ${cycle.join(' → ')}`);
  if (missing.length) {
    throw new Error(`${missing[0].from} imports "${missing[0].spec}", which is not in this directory`);
  }
  const placeholders = {};
  order.forEach((p2, i) => { placeholders[p2] = `__authno_mod_${i}__`; });
  return order.map((p2) => ({
    path: p2,
    source: rewriteSpecifiers(p2, files[p2], files, (t) => placeholders[t]),
  }));
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Sandbox shell UI
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(sandboxShellHtml(manifest, port, IS_V2));
});

// Extension source files (no cache — always fresh)
app.use('/ext', express.static(src, { etag: false, maxAge: 0 }));

// ── Mock session API ───────────────────────────────────────────────────────────

let library     = makeLibrary();
let mockSession = library[0];
/** Per-extension key-value store, matching the namespaced one on device. */
const extStorage = new Map();
/** The credential store an auth-form page writes on device. */
let extConfig = {};

/** The v2 host: one place answering every call, with the grants in front. */
const hostV2 = new SandboxHost({ library, storage: extStorage, config: extConfig });
hostV2.seedGrants(manifest);

// The harness: imports the entry point and calls activate(). This replaced
// `<iframe src="/ext/index.js">`, which merely displayed the source as text.
//
// Which harness depends on the manifest. A v2 extension gets the app's real
// protocol — the same BOOTSTRAP_V2 and host router that run on a phone —
// because the v1 context object this sandbox used to build for everything is
// not a thing a v2 extension can use. It failed at activate() on the first
// `authno.commands.register`, which is to say the tool for developing
// extensions could not run the only extension there is.
app.get('/harness', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!IS_V2) { res.send(harnessHtml(manifest)); return; }
  try {
    res.send(harnessV2Html(manifest, planGraph(manifest.entry ?? 'index.js'), manifest.entry ?? 'index.js'));
  } catch (e) {
    res.send(`<!DOCTYPE html><body style="background:#0f0f11;color:#fca5a5;font:13px ui-monospace,monospace;padding:20px">`
      + `<b>This extension could not be loaded.</b><br><br>${escapeHtml(e.message)}</body>`);
  }
});

/** The protocol itself, as a classic script the harness can include. */
app.get('/api/protocol.js', (_req, res) => {
  const file = path.join(__dirname, 'sandboxProtocol.js');
  const source = fs.readFileSync(file, 'utf8').replace(/^export /gm, '');
  if (!/function frameBootstrap\(/.test(source) || !/function createHostRouter\(/.test(source)) {
    res.status(500).send('// sandboxProtocol.js has been restructured; re-vendor it');
    return;
  }
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`${source}\nwindow.BOOTSTRAP_V2 = BOOTSTRAP_V2;\nwindow.createHostRouter = createHostRouter;\n`);
});

/** Every host call the extension makes, answered here so the log sees it. */
app.post('/api/host', async (req, res) => {
  const { method, args } = req.body ?? {};
  try {
    const result = await hostV2.dispatch(String(method), Array.isArray(args) ? args : []);
    broadcast({ type: 'wire', call: hostV2.calls.at(-1) });
    res.json({ result: result ?? null });
  } catch (e) {
    broadcast({ type: 'wire', call: hostV2.calls.at(-1) });
    res.json({ error: e?.message ?? String(e), name: e?.name ?? 'Error' });
  }
});

/** The permission switches — the sandbox's most useful development feature. */
app.get('/api/permissions', (_req, res) => {
  res.json({
    declared: Object.entries(manifest.permissions ?? {}).map(([name, spec]) => ({
      name, reason: spec?.reason ?? null, granted: hostV2.grants.get(name) !== false,
    })),
  });
});
app.post('/api/permissions', (req, res) => {
  const { name, granted } = req.body ?? {};
  hostV2.setGrant(String(name), !!granted);
  res.json({ ok: true, granted: hostV2.grants.get(String(name)) });
});

/** What the extension registered, and what it has called. */
app.get('/api/calls', (_req, res) => res.json({ calls: hostV2.calls.slice(-200) }));
app.post('/api/calls/clear', (_req, res) => { hostV2.calls.length = 0; res.json({ ok: true }); });

app.get('/api/bridge.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.send(bridgeJs());
});

// ── Scoped storage ────────────────────────────────────────────────────────────
app.get('/api/storage/get', (req, res) =>
  res.json({ value: extStorage.has(req.query.key) ? extStorage.get(req.query.key) : null }));

app.post('/api/storage/set', (req, res) => {
  const { key, value } = req.body ?? {};
  if (value === null || value === undefined) extStorage.delete(key);
  else extStorage.set(key, String(value));
  broadcast({ type: 'storage', keys: [...extStorage.keys()] });
  res.json({ ok: true });
});

app.get('/api/storage/keys', (_req, res) => res.json({ keys: [...extStorage.keys()] }));

app.post('/api/storage/clear', (_req, res) => {
  extStorage.clear();
  broadcast({ type: 'storage', keys: [] });
  res.json({ ok: true });
});

// ── Config (what an auth-form page writes) ───────────────────────────────────
app.get('/api/config', (_req, res) => res.json({ config: extConfig }));
app.post('/api/config', (req, res) => {
  extConfig = { ...extConfig, ...(req.body?.patch ?? {}) };
  res.json({ config: extConfig });
});

// ── Library ──────────────────────────────────────────────────────────────────
app.get('/api/sessions', (_req, res) => res.json({ sessions: sessionList(library) }));

app.post('/api/session/select', (req, res) => {
  const found = library.find((b) => b.id === req.body?.id);
  if (found) { mockSession = found; broadcast({ type: 'session-updated', session: mockSession }); }
  res.json({ ok: Boolean(found) });
});

app.get('/api/session', (_req, res) => res.json({ ...mockSession, slim: slimSession(mockSession) }));

// Every hook the real host fires, not just onSave.
app.get('/api/hooks', (_req, res) =>
  res.json({ hooks: HOOKS.map(({ name, label, key }) => ({ name, label, key: key ?? name })) }));

app.post('/api/hooks/fire', (req, res) => {
  const key = req.body?.key;
  const def = HOOKS.find((h) => (h.key ?? h.name) === key);
  if (!def) return res.status(404).json({ error: `Unknown hook: ${key}` });
  log(`${chalk.dim('[mock]')} fire ${def.name} (${def.label})`);
  broadcast({ type: 'fire-hook', name: def.name, payload: def.payload(mockSession) });
  res.json({ ok: true });
});

app.post('/api/session', (req, res) => {
  mockSession = { ...mockSession, ...req.body, updatedAt: new Date().toISOString() };
  log(`${chalk.dim('[mock]')} session updated`);
  broadcast({ type: 'session-updated', session: mockSession });
  res.json(mockSession);
});

app.post('/api/hooks/onSave', (req, res) => {
  const trigger = req.body?.trigger ?? 'manual';
  log(`${chalk.dim('[mock]')} fireHook onSave trigger=${trigger}`);
  broadcast({ type: 'hook', name: 'onSave', payload: { session: mockSession, trigger } });
  res.json({ ok: true });
});

app.post('/api/reset', (_req, res) => {
  mockSession = makeMockSession();
  broadcast({ type: 'session-reset', session: mockSession });
  res.json(mockSession);
});

// App-specific: allow the React app to fetch the current mock session
// and trigger its own save simulation via the sandbox API
app.post('/api/app/save', (req, res) => {
  const patch = req.body ?? {};
  mockSession = { ...mockSession, ...patch, updatedAt: new Date().toISOString() };
  broadcast({ type: 'hook', name: 'onSave', payload: { session: mockSession, trigger: 'autosave' } });
  broadcast({ type: 'session-updated', session: mockSession });
  log(`${chalk.dim('[app]')} save triggered → broadcasting onSave(autosave)`);
  res.json({ ok: true });
});

// ─── HTTP + WebSocket server ───────────────────────────────────────────────────

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'session-updated', session: mockSession }));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

// ─── File watcher — hot reload ─────────────────────────────────────────────────

// node_modules was previously watched too, which pinned thousands of file
// handles and fired a reload storm on any npm install.
const watcher = chokidar.watch(src, {
  ignored: [
    /(^|[/\\])\../,
    /[/\\]node_modules[/\\]/,
    /\.(extbk|thmbk)$/,
  ],
  persistent: true,
  ignoreInitial: true,
});

watcher.on('all', (event, filePath) => {
  const rel = path.relative(src, filePath);
  log(`${chalk.dim('[watch]')} ${event}: ${chalk.cyan(rel)}`);
  broadcast({ type: 'reload', file: rel, event });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    fatal(`Port ${port} is already in use.\n  Another sandbox may be running — try ${chalk.cyan(`--port ${port + 1}`)}.`);
  }
  fatal(`Server error: ${e.message}`);
});

server.listen(port, () => {
  log('');
  log(chalk.bold('extbk-sandbox') + chalk.dim(' v2.0.0'));
  log(chalk.dim('─'.repeat(46)));
  log(`  Extension  : ${chalk.cyan(manifest.name)} ${chalk.dim(`(${manifest.id} v${manifest.version})`)}`);
  log(`  Directory  : ${chalk.dim(src)}`);
  log(`  Sandbox    : ${chalk.underline.cyan(`http://localhost:${port}`)}`);
  log(`  API        : ${IS_V2 ? chalk.green('apiVersion 2') : chalk.yellow('apiVersion 1')} ${chalk.dim(IS_V2 ? '(real host protocol)' : '(legacy context object)')}`);
  const declared = Object.keys(manifest.permissions ?? {});
  if (declared.length) log(`  Permissions: ${chalk.dim(declared.join(', '))}`);
  log('');
  log(chalk.dim('  Watching for file changes…'));
  log('');
});

// ─── Mock session factory ─────────────────────────────────────────────────────

function makeMockSession() {
  return {
    id:         'mock-session-001',
    title:      'My Test Book',
    filePath:   null,
    content:    '<p>Hello from the AuthNo sandbox. Edit me!</p>',
    wordCount:  8,
    chapters: [
      { id: 'ch-1', title: 'Chapter 1', content: '<p>Chapter content here.</p>', synopsis: '' },
      { id: 'ch-2', title: 'Chapter 2', content: '', synopsis: '' },
    ],
    characters: [],
    pinned:     false,
    color:      '#6366f1',
    goalWords:  1000,
    streakDays: 3,
    createdAt:  new Date(Date.now() - 86400000 * 7).toISOString(),
    updatedAt:  new Date().toISOString(),
  };
}

// ─── Sandbox shell HTML ───────────────────────────────────────────────────────

function sandboxShellHtml(manifest, wsPort, isV2) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>extbk-sandbox — ${escHtml(manifest.name)}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#0f0f11;--bg2:#1a1a1f;--bg3:#26262e;
      --border:#2e2e38;--text:#e4e4f0;--muted:#6b6b80;
      --accent:#6366f1;--green:#22c55e;--red:#ef4444;--yellow:#eab308;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:14px;color:var(--text);background:var(--bg);
    }
    body{display:flex;flex-direction:column;height:100vh;overflow:hidden}
    header{
      display:flex;align-items:center;gap:10px;
      padding:8px 16px;background:var(--bg2);
      border-bottom:1px solid var(--border);flex-shrink:0;
    }
    header h1{font-size:14px;font-weight:600}
    .badge{font-size:11px;padding:2px 7px;border-radius:99px;background:var(--accent);color:#fff;opacity:.85}
    .pill{font-size:11px;padding:2px 7px;border-radius:99px;background:var(--bg3);color:var(--muted);border:1px solid var(--border)}
    .pill.on{background:#22c55e22;color:var(--green);border-color:#22c55e44}
    .hstatus{margin-left:auto;font-size:12px;color:var(--muted)}
    .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:5px}
    .dot.live{background:var(--green)}

    /* ── Three-column layout ── */
    .main{display:flex;flex:1;overflow:hidden}

    /* App pane (left) */
    .app-pane{
      flex:1;display:flex;flex-direction:column;
      border-right:1px solid var(--border);min-width:0;
    }
    .pane-header{
      padding:6px 12px;background:var(--bg2);border-bottom:1px solid var(--border);
      font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);
      display:flex;align-items:center;gap:8px;flex-shrink:0;
    }

    /* Controls (middle) */
    .controls{
      width:260px;min-width:220px;background:var(--bg2);
      border-right:1px solid var(--border);
      display:flex;flex-direction:column;overflow-y:auto;flex-shrink:0;
    }
    .section{padding:12px 14px;border-bottom:1px solid var(--border)}
    .section h2{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px}
    .btn{
      display:block;width:100%;padding:6px 10px;border-radius:5px;
      border:1px solid var(--border);background:var(--bg3);color:var(--text);
      cursor:pointer;font-size:12px;text-align:left;margin-bottom:5px;transition:background .15s;
    }
    .btn:hover{background:var(--accent);border-color:var(--accent);color:#fff}
    .btn.danger:hover{background:var(--red);border-color:var(--red)}
    .field{margin-bottom:7px}
    .field label{display:block;font-size:10px;color:var(--muted);margin-bottom:2px}
    .field input,.field textarea{
      width:100%;background:var(--bg3);border:1px solid var(--border);
      color:var(--text);border-radius:4px;padding:4px 7px;font-size:12px;
    }
    .field textarea{height:52px;resize:vertical}

    /* Extension + log (right) */
    .right{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
    .ext-frame{flex:1;border:none;background:#fff;border-bottom:1px solid var(--border)}
    .log{
      height:140px;background:#0a0a0d;overflow-y:auto;
      font-family:'SF Mono','Fira Code',monospace;font-size:11px;
      padding:6px 12px;flex-shrink:0;
    }
    .log-line{line-height:1.6}
    .log-line .ts{color:var(--muted);margin-right:6px}
    .tag-reload{color:var(--yellow)}
    .tag-hook{color:var(--accent)}
    .tag-conn{color:var(--green)}
    .tag-err{color:var(--red)}
    .tag-info{color:var(--muted)}
    .tag-app{color:#38bdf8}
    /* The development panels that replaced the app preview. */
    .perms{padding:8px 12px;overflow-y:auto;max-height:34%}
    .perm{display:flex;align-items:flex-start;gap:8px;padding:6px 0;
      border-bottom:1px solid var(--border)}
    .perm:last-child{border-bottom:none}
    .perm .sw{flex-shrink:0;width:30px;height:17px;border-radius:9px;background:var(--bg3);
      border:1px solid var(--border);position:relative;cursor:pointer;transition:background .15s}
    .perm .sw::after{content:'';position:absolute;top:2px;left:2px;width:11px;height:11px;
      border-radius:50%;background:var(--muted);transition:transform .15s,background .15s}
    .perm.on .sw{background:var(--accent);border-color:var(--accent)}
    .perm.on .sw::after{transform:translateX(13px);background:#fff}
    .perm .n{font-size:11.5px;font-family:ui-monospace,monospace}
    .perm.on .n{color:var(--text)} .perm .n{color:var(--muted)}
    .perm .why{font-size:10.5px;color:var(--muted);line-height:1.45}
    .cmds{padding:8px 12px;overflow-y:auto;max-height:22%}
    .cmds .none{color:var(--muted);font-size:11px}
    .wire{flex:1;overflow-y:auto;padding:6px 12px;background:#0a0a0d;
      font-family:'SF Mono','Fira Code',monospace;font-size:11px;min-height:0}
    .wire .row{line-height:1.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wire .m{color:var(--text)}
    .wire .ok{color:var(--green)} .wire .denied{color:var(--yellow)} .wire .error{color:var(--red)}
    .wire .a{color:var(--muted)}
  </style>
</head>
<body>
<header>
  <div class="dot" id="dot"></div>
  <h1>${escHtml(manifest.name)}</h1>
  <span class="badge">${escHtml(manifest.id)} v${escHtml(manifest.version)}</span>
  <span class="pill${isV2 ? ' on' : ''}">${isV2 ? 'apiVersion 2' : 'apiVersion 1'}</span>
  <span class="hstatus" id="status">Connecting…</span>
</header>

<div class="main">

  <!-- Left: what the extension asked for, and what it did with it.
       This was a preview of the whole AuthNo app, which is not a thing an
       extension author can act on. -->
  <div class="app-pane">
    <div class="pane-header">
      <span>Permissions</span>
      <span style="color:var(--muted);font-size:10px">switch one off to see what happens</span>
    </div>
    <div id="perms" class="perms"></div>

    <div class="pane-header" style="border-top:1px solid var(--border)">
      <span>Commands</span>
      <span style="color:var(--muted);font-size:10px" id="cmd-count"></span>
    </div>
    <div id="commands" class="cmds"></div>

    <div class="pane-header" style="border-top:1px solid var(--border)">
      <span>Host calls</span>
      <button class="btn" style="width:auto;padding:2px 8px;font-size:10px;margin:0"
              onclick="clearCalls()">Clear</button>
    </div>
    <div id="wire" class="wire"></div>
  </div>

  <!-- Middle: controls -->
  <aside class="controls">
    <div class="section">
      <h2>Hooks</h2>
      <div id="hook-buttons"></div>
      <button class="btn" onclick="reloadExt()">⟳ Re-run activate()</button>
      <button class="btn" onclick="clearStorage()">🗑 Clear storage</button>
    </div>
    <div class="section">
      <h2>Session</h2>
      <div class="field"><label>Book title</label>
        <input id="f-title" value="My Test Book" oninput="scheduleUpdate()">
      </div>
      <div class="field"><label>Word count</label>
        <input id="f-words" type="number" value="8" oninput="scheduleUpdate()">
      </div>
      <div class="field"><label>Goal words</label>
        <input id="f-goal" type="number" value="1000" oninput="scheduleUpdate()">
      </div>
      <div class="field"><label>Content (HTML)</label>
        <textarea id="f-content" oninput="scheduleUpdate()"><p>Hello from the AuthNo sandbox. Edit me!</p></textarea>
      </div>
      <button class="btn danger" onclick="resetSession()">↺ Reset session</button>
    </div>
    <div class="section">
      <h2>Extension</h2>
      <button class="btn" onclick="reloadExt()">↻ Reload frame</button>
      <p style="color:var(--muted);font-size:11px;margin-top:6px">
        Served from <code style="font-family:monospace">/ext/</code>.<br>Reloads automatically on file changes.
      </p>
    </div>
  </aside>

  <!-- Right: extension frame + log -->
  <div class="right">
    <div class="pane-header">Extension sandbox</div>
    <iframe class="ext-frame" id="ext-frame" src="/harness"></iframe>
    <div class="log" id="log"></div>
  </div>

</div>

<script>
  let ws, updateTimer;

  function connect() {
    ws = new WebSocket('ws://' + location.host);
    ws.onopen  = () => { setStatus(true);  addLog('conn', 'Connected'); };
    ws.onclose = () => { setStatus(false); addLog('err', 'Disconnected — retrying…'); setTimeout(connect, 2000); };
    ws.onmessage = e => handle(JSON.parse(e.data));
  }

  function handle(msg) {
    // The host-call log. The server records every call with its outcome, so
    // the harness does not also report them — one call producing two rows,
    // one of them outcome-less, is what the first version of this did.
    if (msg.type === 'wire') { addWire(msg.call); return; }
    if (msg.type === 'reload') {
      addLog('reload', 'Changed: ' + msg.file + ' — reloading extension');
      reloadExt();
    } else if (msg.type === 'fire-hook') {
      // Drive the harness, which owns the hook bus and calls the handlers the
      // extension actually registered.
      addLog('hook', 'Firing ' + msg.name);
      postToExt({ __sandboxCmd: true, cmd: 'fire', name: msg.name, payload: msg.payload });
      postToApp({ type: 'hook', name: msg.name, payload: msg.payload });
    } else if (msg.type === 'hook') {
      addLog('hook', 'Hook: ' + msg.name + ' trigger=' + (msg.payload?.trigger ?? ''));
      postToExt({ __sandboxCmd: true, cmd: 'fire', name: msg.name, payload: msg.payload });
      postToApp({ type: 'hook', name: msg.name, payload: msg.payload });
    } else if (msg.type === 'session-updated' || msg.type === 'session-reset') {
      addLog('info', msg.type === 'session-reset' ? 'Session reset' : 'Session updated');
      postToExt({ type: 'session', session: msg.session });
      postToApp({ type: 'sandbox-session', session: msg.session });
    }
  }

  // Listen for messages FROM the app frame (e.g. when app triggers a save)
  window.addEventListener('message', e => {
    if (e.data?.type === 'app-save') {
      fetch('/api/app/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(e.data.patch ?? {}),
      });
      addLog('app', 'App triggered save → broadcasting onSave(autosave)');
    }
  });

  function scheduleUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(pushUpdate, 600);
  }

  async function pushUpdate() {
    await fetch('/api/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:     document.getElementById('f-title').value,
        wordCount: parseInt(document.getElementById('f-words').value, 10) || 0,
        goalWords: parseInt(document.getElementById('f-goal').value, 10)  || 1000,
        content:   document.getElementById('f-content').value,
      }),
    });
  }

  async function resetSession() {
    await fetch('/api/reset', { method: 'POST' });
    document.getElementById('f-title').value   = 'My Test Book';
    document.getElementById('f-words').value   = '8';
    document.getElementById('f-goal').value    = '1000';
    document.getElementById('f-content').value = '<p>Hello from the AuthNo sandbox. Edit me!</p>';
  }

  // Buttons are generated from the server's hook list so the sandbox cannot
  // drift out of sync with what the app actually fires.
  async function loadHooks() {
    const { hooks } = await fetch('/api/hooks').then(r => r.json());
    const box = document.getElementById('hook-buttons');
    if (!box) return;
    box.innerHTML = hooks.map(function (h) {
      return '<button class="btn" data-hook="' + h.key + '">\u25B8 ' + h.label + '</button>';
    }).join('');
    box.querySelectorAll('button').forEach(b => {
      b.onclick = () => fetch('/api/hooks/fire', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: b.dataset.hook }),
      });
    });
  }
  loadHooks();

  async function clearStorage() {
    await fetch('/api/storage/clear', { method: 'POST' });
    addLog('conn', 'Extension storage cleared');
  }

  async function fireHookLegacy(trigger) {
    await fetch('/api/hooks/onSave', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger }),
    });
  }

  function reloadExt() { postToExt({ __sandboxCmd: true, cmd: 'reload' }); }
  function postToExt(msg) { document.getElementById('ext-frame')?.contentWindow?.postMessage(msg, '*'); }

  // Messages coming UP from the harness: activation status, logs, toasts.
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m.__sandbox) return;
    if (m.type === 'log')       addLog(m.level === 'err' ? 'err' : m.level === 'warn' ? 'app' : 'conn', m.text);
    if (m.type === 'toast')     addLog('app', 'toast(' + m.variant + '): ' + m.text);
    if (m.type === 'registered') renderCommands(m.commands);
    if (m.type === 'wire')       addWire(m.call ?? m);
    if (m.type === 'activated') {
      // v1 reports { hookName: count }; v2 reports arrays of names.
      const names = Array.isArray(m.hooks)
        ? m.hooks.join(', ')
        : Object.entries(m.hooks || {}).map(([k, v]) => k + '×' + v).join(', ');
      renderCommands(Array.isArray(m.commands) ? m.commands : []);
      addLog('conn', 'activate() ok' + (names ? ' — listening: ' + names : ' — no hooks registered'));
    }
  });
  // The app frame is gone; a session update now only reaches the extension.
  function postToApp() {}

  function addLog(tag, text) {
    const el   = document.getElementById('log');
    const line = document.createElement('div');
    line.className = 'log-line';
    const ts   = new Date().toLocaleTimeString('en', { hour12: false });
    line.innerHTML = '<span class="ts">' + ts + '</span><span class="tag-' + tag + '">[' + tag + ']</span> ' + esc(text);
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setStatus(live) {
    document.getElementById('dot').className       = 'dot' + (live ? ' live' : '');
    document.getElementById('status').textContent  = live ? 'Live' : 'Disconnected';
  }

  connect();

// ── The development panels ────────────────────────────────────────────────
//
// Permissions are the useful one. An extension that behaves perfectly with
// everything granted is not evidence of much: what an author needs to see is
// what theirs does when somebody says no, and on device that is the common
// case. Switching one off here refuses the same wire methods the app refuses,
// because the map comes from the app's own permission model.

async function loadPerms() {
  const el = document.getElementById('perms');
  if (!el) return;
  try {
    const { declared } = await (await fetch('/api/permissions')).json();
    if (!declared.length) { el.innerHTML = '<div class="cmds"><div class="none">This extension asks for nothing.</div></div>'; return; }
    el.innerHTML = declared.map((p) => \`
      <div class="perm \${p.granted ? 'on' : ''}" data-name="\${p.name}">
        <div class="sw" onclick="togglePerm('\${p.name}')"></div>
        <div>
          <div class="n">\${p.name}</div>
          \${p.reason ? \`<div class="why">\${p.reason}</div>\` : ''}
        </div>
      </div>\`).join('');
  } catch { /* the server is restarting */ }
}

async function togglePerm(name) {
  const row = document.querySelector(\`.perm[data-name="\${name}"]\`);
  const next = !row.classList.contains('on');
  row.classList.toggle('on', next);
  await fetch('/api/permissions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, granted: next }),
  });
  addLog('info', (next ? 'Granted ' : 'Refused ') + name);
}

function renderCommands(commands) {
  const el = document.getElementById('commands');
  const count = document.getElementById('cmd-count');
  if (!el) return;
  if (!commands || !commands.length) {
    el.innerHTML = '<div class="none">None registered.</div>';
    if (count) count.textContent = '';
    return;
  }
  if (count) count.textContent = commands.length + ' registered';
  el.innerHTML = commands.map((c) =>
    \`<button class="btn" onclick="invokeCommand('\${c}')">▸ \${c}</button>\`).join('');
}

function invokeCommand(name) {
  const f = document.getElementById('ext-frame');
  f?.contentWindow?.postMessage({ __sandboxCmd: true, cmd: 'command', name, args: {} }, '*');
  addLog('hook', 'command → ' + name);
}

function addWire(call) {
  const el = document.getElementById('wire');
  if (!el || !call) return;
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = \`<span class="\${call.outcome}">\${call.outcome === 'ok' ? '✓' : call.outcome === 'denied' ? '⊘' : '✗'}</span> \`
    + \`<span class="m">\${call.method}</span>\`
    + (call.detail ? \` <span class="a">\${String(call.detail).slice(0, 90)}</span>\` : '');
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

async function clearCalls() {
  await fetch('/api/calls/clear', { method: 'POST' });
  const el = document.getElementById('wire');
  if (el) el.innerHTML = '';
}

loadPerms();
</script>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function log(msg)   { process.stdout.write(msg + '\n'); }
function fatal(msg) { process.stderr.write(chalk.red('x ') + msg + '\n'); process.exit(1); }

/** For the one place an error message reaches a browser as markup. */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
