/**
 * epkFormat.js — VCHS-EPK binary format for .extbk files (apiVersion 2)
 *
 * Spec: docs/extbk-format-v2.md. Supersedes extbkFormat.js (VCHS-ECS), which
 * stays only so `extbk inspect` can still open an old package.
 *
 * Shape, in one line: zip's layout, ECS's paranoia, applied only to the part
 * that cannot be re-downloaded.
 *
 *   [front header 64] [core: MNFT CODE RSPX] [blob: preamble+entry …]
 *   [central directory] [directory parity] [signature?] [tail 128]
 *
 * Three properties worth knowing before reading the code:
 *
 * 1. Every offset and size is u32. The format ceiling is therefore 4 GiB-1,
 *    which is also FAT32's single-file limit — see spec §1a. The practical
 *    consequence here is that no value in this file needs BigInt.
 *
 * 2. Parity follows *replaceability*, not region (§4a). The core, the central
 *    directory and any kind=code entry get Reed-Solomon; large re-downloadable
 *    assets get none, because 20% of a gigabyte to avoid re-fetching one PNG is
 *    a bad trade.
 *
 * 3. Damage is repaired, not reported. readEpk runs the §6a ladder and only
 *    refuses when it runs out of rungs. `result.repairs` says what it fixed.
 *
 * The JS reader holds the whole package in memory and is therefore capped
 * (MAX_JS_READ). That is deliberate: on device the unpacker is native, and the
 * JS path exists for development, tests and the CLI. See spec §6.3.
 */

import { rsEncodeChunked, rsDecodeChunked, rsVerifyChunked } from './rs.js';

// ─── Magic and sizes ─────────────────────────────────────────────────────────

/** \x89EPK\r\n\x1a\n — the PNG trick: \x1a stops `type` on a terminal. */
export const EPK_MAGIC = new Uint8Array([0x89, 0x45, 0x50, 0x4b, 0x0d, 0x0a, 0x1a, 0x0a]);
/** \x89EPK_END\r\n */
const TAIL_MAGIC = new Uint8Array([0x89, 0x45, 0x50, 0x4b, 0x5f, 0x45, 0x4e, 0x44, 0x0d, 0x0a]);
/** \x89EPKENT\n — the sync marker a preamble scan looks for. */
const ENTRY_MAGIC = new Uint8Array([0x89, 0x45, 0x50, 0x4b, 0x45, 0x4e, 0x54, 0x0a]);

export const FORMAT_VERSION = 1;
export const HEADER_SIZE = 64;
export const TAIL_SIZE = 128;
export const RECORD_FIXED = 52;
const PREAMBLE_FIXED = ENTRY_MAGIC.length + RECORD_FIXED;

export const FORMAT_CEILING = 0xffffffff;      // u32, and FAT32's file limit
export const DEFAULT_POLICY_CAP = 1024 * 1024 * 1024;  // 1 GB, §1a
export const CORE_CEILING = 4 * 1024 * 1024;   // §4
export const DEFAULT_ENTRY_CAP = 65536;        // §3.4 — bounds directory memory
export const ALIGN = 4096;                     // §5, the zipalign reason
const DEFAULT_RS_PCT = 20;
const MAX_JS_READ = 64 * 1024 * 1024;

export const FLAG_SIGNED = 1 << 0;
export const FLAG_CORE_RS = 1 << 1;

export const CODEC_STORE = 0;
export const CODEC_DEFLATE = 1;

export const KIND_ASSET = 0;
export const KIND_SVG_RASTER = 1;
export const KIND_FONT = 2;
export const KIND_WIDGET = 3;
export const KIND_CODE = 4;

export const ENTRY_HOST_RENDERABLE = 1 << 0;
export const ENTRY_ALIGNED = 1 << 1;
export const ENTRY_LAZY = 1 << 2;

const ENC = new TextEncoder();
const DEC = new TextDecoder();

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Every refusal names its reason (§8). `reason` is a stable machine string;
 * `message` is for a log, never for a user — the caller maps reason to copy.
 */
export class EpkError extends Error {
  constructor(reason, message, extra = {}) {
    super(message || reason);
    this.name = 'EpkError';
    this.reason = reason;
    Object.assign(this, extra);
  }
}

/**
 * Truncation is not corruption (§6a.1 rung 3). A download that stopped early is
 * finishable; refusing it would restart a gigabyte transfer over nothing.
 */
