/**
 * gateApi.js — the only place in the app that talks to a server.
 *
 * ── What this does NOT change ──────────────────────────────────────────────
 * AuthNo stays offline-first. Signing in with a password does not make the
 * app depend on a network; it is a way to FETCH a key, once. The key that
 * comes back is the same signed device key a .authkey file carries, it is
 * stored locally, and every startup after this verifies it offline against
 * the embedded public key exactly as before. Sign in on the train, and the
 * app opens in a tunnel for the rest of its life.
 *
 * That is why there is no session token here and nothing that expires. A
 * session is a website idea. The app wants the key and then wants to forget
 * this file exists.
 *
 * ── When it isn't available ────────────────────────────────────────────────
 * REACT_APP_GATE_API unset, no signal, gate down — all the same answer:
 * 'gate-unreachable', and the gate offers the key file instead. The key file
 * is not a legacy path being tolerated; it is the supported way in when there
 * is no network, which for this app is a normal Tuesday.
 */

export const GATE_API = (process.env.REACT_APP_GATE_API || '').trim().replace(/\/$/, '');

export function gateConfigured() {
  return GATE_API.length > 0;
}

/** Stable reasons, so the gate can say something specific. */
export class GateError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function call(path, body, token) {
  if (!gateConfigured()) throw new GateError('gate-unreachable');
  let resp;
  try {
    resp = await fetch(`${GATE_API}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    // No signal, DNS failure, captive portal. Not a credential problem.
    throw new GateError('gate-unreachable');
  }
  let data = null;
  try { data = await resp.json(); } catch { /* non-JSON error body */ }
  if (!resp.ok) throw new GateError(data?.error || `http-${resp.status}`, resp.status);
  return data;
}

/**
 * Pen name + password → a signed device key, stored by the caller.
 *
 * Two requests, because they answer different questions: the first proves who
 * you are, the second asks the account to issue this device a key. The session
 * from the first is used once and then dropped on the floor — the app has no
 * use for it, and holding a bearer token it never checks would be a liability
 * with no upside.
 */
export async function fetchKeyWithPassword(username, password, platform = 'app') {
  const auth = await call('/v1/auth/password', { username, password });
  if (!auth?.token) throw new GateError('signin-failed');

  const issued = await call(
    '/v1/auth/keyfile/issue',
    { label: deviceLabel(), platform },
    auth.token
  );
  if (!issued?.accessKey) throw new GateError('issue-failed');

  return { accessKey: issued.accessKey, username: issued.username || auth?.account?.username };
}

/**
 * A session token → a signed device key.
 *
 * The second half of fetchKeyWithPassword, on its own. Google sign-in proves
 * who somebody is and hands back a session; this asks the account to issue
 * this device a key, and then the session is dropped on the floor for the same
 * reason it is there — the app has no use for a bearer token it never checks.
 */
export async function fetchKeyWithSession(token, platform = 'app') {
  const issued = await call('/v1/auth/keyfile/issue', { label: deviceLabel(), platform }, token);
  if (!issued?.accessKey) throw new GateError('issue-failed');
  return { accessKey: issued.accessKey, username: issued.username };
}

/**
 * An invite code → an account, and the key that opens this app.
 *
 * One request, not two. Redeeming already hands back a signed key, so there is
 * nothing to exchange afterwards; the session token it also returns is dropped
 * on the floor for the same reason fetchKeyWithPassword drops its own.
 *
 * The gate burns the code inside a transaction, so a failure here has cost the
 * caller nothing — the code is still good and can be typed again.
 */
export async function redeemCode({ code, username, email, password }, platform = 'app') {
  const data = await call('/v1/redeem', { code, username, email, password });
  if (!data?.accessKey) throw new GateError('redeem-failed');
  return { accessKey: data.accessKey, username: data.username || username };
}

/** Something recognisable in the account's device list. Never precise. */
function deviceLabel() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/Android/i.test(ua)) return 'AuthNo on Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'AuthNo on iOS';
  if (/Windows/i.test(ua)) return 'AuthNo on Windows';
  if (/Mac OS X/i.test(ua)) return 'AuthNo on macOS';
  if (/Linux/i.test(ua)) return 'AuthNo on Linux';
  return 'AuthNo';
}

/** Plain sentences for the gate's error line. */
export function gateErrorText(code) {
  const MAP = {
    'gate-unreachable':
      'Couldn’t reach AuthNo. Check your connection — or sign in with a key file, which needs no network at all.',
    'bad-credentials': 'That pen name and password don’t match. Check both.',
    'missing-credentials': 'Both a pen name and a password are needed.',
    'revoked': 'This membership has been revoked.',
    'rate-limited': 'Too many attempts from this connection. Wait a little and try again.',
    'verify-unavailable': 'Sign-in is temporarily broken on our end — not your password. Try again shortly.',
    'no-session': 'That sign-in expired before it finished. Try again.',
    'signin-failed': 'Sign-in didn’t complete. Try again.',
    // Redeeming. The code survives every one of these — the gate burns it
    // inside a transaction, so a refusal here has cost nothing.
    'invalid-code': 'That code isn’t one of ours. Check it and try again.',
    'code-already-used': 'That code has already been used.',
    'code-revoked': 'That code is no longer valid.',
    'username-taken': 'That pen name is taken. Try another.',
    'username-too-short': 'That pen name is too short.',
    'username-too-long': 'That pen name is too long.',
    'username-invalid': 'Pen names use letters, numbers and underscores.',
    'username-reserved': 'That pen name isn’t available.',
    'password-too-short': 'That password is too short.',
    'password-too-long': 'That password is too long.',
    'email-required': 'An email address is needed.',
    'turnstile-failed': 'That check didn’t pass. Try again.',
    'redeem-failed': 'That didn’t complete. Your code has not been used — try again.',
    'issue-failed': 'Signed in, but this device couldn’t be issued a key. Try again.',
    'gate-not-configured': 'AuthNo’s sign-in isn’t open yet.',
  };
  return MAP[code] || 'Something went wrong signing in. Try again, or use a key file.';
}
