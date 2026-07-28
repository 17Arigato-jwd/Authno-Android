/**
 * The cross-repo container contract. VECTOR below was produced by the
 * WEBSITE's packKeyFile() (src/invite/keyfile.ts). If the app can no longer
 * open it, the two implementations have drifted and members' key files would
 * stop working — regenerate deliberately, never to make a red test go green.
 */

import { webcrypto } from 'crypto';
if (!global.crypto?.subtle) global.crypto = webcrypto;

import { unpackKeyFile, keyFileErrorText, keyFileSecretKind } from './keyfile';

// v1 — sealed for username 'lunar' with the EMAIL 'a@b.co'. Predates
// passwords. It must keep opening: members who redeemed before the change
// still hold files like this, and telling them their key expired would be a
// lie about our own version byte.
const V1 = 'iUFVVEhLDQoBAcAnCQAQjvPrf6YMhFX202HydOmQgQzJKG0oiH9Z+/c7ko/NAAAAZv6G4x8/Sz+HX0nKEhjzxsMCkrsQFn1CpTeALrcJqnepmqIkWdk7dMbJ+z6rfpqS6c5gWNFQROX5jlxBB5l+bbqq0n5Rm73AD4dy/WVFcnPeNbhwntf6gbTDp3Hz+WJlAjSQWvPmjPliA0/JojEI1+ZghGWUkZN6uZHqDEa7wEr4wMw5OSc1kMRdd4nJn2T231aiUOHaw0OAOQjHUYewUHMEJPvJkzmYr1X7SWXOYrORgrriEavGDDVbl8fJHoxxreKFNYRz6va9dX7HVw8dSKM=';

// v2 — the same account sealed with the PASSWORD 'correct horse battery
// staple'. Produced by the website's packKeyFile(), like V1 was.
const V2 = 'iUFVVEhLDQoCAcAnCQAQSjsgxFcQRYlQoTM59NkIMQxuB0iwKCEE95y7za28AAAAumolEu6SXj4KBgDNTg9TTcFabuXv/DRKBuDebZDUN/upTEbozqSljID+MPHJzjiULoxaTXg2hD1/ixlPMTpIEs8FrrBBmDxtGwJccbQTroFvkYxPwJ7O/FQzK1eqEMzP+7ZRkWimBs8C9ORunb8DBLObbzahSsz6PDgxAf1skpbSxDXFyhFNF5+g/zs6+/wUI+KrihOCGNBWQrNDIimTt9xJa3DFoBlr8+7K5jNPNId55aXsEqxFzVE+FlmFpZuu';

const PASSWORD = 'correct horse battery staple';
const b64 = (v) => Uint8Array.from(Buffer.from(v, 'base64'));
const bytes = () => b64(V1);
const bytes2 = () => b64(V2);

describe('.authkey container', () => {
  it('opens a v1 file sealed by the website with an email', async () => {
    const r = await unpackKeyFile(bytes(), 'lunar', 'a@b.co');
    expect(r.accessKey).toBe('AUTHNO-testpayload.testsig');
    expect(r.username).toBe('lunar');
    expect(r.trialEnds).toBe(1786303738547);
  });

  it('opens a v2 file sealed by the website with a password', async () => {
    const r = await unpackKeyFile(bytes2(), 'lunar', PASSWORD);
    expect(r.accessKey).toBe('AUTHNO-testpayload.testsig');
    expect(r.username).toBe('lunar');
    expect(r.trialEnds).toBe(1786303738547);
  });

  it('says which secret each file wants, without decrypting', () => {
    expect(keyFileSecretKind(bytes())).toBe('email');
    expect(keyFileSecretKind(bytes2())).toBe('password');
    expect(keyFileSecretKind(new Uint8Array(40))).toBe(null);
  });

  it('forgives case and surrounding space in a v1 file\'s details', async () => {
    const r = await unpackKeyFile(bytes(), '  LUNAR ', 'A@B.CO ');
    expect(r.accessKey).toBe('AUTHNO-testpayload.testsig');
  });

  // A password is not an email. Case and interior spaces are content, and
  // lowercasing one would silently shrink the search space.
  it('preserves case and interior spaces in a v2 password', async () => {
    await expect(unpackKeyFile(bytes2(), 'lunar', PASSWORD.toUpperCase()))
      .rejects.toThrow('wrong-details');
    await expect(unpackKeyFile(bytes2(), 'lunar', PASSWORD.replace(/ /g, '')))
      .rejects.toThrow('wrong-details');
    const r = await unpackKeyFile(bytes2(), 'lunar', `  ${PASSWORD}\n`);
    expect(r.accessKey).toBe('AUTHNO-testpayload.testsig');
  });

  it('refuses the wrong pen name', async () => {
    await expect(unpackKeyFile(bytes(), 'someone_else', 'a@b.co')).rejects.toThrow('wrong-details');
    await expect(unpackKeyFile(bytes2(), 'someone_else', PASSWORD)).rejects.toThrow('wrong-details');
  });

  it('refuses the wrong secret', async () => {
    await expect(unpackKeyFile(bytes(), 'lunar', 'nope@b.co')).rejects.toThrow('wrong-details');
    await expect(unpackKeyFile(bytes2(), 'lunar', 'not the password')).rejects.toThrow('wrong-details');
  });

  // The email was half the v1 seal; v2 doesn't need it, so it isn't written.
  // A mislaid key file should not also be a mislaid address.
  it('does not carry an email in a v2 file', async () => {
    const r = await unpackKeyFile(bytes2(), 'lunar', PASSWORD);
    expect(r.email).toBe('');
    expect(Buffer.from(V2, 'base64').toString('latin1')).not.toContain('@');
  });

  it('keeps nothing readable in the clear', () => {
    for (const v of [V1, V2]) {
      const text = Buffer.from(v, 'base64').toString('latin1');
      expect(text).not.toContain('AUTHNO-testpayload');
      expect(text).not.toContain('lunar');
      expect(text).not.toContain('a@b.co');
      expect(text).not.toContain(PASSWORD);
    }
  });

  it('detects a flipped bit via CRC', async () => {
    const b = bytes(); b[b.length - 9] ^= 1;
    await expect(unpackKeyFile(b, 'lunar', 'a@b.co')).rejects.toThrow(/corrupt|wrong-details/);
  });

  it('rejects a file that is not a keyfile', async () => {
    await expect(unpackKeyFile(new Uint8Array(40), 'lunar', 'a@b.co')).rejects.toThrow('not-a-keyfile');
  });

  it('explains every failure in plain words', () => {
    for (const r of ['not-a-keyfile', 'corrupt', 'unsupported-version', 'wrong-details', 'wrong-details-v1']) {
      expect(keyFileErrorText(r).length).toBeGreaterThan(20);
    }
  });
});
