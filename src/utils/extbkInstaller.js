/**
 * extbkInstaller.js — v1.1.14  (VCHS-ECS binary format)
 *
 * Installs, seeds, and removes .extbk extension bundles.
 * The .extbk format is a modified VCHS-ECS binary container (NOT a ZIP):
 *   MNFT  section — manifest.json
 *   ENTR  section — index.js
 *   ASST  sections — asset files (relative paths preserved)
 *   RSPX  sections — Reed-Solomon parity per primary section
 *
 * Installation path: AuthNo/extensions/<manifest.id>/
 *
 * Public API
 * ----------
 *   installExtbkBytes(base64)         → Promise<manifest>
 *   installExtbkFromUri(uri)          → Promise<manifest>
 *   seedPreinstalledExtensions()      → Promise<void>
 *   uninstallExtension(extId)         → Promise<void>
 *   isExtensionInstalled(extId)       → Promise<boolean>
 */

import { logError }     from './ErrorLogger';
import { unpackExtbk, validateExtbk, FILE_MAGIC } from './extbkFormat';
import { emitInstall, newInstallId } from './installEvents';
import { isAndroid }    from './platform';

const EXTENSIONS_DIR = 'AuthNo/extensions';
const ASSETS_PLUGIN  = 'ExtbkAssets';

// ─── Base64 helpers ───────────────────────────────────────────────────────────

function base64ToBytes(b64) {
  const bin   = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ─── Filesystem helpers ───────────────────────────────────────────────────────

async function fs() {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  return { Filesystem, Directory };
}

async function writeExtensionFile(Filesystem, Directory, extId, relPath, data) {
  // Create parent directories
  const parts  = relPath.split('/');
  const relDir = parts.slice(0, -1).join('/');
  if (relDir) {
    try {
      await Filesystem.mkdir({
        path: `${EXTENSIONS_DIR}/${extId}/${relDir}`,
        directory: Directory.Data,
        recursive: true,
      });
    } catch (_) {}
  }

  const b64 = data instanceof Uint8Array ? bytesToBase64(data) : btoa(unescape(encodeURIComponent(data)));

  await Filesystem.writeFile({
    path: `${EXTENSIONS_DIR}/${extId}/${relPath}`,
    data: b64,
    directory: Directory.Data,
    recursive: true,
  });
}

// ─── Manifest validation (mirrors format.js validateManifest) ─────────────────

function validateManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('manifest must be a JSON object');
  if (!raw.id      || typeof raw.id      !== 'string') throw new Error('manifest.id is required');
  if (!raw.name    || typeof raw.name    !== 'string') throw new Error('manifest.name is required');
  if (!raw.version || typeof raw.version !== 'string') throw new Error('manifest.version is required');
  if (!/^[\w.-]+$/.test(raw.id)) throw new Error('manifest.id must be alphanumeric, dots, or dashes');
  if (raw.id.includes('..') || raw.id.includes('/') || raw.id.includes('\\'))
    throw new Error('manifest.id must not contain path separators');
  return raw;
}

// ─── Core installer ───────────────────────────────────────────────────────────

/**
 * Install a VCHS-ECS .extbk file from a base64 string.
 * Validates magic bytes, CRC32, and manifest before writing anything to disk.
 *
 * @param {string} base64
 * @returns {Promise<object>} validated manifest
 */
