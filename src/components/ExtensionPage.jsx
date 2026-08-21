import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DSIcons } from '../DesignSystem';
import { useExtensions } from '../utils/ExtensionContext';
import { callExtensionApi } from '../utils/extensionLoader';
import { readExtensionTree, oauthRoundTrip, desktopGoogleAuth } from '../utils/extensionSandbox';
import { pageApiV2 } from '../utils/sandboxProtocol';
import { hostV2 } from '../utils/extensionRunnerV2';
import { FRAME_SANDBOX } from '../utils/sandboxProtocol';
import { planModuleGraph, rewriteSpecifiers } from '../utils/moduleGraph';
import { isAndroid } from '../utils/platform';
import { useTheme, themeVars } from '../theme';

// ── Inject spin keyframe once at module load ────────────────────────────────
if (typeof document !== 'undefined' && !document.getElementById('ds-spin')) {
  const _s = document.createElement('style');
  _s.id = 'ds-spin';
  _s.textContent = '@keyframes dsSpinIcon{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
  document.head.appendChild(_s);
}

/**
 * ExtensionPage.jsx
 *
 * Changes from v1.1.14:
 *   - Added 'ui-file' page type (was completely missing — caused blank screen)
 *   - UiFilePage reads the extension's JS file from Capacitor filesystem,
 *     builds a self-contained srcdoc iframe with CloudBackupAPI injected
 *     synchronously before the extension script executes.
 *   - The API bridge uses postMessage for two-way communication so the iframe's
 *     isolated window can call storage.get/set, navigate, etc.
 */









// ─── Helpers ──────────────────────────────────────────────────────────────────


// ─── In-app browser (N5) ──────────────────────────────────────────────────────
// The old static `import { Browser } from '@capacitor/browser'` rejected at
// runtime on device because the plugin was never synced into the Android
// project. Prefer the native OAuthPlugin (Custom Tabs), then fall back to the
// Capacitor Browser plugin if it exists, then window.open.
async function openInAppBrowser(url) {
  if (isAndroid()) {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const oauth = registerPlugin('OAuth');
      if (oauth?.openAuthUrl) { await oauth.openAuthUrl({ url }); return; }
    } catch (_) { /* fall through */ }
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch (_) { /* fall through */ }
  }
  // Desktop: ask the main process for the OS browser. window.open here does
  // not open one — it builds a second Electron window and loads the page
  // inside AuthNo, which is how a sign-in page ends up on the app's chrome
  // with no address bar under it. See guardNavigation in main.js.
  if (typeof window !== 'undefined' && window.electron?.openExternal) {
    await window.electron.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

async function closeInAppBrowser() {
  if (isAndroid()) {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const oauth = registerPlugin('OAuth');
      if (oauth?.closeAuthBrowser) { await oauth.closeAuthBrowser().catch(() => {}); return; }
    } catch (_) { /* fall through */ }
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch (_) { /* Custom Tabs close themselves; nothing to do */ }
}

function sessionVars(session) {
  if (!session) return {};
  // N4: _editingChap is the numeric chap_idx being edited, NOT a chapter
  // object — the old `session._editingChap?.title` was always undefined, so
  // the flagship "publish this chapter" tokens sent empty strings. Resolve the
  // chapter from the chapters array (fall back to top-level content for books
  // opened outside the editor).
  const chapIdx = typeof session._editingChap === 'number' ? session._editingChap : null;
  const chap = chapIdx != null
    ? (session.chapters || []).find(c => c.chap_idx === chapIdx)
    : null;
  return {
    bookId:         session.id ?? '',
    bookTitle:      session.title ?? '',
    externalId:     session.externalId ?? '',
    chapterTitle:   chap?.title ?? '',
    chapterContent: chap?.content ?? session.content ?? '',
  };
}

function sub(str, vars) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function PageHeader({ title, onBack, accentHex, action }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px',
      background: 'var(--app-bg)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <button
          onClick={onBack}
          style={{
            padding: '6px', background: 'none', border: '1px solid var(--border)',
            borderRadius: '6px', cursor: 'pointer', color: 'var(--text-1)',
            display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
          aria-label="Back"
        >
          <DSIcons.ChevronLeft size={18} />
        </button>
        <span style={{
          color: 'var(--text-1)', fontWeight: 600, fontSize: '16px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
      </div>
      {action}
    </header>
  );
}

function StatusBox({ icon, title, subtitle }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px', gap: '12px', textAlign: 'center',
    }}>
      <div style={{ fontSize: '36px', lineHeight: 1 }}>{icon}</div>
      <div style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: '16px' }}>{title}</div>
      {subtitle && <div style={{ color: 'var(--text-4)', fontSize: '13px', maxWidth: '280px' }}>{subtitle}</div>}
    </div>
  );
}

