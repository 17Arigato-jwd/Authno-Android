/**
 * ExtensionContext.js
 *
 * Provides discovered extensions to the whole React tree and exposes the
 * navigation callback so any component can open an extension page.
 *
 * Usage:
 *
 *   // In App.js
 *   <ExtensionProvider onNavigate={(ext, pageId, session) => { ... }}>
 *     <AppInner />
 *   </ExtensionProvider>
 *
 *   // In any component
 *   const { extensions, hasExtensions } = useExtensions();
 *   const homeTiles = useExtensionContributions('homescreen');
 *   const { tabs, actions } = useBookDashboardExtensions(session);
 *   const settingsItems = useExtensionContributions('settings');
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
} from './extensionLoader';
import {
  installExtbkBytes,
  uninstallExtension,
  seedPreinstalledExtensions,
} from './extbkInstaller';
import { registerHook } from './sessionHooks';

// ─── Context shape ────────────────────────────────────────────────────────────

const ExtensionContext = createContext({
  /** Array of validated manifest objects */
  extensions: [],
  /** True while the initial scan is running */
  loading: true,
  /** True once loading is done and at least one extension is installed */
  hasExtensions: false,
  /** Re-run the filesystem scan (call after user installs a new extension) */
  refresh: async () => {},
  /** Get the stored config for a specific extension */
  getConfig: (_extId) => ({}),
  /** Merge-save config fields for a specific extension */
  setConfig: (_extId, _patch) => {},
  /** Clear all stored config for a specific extension */
  clearConfig: (_extId) => {},
  /**
   * Install a .extbk archive from a base64 string, then refresh.
   * Dispatched by MainActivity when the user taps an .extbk file.
   * @param {string} base64
   * @returns {Promise<object>} validated manifest
   */
  installExtbk: async (_base64) => {},
  /**
   * Uninstall an extension by id, then refresh.
   * @param {string} extId
   */
  uninstall: async (_extId) => {},
  /**
   * Register a session-lifecycle hook (e.g. 'onSave').
   * Returns an unregister function — call it in useEffect cleanup.
   * @param {string}   hookName
   * @param {function} handler
   * @returns {function}
   */
  registerHook: (_hookName, _handler) => () => {},
  /**
   * Navigate to an extension page.
   * Implemented in App.js and injected via the onNavigate prop.
   * @param {object} extension - the manifest object
   * @param {string} pageId    - key in manifest.contributes.pages
   * @param {object|null} session - current book session (or null)
   */
  navigate: (_extension, _pageId, _session) => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * @param {function} onNavigate — called with (extension, pageId, session)
 *                                when any part of the app wants to open an
 *                                extension page.  Implemented in App.js.
 */
export function ExtensionProvider({ children, onNavigate }) {
  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading]       = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const found = await discoverExtensions();
      setExtensions(found);
    } catch {
      setExtensions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // On mount: seed pre-installed .extbk files from Android assets, then scan
  useEffect(() => {
    (async () => {
      try { await seedPreinstalledExtensions(); } catch (_) {}
      await refresh();
    })();
  }, [refresh]);

  // Listen for .extbk install events dispatched by MainActivity
  useEffect(() => {
    const onInstallBytes = async (e) => {
      const { base64 } = e.detail ?? {};
      if (!base64) return;
      try {
        await installExtbkBytes(base64);
        await refresh();
      } catch (err) {
        console.error('[ExtensionContext] install-extbk-bytes failed:', err);
      }
    };
    const onInstallError = (e) => {
      console.error('[ExtensionContext] install-extbk-error from native:', e.detail);
    };
    window.addEventListener('install-extbk-bytes', onInstallBytes);
    window.addEventListener('install-extbk-error', onInstallError);

    // ── Cold-start .extbk recovery ─────────────────────────────────────────
    // If the app launched cold from tapping an .extbk file, the evaluateJavascript
    // event fired before these listeners registered.  Call getPendingExtbkIntent()
    // now (after listeners are live) to pick it up.
    (async () => {
      try {
        const { registerPlugin } = await import('@capacitor/core');
        const plugin = registerPlugin('AuthnoFilePicker');
        const result = await plugin.getPendingExtbkIntent();
        if (result?.hasPending && result.base64) {
          window.dispatchEvent(new CustomEvent('install-extbk-bytes', {
            detail: { base64: result.base64 },
          }));
        }
      } catch (_) { /* not on Android or plugin unavailable — ignore */ }
    })();

    return () => {
      window.removeEventListener('install-extbk-bytes', onInstallBytes);
      window.removeEventListener('install-extbk-error', onInstallError);
    };
  }, [refresh]);

  const getConfig   = useCallback((id) => getExtensionConfig(id),         []);
  const setConfig   = useCallback((id, p) => setExtensionConfig(id, p),   []);
  const clearConfig = useCallback((id) => clearExtensionConfig(id),       []);

  const installExtbk = useCallback(async (base64) => {
    const manifest = await installExtbkBytes(base64);
    await refresh();
    return manifest;
  }, [refresh]);

  const uninstall = useCallback(async (extId) => {
    await uninstallExtension(extId);
    await refresh();
  }, [refresh]);

  const navigate = useCallback((ext, pageId, session = null) => {
    onNavigate?.(ext, pageId, session);
  }, [onNavigate]);

  const value = useMemo(() => ({
    extensions,
    loading,
    hasExtensions: !loading && extensions.length > 0,
    refresh,
    getConfig,
    setConfig,
    clearConfig,
    installExtbk,
    uninstall,
    registerHook,
    navigate,
  }), [extensions, loading, refresh, getConfig, setConfig, clearConfig, installExtbk, uninstall, navigate]);

  return (
    <ExtensionContext.Provider value={value}>
      {children}
    </ExtensionContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Access the full extension context */
export function useExtensions() {
  return useContext(ExtensionContext);
}

/**
 * Collect all contributions of a given type across every installed extension.
 *
 * type: 'homescreen' | 'settings'
 *
 * Returns an array where each item is a contribution descriptor merged with
 * _extId, _extName, and _extIcon from the parent manifest so callers can
 * render the extension's identity alongside each item.
 */
export function useExtensionContributions(type) {
  const { extensions } = useExtensions();
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
    return results;
  }, [extensions, type]);
}

/**
 * Get BookDashboard-specific contributions (tabs + actions) for all installed
 * extensions.  Both arrays include the _ext* identity fields.
 */
export function useBookDashboardExtensions() {
  const { extensions } = useExtensions();
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
    return { tabs, actions };
  }, [extensions]);
}

/**
 * Get editor toolbar button contributions from all installed extensions.
 *
 * Extensions declare these in their manifest under:
 *   contributes.editorToolbar: [
 *     { id: "publishChapter", label: "Publish Chapter", icon: "Upload", page: "publish" }
 *   ]
 *
 * Each item includes _ext, _extId, _extName for identity.
 */
export function useEditorToolbarExtensions() {
  const { extensions } = useExtensions();
  return useMemo(() => {
    const buttons = [];
    for (const ext of extensions) {
      const items = ext.contributes?.editorToolbar;
      if (!Array.isArray(items)) continue;
      const meta = { _extId: ext.id, _extName: ext.name, _ext: ext };
      items.forEach(item => buttons.push({ ...item, ...meta }));
    }
    return buttons;
  }, [extensions]);
}
