/**
 * googleAuth.js — sign in, sign up and connect with Google, from the app.
 *
 * ── The shape of it ────────────────────────────────────────────────────────
 * Android cannot host the OAuth redirect, so the round trip leaves the app:
 *
 *   1. POST /v1/auth/google/start { client: 'app' } → the consent URL.
 *   2. Open it in a Custom Tab. NOT a WebView — Google refuses to sign anybody
 *      in inside an embedded browser, and a WebView would also mean this app
 *      could read the password being typed into it, which is the reason they
 *      refuse.
 *   3. The gate's callback 302s to authno://auth/google?google=<handoff>.
 *   4. Android hands that deep link to us; we exchange the handoff for a key.
 *
 * The handoff is single-use and lives about a minute. It is what travels in
 * the URL so the thing that opens the app is not itself a credential.
 *
 * ── What it does NOT change ────────────────────────────────────────────────
 * Nothing here makes AuthNo need a network. This is another way to FETCH a
 * key, once, exactly like the password path in gateApi.js — the key that comes
 * back is the same signed thing, stored locally, verified offline at every
 * startup afterwards. Sign in with Google on the train; the app opens in a
 * tunnel for the rest of its life.
 */

import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { GATE_API, gateConfigured, GateError } from './gateApi';

/** The scheme registered in AndroidManifest.xml. Both halves must agree. */
export const APP_REDIRECT = 'authno://auth/google';

/** Whether the gate has Google configured. Cached — it cannot change without
 *  a Worker deploy, and the gate screen asks on every render. */
let cached = null;
export async function googleAvailable() {
  if (cached !== null) return cached;
  if (!gateConfigured()) { cached = false; return false; }
  try {
    const r = await fetch(`${GATE_API}/v1/health`);
    const d = await r.json();
    cached = !!d?.google;
  } catch {
    // No signal is not "Google is off" — but it is "do not offer a button that
    // needs the network", which is the same decision here.
    cached = false;
  }
  return cached;
}

async function post(path, body, token) {
  if (!gateConfigured()) throw new GateError('gate-unreachable');
  let resp;
  try {
    resp = await fetch(`${GATE_API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body ?? {}),
    });
  } catch { throw new GateError('gate-unreachable'); }
  let data = null;
  try { data = await resp.json(); } catch { /* non-JSON error body */ }
  if (!resp.ok) throw new GateError(data?.error || `http-${resp.status}`, resp.status);
  return data;
}

/**
 * Run a whole flow and resolve with what the gate handed back.
 *
 * Resolves to { accessKey, username, … } for a signup, { token } for a
 * sign-in, or { linked: true } for a connect. Rejects with a GateError whose
 * code is a reason the gate screen already knows how to phrase.
 *
 * `mode` is 'signin' | 'redeem' | 'link'. A link needs `accessKey`: the app
 * keeps no session, so its device key is the credential.
 */
export function googleFlow(mode, { code, username, token, accessKey } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let urlSub = null;
    let stateSub = null;

    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      // Remove both listeners before resolving. Capacitor's remove() is async
      // and a second deep link arriving mid-teardown would otherwise land in a
      // promise that has already settled.
      Promise.all([urlSub?.remove?.(), stateSub?.remove?.()]).catch(() => {});
      Browser.close().catch(() => {});   // no-op if it is already gone
      fn(value);
    };

    (async () => {
      try {
        // Listen BEFORE opening. A fast flow — an already-signed-in Google
        // account with consent granted — can bounce back before an await
        // scheduled after the open would have run.
        urlSub = await App.addListener('appUrlOpen', ({ url }) => {
          if (!url || !url.startsWith(APP_REDIRECT)) return;   // some other deep link
          let params;
          try { params = new URL(url).searchParams; }
          catch { return done(reject, new GateError('bad-token')); }

          const failed = params.get('google_error');
          if (failed) return done(reject, new GateError(failed));

          const handoff = params.get('google');
          if (!handoff) return done(reject, new GateError('bad-token'));

          post('/v1/auth/google/finish', { handoff })
            .then((d) => done(resolve, d.redeemed ? d.redeemed : d))
            .catch((e) => done(reject, e));
        });

        // Coming back to the app with no deep link at all means the tab was
        // dismissed. Without this the promise would hang forever and the
        // button would spin until the app was killed.
        stateSub = await App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive || settled) return;
          setTimeout(() => {
            if (!settled) done(reject, new GateError('cancelled'));
          }, 900);   // long enough for a deep link already in flight to win
        });

        const { url } = await post('/v1/auth/google/start',
          {
            mode, client: 'app',
            ...(code ? { code } : {}),
            ...(username ? { username } : {}),
            // Linking from the app authenticates with the device key it
            // already holds — there is no session here to send.
            ...(accessKey ? { accessKey } : {}),
          },
          token);
        await Browser.open({ url, presentationStyle: 'popover' });
      } catch (e) {
        done(reject, e instanceof GateError ? e : new GateError('gate-unreachable'));
      }
    })();
  });
}
