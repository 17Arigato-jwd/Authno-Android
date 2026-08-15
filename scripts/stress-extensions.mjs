/**
 * The extension system under load and under abuse.
 *
 *   npm run stress:extensions
 *
 * check:extensions proves one well-behaved extension works. This asks what
 * happens when they are not well-behaved and there are a lot of them, which is
 * the state an install screen reaches after a year rather than on day one:
 *
 *   - twenty at once, each with its own frame and its own storage
 *   - install/uninstall churn, fast enough to overlap
 *   - one that never answers a hook
 *   - one that throws during activate()
 *   - one that throws inside deactivate()
 *   - one that floods the host with calls
 *   - one that tries to reach the app through every hole it can name
 *
 * The bar is not that misbehaviour is prevented — an extension is somebody
 * else's code and it is allowed to be bad. It is that ONE bad extension cannot
 * take the app, or its neighbours, down with it.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchOptions } from './chromium.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4403;

function protocolScript() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'sandboxProtocol.js'), 'utf8');
  const out = src.replace(/^export /gm, '');
  if (!/const BOOTSTRAP = `/.test(out) || !/function createHostRouter\(/.test(out)) {
    throw new Error('sandboxProtocol.js no longer has the shape this check strips');
  }
  return out;
}

const server = http.createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><body></body></html>');
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.addScriptTag({ content: protocolScript() });

// Everything the app keeps that an extension must never reach.
await page.evaluate(() => {
  localStorage.setItem('authno_access_key', 'ACCESS-KEY-MUST-NOT-LEAK');
  window.__appSecret = 'APP-SECRET-MUST-NOT-LEAK';
});

const report = await page.evaluate(async () => {
  const out = { notes: [], leaks: [] };

  /** One extension, running, with the same wiring runExtension uses. */
  function start(id, source, { hookTimeoutMs = 1500, teardownTimeoutMs = 1500 } = {}) {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    frame.srcdoc = window.sandboxDocument();

    const store = {};
    let calls = 0;
    let fireHook = null;
    let settle;
    const ready = new Promise((r) => { settle = r; });

    const post = (m) => { try { frame.contentWindow?.postMessage(m, '*'); } catch { /* gone */ } };
    const router = window.createHostRouter({
      post,
      hookTimeoutMs,
      teardownTimeoutMs,
      payload: () => ({
        modules: [{ path: 'index.js', source }],
        entry: 'index.js',
        manifest: { id },
        app: { name: 'AuthNo', platform: 'desktop' },
      }),
      dispatch: async (method, args) => {
        calls++;
        if (method === 'storage.set') { store[args[0]] = args[1]; return null; }
        if (method === 'storage.get') return store[args[0]] ?? null;
        if (method === 'report') { out.leaks.push(`${id}: ${args[0]}`); return null; }
        if (method === 'toast') return null;
        throw new Error(`${method} is not something an extension can call`);
      },
      onReady: (o) => settle(o),
      registerHook: (name, handler) => { if (name === 'h') fireHook = handler; return () => {}; },
      sendable: window.toSendable,
    });

    const onMsg = (e) => { if (e.source === frame.contentWindow) router.onMessage(e.data); };
    window.addEventListener('message', onMsg);
    document.body.appendChild(frame);

    return {
      id, ready, router, store,
      calls: () => calls,
      hook: (p) => (fireHook ? fireHook(p) : Promise.resolve('NO HOOK')),
      stop: async () => {
        await router.teardown();
        window.removeEventListener('message', onMsg);
        frame.remove();
      },
    };
  }

  const settled = (p, ms, fallback) =>
    Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

  // ── 1. Twenty at once ─────────────────────────────────────────────────────
  const many = [];
  for (let i = 0; i < 20; i++) {
    many.push(start(`ext-${i}`, `
      export function activate(host) {
        host.storage.set('mine', 'value-${i}');
        host.registerHook('h', async () => 'answer-${i}');
        return function () {};
      }`));
  }
  const readies = await Promise.all(many.map((m) => settled(m.ready, 15000, { ok: false, error: 'timeout' })));
  out.allStarted = readies.every((r) => r.ok);
  out.startedCount = readies.filter((r) => r.ok).length;

  // Each one's storage is its own, and each hook answers with its own id.
  await new Promise((r) => setTimeout(r, 200));
  out.storageIsolated = many.every((m, i) => m.store.mine === `value-${i}`);
  const answers = await Promise.all(many.map((m) => settled(m.hook({}), 4000, 'TIMEOUT')));
  out.hooksIsolated = answers.every((a, i) => a === `answer-${i}`);

  await Promise.all(many.map((m) => m.stop()));

  // ── 2. Churn: start and stop the same id repeatedly, overlapping ─────────
  let churnOk = true;
  for (let round = 0; round < 8; round++) {
    const a = start('churn', `export function activate(h){ h.storage.set('r','${round}'); return function(){}; }`);
    const r = await settled(a.ready, 8000, { ok: false, error: 'timeout' });
    if (!r.ok) churnOk = false;
    // Stop without awaiting, then immediately start again — the overlap is
    // the point: a teardown still in flight must not break the next start.
    const stopping = a.stop();
    const b = start('churn', `export function activate(h){ h.storage.set('r','${round}b'); return function(){}; }`);
    const rb = await settled(b.ready, 8000, { ok: false, error: 'timeout' });
    if (!rb.ok) churnOk = false;
    await stopping;
    await b.stop();
  }
  out.churnSurvived = churnOk;

  // ── 3. One that never answers a hook ─────────────────────────────────────
  const silent = start('silent', `
    export function activate(host) {
      host.registerHook('h', () => new Promise(function () {}));   // never settles
      return function () {};
    }`, { hookTimeoutMs: 800 });
  await settled(silent.ready, 8000, { ok: false });
  const t0 = Date.now();
  const silentAnswer = await settled(silent.hook({}), 5000, 'HUNG');
  out.silentHookBounded = silentAnswer !== 'HUNG' && Date.now() - t0 < 4000;
  out.silentHookAnswer = String(silentAnswer);
  await silent.stop();

  // ── 4. Throwing in activate(), and in deactivate() ───────────────────────
  const boomA = start('boom-activate', `export function activate() { throw new Error('nope'); }`);
  const ra = await settled(boomA.ready, 8000, { ok: false, error: 'timeout' });
  out.activateThrowReported = ra.ok === false && /nope/.test(String(ra.error));
  await boomA.stop();

  const boomD = start('boom-deactivate', `
    export function activate() { return function () { throw new Error('teardown exploded'); }; }`,
    { teardownTimeoutMs: 1500 });
  await settled(boomD.ready, 8000, { ok: false });
  const t1 = Date.now();
  await settled(boomD.stop(), 5000, null);
  out.deactivateThrowBounded = Date.now() - t1 < 4000;

  // ── 5. A flood ────────────────────────────────────────────────────────────
  const flood = start('flood', `
    export function activate(host) {
      for (var i = 0; i < 2000; i++) host.storage.set('k' + i, i);
      return function () {};
    }`);
  const rf = await settled(flood.ready, 15000, { ok: false, error: 'timeout' });
  await new Promise((r) => setTimeout(r, 500));
  out.floodStarted = rf.ok;
  out.floodCalls = flood.calls();
  // A neighbour started during the flood still works.
  const bystander = start('bystander', `export function activate(h){ h.storage.set('ok','yes'); return function(){}; }`);
  const rb2 = await settled(bystander.ready, 10000, { ok: false, error: 'timeout' });
  out.bystanderSurvivedFlood = rb2.ok && bystander.store.ok === 'yes';
  await flood.stop();
  await bystander.stop();

  // ── 6. One that goes looking for a way out ───────────────────────────────
  const hostile = start('hostile', `
    export function activate(host) {
      var tried = [];
      function probe(name, fn) {
        try { var v = fn(); tried.push(name + '=' + String(v).slice(0, 40)); }
        catch (e) { tried.push(name + '=THREW'); }
      }
      probe('parent.localStorage', function () { return parent.localStorage.getItem('authno_access_key'); });
      probe('parent.__appSecret', function () { return parent.__appSecret; });
      probe('parent.document', function () { return parent.document.body.innerHTML; });
      probe('top.location', function () { return top.location.href; });
      probe('own.localStorage', function () { return localStorage.length; });
      probe('cookie', function () { return document.cookie; });
      // Attached rather than left dangling: an unhandled rejection inside the
      // frame surfaces as a page error, and the point here is what the frame
      // CAN do, not how loudly it fails. The answer is nothing — an opaque
      // origin has no base URL for a relative path and no cookies to send.
      probe('fetch-relative', function () {
        fetch('/').then(function () { tried.push('fetch-relative=REACHED'); })
                  .catch(function () { tried.push('fetch-relative=blocked'); });
        return 'pending';
      });
      probe('fetch-absolute', function () {
        fetch('http://127.0.0.1:4403/').then(function () { tried.push('fetch-absolute=REACHED'); })
                                       .catch(function () { tried.push('fetch-absolute=blocked'); });
        return 'pending';
      });
      probe('opener', function () { return window.opener && window.opener.location.href; });
      host.storage.set('tried', tried.join(' | '));
      // The fetches settle after the join above, so say it again once they have.
      setTimeout(function () { host.storage.set('tried', tried.join(' | ')); }, 800);
      // And ask the host for something it never offered.
      host.storage.get('x');
      return function () {};
    }`);
  await settled(hostile.ready, 8000, { ok: false });
  // Long enough for the two fetches to have settled and appended their result.
  await new Promise((r) => setTimeout(r, 1200));
  out.hostileProbes = hostile.store.tried || '(nothing recorded)';
  await hostile.stop();

  out.framesLeft = document.querySelectorAll('iframe').length;
  return out;
});

