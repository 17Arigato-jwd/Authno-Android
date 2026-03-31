/**
 * authbook.js — VCHS-ECS Format v1  (JavaScript)
 * Verified Consensus Hardening Standard — Error Correction System
 *
 * Binary-compatible with authbook.py.
 * Dependency: pako (npm install pako) for zlib compression.
 * Reed-Solomon is implemented inline — no external RS package needed.
 *
 * Backward compatibility
 * ──────────────────────
 * Old .authbook files are plain JSON with a flat { id, title, content, streak }
 * structure. detectFormat() distinguishes them. fromLegacySession() migrates
 * them to the VCHS-ECS structure transparently; the app never sees the
 * difference because unpackToSession() always returns the same flat shape.
 */

import { deflate, inflate } from 'pako';
import { getDeviceId, getPlatform } from './deviceId';

// ─── Magic bytes ──────────────────────────────────────────────────────────────

const MAGIC_FILE   = new Uint8Array([0x89,0x41,0x54,0x48,0x42,0x4B,0x0D,0x0A]); // \x89ATHBK\r\n
const MAGIC_TAIL   = new Uint8Array([0x89,0x41,0x54,0x48,0x5F,0x54,0x41,0x49,0x4C,0x0D,0x0A]);
const MAGIC_ANCHOR = new Uint8Array([0x89,0x41,0x54,0x48,0x5F,0x41,0x4E,0x43,0x48,0x0D,0x0A]);

const FORMAT_VERSION     = 1;
const DEFAULT_RS_LEVEL   = 20;
const FILE_HEADER_SIZE   = 20;
const SECTION_ENTRY_SIZE = 20;
const COMPRESS_ZLIB      = 1;

// ─── CRC32 (IEEE polynomial — matches Python zlib.crc32) ─────────────────────

const _CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++)
    c = (_CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ─── GF(2^8) arithmetic — primitive polynomial 0x11d (same as reedsolo) ──────

const _GF_EXP = new Uint8Array(512);
const _GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    _GF_EXP[i] = x; _GF_LOG[x] = i;
    x = x << 1; if (x > 255) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) _GF_EXP[i] = _GF_EXP[i - 255];
})();

function _gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return _GF_EXP[_GF_LOG[a] + _GF_LOG[b]];
}
function _gfPow(x, p) { return _GF_EXP[(_GF_LOG[x] * p) % 255]; }
function _gfDiv(a, b) {
  if (b === 0) throw new Error('GF division by zero');
  if (a === 0) return 0;
  return _GF_EXP[((_GF_LOG[a] - _GF_LOG[b]) + 255) % 255];
}
function _gfPolyMul(p, q) {
  const r = new Uint8Array(p.length + q.length - 1);
  for (let i = 0; i < p.length; i++)
    for (let j = 0; j < q.length; j++)
      r[i + j] ^= _gfMul(p[i], q[j]);
  return r;
}
function _gfPolyEval(poly, x) {
  let y = poly[0];
  for (let i = 1; i < poly.length; i++) y = _gfMul(y, x) ^ poly[i];
  return y;
}

// ─── Reed-Solomon encode (returns parity only, not full message) ──────────────

function _rsGenPoly(nsym) {
  let g = new Uint8Array([1]);
  for (let i = 0; i < nsym; i++) {
    const factor = new Uint8Array([1, _gfPow(2, i)]);
    g = _gfPolyMul(g, factor);
  }
  return g;
}

function _rsEncodeChunk(data, nsym) {
  // Returns parity bytes only (length nsym)
  const gen = _rsGenPoly(nsym);
  const rem = new Uint8Array(nsym);
  for (let i = 0; i < data.length; i++) {
    const coef = data[i] ^ rem[0];
    for (let j = 0; j < nsym - 1; j++)
      rem[j] = rem[j + 1] ^ _gfMul(gen[j + 1], coef);
    rem[nsym - 1] = _gfMul(gen[nsym], coef);
  }
  return rem;
}

// ─── Reed-Solomon decode (Berlekamp-Massey + Chien + Forney) ─────────────────

