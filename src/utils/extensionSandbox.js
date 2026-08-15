/**
 * extensionSandbox.js — where extension code actually runs.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * Two halves, both open.
 *
 * The background half — `activate()` — was `import()`ed straight into the app's
 * own context. No frame, no boundary. An extension could read the access key
 * out of localStorage, reach into any module the app had loaded, and call any
 * Capacitor plugin, whatever its manifest said it wanted.
 *
 * The UI half looked sandboxed and was not. Its iframe carried
 * `sandbox="allow-scripts allow-same-origin"`, and those two flags together are
 * not a weaker sandbox — they are none at all. `srcdoc` content inherits the
 * embedder's origin, so `allow-same-origin` handed extension code the app's own
 * origin: `parent.localStorage` was one property access away, and the careful
 * postMessage bridge underneath was something extension code could step around
 * without trying.
 *
 * ── What runs now ────────────────────────────────────────────────────────────
 *
 * `sandbox="allow-scripts"`, and nothing else. The frame gets an opaque origin,
 * which means:
 *
 *   - `parent.anything` throws. Not "is undefined" — throws, cross-origin.
 *   - The frame has no localStorage, no cookies, no IndexedDB of its own.
 *   - postMessage is the only way out, so the host API is the whole API.
 *
 * That last line is the point. Every capability an extension has is now
 * something this file chose to answer, which makes the list of them readable in
 * one place (see `dispatch`) rather than being "everything the app can do".
 *
 * ── Why this also fixes desktop ──────────────────────────────────────────────
 *
 * Extensions used to be fetched from `https://localhost/extensions/<id>/`,
 * a URL only Android's MainActivity serves. That is the entire reason
 * activation was skipped off Android: nothing served it, and the import hung
 * rather than failing.
 *
 * A sandboxed frame has no server either, so the files are read through
 * Capacitor's Filesystem — which has a real IndexedDB-backed implementation on
 * web and Electron — and linked into blob URLs inside the frame. Blob URLs need
 * no origin and no server, so the same path works on a phone, a laptop and in a
 * test. See moduleGraph.js for the ordering, which is the part with the edges.
 *
 * ── What still is not the same on desktop ────────────────────────────────────
 *
 * Loading, storage, navigation, hooks, the library, the export formats and now
 * `oauth` all are. Two calls are not: googleSignIn and requestDriveToken are
 * Play Services APIs whose whole value is what does not exist off Android — no
 * client id, no redirect, no browser, and silent refresh. They cannot be
 * ported, so they throw with a reason and point at `oauth`, which does the same
 * round trip the ordinary way and works on both.
 */

import { registerHook } from './sessionHooks';
import { logError } from './ErrorLogger';
import { isAndroid } from './platform';
import { toast as _toast } from '../DesignSystem';
import { APP_VERSION } from '../version';
import { planModuleGraph, rewriteSpecifiers } from './moduleGraph';
import { sandboxDocument, createHostRouter, toSendable, FRAME_SANDBOX } from './sandboxProtocol';
import { OAUTH_SCHEME } from './deepLinkBus';

// Re-exported so callers and tests have one import for the sandbox. The
// protocol lives in its own file because it imports nothing, which is what
// lets a browser run the real thing — see the header there.
export { BOOTSTRAP, sandboxDocument, FRAME_SANDBOX } from './sandboxProtocol';

const EXTENSIONS_DIR = 'AuthNo/extensions';

/** Long enough for a cold IndexedDB read on a slow device, short enough to notice. */
const ACTIVATE_TIMEOUT_MS = 15000;

// ── Reading an extension off disk ────────────────────────────────────────────

/**
 * Every .js file under an extension's directory, as { relPath: source }.
 *
 * Recursive because extensions put helpers in `lib/`. Non-JS files are skipped:
 * the sandbox links modules, and handing it a 2 MB icon to turn into a blob
 * would cost memory for something nothing can import.
 */
