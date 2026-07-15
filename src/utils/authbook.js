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
import {
  rsEncodeChunked as _rsEncChunked,
  rsDecodeChunked as _rsDecChunked,
} from './reedSolomon.js';

// ─── Magic bytes ──────────────────────────────────────────────────────────────

const MAGIC_FILE   = new Uint8Array([0x89,0x41,0x54,0x48,0x42,0x4B,0x0D,0x0A]); // \x89ATHBK\r\n
const MAGIC_TAIL   = new Uint8Array([0x89,0x41,0x54,0x48,0x5F,0x54,0x41,0x49,0x4C,0x0D,0x0A]);
const MAGIC_ANCHOR = new Uint8Array([0x89,0x41,0x54,0x48,0x5F,0x41,0x4E,0x43,0x48,0x0D,0x0A]);

const FORMAT_VERSION     = 2;   // v2: header+index CRC (reserved u16→index crc16) + index copy in recovery blob
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

// ─── Reed-Solomon (v1.1.16) — delegates to the verified shared codec ─────────
// The previous inline GF(256)/Berlekamp-Massey/Forney implementation could not
// recover even a single corrupted byte and, worse, returned WRONG bytes while
// reporting recovered:true (verified 2026-07). All RS math now lives in
// ./reedSolomon.js, covered by a round-trip test suite. Parity output is
// byte-identical to the old encoder, so existing .authbook files keep working
// and gain real recovery. Decode FAILS CLOSED: a chunk that cannot be verified
// after correction is returned unchanged with recovered:false, so the caller's
// CRC/anchor/tail cross-check is the final authority.

function _nsym(level) { return Math.max(2, Math.min(120, Math.ceil(255 * level / 100))); }

export function rsEncode(data, level) {
  if (level === 0 || !data.length) return new Uint8Array(0);
  return _rsEncChunked(data, _nsym(level));
}