function _rsDecodeChunk(msg, nsym) {
  // msg = data + parity as Uint8Array (length = chunkSize + nsym = 255)
  // Returns corrected data (length = chunkSize) or throws
  const n = msg.length;

  // Syndromes
  const synd = new Uint8Array(nsym);
  let haserr = false;
  for (let i = 0; i < nsym; i++) {
    synd[i] = _gfPolyEval(msg, _gfPow(2, i));
    if (synd[i] !== 0) haserr = true;
  }
  if (!haserr) return msg.slice(0, n - nsym);

  // Berlekamp-Massey to find error locator polynomial
  let errLoc = new Uint8Array([1]);
  let oldLoc = new Uint8Array([1]);
  for (let i = 0; i < nsym; i++) {
    oldLoc = new Uint8Array([...oldLoc, 0]); // shift
    let delta = synd[i];
    for (let j = 1; j < errLoc.length; j++)
      delta ^= _gfMul(errLoc[errLoc.length - 1 - j], synd[i - j]);
    if (delta === 0) continue;
    if (oldLoc.length > errLoc.length) {
      const newLoc = new Uint8Array(oldLoc.length);
      for (let j = 0; j < oldLoc.length; j++) newLoc[j] = _gfMul(oldLoc[j], delta);
      oldLoc = new Uint8Array(errLoc.length);
      for (let j = 0; j < errLoc.length; j++) oldLoc[j] = _gfDiv(errLoc[j], delta);
      errLoc = newLoc;
    }
    const scaled = new Uint8Array(oldLoc.length);
    for (let j = 0; j < oldLoc.length; j++) scaled[j] = _gfMul(oldLoc[j], delta);
    if (scaled.length > errLoc.length) {
      const tmp = new Uint8Array(scaled.length);
      const off = scaled.length - errLoc.length;
      for (let j = 0; j < errLoc.length; j++) tmp[j + off] = errLoc[j];
      errLoc = tmp;
    }
    const tmp2 = new Uint8Array(Math.max(errLoc.length, scaled.length));
    const off2 = tmp2.length - errLoc.length;
    for (let j = 0; j < errLoc.length; j++) tmp2[j + off2] ^= errLoc[j];
    const off3 = tmp2.length - scaled.length;
    for (let j = 0; j < scaled.length; j++) tmp2[j + off3] ^= scaled[j];
    errLoc = tmp2;
  }

  const nErrors = errLoc.length - 1;
  if (nErrors * 2 > nsym) throw new Error('Too many errors to correct');

  // Chien search — find error positions
  const errPos = [];
  for (let i = 0; i < n; i++) {
    if (_gfPolyEval(errLoc, _gfPow(2, i)) === 0)
      errPos.push(n - 1 - i);
  }
  if (errPos.length !== nErrors) throw new Error('Could not locate all errors');

  // Forney algorithm — compute error magnitudes
  const errLocRev = new Uint8Array([...errLoc].reverse());
  const coef = new Uint8Array([...msg]);
  const Xloc = errPos.map(p => _gfPow(2, p));

  // Error evaluator polynomial
  const synd2 = new Uint8Array([...synd].reverse());
  let omega = _gfPolyMul(synd2, errLocRev);
  omega = omega.slice(omega.length - nsym, omega.length);

  for (let i = 0; i < errPos.length; i++) {
    const Xinv = _gfPow(2, 255 - errPos[i]);
    let errLocDeriv = 1;
    for (let j = 0; j < Xloc.length; j++) {
      if (j !== i) errLocDeriv = _gfMul(errLocDeriv, 1 ^ _gfMul(Xinv, Xloc[j]));
    }
    const mag = _gfMul(
      _gfPow(2, errPos[i]),
      _gfDiv(_gfPolyEval(omega, Xinv), errLocDeriv)
    );
    coef[errPos[i]] ^= mag;
  }

  return coef.slice(0, n - nsym);
}

// ─── RS encode/decode with chunking (matches reedsolo's block structure) ──────

function _nsym(level) { return Math.max(2, Math.min(120, Math.ceil(255 * level / 100))); }

export function rsEncode(data, level) {
  if (level === 0 || !data.length) return new Uint8Array(0);
  const nsym      = _nsym(level);
  const chunkSize = 255 - nsym;
  const parts     = [];
  for (let off = 0; off < data.length; off += chunkSize) {
    const chunk = data.slice(off, off + chunkSize);
    parts.push(_rsEncodeChunk(chunk, nsym));
  }
  return _concat(parts);
}

