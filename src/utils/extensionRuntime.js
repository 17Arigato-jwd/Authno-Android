/**
 * extensionRuntime.js — the app's side of the extension boundary.
 *
 * Activation itself lives in extensionSandbox.js, which runs extension code in
 * a frame with an opaque origin. This file is what the app already imported, so
 * it stays: it holds the handlers App.js registers, the host-internal API the
 * ui-file page router calls, and the adapter between the two.
 *
 * ── What changed, and why the old shape was not fixable ──────────────────────
 *
 * This module used to `import()` extension code straight into the app's own
 * context. There was no boundary to tighten — an extension had the app's
 * globals, the app's localStorage (which is where the access key lives) and
 * every Capacitor plugin, regardless of what its manifest asked for.
 *
 * It also only worked on Android, and for the same reason: the import came from
 * `https://localhost/extensions/*`, a URL only MainActivity serves. Off Android
 * the import never settled, which is why activation was skipped there outright.
 *
 * Both are gone. The sandbox reads the files through Capacitor's Filesystem —
 * real on web and Electron, backed by IndexedDB — and links them into blob URLs
 * inside the frame, which needs no server and no origin. One code path, three
 * platforms, and the extension is on the other side of a wall on all of them.
 *
 * `window.AuthNoExtensionAPI` below is now host-internal. It is still the thing
 * ExtensionPage's message router calls to service a ui-file page, but extension
 * code can no longer see it: an opaque-origin frame cannot read `parent`
 * anything.
 */

import { logError } from './ErrorLogger';
import { runExtension, stopExtension, stopAll } from './extensionSandbox';
import { runExtensionV2, stopExtensionV2, stopAllV2, runningV2 } from './extensionRunnerV2';
import { readExtensionTree } from './extensionSandbox';
import { readGrants, writeGrants } from './extensionGrants';
import {
  openBrowser as hostOpenBrowser,
  closeBrowser as hostCloseBrowser,
  oauth as hostOauth,
  googleSignIn as hostGoogleSignIn,
  requestDriveToken as hostRequestDriveToken,
  signOut as hostSignOut,
} from './extensionBrowserHost';
import { toast as hostToast } from '../DesignSystem';
import { APP_VERSION } from '../version';
import { isAndroid } from './platform';
import { activityMeter } from './activityMeter';
import { surfaces } from './extensionSurfaces';
import { prompts } from './extensionPrompts';
import { libraryHandlers } from './extensionHandlersV2';
import { extStorage } from './extensionStorage';

/** What a restart-after-grant needs to start the same extension again. */
const _manifests = new Map();
const _navigateFns = new Map();

// ── window.AuthNoExtensionAPI ────────────────────────────────────────────────
//
// Host-INTERNAL now, despite the name and despite living on window. It is what
// ExtensionPage's message router calls to service a ui-file page's request.
// Extension code cannot see it: the frames that run extensions have an opaque
// origin, and reading `parent.AuthNoExtensionAPI` from one throws.

let _replaceSessionFn = null;
let _importSessionFn  = null;
let _getSessionsFn    = null;
let _currentIdFn      = null;

/** Called by App.js so conflict resolution can hot-swap a session. */
export function setReplaceSessionHandler(fn) { _replaceSessionFn = fn; }
/** Called by App.js to let extensions import downloaded books. */
export function setImportSessionHandler(fn)  { _importSessionFn  = fn; }
/** Called by App.js to expose the sessions list to extensions. */
export function setGetSessionsHandler(fn)    { _getSessionsFn    = fn; }
/**
 * Called by App.js with the id of the book that is open, or null.
 *
 * This is what makes `library:read:current` a real permission rather than a
 * label. Without it `currentId()` is always null, and the scope check in
 * extensionLibraryV2 refuses every read — correctly, and unhelpfully: an
 * extension granted exactly the permission it needs would be told there is no
 * open book while the user is looking at one.
 */
export function setCurrentBookHandler(fn)    { _currentIdFn      = fn; }

function ensureHostAPI() {
  if (window.AuthNoExtensionAPI) return;
  window.AuthNoExtensionAPI = {
    /** Encode a session → base64 .authbook bytes for upload. */
    async encodeSession(session) {
      const { packSession, bytesToBase64, sessionToBook } = await import('./authbook');
      // React sessions are flat: { id, title, authors[], chapters[], ... }
      // packSession needs book format: { meta: { authors, devices, ... }, chapters[], ... }
      // sessionToBook() converts flat → book; packSession then encodes to .authbook bytes.
      try {
        const book  = sessionToBook(session);
        const bytes = await packSession(book);
        return bytesToBase64(bytes);
      } catch (err) {
        throw new Error(
          `encodeSession failed for "${session?.title ?? session?.id ?? 'unknown'}": `
          + err.message
        );
      }
    },

    /** Replace in-memory session with downloaded bytes (conflict: use-cloud). */
    async replaceSession(sessionId, base64) {
      if (typeof _replaceSessionFn === 'function') {
        await _replaceSessionFn(sessionId, base64);
      }
    },

    /** Import a downloaded .authbook base64 into the app as a new/updated session. */
    async importSession(base64) {
      if (typeof _importSessionFn === 'function') {
        return _importSessionFn(base64);
      }
      throw new Error('importSession handler not registered');
    },

    /** Return lightweight metadata for all sessions (id, title, updated, filePath). */
    getSessions() {
      if (typeof _getSessionsFn === 'function') return _getSessionsFn();
      return [];
    },

    /**
     * Export a session to a non-.authbook format.
     * format: 'txt' | 'html' | 'epub'
     * Returns { filename, base64, mimeType }
     */
    async exportSessionAs(session, format) {
      const { exportAsTxt, exportAsHtml, exportAsEpub } = await import('./storage');
      const handlers = {
        txt:  async (s) => { const r = await exportAsTxt(s,  { returnBytes: true }); return r; },
        html: async (s) => { const r = await exportAsHtml(s, { returnBytes: true }); return r; },
        epub: async (s) => { const r = await exportAsEpub(s, { returnBytes: true }); return r; },
      };
      const fn = handlers[format];
      if (!fn) throw new Error(`Unknown export format: ${format}`);
      return fn(session);
    },
  };
}

