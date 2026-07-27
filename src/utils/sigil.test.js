/**
 * The port contract. These are the SAME three seeds and hashes pinned by the
 * website's scripts/sigil-golden.mjs — a sigil must look identical on the
 * inviter's card, the redeem page and this app's gate. If a change here is
 * deliberate, change the site's golden file in the same commit.
 */

import { createHash } from 'crypto';
import { designFromSeed, SIGIL_PALETTES } from './sigil';

const SEEDS = {
  a: 'c8b7d5c1e2a94f6d8e3b1a0f7c6d5e4b3a291807f6e5d4c3b2a190887766554e',
  b: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  c: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
};

const EXPECTED = {
  a: 'bb3dde90c4e0a229',
  b: 'b27bd722ce6e278a',
  c: '3f5572812b26d327',
};

const hash = (seed) =>
  createHash('sha256').update(JSON.stringify(designFromSeed(seed))).digest('hex').slice(0, 16);

describe('sigil design', () => {
  it.each(Object.keys(SEEDS))('matches the website golden for seed %s', (k) => {
    expect(hash(SEEDS[k])).toBe(EXPECTED[k]);
  });

  it('is a pure function of the seed', () => {
    expect(designFromSeed(SEEDS.a)).toEqual(designFromSeed(SEEDS.a));
  });

  it('mirrors every row left-to-right', () => {
    for (const seed of Object.values(SEEDS)) {
      for (const row of designFromSeed(seed).cells) {
        expect(row.slice(0, 5)).toEqual(row.slice(5).reverse());
      }
    }
  });

  it('picks a real palette', () => {
    const d = designFromSeed(SEEDS.b);
    expect(SIGIL_PALETTES[d.paletteIdx]).toBe(d.palette);
    expect(d.palette).toHaveLength(4);
  });

  it('rejects anything that is not a sha256 hex string', () => {
    expect(() => designFromSeed('nope')).toThrow();
    expect(() => designFromSeed('abc123')).toThrow();
  });

  it('gives visibly different designs to different seeds', () => {
    const flat = (s) => designFromSeed(s).cells.flat().join('');
    expect(flat(SEEDS.a)).not.toBe(flat(SEEDS.b));
    expect(flat(SEEDS.b)).not.toBe(flat(SEEDS.c));
  });
});