export async function installExtbkBytes(base64, { installId, silent = false } = {}) {
  const id   = installId ?? newInstallId();
  const emit = (evt) => { if (!silent) emitInstall({ id, kind: 'extension', ...evt }); };

  try {
    emit({ stage: 'validating' });
    const bytes = base64ToBytes(base64);

    // Quick magic check before full validation
    for (let i = 0; i < FILE_MAGIC.length; i++) {
      if (bytes[i] !== FILE_MAGIC[i]) {
        throw new Error(
          'Not a valid .extbk file — wrong magic bytes. ' +
          'Make sure you built this with extbk build (VCHS-ECS format), not as a ZIP.'
        );
      }
    }

    // Structural validation (CRC32 per section, required sections)
    const { ok, errors } = validateExtbk(bytes);
    if (!ok) throw new Error(`Invalid .extbk: ${errors.join('; ')}`);

    emit({ stage: 'decoding' });
    // Decode all sections (applies RS correction if CRC fails)
    const { manifest, entry, assets } = await unpackExtbk(bytes);
    validateManifest(manifest);

    // Update detection: if this id is already installed, surface old → new
    // version so the sheet can say "Updating X v1.2 → v1.3" (C1).
    const previous = await readInstalledManifest(manifest.id);
    const fromVersion = previous?.version && previous.version !== manifest.version
      ? previous.version : (previous ? previous.version : undefined);

    const totalFiles = 2 + assets.length;
    emit({ stage: 'writing', name: manifest.name, version: manifest.version, fromVersion,
           fileCount: totalFiles, filesWritten: 0, progress: 0 });

    const { Filesystem, Directory } = await fs();
    try {
      await Filesystem.mkdir({ path: EXTENSIONS_DIR, directory: Directory.Data, recursive: true });
    } catch (_) {}

    let written = 0;
    const step = () => { written += 1; emit({ stage: 'writing', name: manifest.name, version: manifest.version, fromVersion, fileCount: totalFiles, filesWritten: written, progress: written / totalFiles }); };

    await writeExtensionFile(Filesystem, Directory, manifest.id, 'manifest.json', JSON.stringify(manifest, null, 2));
    step();
    await writeExtensionFile(Filesystem, Directory, manifest.id, 'index.js', entry);
    step();
    for (const { path, data } of assets) {
      await writeExtensionFile(Filesystem, Directory, manifest.id, path, data);
      step();
    }

    console.log(`[extbkInstaller] ${fromVersion ? 'Updated' : 'Installed'}: ${manifest.id} v${manifest.version}`);
    emit({ stage: 'activating', name: manifest.name, version: manifest.version, fromVersion });
    return { ...manifest, _installId: id, _fromVersion: fromVersion };
  } catch (err) {
    emit({ stage: 'error', error: err?.message ?? String(err) });
    throw err;
  }
}

/** Read the manifest of an already-installed extension (null if absent). */
export async function readInstalledManifest(extId) {
  try {
    const { Filesystem, Directory } = await fs();
    const res = await Filesystem.readFile({
      path: `${EXTENSIONS_DIR}/${extId}/manifest.json`,
      directory: Directory.Data, encoding: 'utf8',
    });
    return JSON.parse(typeof res.data === 'string' ? res.data : '');
  } catch {
    return null;
  }
}

/**
 * Install a .extbk from a content:// or file:// URI.
 */
export async function installExtbkFromUri(uri) {
  const { Filesystem } = await fs();
  const result = await Filesystem.readFile({ path: uri });
  return installExtbkBytes(result.data);
}

// ─── Pre-installed extensions ─────────────────────────────────────────────────

/**
 * On first launch, seed .extbk files from android/app/src/main/assets/extensions/
 * using the native ExtbkAssetsPlugin. Idempotent — skips already-installed extensions.
 */
export async function seedPreinstalledExtensions() {
  // The seed assets live in the Android APK and the ExtbkAssets native plugin
  // only exists there. On Electron/web registerPlugin() returns a proxy that
  // throws "not implemented on web" when called — which used to spam the error
  // log on every desktop launch. There's nothing to seed off Android, so bail.
  if (!isAndroid()) return;

  let plugin;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    plugin = registerPlugin(ASSETS_PLUGIN);
  } catch {
    return; // plugin not registered
  }

  let filenames;
  try {
    const result = await plugin.list();
    filenames = result?.files ?? [];
  } catch (e) {
    // Non-fatal (no seed assets available) — log at debug, not as an error.
    if (process.env.NODE_ENV === 'development') console.debug('[extbkInstaller] seed list skipped:', e?.message);
    return;
  }

  for (const filename of filenames) {
    const extId = filename.replace(/\.extbk$/, '');
    if (await isExtensionInstalled(extId)) {
      console.log(`[extbkInstaller] Pre-installed already present: ${extId}`);
      continue;
    }
    try {
      const result = await plugin.read({ filename });
      await installExtbkBytes(result.base64);
      console.log(`[extbkInstaller] Seeded: ${extId}`);
    } catch (e) {
      logError('extbkInstaller:seed:install', e, { filename });
    }
  }
}

// ─── Removal ──────────────────────────────────────────────────────────────────

export async function uninstallExtension(extId) {
  if (!/^[\w.-]+$/.test(extId) || extId.includes('..'))
    throw new Error(`Invalid extension id: ${extId}`);
  const { Filesystem, Directory } = await fs();
  await Filesystem.rmdir({
    path: `${EXTENSIONS_DIR}/${extId}`,
    directory: Directory.Data,
    recursive: true,
  });
  console.log(`[extbkInstaller] Uninstalled: ${extId}`);
}

// ─── Inspection ───────────────────────────────────────────────────────────────

export async function isExtensionInstalled(extId) {
  try {
    const { Filesystem, Directory } = await fs();
    await Filesystem.stat({
      path: `${EXTENSIONS_DIR}/${extId}/manifest.json`,
      directory: Directory.Data,
    });
    return true;
  } catch {
    return false;
  }
}
