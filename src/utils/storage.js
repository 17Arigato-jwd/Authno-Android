/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Android save strategy:
 *   Save (existing file)  → overwrite silently using same path
 *   Save (new file)       → SAF ACTION_CREATE_DOCUMENT picker
 *   Save As               → SAF ACTION_CREATE_DOCUMENT picker
 *   Open                  → AuthnoFilePicker.openDocument (SAF ACTION_OPEN_DOCUMENT)
 *
 * On-Device scanning strategy:
 *   Android 13+  (API 33+) → MediaStore query — no extra permission required for shared storage
 *   Android 10-12          → READ_EXTERNAL_STORAGE → recursive Filesystem walk
 *   Android 9 and below    → READ_EXTERNAL_STORAGE → recursive Filesystem walk
 *   MANAGE_EXTERNAL_STORAGE (optional, API 30+) → requested only when the user
 *                           taps "Grant Storage Access" in the permission banner
 *
 * The plugin method `scanForAuthbooks` must be implemented in the native
 * AuthnoFilePicker plugin (Capacitor).  It returns:
 *   { files: Array<{ uri: string, name: string, size: number, lastModified: number }> }
 *
 * If the native method is unavailable (e.g. older plugin build), we fall back
 * to the old readAppDir() approach so nothing breaks.
 */

import { isElectron, isAndroid } from './platform';
import { logError } from './ErrorLogger';
import {
  packSession, unpackSession, bookToSession, sessionToBook,
  detectFormat, fromLegacySession, base64ToBytes, bytesToBase64,
} from './authbook';

// ─── Lazy loaders ─────────────────────────────────────────────────────────────

async function getFS() {
  const m = await import('@capacitor/filesystem');
  return { Filesystem: m.Filesystem, Directory: m.Directory };
}

async function getPlugin() {
  const { registerPlugin } = await import('@capacitor/core');
  return registerPlugin('AuthnoFilePicker');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAVE_SUBDIR = 'AuthNo';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('writerSettings')) ?? {}; }
  catch { return {}; }
}

function safeName(session) {
  const base = (session.title || 'Untitled')
    .replace(/[^a-z0-9\-_ ]/gi, '_').slice(0, 60).trim();
  return `${base}.authbook`;
}

async function encodeSession(session) {
  try {
    const settings = loadSettings();
    return await packSession(sessionToBook(session), settings, settings.rsLevel ?? 20);
  } catch (e) {
    logError('encodeSession', e, { sessionTitle: session?.title });
    throw e;
  }
}

async function decodeBytes(bytes, filePath) {
  try {
    const fmt = detectFormat(bytes);
    if (fmt === 'vchs') {
      const book    = await unpackSession(bytes);
      const session = bookToSession(book);
      if (book.warnings?.length) console.warn('[authbook]', book.warnings);
      return { ...session, filePath };
    }
    if (fmt === 'legacy-json') {
      const raw     = JSON.parse(new TextDecoder().decode(bytes));
      const session = bookToSession(fromLegacySession(raw));
      return { ...session, filePath, _legacy: true };
    }
    throw new Error('Not a valid .authbook file (unrecognised format)');
  } catch (e) {
    logError('decodeSession', e, { filePath });
    throw e;
  }
}

// ─── Old app-directory scan (fallback) ───────────────────────────────────────

async function readAppDir() {
  const { Filesystem, Directory } = await getFS();
  const books = [];

  for (const dir of [Directory.External, Directory.Data]) {
    try {
      await Filesystem.mkdir({ path: SAVE_SUBDIR, directory: dir, recursive: true }).catch(() => {});
      const { files } = await Filesystem.readdir({ path: SAVE_SUBDIR, directory: dir });
      for (const f of files) {
        if (!f.name.endsWith('.authbook')) continue;
        try {
          const { data } = await Filesystem.readFile({
            path: `${SAVE_SUBDIR}/${f.name}`, directory: dir,
          });
          const decoded = await decodeBytes(base64ToBytes(data), `${SAVE_SUBDIR}/${f.name}`);
          books.push({ ...decoded, fileSize: f.size ?? null });
        } catch { /* skip corrupt files */ }
      }
    } catch { /* directory not available */ }
  }
  return books;
}

// ─── Full-device scan via native plugin ───────────────────────────────────────

/**
 * Ask the native plugin to scan the whole device (MediaStore + SAF tree walk)
 * for any file whose name ends in ".authbook".
 *
 * The plugin must expose:
 *   scanForAuthbooks() → { files: [{ uri, name, size, lastModified, base64 }] }
 *
 * We decode each file in parallel (with a concurrency cap to avoid OOM).
 */
