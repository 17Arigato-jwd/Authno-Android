/**
 * access.test.js — the gate's guarantees.
 *
 * The important ones: a genuine key with the wrong name fails, a paid licence
 * cannot open the gate, tampering fails, and the attempt counter escalates to
 * an exit and survives a restart.
 */

import { webcrypto } from 'crypto';

if (!global.crypto?.subtle) global.crypto = webcrypto;

const KEY_ENV = 'REACT_APP_ACCESS_PUBKEY';

/** Sign a payload the way the Worker does. */
async function mintKey(privateKey, payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes);
  const b64 = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `AUTHNO-${b64(bytes)}.${b64(new Uint8Array(sig))}`;
}

let access;
let pair;
let goodKey;
const PAYLOAD = { t: 'access', v: 1, uid: 'u_1', u: 'inkwell_moth', gen: 1, iat: 1753500000000, te: Date.now() + 6 * 86400000, q: 5 };

beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  process.env[KEY_ENV] = Buffer.from(spki).toString('base64');
  access = require('./access');
  goodKey = await mintKey(pair.privateKey, PAYLOAD);
});

beforeEach(() => { localStorage.clear(); });

describe('verifyAccess', () => {
  it('accepts a genuine key with its own pen name', async () => {
    await expect(access.verifyAccess(goodKey, 'inkwell_moth')).resolves.toMatchObject({ u: 'inkwell_moth' });
  });

  it('ignores case and surrounding space in the typed name', async () => {
    await expect(access.verifyAccess(goodKey, '  Inkwell_Moth ')).resolves.toBeTruthy();
  });

  it('rejects a genuine key under someone else’s name', async () => {
    await expect(access.verifyAccess(goodKey, 'someone_else')).rejects.toThrow('username-mismatch');
  });

  it('rejects a tampered payload', async () => {
    const [head, sig] = goodKey.slice('AUTHNO-'.length).split('.');
    const bytes = Buffer.from(head.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    bytes[bytes.length - 4] ^= 1;
    const tampered = `AUTHNO-${bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${sig}`;
    await expect(access.verifyAccess(tampered, 'inkwell_moth')).rejects.toThrow(/bad-signature|malformed/);
  });

  it('rejects a key signed by a different keypair', async () => {
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const forged = await mintKey(other.privateKey, PAYLOAD);
    await expect(access.verifyAccess(forged, 'inkwell_moth')).rejects.toThrow('bad-signature');
  });

  it('refuses a purchase licence at the invite gate', async () => {
    const licence = await mintKey(pair.privateKey, { ...PAYLOAD, t: 'license' });
    await expect(access.verifyAccess(licence, 'inkwell_moth')).rejects.toThrow('wrong-key-type');
  });

  // Every key the gate issues today is a v2 device key. This rejected all of
  // them as 'wrong-key-type' — by password AND by key file — until it was
  // driven against a real gate. The key-file tests could not catch it: their
  // vector carries a placeholder string that never reaches verifyAccessKey.
  it('accepts a v2 device key, which is what accounts actually issue', async () => {
    const iat = Date.now();
    const device = await mintKey(pair.privateKey, {
      t: 'device', v: 2,
      acc: 'u_1', did: 'd_abc', u: 'inkwell_moth', gen: 1, iat,
      access: { gen: 1, iat },
      ent: { tier: 'free', exp: iat + 60 * 86400000 },
    });
    const payload = await access.verifyAccess(device, 'inkwell_moth');
    expect(payload.u).toBe('inkwell_moth');
    // Callers read `uid`; a device key calls it `acc`. They should not have to
    // know which shape they got.
    expect(payload.uid).toBe('u_1');
    expect(payload.gen).toBe(1);
    // A device key belongs to an account that is already a member, so there is
    // no trial to count down.
    expect(access.trialDaysLeftFrom(payload)).toBe(0);
  });

  it('still refuses a device key issued to a different pen name', async () => {
    const iat = Date.now();
    const device = await mintKey(pair.privateKey, {
      t: 'device', v: 2, acc: 'u_1', did: 'd_abc', u: 'someone_else', gen: 1, iat,
      access: { gen: 1, iat }, ent: { tier: 'free', exp: iat },
    });
    await expect(access.verifyAccess(device, 'inkwell_moth')).rejects.toThrow('username-mismatch');
  });

  it('still refuses a forged device key', async () => {
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const iat = Date.now();
    const forged = await mintKey(other.privateKey, {
      t: 'device', v: 2, acc: 'u_1', did: 'd_abc', u: 'inkwell_moth', gen: 1, iat,
      access: { gen: 1, iat }, ent: { tier: 'free', exp: iat },
    });
    await expect(access.verifyAccess(forged, 'inkwell_moth')).rejects.toThrow('bad-signature');
  });

  it('rejects junk', async () => {
    await expect(access.verifyAccess('hello', 'inkwell_moth')).rejects.toThrow('malformed');
    await expect(access.verifyAccess('AUTHNO-nodot', 'inkwell_moth')).rejects.toThrow('malformed');
  });
});

describe('storage', () => {
  it('round-trips and re-verifies on boot', async () => {
    access.storeAccess(goodKey, 'Inkwell_Moth');
    expect(access.getStoredAccess().username).toBe('inkwell_moth');
    await expect(access.verifyStoredAccess()).resolves.toMatchObject({ uid: 'u_1' });
  });

  it('returns null — never throws — when nothing is stored', async () => {
    await expect(access.verifyStoredAccess()).resolves.toBeNull();
  });

  it('returns null when the stored key was hand-edited', async () => {
    access.storeAccess(goodKey.slice(0, -3) + 'aaa', 'inkwell_moth');
    await expect(access.verifyStoredAccess()).resolves.toBeNull();
  });
});

describe('attempt limiting', () => {
  it('escalates cooldowns and exits on the fifth failure', () => {
    expect(access.recordFailure()).toMatchObject({ count: 1, lockedMs: 0, exit: false });
    expect(access.recordFailure()).toMatchObject({ count: 2, lockedMs: 0, exit: false });
    expect(access.recordFailure()).toMatchObject({ count: 3, lockedMs: 30000, exit: false });
    expect(access.recordFailure()).toMatchObject({ count: 4, lockedMs: 300000, exit: false });
    expect(access.recordFailure()).toMatchObject({ count: 5, exit: true });
  });

  it('survives a restart — the counter is persisted, not in memory', () => {
    access.recordFailure();
    access.recordFailure();
    jest.resetModules();
    const reloaded = require('./access');
    expect(reloaded.getAttemptState().count).toBe(2);
    expect(reloaded.getAttemptState().remaining).toBe(3);
  });

  it('clears the counter once a key is accepted', () => {
    access.recordFailure();
    access.storeAccess(goodKey, 'inkwell_moth');
    expect(access.getAttemptState().count).toBe(0);
  });

  it('reports a live cooldown', () => {
    access.recordFailure(); access.recordFailure(); access.recordFailure();
    const s = access.getAttemptState();
    expect(s.lockedUntil).toBeGreaterThan(Date.now());
    expect(s.lockedMs).toBeGreaterThan(25000);
  });
});

describe('trial', () => {
  it('reads the signed trial end rather than any local clock', () => {
    expect(access.trialEndsFrom(PAYLOAD)).toBe(PAYLOAD.te);
    expect(access.trialDaysLeftFrom(PAYLOAD)).toBe(6);
  });

  it('treats a key with no trial as expired rather than infinite', () => {
    expect(access.trialEndsFrom({ t: 'access' })).toBeNull();
    expect(access.trialDaysLeftFrom({ t: 'access' })).toBe(0);
  });

  it('never returns negative days for a lapsed trial', () => {
    expect(access.trialDaysLeftFrom({ te: Date.now() - 9 * 86400000 })).toBe(0);
  });
});

describe('gate configuration', () => {
  it('is configured when a public key is present', () => {
    expect(access.isAccessConfigured()).toBe(true);
  });

  it('does not gate unless REQUIRE_INVITE is explicitly true', () => {
    delete process.env.REACT_APP_REQUIRE_INVITE;
    jest.resetModules();
    expect(require('./access').isGateRequired()).toBe(false);
    process.env.REACT_APP_REQUIRE_INVITE = 'true';
    jest.resetModules();
    expect(require('./access').isGateRequired()).toBe(true);
    delete process.env.REACT_APP_REQUIRE_INVITE;
  });
});
