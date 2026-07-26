/**
 * keyfile.js — reading the .authkey file the website issues.
 *
 * PORT of the website's src/invite/keyfile.ts (read side only — the app never
 * writes one). The container format is contractual between the two; keyfile
 * .test.js pins it against a fixed vector so they cannot drift.
 *
 * The file is encrypted with the holder's pen name and email, not with a
 * password they'd have to remember. That is what makes the gate's three
 * fields mean something: the signed key inside proves membership, and the
 * file will not open at all unless the other two are right. A copy of the
 * file on its own is useless.
 *
 * Honest limit: a pen name and an email are low-entropy, so this defeats a
 * mislaid or casually-copied file, not someone who already knows who you are.
 * The ECDSA signature on the key inside is the part that cannot be forged.
 *
 * CONTAINER (same family as .extbk/.authbook: magic, versioned, CRC'd)
 *   0..7    magic  89 'A' 'U' 'T' 'H' 'K' 0D 0A
 *   8       version (1)
 *   9       kdf id  (1 = PBKDF2-SHA256)
 *   10..13  iterations, u32LE
 *   14      salt length ; salt
 *   ..      iv length   ; iv
 *   ..      u32LE ciphertext length ; ciphertext (AES-GCM, tag included)
 *   last 4  u32LE CRC-32 over everything before it
 */

export const KEYFILE_EXT = 'authkey';
export const KEYFILE_VERSION = 1;
const MAGIC = new Uint8Array([0x89, 0x41, 0x55, 0x54, 0x48, 0x4b, 0x0d, 0x0a]);
const KDF_PBKDF2 = 1;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Must match the website's normalization exactly or nothing ever opens. */
function secretMaterial(username, email) {
  const u = String(username || '').trim().normalize('NFKC').toLowerCase();
  const e = String(email || '').trim().normalize('NFKC').toLowerCase();
  return `${u}${e}`;
}

async function deriveKey(username, email, salt, iterations) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secretMaterial(username, email)), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

/**
 * Open a .authkey. Resolves to { accessKey, username, email, … }, or throws a
 * stable reason: 'not-a-keyfile' | 'corrupt' | 'unsupported-version' |
 * 'wrong-details'. The last one is the interesting case — the file is intact
 * but the pen name or email given doesn't match it.
 */
export async function unpackKeyFile(bytes, username, email) {
  if (!bytes || bytes.length < 20) throw new Error('not-a-keyfile');
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) throw new Error('not-a-keyfile');

  const body = bytes.subarray(0, bytes.length - 4);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(bytes.length - 4, true) !== crc32(body)) throw new Error('corrupt');

  let o = 8;
  if (bytes[o++] !== KEYFILE_VERSION) throw new Error('unsupported-version');
  if (bytes[o++] !== KDF_PBKDF2) throw new Error('unsupported-version');
  const iterations = dv.getUint32(o, true); o += 4;
  const saltLen = bytes[o++]; const salt = bytes.subarray(o, o + saltLen); o += saltLen;
  const ivLen = bytes[o++];   const iv = bytes.subarray(o, o + ivLen);     o += ivLen;
  const ctLen = dv.getUint32(o, true); o += 4;
  const ct = bytes.subarray(o, o + ctLen);
  if (ct.length !== ctLen) throw new Error('corrupt');

  const key = await deriveKey(username, email, salt, iterations);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    throw new Error('wrong-details');
  }

  const j = JSON.parse(new TextDecoder().decode(plain));
  if (j?.authno !== 'access-key' || typeof j.accessKey !== 'string') throw new Error('corrupt');
  return {
    accessKey: j.accessKey,
    username: j.username,
    email: j.email || '',
    generation: Number.isFinite(j.generation) ? j.generation : null,
    trialEnds: Number.isFinite(j.trialEnds) ? j.trialEnds : null,
  };
}

/** Read a File chosen from an <input type="file">, then open it. */
export async function readKeyFile(file, username, email) {
  const buf = await file.arrayBuffer();
  return unpackKeyFile(new Uint8Array(buf), username, email);
}

export function keyFileErrorText(reason) {
  const MAP = {
    'not-a-keyfile': 'That isn’t an AuthNo key file. Look for the .authkey the website gave you.',
    'corrupt': 'That key file is damaged — some of it didn’t survive the trip. Ask the website to re-issue it.',
    'unsupported-version': 'That key file was made by a newer AuthNo. Update the app.',
    'wrong-details': 'The file didn’t open. It is sealed with the pen name and email it was issued to — check both for typos.',
  };
  return MAP[reason] || 'That key file could not be read.';
}
