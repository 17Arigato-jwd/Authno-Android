#!/usr/bin/env node
/**
 * check-runner-v2.mjs — the app's OWN v2 runner, in a real browser.
 *
 * This check exists because of a bug it would have caught on the day it was
 * written, and did not, because it did not exist.
 *
 * `runExtensionV2` handed the frame every file's source exactly as packed.
 * That works for a one-file extension and for nothing else: the frame is an
 * opaque-origin `srcdoc` document whose base URL is `about:srcdoc`, so
 * `./queue.js` has nothing hierarchical to resolve against and the import
 * throws before `activate()` is reached. Cloud Backup is twelve modules. It
 * shipped in 1.1.20-beta.1, installed cleanly, rendered its settings page —
 * and every page said "This extension is not running", because the background
 * half never linked.
 *
 * Nothing caught it. The unit tests run in jsdom, which never executes a
 * frame's scripts. `check:cloud-backup` runs the real extension in a real
 * frame but builds that frame ITSELF, planning the module graph on its way in
 * — so it proved the extension was sound while stepping around the app code
 * that was not. Both were green.
 *
 * So the subject here is deliberately narrow and deliberately real: the app's
 * `src/utils/extensionRunnerV2.js`, bundled for a browser, called the way
 * `extensionRuntime.js` calls it, against a package with imports in it. If
 * this is green, a multi-file extension activates.
 *
 * Usage: npm run check:runner-v2
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchOptions } from './chromium.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4456;
const FIXTURE = path.join(ROOT, 'src/utils/__fixtures__/cloud-backup-2.0.0.extbk');

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const bad = (m, d) => { failures++; console.log(`  \x1b[31m✖\x1b[0m ${m}`); if (d) console.log(`      ${d}`); };

// ── the subject, bundled ─────────────────────────────────────────────────────

const bundled = await build({
  stdin: {
    contents: `
      import { runExtensionV2, hostV2, commandsV2, runningV2, stopExtensionV2, planModules }
        from '${ROOT}/src/utils/extensionRunnerV2.js';
      Object.assign(window, { runExtensionV2, hostV2, commandsV2, runningV2, stopExtensionV2, planModules });
    `,
    resolveDir: ROOT,
    loader: 'js',
  },
  bundle: true, write: false, format: 'iife', target: ['chrome110'],
  loader: { '.js': 'jsx' }, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});
const runnerJs = bundled.outputFiles[0].text;

// ── the packages ─────────────────────────────────────────────────────────────

/** A manifest that asks for nothing, so the grant list stays out of the way. */
const manifestFor = (id, extra = {}) => ({
  apiVersion: 2, id, name: id, version: '1.0.0', author: 'check',
  description: 'a package built by check-runner-v2', permissions: {}, ...extra,
});

/**
 * The multi-file case, and the reason for the file: a chain three deep plus a
 * diamond, which is what a real extension's graph looks like and what a flat
 * "entry last" ordering gets wrong.
 */
const MULTI = {
  'index.js': `
    import { greet } from './lib/greet.js';
    import { VERSION } from './constants.js';
    export async function activate(api) {
      await api.storage.set('mark', greet(VERSION));
      return () => {};
    }`,
  'lib/greet.js': `
    import { upper } from './case.js';
    import { VERSION } from '../constants.js';
    export const greet = (v) => upper('hi ' + v + ' ' + VERSION);`,
  'lib/case.js': `export const upper = (s) => String(s).toUpperCase();`,
  'constants.js': `export const VERSION = 'v2';`,
};

const SINGLE = {
  'index.js': `export async function activate(api) { await api.storage.set('mark', 'ONE'); return () => {}; }`,
};

const CYCLE = {
  'index.js': `import { a } from './a.js'; export async function activate() { return a; }`,
  'a.js': `import { b } from './b.js'; export const a = b;`,
  'b.js': `import { a } from './a.js'; export const b = a;`,
};

const NO_ENTRY = { 'other.js': `export const nothing = 1;` };

/** The real Cloud Backup package, read with the reader the app uses. */
const { readEpk } = await import('../extensions/extbk-cli/src/epkFormat.js');
let SHIPPED = null;
if (fs.existsSync(FIXTURE)) {
  const pkg = await readEpk(fs.readFileSync(FIXTURE));
  SHIPPED = { manifest: pkg.manifest, files: { ...pkg.modules } };
}

// ── the page that holds the subject ─────────────────────────────────────────

