/**
 * The extension system, end to end, in a real browser.
 *
 *   npm run build && npm run check:extensions
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Everything the sandbox does happens inside a frame, and jsdom cannot run a
 * frame's scripts. So the unit tests beside extensionSandbox.js cover reading
 * files off disk and the reasons an extension is refused — real coverage, but
 * all of it on the near side of the boundary. The bootstrap itself, the module
 * graph, and every message between the two were a string that had never been
 * executed anywhere.
 *
 * This runs the actual code. `src/utils/sandboxProtocol.js` imports nothing, so
 * stripping its `export` keywords turns it into a classic script the page can
 * be handed directly — the same bootstrap the app ships, driven by the same
 * host router, in a frame with the same sandbox attribute. Not a
 * reimplementation that agrees with the original until one of them changes.
 *
 * The host `dispatch` here is a stub, deliberately: what an extension is
 * allowed to ask for is a separate question from whether asking works, and the
 * first is a switch statement a unit test can read.
 *
 * CHROMIUM_PATH overrides the browser; this repo's image keeps one at
 * /opt/pw-browsers/chromium.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4402;

/** The real protocol module, as a classic script. */
function protocolScript() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'sandboxProtocol.js'), 'utf8');
  const out = src.replace(/^export /gm, '');
  // If this ever stops matching, everything below would silently test nothing.
  if (!/const BOOTSTRAP = `/.test(out) || !/function createHostRouter\(/.test(out)) {
    throw new Error('sandboxProtocol.js no longer has the shape this check strips — fix the transform, do not delete the check');
  }
  return out;
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><body></body></html>');
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.addScriptTag({ content: protocolScript() });

/**
 * Run one extension the way the app runs it and report what happened.
 *
 * `files` is { path: source } exactly as readExtensionTree returns it; the
 * linking below mirrors runExtension, including the leaves-first placeholder
 * scheme, because that ordering is the part with the edges in it.
 */
const result = await page.evaluate(async ({ files, entry }) => {
  const log = [];

  // ── The linking runExtension does, kept in step by hand ──────────────────
  // (planModuleGraph is imported from another module, so it is reimplemented
  //  here in miniature; its own ordering is unit-tested separately.)
  const order = Object.keys(files).sort((a, b) => (a === entry ? 1 : b === entry ? -1 : 0));
  const placeholders = {};
  order.forEach((p, i) => { placeholders[p] = `__authno_mod_${i}__`; });
  const modules = order.map((p) => ({
    path: p,
    source: files[p].replace(/(['"])(\.\/[^'"]+)\1/g, (whole, q, spec) => {
      const target = spec.replace('./', '');
      return placeholders[target] ? `${q}${placeholders[target]}${q}` : whole;
    }),
  }));

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
  frame.srcdoc = window.sandboxDocument();

  const store = {};
  const hookRegistrations = [];
  let fireHook = null;

  let settle;
  const ready = new Promise((r) => { settle = r; });

  const post = (m) => { try { frame.contentWindow?.postMessage(m, '*'); } catch { /* gone */ } };

  const router = window.createHostRouter({
    post,
    payload: () => ({ modules, entry, manifest: { id: 'probe', name: 'Probe' }, app: { name: 'AuthNo', platform: 'desktop' } }),
    dispatch: async (method, args) => {
      log.push(`call:${method}`);
      if (method === 'storage.set') { store[args[0]] = args[1]; return null; }
      if (method === 'storage.get') return store[args[0]] ?? null;
      if (method === 'storage.keys') return Object.keys(store);
      if (method === 'toast') { log.push(`toast:${args[0]}`); return null; }
      if (method === 'boom') throw new Error('refused on purpose');
      throw new Error(`${method} is not something an extension can call`);
    },
    onReady: (o) => settle(o),
    registerHook: (name, handler) => {
      hookRegistrations.push(name);
      if (name === 'probe-hook') fireHook = handler;
      return () => { fireHook = null; log.push('hook-unsubscribed'); };
    },
    sendable: window.toSendable,
  });

  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    router.onMessage(e.data);
  });

  document.body.appendChild(frame);

  const outcome = await Promise.race([
    ready,
    new Promise((r) => setTimeout(() => r({ ok: false, error: 'timed out waiting for ext-ready' }), 8000)),
  ]);

  // The extension called storage.set during activate(); read what landed.
  const stored = store.greeting ?? null;

  // Fire a hook the extension registered and see the handler's answer come back.
  let hookAnswer = null;
  if (fireHook) {
    hookAnswer = await Promise.race([
      fireHook({ chapter: 'one' }),
      new Promise((r) => setTimeout(() => r('HOOK TIMED OUT'), 4000)),
    ]);
  }

  // Deactivate should reach the extension's own teardown, which writes a key.
  await router.teardown();
  const afterTeardown = store.tornDown ?? null;

  frame.remove();
  return { outcome, log, stored, hookAnswer, hookRegistrations, afterTeardown };
}, {
  entry: 'index.js',
  files: {
    // A leaf, to prove the graph is linked rather than the entry merely running.
    'greeting.js': `export const greeting = () => 'hello from a second file';`,
    'index.js': `
import { greeting } from './greeting.js';

export function activate(host) {
  if (host.app.platform !== 'desktop') throw new Error('wrong platform in host.app');
  host.storage.set('greeting', greeting());
  host.toast('activated');

  host.registerHook('probe-hook', async (payload) => 'handled:' + payload.chapter);

  // An error from the host must arrive as a rejection, not a hang.
  host.storage.set('boomStatus', 'pending');
  host.toast('about to fail').then(function () {
    return host.storage.set('boomStatus', 'unexpected-success');
  });

  return function deactivate() { host.storage.set('tornDown', 'yes'); };
}
`,
  },
});

// A second extension, to prove a refusal surfaces rather than hanging.
const badResult = await page.evaluate(async () => {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
  frame.srcdoc = window.sandboxDocument();

  let settle;
  const ready = new Promise((r) => { settle = r; });
  const post = (m) => { try { frame.contentWindow?.postMessage(m, '*'); } catch { /* gone */ } };
  const router = window.createHostRouter({
    post,
    payload: () => ({
      modules: [{ path: 'index.js', source: 'export const nope = 1;' }],
      entry: 'index.js',
      manifest: { id: 'bad' },
      app: {},
    }),
    dispatch: async () => null,
    onReady: (o) => settle(o),
    registerHook: () => () => {},
    sendable: window.toSendable,
  });
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    router.onMessage(e.data);
  });
  document.body.appendChild(frame);
  const outcome = await Promise.race([
    ready,
    new Promise((r) => setTimeout(() => r({ ok: false, error: 'HUNG' }), 8000)),
  ]);
  frame.remove();
  return outcome;
});

await browser.close();
server.close();

const checks = [
  ['activate() ran and reported ready', result.outcome.ok === true, JSON.stringify(result.outcome)],
  ['the entry imported a second file', result.stored === 'hello from a second file', String(result.stored)],
  ['host.app reached the extension', !String(result.outcome.error || '').includes('wrong platform'), String(result.outcome.error)],
  ['a host call round-tripped', result.log.includes('call:storage.set'), result.log.join(',')],
  ['toast reached the host', result.log.includes('toast:activated'), result.log.join(',')],
  ['the hook was registered', result.hookRegistrations.includes('probe-hook'), result.hookRegistrations.join(',')],
  ['the hook handler answered', result.hookAnswer === 'handled:one', String(result.hookAnswer)],
  ['deactivate reached the extension', result.afterTeardown === 'yes', String(result.afterTeardown)],
  ['unsubscribing ran on teardown', result.log.includes('hook-unsubscribed'), result.log.join(',')],
  ['an extension with no activate() is refused, not hung',
    badResult.ok === false && badResult.error !== 'HUNG', JSON.stringify(badResult)],
  ['nothing threw in the page', pageErrors.length === 0, pageErrors.join(' | ')],
];

let ok = true;
for (const [label, pass, detail] of checks) {
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${label}${pass ? '' : `  ← ${detail}`}`);
}

if (!ok) {
  console.error('\nExtension end-to-end check FAILED.');
  process.exit(1);
}
console.log('\n✔ the extension system runs end to end.');
