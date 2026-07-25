/**
 * license.js — offline license-key verification.
 *
 * AuthNo has no backend and no login, so "did this person pay?" has to be
 * answerable on a plane. The answer is a signed license key:
 *
 *   AUTHNO-<payload>.<signature>      (both base64url)
 *
 * `payload` is JSON describing the purchase; `signature` is an ECDSA P-256
 * signature over those exact bytes, produced by the PRIVATE key that lives
 * with the seller (never in this app). The app ships only the PUBLIC key, so
 * it can verify a key is genuine but can never mint one.
 *
 * This is what makes the purchase real rather than a localStorage flag: a user
 * can still flip the stored tier by hand, but they cannot forge a license, so
 * anything that matters can re-verify with verifyStoredLicense().
 *
 * Configure with REACT_APP_LICENSE_PUBKEY (base64 SPKI, P-256). Without it,
 * licensing is simply "not configured" and the caller falls back to the
 * demo/mock path — it never silently pretends a key was valid.
 */

const KEY_STORE = 'authno_license';
const PREFIX = 'AUTHNO-';

const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export function getPublicKeyB64() {
  return (process.env.REACT_APP_LICENSE_PUBKEY || '').trim();
}

/** True when a verification key is present — i.e. real licensing is possible. */
export function isLicensingConfigured() {
  return getPublicKeyB64().length > 0;
}

async function importPublicKey() {
  const raw = getPublicKeyB64();
  if (!raw) throw new Error('no-public-key');
  return crypto.subtle.importKey(
    'spki', b64urlToBytes(raw),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['verify']
  );
}

/**
 * Verify a license key string. Resolves to the decoded payload when genuine,
 * or throws with a stable reason ('malformed' | 'bad-signature' | 'expired' |
 * 'no-public-key') so the UI can say something specific.
 */
export async function verifyLicenseKey(input) {
  const key = String(input || '').trim();
  if (!key.startsWith(PREFIX)) throw new Error('malformed');
  const body = key.slice(PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot < 1) throw new Error('malformed');

  const payloadB64 = body.slice(0, dot);
  const sigB64 = body.slice(dot + 1);

  let payloadBytes, sigBytes, payload;
  try {
    payloadBytes = b64urlToBytes(payloadB64);
    sigBytes = b64urlToBytes(sigB64);
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch { throw new Error('malformed'); }

  const pub = await importPublicKey();
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sigBytes, payloadBytes);
  if (!ok) throw new Error('bad-signature');

  // Optional expiry (`exp`, epoch ms) — a perpetual licence simply omits it.
  if (payload.exp && Date.now() > Number(payload.exp)) throw new Error('expired');
  return payload;
}

export function storeLicense(key) {
  try { localStorage.setItem(KEY_STORE, String(key).trim()); } catch { /* ignore */ }
}
export function getStoredLicense() {
  try { return localStorage.getItem(KEY_STORE) || null; } catch { return null; }
}
export function clearStoredLicense() {
  try { localStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
}

/**
 * Re-verify whatever key is on disk. Returns the payload, or null when there
 * is no key / it no longer verifies. Safe to call on boot.
 */
export async function verifyStoredLicense() {
  const key = getStoredLicense();
  if (!key || !isLicensingConfigured()) return null;
  try { return await verifyLicenseKey(key); }
  catch { return null; }
}