// ─── Page type: ui-file ───────────────────────────────────────────────────────
//
// Loads the extension's JS UI file from disk and renders it in a sandboxed
// iframe. CloudBackupAPI (or any window.* the extension sets) is bridged via
// postMessage so the isolated iframe window can call host-app operations.
//
// Message protocol (parent → iframe):
//   { type: 'init', api: { status, creds... } }     — first message on load
//
// Message protocol (iframe → parent):
//   { type: 'api-call', id, method, args }           — extension calls bridge
//
// Message protocol (parent → iframe):
//   { type: 'api-result', id, result?, error? }      — response to api-call

// EXT_BASE ('https://localhost/extensions') lived here. Nothing loads from it
// any more — that URL was only ever served by Android's MainActivity, which is
// why extensions did not run on desktop at all. Both halves now link their
// modules into blob URLs inside the frame instead.


/**
 * The app's theme, as a stylesheet the extension's own page can read.
 *
 * A `ui-file` page is a sandboxed srcdoc document. It inherits nothing — not a
 * variable, not a font, not a background — so before this it had no way to
 * know what the app looked like and every author guessed. Cloud Backup guessed
 * dark, correctly for four of AuthNo's themes and disastrously for the other
 * two: on Sepia and Paper its headings were near-black on near-black, and its
 * cards were dark rectangles on a cream page.
 *
 * So the frame carries the same custom properties the app sets on its own
 * `:root` — the identical block, from the identical function, which is the
 * only version of this that cannot drift. An extension styling with
 * `var(--text-1)` follows the theme for free. One that hardcodes its colours
 * at least gets a correct background and a readable default underneath them.
 *
 * `--accent` is added on top because the app's accent is a runtime override
 * rather than part of the theme, and an extension's primary button should be
 * the colour the rest of the app's primary buttons are.
 */
function pageTheme(theme, accentHex) {
  const vars = theme ? themeVars(theme) : '';
  return `    :root {
${vars}
      --accent: ${accentHex};
      color-scheme: ${theme?.meta?.isDark === false ? 'light' : 'dark'};
    }
    html, body {
      margin: 0; padding: 0;
      background: var(--app-bg, transparent);
      color: var(--text-1, inherit);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    * { box-sizing: border-box; }`;
}

