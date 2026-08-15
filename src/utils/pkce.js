/**
 * pkce.js — the desktop half of "sign in with Google", without a client secret.
 *
 * Android gets Credential Manager and Play Services, which handle consent,
 * token exchange and silent refresh with nothing but a package name and a
 * signing certificate. A laptop has none of that, which is why the two calls
 * that used it were marked Android-only and told to go away.
 *
 * They did not have to be. What Play Services does *for* you on a phone is
 * exactly what RFC 7636 specifies for every other platform: an installed app
 * that cannot keep a secret proves it started the flow by keeping a random
 * value to itself and publishing only its hash. Google accepts this for
 * "Desktop app" and "iOS/Android" client types, and the redirect it accepts
 * alongside it is the reverse-DNS custom scheme the app already claims.
 *
 * So the desktop path is: mint a verifier, send its S256 challenge to the
 * consent screen, wait for the redirect to come home on
 * `com.aurorastudios.authno://`, and trade the code plus the original verifier
 * for tokens. No secret is embedded anywhere, which is the point — a secret
 * shipped inside a desktop binary is not a secret.
 *
 * Pure and dependency-free apart from WebCrypto, so every piece is testable
 * without a browser, a network or a Google account.
 */

/** RFC 7636 §4.1: 43–128 characters from the unreserved set. */
const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** base64url, no padding — what §4.2 requires and what `btoa` does not give. */
export function base64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A fresh code verifier.
 *
 * 96 random bytes mapped into the unreserved alphabet — comfortably inside the
 * 43–128 range and drawn from the CSPRNG, because the whole guarantee is that
 * nobody who intercepts the redirect can guess it.
 */
export function createVerifier(len = 96) {
  const n = Math.min(128, Math.max(43, len));
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) out += VERIFIER_CHARS[bytes[i] % VERIFIER_CHARS.length];
  return out;
}

/** The S256 challenge for a verifier. `plain` is not offered; it is not a proof. */
export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(verifier)));
  return base64url(new Uint8Array(digest));
}

/** An opaque value echoed back by the provider, so a stray redirect is ignored. */
export function createState() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return base64url(b);
}

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * The consent URL for an installed-app PKCE flow.
 *
 * `prompt=consent` is deliberately NOT set by default. Forcing the consent
 * screen on every call is what makes an integration feel broken to somebody
 * who already granted it; a caller that genuinely needs a refresh token can
 * ask for it.
 */
export function buildAuthUrl({
  clientId, redirect, scopes, challenge, state,
  authUrl = GOOGLE_AUTH_URL, extra = {},
}) {
  if (!clientId) throw new Error('oauth needs a clientId');
  const q = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: String(redirect),
    response_type: 'code',
    scope: (Array.isArray(scopes) ? scopes : String(scopes || '').split(/\s+/)).filter(Boolean).join(' '),
    code_challenge: String(challenge),
    code_challenge_method: 'S256',
    state: String(state),
    ...extra,
  });
  return `${authUrl}?${q}`;
}

/**
 * Trade an authorization code for tokens.
 *
 * No client secret: a public client proves itself with the verifier instead,
 * and Google's token endpoint answers cross-origin for exactly this case —
 * which is what makes the exchange possible from a renderer at all.
 *
 * The error path matters more than the happy one. Google answers a failed
 * exchange with 400 and a JSON body naming the reason (`invalid_grant`,
 * `redirect_uri_mismatch`), and an extension author reading "400" learns
 * nothing. The reason is lifted out and thrown.
 */
export async function exchangeCode({
  clientId, code, verifier, redirect, tokenUrl = GOOGLE_TOKEN_URL, fetchImpl,
}) {
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('no fetch available to exchange the code');

  const body = new URLSearchParams({
    client_id: String(clientId),
    code: String(code),
    code_verifier: String(verifier),
    grant_type: 'authorization_code',
    redirect_uri: String(redirect),
  });

  let resp;
  try {
    resp = await doFetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (e) {
    throw new Error(`could not reach Google to exchange the code: ${e?.message ?? e}`);
  }

  let data = null;
  try { data = await resp.json(); } catch { /* an error body that is not JSON */ }

  if (!resp.ok) {
    const reason = data?.error_description || data?.error || `http-${resp.status}`;
    throw new Error(`Google refused the token exchange: ${reason}`);
  }
  if (!data?.access_token) throw new Error('Google returned no access token');
  return data;
}
