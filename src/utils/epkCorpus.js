/**
 * epkCorpus.js — the VCHS-EPK conformance corpus (spec §8a)
 *
 * EPK gets three independent implementations: a native Android unpacker, the
 * Electron main process, and the JS reader in epkFormat.js. Three
 * implementations of one format is where formats break, and they break
 * *silently* — one reader accepts what another refuses, and it surfaces months
 * later as a bug report from the one platform nobody tested on.
 *
 * So the corpus is defined once, here, and every reader is run against it with
 * the same expected verdicts. This module builds fixtures rather than storing
 * them: damage is applied by a seeded corruptor, so a fixture is a recipe and
 * regenerates identically instead of living in the repo as an opaque binary.
 *
 * Three families:
 *   wellFormed  — must read cleanly, no repairs, no warnings
 *   damaged     — must be REPAIRED, at a named rung of the §6a ladder
 *   hostile     — must be REFUSED, with a named reason, without repair
 */

import {
  packEpk, EPK_MAGIC, HEADER_SIZE, TAIL_SIZE, RECORD_FIXED,
  CODEC_STORE, CODEC_DEFLATE, KIND_ASSET, KIND_CODE, KIND_FONT,
} from './epkFormat.js';
import { rsEncodeChunked } from './rs.js';

/** Same parity geometry the format uses — see nParity() in epkFormat.js. */
const NSYM = Math.min(Math.floor((255 * 20) / 100), 127);

const ENC = new TextEncoder();

// ─── A tiny deterministic PRNG, so "random" damage is reproducible ───────────

/** mulberry32 — same seed, same corruption, on every platform and every run. */
export function seeded(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flip `count` bytes inside [from, to), chosen by the seeded PRNG. */
export function corrupt(bytes, { from, to, count, seed = 1 }) {
  const out = bytes.slice();
  const rnd = seeded(seed);
  const span = to - from;
  for (let i = 0; i < count; i++) {
    const at = from + Math.floor(rnd() * span);
    out[at] = (out[at] ^ (1 + Math.floor(rnd() * 255))) & 0xff;
  }
  return out;
}

export function zeroRange(bytes, from, to) {
  const out = bytes.slice();
  out.fill(0, from, Math.min(to, out.length));
  return out;
}

// ─── Sample content ──────────────────────────────────────────────────────────

export const SAMPLE_MANIFEST = {
  apiVersion: 2,
  id: 'corpus-fixture',
  name: 'Corpus Fixture',
  version: '2.0.0',
  description: 'A package that exists to be read wrongly.',
  author: 'AuthNo',
  icon: 'Package',
  minAppVersion: '1.1.20-beta.0',
  permissions: {},
  contributes: {},
  pages: {},
};

export const SAMPLE_MODULES = {
  'index.js': 'export function activate(host) { host.log("hello"); }\n',
  'lib/util.js': 'export const noop = () => {};\n',
};

function bytesOf(s) { return ENC.encode(s); }

/** Incompressible-ish bytes, so a `store` entry is genuinely stored. */
function noise(n, seed) {
  const rnd = seeded(seed);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256);
  return b;
}

// ─── Well-formed fixtures ────────────────────────────────────────────────────

export const wellFormed = {
  async empty() {
    return packEpk({ manifest: SAMPLE_MANIFEST, modules: SAMPLE_MODULES, assets: [] });
  },

  async single() {
    return packEpk({
      manifest: SAMPLE_MANIFEST,
      modules: SAMPLE_MODULES,
      assets: [{ path: 'icon.png', data: noise(600, 7), kind: KIND_ASSET, codec: CODEC_STORE }],
    });
  },

  async mixedCodecs() {
    return packEpk({
      manifest: SAMPLE_MANIFEST,
      modules: SAMPLE_MODULES,
      assets: [
        { path: 'a/data.json', data: bytesOf(JSON.stringify({ x: 'y'.repeat(400) })), codec: CODEC_DEFLATE },
        { path: 'b/photo.jpg', data: noise(2000, 3), codec: CODEC_STORE },
        { path: 'c/font.woff2', data: noise(900, 11), kind: KIND_FONT, codec: CODEC_STORE },
      ],
    });
  },

  /** A kind=code entry, which is the one blob entry that carries parity (§4a). */
  async withWasm() {
    return packEpk({
      manifest: SAMPLE_MANIFEST,
      modules: SAMPLE_MODULES,
      assets: [
        { path: 'engine.wasm', data: noise(3000, 21), kind: KIND_CODE, codec: CODEC_STORE },
        { path: 'logo.png', data: noise(500, 22), kind: KIND_ASSET, codec: CODEC_STORE },
      ],
    });
  },

  async unicodeAndNesting() {
    return packEpk({
      manifest: SAMPLE_MANIFEST,
      modules: SAMPLE_MODULES,
      assets: [
        { path: 'assets/日本語/画像.png', data: noise(300, 31), codec: CODEC_STORE },
        { path: 'a/b/c/d/e/f/g/deep.txt', data: bytesOf('deep'), codec: CODEC_DEFLATE },
        { path: 'émoji-🎨.svg', data: bytesOf('<svg/>'), codec: CODEC_DEFLATE },
      ],
    });
  },

  async lazyEntry() {
    return packEpk({
      manifest: SAMPLE_MANIFEST,
      modules: SAMPLE_MODULES,
      assets: [{ path: 'big.bin', data: noise(5000, 41), lazy: true, codec: CODEC_STORE }],
    });
  },

  async manyEntries(n = 400) {
    const assets = [];
    for (let i = 0; i < n; i++) {
      assets.push({
        path: `tiles/tile-${String(i).padStart(4, '0')}.txt`,
        data: bytesOf(`tile ${i}`),
        codec: CODEC_DEFLATE,     // deflate skips 4096 alignment, keeping the fixture small
      });
    }
    return packEpk({ manifest: SAMPLE_MANIFEST, modules: SAMPLE_MODULES, assets });
  },

  async signed(privateKey) {
    return packEpk({
      manifest: SAMPLE_MANIFEST,
      modules: SAMPLE_MODULES,
      assets: [{ path: 'icon.png', data: noise(400, 51), codec: CODEC_STORE }],
      signWith: privateKey,
    });
  },
};

