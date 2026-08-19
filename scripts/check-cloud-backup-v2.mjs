#!/usr/bin/env node
/**
 * check-cloud-backup-v2.mjs — run the ported Cloud Backup for real.
 *
 * Every other check in this repo tests a piece. This one takes the extension
 * the CLI actually builds, opens it with the reader the app actually uses,
 * loads its modules into a real sandboxed frame with the bootstrap the app
 * actually ships, and answers its calls with the capability names the app
 * actually dispatches.
 *
 * That combination is where the port's bugs live, and none of the other
 * checks can see them:
 *
 *   - jsdom does not run a frame's scripts, so no unit test can execute
 *     activate() in a sandbox.
 *   - the app's tests use fixture manifests, not this extension's.
 *   - the CLI's own e2e proves a package is well-formed, not that the code
 *     inside it runs.
 *
 * The port is the first v2 extension that exists. If it does not run, v2 does
 * not work, and finding that out on a phone is the expensive way.
 *
 * Usage: npm run check:cloud-backup   (skips cleanly if the source is absent)
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchOptions } from './chromium.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4403;

const SRC = process.env.CLOUD_BACKUP_SRC ?? '/workspace/authno-cloud-backup-extension';
if (!fs.existsSync(path.join(SRC, 'manifest.json'))) {
  console.log(`· Cloud Backup source not present at ${SRC} — skipping.`);
  console.log('  (set CLOUD_BACKUP_SRC to point at a checkout)');
  process.exit(0);
}

// ── 1. The package the CLI builds, read back by the reader the app uses ──────

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
if (manifest.apiVersion !== 2) {
  console.error(`✖ manifest apiVersion is ${manifest.apiVersion}, not 2`);
  process.exit(1);
}

const files = {};
for (const name of fs.readdirSync(SRC)) {
  if (name.endsWith('.js')) files[name] = fs.readFileSync(path.join(SRC, name), 'utf8');
}

// ── 2. The module graph, planned the way the app plans it ────────────────────

const { planModuleGraph, rewriteSpecifiers } = await import('../src/utils/moduleGraph.js');

function graphFor(entry) {
  const { order, missing, cycle } = planModuleGraph(files, entry);
  if (cycle) throw new Error(`${entry} has a circular import: ${cycle.join(' → ')}`);
  if (missing.length) throw new Error(`${missing[0].from} imports ${missing[0].spec}, which is not shipped`);
  const placeholders = {};
  order.forEach((p, i) => { placeholders[p] = `__authno_mod_${i}__`; });
  return order.map((p) => ({
    path: p,
    source: rewriteSpecifiers(p, files[p], files, (t) => placeholders[t]),
  }));
}

// ── 3. The real bootstrap and router, as classic script ──────────────────────

function protocolScript() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'sandboxProtocol.js'), 'utf8');
  const out = src.replace(/^export /gm, '');
  if (!/const BOOTSTRAP_V2 = frameBootstrap\(/.test(out) || !/function createHostRouter\(/.test(out)) {
    throw new Error('sandboxProtocol.js no longer has the shape this check strips — fix the transform, do not delete the check');
  }
  return out;
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><body></body></html>');
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.addScriptTag({ content: protocolScript() });

// ── 4. Run it ────────────────────────────────────────────────────────────────

const BOOKS = [
  { id: 'b1', title: 'The Open One', updated: '2026-08-01T10:00:00.000Z', chapterCount: 3, wordCount: 1200 },
  { id: 'b2', title: 'Another', updated: '2026-07-01T10:00:00.000Z', chapterCount: 1, wordCount: 40 },
];

const result = await page.evaluate(async ({ modules, manifest, books }) => {
  const calls = [];
  const store = {};
  const registeredHooks = [];
  const registeredCommands = [];

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
  frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><scr'
    + 'ipt>' + BOOTSTRAP_V2 + '</scr' + 'ipt></head><body></body></html>';

  let settle;
  const ready = new Promise((r) => { settle = r; });
  const post = (m) => { try { frame.contentWindow?.postMessage(m, '*'); } catch { /* gone */ } };

  const router = window.createHostRouter({
    post,
    payload: () => ({ modules, entry: 'index.js', manifest, app: {} }),
    dispatch: async (method, args) => {
      calls.push(method);
      switch (method) {
        case 'storage.get': return store[args[0]] ?? null;
        case 'storage.set': {
          if (args[1] === null || args[1] === undefined) delete store[args[0]];
          else store[args[0]] = String(args[1]);
          return null;
        }
        case 'storage.remove': delete store[args[0]]; return null;
        case 'storage.keys': return Object.keys(store);
        case 'storage.getJSON': {
          const raw = store[args[0]];
          if (raw === undefined) return args[1] ?? null;
          try { return JSON.parse(raw); } catch { return args[1] ?? null; }
        }
        case 'storage.setJSON': store[args[0]] = JSON.stringify(args[1] ?? null); return null;
        case 'library.list': return books;
        case 'library.getAny': return books.find((b) => b.id === args[0]) ?? null;
        case 'library.export': return { filename: 'x.authbook', base64: 'QUJD' };
        case 'library.create': return { id: 'imported' };
        case 'ui.navigate': return null;
        case 'ui.toast': return null;
        case 'commands.register': registeredCommands.push(args[0]); return true;
        case 'app.version': return '1.1.20-beta.0';
        case 'app.platform': return 'android';
        default: throw new Error('no such method: ' + method);
      }
    },
    onReady: (o) => settle(o),
    registerHook: (name) => { registeredHooks.push(name); return () => {}; },
    sendable: window.toSendable,
  });

  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    router.onMessage(e.data);
  });
  document.body.appendChild(frame);

  const outcome = await Promise.race([
    ready,
    new Promise((r) => setTimeout(() => r({ ok: false, error: 'timed out waiting for ext-ready' }), 10000)),
  ]);

  // Let the command registrations land — they are promises inside activate().
  await new Promise((r) => setTimeout(r, 300));

  // ── The page ↔ background channel, driven the way pageApi.js drives it ────
  // A page writes a request; the background half's poll picks it up and writes
  // the answer. This is the one part of the port with no synchronous path, so
  // a broken poll looks exactly like a slow one.
  store.__request = JSON.stringify({ id: 'probe-1', name: 'getStatus', args: {} });
  let channelAnswer = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const raw = store.__response;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.id === 'probe-1') { channelAnswer = parsed; break; }
    }
  }

  // An unknown operation must be refused by name, not by prototype lookup.
  store.__request = JSON.stringify({ id: 'probe-2', name: 'constructor', args: {} });
  let prototypeAnswer = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const raw = store.__response;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.id === 'probe-2') { prototypeAnswer = parsed; break; }
    }
  }

  await router.teardown();
  frame.remove();
  return { outcome, calls, store, registeredHooks, registeredCommands, channelAnswer, prototypeAnswer };
}, { modules: graphFor('index.js'), manifest, books: BOOKS });

