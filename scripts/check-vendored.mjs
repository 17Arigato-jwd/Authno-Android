#!/usr/bin/env node
/**
 * check-vendored.mjs — the drift guard for files the CLI carries a copy of.
 *
 * `extensions/extbk-cli` ships its `src/` directory as-is: no bundler, no
 * workspace link, and it is published on its own. So it cannot import from the
 * app, and the repo's existing answer — `rs.js` and `reedSolomon.js` are already
 * byte-identical copies — is to vendor.
 *
 * Vendoring is fine. Vendoring WITHOUT A GUARD is how a format ends up with two
 * implementations that agree until the day they do not, which for a package
 * format means the CLI writing something the app refuses, discovered by an
 * author rather than by us.
 *
 * So the copies are asserted identical rather than merely intended to be. This
 * is deliberately cheaper and stricter than a third implementation checked by
 * the conformance corpus: there is nothing to diverge, so there is nothing for
 * the corpus to catch.
 *
 * Fixing a failure is a copy, and the command is printed.
 *
 * Usage: node scripts/check-vendored.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** [source of truth, vendored copy] */
const PAIRS = [
  ['src/utils/rs.js', 'extensions/extbk-cli/src/rs.js'],
  ['src/utils/reedSolomon.js', 'extensions/extbk-cli/src/reedSolomon.js'],
  ['src/utils/epkFormat.js', 'extensions/extbk-cli/src/epkFormat.js'],
  // The sandbox runs extensions against the app's REAL host protocol rather
  // than a mock of it. A mock is a second implementation, and the first thing
  // a second implementation does is drift: the sandbox's hand-written v1
  // context object was still the only thing it could offer when every real
  // extension had moved to v2, so the dev tool could not run the extension it
  // exists to develop.
  ['src/utils/sandboxProtocol.js', 'extensions/extbk-sandbox/src/sandboxProtocol.js'],
  ['src/utils/moduleGraph.js', 'extensions/extbk-sandbox/src/moduleGraph.js'],
  ['src/utils/extensionPermissionsV2.js', 'extensions/extbk-sandbox/src/extensionPermissionsV2.js'],
];

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', OFF = '\x1b[0m';

let failed = 0;

for (const [srcRel, copyRel] of PAIRS) {
  const src = join(root, srcRel);
  const copy = join(root, copyRel);

  if (!existsSync(src)) {
    console.log(`${RED}✗${OFF} ${srcRel} is missing — the source of truth moved?`);
    failed++;
    continue;
  }
  if (!existsSync(copy)) {
    console.log(`${RED}✗${OFF} ${copyRel} is missing`);
    console.log(`  ${DIM}cp ${srcRel} ${copyRel}${OFF}`);
    failed++;
    continue;
  }

  const a = readFileSync(src);
  const b = readFileSync(copy);
  if (a.equals(b)) {
    console.log(`${GREEN}✓${OFF} ${copyRel} ${DIM}matches ${srcRel}${OFF}`);
    continue;
  }

  failed++;
  console.log(`${RED}✗${OFF} ${copyRel} has drifted from ${srcRel}`);
  console.log(`  ${DIM}${a.length} bytes vs ${b.length}${OFF}`);

  // Name the first differing line, because "they differ" is not actionable.
  const al = a.toString('utf8').split('\n');
  const bl = b.toString('utf8').split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      console.log(`  ${DIM}first difference at line ${i + 1}:${OFF}`);
      console.log(`    ${srcRel}: ${JSON.stringify((al[i] ?? '').slice(0, 90))}`);
      console.log(`    ${copyRel}: ${JSON.stringify((bl[i] ?? '').slice(0, 90))}`);
      break;
    }
  }
  console.log(`  ${DIM}fix: cp ${srcRel} ${copyRel}${OFF}`);
}

console.log('');
if (failed) {
  console.log(`${RED}${failed} vendored file(s) out of date.${OFF}`);
  console.log('The CLI ships its src/ directory as-is, so it cannot import from the app.');
  console.log('A copy that has drifted means the CLI can write packages the app refuses.');
  process.exit(1);
}
console.log(`${GREEN}All ${PAIRS.length} vendored files match.${OFF}`);
console.log(`${DIM}${PAIRS.map(([, c]) => relative(root, join(root, c))).join(', ')}${OFF}`);
