/**
 * themeLoader.js — installs and discovers downloadable .thmbk themes (U4).
 *
 * Installed layout (mirrors extensions):
 *   AuthNo/themes/<manifest.id>/manifest.json
 *   AuthNo/themes/<manifest.id>/theme.json
 *
 * Non-Android platforms fall back to a localStorage dev store so themes can be
 * developed and tested in the web sandbox exactly like dev extensions.
 *
 * Loaded themes are merged over DARK_DEFAULT via createTheme(), so a partial
 * .thmbk (say, only accent + backgrounds) still yields a complete, safe theme.
 */

import { isAndroid } from './platform';
import { unpackThmbk } from './thmbkFormat';
import { emitInstall, newInstallId } from './installEvents';
import { logError } from './ErrorLogger';
import { createTheme } from '../theme/ThemeBase';
import { setInstalledThemes } from '../theme/registry';

const THEMES_DIR = 'AuthNo/themes';
const DEV_STORE  = '__authno_dev_themes';

async function fs() {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  return { Filesystem, Directory };
}

function b64encodeUtf8(str) { return btoa(unescape(encodeURIComponent(str))); }
function base64ToBytes(b64) {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── Install ──────────────────────────────────────────────────────────────────

export async function installThmbkBytes(base64, { installId } = {}) {
  const id   = installId ?? newInstallId();
  const emit = (evt) => emitInstall({ id, kind: 'theme', ...evt });

  try {
    emit({ stage: 'validating' });
    const bytes = base64ToBytes(base64);

    emit({ stage: 'decoding' });
    const { manifest, theme } = await unpackThmbk(bytes);

    const previous = await readInstalledThemeManifest(manifest.id);
    const fromVersion = previous?.version;

    emit({ stage: 'writing', name: manifest.name, version: manifest.version, fromVersion, fileCount: 2, filesWritten: 0, progress: 0 });

    if (isAndroid()) {
      const { Filesystem, Directory } = await fs();
      try { await Filesystem.mkdir({ path: `${THEMES_DIR}/${manifest.id}`, directory: Directory.Data, recursive: true }); } catch (_) {}
      await Filesystem.writeFile({ path: `${THEMES_DIR}/${manifest.id}/manifest.json`, data: b64encodeUtf8(JSON.stringify(manifest, null, 2)), directory: Directory.Data, recursive: true });
      emit({ stage: 'writing', name: manifest.name, version: manifest.version, fromVersion, fileCount: 2, filesWritten: 1, progress: 0.5 });
      await Filesystem.writeFile({ path: `${THEMES_DIR}/${manifest.id}/theme.json`, data: b64encodeUtf8(JSON.stringify(theme, null, 2)), directory: Directory.Data, recursive: true });
    } else {
      const store = _devStore();
      store[manifest.id] = { manifest, theme };
      localStorage.setItem(DEV_STORE, JSON.stringify(store));
      emit({ stage: 'writing', name: manifest.name, version: manifest.version, fromVersion, fileCount: 2, filesWritten: 1, progress: 0.5 });
    }

    emit({ stage: 'activating', name: manifest.name, version: manifest.version, fromVersion });
    await refreshInstalledThemes();
    emit({ stage: 'done', name: manifest.name, version: manifest.version, fromVersion });
    console.log(`[themeLoader] ${fromVersion ? 'Updated' : 'Installed'} theme: ${manifest.id} v${manifest.version}`);
    return manifest;
  } catch (err) {
    emit({ stage: 'error', error: err?.message ?? String(err) });
    logError('themeLoader:install', err);
    throw err;
  }
}

export async function uninstallTheme(themeId) {
  if (!/^[\w.-]+$/.test(themeId) || themeId.includes('..'))
    throw new Error(`Invalid theme id: ${themeId}`);
  if (isAndroid()) {
    const { Filesystem, Directory } = await fs();
    await Filesystem.rmdir({ path: `${THEMES_DIR}/${themeId}`, directory: Directory.Data, recursive: true });
  } else {
    const store = _devStore();
    delete store[themeId];
    localStorage.setItem(DEV_STORE, JSON.stringify(store));
  }
  await refreshInstalledThemes();
}

// ─── Discovery ────────────────────────────────────────────────────────────────

async function readInstalledThemeManifest(themeId) {
  try {
    if (isAndroid()) {
      const { Filesystem, Directory } = await fs();
      const res = await Filesystem.readFile({ path: `${THEMES_DIR}/${themeId}/manifest.json`, directory: Directory.Data, encoding: 'utf8' });
      return JSON.parse(res.data);
    }
    return _devStore()[themeId]?.manifest ?? null;
  } catch { return null; }
}

function _devStore() {
  try { return JSON.parse(localStorage.getItem(DEV_STORE) || '{}') || {}; }
  catch { return {}; }
}

/**
 * Scan installed themes, build full theme objects (merged over DARK_DEFAULT),
 * and publish them to the theme registry so the Settings picker sees them.
 * Returns the array of built themes.
 */
export async function refreshInstalledThemes() {
  const built = [];
  try {
    if (isAndroid()) {
      const { Filesystem, Directory } = await fs();
      let entries = [];
      try {
        const res = await Filesystem.readdir({ path: THEMES_DIR, directory: Directory.Data });
        entries = (res.files ?? []).map(f => (typeof f === 'string' ? f : f.name)).filter(Boolean);
      } catch { entries = []; }
      for (const dir of entries) {
        try {
          const mRes = await Filesystem.readFile({ path: `${THEMES_DIR}/${dir}/manifest.json`, directory: Directory.Data, encoding: 'utf8' });
          const tRes = await Filesystem.readFile({ path: `${THEMES_DIR}/${dir}/theme.json`,    directory: Directory.Data, encoding: 'utf8' });
          const manifest = JSON.parse(mRes.data);
          const raw      = JSON.parse(tRes.data);
          built.push(_buildTheme(manifest, raw));
        } catch (e) { logError('themeLoader:scan', e, { dir }); }
      }
    } else {
      const store = _devStore();
      for (const { manifest, theme } of Object.values(store)) {
        try { built.push(_buildTheme(manifest, theme)); }
        catch (e) { logError('themeLoader:scan-dev', e); }
      }
    }
  } catch (e) {
    logError('themeLoader:refresh', e);
  }
  setInstalledThemes(built);
  return built;
}

function _buildTheme(manifest, raw) {
  const theme = createTheme({
    ...raw,
    meta: {
      ...(raw.meta ?? {}),
      id:        manifest.id,
      name:      raw.meta?.name ?? manifest.name,
      isDark:    raw.meta?.isDark ?? true,
      installed: true,
      version:   manifest.version,
      author:    manifest.author ?? raw.meta?.author ?? '',
    },
  });
  return theme;
}
