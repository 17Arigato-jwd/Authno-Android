/**
 * rs.js — GF(2^8) Reed-Solomon codec
 *
 * Primitive polynomial: x^8 + x^4 + x^3 + x^2 + 1  (0x11D — same as reedsolo / @ronomon)
 * Systematic encoding: output is [data | parity]
 *
 * Matches the RS layer described in VCHS-ECS §5 so parity blocks produced here
 * are compatible with Python's reedsolo library and @ronomon/reed-solomon.
 *
 * Public API
 * ----------
 *   rsEncode(data: Uint8Array, nParity: number): Uint8Array   → parity bytes only
 *   rsVerify(data: Uint8Array, parity: Uint8Array): boolean   → true if data is intact
 *   rsDecode(data: Uint8Array, parity: Uint8Array): Uint8Array | null
 *     → corrected data, or null if too many errors
 *
 * Limits: data length + nParity ≤ 255 (GF(256) constraint).
 * For larger sections, split into 223-byte chunks (standard practice).
 */

const PRIM = 0x11D;

// ─── GF(2^8) tables ──────────────────────────────────────────────────────────

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIM;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

function gfDiv(a, b) {
  if (b === 0) throw new Error('GF divide by zero');
  if (a === 0) return 0;
  return EXP[(LOG[a] - LOG[b] + 255) % 255];
}

function gfPow(x, power) {
  return EXP[(LOG[x] * power) % 255];
}

function gfInv(x) {
  return EXP[255 - LOG[x]];
}

// ─── Polynomial operations ────────────────────────────────────────────────────

function polyMul(p, q) {
  const r = new Uint8Array(p.length + q.length - 1);
  for (let j = 0; j < q.length; j++)
    for (let i = 0; i < p.length; i++)
      r[i + j] ^= gfMul(p[i], q[j]);
  return r;
}

function polyEval(poly, x) {
  let y = poly[0];
  for (let i = 1; i < poly.length; i++) y = gfMul(y, x) ^ poly[i];
  return y;
}

// Build generator polynomial for nParity roots (αⁱ for i = 0..nParity-1)
function generatorPoly(nParity) {
  let g = new Uint8Array([1]);
  for (let i = 0; i < nParity; i++) {
    g = polyMul(g, new Uint8Array([1, gfPow(2, i)]));
  }
  return g;
}

// ─── Encoding ─────────────────────────────────────────────────────────────────

/**
 * Encode data → parity bytes (systematic: data unchanged, parity appended).
 * nParity must satisfy: data.length + nParity ≤ 255.
 * Returns only the parity bytes (length = nParity).
 */
