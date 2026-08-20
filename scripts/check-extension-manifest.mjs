#!/usr/bin/env node
/**
 * Run the APP's real validators against the REAL extension manifest.
 *
 * Both sides are checked in their own repo and neither checks the other, so
 * "the manifest is valid" and "the app renders it" have never been the same
 * statement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Borrow CRA's babel preset so the app's ES modules load under node. BABEL_ENV
// matters — the preset reads it, and without it the development branch injects
// JSX source locations that point at files nothing here can resolve.
process.env.BABEL_ENV = process.env.BABEL_ENV ?? 'production';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'production';

const babel = require('@babel/core');
const Module = require('node:module');
const origJs = Module._extensions['.js'];
Module._extensions['.js'] = function (m, filename) {
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) return origJs(m, filename);
  const { code } = babel.transformFileSync(filename, {
    presets: [[require.resolve('babel-preset-react-app'), { runtime: 'automatic' }]],
    babelrc: false, configFile: false,
  });
  return m._compile(code, filename);
};

const MANIFEST = process.argv[2];
if (!MANIFEST) { console.error('usage: check-extension-manifest.mjs <manifest.json>'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const { validateManifestV2 } = require(path.join(ROOT, 'src/utils/extensionHostV2.js'));
const { validateSchema, flattenControls } = require(path.join(ROOT, 'src/utils/extensionSettingsSchema.js'));
const { parseWhen, whenAllows, whenContext } = require(path.join(ROOT, 'src/utils/whenClause.js'));
const { satisfiesMinAppVersion } = require(path.join(ROOT, 'src/utils/extensionLoader.js'));
const { APP_VERSION } = require(path.join(ROOT, 'src/version.js'));

let problems = 0;
const say = (level, msg) => { console.log(`${level === 'ERROR' ? '✗' : '·'} ${level}: ${msg}`); if (level === 'ERROR') problems++; };

console.log(`manifest: ${manifest.id} v${manifest.version}   app: ${APP_VERSION}\n`);

// ── 1. Does it validate at all? ──────────────────────────────────────────────
const v = validateManifestV2(manifest);
console.log(`validateManifestV2 → ok=${v.ok}`);
for (const e of v.errors) say('ERROR', `manifest: ${e}`);
for (const w of v.warnings ?? []) say('warn', `manifest: ${w}`);

// ── 2. Would this app version even run it? ───────────────────────────────────
if (!satisfiesMinAppVersion(manifest, APP_VERSION)) {
  say('ERROR', `minAppVersion ${manifest.minAppVersion} is not satisfied by ${APP_VERSION} — it installs and never activates`);
} else {
  console.log(`· minAppVersion ${manifest.minAppVersion ?? '(none)'} satisfied by ${APP_VERSION}`);
}

// ── 3. Settings schema ───────────────────────────────────────────────────────
const schema = manifest.settings?.schema;
const sc = validateSchema(schema);
console.log(`\nvalidateSchema → ok=${sc.ok} (${flattenControls(schema).length} controls)`);
for (const e of sc.errors) say('ERROR', `settings: ${e}`);

// Keys the manifest sets that the renderer has no support for.
const RENDERED = new Set([
  'type', 'key', 'label', 'hint', 'default', 'options', 'min', 'max',
  'command', 'source', 'children', 'placeholder', 'intervalMs',
  'suffix',     // the unit beside a number field
  'collapsed',  // a section that starts closed
]);
for (const c of [...(schema ?? []), ...flattenControls(schema)]) {
  for (const k of Object.keys(c)) {
    if (!RENDERED.has(k)) say('warn', `settings control ${JSON.stringify(c.label ?? c.key)} sets "${k}", which nothing renders`);
  }
}

// ── 4. `when` clauses ────────────────────────────────────────────────────────
console.log('');
const ctx = whenContext({ app: { platform: 'android', version: APP_VERSION }, book: { isOpen: true, isSaved: true, chapterCount: 3 }, settings: {} });
for (const [group, items] of Object.entries(manifest.contributes ?? {})) {
  const list = Array.isArray(items) ? items : [...(items.tabs ?? []), ...(items.actions ?? [])];
  for (const it of list) {
    if (!it.when) continue;
    try {
      parseWhen(it.when);
      const withPerm = whenAllows(it.when, ctx, ['network', 'library:read:all', 'library:write', 'library:export', 'browser']);
      console.log(`· when ${JSON.stringify(it.when)} parses; with every permission granted → ${withPerm}`);
    } catch (e) {
      say('ERROR', `when on ${group}/${it.id}: ${e.message}`);
    }
  }
}

// ── 5. Commands referenced vs declared ───────────────────────────────────────
console.log('');
const declared = new Set(manifest.commands ?? []);
const used = new Set();
for (const items of Object.values(manifest.contributes ?? {})) {
  const list = Array.isArray(items) ? items : [...(items.tabs ?? []), ...(items.actions ?? [])];
  for (const it of list) if (it.command) used.add(it.command);
}
for (const c of flattenControls(schema)) {
  if (c.command) used.add(c.command);
  if (c.source) used.add(c.source);
}
for (const c of used) if (!declared.has(c)) say('ERROR', `command "${c}" is used but not declared`);
for (const c of declared) if (!used.has(c)) say('warn', `command "${c}" is declared but nothing in the manifest invokes it`);

// ── 6. Contribution groups the app actually renders ──────────────────────────
console.log('');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Which slots the app reads, asked of the code rather than assumed.
//
// This used to look for `contributes?.<slot>` and nothing else, which stopped
// being true the moment the hook destructured `contributes` into a local —
// and a checker that reports a fixed bug as still broken is worse than no
// checker. Matching the slot NAME anywhere in the file it would have to be
// named in is coarser and does not go stale on a refactor; these names are
// distinctive enough that a stray match is not a real risk.
const ctxSrc = src('src/utils/ExtensionContext.js');
const KNOWN_SLOTS = ['settings', 'homescreen', 'bookActions', 'chapterActions',
  'editorToolbar', 'widgets', 'bookDashboard', 'pages'];
const rendered = new Set(KNOWN_SLOTS.filter((slot) => {
  if (new RegExp(`\\b${slot}\\b`).test(ctxSrc)) return true;
  return fs.readdirSync(path.join(ROOT, 'src/components'))
    .filter((f) => f.endsWith('.jsx'))
    .some((f) => new RegExp(`useExtensionContributions\\('${slot}'`).test(src(`src/components/${f}`)));
}));
console.log(`app renders these contribution groups: ${[...rendered].sort().join(', ')}`);
for (const group of Object.keys(manifest.contributes ?? {})) {
  if (!rendered.has(group) && group !== 'type') {
    say('ERROR', `contributes.${group} is declared and validates, but no app surface reads it — those entries never appear`);
  }
}

console.log(`\n${problems === 0 ? 'no errors' : problems + ' error(s)'}`);
process.exit(0);
