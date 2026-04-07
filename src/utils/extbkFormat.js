/**
 * extbkFormat.js — VCHS-ECS binary format for .extbk files (browser / React)
 *
 * Browser counterpart to extensions/extbk-cli/src/format.js.
 * Uses pako for zlib compression (already in the React bundle).
 * RS codec is imported from the shared rs.js, which has no external dependencies.
 *
 * Section types:
 *   MNFT  — manifest.json (JSON + zlib)
 *   ENTR  — index.js entry point (JS + zlib)
 *   ASST  — asset file (raw + zlib, path-prefixed content)
 *   RSPX  — Reed-Solomon parity block
 *
 * Magic bytes (little-endian, not authbook-compatible by design):
 *   File header:   \x89EXTBK\r\n     (8 bytes)
 *   Recovery tail: \x89EXT_TAIL\r\n  (11 bytes)
 *   Middle anchor: \x89EXT_ANCH\r\n  (11 bytes)
 *
 * Public API
 * ----------
 *   packExtbk({ manifest, entry, assets, rsPct })  → Promise<Uint8Array>
 *   unpackExtbk(bytes: Uint8Array)                 → Promise<{ manifest, entry, assets }>
 *   inspectExtbk(bytes: Uint8Array)                → { header, sections }
 *   validateExtbk(bytes: Uint8Array)               → { ok, errors }
 */

import { rsEncodeChunked, rsVerifyChunked, rsDecodeChunked } from './rs.js';

// ─── Lazy pako import ─────────────────────────────────────────────────────────

