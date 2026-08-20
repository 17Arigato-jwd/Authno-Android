#!/usr/bin/env node
/**
 * check-widget-ids.mjs — every R.id a widget provider names exists in a layout.
 *
 * Gradle would catch this in a second, and Gradle cannot run here: the build
 * needs dl.google.com. So the one class of error that is both easy to make and
 * fatal at runtime gets checked the way it can be.
 *
 * The error is specific: a provider calling setViewVisibility on an id that no
 * layout declares does not fail at build time in this environment and does not
 * fail visibly at runtime either — RemoteViews collects the action, the
 * launcher applies it, and the view it names is not there. Nothing throws
 * where anyone can see it; the widget just does not do the thing.
 *
 * Adding a view to a provider before adding its id to the layout is exactly
 * how that happens, and it is what this catches.
 */

import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const JAVA = join(root, 'android/app/src/main/java/com/aurorastudios/authno');
const RES = join(root, 'android/app/src/main/res');

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', OFF = '\x1b[0m';

/** Every id any layout declares. */
const declared = new Set();
for (const dir of ['layout', 'drawable', 'xml']) {
  for (const f of readdirSync(join(RES, dir))) {
    if (!f.endsWith('.xml')) continue;
    const src = readFileSync(join(RES, dir, f), 'utf8');
    for (const m of src.matchAll(/android:id="@\+id\/([\w]+)"/g)) declared.add(m[1]);
  }
}

/** Every layout any provider inflates. */
const layouts = new Set(readdirSync(join(RES, 'layout')).map((f) => f.replace(/\.xml$/, '')));

let problems = 0;
const files = readdirSync(JAVA).filter((f) => /Widget/.test(f) && f.endsWith('.java'));

console.log('Widget providers against the layouts they inflate\n');

for (const f of files) {
  const src = readFileSync(join(JAVA, f), 'utf8')
    // Comments discuss ids that were removed, and would report themselves.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const badIds = [...new Set([...src.matchAll(/\bR\.id\.(\w+)/g)].map((m) => m[1]))]
    .filter((id) => !declared.has(id));
  const badLayouts = [...new Set([...src.matchAll(/\bR\.layout\.(\w+)/g)].map((m) => m[1]))]
    .filter((l) => !layouts.has(l));

  if (badIds.length || badLayouts.length) {
    problems += badIds.length + badLayouts.length;
    console.log(`${RED}${f}${OFF}`);
    for (const id of badIds) console.log(`  ✖ R.id.${id} is in no layout`);
    for (const l of badLayouts) console.log(`  ✖ R.layout.${l} does not exist`);
  }
}

if (problems) {
  console.log(`\n${RED}${problems} reference(s) to something that does not exist.${OFF}`);
  console.log('A RemoteViews action naming a missing id does not throw where');
  console.log('anyone can see it — the widget simply does not do the thing.');
  process.exit(1);
}
console.log(`${GREEN}Every R.id and R.layout a widget provider names exists.${OFF}`);
console.log(`${DIM}${files.length} providers, ${declared.size} declared ids${OFF}`);

// ── Does the Java still parse? ───────────────────────────────────────────────
//
// Gradle cannot run in every environment this repo is worked on in — the
// Android build needs dl.google.com — so a syntax error in a provider can be
// committed and pushed with nothing complaining. javac alone catches it.
//
// It cannot RESOLVE anything without android.jar, so every reference to
// android.*, org.json, androidx and Capacitor comes back "cannot find symbol"
// or "package does not exist". Those are expected and ignored. Anything else
// javac says is a real problem in the source: a missing brace, a stray comma,
// a method declared inside another method.
console.log('');
let javac;
try {
  javac = execFileSync('which', ['javac'], { encoding: 'utf8' }).trim();
} catch {
  console.log(`${DIM}· javac not installed — skipping the syntax pass.${OFF}`);
  process.exit(0);
}

const out = mkdtempSync(join(tmpdir(), 'authno-javac-'));
let raw = '';
try {
  execFileSync(javac, ['-nowarn', '-d', out, ...readdirSync(JAVA).filter((f) => f.endsWith('.java')).map((f) => join(JAVA, f))], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  raw = String(e.stderr ?? '') + String(e.stdout ?? '');
} finally {
  rmSync(out, { recursive: true, force: true });
}

const EXPECTED = /cannot find symbol|package [\w.]+ does not exist|static import only from classes and interfaces/;
const real = raw.split('\n')
  .filter((l) => /:\d+: error:/.test(l))
  .filter((l) => !EXPECTED.test(l));

if (real.length) {
  console.log(`${RED}javac found ${real.length} error(s) that are not missing-symbol:${OFF}`);
  for (const l of real.slice(0, 20)) console.log(`  ${l.trim()}`);
  process.exit(1);
}
const total = raw.split('\n').filter((l) => /:\d+: error:/.test(l)).length;
console.log(`${GREEN}The Java parses.${OFF} ${DIM}${total} missing-symbol errors, all expected without android.jar${OFF}`);
