/**
 * googleAuth.js — sign in, sign up and connect with Google, from the app.
 *
 * ── The shape of it ────────────────────────────────────────────────────────
 * Neither Android nor a desktop window can host the OAuth redirect, so the
 * round trip leaves the app on both:
 *
 *   1. POST /v1/auth/google/start { client: 'app' } → the consent URL.
 *   2. Open it OUTSIDE the app. A Custom Tab on Android, the real browser on
 *      desktop. NOT a WebView or a BrowserWindow — Google refuses to sign
 *      anybody in inside an embedded browser, and an embedded browser would
 *      also mean this app could read the password being typed into it, which
 *      is the reason they refuse.
 *   3. The gate's callback 302s to authno://auth/google?google=<handoff>.
 *   4. The OS hands that deep link back to us; we exchange the handoff.
 *
 * Step 3 is why desktop needed no Worker change: `client: 'app'` already
 * selects that redirect, and it has been serving Android in production since
 * sign-in shipped. Desktop only had to claim the scheme — see deepLink.js and
 * the protocols block in package.json.
 *
 * The handoff is single-use and lives about a minute. It is what travels in
 * the URL so the thing that opens the app is not itself a credential. That
 * matters more on desktop than on Android: any local program can also register
 * `authno://`, so the URL has to be worth as little as possible to whoever
 * else might catch it.
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
import { isElectron } from './platform';

/** The scheme registered in AndroidManifest.xml. Both halves must agree. */
export const APP_REDIRECT = 'authno://auth/google';

/**
 * Whether the gate has Google configured.
 *
 * A successful answer is cached: it cannot change without a Worker deploy, and
 * the gate screen asks on every render.
 *
 * A FAILED one is not. "No signal" and "Google is off" produce the same button
 * — hidden — but they are not the same fact, and caching the failure means an
 * app opened in a tunnel never offers Google again for the rest of its run,
 * even once the train comes out the other side. On a device that is offline
 * more often than not, that is the difference between a feature that exists
 * and one that does not.
 */
let cached = null;
export async function googleAvailable() {
  if (cached !== null) return cached;
  if (!gateConfigured()) { cached = false; return false; }
  try {
    const r = await fetch(`${GATE_API}/v1/health`);
    const d = await r.json();
    cached = !!d?.google;
    return cached;
  } catch {
    return false;   // not cached — ask again next time
  }
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
 * Listen for the deep link coming home, whichever OS is delivering it.
 *
 * Android: Capacitor's appUrlOpen. Desktop: an IPC channel fed by main.js,
 * plus one question for a URL that arrived before this listener existed —
 * clicking "Open AuthNo?" with the app closed LAUNCHES it, so on the cold path
 * the URL is always earlier than anything the renderer can register.
 *
 * Returns an unsubscribe. Both sides must have one: a second sign-in attempt
 * stacking a second listener would settle the first attempt's promise with the
 * second attempt's handoff.
 */
async function onDeepLink(handler) {
  if (isElectron() && window.electron?.onDeepLink) {
    const off = window.electron.onDeepLink(handler);
    try {
      const pending = await window.electron.claimPendingDeepLink?.();
      if (pending) handler(pending);
    } catch { /* nothing was waiting */ }
    return off;
  }
  const sub = await App.addListener('appUrlOpen', ({ url }) => handler(url));
  return () => { sub?.remove?.(); };
}

/** The consent screen, in a browser this app cannot see into. */
async function openConsent(url) {
  if (isElectron() && window.electron?.openExternal) {
    const r = await window.electron.openExternal(url);
    // main.js refuses anything that is not https. A refusal here means the
    // gate handed back something unexpected, which is worth failing on rather
    // than leaving a button spinning at a browser that never opened.
    if (r && r.ok === false) throw new GateError('gate-unreachable');
    return;
  }
  await Browser.open({ url, presentationStyle: 'popover' });
}

/**
 * Whether the OS will actually deliver `authno://` to us.
 *
 * False on an AppImage nobody has integrated — those are not installed, so
 * nothing writes the .desktop entry that claims the scheme — and false when
 * another program holds it. The caller offers a manual path instead of opening
 * a browser and waiting for a link that is never coming.
 */
export async function deepLinkReady() {
  if (!isElectron()) return true;              // Android registers in its manifest
  if (!window.electron?.isDeepLinkRegistered) return false;
  try { return !!(await window.electron.isDeepLinkRegistered()); } catch { return false; }
}

/**
 * Finish a flow from a URL the writer pasted in by hand.
 *
 * The fallback for the case above. It is the same exchange the deep link
 * performs — the URL is not a credential, the handoff inside it is, and that
 * handoff is refused if it is stale or already spent.
 */
export async function finishFromPastedUrl(raw) {
  let params;
  try { params = new URL(String(raw).trim()).searchParams; }
  catch { throw new GateError('bad-token'); }
  const failed = params.get('google_error');
  if (failed) throw new GateError(failed);
  const handoff = params.get('google');
  if (!handoff) throw new GateError('bad-token');
  const d = await post('/v1/auth/google/finish', { handoff });
  return d.redeemed ? d.redeemed : d;
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
    let urlSub = null;     // an unsubscribe function on both platforms now
    let stateSub = null;   // Android only
    let deadline = null;   // desktop only

    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      // Drop both listeners before resolving. Capacitor's remove() is async
      // and a second deep link arriving mid-teardown would otherwise land in a
      // promise that has already settled.
      try { urlSub?.(); } catch { /* already gone */ }
      Promise.resolve(stateSub?.remove?.()).catch(() => {});
      clearTimeout(deadline);
      if (!isElectron()) Browser.close().catch(() => {});  // no tab of ours on desktop
      fn(value);
    };

    (async () => {
      try {
        // Listen BEFORE opening. A fast flow — an already-signed-in Google
        // account with consent granted — can bounce back before an await
        // scheduled after the open would have run. On desktop the same await
        // would also miss a URL that launched the app in the first place.
        urlSub = await onDeepLink((url) => {
          if (!url || !url.toLowerCase().startsWith(APP_REDIRECT)) return;  // another deep link
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

        if (isElectron()) {
          // Desktop has no equivalent of "the app came back to the
          // foreground": the window never left it, and the browser is another
          // program entirely. So the only way to know a flow was abandoned is
          // that it stopped happening — and the wait has to outlast a real
          // person picking an account and reading a consent screen. Ten
          // minutes matches the gate's own state TTL, past which the flow
          // cannot succeed anyway.
          deadline = setTimeout(() => done(reject, new GateError('cancelled')), 10 * 60 * 1000);
        } else {
          // Coming back to the app with no deep link at all means the tab was
          // dismissed. Without this the promise would hang forever and the
          // button would spin until the app was killed.
          stateSub = await App.addListener('appStateChange', ({ isActive }) => {
            if (!isActive || settled) return;
            setTimeout(() => {
              if (!settled) done(reject, new GateError('cancelled'));
            }, 900);   // long enough for a deep link already in flight to win
          });
        }

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
        await openConsent(url);
      } catch (e) {
        done(reject, e instanceof GateError ? e : new GateError('gate-unreachable'));
      }
    })();
  });
}
