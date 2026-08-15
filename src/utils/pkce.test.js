/**
 * PKCE — the proof that replaces a client secret on desktop.
 *
 * Every assertion here is about a property somebody could break while the flow
 * still appeared to work, because that is the failure mode of an auth exchange:
 * it succeeds against a cooperative provider and is worthless against anyone
 * else. A `plain` challenge, a reused verifier, a verifier drawn from
 * `Math.random`, an unchecked `state` — all four leave a working sign-in.
 */

import { webcrypto } from 'crypto';

// jsdom ships no WebCrypto, and everything here is built on it. Same shim
// keyfile.test.js uses, and for the same reason: pkce.js reaches for `crypto`
// inside its functions rather than at module scope, so installing it before
// the first call is enough.
if (!global.crypto?.subtle) global.crypto = webcrypto;

import {
  base64url, createVerifier, challengeFor, createState,
  buildAuthUrl, exchangeCode, GOOGLE_AUTH_URL,
} from './pkce';

describe('base64url', () => {
  /**
   * The `+/=` alphabet is what `btoa` produces and what RFC 7636 §4.2 forbids.
   * A padded challenge is rejected by the provider at the *exchange*, one step
   * after the consent screen has already been shown — so it looks like the
   * user's fault.
   */
  test('has no +, / or = in it', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = new Uint8Array(i);
      crypto.getRandomValues(bytes);
      const s = base64url(bytes);
      expect(s).not.toMatch(/[+/=]/);
    }
  });

  test('round-trips through the standard decoder', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    const restored = atob(base64url(bytes).replace(/-/g, '+').replace(/_/g, '/'));
    expect([...restored].map((c) => c.charCodeAt(0))).toEqual([...bytes]);
  });
});

describe('the verifier', () => {
  test('is inside the length the spec allows', () => {
    expect(createVerifier().length).toBeGreaterThanOrEqual(43);
    expect(createVerifier().length).toBeLessThanOrEqual(128);
    // Out-of-range requests are clamped rather than honoured — a 8-character
    // verifier is guessable and a 4000-character one is refused by the provider.
    expect(createVerifier(1).length).toBe(43);
    expect(createVerifier(9999).length).toBe(128);
  });

  test('uses only unreserved characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(createVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  /** The entire guarantee. A predictable verifier is no proof at all. */
  test('is never the same twice', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(createVerifier());
    expect(seen.size).toBe(500);
  });

  test('and neither is the state', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(createState());
    expect(seen.size).toBe(500);
  });
});

describe('the challenge', () => {
  /** The published S256 test vector from RFC 7636 appendix B. */
  test('matches the RFC test vector', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('is stable for one verifier and different for another', async () => {
    const v = createVerifier();
    expect(await challengeFor(v)).toBe(await challengeFor(v));
    expect(await challengeFor(v)).not.toBe(await challengeFor(createVerifier()));
  });

  /** Never the verifier itself — that is `plain`, which proves nothing. */
  test('is not the verifier', async () => {
    const v = createVerifier();
    expect(await challengeFor(v)).not.toBe(v);
  });
});

describe('the consent URL', () => {
  const base = {
    clientId: 'abc.apps.googleusercontent.com',
    redirect: 'com.aurorastudios.authno://oauth2/google',
    scopes: ['openid', 'email', 'profile'],
    challenge: 'CHALLENGE',
    state: 'STATE',
  };

  test('carries everything the exchange will be checked against', () => {
    const u = new URL(buildAuthUrl(base));
    expect(u.origin + u.pathname).toBe(GOOGLE_AUTH_URL);
    expect(u.searchParams.get('client_id')).toBe(base.clientId);
    expect(u.searchParams.get('redirect_uri')).toBe(base.redirect);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('code_challenge')).toBe('CHALLENGE');
    expect(u.searchParams.get('state')).toBe('STATE');
  });

  /** S256, always. Offering `plain` would make the proof a formality. */
  test('always asks for S256', () => {
    expect(new URL(buildAuthUrl(base)).searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('accepts scopes as an array or a string, and space-joins them', () => {
    expect(new URL(buildAuthUrl(base)).searchParams.get('scope')).toBe('openid email profile');
    expect(new URL(buildAuthUrl({ ...base, scopes: 'openid email' })).searchParams.get('scope'))
      .toBe('openid email');
  });

  test('refuses to build one without a client id', () => {
    expect(() => buildAuthUrl({ ...base, clientId: '' })).toThrow(/clientId/);
  });

  /**
   * Every value goes through URLSearchParams rather than string concatenation.
   * A scope or redirect carrying `&` would otherwise inject parameters into
   * the consent request.
   */
  test('escapes what it is given', () => {
    const u = new URL(buildAuthUrl({ ...base, state: 'a&client_id=evil' }));
    expect(u.searchParams.get('state')).toBe('a&client_id=evil');
    expect(u.searchParams.get('client_id')).toBe(base.clientId);
  });
});

describe('the exchange', () => {
  const base = {
    clientId: 'abc.apps.googleusercontent.com',
    code: 'CODE',
    verifier: 'VERIFIER',
    redirect: 'com.aurorastudios.authno://oauth2/google',
  };

  const respond = (status, body) => async (url, init) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    _url: url,
    _init: init,
  });

  test('posts the verifier and never a secret', async () => {
    let seen = null;
    await exchangeCode({
      ...base,
      fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ access_token: 't' }) }; },
    });
    const body = new URLSearchParams(seen.init.body);
    expect(body.get('code_verifier')).toBe('VERIFIER');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(base.redirect);
    // A desktop binary cannot hold one, so it must never claim to.
    expect(body.get('client_secret')).toBeNull();
    expect(seen.init.headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  test('hands back the token payload', async () => {
    const out = await exchangeCode({
      ...base,
      fetchImpl: respond(200, { access_token: 'ya29.x', expires_in: 3599, scope: 'drive.file' }),
    });
    expect(out.access_token).toBe('ya29.x');
    expect(out.expires_in).toBe(3599);
  });

  /**
   * The reason, not the status. An author reading "400" learns nothing;
   * `redirect_uri_mismatch` tells them exactly which console field is wrong.
   */
  test('surfaces the reason Google gives', async () => {
    await expect(exchangeCode({
      ...base,
      fetchImpl: respond(400, { error: 'redirect_uri_mismatch', error_description: 'Bad redirect URI' }),
    })).rejects.toThrow(/Bad redirect URI/);

    await expect(exchangeCode({
      ...base,
      fetchImpl: respond(400, { error: 'invalid_grant' }),
    })).rejects.toThrow(/invalid_grant/);
  });

  test('a non-JSON error body still produces a readable failure', async () => {
    await expect(exchangeCode({
      ...base,
      fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }),
    })).rejects.toThrow(/http-502/);
  });

  test('a 200 with no token is a failure, not a success', async () => {
    await expect(exchangeCode({ ...base, fetchImpl: respond(200, { scope: 'drive.file' }) }))
      .rejects.toThrow(/no access token/);
  });

  test('a network failure says so rather than reading as a refusal', async () => {
    await expect(exchangeCode({
      ...base,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    })).rejects.toThrow(/could not reach Google/);
  });
});
