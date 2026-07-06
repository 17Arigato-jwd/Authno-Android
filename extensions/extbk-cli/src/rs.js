/**
 * rs.js — Reed-Solomon API used by the .extbk format layer.
 *
 * v1.1.16: The previous hand-rolled implementation in this file had two fatal
 * bugs, verified empirically:
 *   1. rsEncodeChunked hardcoded CHUNK_DATA = 223, so any nParity > 32 threw
 *      "RS block too large" — most real .extbk sections could not be packed.
 *   2. The Berlekamp–Massey / Forney decode path returned null (or wrong
 *      bytes) for even a single corrupted byte — recovery never worked.
 *
 * All math now lives in ./reedSolomon.js, a verified codec covered by a
 * round-trip test suite (src/utils/rs.test.js). This file only adapts the
 * legacy call signatures. Parity output is byte-identical to what the old
 * encoder produced, so .extbk files written by earlier versions gain working
 * recovery with no format change.
 */

import {
  rsEncodeBlock, rsDecodeBlock, rsVerifyBlock,
  rsEncodeChunked as _enc, rsDecodeChunked as _dec, rsVerifyChunked as _ver,
  rsChunkSize,
} from './reedSolomon.js';

export function rsEncode(data, nParity)         { return rsEncodeBlock(data, nParity); }
export function rsVerify(data, parity)          { return rsVerifyBlock(data, parity, parity.length); }
export function rsDecode(data, parity)          { return rsDecodeBlock(data, parity, parity.length); }

export function rsEncodeChunked(data, nParity)          { return _enc(data, nParity); }
export function rsVerifyChunked(data, parity, nParity)  { return _ver(data, parity, nParity); }
export function rsDecodeChunked(data, parity, nParity)  { return _dec(data, parity, nParity); }

export { rsChunkSize };
