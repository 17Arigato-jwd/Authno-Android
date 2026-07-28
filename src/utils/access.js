/**
 * access.js — invite-gated access, verified entirely offline.
 *
 * AuthNo is invite-only before public release. The website links an invite
 * code to a pen name and mints an ECDSA P-256 signed ACCESS KEY whose payload
 * carries that username. This module verifies the key's signature against the
 * embedded public key and checks the typed username against the signed value —
 * so the gate never needs the network, on the first run or any run after.
 *
 *   AUTHNO-<b64url payload>.<b64url signature>
 *   payload = { t:'access', v, uid, u, gen, iat, te, q }
 *                                    ^username  ^trial-end
 *
 * Deliberate boundaries:
 *   - `t` must be 'access'. A paid LICENSE key (license.js, different keypair)
 *     must not open the gate, and vice versa.
 *   - Activation is permanent. Once an install is unlocked it stays unlocked;
 *     revoking an invite gates NEW installs, never someone's existing books.
 *     Nothing in this module can lock a user out of an .authbook file.
 *   - Failures are throttled and persisted, so quitting the app doesn't reset
 *     the counter. After MAX_ATTEMPTS the app exits — theatre plus friction;
 *     the signature is the actual security.
 *
 * Configure with REACT_APP_ACCESS_PUBKEY (base64 SPKI, P-256). Unset means
 * "gate not configured": isGateRequired() is false and the app opens normally,
 * which is what keeps current beta builds working until the flag is flipped.
 */

const STORE_KEY = 'authno_access_key';
const STORE_USER = 'authno_access_user';
const ATTEMPTS_KEY = 'authno_access_attempts';
const PREFIX = 'AUTHNO-';

/** Wrong tries before the app closes itself. */
export const MAX_ATTEMPTS = 5;

/**
 * Cooldown (ms) imposed AFTER the Nth failure, indexed by failure count —
 * index 0 is unused so COOLDOWNS[n] reads as "the wait after failure n".
 * First two mistakes cost nothing; typos are normal and these keys are long.
 */
const COOLDOWNS = [0, 0, 0, 30_000, 300_000];
/** After an exit-and-relaunch, the gate resumes here rather than resetting. */
const RELAUNCH_COOLDOWN = 900_000;

const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export function getAccessPubKeyB64() {
  return (process.env.REACT_APP_ACCESS_PUBKEY || '').trim();
}

/** True when this build ships a verification key — i.e. the gate can work. */
export function isAccessConfigured() {
  return getAccessPubKeyB64().length > 0;
}

/**
 * True when this build should actually gate. Requires BOTH a public key and
 * REACT_APP_REQUIRE_INVITE=true, so a keyed build can still ship un-gated
 * while the invite rollout is staged.
 */
export function isGateRequired() {
  return isAccessConfigured() && String(process.env.REACT_APP_REQUIRE_INVITE || '').toLowerCase() === 'true';
}

async function importPublicKey() {
  const raw = getAccessPubKeyB64();
  if (!raw) throw new Error('no-public-key');
  return crypto.subtle.importKey(
    'spki', b64urlToBytes(raw),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['verify']
  );
}

/** Normalize exactly as the server does, so comparisons can't disagree. */
export function normalizeUsername(input) {
  return String(input || '').trim().normalize('NFKC').toLowerCase();
}

/**
 * Verify an access key's signature. Resolves to the payload, or throws a
 * stable reason: 'malformed' | 'bad-signature' | 'wrong-key-type' |
 * 'no-public-key'. Does NOT check the username — verifyAccess() does that.
 */
export async function verifyAccessKey(input) {
  const key = String(input || '').trim();
  if (!key.startsWith(PREFIX)) throw new Error('malformed');
  const body = key.slice(PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot < 1) throw new Error('malformed');

  let payloadBytes, sigBytes, payload;
  try {
    payloadBytes = b64urlToBytes(body.slice(0, dot));
    sigBytes = b64urlToBytes(body.slice(dot + 1));
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch { throw new Error('malformed'); }

  const pub = await importPublicKey();
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sigBytes, payloadBytes);
  if (!ok) throw new Error('bad-signature');
  return normalizePayload(payload);
}

/**
 * Two key shapes verify, and the rest of the app should not have to know which
 * one it got.
 *
 *   v1  t:'access'  — handed out at redeem, before accounts existed. The
 *                     identity IS the key: uid, u, gen, iat, te (trial end).
 *   v2  t:'device'  — issued BY an account to one install. acc is the account,
 *                     did the device, and the grants are split: `access` never
 *                     expires so the app keeps opening offline forever, `ent`
 *                     carries the entitlement re-check deadline.
 *
 * v2 is mapped onto v1's field names rather than teaching every caller both.
 * It has no trial: a device key belongs to an account that is already a
 * member, so `te` is absent and trialDaysLeftFrom correctly reports none.
 *
 * This rejected every v2 key as 'wrong-key-type' until it was driven end to
 * end against a real gate — which is to say, until a real key was ever put
 * through it. The key-file tests pass a placeholder string that never reaches
 * this function, so they could not have caught it.
 */