export class EpkIncomplete extends EpkError {
  constructor(have, need) {
    super('incomplete', `package is ${have} of ${need} bytes`, { have, need, resumeFrom: have });
    this.name = 'EpkIncomplete';
  }
}

// ─── Byte helpers ────────────────────────────────────────────────────────────

function u32(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function putU32(b, o, v) {
  b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
}
function putU16(b, o, v) { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; }

function eq(a, b, off = 0) {
  for (let i = 0; i < b.length; i++) if (a[off + i] !== b[i]) return false;
  return true;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Normalise anything byte-shaped to a Uint8Array in *this* realm.
 *
 * `x instanceof Uint8Array` is not safe here and the failure is silent. Bytes
 * reach this module from three realms that are not ours: Node's `Buffer` in the
 * Electron main process, the Capacitor bridge on Android, and Node's `util`
 * TextEncoder under jsdom in the test env. A typed array from another realm has
 * a different constructor, so `instanceof` says false and a naive fallback
 * stringifies it — a Uint8Array's toString is "100,101,101,112", which packs
 * cleanly and is discovered much later as garbled content.
 *
 * ArrayBuffer.isView is realm-independent, which is why it is used instead.
 */
function toBytes(x) {
  if (x == null) return new Uint8Array(0);
  if (ArrayBuffer.isView(x)) {
    return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  }
  if (x instanceof ArrayBuffer || Object.prototype.toString.call(x) === '[object ArrayBuffer]') {
    return new Uint8Array(x);
  }
  if (typeof x === 'string') return ENC.encode(x);
  if (Array.isArray(x)) return Uint8Array.from(x);
  throw new EpkError('not-bytes', `cannot treat ${Object.prototype.toString.call(x)} as bytes`);
}

// ─── Primitives: SHA-256, deflate, Ed25519 ───────────────────────────────────
//
// All three are already present in WebCrypto, in Node and on Android — that is
// the whole reason they were chosen over BLAKE3 and Zstandard (§3.2d). Nothing
// here bundles a dependency the platform does not already have.

/* eslint-disable no-undef */
const GLOBAL = typeof globalThis !== 'undefined' ? globalThis
  : typeof window !== 'undefined' ? window : {};
/* eslint-enable no-undef */

function subtle() {
  const c = GLOBAL.crypto || null;
  if (!c || !c.subtle) throw new EpkError('no-webcrypto', 'WebCrypto unavailable');
  return c.subtle;
}

export async function sha256(bytes) {
  const d = await subtle().digest('SHA-256', bytes);
  return new Uint8Array(d);
}

export function hex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

let _pako = null;
async function pako() {
  if (!_pako) _pako = await import('pako');
  return _pako;
}
async function deflate(raw) { return (await pako()).deflateRaw(raw, { level: 6 }); }
async function inflate(c) { return (await pako()).inflateRaw(c); }

// ─── RS helpers ──────────────────────────────────────────────────────────────

/**
 * Parity bytes per RS chunk. Matches extbkFormat.js exactly — the cap at 127
 * keeps at least 128 data bytes in every GF(256) block.
 */
function nParity(rsPct) {
  if (!rsPct) return 0;
  return Math.min(Math.floor((255 * rsPct) / 100), 127);
}

/** Verify, and repair in place if it can. Returns { data, repaired } or null. */
function rsRecover(data, parity, nsym) {
  if (!nsym || !parity || !parity.length) return { data, repaired: false };
  if (rsVerifyChunked(data, parity, nsym)) return { data, repaired: false };
  const fixed = rsDecodeChunked(data, parity, nsym);
  if (!fixed) return null;
  return { data: fixed, repaired: true };
}

// ─── Core region: MNFT / CODE / RSPX ─────────────────────────────────────────

function tag(s) {
  const b = new Uint8Array(4);
  for (let i = 0; i < 4; i++) b[i] = s.charCodeAt(i);
  return b;
}
function readTag(b, o) {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

async function buildCore(manifest, modules, rsPct) {
  const mnft = await deflate(ENC.encode(JSON.stringify(manifest)));
  const code = await deflate(ENC.encode(JSON.stringify(modules)));

  const body = new Uint8Array(8 + mnft.length + 8 + code.length);
  let o = 0;
  body.set(tag('MNFT'), o); putU32(body, o + 4, mnft.length); body.set(mnft, o + 8);
  o += 8 + mnft.length;
  body.set(tag('CODE'), o); putU32(body, o + 4, code.length); body.set(code, o + 8);

  const nsym = nParity(rsPct);
  if (!nsym) return { bytes: body, hasRs: false };

  // The parity block is a fixed 8-byte TRAILER, not a section in the stream.
  // It has to be findable without parsing the bytes it protects: walking
  // sections to locate an RSPX tag means trusting a length field that the
  // damage may have hit, and then the parity needed to fix that damage is
  // exactly what cannot be found. Last eight bytes, always.
  const parity = rsEncodeChunked(body, nsym);
  const out = new Uint8Array(body.length + parity.length + 8);
  out.set(body, 0);
  out.set(parity, body.length);
  out.set(tag('RSPX'), body.length + parity.length);
  putU32(out, body.length + parity.length + 4, parity.length);
  return { bytes: out, hasRs: true };
}

/**
 * Parse the core, repairing it via RS first if the parity trailer says it is
 * damaged. Rung 4 of the ladder. Also returns the repaired core bytes so the
 * caller can write the correction back into the package (§6a.2).
 */
async function parseCore(core, rsPct, repairs) {
  let body = core;
  let repairedCore = null;

  if (core.length >= 8 && readTag(core, core.length - 8) === 'RSPX') {
    const plen = u32(core, core.length - 4);
    if (plen > 0 && plen + 8 <= core.length) {
      const bodyLen = core.length - 8 - plen;
      body = core.subarray(0, bodyLen);
      const parity = core.subarray(bodyLen, bodyLen + plen);
      const rec = rsRecover(body, parity, nParity(rsPct));
      if (!rec) throw new EpkError('core-unrecoverable', 'core failed RS beyond correction');
      if (rec.repaired) {
        body = rec.data;
        repairs.push({ rung: 4, what: 'core', how: 'reed-solomon' });
        repairedCore = concat([body, parity, core.subarray(core.length - 8)]);
      }
    }
  }

  const found = {};
  let o = 0;
  while (o + 8 <= body.length) {
    const t = readTag(body, o);
    const len = u32(body, o + 4);
    if (o + 8 + len > body.length) break;
    found[t] = body.subarray(o + 8, o + 8 + len);
    o += 8 + len;
  }
  if (!found.MNFT || !found.CODE) throw new EpkError('core-malformed', 'core is missing MNFT or CODE');

  let manifest, modules;
  try {
    manifest = JSON.parse(DEC.decode(await inflate(found.MNFT)));
    modules = JSON.parse(DEC.decode(await inflate(found.CODE)));
  } catch (e) {
    throw new EpkError('core-malformed', `core did not decode: ${e.message}`);
  }
  return { manifest, modules, repairedCore };
}

// ─── Directory records ───────────────────────────────────────────────────────

function recordSize(pathBytesLength) {
  const n = RECORD_FIXED + pathBytesLength;
  return n + ((4 - (n % 4)) % 4);   // records stay 4-byte aligned
}

function writeRecord(rec) {
  const p = ENC.encode(rec.path);
  const out = new Uint8Array(recordSize(p.length));
  putU32(out, 0, rec.entryOffset);
  putU32(out, 4, rec.storedSize);
  putU32(out, 8, rec.originalSize);
  out.set(rec.sha256, 12);
  out[44] = rec.codec;
  out[45] = rec.kind;
  putU16(out, 46, rec.flags);
  putU16(out, 48, p.length);
  putU16(out, 50, 0);
  out.set(p, RECORD_FIXED);
  return out;
}

function readRecord(b, o, limit) {
  if (o + RECORD_FIXED > limit) return null;
  const pathLength = u16(b, o + 48);
  const size = recordSize(pathLength);
  if (o + size > limit) return null;
  let path;
  try {
    path = DEC.decode(b.subarray(o + RECORD_FIXED, o + RECORD_FIXED + pathLength), { fatal: true });
  } catch {
    return null;   // invalid UTF-8 in a path — §8
  }
  return {
    entryOffset: u32(b, o),
    storedSize: u32(b, o + 4),
    originalSize: u32(b, o + 8),
    sha256: b.slice(o + 12, o + 44),
    codec: b[o + 44],
    kind: b[o + 45],
    flags: u16(b, o + 46),
    path,
    _size: size,
  };
}

// ─── Path safety (§8) ────────────────────────────────────────────────────────

/**
 * Structural violations are refused immediately and never enter the repair
 * ladder — "correcting" an attacker's path is exactly what a repairer must not
 * do (§8).
 */
export function pathIsSafe(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.length > 1024) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;             // C:\ on Windows
  if (path.includes('\0')) return false;
  if (path.includes('\\')) return false;                 // one separator, always /
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return false;
  }
  return true;
}

// ─── Header and tail ─────────────────────────────────────────────────────────

function buildHeader({ uuid, flags, coreOffset, coreLength, blobOffset, blobLength, dirOffset }) {
  const h = new Uint8Array(HEADER_SIZE);
  h.set(EPK_MAGIC, 0);
  putU16(h, 8, FORMAT_VERSION);
  putU16(h, 10, flags);
  h.set(uuid, 12);
  putU32(h, 28, coreOffset);
  putU32(h, 32, coreLength);
  putU32(h, 36, blobOffset);
  putU32(h, 40, blobLength);
  putU32(h, 44, dirOffset);
  return h;
}

function parseHeader(b, off) {
  if (off + HEADER_SIZE > b.length) return null;
  if (!eq(b, EPK_MAGIC, off)) return null;
  return {
    formatVersion: u16(b, off + 8),
    flags: u16(b, off + 10),
    uuid: b.slice(off + 12, off + 28),
    coreOffset: u32(b, off + 28),
    coreLength: u32(b, off + 32),
    blobOffset: u32(b, off + 36),
    blobLength: u32(b, off + 40),
    dirOffset: u32(b, off + 44),
  };
}

function parseTail(b) {
  if (b.length < TAIL_SIZE) return null;
  const o = b.length - TAIL_SIZE;
  if (!eq(b, TAIL_MAGIC, o)) return null;
  return {
    offset: o,
    dirOffset: u32(b, o + 10),
    dirLength: u32(b, o + 14),
    entryCount: u32(b, o + 18),
    dirParityLength: u32(b, o + 22),
    packageHash: b.slice(o + 32, o + 64),
    headerCopyOffset: o + 64,
  };
}

// ─── Writing (§6.1) ──────────────────────────────────────────────────────────

/**
 * Build a package.
 *
 * assets: [{ path, data:Uint8Array, codec?, kind?, lazy?, hostRenderable? }]
 * signWith: a WebCrypto Ed25519 CryptoKey (private), or omitted for unsigned.
 *
 * The preamble for an entry is written *before* its bytes but describes them,
 * so the writer reserves it, writes the entry, then fills the reservation in —
 * one seek per entry, which is why the preamble is fixed-position rather than
 * appended (§6.1).
 */
export async function packEpk({
  manifest,
  modules = {},
  assets = [],
  rsPct = DEFAULT_RS_PCT,
  uuid = null,
  signWith = null,
  policyCap = DEFAULT_POLICY_CAP,
  entryCap = DEFAULT_ENTRY_CAP,
  align = true,
}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new EpkError('no-manifest', 'packEpk requires a manifest object');
  }
  if (assets.length > entryCap) {
    throw new EpkError('entry-cap', `${assets.length} entries exceeds the cap of ${entryCap}`);
  }
  const seen = new Set();
  for (const a of assets) {
    if (!pathIsSafe(a.path)) throw new EpkError('unsafe-path', `refusing path: ${a.path}`);
    if (seen.has(a.path)) throw new EpkError('duplicate-path', `two entries claim ${a.path}`);
    seen.add(a.path);
  }

  const id = uuid || randomUuidBytes();
  const core = await buildCore(manifest, modules, rsPct);
  if (core.bytes.length > CORE_CEILING) {
    throw new EpkError('core-too-large', `core is ${core.bytes.length} B, ceiling is ${CORE_CEILING}`);
  }

  const coreOffset = HEADER_SIZE;
  const blobOffset = coreOffset + core.bytes.length;

  // Sort by path so the same inputs produce the same bytes — reproducible
  // builds are what make a signature checkable (§6.1).
  const sorted = [...assets].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const blobParts = [];
  const records = [];
  let cursor = blobOffset;
  const nsym = nParity(rsPct);

  for (const a of sorted) {
    const raw = toBytes(a.data);
    const kind = a.kind ?? KIND_ASSET;
    const codec = a.codec ?? (kind === KIND_ASSET ? CODEC_STORE : CODEC_DEFLATE);
    const stored = codec === CODEC_DEFLATE ? await deflate(raw) : raw;

    let flags = 0;
    if (a.lazy) flags |= ENTRY_LAZY;
    if (a.hostRenderable) flags |= ENTRY_HOST_RENDERABLE;

    // Reserve the preamble, then align the *data* so it can be mapped (§5).
    const pathLen = ENC.encode(a.path).length;
    const preambleLen = ENTRY_MAGIC.length + recordSize(pathLen);
    let pad = 0;
    if (align && codec === CODEC_STORE) {
      const dataAt = cursor + preambleLen;
      pad = (ALIGN - (dataAt % ALIGN)) % ALIGN;
      if (pad) flags |= ENTRY_ALIGNED;
    }

    const entryOffset = cursor + preambleLen + pad;
    const rec = {
      entryOffset,
      storedSize: stored.length,
      originalSize: raw.length,
      sha256: await sha256(raw),   // hash covers the ORIGINAL bytes (§3.2)
      codec,
      kind,
      flags,
      path: a.path,
    };

    const recBytes = writeRecord(rec);
    blobParts.push(ENTRY_MAGIC, recBytes);
    if (pad) blobParts.push(new Uint8Array(pad));
    blobParts.push(stored);
    cursor = entryOffset + stored.length;

    // kind=code carries its own parity — the WASM answer from §4a.
    if (kind === KIND_CODE && nsym) {
      const parity = rsEncodeChunked(stored, nsym);
      const hdr = new Uint8Array(8);
      hdr.set(tag('RSPX'), 0);
      putU32(hdr, 4, parity.length);
      blobParts.push(hdr, parity);
      cursor += 8 + parity.length;
    }

    records.push(rec);
    if (cursor > FORMAT_CEILING) throw new EpkError('format-ceiling', 'package exceeds 4 GiB-1');
  }

  const blob = concat(blobParts);
  const blobLength = blob.length;
  const dirOffset = blobOffset + blobLength;

  const dir = concat(records.map(writeRecord));
  const dirParity = nsym ? rsEncodeChunked(dir, nsym) : new Uint8Array(0);

  let flags = 0;
  if (core.hasRs) flags |= FLAG_CORE_RS;
  if (signWith) flags |= FLAG_SIGNED;

  const header = buildHeader({
    uuid: id, flags,
    coreOffset, coreLength: core.bytes.length,
    blobOffset, blobLength, dirOffset,
  });

  // The package hash covers the header, the core, the directory and the
  // directory's parity — everything EXCEPT the blob bytes.
  //
  // The blob is still covered, transitively: the directory holds a SHA-256 per
  // entry, and the directory is hashed here. That indirection buys two things
  // the direct version cannot. Verifying a signature costs O(core + directory)
  // instead of O(package), so a 1 GB extension verifies in milliseconds rather
  // than by re-reading a gigabyte. And it separates the two failure modes that
  // §8 treats differently: bit rot in one PNG fails that entry's own digest and
  // is dropped (rung 8), while any edit to the map itself fails this hash and
  // is refused. An attacker who flips bytes in an asset can therefore destroy
  // it but never substitute it — denial, not deception.
  const signedRegion = concat([header, core.bytes, dir, dirParity]);
  const packageHash = await sha256(signedRegion);
  const body = concat([header, core.bytes, blob, dir, dirParity]);

  let sigBlock = new Uint8Array(0);
  if (signWith) {
    const sig = new Uint8Array(await subtle().sign({ name: 'Ed25519' }, signWith, packageHash));
    sigBlock = new Uint8Array(8 + sig.length);
    sigBlock.set(tag('SIGN'), 0);
    putU32(sigBlock, 4, sig.length);
    sigBlock.set(sig, 8);
  }

  const tail = new Uint8Array(TAIL_SIZE);
  tail.set(TAIL_MAGIC, 0);
  putU32(tail, 10, dirOffset);
  putU32(tail, 14, dir.length);
  putU32(tail, 18, records.length);
  putU32(tail, 22, dirParity.length);
  tail.set(packageHash, 32);
  tail.set(header, 64);

  const out = concat([body, sigBlock, tail]);
  if (out.length > policyCap) {
    throw new EpkError('policy-cap', `package is ${out.length} B, cap is ${policyCap}`);
  }
  return out;
}

