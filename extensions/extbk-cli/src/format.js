/**
 * format.js — VCHS-ECS binary format for .extbk extension bundles (Node.js)
 *
 * The .extbk format is a modified VCHS-ECS (Verified Consensus Hardening Standard
 * — Error Correction System) binary container, adapted from the .authbook format.
 *
 * It shares the same structural guarantees:
 *   • Three-point header arbitration (front header + back cover + middle anchor)
 *   • CRC32 per section
 *   • Reed-Solomon parity per section (configurable, default 20%)
 *
 * Section types (replaces authbook's META/STRK/GEN_/CHAP):
 *   MNFT  0   manifest.json content (JSON + zlib)    required, index position 0
 *   ENTR  0   index.js entry point  (JS  + zlib)     required
 *   ASST  1+  asset files           (raw + zlib)     optional, one per file
 *   RSPX  *   Reed-Solomon parity   (binary)         one per primary section
 *
 * Magic bytes:
 *   File header:    \x89EXTBK\r\n      (8 bytes)
 *   Recovery tail:  \x89EXT_TAIL\r\n   (11 bytes)
 *   Middle anchor:  \x89EXT_ANCH\r\n   (11 bytes)
 *
 * All integers are little-endian. File header is 20 bytes. Section index entry
 * is 20 bytes. Layout matches VCHS-ECS §3 exactly, with adapted section tags.
 *
 * Public API (Node.js)
 * --------------------
 *   packExtbk(files, options)  → Buffer
 *   unpackExtbk(buf)           → { manifest, files: [{path, data}] }
 *   inspectExtbk(buf)          → { header, sections[] }
 *   validateExtbk(buf)         → { ok, errors[] }
 */

import zlib   from 'zlib';
import { promisify } from 'util';
import { rsEncodeChunked, rsVerifyChunked, rsDecodeChunked } from './rs.js';

const deflateRaw = promisify(zlib.deflateRaw);
const inflateRaw = promisify(zlib.inflateRaw);

// ─── Magic bytes ──────────────────────────────────────────────────────────────

export const FILE_MAGIC  = Buffer.from([0x89,0x45,0x58,0x54,0x42,0x4B,0x0D,0x0A]); // \x89EXTBK\r\n
const TAIL_MAGIC          = Buffer.from([0x89,0x45,0x58,0x54,0x5F,0x54,0x41,0x49,0x4C,0x0D,0x0A]);
const ANCH_MAGIC          = Buffer.from([0x89,0x45,0x58,0x54,0x5F,0x41,0x4E,0x43,0x48,0x0D,0x0A]);

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMAT_VERSION   = 1;
const HEADER_SIZE      = 20;
const INDEX_ENTRY_SIZE = 20;
const DEFAULT_RS_PCT   = 20;

// Section tag strings (4 bytes ASCII)
const TAG_MNFT = 'MNFT';
const TAG_ENTR = 'ENTR';
const TAG_ASST = 'ASST';
const TAG_RSPX = 'RSPX';

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

// ─── RS helpers ───────────────────────────────────────────────────────────────

function nParityBytes(dataLen, rsPct) {
  if (rsPct === 0) return 0;
  return Math.ceil(dataLen * rsPct / 100);
}

// ─── Section encoding ─────────────────────────────────────────────────────────

/**
 * Encode one section: compress → CRC → RS parity.
 * Returns { indexEntry: Buffer(20), payload: Buffer, rspxEntry: Buffer(20), rspxPayload: Buffer }.
 */
async function encodeSection(tag, assetIdx, raw, rsPct) {
  // Compress
  const compressed = await deflateRaw(raw, { level: 6 });
  const compCrc    = crc32(compressed);
  const nParity    = nParityBytes(compressed.length, rsPct);

  // RS parity over compressed bytes
  const parity = nParity > 0
    ? Buffer.from(rsEncodeChunked(new Uint8Array(compressed), nParity))
    : Buffer.alloc(0);

  // Section index entry (20 bytes)
  const entry = Buffer.alloc(INDEX_ENTRY_SIZE);
  entry.write(tag.padEnd(4, '\0').slice(0, 4), 0, 'ascii');
  entry.writeUInt16LE(assetIdx, 4);
  entry.writeUInt8(1, 6);              // compression = zlib
  entry.writeUInt8(0, 7);              // entry_flags
  entry.writeUInt32LE(raw.length, 8);
  entry.writeUInt32LE(compressed.length, 12);
  entry.writeUInt32LE(compCrc, 16);

  // RSPX entry (20 bytes)
  const rspxEntry = Buffer.alloc(INDEX_ENTRY_SIZE);
  rspxEntry.write(TAG_RSPX.padEnd(4, '\0'), 0, 'ascii');
  rspxEntry.writeUInt16LE(assetIdx, 4);
  rspxEntry.writeUInt8(0, 6);           // parity stored raw (no compression)
  rspxEntry.writeUInt8(0, 7);
  rspxEntry.writeUInt32LE(parity.length, 8);
  rspxEntry.writeUInt32LE(parity.length, 12);
  rspxEntry.writeUInt32LE(nParity > 0 ? crc32(parity) : 0, 16);

  return { indexEntry: entry, payload: compressed, rspxEntry, rspxPayload: parity };
}