export function rsDecode(data, parity, level) {
  if (level === 0 || !parity.length) return { data, recovered: false };
  const nsym      = _nsym(level);
  const chunkSize = 255 - nsym;
  const result    = [];
  let pOff = 0, dOff = 0, ok = true;
  while (dOff < data.length) {
    const d  = Math.min(chunkSize, data.length - dOff);
    const p  = parity.slice(pOff, pOff + nsym);
    const msg = new Uint8Array(d + nsym);
    msg.set(data.slice(dOff, dOff + d), 0);
    msg.set(p, d);
    try {
      result.push(_rsDecodeChunk(msg, nsym));
    } catch {
      result.push(data.slice(dOff, dOff + d));
      ok = false;
    }
    dOff += d; pOff += nsym;
  }
  return { data: _concat(result), recovered: ok };
}

// ─── Legacy format detection & migration ──────────────────────────────────────

/**
 * Detect whether bytes represent a VCHS-ECS file or a legacy JSON file.
 * Returns 'vchs', 'legacy-json', or 'unknown'.
 */
export function detectFormat(bytes) {
  if (bytes.length < 8) return 'unknown';
  for (let i = 0; i < MAGIC_FILE.length; i++)
    if (bytes[i] !== MAGIC_FILE[i]) break;
    else if (i === MAGIC_FILE.length - 1) return 'vchs';
  // Check for JSON (starts with '{' or whitespace then '{')
  const start = bytes.slice(0, 3);
  if (start[0] === 0x7B || (start[0] === 0x0A && start[1] === 0x20)) return 'legacy-json';
  return 'unknown';
}

/**
 * Convert a legacy flat-JSON session into the VCHS-ECS internal structure.
 *
 * Legacy format:
 *   { id, title, content, streak: { goalWords, log: { 'YYYY-MM-DD': int } } }
 *
 * New internal format:
 *   { meta, chapters:[{chap_idx,title,order,content}], streak, notes }
 */
export function fromLegacySession(session) {
  const legStreak  = session.streak || {};
  const goalWords  = legStreak.goalWords || 500;

  // Normalise log: plain int → { words, goal }
  const log = {};
  for (const [date, val] of Object.entries(legStreak.log || {})) {
    log[date] = typeof val === 'number' ? { words: val, goal: goalWords } : val;
  }

  return {
    meta: {
      formatVersion: FORMAT_VERSION,
      id:          session.id          || String(Date.now()),
      title:       session.title       || 'Untitled',
      type:        session.type        || 'book',
      created:     session.created     || new Date().toISOString(),
      updated:     session.updated     || new Date().toISOString(),
      authors:     [],
      devices:     [],
      genre:       session.genre       || '',
      description: session.description || '',
      language:    session.language    || 'en',
      publisher:   session.publisher   || '',
      isbn:        session.isbn        || '',
      coverMime:   session.coverMime   || '',
    },
    chapters: [{
      chap_idx: 1,
      title:    'Chapter 1',
      order:    1,
      content:  session.content || '',
      created:  session.created || new Date().toISOString(),
      updated:  session.updated || new Date().toISOString(),
    }],
    streak: {
      log,
      dailyBaseline: legStreak.dailyBaseline || {},
      goalHistory:   [],
    },
    notes: [],
  };
}

// ─── Pack ─────────────────────────────────────────────────────────────────────

/**
 * Serialize an internal book object to VCHS-ECS bytes.
 * Accepts either:
 *   - A full internal { meta, chapters, streak, notes } object
 *   - A legacy flat session (will be migrated automatically)
 */
