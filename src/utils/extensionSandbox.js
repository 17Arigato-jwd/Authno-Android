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
 * Loading, storage, navigation, the library and the export formats are. Three
 * calls in `dispatch` are not, because they are native plugins with no desktop
 * equivalent: googleSignIn (Credential Manager) and requestDriveToken (the
 * account picker) throw with a reason, and openBrowser falls back to the real
 * browser instead of a Custom Tab. An extension whose whole job is a Google
 * OAuth round trip is therefore still Android-only, and that is a gap in the
 * host API rather than in the sandbox.
 */

import { registerHook } from './sessionHooks';
import { logError } from './ErrorLogger';
import { isAndroid } from './platform';
import { toast as _toast } from '../DesignSystem';
import { APP_VERSION } from '../version';
import { planModuleGraph, rewriteSpecifiers } from './moduleGraph';

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

/**
 * The bootstrap, as source.
 *
 * Exported so a test can read it without a DOM. It is a string rather than a
 * function because it has to execute in a realm that shares nothing with this
 * one — closing over anything here would be exactly the leak the frame exists
 * to prevent.
 */
export const BOOTSTRAP = `
(function () {
  'use strict';
  var pending = {};
  var seq = 0;
  var hooks = {};

  function call(method, args) {
    return new Promise(function (res, rej) {
      var id = ++seq;
      pending[id] = { res: res, rej: rej };
      parent.postMessage({ type: 'ext-call', id: id, method: method, args: args }, '*');
    });
  }

  function reply(id, result, error) {
    parent.postMessage({ type: 'ext-reply', id: id, result: result, error: error }, '*');
  }

  // The host API. Every one of these is a round trip the host can refuse; there
  // is no other surface, because there is no other origin to reach.
  function makeStorage() {
    return {
      get: function (k) { return call('storage.get', [k]); },
      set: function (k, v) { return call('storage.set', [k, v]); },
      remove: function (k) { return call('storage.set', [k, null]); },
      keys: function () { return call('storage.keys', []); },
      getJSON: function (k, fallback) {
        return call('storage.get', [k]).then(function (v) {
          if (v === null || v === undefined) return fallback === undefined ? null : fallback;
          try { return JSON.parse(v); } catch (e) { return fallback === undefined ? null : fallback; }
        });
      },
      setJSON: function (k, v) { return call('storage.set', [k, JSON.stringify(v)]); },
    };
  }

  var api = {
    version: 3,
    storage: makeStorage(),
    navigate: function (pageId, session) { return call('navigate', [pageId, session]); },
    toast: function (m, o) { return call('toast', [String(m == null ? '' : m), o || {}]); },
    openBrowser: function (url) { return call('openBrowser', [url]); },
    closeBrowser: function () { return call('closeBrowser', []); },
    googleSignIn: function (clientId) { return call('googleSignIn', [clientId]); },
    getSessions: function () { return call('getSessions', []); },
    encodeSession: function (s) { return call('encodeSession', [s]); },
    importSession: function (b64) { return call('importSession', [b64]); },
    replaceSession: function (id, b64) { return call('replaceSession', [id, b64]); },
    exportSessionAs: function (s, fmt) { return call('exportSessionAs', [s, fmt]); },
    requestDriveToken: function () { return call('native.GoogleDrive.requestDriveToken', []); },
    // Registering is local; the host only needs to know the name so it can
    // subscribe on the bus and forward. The handler itself never leaves here.
    registerHook: function (name, handler) {
      (hooks[name] = hooks[name] || []).push(handler);
      call('registerHook', [name]);
      return function off() {
        hooks[name] = (hooks[name] || []).filter(function (h) { return h !== handler; });
      };
    },
  };

  window.AuthnoHostAPI = api;

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg) return;

    if (msg.type === 'ext-reply') {
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (msg.error) p.rej(new Error(msg.error)); else p.res(msg.result);
      return;
    }

    // A hook fired in the app. Run every handler, hand back the first result
    // that is not undefined, and never let one handler's throw stop the others.
    if (msg.type === 'ext-hook') {
      var list = hooks[msg.name] || [];
      Promise.all(list.map(function (h) {
        try { return Promise.resolve(h.apply(null, msg.args || [])).catch(function () { return undefined; }); }
        catch (err) { return Promise.resolve(undefined); }
      })).then(function (results) {
        var first;
        for (var i = 0; i < results.length; i++) {
          if (results[i] !== undefined) { first = results[i]; break; }
        }
        reply(msg.id, first, null);
      });
      return;
    }

    // The module graph, leaves first. Each becomes a blob URL, and the next
    // module's source already names it — which is the only order blob URLs can
    // be built in, since a URL cannot be referenced before its content exists.
    if (msg.type === 'ext-load') {
      (function () {
        var urls = [];
        try {
          for (var i = 0; i < msg.modules.length; i++) {
            var src = msg.modules[i].source;
            // Swap each placeholder for the blob URL that module became. The
            // list is leaves-first, so everything this module imports already
            // has one — which is the only order blob URLs can be built in.
            for (var j = 0; j < urls.length; j++) {
              src = src.split('__authno_mod_' + j + '__').join(urls[j]);
            }
            urls.push(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
          }
        } catch (err) {
          parent.postMessage({ type: 'ext-ready', error: 'blob: ' + err.message }, '*');
          return;
        }
        import(urls[urls.length - 1]).then(function (mod) {
          if (typeof mod.activate !== 'function') {
            parent.postMessage({ type: 'ext-ready', error: 'no activate() export' }, '*');
            return;
          }
          return Promise.resolve(mod.activate(Object.assign({}, api, {
            extension: msg.manifest,
            app: msg.app,
          }))).then(function (deactivate) {
            window.__authnoDeactivate = typeof deactivate === 'function' ? deactivate : null;
            parent.postMessage({ type: 'ext-ready', error: null }, '*');
          });
        }).catch(function (err) {
          parent.postMessage({ type: 'ext-ready', error: String(err && err.message ? err.message : err) }, '*');
        });
      })();
      return;
    }

    if (msg.type === 'ext-deactivate') {
      try { if (window.__authnoDeactivate) window.__authnoDeactivate(); } catch (err) { /* teardown is best-effort */ }
      hooks = {};
      return;
    }
  });

  parent.postMessage({ type: 'ext-boot' }, '*');
})();
`;

