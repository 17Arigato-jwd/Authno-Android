/**
 * reedSolomon.js — Verified GF(256) Reed-Solomon codec (systematic).
 *
 * Replaces the three divergent hand-rolled RS implementations that shipped in
 * v1.1.15-beta.6 (src/utils/rs.js, extbk-cli/src/rs.js, and the inline codec
 * in authbook.js) — all of which failed to recover even a single corrupted
 * byte (verified 2026-07). This implementation is the classic textbook
 * pipeline: syndromes → Berlekamp–Massey → Chien search → Forney, and it
 * FAILS CLOSED: rsDecode returns null unless the corrected block re-verifies
 * with all-zero syndromes.
 *
 * Field: GF(2^8), primitive polynomial 0x11D, generator α = 2, fcr = 0.
 * A block of (dataLen + nsym) bytes tolerates up to floor(nsym / 2) corrupted
 * bytes anywhere in the block (data or parity).
 *
 * Chunked API (used by .authbook and .extbk):
 *   Data is split into chunks of (255 - nsym) bytes; each chunk gets nsym
 *   parity bytes, concatenated in order into a single parity buffer.
 *
 * Every function is covered by the round-trip suite in rs.test.js — run it
 * before trusting any change to this file.
 */

// ─── GF(256) tables ───────────────────────────────────────────────────────────

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfDiv(a, b) {
  if (b === 0) throw new Error('GF division by zero');
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] + 255 - GF_LOG[b]) % 255];
}

function gfPow(a, n) {
  if (a === 0) return 0;
  return GF_EXP[((GF_LOG[a] * n) % 255 + 255) % 255];
}

function gfInv(a) {
  if (a === 0) throw new Error('GF inverse of zero');
  return GF_EXP[255 - GF_LOG[a]];
}

// ─── Polynomial helpers (coefficient arrays, index 0 = highest degree) ───────