export async function packSession(sessionOrBook, settings = {}, rsLevel = DEFAULT_RS_LEVEL) {
  // Auto-migrate flat legacy sessions
  const book = sessionOrBook.chapters ? sessionOrBook : fromLegacySession(sessionOrBook);

  const enc  = new TextEncoder();
  const now  = new Date().toISOString();
  const ts   = Math.floor(Date.now() / 1000);

  // Update meta
  const deviceId   = await getDeviceId();
  const platform   = getPlatform();
  const authorName = (settings.displayName || '').trim() || 'Anonymous';
  const meta = {
    ...book.meta,
    formatVersion: FORMAT_VERSION,
    updated: now,
    authors:     _mergeAuthors(book.meta.authors || [], authorName, now),
    devices:     _mergeDevices(book.meta.devices || [], deviceId, platform, now),
    genre:       book.meta.genre       || '',
    description: book.meta.description || '',
    language:    book.meta.language    || 'en',
    publisher:   book.meta.publisher   || '',
    isbn:        book.meta.isbn        || '',
    coverMime:   book.cover ? (book.meta.coverMime || 'image/jpeg') : '',
    // Cover is stored directly in META so it shares META's RS parity protection
    // and avoids a separate COVR section that previously collided in the parity map.
    coverData:   book.cover || null,
  };

  // Build MNFT
  const mnft = {
    format_version: FORMAT_VERSION,
    chapters: (book.chapters || []).map(c => ({
      chap_idx:   c.chap_idx,
      title:      c.title,
      order:      c.order,
      word_count: _wordCount(c.content || ''),
      created:    c.created || now,
      updated:    c.updated || now,
    })),
  };

  const streak = book.streak || { log: {}, dailyBaseline: {}, goalHistory: [] };
  const notes  = book.notes  || [];

  // Primary sections in fixed order: MNFT META STRK GEN_ CHAP...
  // Cover is embedded in META (as coverData / coverMime) — no separate COVR section.
  const primaries = [
    { tag: 'MNFT', idx: 0, raw: enc.encode(JSON.stringify(mnft))   },
    { tag: 'META', idx: 0, raw: enc.encode(JSON.stringify(meta))   },
    { tag: 'STRK', idx: 0, raw: enc.encode(JSON.stringify(streak)) },
    { tag: 'GEN_', idx: 0, raw: enc.encode(JSON.stringify(notes))  },
    ...(book.chapters || []).map(c => ({
      tag: 'CHAP', idx: c.chap_idx,
      raw: enc.encode(c.content || ''),
    })),
  ];

  const encoded = primaries.map(p => {
    const comp   = deflate(p.raw, { level: 6 });
    const parity = rsEncode(comp, rsLevel);
    return { ...p, comp, parity, crc: crc32(comp) };
  });

  // file_crc32 = CRC32 of all primary compressed payloads concatenated
  const fileCrc = crc32(_concat(encoded.map(e => e.comp)));

  // Build section index (primary + RSPX pairs)
  const sectionCount = encoded.length * 2;
  const totalBuf = FILE_HEADER_SIZE
    + sectionCount * SECTION_ENTRY_SIZE
    + encoded.reduce((n, e) => n + e.comp.length + 6 + e.parity.length, 0);

  const buf  = new ArrayBuffer(totalBuf);
  const u8   = new Uint8Array(buf);
  const view = new DataView(buf);

  // File header
  MAGIC_FILE.forEach((b, i) => { u8[i] = b; });
  view.setUint16(8,  FORMAT_VERSION, true);
  view.setUint8 (10, rsLevel);
  view.setUint8 (11, 0);  // flags
  view.setUint16(12, sectionCount, true);
  view.setUint32(14, fileCrc, true);
  view.setUint16(18, 0, true); // reserved

  // Section index
  let idxAt  = FILE_HEADER_SIZE;
  let dataAt = FILE_HEADER_SIZE + sectionCount * SECTION_ENTRY_SIZE;

  for (const e of encoded) {
    _writeEntry(u8, view, idxAt, e.tag, e.idx, COMPRESS_ZLIB, e.raw.length, e.comp.length, e.crc);
    idxAt += SECTION_ENTRY_SIZE;

    const rspxBody = _concat([
      new TextEncoder().encode(e.tag),
      _u16le(e.idx),
      e.parity,
    ]);
    _writeEntry(u8, view, idxAt, 'RSPX', e.idx, 0, rspxBody.length, rspxBody.length, crc32(rspxBody));
    idxAt += SECTION_ENTRY_SIZE;

    u8.set(e.comp, dataAt);   dataAt += e.comp.length;
    u8.set(rspxBody, dataAt); dataAt += rspxBody.length;
  }

  // Find the compressed META, STRK, MNFT for header copies
  const metaComp = encoded.find(e => e.tag === 'META').comp;
  const strkComp = encoded.find(e => e.tag === 'STRK').comp;
  const mnftComp = encoded.find(e => e.tag === 'MNFT').comp;

  // Middle anchor + recovery tail
  const anchor = _packCriticalBlob(MAGIC_ANCHOR, ts, rsLevel, FORMAT_VERSION, fileCrc,
                                    metaComp, strkComp, mnftComp);
  const tail   = _packCriticalBlob(MAGIC_TAIL,   ts, rsLevel, FORMAT_VERSION, fileCrc,
                                    metaComp, strkComp, mnftComp);
  const tailLen = _u32le(tail.length);

  return _concat([u8, anchor, tail, tailLen]);
}

