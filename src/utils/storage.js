/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Android save strategy:
 *   Save (existing file)  → overwrite silently using same path
 *   Save (new file)       → write to External dir (app-specific, no permission needed)
 *                           falls back to internal Data dir if External unavailable
 *   Save As               → SAF ACTION_CREATE_DOCUMENT picker (same as Save for new files)
 *                           user picks any location: Downloads, Drive, SD card, etc.
 *   Open                  → <input type="file"> — same as avatar picker in Settings
 *
 * Root causes of previous failures:
 *   Save:    Directory.External can fail if external storage not mounted →
 *            now falls back to Directory.Data (internal, always available)
 *   Save As: Share sheet was launching while the bottom sheet was still in the DOM →
 *            now requires caller to dismiss the menu before calling saveAsBook()
 *            Also: Share.share(url) requires a file:// URI, not content://. Fixed.
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

/**
 * Write bytes to the app-specific external directory.
 * Falls back to internal storage if External is unavailable.
 * Returns the path used.
 */
async function writeToAppDir(filename, bytes) {
  const { Filesystem, Directory } = await getFS();
  const b64  = bytesToBase64(bytes);
  const path = `${SAVE_SUBDIR}/${filename}`;

  // Try External first (visible in Files app)
  try {
    await Filesystem.mkdir({
      path: SAVE_SUBDIR, directory: Directory.External, recursive: true,
    }).catch(() => {});
    await Filesystem.writeFile({ path, data: b64, directory: Directory.External });
    return { path, directory: 'External' };
  } catch (extErr) {
    console.warn('[storage] External dir failed, falling back to internal:', extErr.message);
  }

  // Fall back to internal Data dir (always available, not visible in Files app)
  await Filesystem.mkdir({
    path: SAVE_SUBDIR, directory: Directory.Data, recursive: true,
  }).catch(() => {});
  await Filesystem.writeFile({ path, data: b64, directory: Directory.Data });
  return { path, directory: 'Data' };
}

/**
 * Read all .authbook files from the app directory.
 * Checks External first, then Data (for books saved before a directory change).
 */
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
          // Attach file size (bytes) from FileInfo if available
          books.push({ ...decoded, fileSize: f.size ?? null });
        } catch { /* skip corrupt */ }
      }
    } catch { /* directory not available */ }
  }
  return books;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * No-op — kept for App.js compatibility.
 * All save dirs work without permissions. Future: request notifications here.
 */
export async function initStoragePermissions() {}

/**
 * Save silently to the app directory.
 *   - Existing file (has filePath): overwrite same location
 *   - New file (no filePath): write to External (or Data fallback)
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
      const bytes = await encodeSession(session);
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin('AuthnoFilePicker');

      // Existing file saved via SAF (content:// URI) — overwrite directly, no picker
      if (session.filePath?.startsWith('content://')) {
        await plugin.writeBytesToUri({ uri: session.filePath, base64: bytesToBase64(bytes) });
        return { success: true, filePath: session.filePath };
      }

      // New file — open SAF CREATE_DOCUMENT picker so user chooses location
      const result = await plugin.createDocument({ fileName: safeName(session) });
      if (!result?.uri) return { success: false, cancelled: true }; // user cancelled

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
 * Save As — writes to cache then opens the Android share sheet.
 *
 * IMPORTANT: The caller MUST close any overlays (bottom sheet, modals) BEFORE
 * calling this function and wait at least 300ms. Otherwise the share sheet
 * opens behind the overlay and appears to do nothing.
 *
 * The share sheet lets the user send the file to:
 *   Files app (Save to device), Google Drive, email, Bluetooth, etc.
 */
export async function saveAsBook(session) {
  try {
    if (isElectron()) {
      const b64 = bytesToBase64(await encodeSession(session));
      return window.electron.saveAsBytesBook({ base64: b64, defaultName: safeName(session) });
    }

    if (isAndroid()) {
      const bytes = await encodeSession(session);
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin('AuthnoFilePicker');

      // Open SAF CREATE_DOCUMENT picker — user picks any location (Downloads, Drive, etc.)
      const result = await plugin.createDocument({ fileName: safeName(session) });
      if (!result?.uri) return { success: false, cancelled: true }; // user cancelled

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
 * Open a file via the native file picker.
 * Uses <input type="file"> — same proven mechanism as the avatar picker.
 */
export async function openBook() {
  try {
    if (isElectron()) {
      const result = await window.electron.openBookBytes();
      if (!result) return null;
      return decodeBytes(base64ToBytes(result.base64), result.filePath);
    }

    if (isAndroid()) {
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin('AuthnoFilePicker');
      const result = await plugin.openDocument();
      if (!result?.uri) return null; // user cancelled
      return decodeBytes(base64ToBytes(result.base64), result.uri);
    }

    // Web / other platforms: HTML file input
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

/** Scan device for all .authbook files — app dir + full device scan. */
export async function listSavedBooks() {
  if (!isAndroid()) return [];
  try {
    // 1. App's own save directory (always works)
    const books = await readAppDir();
    const seenUris = new Set(books.map(b => b.filePath).filter(Boolean));

    // 2. Full device scan via native plugin (MediaStore + dir walk)
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin('AuthnoFilePicker');
      const result = await plugin.scanDevice();
      const files = result?.files ?? [];

      for (const f of files) {
        const uri  = f.uri  ?? '';
        const path = f.path ?? '';
        // Deduplicate: skip if we already have this file
        if (seenUris.has(uri) || seenUris.has(path)) continue;
        seenUris.add(uri);

        try {
          const { base64 } = await plugin.readBytesFromUri({ uri });
          const decoded = await decodeBytes(base64ToBytes(base64), uri);
          // Store native path separately so the UI can extract a readable folder
          books.push({ ...decoded, filePath: uri, fileSize: f.size, _nativePath: path });
        } catch { /* skip corrupt or unreadable files */ }
      }
    } catch { /* native scan unavailable — app dir results are still returned */ }

    return books;
  } catch (e) {
    logError('listSavedBooks', e);
    return [];
  }
}

/** No-op — kept for App.js API compatibility. */
export async function restoreSafBooks(sessions) {
  return sessions ?? [];
}

// ─── File input helpers ───────────────────────────────────────────────────────

function _pickFileViaInput(accept = '.authbook,*/*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type         = 'file';
    input.accept       = accept;
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
