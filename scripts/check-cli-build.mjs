#!/usr/bin/env node
/**
 * check-cli-build.mjs — build an extension with the real CLI, then read it with
 * the app.
 *
 * The format tests prove the writer and readers agree about bytes. This proves
 * something they cannot: that `extbk build` WIRES them correctly — that .js
 * lands in the Reed-Solomon-protected core rather than the blob, that an
 * already-compressed image is stored rather than deflated, that a v2 manifest
 * produces an EPK and a v1 manifest still produces an ECS file.
 *
 * Those are one-line mistakes in the command, invisible to a format test,
 * and each of them ships an extension that installs and then behaves oddly.
 *
 * Usage: node scripts/check-cli-build.mjs
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';

/* eslint-disable no-undef */
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;
/* eslint-enable no-undef */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(root, 'extensions/extbk-cli/src/cli.js');

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', OFF = '\x1b[0m';

let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`${GREEN}✓${OFF} ${name}${detail ? ` ${DIM}${detail}${OFF}` : ''}`); }
  else { console.log(`${RED}✗${OFF} ${name} ${detail}`); failed++; }
};

function scaffold(manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'extbk-src-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'index.js'), 'export function activate(host) { host.log("up"); }\n');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib/queue.js'), 'export const q = 1;\n');
  // A PNG signature, so the codec choice is made on a real-looking file.
  writeFileSync(join(dir, 'icon.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(join(dir, 'data.json'), JSON.stringify({ padding: 'x'.repeat(600) }));
  return dir;
}

function build(srcDir) {
  const outDir = mkdtempSync(join(tmpdir(), 'extbk-out-'));
  const stdout = execFileSync('node', [CLI, 'build', srcDir, '--out-dir', outDir, '--overwrite'], {
    encoding: 'utf8',
  });
  const file = stdout.trim().split('\n').pop().trim();
  return { file, stdout, outDir };
}

console.log('extbk build → app reader\n');

const V2 = {
  apiVersion: 2,
  id: 'cli-e2e',
  name: 'CLI End To End',
  version: '2.0.0',
  author: 'AuthNo',
  permissions: { 'library:read:all': { reason: 'To read your books.' } },
};

const src = scaffold(V2);
const { file, stdout } = build(src);

check('a v2 manifest builds as EPK', stdout.includes('VCHS-EPK'));

const bytes = new Uint8Array(readFileSync(file));
const epk = await import(join(root, 'src/utils/epkFormat.js'));

check('the app recognises it as EPK', epk.isEpk(bytes));

const r = await epk.readEpk(bytes);
check('it reads with no repairs needed', r.repairs.length === 0, `repairs=${r.repairs.length}`);
check('the manifest survives the round trip', r.manifest.id === 'cli-e2e');
check('the declared permission survives', !!r.manifest.permissions?.['library:read:all']);

// The core/blob split is the decision most easily got wrong in the command.
const modules = Object.keys(r.modules).sort();
check('every .js is in the RS-protected core',
  modules.join(',') === 'index.js,lib/queue.js', modules.join(','));
check('no .js leaked into the blob region',
  ![...r.entries.keys()].some((p) => p.endsWith('.js')), [...r.entries.keys()].join(','));

const entries = [...r.entries.keys()].sort();
check('assets are blob entries', entries.join(',') === 'data.json,icon.png', entries.join(','));

const png = r.entries.get('icon.png');
const json = r.entries.get('data.json');
check('an already-compressed image is stored, not deflated',
  png.codec === epk.CODEC_STORE, `codec=${png.codec}`);
check('a text-shaped asset is deflated',
  json.codec === epk.CODEC_DEFLATE, `codec=${json.codec}`);
check('deflating the text asset actually saved space',
  json.storedSize < json.originalSize, `${json.storedSize} < ${json.originalSize}`);

check('asset bytes verify against their digests',
  (await r.read('icon.png')) !== null && (await r.read('data.json')) !== null);

// And the desktop reader, from the same file, must agree.
const { createRequire } = await import('module');
const require = createRequire(join(root, 'noop.js'));
const nodeReader = require(join(root, 'epkReaderNode.js'));
const h = await nodeReader.openEpk(file);
check('the desktop reader agrees on the entry list',
  [...h.entries.keys()].sort().join(',') === entries.join(','));
check('the desktop reader agrees on the manifest', h.manifest.id === r.manifest.id);
await h.close();

// A v1 manifest must still produce an ECS file — the CLI serves both during
// the port, and silently changing an existing author's output would be worse
// than refusing.
const v1src = scaffold({ id: 'cli-v1', name: 'Old', version: '1.0.0' });
const v1 = build(v1src);
check('a v1 manifest still builds as ECS', v1.stdout.includes('VCHS-ECS'));
const v1bytes = new Uint8Array(readFileSync(v1.file));
check('the app does not mistake an ECS file for EPK', !epk.isEpk(v1bytes));

for (const d of [src, v1src]) rmSync(d, { recursive: true, force: true });

console.log('');
if (failed) {
  console.log(`${RED}${failed} check(s) failed.${OFF}`);
  process.exit(1);
}
console.log(`${GREEN}The CLI builds packages the app reads.${OFF}`);