// ─── Unpack ───────────────────────────────────────────────────────────────────

/**
 * Deserialize VCHS-ECS bytes into an internal book object.
 * Returns { meta, chapters, streak, notes, rsLevel, warnings, rsRecovered, status }
 */
export async function unpackSession(bytes) {
  const u8   = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const dec  = new TextDecoder();
  const warn = [];
  const rsRec = [];

  if (u8.length < FILE_HEADER_SIZE) throw new Error('File too small');

  // Verify magic
  for (let i = 0; i < MAGIC_FILE.length; i++)
    if (u8[i] !== MAGIC_FILE[i]) throw new Error('Not a valid .authbook file');

  const version      = view.getUint16(8,  true);
  const rsLevel      = view.getUint8 (10);
  const sectionCount = view.getUint16(12, true);
  const frontFileCrc = view.getUint32(14, true);

  if (version > FORMAT_VERSION)
    throw new Error(`Unsupported format version ${version}`);

  // Read back cover
  const tailInfo = _readTail(u8);
  let status = 'fast_path';

  if (tailInfo && tailInfo.file_crc32 !== frontFileCrc) {
    warn.push(`Front/back CRC mismatch (front=${_hex(frontFileCrc)} tail=${_hex(tailInfo.file_crc32)}) — scanning for anchor`);
    const anchorInfo = _scanAnchor(u8);
    const winner = _majorityVote(frontFileCrc, tailInfo.file_crc32, anchorInfo?.file_crc32);
    if (winner !== frontFileCrc) {
      warn.push('Front header was corrupt; tail/anchor data used');
      status = 'front_repaired';
    } else {
      status = 'anchor_used';
    }
  } else if (!tailInfo) {
    warn.push('Recovery tail missing or unreadable — trusting front header');
  }

  // Parse section index
  const indexEnd = FILE_HEADER_SIZE + sectionCount * SECTION_ENTRY_SIZE;
  const entries = [];
  let cursor = indexEnd;
  for (let i = 0; i < sectionCount; i++) {
    const base = FILE_HEADER_SIZE + i * SECTION_ENTRY_SIZE;
    const tag       = dec.decode(u8.slice(base, base + 4));
    const chapIdx   = view.getUint16(base + 4, true);
    const comp      = u8[base + 6];
    const origSize  = view.getUint32(base + 8,  true);
    const compSize  = view.getUint32(base + 12, true);
    const secCrc    = view.getUint32(base + 16, true);
    const payload   = u8.slice(cursor, cursor + compSize);
    entries.push({ tag, chapIdx, comp, origSize, compSize, secCrc, payload });
    cursor += compSize;
  }

  // Build parity map: chap_idx → parity bytes
  const parityMap = {};
  for (const e of entries) {
    if (e.tag === 'RSPX' && e.payload.length > 6) {
      // RSPX payload = 4-byte primary tag + 2-byte primary idx + parity bytes.
      // Use a composite "TAG:idx" key so non-chapter sections (MNFT, META, STRK,
      // GEN_) — which all share chapIdx=0 — each get their own slot instead of
      // overwriting each other.  Previously only the last idx=0 entry survived.
      const primaryTag = new TextDecoder().decode(e.payload.slice(0, 4));
      parityMap[`${primaryTag}:${e.chapIdx}`] = e.payload.slice(6);
    }
  }

  // Decode each primary section
  const sections = {};
  for (const e of entries) {
    if (e.tag === 'RSPX') continue;
    let payload = e.payload;
    const actualCrc = crc32(payload);
    if (actualCrc !== e.secCrc) {
      const parity = parityMap[`${e.tag}:${e.chapIdx}`];
      if (parity) {
        const { data, recovered } = rsDecode(payload, parity, rsLevel);
        if (recovered && crc32(data) === e.secCrc) {
          payload = data;
          rsRec.push(`${e.tag}[${e.chapIdx}]`);
          if (status === 'fast_path') status = 'rs_recovered';
          warn.push(`RS recovered section ${e.tag}[${e.chapIdx}]`);
        } else {
          warn.push(`Could not recover ${e.tag}[${e.chapIdx}]`);
        }
      } else {
        warn.push(`CRC fail on ${e.tag}[${e.chapIdx}], no parity available`);
      }
    }
    let raw;
    try {
      raw = e.comp === COMPRESS_ZLIB ? inflate(payload) : payload;
    } catch {
      warn.push(`Decompress failed for ${e.tag}[${e.chapIdx}]`);
      raw = new Uint8Array(0);
    }
    if (!sections[e.tag]) sections[e.tag] = {};
    sections[e.tag][e.chapIdx] = dec.decode(raw);
  }

  const getJ = (tag, idx = 0, def = null) => {
    try { return JSON.parse(sections[tag]?.[idx] ?? 'null') ?? def; } catch { return def; }
  };

  const meta   = getJ('META', 0, {});
  const streak = getJ('STRK', 0, { log: {}, dailyBaseline: {}, goalHistory: [] });
  const notes  = getJ('GEN_', 0, []);
  const mnft   = getJ('MNFT', 0, { chapters: [] });

  // Cover is now stored inside META (coverData / coverMime).
  // Fall back to the legacy COVR section so old files still open correctly.
  let cover     = meta.coverData || null;
  let coverMime = meta.coverMime || '';
  if (!cover) {
    try {
      const covrStr = sections['COVR']?.[0];
      if (covrStr) {
        const parsed = JSON.parse(covrStr);
        cover     = parsed.data || null;
        coverMime = parsed.mime || coverMime;
      }
    } catch { /* no legacy cover or corrupt — ignore */ }
  }
  // Strip coverData from the meta object we return; callers use cover/coverMime instead.
  const { coverData: _cd, ...cleanMeta } = meta;

  const chapters = (mnft.chapters || []).map(ch => ({
    chap_idx: ch.chap_idx,
    title:    ch.title    || 'Untitled',
    order:    ch.order    || ch.chap_idx,
    content:  sections['CHAP']?.[ch.chap_idx] ?? '',
    created:  ch.created  || new Date().toISOString(),
    updated:  ch.updated  || new Date().toISOString(),
  })).sort((a, b) => a.order - b.order);

  return { meta: cleanMeta, chapters, streak, notes, cover, coverMime, rsLevel, warnings: warn, rsRecovered: rsRec, status };
}

