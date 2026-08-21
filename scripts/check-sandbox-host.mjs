#!/usr/bin/env node
/**
 * check-sandbox-host.mjs — what the sandbox ships, and whether it works.
 *
 * The sandbox used to hand out a copy of AuthNo's production build. An
 * extension author needs somewhere for their contributions to land, so
 * something app-shaped has to be there — but the app itself carries the
 * access gate, the onboarding flow, the account handling, the key file, the
 * billing page and the rescue export, none of which an extension can call,
 * see or affect. Shipping all of it inside a dev tool anybody may download is
 * a lot of surface given away for nothing.
 *
 * `src/sandbox/` is a different app: the extension surfaces and what they
 * need. This check is what makes that claim worth anything, because "we did
 * not import it" is a promise about the source and the package is bytes. So
 * both halves are asserted here:
 *
 *   what is in it   the module graph and the built bytes, against a list of
 *                   things that must not appear and a list that must
 *   what it does    a browser, a real .extbk, the real install flow, and the
 *                   contributions rendering afterwards
 *
 * The second half is not a formality. Reading a manifest back off the web
 * Filesystem returned base64 and every desktop install was discarded in
 * silence; the module graph looked perfect throughout. Only running it found
 * that.
 *
 * Usage: npm run check:sandbox-host
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchOptions } from './chromium.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = path.join(ROOT, 'extensions/extbk-sandbox/host');
const FIXTURE = path.join(ROOT, 'src/utils/__fixtures__/cloud-backup-2.0.0.extbk');
const PORT = 4478;

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const bad = (m, d) => { failures++; console.log(`  \x1b[31m✖\x1b[0m ${m}`); if (d) console.log(`      ${d}`); };

/**
 * Modules that must not be in the graph, and why each one is named.
 *
 * The list is specific rather than a pattern: a pattern that stopped matching
 * after a rename would pass silently, which is the failure mode a check like
 * this exists to avoid. Each entry is a substring of a path in modules.json.
 */
const FORBIDDEN_MODULES = [
  ['src/App.js', 'the whole app'],
  ['components/AccessGate', 'the gate'],
  ['components/Onboarding', 'onboarding'],
  ['components/onboarding/', 'the welcome slides'],
  ['components/BillingPage', 'billing'],
  ['components/ProGate', 'the paywall'],
  ['components/ExportRescue', 'the rescue export'],
  ['components/Settings.jsx', "the app's settings"],
  ['components/Sidebar', 'the library drawer'],
  ['components/HomeScreen', "the app's home screen"],
  ['components/BookStudio', 'the editor'],
  ['components/EditorToolbar', 'the editor toolbar'],
  ['utils/access.js', 'the access key'],
  ['utils/gateApi', 'the gate API'],
  ['utils/keyfile', 'the key file'],
  ['utils/googleAuth', "the app's own sign-in"],
  ['utils/rescue.js', 'the rescue path'],
  ['utils/billing.js', 'billing'],
  ['utils/storage.js', "the app's file layer"],
  ['utils/widgetBridge', 'the widget bridge'],
];

/** Strings only the excluded code has. Read from the built bytes, not the source. */
const FORBIDDEN_STRINGS = [
  ['REACT_APP_ACCESS_PUBKEY', 'the gate\'s public key name'],
  ['authno_access_key', 'the stored access key'],
  ['offlineWriterSessions', 'the session mirror'],
  ['AuthNoGate', 'the gate'],
  ['unlockProMock', 'the billing mock'],
  ['saveAsBook(', 'the save-as path'],
];

/** Surfaces that MUST be there — the check has to fail both ways. */
const REQUIRED_MODULES = [
  'components/ExtensionPage',
  'components/ExtensionPanel',
  'components/ExtensionDots',
  'components/ExtensionTab',
  'components/ExtensionPermissions',
  'components/ExtensionPromptDialog',
  'components/ExtensionSettingsPage',
  'components/PermissionRequestSheet',
  'components/InstallSheet',
  'utils/extensionRunnerV2',
  'utils/extensionHostV2',
  'utils/ExtensionContext',
  'sandbox/SandboxHost',
];

// ── 1. the package ───────────────────────────────────────────────────────────

if (!fs.existsSync(path.join(HOST, 'host.js'))) {
  console.error('✖ no sandbox host built — run `npm run build:sandbox-host` first');
  process.exit(1);
}

const bytes = fs.readFileSync(path.join(HOST, 'host.js'), 'utf8');
const modules = JSON.parse(fs.readFileSync(path.join(HOST, 'modules.json'), 'utf8')).modules;
const appModules = modules.filter((m) => m.startsWith('src/'));

console.log(`\nWhat is in it — ${(bytes.length / 1024).toFixed(0)} KB, ${appModules.length} app modules`);