let _pako = null;
async function pako() {
  if (!_pako) _pako = await import('pako');
  return _pako;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const FILE_MAGIC   = new Uint8Array([0x89,0x45,0x58,0x54,0x42,0x4B,0x0D,0x0A]);
const TAIL_MAGIC           = new Uint8Array([0x89,0x45,0x58,0x54,0x5F,0x54,0x41,0x49,0x4C,0x0D,0x0A]);
const ANCH_MAGIC           = new Uint8Array([0x89,0x45,0x58,0x54,0x5F,0x41,0x4E,0x43,0x48,0x0D,0x0A]);

const FORMAT_VERSION    = 1;
const HEADER_SIZE       = 20;
const INDEX_ENTRY_SIZE  = 20;
const DEFAULT_RS_PCT    = 20;

const TAG_MNFT = 'MNFT';
const TAG_ENTR = 'ENTR';
const TAG_ASST = 'ASST';
const TAG_RSPX = 'RSPX';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

// ─── CRC32 (IEEE 802.3, matches zlib.crc32) ───────────────────────────────────

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(data, init = 0xFFFFFFFF) {
  let crc = init;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── DataView helpers ────────────────────────────────────────────────────────

function readU8(view, off)  { return view.getUint8(off); }
function readU16(view, off) { return view.getUint16(off, true); }
function readU32(view, off) { return view.getUint32(off, true); }
function writeU8(buf, off, v)  { buf[off] = v; }
function writeU16LE(buf, off, v) { buf[off] = v & 0xFF; buf[off+1] = (v >> 8) & 0xFF; }
function writeU32LE(buf, off, v) {
  buf[off]   =  v         & 0xFF;
  buf[off+1] = (v >>  8)  & 0xFF;
  buf[off+2] = (v >> 16)  & 0xFF;
  buf[off+3] = (v >> 24)  & 0xFF;
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function tagBytes(tag) {
  const b = new Uint8Array(4);
  for (let i = 0; i < Math.min(4, tag.length); i++) b[i] = tag.charCodeAt(i);
  return b;
}

function readTag(bytes, off) {
  return String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]).replace(/\0/g, '');
}

// ─── Compression ─────────────────────────────────────────────────────────────

async function compress(raw) {
  const pk = await pako();
  return pk.deflateRaw(raw, { level: 6 });
}

async function decompress(comp) {
  const pk = await pako();
  return pk.inflateRaw(comp);
}

// ─── RS helpers ───────────────────────────────────────────────────────────────

function nParityBytes(dataLen, rsPct) {
  return rsPct === 0 ? 0 : Math.ceil(dataLen * rsPct / 100);
}

// ─── ASST payload encoding ────────────────────────────────────────────────────

function encodeAssetContent(path, data) {
  const pathBytes = ENC.encode(path);
  const header    = new Uint8Array(2);
  writeU16LE(header, 0, pathBytes.length);
  return concat(header, pathBytes, data instanceof Uint8Array ? data : ENC.encode(data));
}

function decodeAssetContent(raw) {
  const view    = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const pathLen = readU16(view, 0);
  const path    = DEC.decode(raw.slice(2, 2 + pathLen));
  const data    = raw.slice(2 + pathLen);
  return { path, data };
}

// ─── Section codec ────────────────────────────────────────────────────────────

async function encodeSection(tag, assetIdx, raw, rsPct) {
  const compressed = await compress(raw);
  const compCrc    = crc32(compressed);
  const nParity    = nParityBytes(compressed.length, rsPct);
  const parity     = nParity > 0
    ? rsEncodeChunked(compressed, nParity)
    : new Uint8Array(0);

  // Primary index entry (20 bytes)
  const entry = new Uint8Array(INDEX_ENTRY_SIZE);
  entry.set(tagBytes(tag), 0);
  writeU16LE(entry, 4, assetIdx);
  writeU8(entry, 6, 1);                   // zlib compression
  writeU8(entry, 7, 0);                   // flags
  writeU32LE(entry, 8,  raw.length);
  writeU32LE(entry, 12, compressed.length);
  writeU32LE(entry, 16, compCrc);

  // RSPX index entry (20 bytes)
  const rspxEntry = new Uint8Array(INDEX_ENTRY_SIZE);
  rspxEntry.set(tagBytes(TAG_RSPX), 0);
  writeU16LE(rspxEntry, 4, assetIdx);
  writeU8(rspxEntry, 6, 0);              // raw
  writeU8(rspxEntry, 7, 0);
  writeU32LE(rspxEntry, 8,  parity.length);
  writeU32LE(rspxEntry, 12, parity.length);
  writeU32LE(rspxEntry, 16, nParity > 0 ? crc32(parity) : 0);

  return { entry, payload: compressed, rspxEntry, rspxPayload: parity };
}

async function decodeSection(entryBytes, payload, rspxPayload, nParity) {
  const view     = new DataView(entryBytes.buffer, entryBytes.byteOffset, entryBytes.byteLength);
  const storedCrc = readU32(view, 16);
  const actualCrc = crc32(payload);
  let compBytes   = payload;

  if (actualCrc !== storedCrc) {
    if (nParity > 0 && rspxPayload) {
      const corrected = rsDecodeChunked(payload, rspxPayload, nParity);
      if (corrected && crc32(corrected) === storedCrc) {
        compBytes = corrected;
      } else {
        const tag = readTag(entryBytes, 0);
        throw new Error(`CRC mismatch and RS correction failed for section ${tag}`);
      }
    } else {
      const tag = readTag(entryBytes, 0);
      throw new Error(`CRC mismatch in section ${tag}, no RS parity available`);
    }
  }

  const compression = readU8(view, 6);
  return compression === 0 ? compBytes : await decompress(compBytes);
}

// ─── Front header ─────────────────────────────────────────────────────────────

function buildFrontHeader(sectionCount, fileCrc32, rsPct) {
  const hdr = new Uint8Array(HEADER_SIZE);
  hdr.set(FILE_MAGIC, 0);
  writeU16LE(hdr, 8,  FORMAT_VERSION);
  writeU8(hdr, 10, rsPct);
  writeU8(hdr, 11, 0);
  writeU16LE(hdr, 12, sectionCount);
  writeU32LE(hdr, 14, fileCrc32);
  writeU16LE(hdr, 18, 0);
  return hdr;
}

function readFrontHeader(bytes) {
  if (bytes.length < HEADER_SIZE) throw new Error('File too short');
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== FILE_MAGIC[i])
      throw new Error('Invalid magic bytes — not a .extbk file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = readU16(view, 8);
  if (version > FORMAT_VERSION)
    throw new Error(`Unsupported format version ${version}`);
  return {
    version,
    rsPct:        readU8(view, 10),
    flags:        readU8(view, 11),
    sectionCount: readU16(view, 12),
    fileCrc32:    readU32(view, 14),
  };
}

// ─── Recovery structures ──────────────────────────────────────────────────────

async function buildRecoveryTail(mnftRaw, entrRaw) {
  const mc = await compress(mnftRaw);
  const ec = await compress(entrRaw);
  const mcLen = new Uint8Array(4); writeU32LE(mcLen, 0, mc.length);
  const mrLen = new Uint8Array(4); writeU32LE(mrLen, 0, mnftRaw.length);
  const ecLen = new Uint8Array(4); writeU32LE(ecLen, 0, ec.length);
  const erLen = new Uint8Array(4); writeU32LE(erLen, 0, entrRaw.length);
  const body  = concat(TAIL_MAGIC, mcLen, mc, mrLen, ecLen, ec, erLen);
  const bodyCrc = new Uint8Array(4); writeU32LE(bodyCrc, 0, crc32(body));
  const tailBody = concat(body, bodyCrc);
  const tailLen  = new Uint8Array(4); writeU32LE(tailLen, 0, tailBody.length);
  return concat(tailBody, tailLen);
}

async function buildAnchor(mnftRaw, entrRaw) {
  const mc = await compress(mnftRaw);
  const ec = await compress(entrRaw);
  const mcLen = new Uint8Array(4); writeU32LE(mcLen, 0, mc.length);
  const mrLen = new Uint8Array(4); writeU32LE(mrLen, 0, mnftRaw.length);
  const ecLen = new Uint8Array(4); writeU32LE(ecLen, 0, ec.length);
  const erLen = new Uint8Array(4); writeU32LE(erLen, 0, entrRaw.length);
  const body  = concat(ANCH_MAGIC, mcLen, mc, mrLen, ecLen, ec, erLen);
  const bodyCrc = new Uint8Array(4); writeU32LE(bodyCrc, 0, crc32(body));
  return concat(body, bodyCrc);
}

// ─── Public: packExtbk ────────────────────────────────────────────────────────

/**
 * @param {object} manifest       - validated manifest object
 * @param {Uint8Array|string} entry - index.js content
 * @param {Array<{path:string, data:Uint8Array}>} assets
 * @param {number} [rsPct=20]
 * @returns {Promise<Uint8Array>}
 */
export async function packExtbk({ manifest, entry, assets = [], rsPct = DEFAULT_RS_PCT }) {
  const mnftRaw = ENC.encode(JSON.stringify(manifest, null, 2));
  const entrRaw = typeof entry === 'string' ? ENC.encode(entry) : entry;

  const sections = [];
  sections.push(await encodeSection(TAG_MNFT, 0, mnftRaw, rsPct));
  sections.push(await encodeSection(TAG_ENTR, 0, entrRaw, rsPct));

  let assetIdx = 1;
  for (const { path, data } of assets) {
    const content = encodeAssetContent(path, data);
    sections.push(await encodeSection(TAG_ASST, assetIdx++, content, rsPct));
  }

  // Interleave primary + RSPX
  const indexParts = [];
  const payloadParts = [];
  for (const s of sections) {
    indexParts.push(s.entry, s.rspxEntry);
    payloadParts.push(s.payload, s.rspxPayload);
  }

  const sectionCount = indexParts.length;

  // file_crc32 over all compressed payloads concatenated
  let fileCrc = 0xFFFFFFFF;
  for (const p of payloadParts) {
    for (const b of p) fileCrc = CRC32_TABLE[(fileCrc ^ b) & 0xFF] ^ (fileCrc >>> 8);
  }
  fileCrc = (fileCrc ^ 0xFFFFFFFF) >>> 0;

  const hdr      = buildFrontHeader(sectionCount, fileCrc, rsPct);
  const index    = concat(...indexParts);
  const data     = concat(...payloadParts);
  const anchor   = await buildAnchor(mnftRaw, entrRaw);
  const tail     = await buildRecoveryTail(mnftRaw, entrRaw);

  return concat(hdr, index, data, anchor, tail);
}

// ─── Public: unpackExtbk ─────────────────────────────────────────────────────

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<{ manifest, entry: string, assets: Array<{path, data}> }>}
 */