function UiFilePage({ extension, pageDef, session, accentHex, onBack }) {
  // The page is a document of its own, so it inherits nothing — not the
  // theme's variables, not a font, not even a background. Which is why every
  // heading in Cloud Backup's pages was invisible on Sepia and Paper: the
  // extension had picked colours for a dark app and there was nothing in the
  // frame to tell it the app had stopped being dark.
  const { theme } = useTheme();
  const [srcdoc, setSrcdoc]     = useState(null);
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const iframeRef               = useRef(null);

  // ── Build srcdoc ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // The whole tree, not just the entry file.
        //
        // This used to read one file and inline it as a single
        // <script type="module">. A module in a srcdoc document has no base URL
        // to resolve `./helper.js` against, so any UI split across files failed
        // at load with a bare-specifier error — and every extension author who
        // hit it concluded, reasonably, that UI pages had to be one file.
        //
        // The background sandbox already solved this: hand the frame every
        // module and let it build blob URLs, leaves first. Same two functions,
        // same ordering, so the two halves of an extension now load the same
        // way.
        const files = await readExtensionTree(extension.id);
        if (cancelled) return;

        const entry = pageDef.file;
        if (!files[entry]) {
          setError(`Could not read ${entry} — make sure the extension is properly installed.`);
          return;
        }

        const { order, missing, cycle } = planModuleGraph(files, entry);
        if (cycle) {
          setError(`${entry} has a circular import: ${cycle.join(' → ')}`);
          return;
        }
        if (missing.length) {
          // Named rather than left to the browser, which would report a blob
          // URL this code invented instead of the path the author wrote.
          setError(`${missing[0].from} imports ${missing[0].spec}, which the extension does not ship.`);
          return;
        }

        const placeholders = {};
        order.forEach((path, i) => { placeholders[path] = `__authno_mod_${i}__`; });
        const modules = order.map((path) => ({
          path,
          source: rewriteSpecifiers(path, files[path], files, (t) => placeholders[t]),
        }));

        // A v2 page gets the SAME api object the background half gets, built
        // from the same source and routed through the same dispatch. That is
        // the whole difference from the v1 bridge below: this one is checked.
        //
        // v1's bridge hands out `getSessions`, `importSession` and
        // `encodeSession` with no permission check anywhere, so an extension
        // refused the library could open its own settings page and read every
        // book from there. It stays only for v1 extensions, and goes with them.
        const isV2 = extension?.apiVersion === 2;

        // The bridge shim is injected as an inline <script> that runs BEFORE
        // the extension script. It sets up window.CloudBackupAPI (and any future
        // window.*API objects) as async proxies backed by postMessage to the parent.
        //
        // Every storage.get / storage.set / navigate call from the extension UI
        // goes through this bridge — the iframe never needs direct filesystem access.
        const bridgeShim = isV2 ? pageApiV2() : `
(function() {
  var _pending = {};
  var _seq = 0;

  function call(method, args) {
    return new Promise(function(res, rej) {
      var id = ++_seq;
      _pending[id] = { res: res, rej: rej };
      window.parent.postMessage({ type: 'api-call', id: id, method: method, args: args }, '*');
    });
  }

  window.CloudBackupAPI = {
    getStatus:          function()          { return call('getStatus', []); },
    connectProvider:    function(k, c)      { return call('connectProvider', [k, c]); },
    disconnectProvider: function()          { return call('disconnectProvider', []); },
    resolveConflict:    function(id, r)     { return call('resolveConflict', [id, r]); },
    // Browser plugin bridge — @capacitor/browser can't be bare-imported inside
    // a sandboxed srcdoc iframe. The host app (webpack bundle) has it; proxy here.
    openBrowser:        function(url)       { return call('openBrowser', [url]); },
    closeBrowser:       function()          { return call('closeBrowser', []); },
    oauth:              function(opts)      { return call('oauth', [opts]); },
    storage: {
      get: function(k)    { return call('storage.get', [k]); },
      set: function(k, v) { return call('storage.set', [k, v]); },
    },
    navigate: function(ext, pageId, session) {
      return call('navigate', [pageId, session]);
    },
    // Feature A/B/E
    exportSessionAs:       function(s, fmt) { return call('exportSessionAs', [s, fmt]); },
    importSession:         function(b64)    { return call('importSession', [b64]); },
    getSessions:           function()       { return call('getSessions', []); },
    // Feature C
    isBookBackupDisabled:  function(id)      { return call('isBookBackupDisabled', [id]); },
    setBookBackupDisabled: function(id, val) { return call('setBookBackupDisabled', [id, val]); },
    // Sync now: uploads all enabled books then polls for cloud changes
    syncNow: function() { return call('syncNow', []); },
    // Proxy-based provider bridge — allows API.providers['dropbox'].listFiles(creds),
    // API.providers['dropbox'].download(sessionId, creds), and uploadRaw(filename, base64, creds)
    // from inside the sandboxed iframe without direct module access.
    providers: new Proxy({}, {
      get: function(_, providerKey) {
        return new Proxy({}, {
          get: function(__, method) {
            return function() {
              var args = Array.prototype.slice.call(arguments);
              return call('provider.' + method, [providerKey].concat(args));
            };
          }
        });
      }
    }),
    queue: null,
    extension: ${JSON.stringify(extension)},
  };

  // Generic host surface for ANY ui-file extension. The CloudBackup-specific
  // methods above are kept verbatim for compatibility; everything new belongs
  // here. Until now this was a thin subset, so a third-party extension that
  // wanted the library, an export, or a toast had to reach into
  // window.CloudBackupAPI and pretend to be the cloud-backup extension.
  window.AuthnoHostAPI = {
    version: 2,
    extension: window.CloudBackupAPI.extension,

    // ── Scoped key-value storage ────────────────────────────────────────────
    // Values are strings on the wire; the JSON helpers exist because every
    // extension was hand-rolling the same parse/stringify with the same
    // swallow-the-error bug.
    storage: {
      get: function(k)    { return call('storage.get', [k]); },
      set: function(k, v) { return call('storage.set', [k, v]); },
      remove: function(k) { return call('storage.set', [k, null]); },
      getJSON: function(k, fallback) {
        return call('storage.get', [k]).then(function(v) {
          if (v === null || v === undefined) return fallback === undefined ? null : fallback;
          try { return JSON.parse(v); } catch (e) { return fallback === undefined ? null : fallback; }
        });
      },
      setJSON: function(k, v) { return call('storage.set', [k, JSON.stringify(v)]); },
    },

    // ── Navigation & chrome ─────────────────────────────────────────────────
    navigate:     function(pageId, session) { return call('navigate', [pageId, session]); },
    close:        function() { window.parent.postMessage({ type: 'ext-close' }, '*'); },
    openBrowser:  function(url)  { return call('openBrowser', [url]); },
    closeBrowser: function()     { return call('closeBrowser', []); },
    // Open a provider, wait for the redirect to come home on
    // com.aurorastudios.authno://, resolve with its query parameters. Same
    // call, same rules, as the background half's host.oauth.
    oauth:        function(opts) { return call('oauth', [opts]); },
    // Play Services on Android, PKCE everywhere else. Same call either way.
    googleSignIn:      function(opts) { return call('googleSignIn', [opts]); },
    requestDriveToken: function(opts) { return call('native.GoogleDrive.requestDriveToken', [opts]); },
    toast:        function(message, opts) { return call('host.toast', [message, opts || {}]); },

    // ── Books ───────────────────────────────────────────────────────────────
    getSession:   function()     { return call('host.getSession', []); },
    getSessions:  function()     { return call('getSessions', []); },
    exportSessionAs: function(session, format) { return call('exportSessionAs', [session, format]); },
    importSession:   function(base64)          { return call('importSession', [base64]); },
    encodeSession:   function(session)         { return call('host.encodeSession', [session]); },
    // U9: associate the current book with a remote/external id — persisted on
    // the session and exposed back through the {externalId} template token.
    setBookExternalId: function(bookId, externalId) { return call('host.setBookExternalId', [bookId, externalId]); },

    // ── Extension config (the auth-form / manifest field store) ─────────────
    getConfig: function()      { return call('host.getConfig', []); },
    setConfig: function(patch) { return call('host.setConfig', [patch]); },

    // ── Host info ───────────────────────────────────────────────────────────
    getAppInfo: function() { return call('host.getAppInfo', []); },
  };

  // Expose Capacitor native plugins needed by extension code.
  // gdrive.js calls window.Capacitor.Plugins.GoogleDrive.requestDriveToken()
  // which is only available in the parent frame — bridge it here.
  window.Capacitor = window.Capacitor || {};
  window.Capacitor.Plugins = window.Capacitor.Plugins || {};
  window.Capacitor.Plugins.GoogleDrive = {
    requestDriveToken: function() { return call('native.GoogleDrive.requestDriveToken', []); },
  };

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || msg.type !== 'api-result') return;
    var p = _pending[msg.id];
    if (!p) return;
    delete _pending[msg.id];
    if (msg.error) p.rej(new Error(msg.error));
    else p.res(msg.result);
  });
})();
        `;

        // As a JSON block rather than interpolated into the loader's source:
        // extension code is arbitrary text, and the only character that can end
        // a script element early is `<`. Escaping it here means nothing in a
        // chapter of somebody's extension can close the tag around it.
        const modulesJson = JSON.stringify(modules).replace(/</g, '\\u003c');

        // The closing tag, assembled rather than written, so nothing that
        // scans this source treats it as the end of a script block.
        const close = `</${'script'}>`;

        const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
${pageTheme(theme, accentHex)}
  </style>
  <script>${bridgeShim}${close}
</head>
<body>
  <script type="application/json" id="authno-modules">${modulesJson}${close}
  <script>
    // Leaves first: a blob URL cannot be referenced before its content exists,
    // and each module's source already names the ones it imports.
    (function () {
      var mods = JSON.parse(document.getElementById('authno-modules').textContent);
      var urls = [];
      try {
        for (var i = 0; i < mods.length; i++) {
          var src = mods[i].source;
          for (var j = 0; j < urls.length; j++) {
            src = src.split('__authno_mod_' + j + '__').join(urls[j]);
          }
          urls.push(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        }
        import(urls[urls.length - 1]).catch(function (err) {
          parent.postMessage({ type: 'ext-page-error', error: String(err && err.message ? err.message : err) }, '*');
        });
      } catch (err) {
        parent.postMessage({ type: 'ext-page-error', error: String(err && err.message ? err.message : err) }, '*');
      }
    })();
  ${close}
</body>
</html>`;

        setSrcdoc(doc);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // theme and accent are in here because they are IN the document: the
    // frame has no way to inherit a variable, so a theme switch has to
    // rebuild it. Cheap — the modules are already read from disk by then.
  }, [extension, pageDef, theme, accentHex]);

  // ── Handle postMessage calls from the iframe ────────────────────────────────
  useEffect(() => {
    const extStorage = (() => {
      const ns = `__ext_kv_${extension.id}__`;
      return {
        get: (k) => localStorage.getItem(ns + k),
        set: (k, v) => {
          if (v === null || v === undefined) localStorage.removeItem(ns + k);
          else localStorage.setItem(ns + k, String(v));
        },
      };
    })();

    const handler = async (e) => {
      const msg = e.data;
      // ext-close: ConflictResolution (or any iframe page) signals a back navigation
      if (msg?.type === 'ext-close' && e.source === iframeRef.current?.contentWindow) {
        onBack?.();
        return;
      }
      if (!msg || msg.type !== 'api-call' || e.source !== iframeRef.current?.contentWindow) return;

      const { id, method, args } = msg;
      const reply = (result, error) => {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'api-result', id, result, error },
          '*'
        );
      };

      try {
        let result;

        // ── v2: one door, the same one ────────────────────────────────────
        //
        // Straight to the running extension's dispatch, so this page is
        // governed by the grants the user actually gave. If the extension is
        // not running there is no host to ask, and that is reported rather
        // than quietly falling through to the v1 branches below — which would
        // hand a v2 page the unchecked bridge and undo the entire point.
        if (extension?.apiVersion === 2) {
          const host = hostV2(extension.id);
          if (!host) {
            reply(undefined, 'This extension is not running.');
            return;
          }
          try {
            reply(await host.dispatch(method, args ?? []));
          } catch (err) {
            reply(undefined, String(err?.message ?? err));
          }
          return;
        }

        if (method === 'storage.get')  result = extStorage.get(args[0]);
        else if (method === 'storage.set') { extStorage.set(args[0], args[1]); result = null; }
        else if (method === 'getStatus') {
          // Pull live data from extension's own window.CloudBackupAPI if available
          const api = window.CloudBackupAPI;
          result = api?.getStatus ? await api.getStatus() : { activeProvider: null, tileStatus: 'synced', queueEntries: [] };
        }
        else if (method === 'connectProvider') {
          const api = window.CloudBackupAPI;
          if (!api?.connectProvider) throw new Error('connectProvider not available');
          result = await api.connectProvider(...args);
        }
        else if (method === 'disconnectProvider') {
          const api = window.CloudBackupAPI;
          if (!api?.disconnectProvider) throw new Error('disconnectProvider not available');
          result = await api.disconnectProvider();
        }
        else if (method === 'resolveConflict') {
          const api = window.CloudBackupAPI;
          if (!api?.resolveConflict) throw new Error('resolveConflict not available');
          result = await api.resolveConflict(...args);
        }
        else if (method === 'host.getSession') {
          // Strip heavy fields; the iframe only needs identity + text.
          result = session ? { id: session.id, title: session.title, externalId: session.externalId ?? '', chapters: (session.chapters || []).map(c => ({ chap_idx: c.chap_idx, title: c.title, order: c.order })) } : null;
        }
        else if (method === 'host.toast') {
          const { variant = 'info' } = args[1] ?? {};
          const { toast } = await import('../DesignSystem');
          toast(String(args[0] ?? ''), { variant });
          result = null;
        }
        else if (method === 'host.encodeSession') {
          const api = window.AuthNoExtensionAPI;
          if (!api?.encodeSession) throw new Error('encodeSession not available');
          result = await api.encodeSession(args[0]);
        }
        else if (method === 'host.getConfig') {
          const { getExtensionConfig } = await import('../utils/extensionLoader');
          result = getExtensionConfig(extension.id);
        }
        else if (method === 'host.setConfig') {
          const { setExtensionConfig } = await import('../utils/extensionLoader');
          setExtensionConfig(extension.id, args[0] ?? {});
          result = null;
        }
        else if (method === 'host.getAppInfo') {
          const { APP_VERSION, APP_NAME } = await import('../version');
          result = { name: APP_NAME, version: APP_VERSION, platform: isAndroid() ? 'android' : 'desktop' };
        }
        else if (method === 'host.setBookExternalId') {
          // U9: App owns session state — hand it the association via an event.
          window.dispatchEvent(new CustomEvent('authno-set-external-id', {
            detail: { bookId: args[0] ?? session?.id, externalId: args[1] },
          }));
          result = null;
        }
        else if (method === 'navigate') {
          // args[0] = pageId, args[1] = passedSession
          // Navigate to another page within the same extension
          window.dispatchEvent(new CustomEvent('__ext-navigate', {
            detail: { extension, pageId: args[0], session: args[1] ?? session }
          }));
          result = null;
        }
        else if (method === 'openBrowser') {
          await openInAppBrowser(args[0]);
          result = null;
        }
        // The same round trip the background half gets through host.oauth.
        // Shared rather than reimplemented: the redirect-scheme check inside it
        // is what stops an extension asking to be woken by the app's own
        // sign-in and reading the handoff that trades for an account.
        else if (method === 'oauth') {
          result = await oauthRoundTrip(args[0], (url) => openInAppBrowser(url));
        }
        else if (method === 'closeBrowser') {
          await closeInAppBrowser();
          result = null;
        }
        else if (method === 'exportSessionAs') {
          const api = window.AuthNoExtensionAPI;
          if (!api?.exportSessionAs) throw new Error('exportSessionAs not available');
          result = await api.exportSessionAs(args[0], args[1]);
        }
        else if (method === 'importSession') {
          const api = window.AuthNoExtensionAPI;
          if (!api?.importSession) throw new Error('importSession not available');
          result = await api.importSession(args[0]);
        }
        else if (method === 'getSessions') {
          const api = window.AuthNoExtensionAPI;
          result = api?.getSessions ? api.getSessions() : [];
        }
        else if (method === 'isBookBackupDisabled') {
          const api = window.CloudBackupAPI;
          result = api?.isBookBackupDisabled ? await api.isBookBackupDisabled(args[0]) : false;
        }
        else if (method === 'setBookBackupDisabled') {
          const api = window.CloudBackupAPI;
          if (api?.setBookBackupDisabled) await api.setBookBackupDisabled(args[0], args[1]);
          result = null;
        }
        else if (method === 'syncNow') {
          const api = window.CloudBackupAPI;
          if (!api?.syncNow) throw new Error(
            'syncNow not available on CloudBackupAPI. ' +
            'The extension may not be fully activated yet — try reopening Cloud Backup.'
          );
          console.log('[ext-bridge] syncNow started');
          try {
            await api.syncNow();
            console.log('[ext-bridge] syncNow finished');
          } catch (err) {
            throw new Error(`syncNow failed: ${err.message}`);
          }
          result = null;
        }
        else if (method.startsWith('provider.')) {
          const providerMethod = method.slice('provider.'.length);
          const providerKey    = args[0];
          const methodArgs     = args.slice(1);
          const api = window.CloudBackupAPI;
          const provider = api?.providers?.[providerKey];
          if (!provider) throw new Error(
            `Provider '${providerKey}' not available. ` +
            `Available: ${Object.keys(api?.providers ?? {}).join(', ') || 'none'}. ` +
            `Ensure the extension is active and CloudBackupAPI is initialised.`
          );
          if (typeof provider[providerMethod] !== 'function') throw new Error(
            `Provider '${providerKey}' has no method '${providerMethod}'. ` +
            `Available methods: ${Object.getOwnPropertyNames(Object.getPrototypeOf(provider)).filter(k => k !== 'constructor').join(', ')}`
          );
          console.log(`[ext-bridge] provider.${providerMethod}(${providerKey}, ...)`);
          try {
            result = await provider[providerMethod](...methodArgs);
          } catch (err) {
            // Re-throw with provider context so the error shown in the UI is actionable
            throw new Error(`[${providerKey}] ${providerMethod} failed: ${err.message}`);
          }
        }
        else if (method === 'native.GoogleDrive.requestDriveToken') {
          // Android: the native plugin, which derives the caller from the
          // package name and signing certificate and needs no client id.
          //
          // Everywhere else: the same PKCE flow the background half uses.
          // This branch used to be the native call unconditionally, so on a
          // laptop it failed with "ensure GoogleDrivePlugin is registered in
          // MainActivity.java and the app is rebuilt" — advice about a file
          // that does not exist on the platform the reader is standing on.
          if (isAndroid()) {
            const plugin = window.Capacitor?.Plugins?.GoogleDrive;
            if (!plugin?.requestDriveToken) throw new Error(
              'GoogleDrive native plugin not available in parent frame. ' +
              'Ensure GoogleDrivePlugin is registered in MainActivity.java and the app is rebuilt.'
            );
            result = await plugin.requestDriveToken();
          } else {
            const o = args[0] && typeof args[0] === 'object' ? args[0] : {};
            result = await desktopGoogleAuth({
              clientId: o.clientId,
              scopes: o.scopes ?? ['https://www.googleapis.com/auth/drive.file'],
              what: 'requestDriveToken',
            });
          }
        }
        else if (method === 'googleSignIn') {
          const o = (args[0] && typeof args[0] === 'object') ? args[0] : { clientId: args[0] };
          if (isAndroid()) {
            const plugin = window.Capacitor?.Plugins?.GoogleSignIn;
            if (!plugin?.signIn) throw new Error('GoogleSignIn native plugin not available');
            result = await plugin.signIn({ clientId: o.clientId });
          } else {
            result = await desktopGoogleAuth({
              clientId: o.clientId,
              scopes: o.scopes ?? ['openid', 'email', 'profile'],
              what: 'googleSignIn',
            });
          }
        }
        else throw new Error(`Unknown bridge method: ${method}`);

        reply(result, undefined);
      } catch (err) {
        reply(undefined, err.message);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  // onBack is reached through onBackRef, which is kept current by the effect
  // above. Listing it here would rebuild this listener on every parent render
  // that produces a fresh closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extension, session]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--text-4)' }}>
        <DSIcons.Refresh size={28} style={{ animation: 'dsSpinIcon 1s linear infinite' }} />
        <span style={{ fontSize: '13px' }}>Loading extension…</span>
      </div>
    );
  }

  if (error) {
    return (
      <StatusBox
        icon="⚠️"
        title="Extension failed to load"
        subtitle={error}
      />
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      title={pageDef.title ?? extension.name}
      // Shared with the background frame rather than spelled again. This one
      // used to add `allow-same-origin allow-forms allow-modals`, and on a
      // srcdoc document the first of those is the entire boundary — srcdoc
      // inherits the embedder's origin, so extension UI ran as the app.
      sandbox={FRAME_SANDBOX}
      style={{ display: 'flex', flex: 1, width: '100%', height: '100%', minHeight: '200px', border: 'none', background: 'transparent' }}
    />
  );
}

// ─── Page type: auth-form ─────────────────────────────────────────────────────

function AuthFormPage({ extension, accentHex, onBack }) {
  const { getConfig, setConfig, clearConfig } = useExtensions();
  const fields = extension.auth?.fields ?? [];
  const [values, setValues] = useState(() => {
    const stored = getConfig(extension.id);
    const init = {};
    fields.forEach(f => { init[f.key] = stored[f.key] ?? ''; });
    return init;
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setConfig(extension.id, values);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const handleClear = () => {
    clearConfig(extension.id);
    const empty = {};
    fields.forEach(f => { empty[f.key] = ''; });
    setValues(empty);
  };

  if (fields.length === 0) {
    return <StatusBox icon="ℹ️" title="No configuration needed" subtitle="This extension does not require any credentials." />;
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: '18px', marginBottom: '4px' }}>
          {extension.name} Account
        </div>
        <div style={{ color: 'var(--text-4)', fontSize: '13px' }}>
          {extension.description ?? 'Configure your credentials to enable this extension.'}
        </div>
      </div>

      {fields.map(f => (
        <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ color: 'var(--text-3)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            {f.label}
          </label>
          <input
            type={f.type === 'password' ? 'password' : 'text'}
            placeholder={f.hint ?? ''}
            value={values[f.key] ?? ''}
            onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px',
              background: 'var(--input-bg)', border: '1px solid var(--input-border)',
              borderRadius: '8px', color: 'var(--text-1)', fontSize: '14px', outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = accentHex}
            onBlur={e  => e.target.style.borderColor = 'var(--input-border)'}
          />
        </div>
      ))}

      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        <button
          onClick={handleSave}
          style={{
            flex: 1, padding: '11px', borderRadius: '8px',
            background: saved ? 'var(--color-success, #22c55e)' : accentHex,
            color: saved ? 'var(--on-success, #111113)' : 'var(--on-accent, #fff)', fontWeight: 700, fontSize: '14px',
            border: 'none', cursor: 'pointer', transition: 'background 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}
        >
          {saved ? <><DSIcons.Check size={16} /> Saved!</> : 'Save credentials'}
        </button>
        <button
          onClick={handleClear}
          style={{
            padding: '11px 16px', borderRadius: '8px',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-3)', fontSize: '13px', cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

// ─── Page type: webview ───────────────────────────────────────────────────────

/**
 * https, and only https.
 *
 * This page type drops a manifest-supplied address into an iframe that keeps
 * `allow-same-origin` — correct for a genuinely remote page, whose origin is
 * the extension author's server and cross-origin to the app either way. It is
 * not correct for a local one. Nothing checked the scheme, and on desktop the
 * app itself is a `file://` document: measured in Electron, an extension
 * naming `file:///…` got a frame that is same-origin with the app, could read
 * the file it named, and — being same-origin — could read the app back.
 * `allow-popups` then carries whatever it found anywhere it likes.
 *
 * `http://` is refused for the ordinary reason as well: the app has no address
 * bar, so a page loaded under its chrome cannot be seen to be insecure.
 */
export function isLoadablePageUrl(url) {
  try {
    return new URL(String(url)).protocol === 'https:';
  } catch {
    return false;
  }
}

function WebviewPage({ url, accentHex }) {
  const [failed, setFailed]   = useState(false);
  const [loading, setLoading] = useState(true);

  if (!url) return <StatusBox icon="⚠️" title="No URL configured" subtitle="This page does not have a URL specified in the manifest." />;
  if (!isLoadablePageUrl(url)) {
    return (
      <StatusBox
        icon="🚫"
        title="This page will not be loaded"
        subtitle={`Extension pages must be served over https. This one asks for ${String(url).slice(0, 80)}.`}
      />
    );
  }

  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {loading && !failed && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: '12px', color: 'var(--text-4)',
          zIndex: 2, background: 'var(--app-bg)',
        }}>
          <DSIcons.Refresh size={28} style={{ animation: 'dsSpinIcon 1s linear infinite' }} />
          <span style={{ fontSize: '13px' }}>Loading…</span>
          </div>
      )}
      {failed
        ? <StatusBox icon="🌐" title="Could not load page" subtitle={`The extension page at ${url} could not be displayed.`} />
        : <iframe
            src={url}
            title="Extension page"
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setFailed(true); }}
            // White on purpose, and the one literal in this file that should
            // stay: behind it is a page the extension author wrote, not ours,
            // and a themed ground would show through their transparent margins.
            style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
      }
      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: 'var(--app-bg)', flexShrink: 0 }}>
        <button onClick={() => { openInAppBrowser(url).catch(() => {}); }}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', border: 'none', color: accentHex, fontSize: '12px', cursor: 'pointer' }}>
          <DSIcons.Link size={13} /> Open in browser
        </button>
      </div>
    </div>
  );
}