export function rsDecode(data, parity, level) {
  if (level === 0 || !parity.length) return { data, recovered: false };
  const nsym = _nsym(level);
  const fixed = _rsDecChunked(data, parity, nsym);
  if (fixed === null) return { data, recovered: false }; // fail closed
  return { data: fixed, recovered: true };
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
  // Legacy JSON: skip an optional UTF-8 BOM and ANY leading whitespace
  // (space, tab, CR, LF), then require '{'. The old check only accepted a
  // bare '{' or exactly "\n " and misclassified hand-edited files (2E).
  let i = 0;
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) i = 3; // BOM
  while (i < Math.min(bytes.length, 64) &&
         (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0A || bytes[i] === 0x0D)) i++;
  if (bytes[i] === 0x7B) return 'legacy-json';
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
      threads:     session.threads     || null,
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
    externalId:  book.meta.externalId  || '',
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
      // Short per-chapter synopsis (optional) — lives in MNFT so it rides along
      // with the chapter metadata and its RS parity. Omitted when empty.
      ...(c.synopsis ? { synopsis: c.synopsis } : {}),
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

  // v2 (N2-hardening): protect the header + section index themselves. Until now
  // only section *payloads* were CRC'd, so a single flip in an index entry
  // silently mis-sliced the file with no warning. We store a CRC16 of the index
  // region in the reserved header field, and keep a full copy of the index bytes
  // in the recovery blob so a corrupt index can be rebuilt, not just detected.
  const indexBytes = u8.slice(FILE_HEADER_SIZE, FILE_HEADER_SIZE + sectionCount * SECTION_ENTRY_SIZE);
  view.setUint16(18, crc32(indexBytes) & 0xffff, true);

  // Find the compressed META, STRK, MNFT for header copies
  const metaComp = encoded.find(e => e.tag === 'META').comp;
  const strkComp = encoded.find(e => e.tag === 'STRK').comp;
  const mnftComp = encoded.find(e => e.tag === 'MNFT').comp;

  // Middle anchor + recovery tail (each carries META/STRK/MNFT + the index copy)
  const anchor = _packCriticalBlob(MAGIC_ANCHOR, ts, rsLevel, FORMAT_VERSION, fileCrc,
                                    metaComp, strkComp, mnftComp, indexBytes);
  const tail   = _packCriticalBlob(MAGIC_TAIL,   ts, rsLevel, FORMAT_VERSION, fileCrc,
                                    metaComp, strkComp, mnftComp, indexBytes);
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

  // Recovery copies: the tail (always at EOF) and the mid-file anchor each hold
  // a full compressed copy of META, STRK and MNFT. We keep whichever parses so
  // a primary section that fails BOTH crc and RS can still be reconstructed (N2).
  const tailInfo   = _readTail(u8);
  const anchorInfo = _scanAnchor(u8);
  const backupBlob = tailInfo || anchorInfo || null;
  let status = 'fast_path';

  if (tailInfo && tailInfo.file_crc32 !== frontFileCrc) {
    warn.push(`Front/back CRC mismatch (front=${_hex(frontFileCrc)} tail=${_hex(tailInfo.file_crc32)}) — scanning for anchor`);
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

  // v2: validate the header's index CRC16. Until format v2 the section index
  // had NO integrity check — a single flipped byte in an index entry silently
  // mis-sliced every payload after it, with no warning (found via byte-sweep
  // testing). If the CRC fails, rebuild the index from the copy carried in the
  // recovery tail/anchor; if no copy is available, we still proceed but flag it.
  let indexBytes = u8.slice(FILE_HEADER_SIZE, FILE_HEADER_SIZE + sectionCount * SECTION_ENTRY_SIZE);
  if (version >= 2) {
    const storedIdxCrc = view.getUint16(18, true);
    if ((crc32(indexBytes) & 0xffff) !== storedIdxCrc) {
      const copy = tailInfo?.indexCopy || anchorInfo?.indexCopy || null;
      if (copy && (crc32(copy) & 0xffff) === storedIdxCrc) {
        indexBytes = copy;
        warn.push('Section index was corrupt — rebuilt from recovery copy');
        if (status === 'fast_path') status = 'anchor_used';
      } else {
        warn.push('Section index CRC mismatch and no valid recovery copy — file may be mis-sliced');
        if (status === 'fast_path') status = 'index_suspect';
      }
    }
  }
  const idxView = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);

  // Parse section index
  const indexEnd = FILE_HEADER_SIZE + sectionCount * SECTION_ENTRY_SIZE;
  const entries = [];
  let cursor = indexEnd;
  for (let i = 0; i < sectionCount; i++) {
    const base = i * SECTION_ENTRY_SIZE;
    const tag       = dec.decode(indexBytes.slice(base, base + 4));
    const chapIdx   = idxView.getUint16(base + 4, true);
    const comp      = indexBytes[base + 6];
    const origSize  = idxView.getUint32(base + 8,  true);
    const compSize  = idxView.getUint32(base + 12, true);
    const secCrc    = idxView.getUint32(base + 16, true);
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
      let fixed = false;
      const parity = parityMap[`${e.tag}:${e.chapIdx}`];
      if (parity) {
        const { data, recovered } = rsDecode(payload, parity, rsLevel);
        if (recovered && crc32(data) === e.secCrc) {
          payload = data;
          fixed = true;
          rsRec.push(`${e.tag}[${e.chapIdx}]`);
          if (status === 'fast_path') status = 'rs_recovered';
          warn.push(`RS recovered section ${e.tag}[${e.chapIdx}]`);
        }
      }
      // N2: last resort — reconstruct META/STRK/MNFT (chap_idx 0) from the
      // intact copy kept in the anchor/tail. These are the sections whose loss
      // makes a book unreadable, which is exactly why they were triplicated.
      if (!fixed && e.chapIdx === 0 && backupBlob) {
        const backupComp = e.tag === 'META' ? backupBlob.metaComp
                         : e.tag === 'STRK' ? backupBlob.strkComp
                         : e.tag === 'MNFT' ? backupBlob.mnftComp
                         : null;
        if (backupComp && crc32(backupComp) === e.secCrc) {
          payload = backupComp;
          fixed = true;
          rsRec.push(`${e.tag}[${e.chapIdx}]→backup`);
          if (status === 'fast_path' || status === 'rs_recovered') status = 'anchor_used';
          warn.push(`Restored ${e.tag} from recovery ${tailInfo ? 'tail' : 'anchor'} copy`);
        }
      }
      if (!fixed) {
        warn.push(parity
          ? `Could not recover ${e.tag}[${e.chapIdx}]`
          : `CRC fail on ${e.tag}[${e.chapIdx}], no parity available`);
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
    ...(ch.synopsis ? { synopsis: ch.synopsis } : {}),
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
    externalId:  book.meta.externalId  || '',
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
        externalId:  session.externalId  || '',
        coverMime:   session.coverMime   || '',
        // Threads (plotlines / character arcs — see docs/threads-spec.md) live
        // inside META: JSON, RS-parity-protected, ignored by older readers, and
        // bookToSession's `...book.meta` spread restores it on load for free.
        threads:     session.threads     || null,
        // Change history (undo/redo panel): the book keeps the 10 most recent
        // entries; the in-memory session may hold up to 50 while writing.
        // Omitted entirely when there's no history (old files stay byte-clean).
        ...(session.history?.length ? { history: session.history.slice(0, 10) } : {}),
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
  // Chunked conversion — the old per-byte `bin += String.fromCharCode(b)` was
  // O(n²) and ran on EVERY book save (multi-second UI stalls on large books).
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _wordCount(html) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

function _preview(html) {
  // Decode entities too (F1): the regex-only strip leaked raw "&nbsp;" into
  // the previews users see in the sidebar and home lists.
  let text;
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.innerHTML = html;
    text = (div.textContent || '').replace(/\u00a0/g, ' ');
  } else {
    text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
  }
  text = text.replace(/\s+/g, ' ').trim();
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

function _packCriticalBlob(magic, ts, rsLvl, ver, fileCrc, metaComp, strkComp, mnftComp, indexBytes = new Uint8Array(0)) {
  const hdr = new Uint8Array(11);
  const hv  = new DataView(hdr.buffer);
  hv.setUint32(0, ts,      true);
  hv.setUint8 (4, rsLvl);
  hv.setUint16(5, ver,     true);
  hv.setUint32(7, fileCrc, true);

  const body = _concat([magic, hdr,
    _u32le(metaComp.length),  metaComp,
    _u32le(strkComp.length),  strkComp,
    _u32le(mnftComp.length),  mnftComp,
    _u32le(indexBytes.length), indexBytes,   // v2: section-index copy
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

  // v1.1.16 (N2): actually extract the backed-up META/STRK/MNFT payloads so
  // they can be used to reconstruct a primary section that failed both CRC and
  // RS. Previously only file_crc32 was read and the copies were dead weight.
  let p = magic.length + 11;
  const readBlock = () => {
    if (p + 4 > bodyEnd) return null;
    const len = view.getUint32(p, true); p += 4;
    if (p + len > bodyEnd) return null;
    const bytes = data.slice(p, p + len); p += len;
    return bytes;
  };
  const metaComp  = readBlock();
  const strkComp  = readBlock();
  const mnftComp  = readBlock();
  const indexCopy = readBlock();  // v2; null for legacy v1 blobs

  return { file_crc32: fileCrc, metaComp, strkComp, mnftComp, indexCopy };
}

function _majorityVote(front, back, anchor) {
  // Returns the winning CRC as a NUMBER. The previous version returned
  // Object.keys(...) (a STRING), so `winner !== frontFileCrc` (a number) was
  // always true and the recovery status was always mislabeled (N9).
  const votes = [front, back, anchor].filter(v => v !== undefined && v !== null);
  const counts = new Map();
  for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1);
  let best = votes[0], bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}
