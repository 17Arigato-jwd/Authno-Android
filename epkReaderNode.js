// epkReaderNode.js — the desktop VCHS-EPK reader (Electron main process)
//
// Spec: docs/extbk-format-v2.md §6.3 — "Desktop | the Electron main process,
// with node streams". This is the second of the format's three implementations,
// and it is deliberately NOT a port of src/utils/epkFormat.js.
//
// The difference is the point. The JS reader holds the whole package in memory
// and is capped at 64 MB because it exists for development and tests. This one
// works from a file descriptor and reads ranges: the tail, the header, the core
// and the directory — a bounded few megabytes — and never the blob region until
// somebody asks for a specific entry, which is then read by seeking to its
// offset and pulling exactly its bytes.
//
// That is what makes a 1 GB extension openable on a laptop, and it is also why
// the two readers can disagree. They share no code beyond the Reed-Solomon
// math, so scripts/epk-crosscheck.mjs runs both against the same corpus and
// requires identical verdicts. A format with three implementations breaks
// silently otherwise: one reader accepts what another refuses, and it surfaces
// months later from the one platform nobody tested on.
//
// Reason strings are part of the contract. They must match epkFormat.js exactly.

const fs = require("fs");
const fsp = require("fs/promises");
const zlib = require("zlib");
const crypto = require("crypto");

// ─── Constants — must match epkFormat.js byte for byte ───────────────────────

const EPK_MAGIC = Buffer.from([0x89, 0x45, 0x50, 0x4b, 0x0d, 0x0a, 0x1a, 0x0a]);
const TAIL_MAGIC = Buffer.from([0x89, 0x45, 0x50, 0x4b, 0x5f, 0x45, 0x4e, 0x44, 0x0d, 0x0a]);
const ENTRY_MAGIC = Buffer.from([0x89, 0x45, 0x50, 0x4b, 0x45, 0x4e, 0x54, 0x0a]);

const FORMAT_VERSION = 1;
const HEADER_SIZE = 64;
const TAIL_SIZE = 128;
const RECORD_FIXED = 52;
const PREAMBLE_FIXED = ENTRY_MAGIC.length + RECORD_FIXED;

const DEFAULT_POLICY_CAP = 1024 * 1024 * 1024;
const CORE_CEILING = 4 * 1024 * 1024;
const DEFAULT_ENTRY_CAP = 65536;

const FLAG_SIGNED = 1 << 0;

const CODEC_STORE = 0;
const CODEC_DEFLATE = 1;
const KIND_CODE = 4;

class EpkError extends Error {
  constructor(reason, message, extra = {}) {
    super(message || reason);
    this.name = "EpkError";
    this.reason = reason;
    Object.assign(this, extra);
  }
}

class EpkIncomplete extends EpkError {
  constructor(have, need) {
    super("incomplete", `package is ${have} of at least ${need} bytes`, {
      have, need, resumeFrom: have,
    });
    this.name = "EpkIncomplete";
  }
}

// ─── Reed-Solomon, shared with the browser reader ────────────────────────────
//
// The one thing both readers genuinely should share: RS is math, and two
// hand-rolled copies of a GF(256) decoder is a bug farm rather than an
// independent check. Everything else here is written from the spec.

let _rs = null;
async function rs() {
  if (!_rs) _rs = await import("./src/utils/rs.js");
  return _rs;
}

async function rsRecover(data, parity, nsym) {
  if (!nsym || !parity || !parity.length) return { data, repaired: false };
  const { rsVerifyChunked, rsDecodeChunked } = await rs();
  if (rsVerifyChunked(data, parity, nsym)) return { data, repaired: false };
  const fixed = rsDecodeChunked(data, parity, nsym);
  if (!fixed) return null;
  return { data: Buffer.from(fixed), repaired: true };
}

// ─── Byte helpers ────────────────────────────────────────────────────────────

const u32 = (b, o) => b.readUInt32LE(o);
const u16 = (b, o) => b.readUInt16LE(o);
const readTag = (b, o) => b.toString("latin1", o, o + 4);

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function recordSize(pathLen) {
  const n = RECORD_FIXED + pathLen;
  return n + ((4 - (n % 4)) % 4);
}

