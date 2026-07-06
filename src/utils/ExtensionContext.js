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
} from './extensionLoader';
import {
  installExtbkBytes,
  uninstallExtension,
  seedPreinstalledExtensions,
} from './extbkInstaller';
import { installThmbkBytes, refreshInstalledThemes } from './themeLoader';
import { emitInstall, newInstallId } from './installEvents';
import { isPro, subscribeEntitlement } from './entitlements';
import { registerHook } from './sessionHooks';
import {
  activateExtension,
  deactivateExtension,
  deactivateAll,
} from './extensionRuntime';

// ─── Context shape ────────────────────────────────────────────────────────────

const ExtensionContext = createContext({
  extensions: [],
  loading: true,
  hasExtensions: false,
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

export function ExtensionProvider({ children, onNavigate }) {
  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading]       = useState(true);

  // ── Core refresh — discover + activate ─────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const found = await discoverExtensions();

      // Deactivate all running extensions before re-activating
      await deactivateAll();

      // U10: premium-tier extensions require Pro. Locked extensions stay
      // visible in the list (with an upgrade prompt) but are never activated,
      // so their code and hooks don't run on the free tier.
      const pro = isPro();
      const annotated = found.map(m => ({ ...m, _locked: m.tier === 'premium' && !pro }));
      setExtensions(annotated);

      // Activate each unlocked extension
      for (const manifest of annotated) {
        if (manifest._locked) continue;
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
        const manifest = await installExtbkBytes(base64, { installId });
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
    const manifest = await installExtbkBytes(base64);
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

export function useExtensions() {
  return useContext(ExtensionContext);
}

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