export async function unpackExtbk(bytes) {
  const header = readFrontHeader(bytes);
  const { rsPct, sectionCount } = header;
  const view   = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Parse section index
  const indexStart = HEADER_SIZE;
  const entries = [];
  for (let i = 0; i < sectionCount; i++) {
    const off = indexStart + i * INDEX_ENTRY_SIZE;
    entries.push({
      tag:      readTag(bytes, off),
      assetIdx: readU16(view, off + 4),
      compression: readU8(view, off + 6),
      origSize: readU32(view, off + 8),
      compSize: readU32(view, off + 12),
      crc32:    readU32(view, off + 16),
    });
  }

  // Extract payloads
  const dataStart = indexStart + sectionCount * INDEX_ENTRY_SIZE;
  let offset = dataStart;
  const payloads = entries.map(e => {
    const payload = bytes.slice(offset, offset + e.compSize);
    offset += e.compSize;
    return { entry: e, payload };
  });

  const result = { manifest: null, entry: null, assets: [] };

  for (let i = 0; i < payloads.length; i++) {
    const { entry: e, payload } = payloads[i];
    if (e.tag === TAG_RSPX) continue;

    const rspxSec  = payloads[i + 1]?.entry.tag === TAG_RSPX &&
                     payloads[i + 1]?.entry.assetIdx === e.assetIdx
                     ? payloads[i + 1] : null;
    const rspxPay  = rspxSec?.payload ?? null;
    const nParity  = rspxSec ? nParityBytes(e.compSize, rsPct) : 0;

    const entryBytes = bytes.slice(
      indexStart + i * INDEX_ENTRY_SIZE,
      indexStart + (i + 1) * INDEX_ENTRY_SIZE
    );

    const raw = await decodeSection(entryBytes, payload, rspxPay, nParity);

    if (e.tag === TAG_MNFT) {
      result.manifest = JSON.parse(DEC.decode(raw));
    } else if (e.tag === TAG_ENTR) {
      result.entry = DEC.decode(raw);
    } else if (e.tag === TAG_ASST) {
      const { path, data } = decodeAssetContent(raw);
      result.assets.push({ path, data });
    }
  }

  if (!result.manifest) throw new Error('Missing MNFT section');
  if (!result.entry    ) throw new Error('Missing ENTR section');
  return result;
}