// ── Activation ────────────────────────────────────────────────────────────────

/**
 * Activate one extension. Safe to call again on the same extId — the sandbox
 * drops the previous frame first.
 *
 * Resolves once activate() has returned or failed, and never hangs: the install
 * sheet waits on this, and the version that could hang froze it at
 * "Activating…" with nothing to click.
 *
 * @param {object}   manifest    — the extension's manifest object
 * @param {function} navigateFn  — (extension, pageId, session) → void
 */
export async function activateExtension(manifest, navigateFn) {
  const extId = manifest?.id;
  if (!extId) return;

  ensureHostAPI();

  // apiVersion decides which runner, and there is no third option: a v2
  // extension must not reach v1's dispatch, which checks nothing. That is the
  // whole reason the version is in the manifest rather than inferred.
  if (manifest.apiVersion === 2) return activateV2(manifest, navigateFn);

  const { ok, error } = await runExtension(manifest, {
    navigate: (ext, pageId, session) => navigateFn?.(ext, pageId, session),
    getSessions: () => (typeof _getSessionsFn === 'function' ? _getSessionsFn() : []),
    importSession: (b64) => {
      if (typeof _importSessionFn !== 'function') throw new Error('importSession handler not registered');
      return _importSessionFn(b64);
    },
    replaceSession: (id, b64) => (typeof _replaceSessionFn === 'function' ? _replaceSessionFn(id, b64) : undefined),
  });

  if (!ok) {
    logError('extensionRuntime:activate', new Error(error), { extId });
    console.error(`[extensionRuntime] ${extId} did not activate: ${error}`);
    return;
  }
  console.log(`[extensionRuntime] \u2713 Activated: ${extId} v${manifest.version}`);
}

/**
 * Start a v2 extension.
 *
 * Everything the v2 work built meets the app here: the grants on record become
 * a PermissionSet, that set builds both the frame's policy and the checks on
 * its bridge, and every capability goes through a door that can refuse.
 *
 * A v1 extension activating alongside is unaffected — the two runners share no
 * code path, so the day Cloud Backup ships as 2.0.0 the old one is deleted
 * rather than unpicked.
 */
async function activateV2(manifest, navigateFn) {
  const extId = manifest.id;
  // Kept so a host grant can restart this exact extension with the same
  // navigation callback; a restart that lost it would leave every
  // `ui.navigate` from the extension going nowhere.
  _manifests.set(extId, manifest);
  if (navigateFn) _navigateFns.set(extId, navigateFn);

  let files;
  try {
    files = await readExtensionTree(extId);
  } catch (e) {
    logError('extensionRuntime:readV2', e, { extId });
    return;
  }

  const { granted, userHosts } = readGrants(extId);

  const { ok, error } = await runExtensionV2({
    manifest,
    files,
    entry: 'index.js',
    granted,
    userHosts,
    meter: activityMeter(),
    handlers: v2Handlers(extId, navigateFn),
    onDenied: (id, permission, method) => {
      // Counted rather than logged and forgotten: the Extensions tab turns
      // this into "it has been asking for something it does not have", which
      // is the difference between an extension that looks broken and one
      // whose problem is legible.
      console.warn(`[extensionRuntime] ${id} was refused ${method} (needs ${permission})`);
    },
  });

  if (!ok) {
    logError('extensionRuntime:activateV2', new Error(error), { extId });
    console.error(`[extensionRuntime] ${extId} did not activate: ${error}`);
    return;
  }
  console.log(`[extensionRuntime] \u2713 Activated (v2): ${extId} v${manifest.version}`);
}

