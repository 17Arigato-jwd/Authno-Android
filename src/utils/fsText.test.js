/**
 * The read that came back base64 on every platform but one.
 *
 * Capacitor's web Filesystem has `const encoding = options.encoding;`
 * commented out in `readFile`, so it returns whatever `writeFile` stored. The
 * installer stored base64. Native decoded it on the way in and returned text;
 * web returned the base64 — and `JSON.parse` failed on the first character of
 * every manifest, so every extension installed on desktop discovered as
 * nothing at all, with a caught error and no visible symptom.
 *
 * The write side is fixed. This is for what is already on disk.
 */

import { fsText } from './fsText';

const b64 = (s) => btoa(unescape(encodeURIComponent(s)));

describe('reading a file back', () => {
  test('plain JSON comes through untouched', () => {
    const json = '{\n  "id": "cloud-backup",\n  "apiVersion": 2\n}';
    expect(fsText(json)).toBe(json);
  });

  test('base64 JSON is decoded', () => {
    const json = '{"id":"cloud-backup","apiVersion":2}';
    expect(JSON.parse(fsText(b64(json)))).toEqual({ id: 'cloud-backup', apiVersion: 2 });
  });

  test('base64 JavaScript is decoded', () => {
    const src = "import { queue } from './queue.js';\nexport function activate() {}\n";
    expect(fsText(b64(src))).toBe(src);
  });

  test('JavaScript is never mistaken for base64', () => {
    // Punctuation is the discriminator: a space, a dot, a quote and a brace
    // are all outside the base64 alphabet, and source has all of them.
    const src = "export const a = 1;";
    expect(fsText(src)).toBe(src);
  });

  test('non-ASCII survives the round trip', () => {
    const text = '{"name":"Café — naïve 日本語"}';
    expect(fsText(b64(text))).toBe(text);
  });

  test('a short base64-shaped word is left alone', () => {
    // Below the length floor. Decoding "abcd" would give two bytes of noise
    // and quietly corrupt a one-line file.
    expect(fsText('abcd')).toBe('abcd');
  });

  test('something base64-shaped that is not valid UTF-8 is left alone', () => {
    // Right alphabet, right length, decodes to bytes that are not text. The
    // decoder is fatal on purpose so this falls back rather than returning
    // replacement characters.
    const notText = btoa(String.fromCharCode(0xff, 0xfe, 0xff, 0xfe, 0xff, 0xfe));
    expect(fsText(notText)).toBe(notText);
  });

  test('anything that is not a string reads as empty', () => {
    expect(fsText(undefined)).toBe('');
    expect(fsText(null)).toBe('');
    expect(fsText(new Uint8Array([1, 2, 3]))).toBe('');
  });

  test('an empty file stays empty', () => {
    expect(fsText('')).toBe('');
  });
});