function polyMul(p, q) {
  const r = new Uint8Array(p.length + q.length - 1);
  for (let j = 0; j < q.length; j++) {
    if (q[j] === 0) continue;
    for (let i = 0; i < p.length; i++) {
      if (p[i] === 0) continue;
      r[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return r;
}

function polyEval(p, x) {
  // Horner's method
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = gfMul(y, x) ^ p[i];
  return y;
}

// Cache generator polynomials per nsym — they never change.
const GEN_CACHE = new Map();
function generatorPoly(nsym) {
  let g = GEN_CACHE.get(nsym);
  if (g) return g;
  g = new Uint8Array([1]);
  for (let i = 0; i < nsym; i++) g = polyMul(g, new Uint8Array([1, gfPow(2, i)]));
  GEN_CACHE.set(nsym, g);
  return g;
}

// ─── Single-block encode ─────────────────────────────────────────────────────

/**
 * Systematic RS encode of one block.
 * @param {Uint8Array} data   ≤ (255 - nsym) bytes
 * @param {number}     nsym   parity symbol count, 1..254
 * @returns {Uint8Array} nsym parity bytes
 */
export function rsEncodeBlock(data, nsym) {
  if (!Number.isInteger(nsym) || nsym < 1 || nsym > 254) {
    throw new Error(`RS: invalid parity count ${nsym}`);
  }
  if (data.length + nsym > 255) {
    throw new Error(`RS: block too large — data(${data.length}) + parity(${nsym}) > 255`);
  }
  const gen = generatorPoly(nsym);
  // Synthetic division of data · x^nsym by generator; remainder = parity.
  const rem = new Uint8Array(nsym); // running remainder window
  for (let i = 0; i < data.length; i++) {
    const coef = data[i] ^ rem[0];
    // shift remainder left by one
    rem.copyWithin(0, 1);
    rem[nsym - 1] = 0;
    if (coef !== 0) {
      for (let j = 0; j < nsym; j++) {
        // gen[0] is always 1 (monic), so gen[j+1] pairs with rem[j]
        rem[j] ^= gfMul(gen[j + 1], coef);
      }
    }
  }
  return rem;
}

// ─── Syndromes / verify ──────────────────────────────────────────────────────

function calcSyndromes(block, nsym) {
  const synd = new Uint8Array(nsym);
  let clean = true;
  for (let i = 0; i < nsym; i++) {
    const s = polyEval(block, gfPow(2, i));
    synd[i] = s;
    if (s !== 0) clean = false;
  }
  return { synd, clean };
}

/** True if data+parity form a valid codeword (no detectable corruption). */
export function rsVerifyBlock(data, parity, nsym) {
  if (parity.length !== nsym) return false;
  const block = new Uint8Array(data.length + nsym);
  block.set(data, 0);
  block.set(parity, data.length);
  return calcSyndromes(block, nsym).clean;
}

// ─── Berlekamp–Massey ────────────────────────────────────────────────────────

function berlekampMassey(synd, nsym) {
  // Returns error locator polynomial (index 0 = highest degree), or null.
  let errLoc = [1];
  let oldLoc = [1];
  for (let i = 0; i < nsym; i++) {
    oldLoc.push(0);
    // delta = S_i + Σ errLoc[j]·S_{i-j}
    let delta = synd[i];
    for (let j = 1; j < errLoc.length; j++) {
      delta ^= gfMul(errLoc[errLoc.length - 1 - j], synd[i - j]);
    }
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        let newLoc = oldLoc.map(v => gfMul(v, delta));
        oldLoc = errLoc.map(v => gfDiv(v, delta));
        errLoc = newLoc;
      }
      for (let j = 0; j < oldLoc.length; j++) {
        errLoc[errLoc.length - 1 - j] ^= gfMul(delta, oldLoc[oldLoc.length - 1 - j]);
      }
    }
  }
  // strip leading zeros
  while (errLoc.length > 1 && errLoc[0] === 0) errLoc.shift();
  const errCount = errLoc.length - 1;
  if (errCount * 2 > nsym) return null; // too many errors to correct
  return errLoc;
}

// ─── Chien search ────────────────────────────────────────────────────────────

function findErrorPositions(errLoc, blockLen) {
  const errCount = errLoc.length - 1;
  const positions = [];
  for (let i = 0; i < blockLen; i++) {
    // X_i = α^(blockLen - 1 - i); error at position i iff errLoc(X_i^{-1}) = 0
    if (polyEval(errLoc, gfPow(2, -(blockLen - 1 - i))) === 0) {
      positions.push(i);
    }
  }
  if (positions.length !== errCount) return null; // locator doesn't factor → uncorrectable
  return positions;
}

// ─── Forney ──────────────────────────────────────────────────────────────────

function correctErrors(block, synd, errLoc, positions) {
  const nsym = synd.length;
  // Error evaluator Ω(x) = [S(x)·Λ(x)] mod x^nsym
  // synd is S_0..S_{nsym-1}; build reversed syndrome poly (index 0 = highest degree)
  const syndPoly = new Uint8Array(nsym);
  for (let i = 0; i < nsym; i++) syndPoly[i] = synd[nsym - 1 - i];
  let omega = polyMul(syndPoly, Uint8Array.from(errLoc));
  omega = omega.slice(omega.length - nsym); // mod x^nsym

  for (const pos of positions) {
    const xInv = gfPow(2, -(block.length - 1 - pos)); // X_i^{-1}
    // Λ'(x): formal derivative — odd-degree terms only
    let errLocDeriv = 0;
    const deg = errLoc.length - 1;
    for (let j = 0; j < errLoc.length; j++) {
      const power = deg - j;         // degree of this coefficient
      if (power & 1) {
        // derivative term: coefficient · x^(power-1), summed at x = xInv
        errLocDeriv ^= gfMul(errLoc[j], gfPow(xInv, power - 1));
      }
    }
    if (errLocDeriv === 0) return false;
    const omegaVal = polyEval(omega, xInv);
    // fcr = 0 ⇒ magnitude = X_i · Ω(X_i^{-1}) / Λ'(X_i^{-1})
    const xi = gfPow(2, block.length - 1 - pos);
    const magnitude = gfDiv(gfMul(xi, omegaVal), errLocDeriv);
    block[pos] ^= magnitude;
  }
  return true;
}

// ─── Single-block decode (fail-closed) ───────────────────────────────────────

/**
 * Attempt to correct a corrupted block.
 * @returns {Uint8Array|null} corrected data (without parity), or null if
 *          unrecoverable. NEVER returns unverified data.
 */
export function rsDecodeBlock(data, parity, nsym) {
  if (parity.length !== nsym || data.length + nsym > 255) return null;
  const block = new Uint8Array(data.length + nsym);
  block.set(data, 0);
  block.set(parity, data.length);

  const { synd, clean } = calcSyndromes(block, nsym);
  if (clean) return block.slice(0, data.length); // nothing wrong

  const errLoc = berlekampMassey(synd, nsym);
  if (!errLoc) return null;

  const positions = findErrorPositions(errLoc, block.length);
  if (!positions) return null;

  if (!correctErrors(block, synd, errLoc, positions)) return null;

  // FAIL CLOSED: the corrected block must re-verify perfectly.
  if (!calcSyndromes(block, nsym).clean) return null;

  return block.slice(0, data.length);
}

// ─── Chunked API ─────────────────────────────────────────────────────────────

/** Max data bytes per chunk for a given parity count. */
export function rsChunkSize(nsym) {
  const size = 255 - nsym;
  if (size < 1) throw new Error(`RS: parity ${nsym} leaves no room for data`);
  return size;
}

/**
 * Encode arbitrary-length data. Returns concatenated per-chunk parity.
 * Layout: ceil(len / (255 - nsym)) chunks, nsym parity bytes each, in order.
 */
export function rsEncodeChunked(data, nsym) {
  const chunk = rsChunkSize(nsym);
  const nChunks = Math.max(1, Math.ceil(data.length / chunk));
  const parity = new Uint8Array(nChunks * nsym);
  for (let c = 0; c < nChunks; c++) {
    const slice = data.subarray(c * chunk, Math.min((c + 1) * chunk, data.length));
    parity.set(rsEncodeBlock(slice, nsym), c * nsym);
  }
  return parity;
}

/** Verify all chunks. */
export function rsVerifyChunked(data, parity, nsym) {
  const chunk = rsChunkSize(nsym);
  const nChunks = Math.max(1, Math.ceil(data.length / chunk));
  if (parity.length !== nChunks * nsym) return false;
  for (let c = 0; c < nChunks; c++) {
    const slice = data.subarray(c * chunk, Math.min((c + 1) * chunk, data.length));
    if (!rsVerifyBlock(slice, parity.subarray(c * nsym, (c + 1) * nsym), nsym)) return false;
  }
  return true;
}

/**
 * Attempt chunk-by-chunk recovery of corrupted data.
 * @returns {Uint8Array|null} fully corrected data, or null if ANY chunk is
 *          unrecoverable (fail closed — no partial results).
 */
export function rsDecodeChunked(data, parity, nsym) {
  const chunk = rsChunkSize(nsym);
  const nChunks = Math.max(1, Math.ceil(data.length / chunk));
  if (parity.length !== nChunks * nsym) return null;
  const out = new Uint8Array(data.length);
  for (let c = 0; c < nChunks; c++) {
    const start = c * chunk;
    const end = Math.min(start + chunk, data.length);
    const fixed = rsDecodeBlock(
      data.subarray(start, end),
      parity.subarray(c * nsym, (c + 1) * nsym),
      nsym
    );
    if (fixed === null) return null;
    out.set(fixed, start);
  }
  return out;
}

// ─── Legacy-name aliases (drop-in for the old rs.js call sites) ──────────────
export const rsEncode = rsEncodeBlock;
export const rsDecode = rsDecodeBlock;
export const rsVerify = rsVerifyBlock;