/** The app-side implementations a v2 host is handed. */
function v2Handlers(extId, navigateFn) {
  return {
    app: {
      version: () => APP_VERSION,
      platform: () => (isAndroid() ? 'android' : 'desktop'),
      locale: () => (typeof navigator !== 'undefined' ? navigator.language : 'en'),
    },
    ui: {
      toast: (message, opts) => hostToast(message, opts),
      navigate: (id, pageId, session) => navigateFn?.({ id }, pageId, session),
      prompt: (id, opts) => prompts().prompt(id, opts),
      confirm: (id, opts) => prompts().confirm(id, opts),
      overlaySet: (id, text) => surfaces().setOverlay(id, text),
      overlayClear: (id) => surfaces().clearOverlay(id),
    },
    storage: extStorage(extId),
    library: libraryHandlers({
      getSessions: () => (typeof _getSessionsFn === 'function' ? _getSessionsFn() : []),
      importSession: (b64) => {
        if (typeof _importSessionFn !== 'function') throw new Error('importSession handler not registered');
        return _importSessionFn(b64);
      },
      replaceSession: (id, b64) => (typeof _replaceSessionFn === 'function' ? _replaceSessionFn(id, b64) : undefined),
      currentId: () => (typeof _currentIdFn === 'function' ? _currentIdFn() : null),
      exportSessionAs: (session, format) => exportSessionAs(session, format),
    }),

    // Opening a browser, and the OAuth round trip that comes back from one.
    // Absent until now, which meant `browser` and `auth` were a permission a
    // user could grant and an extension could never use: createExtensionHost
    // only builds those capabilities when this is here, so every call came
    // back `unknown-method`.
    browser: {
      open: (url) => hostOpenBrowser(url),
      close: () => hostCloseBrowser(),
      oauth: (opts) => hostOauth(opts),
      googleSignIn: (opts) => hostGoogleSignIn(opts),
      requestDriveToken: (opts) => hostRequestDriveToken(opts),
      signOut: () => hostSignOut(),
    },

    // Adding a host to the policy. `ask` is the user's answer and nothing
    // grants without it — an extension that could add its own origins would
    // make the CSP a list of hosts it had chosen rather than ones anyone
    // approved.
    network: {
      ask: (id, url) => prompts().confirm(id, {
        title: 'Connect to a new address?',
        // The origin, on its own line and unaltered. This is the one fact the
        // answer turns on, and an extension that could dress it up — or bury
        // it in a sentence it also wrote — would be choosing what the question
        // looks like as well as asking it.
        message: `${_extName(id)} wants to connect to:\n\n${url}\n\n`
          + 'Only allow this if you recognise the address.',
      }).catch(() => false),
      persist: (id, hosts) => {
        const current = readGrants(id);
        writeGrants(id, current.granted, hosts);
      },
      // A document cannot be re-policied after it loads, so a new host only
      // takes effect on the next start. Restarting here rather than leaving
      // the extension to ask means the grant the user just gave works.
      onGranted: (id) => { _restartAfterGrant(id); },
    },
  };
}

/** The extension's own name, for a dialog that has to say who is asking. */
function _extName(extId) {
  return _manifests.get(extId)?.name ?? extId;
}

/**
 * Export one session, for `library.export`.
 *
 * `authbook` is the important one and was the one missing: it is the format a
 * backup extension wants, the default `library.export` uses when a caller
 * names none, and the only one that round-trips — txt, html and epub all lose
 * something. Leaving it out meant the single most likely call answered
 * "Unknown export format: authbook".
 */
async function exportSessionAs(session, format) {
  if (format === 'authbook') {
    const { packSession, bytesToBase64, sessionToBook } = await import('./authbook');
    const base64 = bytesToBase64(await packSession(sessionToBook(session)));
    const name = String(session?.title ?? session?.id ?? 'book').replace(/[/\\:*?"<>|]/g, '');
    return { filename: `${name}.authbook`, base64, mimeType: 'application/octet-stream' };
  }
  const { exportAsTxt, exportAsHtml, exportAsEpub, exportAsPdf } = await import('./storage');
  const fn = { txt: exportAsTxt, html: exportAsHtml, epub: exportAsEpub, pdf: exportAsPdf }[format];
  if (!fn) throw new Error(`this build cannot export ${format}`);
  return fn(session, { returnBytes: true });
}

/**
 * Restart one extension so a host it was just granted is in its policy.
 *
 * Deferred to a microtask rather than awaited: this is called from inside
 * `network.requestHost`, and tearing the frame down while it is waiting for
 * that call's reply would leave the extension with a promise that never
 * settles instead of the answer it asked for.
 */
function _restartAfterGrant(extId) {
  Promise.resolve().then(async () => {
    try {
      const manifest = _manifests.get(extId);
      if (!manifest) return;
      await stopExtensionV2(extId);
      await activateV2(manifest, _navigateFns.get(extId) ?? null);
    } catch (e) {
      logError('extensionRuntime:restartAfterGrant', e, { extId });
    }
  });
}

/** Stop one extension and drop its frame, hooks and blob URLs with it. */
export async function deactivateExtension(extId) {
  // Which runner started it is not knowable from the id alone, so both are
  // asked. Stopping something that is not running is a no-op in either.
  if (runningV2().includes(extId)) { await stopExtensionV2(extId); return; }
  await stopExtension(extId);
}

/** Stop everything. Called on a full refresh or when the extension list changes. */
export async function deactivateAll() {
  await stopAllV2();
  await stopAll();
}

/** Which extensions are live. Exposed for the Developer section in Settings. */
export { runningExtensions } from './extensionSandbox';