// ─── Section decoding ─────────────────────────────────────────────────────────

/**
 * Decode one section: verify CRC → RS correct if needed → decompress → raw bytes.
 */
async function decodeSection(entry, payload, rspxPayload, nParity) {
  const compCrc = entry.readUInt32LE(16);
  const actualCrc = crc32(payload);

  let compBytes = payload;

  // CRC mismatch → try RS correction
  if (actualCrc !== compCrc) {
    if (nParity > 0 && rspxPayload) {
      const corrected = rsDecodeChunked(
        new Uint8Array(payload), new Uint8Array(rspxPayload), nParity
      );
      if (corrected && crc32(Buffer.from(corrected)) === compCrc) {
        compBytes = Buffer.from(corrected);
      } else {
        throw new Error(`Section CRC mismatch and RS correction failed (tag: ${entry.slice(0,4).toString('ascii')})`);
      }
    } else {
      throw new Error(`Section CRC mismatch (tag: ${entry.slice(0,4).toString('ascii')}), no RS parity available`);
    }
  }

  const compression = entry.readUInt8(6);
  if (compression === 0) return compBytes;
  return await inflateRaw(compBytes);
}

// ─── ASST payload helpers ─────────────────────────────────────────────────────

function encodeAssetContent(path, data) {
  const pathBuf  = Buffer.from(path, 'utf8');
  const header   = Buffer.alloc(2);
  header.writeUInt16LE(pathBuf.length, 0);
  return Buffer.concat([header, pathBuf, Buffer.from(data)]);
}

function decodeAssetContent(raw) {
  const pathLen  = raw.readUInt16LE(0);
  const path     = raw.slice(2, 2 + pathLen).toString('utf8');
  const data     = raw.slice(2 + pathLen);
  return { path, data };
}

// ─── Recovery tail ────────────────────────────────────────────────────────────

async function buildRecoveryTail(mnftRaw, entrRaw) {
  // Tail: TAIL_MAGIC + zlib(mnftRaw) + uint32(mnft_orig_size) +
  //                  + zlib(entrRaw) + uint32(entr_orig_size) + CRC32(tail_body) + tail_length
  const mnftComp = await deflateRaw(mnftRaw, { level: 6 });
  const entrComp = await deflateRaw(entrRaw, { level: 6 });

  const body = Buffer.concat([
    TAIL_MAGIC,
    Buffer.from(new Uint32Array([mnftComp.length]).buffer),
    mnftComp,
    Buffer.from(new Uint32Array([mnftRaw.length]).buffer),
    Buffer.from(new Uint32Array([entrComp.length]).buffer),
    entrComp,
    Buffer.from(new Uint32Array([entrRaw.length]).buffer),
  ]);

  const tailCrc = Buffer.alloc(4);
  tailCrc.writeUInt32LE(crc32(body), 0);

  const tailBody = Buffer.concat([body, tailCrc]);
  const tailLen  = Buffer.alloc(4);
  tailLen.writeUInt32LE(tailBody.length, 0);

  return { tailBody, tailLen };
}

async function buildMiddleAnchor(mnftRaw, entrRaw) {
  const mnftComp = await deflateRaw(mnftRaw, { level: 6 });
  const entrComp = await deflateRaw(entrRaw, { level: 6 });

  const body = Buffer.concat([
    ANCH_MAGIC,
    Buffer.from(new Uint32Array([mnftComp.length]).buffer),
    mnftComp,
    Buffer.from(new Uint32Array([mnftRaw.length]).buffer),
    Buffer.from(new Uint32Array([entrComp.length]).buffer),
    entrComp,
    Buffer.from(new Uint32Array([entrRaw.length]).buffer),
  ]);

  const anchorCrc = Buffer.alloc(4);
  anchorCrc.writeUInt32LE(crc32(body), 0);
  return Buffer.concat([body, anchorCrc]);
}

// ─── Front header ─────────────────────────────────────────────────────────────