export function rsEncode(data, nParity) {
  if (nParity === 0) return new Uint8Array(0);
  if (data.length + nParity > 255) {
    throw new Error(`RS block too large: data(${data.length}) + parity(${nParity}) > 255`);
  }

  const gen = generatorPoly(nParity);
  const msg = new Uint8Array(data.length + nParity);
  msg.set(data);

  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 1; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

// ─── Syndrome computation ─────────────────────────────────────────────────────

function syndromes(msg, nParity) {
  const synd = new Uint8Array(nParity);
  for (let i = 0; i < nParity; i++) {
    synd[i] = polyEval(msg, gfPow(2, i));
  }
  return synd;
}

// ─── Berlekamp-Massey ─────────────────────────────────────────────────────────

function berlekampMassey(synd) {
  const n = synd.length;
  let C = new Uint8Array([1]);
  let B = new Uint8Array([1]);
  let L = 0, m = 1, b = 1;

  for (let i = 0; i < n; i++) {
    let d = synd[i];
    for (let j = 1; j <= L; j++) d ^= gfMul(C[j], synd[i - j]);
    if (d === 0) { m++; continue; }
    const T = C.slice();
    const coef = gfDiv(d, b);
    const shift = new Uint8Array(m + B.length);
    for (let j = 0; j < B.length; j++) shift[m + j] = gfMul(coef, B[j]);
    const newC = new Uint8Array(Math.max(C.length, shift.length));
    newC.set(C);
    for (let j = 0; j < shift.length; j++) newC[j] ^= shift[j];
    if (2 * L <= i) { L = i + 1 - L; B = T; b = d; m = 1; }
    else m++;
    C = newC;
  }
  return C;
}

// ─── Chien search + Forney ────────────────────────────────────────────────────

function chienSearch(errLoc, n) {
  const positions = [];
  for (let i = 0; i < n; i++) {
    if (polyEval(errLoc, gfPow(2, i)) === 0) {
      positions.push(n - 1 - i);
    }
  }
  return positions;
}

function forneyMagnitudes(synd, errLoc, positions, nTotal) {
  const errPoly = new Uint8Array(positions.length);
  const nParity = synd.length;

  const omegaLen = Math.min(errLoc.length + nParity, nTotal);
  const omega = new Uint8Array(omegaLen);
  for (let i = 0; i < omegaLen; i++) {
    let v = 0;
    for (let j = 0; j < errLoc.length && j <= i; j++) {
      if (i - j < nParity) v ^= gfMul(errLoc[j], synd[i - j]);
    }
    omega[i] = v;
  }

  for (let i = 0; i < positions.length; i++) {
    const xi = gfPow(2, nTotal - 1 - positions[i]);
    const xiInv = gfInv(xi);
    const omVal = polyEval(omega, xiInv);

    let dPrime = errLoc[1];
    for (let j = 2; j < errLoc.length; j += 2) {
      dPrime ^= gfMul(errLoc[j], gfPow(xiInv, j));
    }
    if (dPrime === 0) { errPoly[i] = 0; continue; }
    errPoly[i] = gfMul(gfPow(xi, 1), gfDiv(omVal, dPrime));
  }
  return errPoly;
}

// ─── Decoding ─────────────────────────────────────────────────────────────────

/**
 * Verify data against its parity. Returns true if data is intact.
 * This is the fast-path check (pure syndrome check, no correction).
 */
export function rsVerify(data, parity) {
  if (parity.length === 0) return true;
  const msg = new Uint8Array(data.length + parity.length);
  msg.set(data);
  msg.set(parity, data.length);
  const synd = syndromes(msg, parity.length);
  return synd.every(s => s === 0);
}

/**
 * Attempt to decode and correct data using parity.
 * Returns corrected data bytes if successful, null if too many errors.
 * Corrects up to floor(nParity / 2) symbol errors.
 */
export function rsDecode(data, parity) {
  if (parity.length === 0) return data.slice();
  const nParity = parity.length;
  const msg = new Uint8Array(data.length + nParity);
  msg.set(data);
  msg.set(parity, data.length);
  const nTotal = msg.length;

  const synd = syndromes(msg, nParity);
  if (synd.every(s => s === 0)) return data.slice();

  const errLoc = berlekampMassey(synd);
  const nErrors = errLoc.length - 1;
  if (nErrors * 2 > nParity) return null; // too many errors

  const positions = chienSearch(errLoc, nTotal);
  if (positions.length !== nErrors) return null;

  const magnitudes = forneyMagnitudes(synd, errLoc, positions, nTotal);

  const corrected = msg.slice();
  for (let i = 0; i < positions.length; i++) {
    corrected[positions[i]] ^= magnitudes[i];
  }

  const checkSynd = syndromes(corrected, nParity);
  if (!checkSynd.every(s => s === 0)) return null;

  return corrected.slice(0, data.length);
}

// ─── Chunked codec (for sections > 223 bytes) ────────────────────────────────

const CHUNK_DATA = 223; // max data bytes per RS block (255 - 32 parity max)

/**
 * Encode arbitrary-length data with RS parity.
 * Returns parity bytes ONLY (data is transmitted separately).
 * nParity: parity bytes per chunk.
 */
export function rsEncodeChunked(data, nParity) {
  if (nParity === 0) return new Uint8Array(0);
  const chunks = Math.ceil(data.length / CHUNK_DATA);
  const parityParts = [];
  for (let i = 0; i < chunks; i++) {
    const chunk = data.slice(i * CHUNK_DATA, (i + 1) * CHUNK_DATA);
    parityParts.push(rsEncode(chunk, nParity));
  }
  const total = parityParts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parityParts) { out.set(p, off); off += p.length; }
  return out;
}

/**
 * Verify chunked data against parity. Returns true if all chunks pass.
 */
export function rsVerifyChunked(data, parity, nParity) {
  if (nParity === 0) return true;
  const chunks = Math.ceil(data.length / CHUNK_DATA);
  for (let i = 0; i < chunks; i++) {
    const dataChunk   = data.slice(i * CHUNK_DATA, (i + 1) * CHUNK_DATA);
    const parityChunk = parity.slice(i * nParity, (i + 1) * nParity);
    if (!rsVerify(dataChunk, parityChunk)) return false;
  }
  return true;
}

/**
 * Decode and correct chunked data. Returns corrected data or null.
 */
export function rsDecodeChunked(data, parity, nParity) {
  if (nParity === 0) return data.slice();
  const chunks = Math.ceil(data.length / CHUNK_DATA);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < chunks; i++) {
    const dataChunk   = data.slice(i * CHUNK_DATA, (i + 1) * CHUNK_DATA);
    const parityChunk = parity.slice(i * nParity, (i + 1) * nParity);
    const corrected   = rsDecode(dataChunk, parityChunk);
    if (corrected === null) return null;
    out.set(corrected, i * CHUNK_DATA);
  }
  return out;
}