// ── 5. The pages, each loaded on its own ─────────────────────────────────────

const pageResults = {};
for (const [id, def] of Object.entries(manifest.pages ?? {})) {
  pageResults[id] = await page.evaluate(async ({ modules }) => {
    const errors = [];
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';

    const store = {};
    const shim = window.pageApiV2();
    frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><scr'
      + 'ipt>' + shim + '</scr' + 'ipt></head><body><div id="root"></div>'
      + '<scr' + 'ipt type="application/json" id="mods">'
      + JSON.stringify(modules).replace(/</g, '\\u003c')
      + '</scr' + 'ipt><scr' + 'ipt>'
      + `(function(){
           var mods = JSON.parse(document.getElementById('mods').textContent);
           var urls = [];
           try {
             for (var i = 0; i < mods.length; i++) {
               var src = mods[i].source;
               for (var j = 0; j < urls.length; j++) src = src.split('__authno_mod_' + j + '__').join(urls[j]);
               urls.push(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
             }
             import(urls[urls.length - 1])
               .then(function () { parent.postMessage({ type: 'page-ok' }, '*'); })
               .catch(function (e) { parent.postMessage({ type: 'page-err', error: String(e && e.message || e) }, '*'); });
           } catch (e) { parent.postMessage({ type: 'page-err', error: String(e && e.message || e) }, '*'); }
         })();`
      + '</scr' + 'ipt></body></html>';

    let settle;
    const done = new Promise((r) => { settle = r; });

    const onMessage = (e) => {
      if (e.source !== frame.contentWindow) return;
      const msg = e.data;
      if (msg?.type === 'page-ok') { settle({ ok: true }); return; }
      if (msg?.type === 'page-err') { settle({ ok: false, error: msg.error }); return; }
      if (msg?.type !== 'api-call') return;
      // Answer the handful of things a page asks for while rendering.
      const reply = (result, error) =>
        frame.contentWindow?.postMessage({ type: 'api-result', id: msg.id, result, error }, '*');
      const { method, args } = msg;
      if (method === 'storage.getJSON') {
        const raw = store[args[0]];
        reply(raw === undefined ? (args[1] ?? null) : JSON.parse(raw));
      } else if (method === 'storage.setJSON') { store[args[0]] = JSON.stringify(args[1] ?? null); reply(null); }
      else if (method === 'storage.get') reply(store[args[0]] ?? null);
      else if (method === 'storage.set') { store[args[0]] = args[1]; reply(null); }
      else if (method === 'library.list') reply([]);
      else reply(undefined, 'no such method: ' + method);
    };

    window.addEventListener('message', onMessage);
    document.body.appendChild(frame);

    const outcome = await Promise.race([
      done,
      new Promise((r) => setTimeout(() => r({ ok: false, error: 'page did not load' }), 8000)),
    ]);
    window.removeEventListener('message', onMessage);
    frame.remove();
    return { outcome, errors };
  }, { modules: graphFor(def.file) });
}

