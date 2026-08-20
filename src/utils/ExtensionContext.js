/**
 * ExtensionContext.js
 *
 * Changes from v1.1.14:
 *   - Imports extensionRuntime (activateExtension, deactivateExtension, deactivateAll)
 *   - refresh() now activates every discovered extension after the disk scan
 *   - uninstall() deactivates the extension before removing it
 *   - Provider unmount deactivates all running extensions
 */

import React, {
  createContext, useContext, useState,
  useEffect, useCallback, useMemo,
} from 'react';
import {
  discoverExtensions,
  getExtensionConfig,
  setExtensionConfig,
  clearExtensionConfig,
  satisfiesMinAppVersion,
} from './extensionLoader';
import {
  installExtbkBytes,
  uninstallExtension,
  seedPreinstalledExtensions,
} from './extbkInstaller';
import { installThmbkBytes, refreshInstalledThemes } from './themeLoader';
import { emitInstall, newInstallId } from './installEvents';
import { permissionRequests } from './permissionRequests';
import { logError } from './ErrorLogger';
import { isPro, subscribeEntitlement } from './entitlements';
import { registerHook } from './sessionHooks';
import {
  activateExtension,
  deactivateExtension,
  deactivateAll,
} from './extensionRuntime';
import { whenAllows, whenContext } from './whenClause';
import { readGrants } from './extensionGrants';
import { getPlatform } from './deviceId';
import { APP_VERSION } from '../version';

// ─── Context shape ────────────────────────────────────────────────────────────

