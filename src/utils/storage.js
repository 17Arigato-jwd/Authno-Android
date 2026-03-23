/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Android:
 *   Save    → @capacitor/filesystem → Documents/AuthNo/<title>.authbook (silent)
 *   Save As → FilePickerPlugin.createDocument (SAF "Create Document" picker)
 *   Open    → <input type="file"> (same as avatar picker in Settings)
 *
 * Electron:
 *   All operations → window.electron IPC bridge
 */

import { isElectron, isAndroid } from './platform';
import {
  packSession, unpackSession, bookToSession, sessionToBook,
  detectFormat, fromLegacySession, base64ToBytes, bytesToBase64,
} from './authbook';

// ─── Lazy loaders ─────────────────────────────────────────────────────────────

async function getSAFPlugin() {
  const { registerPlugin } = await import('@capacitor/core');
  return registerPlugin('AuthnoFilePicker');
}

async function getFS() {
  const m = await import('@capacitor/filesystem');
  return { Filesystem: m.Filesystem, Directory: m.Directory, Encoding: m.Encoding };
}

async function getShare() {
  return (await import('@capacitor/share')).Share;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAVE_DIR = 'AuthNo';

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
  const settings = loadSettings();
  return packSession(sessionToBook(session), settings, settings.rsLevel ?? 20);
}

async function decodeBytes(bytes, filePath) {
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
  throw new Error('Not a valid .authbook file');
}

async function ensureSaveDir() {
  const { Filesystem, Directory } = await getFS();
  try {
    await Filesystem.mkdir({ path: SAVE_DIR, directory: Directory.Documents, recursive: true });
  } catch { /* exists */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Save silently to Documents/AuthNo/<title>.authbook.
 * Works for both new books (no filePath) and existing ones.
 * Returns { success, filePath } so callers can update state.
 */
export async function saveBook(session) {
  if (isElectron()) {
    const b64 = bytesToBase64(await encodeSession(session));
    if (session.filePath)
      return window.electron.saveBookBytes({ filePath: session.filePath, base64: b64 });
    return window.electron.saveAsBytesBook({ base64: b64, defaultName: safeName(session) });
  }

  if (isAndroid()) {
    const { Filesystem, Directory } = await getFS();
    await ensureSaveDir();
    const filename = safeName(session);
    const path     = `${SAVE_DIR}/${filename}`;
    const bytes    = await encodeSession(session);
    await Filesystem.writeFile({
      path,
      data:      bytesToBase64(bytes),
      directory: Directory.Documents,
    });
    return { success: true, filePath: path };
  }

  return { success: true };
}

/**
 * Save As — shows the system file picker so the user chooses where to save.
 *
 * Android: uses FilePickerPlugin.createDocument (ACTION_CREATE_DOCUMENT)
 *          which opens the Android "Save to…" system dialog.
 * Electron: native Save dialog.
 *
 * Returns { success, filePath } or { cancelled: true }.
 */
export async function saveAsBook(session) {
  if (isElectron()) {
    const b64 = bytesToBase64(await encodeSession(session));
    return window.electron.saveAsBytesBook({ base64: b64, defaultName: safeName(session) });
  }

  if (isAndroid()) {
    const bytes  = await encodeSession(session);
    const b64    = bytesToBase64(bytes);
    const plugin = await getSAFPlugin();

    // Open the Android "Save to…" system picker pre-filled with the book title
    const result = await plugin.createDocument({ fileName: safeName(session) });
    if (!result?.uri) return { cancelled: true }; // user dismissed picker

    // Write binary VCHS-ECS bytes to the chosen URI
    await plugin.writeBytesToUri({ uri: result.uri, base64: b64 });
    return { success: true, filePath: result.uri };
  }

  return { success: true };
}

/**
 * Open a file via the native file picker.
 *
 * Android: hidden <input type="file"> — identical to the avatar picker
 *          in Settings. Always works in Android WebView.
 * Electron: native Open dialog.
 *
 * Returns a flat session object, or null if cancelled.
 */
export async function openBook() {
  if (isElectron()) {
    const result = await window.electron.openBookBytes();
    if (!result) return null;
    return decodeBytes(base64ToBytes(result.base64), result.filePath);
  }

  // Android + web: hidden file input
  const file = await _pickFileViaInput();
  if (!file) return null;
  const bytes = await _readFileBytes(file);
  return decodeBytes(bytes, file.name);
}

/**
 * Decode bytes from the MainActivity intent handler
 * (user tapped an .authbook in a file manager app).
 */
export async function openBookFromBytes(base64, uri) {
  return decodeBytes(base64ToBytes(base64), uri);
}

/**
 * Android only: scan Documents/AuthNo/ for saved books on startup.
 * Handles both legacy JSON and VCHS-ECS formats.
 */
export async function listSavedBooks() {
  if (!isAndroid()) return [];
  const { Filesystem, Directory } = await getFS();
  try {
    await ensureSaveDir();
    const { files } = await Filesystem.readdir({ path: SAVE_DIR, directory: Directory.Documents });
    const books = [];
    for (const f of files) {
      if (!f.name.endsWith('.authbook')) continue;
      try {
        const { data } = await Filesystem.readFile({
          path: `${SAVE_DIR}/${f.name}`,
          directory: Directory.Documents,
        });
        books.push(await decodeBytes(base64ToBytes(data), `${SAVE_DIR}/${f.name}`));
      } catch { /* skip corrupt */ }
    }
    return books;
  } catch { return []; }
}

/** Android only: no-op — SAF URIs from old app version are kept in-memory. */
export async function restoreSafBooks(sessions) {
  return sessions ?? [];
}

// ─── File input helpers ───────────────────────────────────────────────────────

function _pickFileViaInput(accept = '.authbook,*/*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = (e) => resolve(e.target.files?.[0] ?? null);

    // Detect cancel — body regains focus after picker closes without a pick
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
