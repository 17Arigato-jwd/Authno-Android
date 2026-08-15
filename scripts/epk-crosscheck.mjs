#!/usr/bin/env node
/**
 * epk-crosscheck.mjs — run both VCHS-EPK readers over the same corpus and
 * require them to agree.
 *
 * Spec §8a. The browser reader (src/utils/epkFormat.js) holds the whole package
 * in memory; the desktop reader (epkReaderNode.js) works from a file descriptor
 * and reads ranges. They share only the Reed-Solomon math. That is deliberate:
 * two ports of one file agree trivially and prove nothing, whereas two genuine
 * implementations disagree exactly where a format is ambiguous.
 *
 * A disagreement here is a real defect in one of them, or in the spec.
 *
 * Usage:  node scripts/epk-crosscheck.mjs [--verbose]
 * Exits non-zero on any divergence, so CI can gate on it.
 */

import { createRequire } from 'module';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { webcrypto } from 'crypto';

/* eslint-disable no-undef */
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;
/* eslint-enable no-undef */

const require = createRequire(import.meta.url);
const nodeReader = require('../epkReaderNode.js');
const epk = await import('../src/utils/epkFormat.js');
const corpus = await import('../src/utils/epkCorpus.js');

const VERBOSE = process.argv.includes('--verbose');
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', OFF = '\x1b[0m';

let pass = 0;
const failures = [];

/**
 * Both readers reduced to one comparable value.
 *
 * Only the verdict is compared, not the message: reason strings are contract,
 * prose is not.
 */
function verdictOf(result, error) {
  if (error) return `refused:${error.reason}`;
  return [
    'ok',
    `entries=${result.entryCount}`,
    `id=${result.manifest?.id}`,
    `repairs=${result.repairs.map((r) => r.rung).sort().join('|') || 'none'}`,
    `signed=${result.signed}`,
    `sigOk=${result.signatureOk}`,
    `headerFrom=${result.headerSource}`,
  ].join(' ');
}

/** Entry-level agreement: same paths, same bytes, same drops. */
async function entryVerdict(result) {
  if (!result || !result.entries) return '';
  const out = [];
  for (const path of [...result.entries.keys()].sort()) {
    let mark;
    try {
      const data = await result.read(path);
      mark = data === null ? 'dropped' : `${data.length}:${hashOf(data)}`;
    } catch (e) {
      mark = `throw:${e.reason || e.message}`;
    }
    out.push(`${path}=${mark}`);
  }
  return out.join(' ');
}

function hashOf(bytes) {
  // FNV-1a; only needs to be a cheap stable fingerprint for comparison.
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

async function compare(name, bytes, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'epk-'));
  const file = join(dir, 'fixture.extbk');
  await writeFile(file, Buffer.from(bytes));

  let browserResult = null, browserErr = null;
  try {
    browserResult = await epk.readEpk(bytes, opts.browser || opts.common || {});
  } catch (e) { browserErr = e; }

  let nodeResult = null, nodeErr = null;
  try {
    nodeResult = await nodeReader.openEpk(file, opts.node || opts.common || {});
  } catch (e) { nodeErr = e; }

  const a = verdictOf(browserResult, browserErr);
  const b = verdictOf(nodeResult, nodeErr);
  const ae = await entryVerdict(browserResult);
  const be = await entryVerdict(nodeResult);

  if (nodeResult) await nodeResult.close();
  await rm(dir, { recursive: true, force: true });

  const agree = a === b && ae === be;
  if (agree) {
    pass++;
    if (VERBOSE) console.log(`${GREEN}✓${OFF} ${name} ${DIM}${a}${OFF}`);
  } else {
    failures.push({ name, browser: a, node: b, browserEntries: ae, nodeEntries: be });
    console.log(`${RED}✗${OFF} ${name}`);
    console.log(`    browser: ${a}`);
    console.log(`    node:    ${b}`);
    if (ae !== be) {
      console.log(`    browser entries: ${ae}`);
      console.log(`    node entries:    ${be}`);
    }
  }
}

// ─── Run the corpus ──────────────────────────────────────────────────────────

console.log('VCHS-EPK cross-implementation check — browser reader vs desktop reader\n');

const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const spki = Buffer.from(await crypto.subtle.exportKey('spki', kp.publicKey));
const nodePublicKey = (await import('crypto')).createPublicKey({
  key: spki, format: 'der', type: 'spki',
});

console.log('well-formed');
for (const name of corpus.EXPECTED.wellFormed) {
  await compare(name, await corpus.wellFormed[name]());
}

console.log('\nrepair ladder');
const base = await corpus.wellFormed.mixedCodecs();
const single = await corpus.wellFormed.single();
await compare('frontHeaderZeroed', corpus.damage.frontHeaderZeroed(single).bytes);
await compare('truncated', corpus.damage.truncated(base, 0.6).bytes);
await compare('coreBitRot', corpus.damage.coreBitRot(single, 6).bytes);
await compare('coreDestroyed', corpus.damage.coreDestroyed(single).bytes);
await compare('directoryBitRot', corpus.damage.directoryBitRot(base, 4).bytes);
await compare('directoryAndParityZeroed', corpus.damage.directoryAndParityZeroed(base).bytes);

// Rungs 7 and 8 need an entry's location, so they are built from a read.
{
  const wasmPkg = await corpus.wellFormed.withWasm();
  const probe = await epk.readEpk(wasmPkg);
  const code = probe.entries.get('engine.wasm');
  const asset = probe.entries.get('logo.png');
  await compare('codeEntryBitRot',
    corpus.damageEntry(wasmPkg, code.entryOffset, code.storedSize, 3, 17));
  await compare('assetEntryBitRot',
    corpus.damageEntry(wasmPkg, asset.entryOffset, asset.storedSize, 4, 23));
}

console.log('\nhostile');
for (const name of Object.keys(corpus.hostile)) {
  if (name === 'signedTampered' || name === 'blobTampered') continue;
  await compare(name, corpus.hostile[name](base));
}

console.log('\nsigning');
{
  const signedPkg = await corpus.wellFormed.signed(kp.privateKey);
  const keys = { browser: { publicKey: kp.publicKey }, node: { publicKey: nodePublicKey } };
  await compare('signed-valid', signedPkg, keys);
  await compare('signed-mapEdited', corpus.hostile.signedTampered(signedPkg), keys);
  await compare('signed-assetEdited', corpus.hostile.blobTampered(signedPkg), keys);
  await compare('unsigned-fromChannel', single, {
    browser: { fromChannel: true }, node: { fromChannel: true },
  });
  await compare('signed-repairedThenVerified',
    corpus.corrupt(signedPkg, {
      from: corpus.locate(signedPkg).coreOffset,
      to: corpus.locate(signedPkg).coreOffset + 150,
      count: 4, seed: 77,
    }), keys);
}

// ─── Report ──────────────────────────────────────────────────────────────────

console.log('');
if (failures.length) {
  console.log(`${RED}${failures.length} divergence(s)${OFF}, ${pass} agreed.`);
  console.log('\nA divergence is a defect in one reader or an ambiguity in the spec.');
  console.log('Three implementations of one format break silently otherwise.');
  process.exit(1);
}
console.log(`${GREEN}All ${pass} fixtures agree.${OFF}`);