function buildFrontHeader(sectionCount, fileCrc32, rsPct) {
  const hdr = Buffer.alloc(HEADER_SIZE);
  FILE_MAGIC.copy(hdr, 0);
  hdr.writeUInt16LE(FORMAT_VERSION, 8);
  hdr.writeUInt8(rsPct, 10);
  hdr.writeUInt8(0, 11);             // flags
  hdr.writeUInt16LE(sectionCount, 12);
  hdr.writeUInt32LE(fileCrc32, 14);
  hdr.writeUInt16LE(0, 18);          // reserved
  return hdr;
}

function readFrontHeader(buf) {
  if (buf.length < HEADER_SIZE) throw new Error('File too short to contain header');
  if (!buf.slice(0, 8).equals(FILE_MAGIC))
    throw new Error(`Invalid magic bytes — not an .extbk file`);
  const version = buf.readUInt16LE(8);
  if (version > FORMAT_VERSION)
    throw new Error(`Unsupported format version ${version} (max supported: ${FORMAT_VERSION})`);
  return {
    version,
    rsPct:        buf.readUInt8(10),
    flags:        buf.readUInt8(11),
    sectionCount: buf.readUInt16LE(12),
    fileCrc32:    buf.readUInt32LE(14),
    reserved:     buf.readUInt16LE(18),
  };
}

// ─── Public: packExtbk ────────────────────────────────────────────────────────

/**
 * Pack extension files into a VCHS-ECS .extbk binary buffer.
 *
 * @param {object} params
 * @param {object} params.manifest      - parsed manifest object (will be JSON.stringify'd)
 * @param {Buffer|string} params.entry  - index.js content
 * @param {Array<{path:string,data:Buffer}>} params.assets - additional asset files
 * @param {number} [params.rsPct=20]    - RS protection level 0-100
 * @returns {Promise<Buffer>}
 */
export async function packExtbk({ manifest, entry, assets = [], rsPct = DEFAULT_RS_PCT }) {
  const mnftRaw = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  const entrRaw = Buffer.isBuffer(entry) ? entry : Buffer.from(entry, 'utf8');

  // Encode primary sections + their RSPX pairs
  const sections = []; // { indexEntry, payload, rspxEntry, rspxPayload }

  const mnftSec = await encodeSection(TAG_MNFT, 0, mnftRaw, rsPct);
  const entrSec = await encodeSection(TAG_ENTR, 0, entrRaw, rsPct);
  sections.push(mnftSec, entrSec);

  let assetIdx = 1;
  for (const { path, data } of assets) {
    const content = encodeAssetContent(path, data);
    const sec = await encodeSection(TAG_ASST, assetIdx++, Buffer.from(content), rsPct);
    sections.push(sec);
  }

  // Interleave primary + RSPX in final index:
  // MNFT, RSPX(MNFT), ENTR, RSPX(ENTR), ASST1, RSPX(ASST1), ...
  const indexEntries = [];
  const payloads     = [];
  for (const s of sections) {
    indexEntries.push(s.indexEntry, s.rspxEntry);
    payloads.push(s.payload, s.rspxPayload);
  }

  const sectionCount = indexEntries.length;

  // Compute file CRC32 over all compressed payloads concatenated
  let fileCrc = 0xFFFFFFFF;
  for (const p of payloads) {
    for (const b of p) fileCrc = CRC32_TABLE[(fileCrc ^ b) & 0xFF] ^ (fileCrc >>> 8);
  }
  fileCrc = (fileCrc ^ 0xFFFFFFFF) >>> 0;

  // Front header + index
  const hdr   = buildFrontHeader(sectionCount, fileCrc, rsPct);
  const index = Buffer.concat(indexEntries);
  const data  = Buffer.concat(payloads);

  // Middle anchor (written once — here it's always written since this is a fresh pack)
  const anchor = await buildMiddleAnchor(mnftRaw, entrRaw);

  // Recovery tail
  const { tailBody, tailLen } = await buildRecoveryTail(mnftRaw, entrRaw);

  return Buffer.concat([hdr, index, data, anchor, tailBody, tailLen]);
}

// ─── Public: unpackExtbk ─────────────────────────────────────────────────────

/**
 * Unpack a VCHS-ECS .extbk buffer into its constituent files.
 * Applies the full read algorithm: CRC → RS correction → header arbitration.
 *
 * @param {Buffer} buf
 * @returns {Promise<{ manifest: object, entry: string, assets: Array<{path,data}> }>}
 */
