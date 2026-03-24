/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Android save strategy:
 *   Save (existing file)  → overwrite silently using same path
 *   Save (new file)       → write to External dir (app-specific, no permission needed)
 *                           falls back to internal Data dir if External unavailable
 *   Save As               → write to cache, then open share sheet
 *                           (user sends to Files app, Google Drive, email, etc.)
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

async function getShare() {
  return (await import('@capacitor/share')).Share;
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
          books.push(await decodeBytes(base64ToBytes(data), `${SAVE_SUBDIR}/${f.name}`));
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

      // Existing file saved via SAF (content:// URI) — overwrite directly
      if (session.filePath?.startsWith('content://')) {
        const { registerPlugin } = await import('@capacitor/core');
        const plugin = registerPlugin('AuthnoFilePicker');
        await plugin.writeBytesToUri({ uri: session.filePath, base64: bytesToBase64(bytes) });
        return { success: true, filePath: session.filePath };
      }

      // New file or legacy path — write to app dir
      const { path } = await writeToAppDir(safeName(session), bytes);
      return { success: true, filePath: path };
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
      const { Filesystem, Directory } = await getFS();
      const Share    = await getShare();
      const bytes    = await encodeSession(session);
      const filename = safeName(session);
      const b64      = bytesToBase64(bytes);

      // Write to INTERNAL cache (getCacheDir) — FileProvider can share from here
      await Filesystem.writeFile({
        path:      filename,
        data:      b64,
        directory: Directory.Cache,  // internal cache — FileProvider covers this
      });

      // getUri returns file:// which Share plugin accepts
      const { uri } = await Filesystem.getUri({
        path:      filename,
        directory: Directory.Cache,
      });

      await Share.share({
        title:       `Save "${session.title}"`,
        url:         uri,               // must be file:// — Share plugin requires this
        dialogTitle: 'Save .authbook to…',
      });

      return { success: true };
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

/** Scan app directories for saved books on startup. */
export async function listSavedBooks() {
  if (!isAndroid()) return [];
  try {
    return await readAppDir();
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
