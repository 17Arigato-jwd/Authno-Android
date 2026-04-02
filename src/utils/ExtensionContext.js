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

  // Scan once on mount
  useEffect(() => { refresh(); }, [refresh]);

  const getConfig   = useCallback((id) => getExtensionConfig(id),    []);
  const setConfig   = useCallback((id, p) => setExtensionConfig(id, p),  []);
  const clearConfig = useCallback((id) => clearExtensionConfig(id),  []);

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
    navigate,
  }), [extensions, loading, refresh, getConfig, setConfig, clearConfig, navigate]);

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