// ─── Locating structures, for the damage fixtures ────────────────────────────

export function locate(pkg) {
  const o = pkg.length - TAIL_SIZE;
  const rd32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const dirOffset = rd32(pkg, o + 10);
  const dirLength = rd32(pkg, o + 14);
  const entryCount = rd32(pkg, o + 18);
  const dirParityLength = rd32(pkg, o + 22);
  return {
    tailAt: o,
    dirOffset, dirLength, entryCount, dirParityLength,
    dirParityAt: dirOffset + dirLength,
    sigAt: dirOffset + dirLength + dirParityLength,
    coreOffset: rd32(pkg, 28),
    coreLength: rd32(pkg, 32),
    blobOffset: rd32(pkg, 36),
    blobLength: rd32(pkg, 40),
  };
}

// ─── Damage fixtures — each names the rung that must catch it ────────────────

export const damage = {
  /** Rung 1: the front header is gone; the tail's copy stands in. */
  frontHeaderZeroed: (pkg) => ({ bytes: zeroRange(pkg, 0, HEADER_SIZE), rung: 1 }),

  /** Rung 3: an unfinished download, not corruption. */
  truncated: (pkg, fraction = 0.6) => ({
    bytes: pkg.slice(0, Math.floor(pkg.length * fraction)),
    incomplete: true,
  }),

  /** Rung 4: bit rot in the core, inside RS tolerance. */
  coreBitRot: (pkg, count = 6) => {
    const L = locate(pkg);
    return { bytes: corrupt(pkg, { from: L.coreOffset, to: L.coreOffset + 200, count, seed: 5 }), rung: 4 };
  },

  /** Beyond RS tolerance — a refusal, not a repair. */
  coreDestroyed: (pkg) => {
    const L = locate(pkg);
    return { bytes: zeroRange(pkg, L.coreOffset, L.coreOffset + L.coreLength - 40), refuse: true };
  },

  /** Rung 5: the directory is bit-rotted but its parity survives. */
  directoryBitRot: (pkg, count = 4) => {
    const L = locate(pkg);
    return {
      bytes: corrupt(pkg, { from: L.dirOffset, to: L.dirOffset + Math.min(60, L.dirLength), count, seed: 9 }),
      rung: 5,
    };
  },

  /** Rung 6: directory and parity both gone — rebuild by scanning preambles. */
  directoryAndParityZeroed: (pkg) => {
    const L = locate(pkg);
    return { bytes: zeroRange(pkg, L.dirOffset, L.dirOffset + L.dirLength + L.dirParityLength), rung: 6 };
  },
};

/** Rung 7/8 fixtures need the entry's location, so they take a record. */
export function damageEntry(pkg, entryOffset, storedSize, count = 3, seed = 13) {
  return corrupt(pkg, { from: entryOffset, to: entryOffset + storedSize, count, seed });
}

// ─── Hostile fixtures — refused, and never sent to the repair ladder ─────────
//
// These are built by patching a well-formed package's directory, because that
// is exactly how a hostile package is made: a valid container with a lying map.

/**
 * Patch a directory record, then RECOMPUTE the directory parity.
 *
 * Recomputing is not an optional nicety: without it the reader's rung-5 repair
 * silently heals the tampering back to the original bytes and the fixture tests
 * nothing. A real attacker holding the format spec recomputes parity too, so
 * this is also the more honest adversary — the directory's Reed-Solomon defends
 * against bit rot, never against an editor.
 */
function patchRecord(pkg, index, mutate) {
  const out = pkg.slice();
  const L = locate(out);
  let o = L.dirOffset;
  const rd16 = (b, i) => b[i] | (b[i + 1] << 8);
  for (let i = 0; i < index; i++) {
    const pathLength = rd16(out, o + 48);
    const n = RECORD_FIXED + pathLength;
    o += n + ((4 - (n % 4)) % 4);
  }
  mutate(out, o, L);
  return reparity(out);
}