// ─── App-facing helpers ───────────────────────────────────────────────────────

/**
 * Convert the internal book object to the flat session shape App.js expects.
 * This keeps App.js unchanged while we store the full chapter structure.
 * 'content' = first chapter's content (single-chapter books are the current state).
 */
export function bookToSession(book) {
  const firstChap = (book.chapters || [])[0];
  return {
    ...book.meta,
    content:     firstChap?.content ?? '',
    preview:     _preview(firstChap?.content ?? ''),
    streak:      book.streak      || {},
    notes:       book.notes       || [],
    chapters:    book.chapters    || [],
    // Extended metadata fields
    genre:       book.meta.genre       || '',
    description: book.meta.description || '',
    language:    book.meta.language    || 'en',
    publisher:   book.meta.publisher   || '',
    isbn:        book.meta.isbn        || '',
    // Cover image
    coverBase64: book.cover            ?? null,
    coverMime:   book.coverMime        || book.meta.coverMime   || '',
  };
}

/**
 * Convert a flat session from App.js back into the internal book structure.
 * If the session already has a `chapters` array (from a previous unpack), keep it.
 * Otherwise create a single-chapter book from `session.content`.
 */
export function sessionToBook(session) {
  if (session.chapters?.length) {
    // Already has chapter structure — sync chapter 1 content from session.content
    const chapters = session.chapters.map((c, i) =>
      i === 0 ? { ...c, content: session.content ?? c.content } : c
    );
    return {
      meta: {
        formatVersion: FORMAT_VERSION,
        id:          session.id          || String(Date.now()),
        title:       session.title       || 'Untitled',
        type:        session.type        || 'book',
        created:     session.created     || new Date().toISOString(),
        updated:     session.updated     || new Date().toISOString(),
        authors:     session.authors     || [],
        devices:     session.devices     || [],
        genre:       session.genre       || '',
        description: session.description || '',
        language:    session.language    || 'en',
        publisher:   session.publisher   || '',
        isbn:        session.isbn        || '',
        coverMime:   session.coverMime   || '',
      },
      chapters,
      streak:  session.streak || {},
      notes:   session.notes  || [],
      cover:   session.coverBase64 ?? null,
    };
  }
  // Flat session — migrate
  return fromLegacySession(session);
}