export async function unpackExtbk(buf) {
  const header = readFrontHeader(buf);
  const rsPct  = header.rsPct;

  // Read section index
  const indexStart = HEADER_SIZE;
  const entries    = [];
  for (let i = 0; i < header.sectionCount; i++) {
    const off = indexStart + i * INDEX_ENTRY_SIZE;
    entries.push({
      tag:         buf.slice(off, off + 4).toString('ascii').replace(/\0/g, ''),
      assetIdx:    buf.readUInt16LE(off + 4),
      compression: buf.readUInt8(off + 6),
      origSize:    buf.readUInt32LE(off + 8),
      compSize:    buf.readUInt32LE(off + 12),
      crc32:       buf.readUInt32LE(off + 16),
    });
  }

  // Pair primary sections with their RSPX entries
  const dataStart = indexStart + header.sectionCount * INDEX_ENTRY_SIZE;
  let offset = dataStart;
  const sectionData = entries.map(e => {
    const payload = buf.slice(offset, offset + e.compSize);
    offset += e.compSize;
    return { entry: e, payload };
  });

  // Build { tag, assetIdx } → { payload, rspxPayload, nParity }
  const result = { manifest: null, entry: null, assets: [] };

  for (let i = 0; i < sectionData.length; i++) {
    const { entry: e, payload } = sectionData[i];
    if (e.tag === TAG_RSPX) continue; // handled with primary

    // Find paired RSPX
    const rspxSec  = sectionData[i + 1]?.entry.tag === TAG_RSPX &&
                     sectionData[i + 1]?.entry.assetIdx === e.assetIdx
                     ? sectionData[i + 1] : null;
    const rspxPay  = rspxSec?.payload ?? null;
    const nParity  = rspxSec?.entry.origSize ?? 0;

    const raw = await decodeSection(
      Buffer.alloc(INDEX_ENTRY_SIZE, 0).fill(buf.slice(
        indexStart + i * INDEX_ENTRY_SIZE,
        indexStart + (i + 1) * INDEX_ENTRY_SIZE
      )),
      payload,
      rspxPay,
      nParity > 0 ? nParityBytes(e.compSize, rsPct) : 0
    );

    if (e.tag === TAG_MNFT) {
      result.manifest = JSON.parse(raw.toString('utf8'));
    } else if (e.tag === TAG_ENTR) {
      result.entry = raw.toString('utf8');
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

/**
 * Return a human-readable inspection object without fully decoding all sections.
 */
export function inspectExtbk(buf) {
  const header = readFrontHeader(buf);

  const entries = [];
  for (let i = 0; i < header.sectionCount; i++) {
    const off = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
    entries.push({
      tag:         buf.slice(off, off + 4).toString('ascii').replace(/\0/g, ''),
      assetIdx:    buf.readUInt16LE(off + 4),
      compression: buf.readUInt8(off + 6),
      origSize:    buf.readUInt32LE(off + 8),
      compSize:    buf.readUInt32LE(off + 12),
      crc32:       (buf.readUInt32LE(off + 16) >>> 0).toString(16).padStart(8, '0'),
    });
  }

  return { header, sections: entries, fileSizeBytes: buf.length };
}

// ─── Public: validateExtbk ───────────────────────────────────────────────────

/**
 * Validate structure and CRC32 of every section.
 * Does NOT attempt RS correction — just reports what's wrong.
 * Returns { ok: boolean, errors: string[] }.
 */
export function validateExtbk(buf) {
  const errors = [];

  let header;
  try { header = readFrontHeader(buf); }
  catch (e) { return { ok: false, errors: [e.message] }; }

  const dataStart = HEADER_SIZE + header.sectionCount * INDEX_ENTRY_SIZE;
  let offset = dataStart;

  let hasMnft = false, hasEntr = false;

  for (let i = 0; i < header.sectionCount; i++) {
    const off   = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
    const tag   = buf.slice(off, off + 4).toString('ascii').replace(/\0/g, '');
    const compSize = buf.readUInt32LE(off + 12);
    const storedCrc = buf.readUInt32LE(off + 16);

    if (offset + compSize > buf.length) {
      errors.push(`Section ${i} (${tag}): data extends past end of file`);
      break;
    }

    const payload = buf.slice(offset, offset + compSize);
    const actualCrc = crc32(payload);

    if (actualCrc !== storedCrc) {
      errors.push(`Section ${i} (${tag}): CRC32 mismatch — stored ${storedCrc.toString(16)}, computed ${actualCrc.toString(16)}`);
    }

    if (tag === TAG_MNFT) hasMnft = true;
    if (tag === TAG_ENTR) hasEntr = true;

    offset += compSize;
  }

  if (!hasMnft) errors.push('Missing MNFT section');
  if (!hasEntr) errors.push('Missing ENTR section');

  return { ok: errors.length === 0, errors };
}