function parseRecord(b, o, limit) {
  if (o + RECORD_FIXED > limit) return null;
  const pathLength = u16(b, o + 48);
  const size = recordSize(pathLength);
  if (o + size > limit) return null;
  const raw = b.subarray(o + RECORD_FIXED, o + RECORD_FIXED + pathLength);
  const path = raw.toString("utf8");
  // Node's utf8 decoder substitutes U+FFFD rather than throwing, so a
  // round-trip is the check. epkFormat.js uses TextDecoder({fatal:true}) and
  // must reach the same verdict.
  if (!Buffer.from(path, "utf8").equals(raw)) return null;
  return {
    entryOffset: u32(b, o),
    storedSize: u32(b, o + 4),
    originalSize: u32(b, o + 8),
    sha256: Buffer.from(b.subarray(o + 12, o + 44)),
    codec: b[o + 44],
    kind: b[o + 45],
    flags: u16(b, o + 46),
    path,
    _size: size,
  };
}

function serialiseRecord(rec) {
  const p = Buffer.from(rec.path, "utf8");
  const out = Buffer.alloc(recordSize(p.length));
  out.writeUInt32LE(rec.entryOffset, 0);
  out.writeUInt32LE(rec.storedSize, 4);
  out.writeUInt32LE(rec.originalSize, 8);
  rec.sha256.copy(out, 12);
  out[44] = rec.codec;
  out[45] = rec.kind;
  out.writeUInt16LE(rec.flags, 46);
  out.writeUInt16LE(p.length, 48);
  p.copy(out, RECORD_FIXED);
  return out;
}

function pathIsSafe(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.length > 1024) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  if (path.includes("\0")) return false;
  if (path.includes("\\")) return false;
  for (const seg of path.split("/")) {
    if (seg === "" || seg === "." || seg === "..") return false;
  }
  return true;
}

function parseHeader(b, off) {
  if (off + HEADER_SIZE > b.length) return null;
  if (!b.subarray(off, off + 8).equals(EPK_MAGIC)) return null;
  return {
    formatVersion: u16(b, off + 8),
    flags: u16(b, off + 10),
    uuid: Buffer.from(b.subarray(off + 12, off + 28)),
    coreOffset: u32(b, off + 28),
    coreLength: u32(b, off + 32),
    blobOffset: u32(b, off + 36),
    blobLength: u32(b, off + 40),
    dirOffset: u32(b, off + 44),
    rsParity: b[off + 48],
  };
}