// ─── Binary helpers ───────────────────────────────────────────────────────────

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _wordCount(html) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

function _preview(html) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 80) + (text.length > 80 ? '\u2026' : '');
}

function _mergeAuthors(existing, name, now) {
  if (existing.some(a => a.name === name)) return existing;
  return [...existing, { name, addedAt: now }];
}

function _mergeDevices(existing, id, platform, now) {
  const idx = existing.findIndex(d => d.id === id);
  if (idx !== -1) {
    const u = [...existing]; u[idx] = { ...u[idx], lastSeen: now }; return u;
  }
  return [...existing, { id, platform, addedAt: now, lastSeen: now }];
}

function _concat(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out   = new Uint8Array(total);
  let at = 0;
  for (const a of arrays) { out.set(a, at); at += a.length; }
  return out;
}

function _u16le(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }
function _u32le(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }
function _hex(v)   { return '0x' + v.toString(16).padStart(8, '0'); }

function _writeEntry(u8, view, at, tag, chapIdx, comp, orig, compSz, secCrc) {
  const tb = new TextEncoder().encode(tag.slice(0, 4).padEnd(4, '\0'));
  u8.set(tb, at);
  view.setUint16(at + 4,  chapIdx, true);
  view.setUint8 (at + 6,  comp);
  view.setUint8 (at + 7,  0);
  view.setUint32(at + 8,  orig,   true);
  view.setUint32(at + 12, compSz, true);
  view.setUint32(at + 16, secCrc, true);
}

// ─── Critical blob (tail / anchor) ───────────────────────────────────────────

function _packCriticalBlob(magic, ts, rsLvl, ver, fileCrc, metaComp, strkComp, mnftComp) {
  const enc = new TextEncoder();
  const hdr = new Uint8Array(11);
  const hv  = new DataView(hdr.buffer);
  hv.setUint32(0, ts,      true);
  hv.setUint8 (4, rsLvl);
  hv.setUint16(5, ver,     true);
  hv.setUint32(7, fileCrc, true);

  const body = _concat([magic, hdr,
    _u32le(metaComp.length), metaComp,
    _u32le(strkComp.length), strkComp,
    _u32le(mnftComp.length), mnftComp,
  ]);
  return _concat([body, _u32le(crc32(body))]);
}

function _readTail(u8) {
  if (u8.length < 4) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tailLen = view.getUint32(u8.length - 4, true);
  if (tailLen > u8.length - 4 || tailLen < MAGIC_TAIL.length) return null;
  const start = u8.length - 4 - tailLen;
  return _parseCriticalBlob(u8.slice(start, start + tailLen), MAGIC_TAIL);
}

function _scanAnchor(u8) {
  let pos = FILE_HEADER_SIZE;
  while (pos < u8.length - MAGIC_ANCHOR.length) {
    let found = true;
    for (let i = 0; i < MAGIC_ANCHOR.length; i++)
      if (u8[pos + i] !== MAGIC_ANCHOR[i]) { found = false; break; }
    if (found) {
      const r = _parseCriticalBlob(u8.slice(pos), MAGIC_ANCHOR);
      if (r) return r;
    }
    pos++;
  }
  return null;
}

function _parseCriticalBlob(data, magic) {
  for (let i = 0; i < magic.length; i++)
    if (data[i] !== magic[i]) return null;
  if (data.length < magic.length + 11 + 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bodyEnd = data.length - 4;
  const storedCrc = view.getUint32(bodyEnd, true);
  if (crc32(data.slice(0, bodyEnd)) !== storedCrc) return null;
  const fileCrc = view.getUint32(magic.length + 7, true);
  return { file_crc32: fileCrc };
}

function _majorityVote(front, back, anchor) {
  const votes = [front, back, anchor].filter(v => v !== undefined && v !== null);
  const counts = {};
  for (const v of votes) counts[v] = (counts[v] || 0) + 1;
  return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
}
