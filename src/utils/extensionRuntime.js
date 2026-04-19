/**
 * extensionRuntime.js — v1.2.0-alpha.1
 *
 * Extension activation runtime. Bridges the gap between installed extension
 * files on disk and the live React app.
 *
 * How it works
 * ────────────
 * 1. Extensions are installed to: AuthNo/extensions/<id>/ (Capacitor internal storage)
 * 2. MainActivity.java intercepts https://localhost/extensions/* requests and
 *    serves files directly from that directory.
 * 3. This lets us use native ES module dynamic import() — relative imports inside
 *    the extension (e.g. `import { X } from './queue.js'`) resolve correctly.
 * 4. activate() is called with the standard API surface.
 * 5. window.AuthNoExtensionAPI is set up so extensions can encode .authbook bytes.
 *
 * Per-extension storage
 * ─────────────────────
 * A scoped key-value store backed by localStorage, namespaced per extension ID.
 * Values are always stored/retrieved as strings (JSON.stringify before set if needed).
 *
 * Version history
 * ───────────────
 * 1.2.0-alpha.1  Initial implementation (fixes Bug 2 — activate() never called)
 */

import { registerHook }  from './sessionHooks';
import { logError }      from './ErrorLogger';
// OAuth browser helpers — use native OAuthPlugin (Custom Tabs) and
// GoogleSignInPlugin (Credential Manager) instead of @capacitor/browser.
// @capacitor/browser hardcodes com.android.chrome which causes a silent hang
// when Chrome isn't the default browser on the device.
import { registerPlugin } from '@capacitor/core';

const _OAuthPlugin    = registerPlugin('OAuth');
const _GoogleSignIn   = registerPlugin('GoogleSignIn');

const EXT_BASE_URL = 'https://localhost/extensions';

// ── Per-extension scoped storage ─────────────────────────────────────────────

function makeExtStorage(extId) {
  const ns = `__ext_kv_${extId}__`;
  return {
    async get(key) {
      try { return localStorage.getItem(ns + key); } catch { return null; }
    },
    async set(key, val) {
      try {
        if (val === null || val === undefined) {
          localStorage.removeItem(ns + key);
        } else {
          localStorage.setItem(ns + key, String(val));
        }
      } catch {}
    },
  };
}

// ── window.AuthNoExtensionAPI ────────────────────────────────────────────────
//
// Host-app bridge for operations extensions can't do themselves.
// Set once and shared across all extensions.

let _replaceSessionFn = null;
let _importSessionFn  = null;
let _getSessionsFn    = null;

/** Called by App.js so conflict resolution can hot-swap a session. */
export function setReplaceSessionHandler(fn) { _replaceSessionFn = fn; }
/** Called by App.js to let extensions import downloaded books. */
export function setImportSessionHandler(fn)  { _importSessionFn  = fn; }
/** Called by App.js to expose the sessions list to extensions. */
export function setGetSessionsHandler(fn)    { _getSessionsFn    = fn; }

function ensureHostAPI() {
  if (window.AuthNoExtensionAPI) return;
  window.AuthNoExtensionAPI = {
    /** Encode a session → base64 .authbook bytes for upload. */
    async encodeSession(session) {
      const { packSession, bytesToBase64, sessionToBook } = await import('./authbook');
      // React sessions are flat objects: { id, title, authors[], chapters[], ... }
      // packSession expects book format:  { meta: { authors, devices, ... }, chapters[], ... }
      // When packSession receives an object with a .chapters array it skips the
      // legacy-migration path and uses the object directly as "book" — then crashes
      // on book.meta.authors because flat sessions have no .meta wrapper.
      // sessionToBook() is the canonical flat→book converter: it builds meta from
      // the top-level fields and keeps all chapters intact.
      const book  = sessionToBook(session);
      const bytes = await packSession(book);
      return bytesToBase64(bytes);
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

// ── Activation registry ───────────────────────────────────────────────────────

/** extId → deactivate() fn */
const _active = new Map();

/**
 * Activate one extension. Safe to call again on the same extId — deactivates
 * the previous instance first.
 *
 * @param {object}   manifest    — the extension's manifest object
 * @param {function} navigateFn  — (extension, pageId, session) → void
 */
export async function activateExtension(manifest, navigateFn) {
  const { id: extId, version } = manifest;

  await deactivateExtension(extId); // clean up any previous run
  ensureHostAPI();

  const storage = makeExtStorage(extId);
  const navigate = (ext, pageId, session = null) => navigateFn?.(ext, pageId, session);

  // Dynamic import from the HTTP-served extension URL.
  // Cache-bust with timestamp so reinstalling always picks up fresh code.
  const url = `${EXT_BASE_URL}/${extId}/index.js?_t=${Date.now()}`;
  let mod;
  try {
    mod = await import(/* webpackIgnore: true */ url);
  } catch (err) {
    logError('extensionRuntime:import', err, { extId, url });
    console.error(`[extensionRuntime] Failed to import ${extId}:`, err.message);
    return;
  }

  if (typeof mod?.activate !== 'function') {
    console.warn(`[extensionRuntime] ${extId}: no activate() export found`);
    return;
  }

  let deactivate;
  try {
    // openBrowser: uses Android Custom Tabs via OAuthPlugin (no Chrome lock-in)
    const openBrowser  = async (url) => {
      try {
        await _OAuthPlugin.openAuthUrl({ url });
      } catch (err) {
        logError('extensionRuntime:openBrowser', err, { url });
        throw err;
      }
    };
    // closeBrowser: launches OAuthFinishActivity to pop Custom Tab from back stack
    const closeBrowser = async () => {
      await _OAuthPlugin.closeAuthBrowser().catch(() => {});
    };
    // googleSignIn: uses Credential Manager bottom-sheet (no browser/redirect needed)
    const googleSignIn = async (clientId) => {
      return _GoogleSignIn.signIn({ clientId });
    };

    deactivate = mod.activate({ registerHook, storage, navigate, extension: manifest, openBrowser, closeBrowser, googleSignIn });
  } catch (err) {
    logError('extensionRuntime:activate', err, { extId });
    console.error(`[extensionRuntime] activate() threw for ${extId}:`, err.message);
    return;
  }

  if (typeof deactivate === 'function') {
    _active.set(extId, deactivate);
  }

  console.log(`[extensionRuntime] ✓ Activated: ${extId} v${version}`);
}

/**
 * Deactivate one extension by ID (calls its deactivate() cleanup if registered).
 */
export async function deactivateExtension(extId) {
  const fn = _active.get(extId);
  if (!fn) return;
  _active.delete(extId);
  try { fn(); } catch (e) {
    console.warn(`[extensionRuntime] deactivate() threw for ${extId}:`, e.message);
  }
}

/**
 * Deactivate all running extensions.
 * Called on full refresh or when the extension list changes.
 */
export async function deactivateAll() {
  for (const extId of [..._active.keys()]) {
    await deactivateExtension(extId);
  }
}
