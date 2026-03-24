/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Android file strategy (no permissions required for any of these):
 *
 *   Save    → @capacitor/filesystem Directory.External
 *             Maps to getExternalFilesDir() — app-specific external storage.
 *             Path: /storage/emulated/0/Android/data/com.aurorastudios.authno/files/AuthNo/
 *             Visible in Files app. Zero permissions needed on any Android version.
 *
 *   Save As → @capacitor/share share sheet
 *             Writes to cache, then opens the Android share sheet so the user
 *             can send the file to Files, Google Drive, email, etc.
 *             No permission needed — identical mechanism to sharing any other file.
 *
 *   Open    → <input type="file"> (same as the avatar picker in Settings)
 *             No permission needed. Android WebView handles this natively.
 *
 * Electron:
 *   All operations → window.electron IPC bridge (unchanged)
 */

import { isElectron, isAndroid } from './platform';
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

// App-specific external dir — no permission needed on any Android version.
// Files are visible under:
//   Files app → Android → data → com.aurorastudios.authno → files → AuthNo
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
    await Filesystem.mkdir({
      path:      SAVE_SUBDIR,
      directory: Directory.External,   // ← app-specific external, no permission needed
      recursive: true,
    });
  } catch { /* already exists */ }
}

// ─── initStoragePermissions ───────────────────────────────────────────────────
// No-op for file saving (External dir needs no permission).
// Kept so App.js doesn't need changes — reserved for future permission requests
// (notifications, camera, media) which will be added here when those features ship.
export async function initStoragePermissions() {
  // Nothing to request for file I/O on Android with External directory.
  // Future: request POST_NOTIFICATIONS here when streak reminders ship.
}

// ─── saveBook ─────────────────────────────────────────────────────────────────
/**
 * Silently save to the app-specific external directory.
 * No permission dialog. No picker. Works on Android 9–14+.
 * Returns { success: true, filePath }.
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
    const bytes = await encodeSession(session);
    const path  = `${SAVE_SUBDIR}/${safeName(session)}`;

    await Filesystem.writeFile({
      path,
      data:      bytesToBase64(bytes),
      directory: Directory.External,   // ← no permission needed
    });
    return { success: true, filePath: path };
  }

  return { success: true };
}

// ─── saveAsBook ───────────────────────────────────────────────────────────────
/**
 * Write to cache then open the Android share sheet.
 * The user can send the file to Files, Google Drive, email, Bluetooth, etc.
 * No permission needed — same mechanism as sharing any document.
 */
export async function saveAsBook(session) {
  if (isElectron()) {
    const b64 = bytesToBase64(await encodeSession(session));
    return window.electron.saveAsBytesBook({ base64: b64, defaultName: safeName(session) });
  }

  if (isAndroid()) {
    const { Filesystem, Directory } = await getFS();
    const Share    = await getShare();
    const bytes    = await encodeSession(session);
    const filename = safeName(session);

    // Write to cache — share sheet reads from here
    await Filesystem.writeFile({
      path:      filename,
      data:      bytesToBase64(bytes),
      directory: Directory.Cache,
    });

    const { uri } = await Filesystem.getUri({
      path:      filename,
      directory: Directory.Cache,
    });

    await Share.share({
      title:       `Save "${session.title}"`,
      text:        `AuthNo book: ${session.title}`,
      url:         uri,
      dialogTitle: 'Save or send .authbook',
    });

    return { success: true };
  }

  return { success: true };
}

// ─── openBook ─────────────────────────────────────────────────────────────────
/**
 * Open a file via the native file picker.
 * Android: hidden <input type="file"> — same as the avatar picker in Settings.
 * Electron: native Open dialog.
 * Returns a flat session object or null if cancelled.
 */
export async function openBook() {
  if (isElectron()) {
    const result = await window.electron.openBookBytes();
    if (!result) return null;
    return decodeBytes(base64ToBytes(result.base64), result.filePath);
  }

  const file = await _pickFileViaInput();
  if (!file) return null;
  const bytes = await _readFileBytes(file);
  return decodeBytes(bytes, file.name);
}

// ─── openBookFromBytes ────────────────────────────────────────────────────────
/**
 * Decode bytes from the MainActivity intent handler
 * (user tapped an .authbook in a file manager).
 */
export async function openBookFromBytes(base64, uri) {
  return decodeBytes(base64ToBytes(base64), uri);
}

// ─── listSavedBooks ───────────────────────────────────────────────────────────
/**
 * Android: scan the app-specific external dir for .authbook files on startup.
 * Handles both VCHS-ECS binary and legacy JSON formats.
 */
export async function listSavedBooks() {
  if (!isAndroid()) return [];
  const { Filesystem, Directory } = await getFS();
  try {
    await ensureSaveDir();
    const { files } = await Filesystem.readdir({
      path:      SAVE_SUBDIR,
      directory: Directory.External,
    });
    const books = [];
    for (const f of files) {
      if (!f.name.endsWith('.authbook')) continue;
      try {
        const { data } = await Filesystem.readFile({
          path:      `${SAVE_SUBDIR}/${f.name}`,
          directory: Directory.External,
        });
        books.push(await decodeBytes(base64ToBytes(data), `${SAVE_SUBDIR}/${f.name}`));
      } catch { /* skip corrupt */ }
    }
    return books;
  } catch { return []; }
}

// ─── restoreSafBooks ──────────────────────────────────────────────────────────
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