await browser.close();
server.close();

// ── 6. What has to be true ───────────────────────────────────────────────────

const checks = [
  ['activate() ran', result.outcome.ok === true, JSON.stringify(result.outcome)],
  ['it never called a v1 method name',
    !result.calls.some((m) => ['getSessions', 'encodeSession', 'importSession', 'openBrowser', 'toast', 'navigate'].includes(m)),
    result.calls.join(',')],
  ['it registered the onSave hook', result.registeredHooks.includes('onSave'),
    result.registeredHooks.join(',')],
  ['it registered every command the manifest declares',
    (manifest.commands ?? []).every((c) => result.registeredCommands.includes(c)),
    `declared=${(manifest.commands ?? []).join(',')} registered=${result.registeredCommands.join(',')}`],
  ['a page request reached the background half',
    result.channelAnswer?.result !== undefined && !result.channelAnswer?.error,
    JSON.stringify(result.channelAnswer)],
  ['an operation named off Object.prototype is refused',
    /Unknown operation/.test(result.prototypeAnswer?.error ?? ''),
    JSON.stringify(result.prototypeAnswer)],
  ['nothing threw in the page', pageErrors.length === 0, pageErrors.join(' | ')],
];

for (const [id, r] of Object.entries(pageResults)) {
  checks.push([`page "${id}" loaded`, r.outcome.ok === true, JSON.stringify(r.outcome)]);
}

let ok = true;
console.log('Cloud Backup v2, running for real\n');
for (const [label, pass, detail] of checks) {
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${label}${pass ? '' : `  ← ${detail}`}`);
}

if (!ok) {
  console.error('\nCloud Backup v2 does not run.');
  process.exit(1);
}
console.log('\n✔ the ported extension activates, registers, and serves its pages.');
