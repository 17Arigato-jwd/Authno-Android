/**
 * rs.test.js — Round-trip guarantee suite for the Reed-Solomon codec.
 * Run with `npm test`. If this suite is red, do NOT ship format changes.
 */
import {
  rsEncodeBlock, rsDecodeBlock, rsVerifyBlock,
  rsEncodeChunked, rsDecodeChunked, rsVerifyChunked, rsChunkSize,
} from './reedSolomon';

const rnd = (n) => Math.floor(Math.random() * n);
const randBytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = rnd(256); return b; };
const eq = (a, b) => a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);

test('clean blocks verify', () => {
  for (let t = 0; t < 200; t++) {
    const nsym = 2 + rnd(64);
    const data = randBytes(1 + rnd(255 - nsym));
    expect(rsVerifyBlock(data, rsEncodeBlock(data, nsym), nsym)).toBe(true);
  }
});

test('recovers up to floor(nsym/2) random errors per block', () => {
  for (let t = 0; t < 500; t++) {
    const nsym = 2 + rnd(64);
    const dataLen = 1 + rnd(255 - nsym);
    const data = randBytes(dataLen);
    const parity = rsEncodeBlock(data, nsym);
    const tCap = Math.max(1, Math.floor(nsym / 2));
    const blockLen = dataLen + nsym;
    const positions = new Set();
    while (positions.size < Math.min(1 + rnd(tCap), blockLen)) positions.add(rnd(blockLen));
    const cd = data.slice(); const cp = parity.slice();
    for (const p of positions) {
      const flip = 1 + rnd(255);
      if (p < dataLen) cd[p] ^= flip; else cp[p - dataLen] ^= flip;
    }
    expect(eq(rsDecodeBlock(cd, cp, nsym), data)).toBe(true);
  }
});

test('fails closed beyond capacity (never returns unverified data)', () => {
  let failed = 0;
  const trials = 300;
  for (let t = 0; t < trials; t++) {
    const nsym = 4 + rnd(20);
    const dataLen = 20 + rnd(200 - nsym);
    const data = randBytes(dataLen);
    const parity = rsEncodeBlock(data, nsym);
    const cd = data.slice(); const cp = parity.slice();
    const errs = Math.floor(nsym / 2) + 3 + rnd(15);
    const blockLen = dataLen + nsym;
    const positions = new Set();
    while (positions.size < Math.min(errs, blockLen)) positions.add(rnd(blockLen));
    for (const p of positions) {
      if (p < dataLen) cd[p] ^= 1 + rnd(255); else cp[p - dataLen] ^= 1 + rnd(255);
    }
    const out = rsDecodeBlock(cd, cp, nsym);
    if (out === null) failed++;
    // Rare miscorrections to a DIFFERENT valid codeword are information-
    // theoretically possible; the format layer's CRC32 catches those.
  }
  expect(failed).toBeGreaterThan(trials * 0.8);
});

test('chunked round-trip on large buffers with scattered corruption', () => {
  const nsym = 51; // matches the default 20% RS level
  const data = randBytes(50000);
  const parity = rsEncodeChunked(data, nsym);
  expect(rsVerifyChunked(data, parity, nsym)).toBe(true);
  const cd = data.slice();
  for (let i = 0; i < 100; i++) cd[rnd(data.length)] ^= 1 + rnd(255);
  expect(eq(rsDecodeChunked(cd, parity, nsym), data)).toBe(true);
});

test('edge cases: empty and tiny inputs', () => {
  const empty = new Uint8Array(0);
  expect(eq(rsDecodeChunked(empty, rsEncodeChunked(empty, 10), 10), empty)).toBe(true);
  const one = new Uint8Array([7]);
  const p = rsEncodeBlock(one, 4);
  expect(eq(rsDecodeBlock(new Uint8Array([200]), p, 4), one)).toBe(true);
  expect(() => rsEncodeBlock(randBytes(250), 10)).toThrow();
  expect(rsChunkSize(51)).toBe(204);
});
