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
import { isEpk, readEpk } from './epkFormat';
import { validateManifestV2 } from './extensionHostV2';
import { promptPlan } from './extensionPermissionsV2';
import { readGrants, writeGrants, clearGrants } from './extensionGrants';
import { emitInstall, newInstallId } from './installEvents';
import { isAndroid }    from './platform';
import { DEV_STORE_KEY, clearExtensionConfig } from './extensionLoader';

const EXTENSIONS_DIR = 'AuthNo/extensions';
const ASSETS_PLUGIN  = 'ExtbkAssets';

// ─── Base64 helpers ───────────────────────────────────────────────────────────

/**
 * How much base64 this will decode before refusing.
 *
 * 64 MB of package is MAX_JS_READ in epkFormat.js; base64 of it is about
 * 85 MB. The check is on the string LENGTH rather than the decoded size
 * because by the time there is a decoded size the memory has been spent —
 * `atob` allocates a binary string as long as the input before anything else
 * happens.
 *
 * Android refuses earlier, in FilePickerPlugin, at a limit derived from the
 * device's own heap. This one covers desktop and web, where the file arrives
 * some other way, and is the backstop for a path that forgets to ask.
 */
const MAX_BASE64_CHARS = 90 * 1024 * 1024;

function base64ToBytes(b64) {
  if (typeof b64 !== 'string') throw new Error('expected base64');
  if (b64.length > MAX_BASE64_CHARS) {
    throw new Error(
      'This extension is too large to open — about '
      + `${Math.round((b64.length * 0.75) / (1024 * 1024))} MB, and the limit is 64 MB.`,
    );
  }
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
export async function installExtbkBytes(base64, { installId, silent = false, askPermissions = null } = {}) {
  const id   = installId ?? newInstallId();
  const emit = (evt) => { if (!silent) emitInstall({ id, kind: 'extension', ...evt }); };

  try {
    emit({ stage: 'validating' });
    const bytes = base64ToBytes(base64);

    // A v2 package is a different container entirely, told apart by its magic
    // rather than by anything the caller passes. Both formats keep the .extbk
    // extension, so the file a user picks looks the same either way and the
    // reader decides — which is the only arrangement where picking the wrong
    // one is impossible.
    if (isEpk(bytes)) return installEpkBytes(bytes, { id, emit, askPermissions });

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

/**
 * Install a VCHS-EPK package.
 *
 * The order is the point and it is not the same as v1's. Everything is read,
 * repaired and checked in memory first; nothing is written until the package
 * has passed. v1 writes as it decodes, so a package that fails halfway leaves
 * a partial extension on disk for the next scan to find.
 *
 * `fromChannel` is deliberately absent here: this path is a file the user
 * chose, and §7.2 allows an unsigned package exactly there. The update-channel
 * path passes it and gets the stricter answer.
 */
async function installEpkBytes(bytes, { id, emit, askPermissions = null }) {
  emit({ stage: 'decoding' });

  let pkg;
  try {
    pkg = await readEpk(bytes);
  } catch (e) {
    // A truncated download is not a corrupt package; it is a finishable one,
    // and saying so is the difference between "try again" and "start again".
    if (e?.reason === 'incomplete') {
      throw new Error(`This file is incomplete — ${e.have} of about ${e.need} bytes arrived.`);
    }
    throw new Error(`Invalid .extbk: ${e?.message ?? e}`);
  }

  const check = validateManifestV2(pkg.manifest);
  if (!check.ok) throw new Error(`Invalid manifest: ${check.errors.join('; ')}`);

  const manifest = pkg.manifest;
  const previous = await readInstalledManifest(manifest.id);
  const fromVersion = previous?.version;

  const files = Object.entries(pkg.modules);
  const totalFiles = 1 + files.length;
  emit({ stage: 'writing', name: manifest.name, version: manifest.version, fromVersion,
         fileCount: totalFiles, filesWritten: 0, progress: 0 });

  const { Filesystem, Directory } = await fs();
  try {
    // Stop the running copy before its files are replaced under it.
    //
    // An update overwrote the directory while the old version was still live:
    // its frame was executing modules loaded from files that no longer said
    // what they had said, and its hooks were still registered. `refresh()`
    // converges afterwards — it deactivates everything and re-activates — but
    // between the write and that refresh the old extension is running against
    // a package that is half the new one. Stopping first makes the window not
    // exist rather than making it short.
    //
    // Imported lazily: this module is on the cold-start path and the runner
    // pulls in the whole v2 host with it. Nothing here needs that until there
    // is actually something to stop.
    if (previous) {
      try {
        const { stopExtensionV2 } = await import('./extensionRunnerV2');
        await stopExtensionV2(manifest.id);
      } catch (e) {
        // A version that will not stop is not a reason to refuse the update —
        // the files still land and refresh() still re-activates. Worth saying
        // out loud, because it means the old frame outlived its package.
        console.warn(`[extbkInstaller] could not stop ${manifest.id} before updating:`, e?.message ?? e);
      }
    }

    await Filesystem.mkdir({ path: EXTENSIONS_DIR, directory: Directory.Data, recursive: true });
  } catch (_) { /* already there */ }

  let written = 0;
  const step = () => {
    written += 1;
    emit({ stage: 'writing', name: manifest.name, version: manifest.version, fromVersion,
           fileCount: totalFiles, filesWritten: written, progress: written / totalFiles });
  };

  await writeExtensionFile(Filesystem, Directory, manifest.id, 'manifest.json',
    JSON.stringify(manifest, null, 2));
  step();
  for (const [path, source] of files) {
    await writeExtensionFile(Filesystem, Directory, manifest.id, path, source);
    step();
  }

  // Blob entries are assets rather than code. Each is verified against its own
  // digest as it is read, and one that fails is dropped rather than failing the
  // install — the same graceful degradation the app already applies to a
  // partially recoverable book.
  const dropped = [];
  for (const path of pkg.entries.keys()) {
    const data = await pkg.read(path);
    if (data === null) { dropped.push(path); continue; }
    await writeExtensionFile(Filesystem, Directory, manifest.id, path, data);
  }

  if (pkg.repairs.length) {
    console.log(`[extbkInstaller] repaired ${manifest.id}:`,
      pkg.repairs.map((r) => `rung ${r.rung} ${r.what}`).join(', '));
  }
  if (dropped.length) {
    console.warn(`[extbkInstaller] ${manifest.id}: dropped unreadable asset(s):`, dropped.join(', '));
  }

  // ── Permissions ───────────────────────────────────────────────────────────
  //
  // Only the delta on an update, so a decision already made is not re-asked.
  //
  // With no asker supplied the question is not silently answered "no". An
  // extension installed with empty grants runs perfectly, does nothing, and
  // explains nothing — which is indistinguishable from broken, and is what
  // this path did until the flag below existed. `permissionsPending` is what
  // lets the Extensions tab tell "you said no" from "nobody asked you".
  const heldBefore = readGrants(manifest.id);
  const plan = promptPlan(manifest.permissions, heldBefore.granted);
  let granted = plan.carried;
  let permissionsPending = false;

  if (plan.prompt.length > 0) {
    if (typeof askPermissions === 'function') {
      emit({ stage: 'permissions', name: manifest.name, asking: plan.prompt.length });
      // The manifest's own identity goes with the question. A dialog that can
      // only say "cloud-backup wants…" is naming a directory; a person agreed
      // to install "Cloud Backup".
      const answered = (await askPermissions(manifest.id, plan, {
        name: manifest.name,
        version: manifest.version,
        icon: manifest.icon ?? null,
      })) ?? [];
      // Filtered against what was actually asked: a dialog cannot grant
      // something it never showed.
      const askable = new Set(plan.prompt.map((p) => p.permission));
      granted = [...new Set([...plan.carried, ...answered.filter((p) => askable.has(p))])];
    } else {
      permissionsPending = true;
    }
  }
  // `permissionsPending` was returned to the caller and written nowhere, so it
  // was gone by the time anything could render it — the next `discoverExtensions`
  // reads manifest.json off disk, which has never carried it. Recorded with the
  // grants, which is the state that survives a restart.
  writeGrants(manifest.id, granted, heldBefore.userHosts, { asked: !permissionsPending });

  console.log(`[extbkInstaller] ${fromVersion ? 'Updated' : 'Installed'} (EPK): ${manifest.id} v${manifest.version}`);
  emit({ stage: 'activating', name: manifest.name, version: manifest.version, fromVersion });
  return {
    ...manifest,
    _installId: id,
    _fromVersion: fromVersion,
    _format: 'epk',
    _repairs: pkg.repairs,
    _droppedAssets: dropped,
    _warnings: check.warnings,
    _granted: granted,
    _refused: plan.prompt.map((p) => p.permission).filter((p) => !granted.includes(p)),
    _dropped: plan.dropped,
    _permissionsPending: permissionsPending,
  };
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

/**
 * Remove an extension from everywhere it can be found.
 *
 * Both places, because discovery reads both: the installed directory, and the
 * hand-written `__authno_dev_extensions` list. Removing from only one was a
 * uninstall that appeared to fail and then didn't take — the rmdir threw
 * because there was no such directory, the card showed "Could not remove", and
 * the extension was still in the list afterwards because the dev store still
 * held it.
 *
 * A missing directory is not an error here. Uninstall is idempotent by nature:
 * the caller asked for the extension to be gone, and if it was already gone
 * from one of the two stores, that half of the job is done. Only a failure
 * that leaves it actually present should reach the writer.
 */
export async function uninstallExtension(extId) {
  if (!/^[\w.-]+$/.test(extId) || extId.includes('..'))
    throw new Error(`Invalid extension id: ${extId}`);

  // Everything the id owned goes first, before anything that can fail.
  //
  // Grants used to survive an uninstall entirely, and `promptPlan` carries
  // every already-held permission without asking — right for an update, wrong
  // for a reinstall. So removing an extension and installing a package that
  // declares the same id handed the new one every permission the old one had
  // been granted, silently, with no question put to anybody. Ids are
  // author-chosen strings; nothing outside a signed channel ties one to a
  // particular author.
  //
  // It is also just what uninstalling means. Somebody who removes an extension
  // has revoked it, and an answer they gave a version that is no longer
  // installed is not an answer they are still giving.
  //
  // Ahead of the removal rather than after it, because revoking must not
  // depend on a directory going away. If the rmdir fails, the extension is
  // still there and now holds nothing — which is the safe direction, and the
  // one `readGrants` already takes when the store will not parse.
  //
  // Config goes too: it is where an extension keeps its tokens, and one caller
  // remembering to clear it separately is one caller.
  clearGrants(extId);
  clearExtensionConfig(extId);

  let removed = false;

  try {
    const { Filesystem, Directory } = await fs();
    await Filesystem.rmdir({
      path: `${EXTENSIONS_DIR}/${extId}`,
      directory: Directory.Data,
      recursive: true,
    });
    removed = true;
  } catch (e) {
    // Kept rather than swallowed: if the dev store does not hold it either,
    // this is the reason the uninstall did nothing, and the writer should see
    // it instead of a card that silently stays put.
    if (!removeFromDevStore(extId)) throw e;
    removed = true;
  }

  if (removeFromDevStore(extId)) removed = true;

  if (removed) console.log(`[extbkInstaller] Uninstalled: ${extId}`);
  return removed;
}

/** Drop an id from the hand-written dev list. True when it was there. */
function removeFromDevStore(extId) {
  try {
    const raw = localStorage.getItem(DEV_STORE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    const kept = parsed.filter((m) => m?.id !== extId);
    if (kept.length === parsed.length) return false;
    localStorage.setItem(DEV_STORE_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
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