const server = http.createServer((_q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' });
  r.end('<!doctype html><html><body></body></html>');
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.addScriptTag({ content: runnerJs });

/** Run one package through the app's runner and report what it did. */
async function run(manifest, files, granted = []) {
  return page.evaluate(async ({ manifest, files, granted }) => {
    const calls = [];
    const store = {};
    const stub = (name, fn) => (...a) => { calls.push(name); return fn(...a); };
    const r = await window.runExtensionV2({
      manifest, files, entry: 'index.js', granted, userHosts: [],
      activateTimeoutMs: 8000,
      handlers: {
        app: { version: () => 'check', platform: () => 'desktop', locale: () => 'en' },
        ui: {
          toast: stub('ui.toast', () => null), navigate: stub('ui.navigate', () => null),
          prompt: async () => '', confirm: async () => true,
          overlaySet: () => null, overlayClear: () => null,
        },
        storage: {
          get: stub('storage.get', async (k) => store[k] ?? null),
          set: stub('storage.set', async (k, v) => { store[k] = v; return null; }),
          remove: async (k) => { delete store[k]; return null; },
          keys: async () => Object.keys(store),
        },
        library: {
          list: stub('library.list', async () => []),
          get: stub('library.get', async () => null),
          getAny: async () => null,
          create: async () => ({ id: 'x' }),
          update: async () => ({ ok: true }),
          export: async () => ({ filename: 'x.authbook', base64: '', mimeType: 'text/plain' }),
        },
        browser: {
          open: async () => null, close: async () => null,
          oauth: async () => { throw new Error('no browser in a check'); },
          googleSignIn: async () => { throw new Error('no browser in a check'); },
          requestDriveToken: async () => { throw new Error('no browser in a check'); },
          signOut: async () => null,
        },
        network: { requestHost: async (h) => ({ ok: true, host: h }) },
        activity: { getRate: () => 0, onWriting: () => () => {} },
        notify: { post: async () => null },
      },
    });
    const out = {
      r: { ok: r.ok, error: r.error ?? null },
      host: !!window.hostV2(manifest.id),
      running: window.runningV2(),
      calls: [...new Set(calls)],
      store,
    };
    await window.stopExtensionV2(manifest.id);
    return out;
  }, { manifest, files, granted });
}

// ── 1. the plan, before anything is loaded ──────────────────────────────────

console.log('\nModule graph');
{
  // planModules is exported for exactly this: the linking decision is pure and
  // deserves to fail here, with the specifier named, rather than as a browser
  // error naming a blob URL. It is read out of the bundled app code, not
  // imported into node — this repo's .js is CommonJS to node, and a check that
  // tested a second copy of the logic would be testing the wrong thing anyway.
  const plans = await page.evaluate(({ MULTI, CYCLE, NO_ENTRY }) => ({
    multi: window.planModules(MULTI, 'index.js'),
    cycle: window.planModules(CYCLE, 'index.js'),
    none: window.planModules(NO_ENTRY, 'index.js'),
  }), { MULTI, CYCLE, NO_ENTRY });

  const plan = plans.multi;
  if (plan.error) bad('a three-deep graph plans', plan.error);
  else ok('a three-deep graph plans');

  const order = plan.modules.map((m) => m.path);
  if (order[order.length - 1] !== 'index.js') bad('the entry is last', order.join(', '));
  else ok('the entry is last');

  if (order.indexOf('lib/case.js') > order.indexOf('lib/greet.js')) {
    bad('leaves come before what imports them', order.join(', '));
  } else ok('leaves come before what imports them');

  // The regression itself, stated as an invariant: nothing handed to the frame
  // may still carry a relative specifier, because there is nothing in an
  // opaque-origin srcdoc document for one to resolve against.
  const RELATIVE = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.[^'"]*)\2/;
  const leaked = plan.modules.filter((m) => RELATIVE.test(m.source));
  if (leaked.length) bad('no relative specifier survives into the frame', leaked.map((m) => m.path).join(', '));
  else ok('no relative specifier survives into the frame');

  if (!plans.cycle.error || !/circular/.test(plans.cycle.error)) {
    bad('a cycle is refused by name', JSON.stringify(plans.cycle.error));
  } else ok(`a cycle is refused by name — "${plans.cycle.error}"`);

  if (!plans.none.error) bad('a package with no entry is refused');
  else ok(`a package with no entry is refused — "${plans.none.error}"`);
}

console.log('\nActivation');
{
  const single = await run(manifestFor('single'), SINGLE);
  if (!single.r.ok) bad('a one-file extension activates', single.r.error);
  else ok('a one-file extension activates');

  const multi = await run(manifestFor('multi'), MULTI);
  if (!multi.r.ok) bad('a multi-file extension activates', multi.r.error);
  else ok('a multi-file extension activates');

  // Not just "ok": the imports have to have actually linked. HI V2 V2 can only
  // come out of three modules that found each other.
  if (multi.store.mark !== 'HI V2 V2') bad('its imports resolved', `mark = ${JSON.stringify(multi.store.mark)}`);
  else ok('its imports resolved');

  if (!multi.host) bad('the host is registered afterwards');
  else ok('the host is registered afterwards');

  const cyc = await run(manifestFor('cyc'), CYCLE);
  if (cyc.r.ok || !/circular/.test(cyc.r.error ?? '')) bad('a cycle is refused, not hung', JSON.stringify(cyc.r));
  else ok('a cycle is refused, not hung');
}

if (SHIPPED) {
  console.log(`\nThe shipped package — ${SHIPPED.manifest.id} v${SHIPPED.manifest.version}, ${Object.keys(SHIPPED.files).length} modules`);
  const granted = Object.keys(SHIPPED.manifest.permissions ?? {});
  const real = await run(SHIPPED.manifest, SHIPPED.files, granted);
  if (!real.r.ok) bad('activates through the app\'s own runner', real.r.error);
  else ok('activates through the app\'s own runner');
  if (!real.host) bad('hostV2() answers for it afterwards');
  else ok('hostV2() answers for it afterwards');
  if (!real.calls.length) bad('it reached the app across the bridge', 'no handler was called');
  else ok(`it reached the app across the bridge — ${real.calls.join(', ')}`);
} else {
  console.log('\n· No shipped fixture to run — skipping that half.');
}

if (pageErrors.length) {
  bad('nothing threw on the page', [...new Set(pageErrors)].slice(0, 5).join('\n      '));
} else {
  console.log('\n  \x1b[32m✔\x1b[0m nothing threw on the page');
}

await browser.close();
server.close();

console.log(failures ? `\n\x1b[31m✖ ${failures} failed\x1b[0m` : '\n\x1b[32m✔ the v2 runner links what it is given\x1b[0m');
process.exit(failures ? 1 : 0);