await browser.close();
server.close();

const r = report;
console.log(`  20 extensions started:        ${r.startedCount}/20`);
console.log(`  storage isolated:             ${r.storageIsolated}`);
console.log(`  hooks isolated:               ${r.hooksIsolated}`);
console.log(`  flood accepted calls:         ${r.floodCalls}`);
console.log(`  hostile probes:               ${r.hostileProbes}`);
console.log(`  frames left in the document:  ${r.framesLeft}`);
console.log('');

const leaked = r.hostileProbes.includes('MUST-NOT-LEAK');
const checks = [
  ['twenty extensions all start', r.allStarted, `${r.startedCount}/20`],
  ['each keeps its own storage', r.storageIsolated, ''],
  ['each answers its own hooks', r.hooksIsolated, ''],
  ['start/stop churn survives overlap', r.churnSurvived, ''],
  ['a hook that never answers is bounded', r.silentHookBounded, r.silentHookAnswer],
  ['a throw in activate() is reported', r.activateThrowReported, ''],
  ['a throw in deactivate() does not hang teardown', r.deactivateThrowBounded, ''],
  ['a flooding extension still starts', r.floodStarted, ''],
  ['and does not stop its neighbour', r.bystanderSurvivedFlood, ''],
  ['nothing reached the app', !leaked, r.hostileProbes],
  ['every frame was removed', r.framesLeft === 0, String(r.framesLeft)],
  ['nothing threw in the page', pageErrors.length === 0, pageErrors.join(' | ')],
];

let ok = true;
for (const [label, pass, detail] of checks) {
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${label}${pass ? '' : `  ← ${detail}`}`);
}

if (!ok) { console.error('\nExtension stress FAILED.'); process.exit(1); }
console.log('\n✔ the extension system holds under load and under abuse.');
