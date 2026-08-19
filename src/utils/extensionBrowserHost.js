/**
 * extensionBrowserHost.js — opening a browser, and coming back from one.
 *
 * Extracted from the v1 dispatch switch because there are now two runners and
 * these are the calls where a second copy would be most expensive. The
 * `oauthRoundTrip` note in extensionSandbox.js says why in full: the redirect
 * check is load-bearing, and an extension that could name any prefix could ask
 * to be woken by `authno://auth/google` — the app's own sign-in coming home —
 * and read the handoff that trades for an account. One copy of that check.
 *
 * The rest is platform difference, which is the other thing worth having in
 * one place: three of these five behave the same everywhere and two cannot,
 * and an extension author deserves to be told which of those they hit rather
 * than handed a raw Capacitor "not implemented".
 */

import { isAndroid } from './platform';
import { OAUTH_SCHEME } from './deepLinkBus';

/**
 * The portable OAuth round trip: open a URL, wait for the redirect to come
 * home, hand back its parameters.
 *
 * Exported because there are two extension surfaces and only one of them had
 * this. The background half reaches it through `host.oauth`; a `ui-file` page
 * talks to an older postMessage bridge that proxied `openBrowser` and stopped
 * there, so an extension wanting to authorise from its settings page had to
 * hand the request to its background half first.
 *
 * Shared as a function rather than copied into the second bridge, because the
 * redirect check below is the load-bearing part and a second copy of a
 * security check is a second chance to write it slightly differently. An
 * extension that could name any prefix could ask to be woken by
 * `authno://auth/google` — the app's own sign-in coming home — and read the
 * handoff that trades for an account.
 *
 * @param opts    {{ authUrl: string, redirect: string }} from the extension
 * @param open    how this surface opens a browser; both end at the same place
 */