export async function readExtensionTree(extId, { maxFiles = 200 } = {}) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const out = {};

  const walk = async (relDir) => {
    if (Object.keys(out).length >= maxFiles) return;
    let entries = [];
    try {
      const r = await Filesystem.readdir({
        path: `${EXTENSIONS_DIR}/${extId}${relDir ? `/${relDir}` : ''}`,
        directory: Directory.Data,
      });
      entries = r.files ?? [];
    } catch {
      return; // a directory that cannot be listed contributes nothing
    }

    for (const e of entries) {
      // Capacitor 3 returns string[], 4+ returns FileInfo[]. `type` is not
      // reliable across versions, so a failed read is what identifies a
      // directory rather than a field that might not be there.
      const name = typeof e === 'string' ? e : (e?.name ?? '');
      if (!name || name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${name}` : name;
      const type = typeof e === 'string' ? null : e?.type;

      if (type === 'directory') { await walk(rel); continue; }
      if (!name.endsWith('.js')) {
        // Unknown type and no .js suffix — it may be a directory. Trying to
        // list it is cheap and is the only way to be sure.
        if (!type) await walk(rel);
        continue;
      }

      try {
        const r = await Filesystem.readFile({
          path: `${EXTENSIONS_DIR}/${extId}/${rel}`,
          directory: Directory.Data,
          encoding: 'utf8',
        });
        if (typeof r?.data === 'string') out[rel] = r.data;
      } catch { /* a file that will not read is a missing import, reported later */ }
    }
  };

  await walk('');
  return out;
}

// ── The document the sandbox runs ────────────────────────────────────────────



// ── Host side ────────────────────────────────────────────────────────────────

/** extId → { frame, teardown } */
const _running = new Map();

function extStorage(extId) {
  const ns = `__ext_kv_${extId}__`;
  return {
    get: (k) => { try { return localStorage.getItem(ns + k); } catch { return null; } },
    set: (k, v) => {
      try {
        if (v === null || v === undefined) localStorage.removeItem(ns + k);
        else localStorage.setItem(ns + k, String(v));
      } catch { /* quota; extension storage is best-effort */ }
    },
    keys: () => {
      try {
        return Object.keys(localStorage).filter((k) => k.startsWith(ns)).map((k) => k.slice(ns.length));
      } catch { return []; }
    },
  };
}

/**
 * Everything an extension is allowed to ask for.
 *
 * The whole security model reduces to this switch. Anything not named here is
 * refused by default, which is the property the old runtime could not have: it
 * handed over the app's context and hoped.
 */
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

  const landing = await oauthRoundTrip({ authUrl, redirect }, (url) => dispatch('openBrowser', [url], {}));

  // A provider refusal is an answer, and it arrives in the query string rather
  // than as a rejection. Saying "access_denied" beats timing out.
  if (landing?.error) throw new Error(`Google refused: ${landing.error}`);
  if (landing?.state !== state) throw new Error('the redirect did not match this sign-in (state mismatch)');
  if (!landing?.code) throw new Error('Google sent no authorization code back');

  return exchangeCode({ clientId, code: landing.code, verifier, redirect });
}

async function dispatch(method, args, ctx) {
  const { extId, manifest, handlers } = ctx;
  const store = extStorage(extId);

  switch (method) {
    case 'storage.get': return store.get(String(args[0]));
    case 'storage.set': return store.set(String(args[0]), args[1]);
    case 'storage.keys': return store.keys();

    case 'toast': return _toast(String(args[0] ?? ''), args[1] ?? {});
    case 'navigate': return handlers.navigate?.(manifest, args[0], args[1] ?? null);

    // ── The three that are not the same everywhere ──────────────────────────
    //
    // Everything above this line behaves identically on a phone and a laptop.
    // These do not, because they are native plugins, and an extension that
    // calls one deserves to be told which of those it is rather than handed a
    // raw Capacitor "not implemented" string it cannot act on.

    case 'openBrowser': {
      const url = String(args[0] ?? '');
      if (!/^https:\/\//i.test(url)) throw new Error('openBrowser needs an https URL');
      if (isAndroid()) {
        // Custom Tabs. Deliberately not @capacitor/browser, which hardcodes
        // com.android.chrome and hangs silently when Chrome is not default.
        const { registerPlugin } = await import('@capacitor/core');
        return registerPlugin('OAuth').openAuthUrl({ url });
      }
      // Desktop: through the preload bridge, which asks the main process to
      // hand the URL to the OS browser.
      //
      // This used to be the window.open below, and the comment beside it said
      // "the real browser", which is not what window.open does in Electron.
      // Measured: it creates a second BrowserWindow inside AuthNo. So the
      // consent screen opened in an app window with no address bar, where
      // Google refuses to serve it at all (`disallowed_useragent`), and where
      // a `com.aurorastudios.authno://` redirect could never reach the app —
      // leaving `oauth` below waiting out its full five-minute timeout. The
      // whole point of the capability is the round trip, and the round trip
      // could not close.
      if (typeof window !== 'undefined' && window.electron?.openExternal) {
        const r = await window.electron.openExternal(url);
        if (r && r.ok === false) throw new Error(`could not open a browser: ${r.error}`);
        return null;
      }
      // Plain web: a tab is a tab.
      window.open(url, '_blank', 'noopener,noreferrer');
      return null;
    }

    case 'closeBrowser': {
      if (!isAndroid()) return null; // a real browser tab is not ours to close
      const { registerPlugin } = await import('@capacitor/core');
      return registerPlugin('OAuth').closeAuthBrowser().catch(() => {});
    }

    /**
     * The portable round trip: open a URL, wait for the redirect to come home
     * on one of the app's schemes, hand back its query parameters.
     *
     * This is what the two calls below cannot be on desktop. They are Play
     * Services APIs — no client id, no redirect, no browser, and silent
     * refresh — and their whole value is the parts that do not exist off
     * Android. What CAN be carried across is the shape underneath: an
     * authorisation URL, a browser, and a redirect that lands back in the app.
     *
     * `redirect` must be one of ours, and the check is a real one rather than
     * a formality: an extension that could name any prefix could ask to be
     * woken by a link meant for the app's own sign-in, and read the handoff.
     */
    case 'oauth': {
      return oauthRoundTrip(args[0], (url) => dispatch('openBrowser', [url], ctx));
    }

    /**
     * Both of these used to throw off Android and point at `oauth`.
     *
     * That was honest about the platform and unhelpful about the task: an
     * extension author wanting Drive on a laptop was handed a raw redirect
     * primitive and left to implement PKCE, the exchange and the error
     * handling themselves — the same three things, slightly differently, in
     * every extension.
     *
     * They are the same three things here now. Android still goes through
     * Play Services, which does it better than anyone can from JavaScript:
     * consent, silent refresh, and an identity derived from the signing
     * certificate rather than from a client id anybody can copy. Everywhere
     * else takes the route Google documents for installed apps — RFC 7636
     * with an S256 challenge and the reverse-DNS redirect this app already
     * claims — which needs no client secret, because a secret inside a
     * desktop binary is not one.
     *
     * The cost of the difference is one argument: desktop cannot derive a
     * client id from a package name, so the extension has to supply one. The
     * error below says exactly that rather than "unsupported".
     */
    case 'googleSignIn': {
      // Android's plugin takes the id positionally; desktop takes an object.
      // Accept either shape on both, so one call site works on both platforms.
      const opts = (args[0] && typeof args[0] === 'object') ? args[0] : { clientId: args[0] };
      if (isAndroid()) {
        const { registerPlugin } = await import('@capacitor/core');
        return registerPlugin('GoogleSignIn').signIn({ clientId: opts.clientId });
      }
      return desktopGoogleAuth({
        clientId: opts.clientId,
        scopes: opts.scopes ?? ['openid', 'email', 'profile'],
        what: 'googleSignIn',
      });
    }

    case 'native.GoogleDrive.requestDriveToken': {
      const opts = args[0] && typeof args[0] === 'object' ? args[0] : {};
      if (isAndroid()) {
        // Unchanged: Identity.authorize() derives the caller from the package
        // name and signing certificate, and takes no client id at all.
        const { registerPlugin } = await import('@capacitor/core');
        return registerPlugin('GoogleDrive').requestDriveToken();
      }
      return desktopGoogleAuth({
        clientId: opts.clientId,
        // drive.file rather than drive: the narrow one, which grants access
        // only to files this app created or the user explicitly opened.
        scopes: opts.scopes ?? ['https://www.googleapis.com/auth/drive.file'],
        what: 'requestDriveToken',
      });
    }

    case 'getSessions': return handlers.getSessions?.() ?? [];
    case 'importSession': return handlers.importSession?.(args[0]);
    case 'replaceSession': return handlers.replaceSession?.(args[0], args[1]);
    case 'encodeSession': {
      const { packSession, bytesToBase64, sessionToBook } = await import('./authbook');
      return bytesToBase64(await packSession(sessionToBook(args[0])));
    }
    case 'exportSessionAs': {
      const { exportAsTxt, exportAsHtml, exportAsEpub } = await import('./storage');
      const fns = { txt: exportAsTxt, html: exportAsHtml, epub: exportAsEpub };
      const fn = fns[args[1]];
      if (!fn) throw new Error(`Unknown export format: ${args[1]}`);
      return fn(args[0], { returnBytes: true });
    }

    // Handled by the caller — listed so an unknown method is genuinely unknown.
    case 'registerHook': return null;

    default:
      throw new Error(`${method} is not something an extension can call`);
  }
}