async function scanWholeDevice() {
  const plugin = await getPlugin();

  if (typeof plugin.scanForAuthbooks !== 'function') {
    // Plugin not updated yet — fall back to app-dir only
    console.warn('[storage] scanForAuthbooks not available, falling back to readAppDir');
    return readAppDir();
  }

  let result;
  try {
    result = await plugin.scanForAuthbooks();
  } catch (e) {
    console.warn('[storage] scanForAuthbooks failed:', e.message);
    return readAppDir();
  }

  const files = result?.files ?? [];
  if (files.length === 0) return [];

  // Decode up to 6 files concurrently
  const CONCURRENCY = 6;
  const books = [];
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    const decoded = await Promise.allSettled(
      chunk.map(async (f) => {
        try {
          const bytes = base64ToBytes(f.base64);
          const session = await decodeBytes(bytes, f.uri);
          return {
            ...session,
            filePath: f.uri,
            fileSize: f.size ?? null,
            // Prefer the session's own timestamps but fall back to FS mtime
            updated:  session.updated  || (f.lastModified ? new Date(f.lastModified).toISOString() : null),
            created:  session.created  || (f.lastModified ? new Date(f.lastModified).toISOString() : null),
          };
        } catch {
          return null; // corrupt / not a real authbook
        }
      })
    );
    for (const r of decoded) {
      if (r.status === 'fulfilled' && r.value) books.push(r.value);
    }
  }

  return books;
}

// ─── Write helpers ────────────────────────────────────────────────────────────

