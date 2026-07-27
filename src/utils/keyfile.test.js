/**
 * The cross-repo container contract. VECTOR below was produced by the
 * WEBSITE's packKeyFile() (src/invite/keyfile.ts). If the app can no longer
 * open it, the two implementations have drifted and members' key files would
 * stop working — regenerate deliberately, never to make a red test go green.
 */

import { webcrypto } from 'crypto';
if (!global.crypto?.subtle) global.crypto = webcrypto;

import { unpackKeyFile, keyFileErrorText } from './keyfile';

// Sealed for username 'lunar', email 'a@b.co'.
const VECTOR = 'iUFVVEhLDQoBAcAnCQAQjvPrf6YMhFX202HydOmQgQzJKG0oiH9Z+/c7ko/NAAAAZv6G4x8/Sz+HX0nKEhjzxsMCkrsQFn1CpTeALrcJqnepmqIkWdk7dMbJ+z6rfpqS6c5gWNFQROX5jlxBB5l+bbqq0n5Rm73AD4dy/WVFcnPeNbhwntf6gbTDp3Hz+WJlAjSQWvPmjPliA0/JojEI1+ZghGWUkZN6uZHqDEa7wEr4wMw5OSc1kMRdd4nJn2T231aiUOHaw0OAOQjHUYewUHMEJPvJkzmYr1X7SWXOYrORgrriEavGDDVbl8fJHoxxreKFNYRz6va9dX7HVw8dSKM=';
const bytes = () => Uint8Array.from(Buffer.from(VECTOR, 'base64'));

describe('.authkey container', () => {
  it('opens a file sealed by the website', async () => {
    const r = await unpackKeyFile(bytes(), 'lunar', 'a@b.co');
    expect(r.accessKey).toBe('AUTHNO-testpayload.testsig');
    expect(r.username).toBe('lunar');
    expect(r.trialEnds).toBe(1786303738547);
  });

  it('forgives case and surrounding space in both details', async () => {
    const r = await unpackKeyFile(bytes(), '  LUNAR ', 'A@B.CO ');
    expect(r.accessKey).toBe('AUTHNO-testpayload.testsig');
  });

  it('refuses the wrong pen name', async () => {
    await expect(unpackKeyFile(bytes(), 'someone_else', 'a@b.co')).rejects.toThrow('wrong-details');
  });

  it('refuses the wrong email', async () => {
    await expect(unpackKeyFile(bytes(), 'lunar', 'nope@b.co')).rejects.toThrow('wrong-details');
  });

  it('keeps nothing readable in the clear', () => {
    const text = Buffer.from(VECTOR, 'base64').toString('latin1');
    expect(text).not.toContain('AUTHNO-testpayload');
    expect(text).not.toContain('lunar');
    expect(text).not.toContain('a@b.co');
  });

  it('detects a flipped bit via CRC', async () => {
    const b = bytes(); b[b.length - 9] ^= 1;
    await expect(unpackKeyFile(b, 'lunar', 'a@b.co')).rejects.toThrow(/corrupt|wrong-details/);
  });

  it('rejects a file that is not a keyfile', async () => {
    await expect(unpackKeyFile(new Uint8Array(40), 'lunar', 'a@b.co')).rejects.toThrow('not-a-keyfile');
  });

  it('explains every failure in plain words', () => {
    for (const r of ['not-a-keyfile', 'corrupt', 'unsupported-version', 'wrong-details']) {
      expect(keyFileErrorText(r).length).toBeGreaterThan(20);
    }
  });
});