/**
 * The srcdoc for one extension's frame.
 *
 * No CSP meta tag: the opaque origin is the boundary, and a policy inside the
 * frame would only constrain code that is already walled off.
 *
 * The closing tag is split so this file can be served as a script itself
 * without the parser ending it here — the usual reason, not a typo.
 */
export function sandboxDocument() {
  const close = `</${'script'}>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><script>${BOOTSTRAP}${close}</head><body></body></html>`;
}

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
      // Desktop and web: the real browser. An OAuth flow that ends in a
      // redirect back to a localhost listener still works; one that expects
      // the app to be handed the code by a Custom Tab does not, and that is
      // the honest limit rather than something this can paper over.
      window.open(url, '_blank', 'noopener,noreferrer');
      return null;
    }

    case 'closeBrowser': {
      if (!isAndroid()) return null; // a real browser tab is not ours to close
      const { registerPlugin } = await import('@capacitor/core');
      return registerPlugin('OAuth').closeAuthBrowser().catch(() => {});
    }

    case 'googleSignIn': {
      if (!isAndroid()) throw new Error('googleSignIn is Android only — it uses Credential Manager, which has no desktop equivalent');
      const { registerPlugin } = await import('@capacitor/core');
      return registerPlugin('GoogleSignIn').signIn({ clientId: args[0] });
    }

    case 'native.GoogleDrive.requestDriveToken': {
      if (!isAndroid()) throw new Error('requestDriveToken is Android only — the Drive token comes from the native account picker');
      const { registerPlugin } = await import('@capacitor/core');
      return registerPlugin('GoogleDrive').requestDriveToken();
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
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', `${manifest.name ?? extId} (background)`);
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
  frame.srcdoc = sandboxDocument();

  const ctx = { extId, manifest, handlers };
  const hookOffs = [];
  let settle;
  const ready = new Promise((res) => { settle = res; });

  const post = (msg) => { try { frame.contentWindow?.postMessage(msg, '*'); } catch { /* torn down */ } };

  // Hook calls travel the other way: the app fires, the frame answers.
  let hookSeq = 0;
  const hookPending = new Map();

  const onMessage = async (e) => {
    // Identity, not origin. An opaque-origin frame reports `origin: "null"`,
    // which several other things also report; the window reference is the only
    // thing that is actually this frame.
    if (e.source !== frame.contentWindow) return;
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'ext-boot') {
      post({ type: 'ext-load', modules, entry, manifest, app: appInfo() });
      return;
    }

    if (msg.type === 'ext-ready') {
      settle(msg.error ? { ok: false, error: msg.error } : { ok: true });
      return;
    }

    if (msg.type === 'ext-reply') {
      const p = hookPending.get(msg.id);
      if (!p) return;
      hookPending.delete(msg.id);
      p(msg.result);
      return;
    }

    if (msg.type !== 'ext-call') return;

    if (msg.method === 'registerHook') {
      const name = String(msg.args?.[0] ?? '');
      hookOffs.push(registerHook(name, (...args) => new Promise((res) => {
        const id = ++hookSeq;
        hookPending.set(id, res);
        // A frame that never answers must not stall the app's own hook chain.
        setTimeout(() => { if (hookPending.delete(id)) res(undefined); }, 5000);
        post({ type: 'ext-hook', id, name, args: sendable(args) });
      })));
      post({ type: 'ext-reply', id: msg.id, result: null, error: null });
      return;
    }

    try {
      const result = await dispatch(msg.method, msg.args ?? [], ctx);
      post({ type: 'ext-reply', id: msg.id, result: sendable(result), error: null });
    } catch (err) {
      post({ type: 'ext-reply', id: msg.id, result: null, error: String(err?.message ?? err) });
    }
  };

  window.addEventListener('message', onMessage);
  document.body.appendChild(frame);

  const outcome = await Promise.race([
    ready,
    new Promise((res) => setTimeout(() => res({ ok: false, error: 'activation timed out' }), ACTIVATE_TIMEOUT_MS)),
  ]);

  const teardown = () => {
    post({ type: 'ext-deactivate' });
    for (const off of hookOffs) { try { off(); } catch { /* already gone */ } }
    window.removeEventListener('message', onMessage);
    // Removing the frame drops its realm, its blob URLs and anything it was
    // still holding. There is no other cleanup to get wrong.
    try { frame.remove(); } catch { /* already detached */ }
  };

  if (!outcome.ok) { teardown(); return outcome; }

  _running.set(extId, { frame, teardown });
  return { ok: true };
}

/** Stop one extension and drop its frame. Safe to call for one that is not running. */
export async function stopExtension(extId) {
  const entry = _running.get(extId);
  if (!entry) return;
  _running.delete(extId);
  try { entry.teardown(); } catch (e) {
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

/**
 * postMessage uses structured clone, which throws on a function, a DOM node or
 * a React element — and a throw here would look to the extension like the host
 * hanging up mid-call. A JSON round trip drops exactly the things that cannot
 * cross anyway, and does it where the failure can be explained.
 */
function sendable(value) {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}