export async function oauthRoundTrip(opts, open) {
  const authUrl = String(opts?.authUrl ?? '');
  const redirect = String(opts?.redirect ?? '');
  if (!/^https:\/\//i.test(authUrl)) throw new Error('oauth needs an https authUrl');
  if (!redirect.toLowerCase().startsWith(OAUTH_SCHEME)) {
    throw new Error(`oauth redirect must start with ${OAUTH_SCHEME}`);
  }
  const { awaitDeepLink } = await import('./deepLinkBus');
  // Listen before opening. A provider that has already granted consent can
  // bounce back before an await scheduled after the open would have run.
  const landing = awaitDeepLink(redirect, { timeoutMs: 5 * 60 * 1000 });
  await open(authUrl);
  return landing;
}

/**
 * Sign in to Google from a desktop or web build, with PKCE.
 *
 * Reuses the same browser round trip `oauth` does — including its refusal to
 * accept a redirect on the app's own sign-in scheme — so there is one place
 * that opens a browser and one place that decides which redirects are ours.
 *
 * `state` is generated and checked. Without it, any redirect landing on the
 * app's scheme while a flow is open would be taken as this flow's answer.
 */
export async function desktopGoogleAuth({ clientId, scopes, what }) {
  if (!clientId) {
    throw new Error(
      `${what} needs a clientId on this platform. Android derives one from the `
      + 'package name and signing certificate; a desktop build has neither, so '
      + 'create an OAuth "Desktop app" client and pass its id. No client secret '
      + 'is needed — the flow uses PKCE.',
    );
  }

  const { createVerifier, challengeFor, createState, buildAuthUrl, exchangeCode } =
    await import('./pkce');

  const verifier = createVerifier();
  const state = createState();
  const redirect = `${OAUTH_SCHEME}oauth2/google`;

  const authUrl = buildAuthUrl({
    clientId,
    redirect,
    scopes,
    challenge: await challengeFor(verifier),
    state,
  });

  const landing = await oauthRoundTrip({ authUrl, redirect }, (url) => openBrowser(url));

  // A provider refusal is an answer, and it arrives in the query string rather
  // than as a rejection. Saying "access_denied" beats timing out.
  if (landing?.error) throw new Error(`Google refused: ${landing.error}`);
  if (landing?.state !== state) throw new Error('the redirect did not match this sign-in (state mismatch)');
  if (!landing?.code) throw new Error('Google sent no authorization code back');

  return exchangeCode({ clientId, code: landing.code, verifier, redirect });
}

/**
 * Open an https URL in a browser this app cannot see into.
 *
 * Three implementations, one meaning. On Android it is a Custom Tab —
 * deliberately not @capacitor/browser, which hardcodes com.android.chrome and
 * hangs silently when Chrome is not the default. On desktop it goes through
 * the preload bridge to the OS browser: `window.open` in Electron makes a
 * second BrowserWindow with no address bar, where Google refuses to serve a
 * consent screen at all (`disallowed_useragent`) and where a
 * `com.aurorastudios.authno://` redirect can never reach the app, so `oauth`
 * would wait out its whole five-minute timeout.
 */
export async function openBrowser(url) {
  const target = String(url ?? '');
  if (!/^https:\/\//i.test(target)) throw new Error('openBrowser needs an https URL');

  if (isAndroid()) {
    const { registerPlugin } = await import('@capacitor/core');
    return registerPlugin('OAuth').openAuthUrl({ url: target });
  }
  if (typeof window !== 'undefined' && window.electron?.openExternal) {
    const r = await window.electron.openExternal(target);
    if (r && r.ok === false) throw new Error(`could not open a browser: ${r.error}`);
    return null;
  }
  window.open(target, '_blank', 'noopener,noreferrer');
  return null;
}

/** Close the Custom Tab. A real browser tab elsewhere is not ours to close. */
export async function closeBrowser() {
  if (!isAndroid()) return null;
  const { registerPlugin } = await import('@capacitor/core');
  return registerPlugin('OAuth').closeAuthBrowser().catch(() => {});
}

/** What an extension actually calls. The check lives in oauthRoundTrip. */
export async function oauth(opts) {
  return oauthRoundTrip(opts, (url) => openBrowser(url));
}

export async function googleSignIn(opts) {
  const o = opts && typeof opts === 'object' ? opts : { clientId: opts };
  if (isAndroid()) {
    const { registerPlugin } = await import('@capacitor/core');
    return registerPlugin('GoogleSignIn').signIn(
      o.clientId ? { webClientId: o.clientId } : {},
    );
  }
  return desktopGoogleAuth({
    clientId: o.clientId,
    scopes: o.scopes ?? ['openid', 'email', 'profile'],
    what: 'googleSignIn',
  });
}

export async function requestDriveToken(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (isAndroid()) {
    // Identity.authorize() derives the caller from the package name and
    // signing certificate, and takes no client id at all.
    const { registerPlugin } = await import('@capacitor/core');
    return registerPlugin('GoogleDrive').requestDriveToken();
  }
  return desktopGoogleAuth({
    clientId: o.clientId,
    // drive.file rather than drive: the narrow one, which grants access only
    // to files this app created or the user explicitly opened.
    scopes: o.scopes ?? ['https://www.googleapis.com/auth/drive.file'],
    what: 'requestDriveToken',
  });
}

/**
 * End the native Google session, so the next authorisation asks which account.
 *
 * Throws `no-native-signout` when there is nothing to end, and that case is
 * the common one rather than an edge: **GoogleDrivePlugin.java has no signOut
 * method.** Cloud Backup v1 called `plugin.signOut()` and then
 * `plugin.revoke()` inside a try/catch, with a comment calling it "essential
 * for account switching" — neither method has ever existed, so the catch
 * swallowed a TypeError every time and the account never switched. Nobody
 * noticed, because a disconnect that clears local credentials looks like it
 * worked right up until you reconnect and land on the same account.
 *
 * Reporting it is the fix available from JavaScript. The Java side is where
 * the rest of it goes.
 */
export async function signOut() {
  if (!isAndroid()) throw new Error('no-native-signout');
  const { registerPlugin } = await import('@capacitor/core');
  // No `typeof plugin.signOut === 'function'` guard: registerPlugin returns a
  // Proxy that answers EVERY property with a callable, which is the same
  // property that made `await plugin` hang forever until getPlugin was fixed.
  // The only way to learn whether a method exists is to call it.
  try {
    return await registerPlugin('GoogleDrive').signOut();
  } catch (e) {
    const why = String(e?.message ?? e);
    if (/not implemented|unimplemented|is not a function/i.test(why)) {
      throw new Error('no-native-signout');
    }
    throw e;
  }
}
