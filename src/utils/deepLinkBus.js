/**
 * deepLinkBus.js — one place that knows how a deep link reaches this app.
 *
 * Two platforms deliver it two ways and neither is the other's:
 *
 *   Android   Capacitor's `appUrlOpen`, from the intent filters in the manifest.
 *   Desktop   an IPC channel fed by main.js, which found the URL in argv (or
 *             was handed it by macOS), plus one question for a URL that arrived
 *             before anything was listening — clicking "Open AuthNo?" with the
 *             app closed LAUNCHES it, so on the cold path the link is always
 *             earlier than any listener the renderer can mount.
 *
 * This existed twice before an extension needed it too: once inside
 * googleAuth.js and once about to be copied into the sandbox. The second copy
 * is what this file prevents — a bus with two implementations is a bus where
 * one of them quietly stops being maintained.
 *
 * ── Schemes ──────────────────────────────────────────────────────────────────
 *
 * `authno://` is the app's own (sign-in comes home on `authno://auth/google`).
 * `com.aurorastudios.authno://` is the reverse-DNS one Google and other
 * providers accept as a native redirect target; Android has registered
 * `oauth2/gdrive`, `oauth2/dropbox` and `oauth2/onedrive` on it since Drive
 * shipped, and desktop now claims the same scheme so a redirect written for
 * one platform lands on the other.
 */

import { isElectron } from './platform';

export const APP_SCHEME = 'authno://';
export const OAUTH_SCHEME = 'com.aurorastudios.authno://';

/**
 * Listen for deep links until you stop.
 *
 * @param {(url: string) => void} handler
 * @returns {Promise<() => void>} unsubscribe
 *
 * Returning an unsubscribe from BOTH branches is not tidiness. Every caller
 * here is one attempt at something — a sign-in, an extension's authorisation —
 * and a second attempt stacking a second listener would settle the first
 * attempt's promise with the second attempt's result.
 */
export async function onDeepLink(handler) {
  if (isElectron() && window.electron?.onDeepLink) {
    const off = window.electron.onDeepLink(handler);
    try {
      // Anything that arrived before this listener existed. Claimed once, and
      // the main process only hands it over while it is fresh enough to still
      // be worth acting on.
      const pending = await window.electron.claimPendingDeepLink?.();
      if (pending) handler(pending);
    } catch { /* nothing was waiting */ }
    return off;
  }

  try {
    const { App } = await import('@capacitor/app');
    const sub = await App.addListener('appUrlOpen', ({ url }) => handler(url));
    return () => { sub?.remove?.(); };
  } catch {
    // No Capacitor and no Electron — a plain web build, where nothing can
    // deliver one. Callers time out rather than waiting forever.
    return () => {};
  }
}

/**
 * Wait for one deep link whose URL starts with `prefix`.
 *
 * Resolves with its query parameters as a plain object, because that is what
 * every caller wants and `URLSearchParams` does not survive a postMessage.
 *
 * Rejects on timeout rather than hanging: a writer who closed the browser tab
 * would otherwise leave a promise, and whatever is spinning on it, alive for
 * the rest of the session.
 */
export function awaitDeepLink(prefix, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let off = null;
    let timer = null;

    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { off?.(); } catch { /* already gone */ }
      fn(value);
    };

    timer = setTimeout(() => done(reject, new Error('deep-link-timeout')), timeoutMs);

    onDeepLink((url) => {
      if (typeof url !== 'string') return;
      if (!url.toLowerCase().startsWith(String(prefix).toLowerCase())) return;  // not this flow's
      let params;
      try { params = new URL(url).searchParams; }
      catch { return done(reject, new Error('deep-link-malformed')); }
      done(resolve, Object.fromEntries(params.entries()));
    }).then((fn) => {
      off = fn;
      // The listener may have fired synchronously on the pending URL above, in
      // which case this attaches an unsubscribe to a flow already finished.
      if (settled) { try { fn(); } catch { /* already gone */ } }
    }).catch(() => done(reject, new Error('deep-link-unavailable')));
  });
}