/**
 * The capability switch, reachable from a test.
 *
 * Not part of the API any caller uses — runExtension wires `dispatch` into the
 * router itself. It is exported because the refusals in there are the security
 * boundary, and a boundary only checked through a frame is a boundary checked
 * on one platform in one browser.
 */
export function __testDispatch(method, args, ctx = { extId: 'test', manifest: {}, handlers: {} }) {
  return dispatch(method, args, ctx);
}

/**
 * Start one extension in its own frame.
 *
 * Resolves once `activate()` has returned or failed — never hangs. The old
 * runtime could hang forever on an import that never settled, which froze the
 * install sheet at "Activating…", so the timeout here is not belt-and-braces:
 * it is the behaviour that replaced a real bug.
 *
 * @param {object} manifest
 * @param {object} handlers  { navigate, getSessions, importSession, replaceSession }
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runExtension(manifest, handlers = {}) {
  const extId = manifest?.id;
  if (!extId) return { ok: false, error: 'manifest has no id' };

  await stopExtension(extId);

  const files = await readExtensionTree(extId);
  const entry = manifest.main || 'index.js';
  const { order, missing, cycle } = planModuleGraph(files, entry);

  if (cycle) {
    return { ok: false, error: `circular import: ${cycle.join(' → ')}` };
  }
  if (!order.length) {
    const why = missing.length ? `cannot find ${missing[0].spec}` : 'no modules found';
    return { ok: false, error: why };
  }
  if (missing.length) {
    // Not fatal on its own: an extension may import something only a newer app
    // ships. Naming it beats a browser error that names a blob URL.
    console.warn(`[extensionSandbox] ${extId}: missing`,
      missing.map((m) => `${m.from} → ${m.spec}`).join(', '));
  }

  // The entry is last, because the order is leaves-first — everything it
  // imports has to exist before it does.
  const placeholders = {};
  order.forEach((p, i) => { placeholders[p] = `__authno_mod_${i}__`; });
  const modules = order.map((path) => ({
    path,
    // A placeholder, swapped for the real blob URL inside the frame where the
    // blobs are actually created. One minted out here would belong to the app's
    // origin, which is both useless to an opaque-origin frame and a small hole
    // in the wall it is standing behind.
    //
    // The trailing `__` is load-bearing: without it, replacing `_mod_1__`
    // would corrupt `_mod_11__`.
    source: rewriteSpecifiers(path, files[path], files, (t) => placeholders[t]),
  }));

  const frame = document.createElement('iframe');
  // allow-scripts and nothing else. Adding allow-same-origin here would undo
  // the entire file: srcdoc content inherits the embedder's origin, and the
  // frame would be inside the app rather than beside it.
  // One constant, shared with ExtensionPage's UI frame. The two used to spell
  // this separately and stopped agreeing — see the note on FRAME_SANDBOX.
  frame.setAttribute('sandbox', FRAME_SANDBOX);
  frame.setAttribute('title', `${manifest.name ?? extId} (background)`);
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
  frame.srcdoc = sandboxDocument();

  const ctx = { extId, manifest, handlers };
  let settle;
  const ready = new Promise((res) => { settle = res; });

  const post = (msg) => { try { frame.contentWindow?.postMessage(msg, '*'); } catch { /* torn down */ } };

  const router = createHostRouter({
    post,
    payload: () => ({ modules, entry, manifest, app: appInfo() }),
    dispatch: (method, args) => dispatch(method, args, ctx),
    onReady: (outcome) => settle(outcome),
    registerHook,
    sendable: toSendable,
  });

  const onMessage = (e) => {
    // Identity, not origin. An opaque-origin frame reports `origin: "null"`,
    // which several other things also report; the window reference is the only
    // thing that is actually this frame.
    if (e.source !== frame.contentWindow) return;
    router.onMessage(e.data);
  };

  window.addEventListener('message', onMessage);
  document.body.appendChild(frame);

  const outcome = await Promise.race([
    ready,
    new Promise((res) => setTimeout(() => res({ ok: false, error: 'activation timed out' }), ACTIVATE_TIMEOUT_MS)),
  ]);

  // Awaited, not fired and forgotten. An extension's deactivate() may flush a
  // queue or write its last state, and those are host calls that need the app
  // still listening when they land — removing the frame the moment the request
  // went out silently dropped every one of them.
  const teardown = async () => {
    await router.teardown();
    window.removeEventListener('message', onMessage);
    // Removing the frame drops its realm, its blob URLs and anything it was
    // still holding. There is no other cleanup to get wrong.
    try { frame.remove(); } catch { /* already detached */ }
  };

  if (!outcome.ok) { await teardown(); return outcome; }

  _running.set(extId, { frame, teardown });
  return { ok: true };
}

/** Stop one extension and drop its frame. Safe to call for one that is not running. */
export async function stopExtension(extId) {
  const entry = _running.get(extId);
  if (!entry) return;
  _running.delete(extId);
  try { await entry.teardown(); } catch (e) {
    logError('extensionSandbox:teardown', e, { extId });
  }
}

/** Stop everything. Called on a full refresh or when the extension list changes. */
export async function stopAll() {
  for (const extId of [..._running.keys()]) await stopExtension(extId);
}

/** Which extensions are live, for the Settings screen and for tests. */
export function runningExtensions() {
  return [..._running.keys()];
}

function appInfo() {
  return { name: 'AuthNo', version: APP_VERSION, platform: isAndroid() ? 'android' : 'desktop' };
}