function normalizePayload(payload) {
  if (payload?.t === 'access') return payload;
  if (payload?.t === 'device') {
    return {
      ...payload,
      uid: payload.uid ?? payload.acc,
      gen: payload.gen ?? payload.access?.gen ?? 0,
      iat: payload.iat ?? payload.access?.iat,
    };
  }
  throw new Error('wrong-key-type');
}

/**
 * The gate's actual question: does this key verify AND belong to this name?
 * Throws 'username-mismatch' when the key is genuine but the name is not the
 * one it was issued to.
 */
export async function verifyAccess(key, username) {
  const payload = await verifyAccessKey(key);
  if (normalizeUsername(payload.u) !== normalizeUsername(username)) throw new Error('username-mismatch');
  return payload;
}

// ── Persistence ─────────────────────────────────────────────────────────────

export function storeAccess(key, username) {
  try {
    localStorage.setItem(STORE_KEY, String(key).trim());
    localStorage.setItem(STORE_USER, normalizeUsername(username));
    localStorage.removeItem(ATTEMPTS_KEY);
  } catch { /* private-mode storage — the session still works, boot re-asks */ }
}

export function getStoredAccess() {
  try {
    return { key: localStorage.getItem(STORE_KEY), username: localStorage.getItem(STORE_USER) };
  } catch { return { key: null, username: null }; }
}

export function clearStoredAccess() {
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(STORE_USER);
  } catch { /* ignore */ }
}

/**
 * Re-verify whatever is on disk. Returns the payload, or null.
 *
 * Callers must treat null as "ask again", never as "destroy anything". A
 * corrupted or missing key means the gate re-appears; it never touches books.
 */
export async function verifyStoredAccess() {
  const { key, username } = getStoredAccess();
  if (!key || !username || !isAccessConfigured()) return null;
  try { return await verifyAccess(key, username); }
  catch { return null; }
}

// ── Attempt limiting ────────────────────────────────────────────────────────

function readAttempts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { count: 0, until: 0 };
    return { count: Number(raw.count) || 0, until: Number(raw.until) || 0 };
  } catch { return { count: 0, until: 0 }; }
}

function writeAttempts(state) {
  try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/** Current gate state: how many tries are left and whether a cooldown is on. */
export function getAttemptState() {
  const { count, until } = readAttempts();
  const now = Date.now();
  return {
    count,
    remaining: Math.max(0, MAX_ATTEMPTS - count),
    lockedUntil: until > now ? until : 0,
    lockedMs: until > now ? until - now : 0,
  };
}

/**
 * Record a failed attempt. Returns { count, remaining, lockedMs, exit } —
 * `exit` true means this was the last allowed try and the caller should close
 * the app (after showing the user why).
 */
export function recordFailure() {
  const { count } = readAttempts();
  const next = count + 1;
  const exit = next >= MAX_ATTEMPTS;
  // On the final failure, arm the relaunch cooldown so quitting and reopening
  // is slower than guessing again — the counter survives the restart.
  const cooldown = exit ? RELAUNCH_COOLDOWN : (COOLDOWNS[next] ?? 0);
  writeAttempts({ count: next, until: cooldown ? Date.now() + cooldown : 0 });
  return { count: next, remaining: Math.max(0, MAX_ATTEMPTS - next), lockedMs: cooldown, exit };
}

export function resetAttempts() {
  try { localStorage.removeItem(ATTEMPTS_KEY); } catch { /* ignore */ }
}

// ── Trial ───────────────────────────────────────────────────────────────────

/**
 * Trial end (epoch ms) from the signed payload, or null when the key predates
 * trials. Because `te` is inside the signature, reinstalling, clearing storage
 * or winding the clock forward cannot extend it — and the value is absolute,
 * so it also cannot be restarted.
 */
export function trialEndsFrom(payload) {
  const te = Number(payload?.te);
  return Number.isFinite(te) && te > 0 ? te : null;
}

export function trialDaysLeftFrom(payload) {
  const te = trialEndsFrom(payload);
  if (!te) return 0;
  return Math.max(0, Math.ceil((te - Date.now()) / 86400000));
}

/** Friendly, specific text for each stable failure reason. */
export function accessErrorText(reason) {
  const MAP = {
    'malformed': 'That doesn’t look like an access key. Paste the whole AUTHNO-… string from the website.',
    'bad-signature': 'That key doesn’t verify. Check for a missing character — keys are long, and every one of them counts.',
    'wrong-key-type': 'That’s a purchase licence, not an access key. The access key is the one you got when you redeemed your invite.',
    'username-mismatch': 'That key belongs to a different pen name.',
    'no-public-key': 'This build can’t check access keys. Reinstall from the official download page.',
  };
  return MAP[reason] || 'Something went wrong checking that key. Try again.';
}