/** Rebuild the directory's parity block over whatever the directory now says. */
export function reparity(pkg) {
  const out = pkg.slice();
  const L = locate(out);
  if (!L.dirParityLength) return out;
  const dir = out.subarray(L.dirOffset, L.dirOffset + L.dirLength);
  const parity = rsEncodeChunked(dir, NSYM);
  out.set(parity.subarray(0, L.dirParityLength), L.dirParityAt);
  return out;
}

/** Pad or trim `want` to the byte length the record already declares. */
function sameLength(want, b, o) {
  const need = b[o + 48] | (b[o + 49] << 8);
  let s = want;
  while (ENC.encode(s).length < need) s += 'x';
  return s.slice(0, need);
}

function setPath(b, o, str) {
  const p = ENC.encode(str);
  b[o + 48] = p.length & 0xff; b[o + 49] = (p.length >> 8) & 0xff;
  b.set(p, o + RECORD_FIXED);
}

const wr32 = (b, o, v) => {
  b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
};

export const hostile = {
  /**
   * A traversal path in the directory. Refused, never "corrected".
   *
   * The replacement keeps the record's exact byte length. A shorter or longer
   * path shifts every record after it, the directory fails to parse, and the
   * reader falls through to the preamble scan — which faithfully recovers the
   * ORIGINAL records, so the fixture would prove nothing at all.
   */
  pathTraversal: (pkg) => patchRecord(pkg, 0, (b, o) => setPath(b, o, sameLength('../../../etc/pw', b, o))),
  absolutePath: (pkg) => patchRecord(pkg, 0, (b, o) => setPath(b, o, sameLength('/etc/shadow', b, o))),
  nulInPath: (pkg) => patchRecord(pkg, 0, (b, o) =>
    setPath(b, o, sameLength('ok' + String.fromCharCode(0) + 'x', b, o))),

  /** An entry whose bytes run past the end of the file. */
  offsetPastEof: (pkg) => patchRecord(pkg, 0, (b, o) => {
    wr32(b, 4, 0);                       // header field untouched; patch the record
    wr32(b, o + 4, 0x7fffffff);          // storedSize
  }),

  /** An entry pointing into the core rather than the blob region. */
  rangeOutsideBlob: (pkg) => patchRecord(pkg, 0, (b, o) => {
    wr32(b, o, HEADER_SIZE + 4);
  }),

  /** entryCount far beyond the cap, with a tiny directory behind it. */
  entryCountOverflow: (pkg) => {
    const out = pkg.slice();
    wr32(out, out.length - TAIL_SIZE + 18, 0xfffffff0);
    return out;
  },

  /** dirOffset aimed into the blob region. */
  dirOffsetIntoBlob: (pkg) => {
    const out = pkg.slice();
    const L = locate(out);
    wr32(out, out.length - TAIL_SIZE + 10, L.blobOffset + 8);
    return out;
  },

  /**
   * A signed package whose MAP was edited (§6a.4). The signature covers the
   * header, core and directory, so this is what it exists to catch — and the
   * parity is recomputed so RS cannot quietly undo the edit first.
   */
  signedTampered: (pkg) => patchRecord(pkg, 0, (b, o) => {
    b[o + 12] ^= 0xff;          // flip a byte of the entry's recorded digest
  }),

  /**
   * A signed package with one byte of an ASSET changed. This is deliberately
   * NOT a refusal: the blob is covered by per-entry digests rather than by the
   * signature, so the affected entry fails its own hash and is dropped (rung 8)
   * while the rest of the package still verifies. An attacker can destroy an
   * asset this way; they cannot substitute one, because the digest that names
   * it is inside the signed directory.
   */
  blobTampered: (pkg) => {
    const out = pkg.slice();
    const L = locate(out);
    // Read the first record's entryOffset so the flip lands in the entry's
    // bytes rather than in its preamble, which is metadata and would be caught
    // somewhere else entirely.
    const rd32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
    const entryOffset = rd32(out, L.dirOffset);
    out[entryOffset + 4] ^= 0xff;
    return out;
  },
};

// ─── The manifest of expectations, for cross-implementation runs ─────────────

/**
 * What every reader must agree on. A native implementation runs this same table
 * and must produce the identical verdict for each row.
 */
export const EXPECTED = {
  wellFormed: ['empty', 'single', 'mixedCodecs', 'withWasm', 'unicodeAndNesting', 'lazyEntry', 'manyEntries'],
  repairedAtRung: {
    frontHeaderZeroed: 1,
    coreBitRot: 4,
    directoryBitRot: 5,
    directoryAndParityZeroed: 6,
  },
  incomplete: ['truncated'],
  refusedWithReason: {
    coreDestroyed: 'core-unrecoverable',
    pathTraversal: 'unsafe-path',
    absolutePath: 'unsafe-path',
    nulInPath: 'unsafe-path',
    offsetPastEof: 'range-outside-blob',
    rangeOutsideBlob: 'range-outside-blob',
    entryCountOverflow: 'entry-cap',
    dirOffsetIntoBlob: 'directory-unrecoverable',
    signedTampered: 'package-hash-mismatch',
  },
};

export { EPK_MAGIC };