// ─── Public: inspectExtbk ────────────────────────────────────────────────────

export function inspectExtbk(bytes) {
  const header = readFrontHeader(bytes);
  const view   = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections = [];

  for (let i = 0; i < header.sectionCount; i++) {
    const off = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
    sections.push({
      tag:      readTag(bytes, off),
      assetIdx: readU16(view, off + 4),
      origSize: readU32(view, off + 8),
      compSize: readU32(view, off + 12),
      crc32:    (readU32(view, off + 16) >>> 0).toString(16).padStart(8, '0'),
    });
  }
  return { header, sections, fileSizeBytes: bytes.length };
}

// ─── Public: validateExtbk ───────────────────────────────────────────────────

export function validateExtbk(bytes) {
  const errors = [];
  let header;
  try { header = readFrontHeader(bytes); }
  catch (e) { return { ok: false, errors: [e.message] }; }

  const view       = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataStart  = HEADER_SIZE + header.sectionCount * INDEX_ENTRY_SIZE;
  let offset       = dataStart;
  let hasMnft = false, hasEntr = false;

  for (let i = 0; i < header.sectionCount; i++) {
    const off      = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
    const tag      = readTag(bytes, off);
    const compSize = readU32(view, off + 12);
    const stored   = readU32(view, off + 16);

    if (offset + compSize > bytes.length) {
      errors.push(`Section ${i} (${tag}): data extends past end of file`);
      break;
    }

    const slice  = bytes.slice(offset, offset + compSize);
    const actual = crc32(slice);
    if (actual !== stored)
      errors.push(`Section ${i} (${tag}): CRC32 mismatch`);

    if (tag === TAG_MNFT) hasMnft = true;
    if (tag === TAG_ENTR) hasEntr = true;
    offset += compSize;
  }

  if (!hasMnft) errors.push('Missing MNFT section');
  if (!hasEntr) errors.push('Missing ENTR section');
  return { ok: errors.length === 0, errors };
}