// ─── Page type: api-data ──────────────────────────────────────────────────────

function ApiDataPage({ extension, page, session, accentHex }) {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const vars = sessionVars(session);
      const result = await callExtensionApi(extension, page.endpoint, page.method ?? 'GET', null, vars);
      setData(result);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [extension, page, session]);

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener('extension-api-refresh', h);
    return () => window.removeEventListener('extension-api-refresh', h);
  }, [load]);

  if (loading) return <StatusBox icon={<DSIcons.Refresh size={28} style={{ animation: 'dsSpinIcon 1s linear infinite' }} />} title="Loading data…" />;
  if (error)   return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <StatusBox icon="⚠️" title="Could not load data" subtitle={error} />
      <div style={{ padding: '0 24px 24px', display: 'flex', justifyContent: 'center' }}>
        <button onClick={load} style={{ padding: '8px 20px', borderRadius: '8px', background: accentHex, color: 'var(--on-accent, #fff)', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
          Retry
        </button>
      </div>
    </div>
  );

  const entries = Object.entries(data ?? {});
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: '12px', cursor: 'pointer' }}>
          <DSIcons.Refresh size={12} /> Refresh
        </button>
      </div>
      {entries.length === 0
        ? <StatusBox icon="📭" title="No data returned" subtitle="The API returned an empty response." />
        : entries.map(([key, val]) => (
          <div key={key} style={{ padding: '14px 16px', borderRadius: '12px', background: 'var(--surface)', border: '1px solid var(--border-sm)' }}>
            <div style={{ color: 'var(--text-3)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '4px' }}>
              {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
            </div>
            <div style={{ color: 'var(--text-1)', fontSize: '20px', fontWeight: 700 }}>
              {typeof val === 'object' ? JSON.stringify(val) : String(val)}
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ─── Page type: api-action ────────────────────────────────────────────────────

function ApiActionPage({ extension, page, session, accentHex, onBack }) {
  const vars    = sessionVars(session);
  const { getConfig } = useExtensions();
  const config  = getConfig(extension.id);
  const allVars = { ...vars, ...config };

  const [fields,  setFields]  = useState(() => {
    const init = {};
    if (page.bodyTemplate) {
      Object.entries(page.bodyTemplate).forEach(([k, v]) => {
        init[k] = typeof v === 'string' ? sub(v, allVars) : String(v);
      });
    }
    return init;
  });
  const [status,  setStatus]  = useState('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    setStatus('loading');
    try {
      await callExtensionApi(extension, page.endpoint, page.method ?? 'POST', page.bodyTemplate, allVars);
      setStatus('success');
      setMessage(page.successMessage ?? 'Done!');
      setTimeout(() => { setStatus('idle'); onBack?.(); }, 1800);
    } catch (e) { setStatus('error'); setMessage(e.message); }
  };

  if (status === 'success') return <StatusBox icon="✅" title={message} />;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: '18px' }}>{page.title}</div>
      {Object.entries(fields).map(([key, val]) => (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ color: 'var(--text-3)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
          </label>
          <textarea
            value={val}
            onChange={e => setFields(p => ({ ...p, [key]: e.target.value }))}
            rows={key.toLowerCase().includes('content') ? 8 : 2}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px', resize: 'vertical',
              background: 'var(--input-bg)', border: '1px solid var(--input-border)',
              borderRadius: '8px', color: 'var(--text-1)', fontSize: '13px',
              outline: 'none', fontFamily: 'inherit',
            }}
            onFocus={e => e.target.style.borderColor = accentHex}
            onBlur={e  => e.target.style.borderColor = 'var(--input-border)'}
          />
        </div>
      ))}
      {status === 'error' && (
        <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <DSIcons.Warning size={14} /> {message}
        </div>
      )}
      <button
        onClick={handleSubmit}
        disabled={status === 'loading'}
        style={{
          padding: '12px', borderRadius: '8px',
          background: status === 'loading' ? accentHex + '88' : accentHex,
          color: 'var(--on-accent, #fff)', fontWeight: 700, fontSize: '14px',
          border: 'none', cursor: status === 'loading' ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        }}
      >
        {status === 'loading'
          ? <><DSIcons.Refresh size={16} style={{ animation: 'dsSpinIcon 1s linear infinite' }} /> Processing…</>
          : page.submitLabel ?? 'Submit'}
      </button>
    </div>
  );
}

// ─── Main ExtensionPage ───────────────────────────────────────────────────────

export default function ExtensionPage({ extension, pageId, session, accentHex, onBack, inline = false }) {
  // v2 declares pages at the top level; v1 put them under `contributes`.
  // Both are checked because both shapes are installable right now, and a v2
  // extension whose page was looked for in the wrong place got "Page not
  // found" from every single ui.navigate — which reads as the extension being
  // broken rather than as the host looking in the wrong object.
  const pageDef = extension?.pages?.[pageId] ?? extension?.contributes?.pages?.[pageId];

  if (!pageDef) {
    return (
      <div style={inline
        ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'transparent', overflow: 'hidden' }
        : { position: 'fixed', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column', background: 'var(--app-bg)', overflow: 'hidden' }}>
        <PageHeader title={extension?.name ?? 'Extension'} onBack={onBack} accentHex={accentHex} />
        <StatusBox icon="❓" title="Page not found" subtitle={`The extension "${extension?.name}" does not declare a page with id "${pageId}".`} />
      </div>
    );
  }

  const headerAction = pageDef.type === 'api-data' ? (
    <button
      onClick={() => window.dispatchEvent(new Event('extension-api-refresh'))}
      style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '6px' }}
      aria-label="Refresh"
    >
      <DSIcons.Refresh size={16} />
    </button>
  ) : null;

  const title = pageDef.title ?? extension.name;

  return (
    <div style={inline
      ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'transparent', overflow: 'hidden' }
      : { position: 'fixed', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column', background: 'var(--app-bg)', overflow: 'hidden' }}>
      {!inline && <PageHeader title={title} onBack={onBack} accentHex={accentHex} action={headerAction} />}

      {pageDef.type === 'ui-file' && (
        <UiFilePage extension={extension} pageDef={pageDef} session={session} accentHex={accentHex} onBack={onBack} />
      )}
      {pageDef.type === 'auth-form' && (
        <AuthFormPage extension={extension} accentHex={accentHex} onBack={onBack} />
      )}
      {pageDef.type === 'webview' && (
        <WebviewPage url={pageDef.url} accentHex={accentHex} />
      )}
      {pageDef.type === 'api-data' && (
        <ApiDataPage extension={extension} page={pageDef} session={session} accentHex={accentHex} />
      )}
      {pageDef.type === 'api-action' && (
        <ApiActionPage extension={extension} page={pageDef} session={session} accentHex={accentHex} onBack={onBack} />
      )}
    </div>
  );
}