function randomUuidBytes() {
  const b = new Uint8Array(16);
  const c = GLOBAL.crypto || null;
  if (c && c.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

// ─── The repair ladder (§6a) ─────────────────────────────────────────────────

/** Rung 6: rebuild a destroyed directory by scanning entry preambles (§3.2a). */
function scanPreambles(bytes, blobOffset, blobEnd) {
  const found = [];
  const limit = Math.min(blobEnd, bytes.length);
  for (let o = blobOffset; o + PREAMBLE_FIXED <= limit; o++) {
    if (!eq(bytes, ENTRY_MAGIC, o)) continue;
    const rec = readRecord(bytes, o + ENTRY_MAGIC.length, limit);
    if (!rec) continue;
    if (!pathIsSafe(rec.path)) continue;
    if (rec.entryOffset < blobOffset || rec.entryOffset + rec.storedSize > limit) continue;
    found.push(rec);
    o = rec.entryOffset + rec.storedSize - 1;   // skip the body we just described
  }
  return found;
}

/**
 * Parse the directory, or return null so the caller falls through to rung 6.
 *
 * The records must consume the directory EXACTLY. That check is what separates
 * "this directory is destroyed" from "this directory contains something
 * hostile", and the two need opposite handling: destroyed means rebuild from
 * preambles, hostile means refuse. Without it a zeroed directory parses as
 * `entryCount` records with empty paths and zero offsets — structurally valid,
 * semantically nothing — and gets refused as an attack instead of repaired.
 */
function parseDirectory(dir, entryCount) {
  const out = [];
  let o = 0;
  while (o < dir.length && out.length < entryCount) {
    const rec = readRecord(dir, o, dir.length);
    if (!rec) return null;
    out.push(rec);
    o += rec._size;
  }
  if (out.length !== entryCount) return null;
  if (o !== dir.length) return null;
  return out;
}

// ─── Reading (§6.2) ──────────────────────────────────────────────────────────

/**
 * Read a package, repairing what can be repaired.
 *
 * Returns { manifest, modules, entries, read(path), repairs, warnings, signed }.
 * Throws EpkIncomplete when the file is merely short, and EpkError otherwise.
 *
 * opts:
 *   publicKey      — WebCrypto Ed25519 public key. Required when fromChannel.
 *   fromChannel    — true if this arrived over the network; unsigned is refused (§7.2).
 *   rsPct, entryCap, policyCap
 */
export async function readEpk(bytes, opts = {}) {
  const {
    publicKey = null,
    fromChannel = false,
    rsPct = DEFAULT_RS_PCT,
    entryCap = DEFAULT_ENTRY_CAP,
    policyCap = DEFAULT_POLICY_CAP,
    maxRead = MAX_JS_READ,
  } = opts;

  bytes = toBytes(bytes);
  if (bytes.length > policyCap) throw new EpkError('policy-cap', `package exceeds ${policyCap} B`);
  if (bytes.length > maxRead) {
    throw new EpkError('too-large-for-js', 'this package needs the native unpacker');
  }

  const repairs = [];
  const warnings = [];

  // ── Rungs 1–2: three-point header arbitration ──────────────────────────────
  const front = parseHeader(bytes, 0);
  const tail = parseTail(bytes);
  let header = front;
  let headerSource = 'front';

  let recoveredHeaderBytes = null;
  if (!header && tail) {
    header = parseHeader(bytes, tail.headerCopyOffset);
    if (header) {
      headerSource = 'tail-copy';
      repairs.push({ rung: 1, what: 'front header', how: 'copy in tail' });
      recoveredHeaderBytes = bytes.slice(tail.headerCopyOffset, tail.headerCopyOffset + HEADER_SIZE);
    }
  }
  if (!header) throw new EpkError('no-header', 'neither header validates');
  if (header.formatVersion !== FORMAT_VERSION) {
    throw new EpkError('bad-version', `formatVersion ${header.formatVersion} is not supported`);
  }
  if (!tail) repairs.push({ rung: 2, what: 'tail', how: 'derived from front header' });

  // ── Rung 3: truncation is not corruption ───────────────────────────────────
  const claimedEnd = tail
    ? tail.dirOffset + tail.dirLength + tail.dirParityLength
    : header.dirOffset;
  if (claimedEnd > bytes.length) {
    throw new EpkIncomplete(bytes.length, claimedEnd + TAIL_SIZE);
  }
  if (!tail && bytes.length < header.dirOffset + TAIL_SIZE) {
    throw new EpkIncomplete(bytes.length, header.dirOffset + TAIL_SIZE);
  }

  // ── Structural bounds — refused, never repaired (§8) ───────────────────────
  const bound = (o, n, what) => {
    if (o > bytes.length || o + n > bytes.length) {
      throw new EpkError('offset-past-eof', `${what} runs past the end of the file`);
    }
  };
  bound(header.coreOffset, header.coreLength, 'core');
  bound(header.blobOffset, header.blobLength, 'blob region');

  // Repairs are written back (§6a.2). `work` starts as the bytes we were given
  // and is copied on the first correction, so a package that needed no repair
  // costs no copy — and one that did hashes as the author wrote it, which is
  // what lets the signature confirm the repair was right (§6a.4).
  let work = bytes;
  const writeBack = (offset, patch) => {
    if (work === bytes) work = bytes.slice();
    work.set(patch, offset);
  };
  if (recoveredHeaderBytes) writeBack(0, recoveredHeaderBytes);

  // ── Rung 4: the core ───────────────────────────────────────────────────────
  const core = bytes.subarray(header.coreOffset, header.coreOffset + header.coreLength);
  const { manifest, modules, repairedCore } = await parseCore(core, rsPct, repairs);
  if (repairedCore) writeBack(header.coreOffset, repairedCore);

  // ── Rungs 5–6: the directory ───────────────────────────────────────────────
  const nsym = nParity(rsPct);
  let records = null;
  const blobEnd = header.blobOffset + header.blobLength;

  if (tail) {
    if (tail.entryCount > entryCap) {
      throw new EpkError('entry-cap', `entryCount ${tail.entryCount} exceeds cap ${entryCap}`);
    }
    bound(tail.dirOffset, tail.dirLength + tail.dirParityLength, 'directory');

    let dir = bytes.slice(tail.dirOffset, tail.dirOffset + tail.dirLength);
    if (tail.dirParityLength && nsym) {
      const parity = bytes.subarray(
        tail.dirOffset + tail.dirLength,
        tail.dirOffset + tail.dirLength + tail.dirParityLength,
      );
      const rec = rsRecover(dir, parity, nsym);
      if (rec) {
        dir = rec.data;
        if (rec.repaired) {
          repairs.push({ rung: 5, what: 'directory', how: 'reed-solomon' });
          writeBack(tail.dirOffset, dir);
        }
      }
    }
    records = parseDirectory(dir, tail.entryCount);
  }

  if (!records) {
    records = scanPreambles(bytes, header.blobOffset, blobEnd);
    if (!records.length && (tail ? tail.entryCount : 0) > 0) {
      throw new EpkError('directory-unrecoverable', 'directory failed RS and the preamble scan');
    }
    repairs.push({ rung: 6, what: 'directory', how: 'rebuilt from entry preambles', count: records.length });

    // Records are serialised identically by every writer, so a directory
    // rebuilt from intact preambles is byte-for-byte the one that was lost.
    // Writing it back — with fresh parity — restores the package to something
    // whose hash, and therefore whose signature, verifies again.
    if (tail && records.length) {
      const rebuilt = concat(records.map(writeRecord));
      if (rebuilt.length === tail.dirLength) {
        writeBack(tail.dirOffset, rebuilt);
        if (tail.dirParityLength && nsym) {
          const freshParity = rsEncodeChunked(rebuilt, nsym);
          if (freshParity.length === tail.dirParityLength) {
            writeBack(tail.dirOffset + tail.dirLength, freshParity);
          }
        }
      }
    }
  }

  // ── Structural validation of the map — refusals, not repairs (§8) ──────────
  const entries = new Map();
  const ranges = [];
  for (const r of records) {
    if (!pathIsSafe(r.path)) throw new EpkError('unsafe-path', `refusing path: ${r.path}`);
    if (entries.has(r.path)) throw new EpkError('duplicate-path', `two records claim ${r.path}`);
    if (r.codec !== CODEC_STORE && r.codec !== CODEC_DEFLATE) {
      throw new EpkError('unknown-codec', `codec ${r.codec} is not supported`);
    }
    if (r.entryOffset < header.blobOffset || r.entryOffset + r.storedSize > blobEnd) {
      throw new EpkError('range-outside-blob', `${r.path} falls outside the blob region`);
    }
    bound(r.entryOffset, r.storedSize, r.path);
    ranges.push([r.entryOffset, r.entryOffset + r.storedSize, r.path]);
    entries.set(r.path, r);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] < ranges[i - 1][1]) {
      throw new EpkError('overlapping-ranges', `${ranges[i][2]} overlaps ${ranges[i - 1][2]}`);
    }
  }

  // ── Integrity of the map, then the signature (§7, §6a.4) ──────────────────
  //
  // The package hash covers header + core + directory + directory parity — not
  // the blob bytes, which are covered transitively by the per-entry digests
  // inside the directory. See the note in packEpk for why.
  //
  // It is recomputed over `work`, the REPAIRED bytes. That is what makes the
  // signature an oracle for the repair: a correct repair restores the author's
  // bytes and re-verifies, a wrong one does not, and no amount of repairing can
  // move a package the signature rejects into one it accepts.
  const signed = !!(header.flags & FLAG_SIGNED);
  if (fromChannel && !signed) {
    throw new EpkError('unsigned-channel-package', 'a channel update must be signed');
  }

  let signatureOk = null;
  if (tail) {
    const dirEnd = tail.dirOffset + tail.dirLength + tail.dirParityLength;
    const recomputed = await sha256(concat([
      work.subarray(0, HEADER_SIZE),
      work.subarray(header.coreOffset, header.coreOffset + header.coreLength),
      work.subarray(tail.dirOffset, dirEnd),
    ]));

    const mapIntact = eq(recomputed, tail.packageHash);
    if (!mapIntact) {
      throw new EpkError('package-hash-mismatch', 'the directory does not match the package hash');
    }

    if (signed) {
      if (readTag(work, dirEnd) !== 'SIGN') {
        throw new EpkError('bad-signature-block', 'signature block missing');
      }
      const sigLen = u32(work, dirEnd + 4);
      bound(dirEnd + 8, sigLen, 'signature');
      const sig = work.subarray(dirEnd + 8, dirEnd + 8 + sigLen);
      if (publicKey) {
        signatureOk = await subtle().verify({ name: 'Ed25519' }, publicKey, sig, recomputed);
        if (!signatureOk) throw new EpkError('bad-signature', 'signature does not verify');
      }
    }
  }

  // ── Rungs 7–8: entry reads ─────────────────────────────────────────────────
  const read = async (path) => {
    const r = entries.get(path);
    if (!r) throw new EpkError('no-such-entry', `${path} is not in this package`);

    let stored = work.slice(r.entryOffset, r.entryOffset + r.storedSize);

    // Rung 7: a code entry carries its own parity.
    if (r.kind === KIND_CODE && nsym) {
      const rsAt = r.entryOffset + r.storedSize;
      if (rsAt + 8 <= work.length && readTag(work, rsAt) === 'RSPX') {
        const plen = u32(work, rsAt + 4);
        if (rsAt + 8 + plen <= work.length) {
          const rec = rsRecover(stored, work.subarray(rsAt + 8, rsAt + 8 + plen), nsym);
          if (rec) {
            stored = rec.data;
            if (rec.repaired) {
              repairs.push({ rung: 7, what: r.path, how: 'reed-solomon' });
              writeBack(r.entryOffset, stored);
            }
          }
        }
      }
    }

    let raw;
    try {
      raw = r.codec === CODEC_DEFLATE ? await inflate(stored) : stored;
    } catch {
      warnings.push({ rung: 8, path, why: 'decode failed' });
      return null;
    }
    const digest = await sha256(raw);
    if (!eq(digest, r.sha256)) {
      // Rung 8: one failed asset is not a refusal — it is dropped and reported.
      warnings.push({ rung: 8, path, why: 'hash mismatch' });
      return null;
    }
    return raw;
  };

  return {
    manifest, modules, entries, read,
    repairs, warnings,
    signed, signatureOk,
    headerSource,
    /** The corrected bytes, when anything was repaired — persist these (§6a.2). */
    get repairedBytes() { return work === bytes ? null : work; },
    uuid: header.uuid,
    entryCount: records.length,
  };
}

// ─── Inspection ──────────────────────────────────────────────────────────────

/** Structural summary without decoding anything. Used by `extbk inspect`. */
export function inspectEpk(bytes) {
  const front = parseHeader(bytes, 0);
  const tail = parseTail(bytes);
  const header = front || (tail ? parseHeader(bytes, tail.headerCopyOffset) : null);
  return {
    isEpk: !!header,
    size: bytes.length,
    frontHeaderValid: !!front,
    tailValid: !!tail,
    header,
    entryCount: tail ? tail.entryCount : null,
    signed: header ? !!(header.flags & FLAG_SIGNED) : null,
    packageHash: tail ? hex(tail.packageHash) : null,
  };
}

/** True for VCHS-EPK, false for an ECS file or anything else. */
export function isEpk(bytes) {
  return bytes && bytes.length >= HEADER_SIZE && eq(bytes, EPK_MAGIC, 0);
}