const ExtensionContext = createContext({
  extensions: [],
  loading: true,
  hasExtensions: false,
  // Non-null when discovery could not READ the store. Distinct from an empty
  // `extensions`, which means there is genuinely nothing installed.
  discoveryError: null,
  refresh: async () => {},
  getConfig: (_extId) => ({}),
  setConfig: (_extId, _patch) => {},
  clearConfig: (_extId) => {},
  installExtbk: async (_base64) => {},
  uninstall: async (_extId) => {},
  registerHook: (_hookName, _handler) => () => {},
  navigate: (_extension, _pageId, _session) => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * How an install asks the person, and what happens when it cannot.
 *
 * Passed to every install path rather than only the interactive one, because
 * the paths that skip it are exactly the ones a person is least likely to
 * revisit: a cold-start intent, a share-sheet handoff, a seeded pre-install.
 * Those all end with `_permissionsPending` and an extension that runs, does
 * nothing, and explains nothing.
 *
 * A rejection — the queue is full — is caught rather than thrown. The install
 * has already happened at this point; failing it now would leave files on disk
 * that no manifest lists.
 */
function askViaSheet(extId, plan, meta) {
  return permissionRequests().ask(extId, plan, meta).catch((e) => {
    console.warn(`[ExtensionContext] could not ask about ${extId}:`, e.message);
    return plan?.carried ?? [];
  });
}

export function ExtensionProvider({ children, onNavigate }) {
  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [discoveryError, setDiscoveryError] = useState(null);

  // ── Core refresh — discover + activate ─────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const found = await discoverExtensions();

      // Discovery could not read the store — not "there is nothing here".
      // Keep whatever is already on screen rather than replacing it with an
      // empty list, because blanking the list is indistinguishable from the
      // extensions having been uninstalled.
      if (found.error) {
        logError('ExtensionContext:discoveryFailed', found.error);
        setDiscoveryError(found.error);
        setLoading(false);
        return;
      }
      setDiscoveryError(null);

      // Deactivate all running extensions before re-activating
      await deactivateAll();

      // U10: premium-tier extensions require Pro. Locked extensions stay
      // visible in the list (with an upgrade prompt) but are never activated,
      // so their code and hooks don't run on the free tier.
      //
      // minAppVersion was previously declared-and-ignored: an extension built
      // against a newer API installed fine and then failed at some arbitrary
      // point deep inside activate(). It's now a first-class gate with the same
      // shape as the tier lock, so the list can explain the real reason.
      const pro = isPro();
      const annotated = found.map(m => ({
        ...m,
        _locked: m.tier === 'premium' && !pro,
        _tooOld: !satisfiesMinAppVersion(m),
      }));
      setExtensions(annotated);

      // Activate each unlocked extension
      for (const manifest of annotated) {
        if (manifest._locked) continue;
        if (manifest._tooOld) {
          console.warn(
            `[ExtensionContext] ${manifest.id} needs AuthNo ${manifest.minAppVersion} or newer — not activating.`,
          );
          continue;
        }
        try {
          await activateExtension(manifest, onNavigate);
        } catch (err) {
          console.error(`[ExtensionContext] Failed to activate ${manifest.id}:`, err);
        }
      }
    } catch {
      setExtensions([]);
    } finally {
      setLoading(false);
    }
  }, [onNavigate]);

  // Re-scan when the entitlement changes so a fresh Pro unlock immediately
  // activates previously locked premium extensions.
  useEffect(() => subscribeEntitlement(() => { refresh(); }), [refresh]);

  // Deactivate everything when provider unmounts (dev HMR / page unload)
  useEffect(() => () => { deactivateAll(); }, []);

  // On mount: seed pre-installed .extbk files from Android assets, then scan.
  // Also discover installed .thmbk themes so the picker includes them.
  useEffect(() => {
    (async () => {
      try { await seedPreinstalledExtensions(); } catch (_) {}
      try { await refreshInstalledThemes(); } catch (_) {}
      await refresh();
    })();
  }, [refresh]);

  // Listen for .extbk install events dispatched by MainActivity
  useEffect(() => {
    const onInstallBytes = async (e) => {
      const { base64, installId } = e.detail ?? {};
      if (!base64) return;
      try {
        const manifest = await installExtbkBytes(base64, { installId, askPermissions: askViaSheet });
        await refresh();
        emitInstall({ id: manifest._installId ?? installId ?? newInstallId(), kind: 'extension', stage: 'done', name: manifest.name, version: manifest.version, fromVersion: manifest._fromVersion });
      } catch (err) {
        console.error('[ExtensionContext] install-extbk-bytes failed:', err);
        // installExtbkBytes already emitted an 'error' event for the sheet.
      }
    };
    const onInstallError = (e) => {
      console.error('[ExtensionContext] install-extbk-error from native:', e.detail);
      emitInstall({ id: newInstallId(), kind: 'extension', stage: 'error', error: typeof e.detail === 'string' ? e.detail : 'Install failed' });
    };
    // .thmbk theme installs share the same native intent surface.
    const onInstallTheme = async (e) => {
      const { base64, installId } = e.detail ?? {};
      if (!base64) return;
      try { await installThmbkBytes(base64, { installId }); }
      catch (err) { console.error('[ExtensionContext] install-thmbk-bytes failed:', err); }
    };
    window.addEventListener('install-extbk-bytes', onInstallBytes);
    window.addEventListener('install-extbk-error', onInstallError);
    window.addEventListener('install-thmbk-bytes', onInstallTheme);

    // Cold-start .extbk / .thmbk recovery
    (async () => {
      try {
        const { registerPlugin } = await import('@capacitor/core');
        const plugin = registerPlugin('AuthnoFilePicker');
        const result = await plugin.getPendingExtbkIntent();
        if (result?.hasPending && result.base64) {
          const evName = result.kind === 'theme' ? 'install-thmbk-bytes' : 'install-extbk-bytes';
          window.dispatchEvent(new CustomEvent(evName, { detail: { base64: result.base64 } }));
        }
      } catch (_) {}
    })();

    return () => {
      window.removeEventListener('install-extbk-bytes', onInstallBytes);
      window.removeEventListener('install-extbk-error', onInstallError);
      window.removeEventListener('install-thmbk-bytes', onInstallTheme);
    };
  }, [refresh]);

  const getConfig   = useCallback((id) => getExtensionConfig(id),       []);
  const setConfig   = useCallback((id, p) => setExtensionConfig(id, p), []);
  const clearConfig = useCallback((id) => clearExtensionConfig(id),     []);

  const installExtbk = useCallback(async (base64) => {
    const manifest = await installExtbkBytes(base64, { askPermissions: askViaSheet });
    await refresh();
    emitInstall({ id: manifest._installId ?? newInstallId(), kind: 'extension', stage: 'done', name: manifest.name, version: manifest.version, fromVersion: manifest._fromVersion });
    return manifest;
  }, [refresh]);

  // Deactivate before removing from disk so hooks are cleaned up
  const uninstall = useCallback(async (extId) => {
    await deactivateExtension(extId);
    await uninstallExtension(extId);
    await refresh();
  }, [refresh]);

  const navigate = useCallback((ext, pageId, session = null) => {
    onNavigate?.(ext, pageId, session);
  }, [onNavigate]);

  const value = useMemo(() => ({
    extensions,
    loading,
    discoveryError,
    hasExtensions: !loading && extensions.length > 0,
    refresh,
    getConfig,
    setConfig,
    clearConfig,
    installExtbk,
    uninstall,
    registerHook,
    navigate,
  }), [extensions, loading, discoveryError, refresh, getConfig, setConfig, clearConfig, installExtbk, uninstall, navigate]);

  return (
    <ExtensionContext.Provider value={value}>
      {children}
    </ExtensionContext.Provider>
  );
}

// ─── `when` ──────────────────────────────────────────────────────────────────

/**
 * Decide which contributions are on screen right now.
 *
 * `whenClause.js` has parsed, evaluated and tested this expression language
 * since the v2 work, and `extensionHostV2` refuses to install a manifest whose
 * clauses do not parse. Nothing ever *evaluated* one. A `when` was checked for
 * syntax at install and then thrown away, so
 *
 *     "when": "ext.hasPermission('network')"
 *
 * put the button on screen for somebody who had said no to the network — and
 * pressing it did the only thing it could, which is fail. The author wrote the
 * rule that would have hidden it, the app read the rule, and then ignored it.
 *
 * Grants and settings are read per extension and cached for the pass, because
 * both come from localStorage and a book with a dozen contributions would
 * otherwise re-read the same two keys a dozen times inside one render.
 */