for (const [needle, what] of FORBIDDEN_MODULES) {
  const hit = modules.filter((m) => m.includes(needle));
  if (hit.length) bad(`${what} is not in the bundle`, hit.join(', '));
}
if (!FORBIDDEN_MODULES.some(([n]) => modules.some((m) => m.includes(n)))) {
  ok(`none of the ${FORBIDDEN_MODULES.length} excluded modules is in the graph`);
}

for (const [needle, what] of FORBIDDEN_STRINGS) {
  if (bytes.includes(needle)) bad(`${what} does not appear in the bytes`, `found "${needle}"`);
}
if (!FORBIDDEN_STRINGS.some(([n]) => bytes.includes(n))) {
  ok(`none of the ${FORBIDDEN_STRINGS.length} excluded strings is in the bytes`);
}

const missing = REQUIRED_MODULES.filter((r) => !modules.some((m) => m.includes(r)));
if (missing.length) bad('every extension surface is present', `missing ${missing.join(', ')}`);
else ok(`all ${REQUIRED_MODULES.length} extension surfaces are present`);

// A map is every excluded module's source, shipped as text beside the bundle
// that carefully does not contain it.
if (bytes.includes('sourceMappingURL') || fs.existsSync(path.join(HOST, 'host.js.map'))) {
  bad('no source map ships with the host');
} else ok('no source map ships with the host');

// The old arrangement: CI downloaded the app's production build and dropped it
// in. If that ever comes back, everything above is beside the point.
const appDir = path.join(ROOT, 'extensions/extbk-sandbox/app');
if (fs.existsSync(appDir)) {
  bad("no copy of the app's own build is in the package", `${appDir} exists`);
} else ok("no copy of the app's own build is in the package");

// ── 2. what it does ──────────────────────────────────────────────────────────

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((q, r) => {
  const p = path.join(HOST, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!p.startsWith(HOST) || !fs.existsSync(p)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'text/plain' });
  r.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // A favicon nobody ships. Not a finding.
  if (t.includes('favicon') || t.includes('status of 404')) return;
  errors.push(`console: ${t}`);
});

const body = () => page.evaluate(() => document.body.innerText);
const tab = async (name) => {
  await page.getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(400);
};

console.log('\nWhat it does');
try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const first = await body();
  if (!first.includes('Sandbox host')) bad('it boots', first.slice(0, 200));
  else ok('it boots');

  if (!first.includes('The Salt Road')) bad('the fabricated library is there');
  else ok('the fabricated library is there');

  // The install path an author actually uses, through the app's own sheet.
  await tab('Extensions');
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(/Install from file/i).first().click();
  (await chooser).setFiles(FIXTURE);
  await page.waitForTimeout(2000);

  const asking = await body();
  if (!asking.includes('wants permission')) bad('the permission sheet asks', asking.slice(0, 300));
  else ok('the permission sheet asks before anything runs');

  await page.getByText(/Allow all/i).first().click();
  await page.waitForTimeout(3500);

  await tab('Settings');
  const settings = await body();
  if (!/\brunning\b/.test(settings)) {
    bad('the extension is running afterwards', settings.slice(settings.indexOf('PERMISSIONS'), 400));
  } else ok('the extension is running afterwards');

  if (!settings.includes('Cloud Backup')) bad('its settings row renders');
  else ok('its settings row renders');

  await tab('Home');
  if (!(await body()).includes('Cloud Backup')) bad('its home tile renders');
  else ok('its home tile renders');

  // With a book open, the bookActions whose `when` reads book.isSaved appear.
  await page.selectOption('select:below(:text("Open book"))', { index: 1 }).catch(async () => {
    const selects = page.locator('select');
    await selects.nth(await selects.count() - 1).selectOption({ index: 1 });
  });
  await page.waitForTimeout(600);
  await tab('Book');
  const book = await body();
  if (!/Back up now|Cloud files/.test(book)) {
    bad('book actions appear once a book is open', book.slice(0, 400));
  } else ok('book actions appear once a book is open');

  await tab('Slots');
  const slots = await body();
  if (!slots.includes('bookActions')) bad('the slot inspector lists what was declared', slots.slice(0, 300));
  else ok('the slot inspector lists what was declared');
  if (!slots.includes('when:')) bad('the slot inspector shows the clauses');
  else ok('the slot inspector shows the clauses');

  if (errors.length) bad('nothing threw', [...new Set(errors)].slice(0, 6).join('\n      '));
  else ok('nothing threw');
} catch (e) {
  bad('the run completed', e.message.split('\n')[0]);
  if (errors.length) console.log(`      ${[...new Set(errors)].slice(0, 6).join('\n      ')}`);
}

await browser.close();
server.close();

console.log(failures
  ? `\n\x1b[31m✖ ${failures} failed\x1b[0m`
  : '\n\x1b[32m✔ the sandbox host is what it says it is, and it runs an extension\x1b[0m');
process.exit(failures ? 1 : 0);
