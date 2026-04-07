#!/usr/bin/env node
/**
 * extbk-sandbox — v1.1.0
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

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = path.resolve(__dirname, '..');

const DEFAULT_PORT = 3747;

program
  .name('extbk-sandbox')
  .description('AuthNo extension dev server — hot reload + React preview + mock API')
  .version('1.1.0')
  .argument('[extDir]', 'Extension source directory (must contain manifest.json + index.js)', '.')
  .option('-p, --port <port>', 'Port to listen on', String(DEFAULT_PORT))
  .option('--no-app', 'Disable the bundled React app pane even if app/ exists')
  .parse();

const [extDir]       = program.args;
const { port: portStr, app: serveApp } = program.opts();
const port           = parseInt(portStr, 10);
const src            = path.resolve(extDir ?? '.');
const appDir         = path.join(INSTALL_DIR, 'app');
const hasBundledApp  = serveApp !== false && fs.existsSync(appDir) && fs.existsSync(path.join(appDir, 'index.html'));

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

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Sandbox shell UI
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(sandboxShellHtml(manifest, port, hasBundledApp));
});

// Bundled React app (SPA — all non-asset routes fall back to index.html)
if (hasBundledApp) {
  app.use('/app', express.static(appDir, { etag: true }));
  app.get('/app/*', (_req, res) => {
    res.sendFile(path.join(appDir, 'index.html'));
  });
}

// Extension source files (no cache — always fresh)
app.use('/ext', express.static(src, { etag: false, maxAge: 0 }));

// ── Mock session API ───────────────────────────────────────────────────────────

let mockSession = makeMockSession();

app.get('/api/session', (_req, res) => res.json(mockSession));

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

const watcher = chokidar.watch(src, {
  ignored: /(^|[/\\])\../,
  persistent: true,
  ignoreInitial: true,
});

watcher.on('all', (event, filePath) => {
  const rel = path.relative(src, filePath);
  log(`${chalk.dim('[watch]')} ${event}: ${chalk.cyan(rel)}`);
  broadcast({ type: 'reload', file: rel, event });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(port, () => {
  log('');
  log(chalk.bold('extbk-sandbox') + chalk.dim(' v1.1.0'));
  log(chalk.dim('─'.repeat(46)));
  log(`  Extension  : ${chalk.cyan(manifest.name)} ${chalk.dim(`(${manifest.id} v${manifest.version})`)}`);
  log(`  Directory  : ${chalk.dim(src)}`);
  log(`  Sandbox    : ${chalk.underline.cyan(`http://localhost:${port}`)}`);
  if (hasBundledApp) {
    log(`  React app  : ${chalk.underline.cyan(`http://localhost:${port}/app`)} ${chalk.dim('(bundled)')}`);
  } else {
    log(`  React app  : ${chalk.dim('not found — download the sandbox installer to include it')}`);
  }
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

function sandboxShellHtml(manifest, wsPort, hasApp) {
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
    .app-frame{flex:1;border:none;background:#fff}

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
    .no-app-placeholder{
      flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:12px;color:var(--muted);font-size:13px;text-align:center;padding:24px;
    }
    .no-app-placeholder code{font-family:monospace;font-size:11px;background:var(--bg3);
      padding:4px 8px;border-radius:4px;color:var(--text)}
  </style>
</head>
<body>
<header>
  <div class="dot" id="dot"></div>
  <h1>${escHtml(manifest.name)}</h1>
  <span class="badge">${escHtml(manifest.id)} v${escHtml(manifest.version)}</span>
  <span class="pill${hasApp ? ' on' : ''}" id="app-pill">${hasApp ? 'React app bundled' : 'No app bundle'}</span>
  <span class="hstatus" id="status">Connecting…</span>
</header>

<div class="main">

  <!-- Left: React app preview or placeholder -->
  <div class="app-pane">
    <div class="pane-header">
      <span>App preview</span>
      ${hasApp ? '<button class="btn" style="width:auto;padding:2px 8px;font-size:10px;margin:0" onclick="reloadApp()">Reload</button>' : ''}
    </div>
    ${hasApp
      ? `<iframe class="app-frame" id="app-frame" src="/app"></iframe>`
      : `<div class="no-app-placeholder">
          <div style="font-size:32px">📦</div>
          <div>No bundled React app found.</div>
          <div style="font-size:12px">Download the sandbox installer from GitHub Actions<br>to get a version that includes the compiled app.</div>
          <div style="font-size:12px;margin-top:8px">Or build it yourself:<br><code>npm run build</code> → copy <code>build/</code> to <code>extbk-sandbox/app/</code></div>
        </div>`
    }
  </div>

  <!-- Middle: controls -->
  <aside class="controls">
    <div class="section">
      <h2>Hooks</h2>
      <button class="btn" onclick="fireHook('change')">↻ onSave — change</button>
      <button class="btn" onclick="fireHook('autosave')">💾 onSave — autosave</button>
      <button class="btn" onclick="fireHook('manual')">✋ onSave — manual</button>
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
    <iframe class="ext-frame" id="ext-frame" src="/ext/index.js" sandbox="allow-scripts allow-same-origin"></iframe>
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
    if (msg.type === 'reload') {
      addLog('reload', 'Changed: ' + msg.file + ' — reloading extension');
      reloadExt();
    } else if (msg.type === 'hook') {
      addLog('hook', 'Hook: ' + msg.name + ' trigger=' + msg.payload.trigger);
      postToExt({ type: 'hook', name: msg.name, payload: msg.payload });
      // Also forward to app frame so it can react to save events
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

  async function fireHook(trigger) {
    await fetch('/api/hooks/onSave', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger }),
    });
  }

  function reloadExt() { const f = document.getElementById('ext-frame'); f.src = f.src; }
  function reloadApp() { const f = document.getElementById('app-frame'); if (f) f.src = f.src; }
  function postToExt(msg) { document.getElementById('ext-frame')?.contentWindow?.postMessage(msg, '*'); }
  function postToApp(msg) { document.getElementById('app-frame')?.contentWindow?.postMessage(msg, '*'); }

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