function visibleContributions(items, book) {
  const app = { platform: getPlatform(), version: APP_VERSION };
  const perExt = new Map();

  return items.filter((item) => {
    if (!item.when) return true;

    let cached = perExt.get(item._extId);
    if (!cached) {
      cached = {
        ctx: whenContext({ app, book, settings: getExtensionConfig(item._extId) }),
        grants: readGrants(item._extId).granted ?? [],
      };
      perExt.set(item._extId, cached);
    }

    // A clause that does not parse hides its contribution rather than throwing
    // into a render. Installation should already have caught it — this is the
    // manifest that got past validation, and a blank screen would be a worse
    // way to find out than a missing button and a line in the log.
    return whenAllows(item.when, cached.ctx, cached.grants, (e) => {
      warnClauseOnce(item._extId, item.when, e);
    });
  });
}

/**
 * One warning per bad clause, not one per render.
 *
 * A contribution is re-evaluated whenever the book changes, which while
 * somebody is typing is often. A `console.warn` on the render path with no
 * memory turns one broken clause into a log nobody can read past.
 */
const warnedClauses = new Set();
function warnClauseOnce(extId, clause, err) {
  const key = `${extId} ${clause}`;
  if (warnedClauses.has(key)) return;
  warnedClauses.add(key);
  console.warn(`[ExtensionContext] ${extId} has a "when" that does not parse: ${err.message}`);
}

/**
 * The book, as a `when` clause sees it.
 *
 * A session is the app's object and carries far more than a visibility rule
 * has any business reading. `isSaved` is `filePath`, because on disk is what
 * saved means here — an unsaved draft has never been written anywhere.
 */
function bookFacts(session) {
  return {
    isOpen: !!session,
    isSaved: !!session?.filePath,
    chapterCount: session?.chapters?.length ?? 0,
  };
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useExtensions() {
  return useContext(ExtensionContext);
}

/**
 * Contributions of one kind, filtered by their `when`.
 *
 * `session` is optional: the home screen and the settings list are not inside
 * a book, and a clause asking about one there is answered with "there isn't
 * one" rather than being skipped.
 */
export function useExtensionContributions(type, session = null) {
  const { extensions } = useExtensions();
  const { isOpen, isSaved, chapterCount } = bookFacts(session);
  return useMemo(() => {
    const results = [];
    for (const ext of extensions) {
      const section = ext.contributes?.[type];
      if (!section) continue;
      const items = Array.isArray(section) ? section : [];
      items.forEach(item => results.push({
        ...item,
        _extId:   ext.id,
        _extName: ext.name,
        _extIcon: ext.icon ?? '🧩',
        _ext:     ext,
      }));
    }
    return visibleContributions(results, { isOpen, isSaved, chapterCount });
    // Keyed on what a clause can actually read, not on the session's identity.
    // App.js hands down a fresh object on every keystroke, and depending on
    // that would re-read every extension's grants from localStorage as
    // somebody types.
  }, [extensions, type, isOpen, isSaved, chapterCount]);
}

export function useBookDashboardExtensions(session = null) {
  const { extensions } = useExtensions();
  const { isOpen, isSaved, chapterCount } = bookFacts(session);
  return useMemo(() => {
    const tabs    = [];
    const actions = [];
    for (const ext of extensions) {
      const bd = ext.contributes?.bookDashboard;
      if (!bd) continue;
      const meta = { _extId: ext.id, _extName: ext.name, _extIcon: ext.icon ?? null, _ext: ext };
      (bd.tabs    ?? []).forEach(t => tabs.push({ ...t,    ...meta }));
      (bd.actions ?? []).forEach(a => actions.push({ ...a, ...meta }));
    }
    const book = { isOpen, isSaved, chapterCount };
    return {
      tabs: visibleContributions(tabs, book),
      actions: visibleContributions(actions, book),
    };
  }, [extensions, isOpen, isSaved, chapterCount]);
}

export function useEditorToolbarExtensions(session = null) {
  const { extensions } = useExtensions();
  const { isOpen, isSaved, chapterCount } = bookFacts(session);
  return useMemo(() => {
    const buttons = [];
    for (const ext of extensions) {
      const items = ext.contributes?.editorToolbar;
      if (!Array.isArray(items)) continue;
      const meta = { _extId: ext.id, _extName: ext.name, _ext: ext };
      items.forEach(item => buttons.push({ ...item, ...meta }));
    }
    return visibleContributions(buttons, { isOpen, isSaved, chapterCount });
  }, [extensions, isOpen, isSaved, chapterCount]);
}