async function readRange(fh, offset, length) {
  if (length <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

// ─── Core (§3.2b) ────────────────────────────────────────────────────────────

async function parseCore(core, nsym, repairs) {
  let body = core;
  let repairedCore = null;

  if (core.length >= 8 && readTag(core, core.length - 8) === "RSPX") {
    const plen = u32(core, core.length - 4);
    if (plen > 0 && plen + 8 <= core.length) {
      const bodyLen = core.length - 8 - plen;
      body = core.subarray(0, bodyLen);
      const parity = core.subarray(bodyLen, bodyLen + plen);
      const rec = await rsRecover(body, parity, nsym);
      if (!rec) throw new EpkError("core-unrecoverable", "core failed RS beyond correction");
      if (rec.repaired) {
        body = rec.data;
        repairs.push({ rung: 4, what: "core", how: "reed-solomon" });
        repairedCore = Buffer.concat([body, parity, core.subarray(core.length - 8)]);
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
  if (!found.MNFT || !found.CODE) {
    throw new EpkError("core-malformed", "core is missing MNFT or CODE");
  }

  let manifest, modules;
  try {
    manifest = JSON.parse(zlib.inflateRawSync(found.MNFT).toString("utf8"));
    modules = JSON.parse(zlib.inflateRawSync(found.CODE).toString("utf8"));
  } catch (e) {
    throw new EpkError("core-malformed", `core did not decode: ${e.message}`);
  }
  return { manifest, modules, repairedCore };
}

function parseDirectory(dir, entryCount) {
  const out = [];
  let o = 0;
  while (o < dir.length && out.length < entryCount) {
    const rec = parseRecord(dir, o, dir.length);
    if (!rec) return null;
    out.push(rec);
    o += rec._size;
  }
  if (out.length !== entryCount) return null;
  if (o !== dir.length) return null;
  return out;
}

/**
 * Rung 6, streaming. The browser reader has the whole package in memory; here
 * the blob region is read in windows so a destroyed directory in a large
 * package can still be rebuilt without loading it.
 *
 * Same two termination guards as the browser reader, for the same reason: this
 * walks attacker-shaped bytes, the loop is synchronous, and non-termination
 * hangs the main process rather than merely being slow.
 */
async function scanPreambles(fh, blobOffset, blobEnd, fileSize) {
  const found = [];
  const limit = Math.min(blobEnd, fileSize);
  const WINDOW = 1 << 20;
  let budget = Math.max(0, limit - blobOffset) + 1;
  let o = blobOffset;

  while (o + PREAMBLE_FIXED <= limit) {
    const winLen = Math.min(WINDOW, limit - o);
    const win = await readRange(fh, o, winLen);
    if (!win.length) break;

    let i = 0;
    while (i + PREAMBLE_FIXED <= win.length) {
      if (budget-- <= 0) {
        throw new EpkError("scan-budget-exceeded", "preamble scan did not converge");
      }
      if (!win.subarray(i, i + ENTRY_MAGIC.length).equals(ENTRY_MAGIC)) { i++; continue; }
      const rec = parseRecord(win, i + ENTRY_MAGIC.length, win.length);
      if (!rec || !pathIsSafe(rec.path)
          || rec.entryOffset < blobOffset || rec.entryOffset + rec.storedSize > limit) {
        i++;
        continue;
      }
      found.push(rec);
      const abs = o + i;
      const skipTo = rec.entryOffset + rec.storedSize;
      i = Math.max(i + 1, skipTo - o);
      if (skipTo <= abs) i = (abs - o) + 1;   // never backwards
    }

    // Overlap by one preamble so a marker straddling the window boundary is
    // not missed — the classic off-by-a-window bug in every chunked scanner.
    o += Math.max(1, win.length - PREAMBLE_FIXED);
  }
  return found;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Open a package from disk. Reads the tail, header, core and directory only.
 *
 * Returns a handle: { manifest, modules, entries, read(path), close(),
 * repairs, warnings, signed, signatureOk }. The caller MUST close() it.
 */
async function openEpk(filePath, opts = {}) {
  const {
    publicKey = null,
    fromChannel = false,
    entryCap = DEFAULT_ENTRY_CAP,
    policyCap = DEFAULT_POLICY_CAP,
  } = opts;

  const stat = await fsp.stat(filePath);
  const fileSize = stat.size;
  if (fileSize > policyCap) {
    throw new EpkError("policy-cap", `package exceeds ${policyCap} B`);
  }
  if (fileSize < HEADER_SIZE) {
    throw new EpkError("no-header", "neither header validates");
  }

  const fh = await fsp.open(filePath, "r");
  const repairs = [];
  const warnings = [];

  try {
    // ── Rungs 1–2: header arbitration ────────────────────────────────────────
    const frontBuf = await readRange(fh, 0, HEADER_SIZE);
    let header = parseHeader(frontBuf, 0);
    let headerSource = "front";

    let tail = null;
    if (fileSize >= TAIL_SIZE) {
      const tailBuf = await readRange(fh, fileSize - TAIL_SIZE, TAIL_SIZE);
      if (tailBuf.length === TAIL_SIZE && tailBuf.subarray(0, 10).equals(TAIL_MAGIC)) {
        tail = {
          buf: tailBuf,
          dirOffset: u32(tailBuf, 10),
          dirLength: u32(tailBuf, 14),
          entryCount: u32(tailBuf, 18),
          dirParityLength: u32(tailBuf, 22),
          packageHash: Buffer.from(tailBuf.subarray(32, 64)),
        };
      }
    }

    let recoveredHeader = null;
    if (!header && tail) {
      header = parseHeader(tail.buf, 64);
      if (header) {
        headerSource = "tail-copy";
        repairs.push({ rung: 1, what: "front header", how: "copy in tail" });
        recoveredHeader = Buffer.from(tail.buf.subarray(64, 64 + HEADER_SIZE));
      }
    }
    if (!header) throw new EpkError("no-header", "neither header validates");
    if (header.formatVersion !== FORMAT_VERSION) {
      throw new EpkError("bad-version", `formatVersion ${header.formatVersion} is not supported`);
    }
    if (!tail) repairs.push({ rung: 2, what: "tail", how: "derived from front header" });

    // ── Rung 3: truncation is not corruption ────────────────────────────────
    const claimedEnd = tail
      ? tail.dirOffset + tail.dirLength + tail.dirParityLength
      : header.dirOffset;
    if (claimedEnd > fileSize) throw new EpkIncomplete(fileSize, claimedEnd + TAIL_SIZE);
    if (!tail && fileSize < header.dirOffset + TAIL_SIZE) {
      throw new EpkIncomplete(fileSize, header.dirOffset + TAIL_SIZE);
    }

    const bound = (o, n, what) => {
      if (o > fileSize || o + n > fileSize) {
        throw new EpkError("offset-past-eof", `${what} runs past the end of the file`);
      }
    };
    bound(header.coreOffset, header.coreLength, "core");
    bound(header.blobOffset, header.blobLength, "blob region");

    // The directory must follow the blob region, never sit inside it. See the
    // long note in src/utils/epkFormat.js — a dirOffset inside the blob lets a
    // rebuilt directory be written over an entry's bytes, which destroys an
    // asset while claiming to repair the package.
    const blobEndCheck = header.blobOffset + header.blobLength;
    if (header.dirOffset < blobEndCheck) {
      throw new EpkError("directory-overlaps-blob", "dirOffset points inside the blob region");
    }
    if (tail && tail.dirOffset < blobEndCheck) {
      throw new EpkError("directory-overlaps-blob", "the tail places the directory inside the blob region");
    }
    if (header.coreLength > CORE_CEILING) {
      throw new EpkError("core-too-large", `core is ${header.coreLength} B`);
    }

    const nsym = header.rsParity;
    if (nsym > 127) {
      throw new EpkError("bad-rs-geometry", `rsParity ${nsym} leaves no room for data`);
    }

    // ── Rung 4: the core ────────────────────────────────────────────────────
    let coreBuf = await readRange(fh, header.coreOffset, header.coreLength);
    const { manifest, modules, repairedCore } = await parseCore(coreBuf, nsym, repairs);
    if (repairedCore) coreBuf = repairedCore;

    // ── Rungs 5–6: the directory ────────────────────────────────────────────
    const blobEnd = header.blobOffset + header.blobLength;
    let records = null;
    let dirBuf = null;
    let dirParityBuf = Buffer.alloc(0);

    if (tail) {
      if (tail.entryCount > entryCap) {
        throw new EpkError("entry-cap", `entryCount ${tail.entryCount} exceeds cap ${entryCap}`);
      }
      bound(tail.dirOffset, tail.dirLength + tail.dirParityLength, "directory");

      dirBuf = await readRange(fh, tail.dirOffset, tail.dirLength);
      dirParityBuf = await readRange(fh, tail.dirOffset + tail.dirLength, tail.dirParityLength);

      if (dirParityBuf.length && nsym) {
        const rec = await rsRecover(dirBuf, dirParityBuf, nsym);
        if (rec) {
          dirBuf = rec.data;
          if (rec.repaired) repairs.push({ rung: 5, what: "directory", how: "reed-solomon" });
        }
      }
      records = parseDirectory(dirBuf, tail.entryCount);
    }

    if (!records) {
      records = await scanPreambles(fh, header.blobOffset, blobEnd, fileSize);
      if (!records.length && (tail ? tail.entryCount : 0) > 0) {
        throw new EpkError("directory-unrecoverable", "directory failed RS and the preamble scan");
      }
      repairs.push({
        rung: 6, what: "directory", how: "rebuilt from entry preambles", count: records.length,
      });
      if (tail && records.length) {
        const rebuilt = Buffer.concat(records.map(serialiseRecord));
        if (rebuilt.length === tail.dirLength) {
          dirBuf = rebuilt;
          if (tail.dirParityLength && nsym) {
            const { rsEncodeChunked } = await rs();
            const fresh = Buffer.from(rsEncodeChunked(rebuilt, nsym));
            if (fresh.length === tail.dirParityLength) dirParityBuf = fresh;
          }
        }
      }
    }

    // ── Structural validation — refusals, never repairs (§8) ────────────────
    const entries = new Map();
    const ranges = [];
    for (const r of records) {
      if (!pathIsSafe(r.path)) throw new EpkError("unsafe-path", `refusing path: ${r.path}`);
      if (entries.has(r.path)) throw new EpkError("duplicate-path", `two records claim ${r.path}`);
      if (r.codec !== CODEC_STORE && r.codec !== CODEC_DEFLATE) {
        throw new EpkError("unknown-codec", `codec ${r.codec} is not supported`);
      }
      if (r.entryOffset < header.blobOffset || r.entryOffset + r.storedSize > blobEnd) {
        throw new EpkError("range-outside-blob", `${r.path} falls outside the blob region`);
      }
      bound(r.entryOffset, r.storedSize, r.path);
      ranges.push([r.entryOffset, r.entryOffset + r.storedSize, r.path]);
      entries.set(r.path, r);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] < ranges[i - 1][1]) {
        throw new EpkError("overlapping-ranges", `${ranges[i][2]} overlaps ${ranges[i - 1][2]}`);
      }
    }

    // ── Map integrity, then the signature (§7, §6a.4) ───────────────────────
    const signed = !!(header.flags & FLAG_SIGNED);
    if (fromChannel) {
      if (!signed) throw new EpkError("unsigned-channel-package", "a channel update must be signed");
      if (!tail) throw new EpkError("unverifiable-channel-package", "the tail is gone; the signature cannot be checked");
      if (!publicKey) throw new EpkError("no-public-key", "a channel update needs a key to verify against");
    }

    let signatureOk = null;
    if (tail) {
      const headerBytes = recoveredHeader || frontBuf;
      const recomputed = sha256(Buffer.concat([headerBytes, coreBuf, dirBuf, dirParityBuf]));
      if (!recomputed.equals(tail.packageHash)) {
        throw new EpkError("package-hash-mismatch", "the directory does not match the package hash");
      }
      if (signed) {
        const dirEnd = tail.dirOffset + tail.dirLength + tail.dirParityLength;
        const sigHdr = await readRange(fh, dirEnd, 8);
        if (sigHdr.length < 8 || readTag(sigHdr, 0) !== "SIGN") {
          throw new EpkError("bad-signature-block", "signature block missing");
        }
        const sigLen = u32(sigHdr, 4);
        bound(dirEnd + 8, sigLen, "signature");
        const sig = await readRange(fh, dirEnd + 8, sigLen);
        if (publicKey) {
          signatureOk = crypto.verify(null, recomputed, publicKey, sig);
          if (!signatureOk) throw new EpkError("bad-signature", "signature does not verify");
        }
      }
    }

    // ── Rungs 7–8: entry reads, by range ────────────────────────────────────
    const read = async (path) => {
      const r = entries.get(path);
      if (!r) throw new EpkError("no-such-entry", `${path} is not in this package`);

      let stored = await readRange(fh, r.entryOffset, r.storedSize);

      if (r.kind === KIND_CODE && nsym) {
        const rsAt = r.entryOffset + r.storedSize;
        const hdr = await readRange(fh, rsAt, 8);
        if (hdr.length === 8 && readTag(hdr, 0) === "RSPX") {
          const plen = u32(hdr, 4);
          if (rsAt + 8 + plen <= fileSize) {
            const parity = await readRange(fh, rsAt + 8, plen);
            const rec = await rsRecover(stored, parity, nsym);
            if (rec) {
              stored = rec.data;
              if (rec.repaired) repairs.push({ rung: 7, what: r.path, how: "reed-solomon" });
            }
          }
        }
      }

      let raw;
      try {
        raw = r.codec === CODEC_DEFLATE ? zlib.inflateRawSync(stored) : stored;
      } catch {
        warnings.push({ rung: 8, path, why: "decode failed" });
        return null;
      }
      if (!sha256(raw).equals(r.sha256)) {
        warnings.push({ rung: 8, path, why: "hash mismatch" });
        return null;
      }
      return raw;
    };

    return {
      manifest, modules, entries, read,
      repairs, warnings,
      signed, signatureOk, headerSource,
      uuid: header.uuid,
      entryCount: records.length,
      close: () => fh.close(),
    };
  } catch (e) {
    await fh.close();
    throw e;
  }
}

/** Structural summary without decoding. Mirrors inspectEpk in epkFormat.js. */
async function inspectEpkFile(filePath) {
  const stat = await fsp.stat(filePath);
  const fh = await fsp.open(filePath, "r");
  try {
    const front = await readRange(fh, 0, HEADER_SIZE);
    let tailBuf = null;
    if (stat.size >= TAIL_SIZE) {
      const t = await readRange(fh, stat.size - TAIL_SIZE, TAIL_SIZE);
      if (t.length === TAIL_SIZE && t.subarray(0, 10).equals(TAIL_MAGIC)) tailBuf = t;
    }
    const header = parseHeader(front, 0) || (tailBuf ? parseHeader(tailBuf, 64) : null);
    return {
      isEpk: !!header,
      size: stat.size,
      frontHeaderValid: !!parseHeader(front, 0),
      tailValid: !!tailBuf,
      header,
      entryCount: tailBuf ? u32(tailBuf, 18) : null,
      signed: header ? !!(header.flags & FLAG_SIGNED) : null,
      packageHash: tailBuf ? tailBuf.subarray(32, 64).toString("hex") : null,
    };
  } finally {
    await fh.close();
  }
}

/** True for VCHS-EPK, false for an ECS file. Cheap: reads 8 bytes. */
function isEpkFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const b = Buffer.alloc(8);
    const n = fs.readSync(fd, b, 0, 8, 0);
    return n === 8 && b.equals(EPK_MAGIC);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = {
  openEpk, inspectEpkFile, isEpkFile, pathIsSafe,
  EpkError, EpkIncomplete,
  HEADER_SIZE, TAIL_SIZE, RECORD_FIXED, EPK_MAGIC,
};