async function writeToAppDir(filename, bytes) {
  const { Filesystem, Directory } = await getFS();
  const b64  = bytesToBase64(bytes);
  const path = `${SAVE_SUBDIR}/${filename}`;

  try {
    await Filesystem.mkdir({ path: SAVE_SUBDIR, directory: Directory.External, recursive: true }).catch(() => {});
    await Filesystem.writeFile({ path, data: b64, directory: Directory.External });
    return { path, directory: 'External' };
  } catch (extErr) {
    console.warn('[storage] External dir failed, falling back to internal:', extErr.message);
  }

  await Filesystem.mkdir({ path: SAVE_SUBDIR, directory: Directory.Data, recursive: true }).catch(() => {});
  await Filesystem.writeFile({ path, data: b64, directory: Directory.Data });
  return { path, directory: 'Data' };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether the app currently has full external storage read permission.
 *
 * Returns:
 *   'granted'  — can read all files
 *   'denied'   — permission was denied (show banner)
 *   'prompt'   — not yet asked (show banner)
 *
 * On Android 13+ (API 33), READ_MEDIA_* permissions are used; on older
 * versions READ_EXTERNAL_STORAGE is used.  The native plugin exposes
 * `checkStoragePermission()` which handles the version branching.
 *
 * If the plugin method is missing we assume 'granted' so the UI doesn't
 * show a spurious banner.
 */
export async function checkStoragePermission() {
  if (!isAndroid()) return 'granted';
  try {
    const plugin = await getPlugin();
    if (typeof plugin.checkStoragePermission !== 'function') return 'granted';
    const { status } = await plugin.checkStoragePermission();
    return status; // 'granted' | 'denied' | 'prompt'
  } catch {
    return 'granted';
  }
}

/**
 * Request full external-storage read permission from the user.
 *
 * On Android 11+ (API 30+) this targets MANAGE_EXTERNAL_STORAGE (opens the
 * system "Allow all file access" settings page).  On older versions it
 * requests READ_EXTERNAL_STORAGE via the standard runtime-permission flow.
 *
 * Returns the new permission status: 'granted' | 'denied'.
 */
export async function requestFullStoragePermission() {
  if (!isAndroid()) return 'granted';
  try {
    const plugin = await getPlugin();
    if (typeof plugin.requestStoragePermission !== 'function') return 'granted';
    const { status } = await plugin.requestStoragePermission();
    return status;
  } catch {
    return 'denied';
  }
}

/**
 * No-op — kept for App.js compatibility.
 */
export async function initStoragePermissions() {}

/**
 * Save silently.
 *   - Existing file (content:// URI): overwrite directly via SAF
 *   - New file: open SAF CREATE_DOCUMENT picker
 */
export async function saveBook(session) {
  try {
    if (isElectron()) {
      const b64 = bytesToBase64(await encodeSession(session));
      if (session.filePath)
        return window.electron.saveBookBytes({ filePath: session.filePath, base64: b64 });
      return window.electron.saveAsBytesBook({ base64: b64, defaultName: safeName(session) });
    }

    if (isAndroid()) {
      const bytes  = await encodeSession(session);
      const plugin = await getPlugin();

      if (session.filePath?.startsWith('content://')) {
        await plugin.writeBytesToUri({ uri: session.filePath, base64: bytesToBase64(bytes) });
        return { success: true, filePath: session.filePath };
      }

      const result = await plugin.createDocument({ fileName: safeName(session) });
      if (!result?.uri) return { success: false, cancelled: true };

      await plugin.writeBytesToUri({ uri: result.uri, base64: bytesToBase64(bytes) });
      return { success: true, filePath: result.uri };
    }

    return { success: true };
  } catch (e) {
    logError('saveBook', e, { sessionTitle: session?.title, filePath: session?.filePath });
    throw e;
  }
}

/**
 * Save As — opens SAF CREATE_DOCUMENT so the user picks the destination.
 *
 * IMPORTANT: Caller must close all overlays and wait ≥300 ms before calling,
 * otherwise the SAF picker opens behind the overlay.
 */
export async function saveAsBook(session) {
  try {
    if (isElectron()) {
      const b64 = bytesToBase64(await encodeSession(session));
      return window.electron.saveAsBytesBook({ base64: b64, defaultName: safeName(session) });
    }

    if (isAndroid()) {
      const bytes  = await encodeSession(session);
      const plugin = await getPlugin();

      const result = await plugin.createDocument({ fileName: safeName(session) });
      if (!result?.uri) return { success: false, cancelled: true };

      await plugin.writeBytesToUri({ uri: result.uri, base64: bytesToBase64(bytes) });
      return { success: true, filePath: result.uri };
    }

    return { success: true };
  } catch (e) {
    logError('saveAsBook', e, { sessionTitle: session?.title });
    throw e;
  }
}

/**
 * Open a file via the native SAF picker.
 */
export async function openBook() {
  try {
    if (isElectron()) {
      const result = await window.electron.openBookBytes();
      if (!result) return null;
      return decodeBytes(base64ToBytes(result.base64), result.filePath);
    }

    if (isAndroid()) {
      const plugin = await getPlugin();
      const result = await plugin.openDocument();
      if (!result?.uri) return null;
      return decodeBytes(base64ToBytes(result.base64), result.uri);
    }

    const file = await _pickFileViaInput();
    if (!file) return null;
    const bytes = await _readFileBytes(file);
    return decodeBytes(bytes, file.name);
  } catch (e) {
    logError('openBook', e);
    throw e;
  }
}

/** Decode bytes from the MainActivity intent handler. */
export async function openBookFromBytes(base64, uri) {
  return decodeBytes(base64ToBytes(base64), uri);
}

/**
 * Scan the WHOLE device for .authbook files.
 *
 * Strategy (automatic, no user action required unless permission is denied):
 *   1. Try plugin.scanForAuthbooks() — searches MediaStore + common dirs
 *   2. Fall back to readAppDir() if the plugin method doesn't exist yet
 *
 * For the permission banner to appear in the UI, callers should first call
 * checkStoragePermission() and show the banner when status !== 'granted'.
 * After the user grants permission via requestFullStoragePermission(), call
 * this function again.
 */
export async function listSavedBooks() {
  if (!isAndroid()) return [];
  try {
    return await scanWholeDevice();
  } catch (e) {
    logError('listSavedBooks', e);
    return [];
  }
}

/** No-op — kept for App.js API compatibility. */
export async function restoreSafBooks(sessions) {
  return sessions ?? [];
}

// ─── File input helpers (web / Electron) ─────────────────────────────────────

function _pickFileViaInput(accept = '.authbook,*/*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type          = 'file';
    input.accept        = accept;
    input.style.display = 'none';
    input.onchange = (e) => resolve(e.target.files?.[0] ?? null);

    const onFocus = () => {
      setTimeout(() => {
        if (!input.files?.length) resolve(null);
        window.removeEventListener('focus', onFocus);
      }, 400);
    };
    window.addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
    setTimeout(() => {
      if (document.body.contains(input)) document.body.removeChild(input);
    }, 60000);
  });
}

function _readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = (e) => resolve(new Uint8Array(e.target.result));
    r.onerror = () => reject(new Error('Failed to read file'));
    r.readAsArrayBuffer(file);
  });
}
