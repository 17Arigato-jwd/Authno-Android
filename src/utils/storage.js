/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Android approach (simple, proven, no custom Java plugin required):
 *   Open    → <input type="file"> — same mechanism as the image picker in Settings
 *   Save    → @capacitor/filesystem writes to Documents/AuthNo/ automatically
 *   Export  → @capacitor/share opens the OS share sheet
 *
 * Electron approach (unchanged):
 *   Open / Save / Save-As → window.electron IPC bridge
 *
 * Backward compatibility:
 *   Old plain-JSON .authbook files are detected and migrated to VCHS-ECS
 *   transparently on the first save after opening.
 */

import { isElectron, isAndroid } from './platform';
import {
  packSession, unpackSession, bookToSession, sessionToBook,
  detectFormat, fromLegacySession, base64ToBytes, bytesToBase64,
} from './authbook';

// ─── Lazy plugin loaders ──────────────────────────────────────────────────────

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

/** Build a safe filename from a session title. */
function safeName(session) {
  const base = (session.title || 'Untitled')
    .replace(/[^a-z0-9\-_ ]/gi, '_').slice(0, 60).trim();
  return `${base}.authbook`;
}

/** Encode a session → VCHS-ECS Uint8Array. */
async function encodeSession(session) {
  const settings = loadSettings();
  const rsLevel  = settings.rsLevel ?? 20;
  const book     = sessionToBook(session);
  return packSession(book, settings, rsLevel);
}

/**
 * Decode raw bytes (VCHS-ECS binary or legacy JSON) → flat App.js session.
 * Handles migration automatically.
 */
async function decodeBytes(bytes, filePath) {
  const fmt = detectFormat(bytes);

  if (fmt === 'vchs') {
    const book    = await unpackSession(bytes);
    const session = bookToSession(book);
    if (book.warnings?.length) console.warn('[authbook]', book.warnings);
    return { ...session, filePath };
  }

  if (fmt === 'legacy-json') {
    const text    = new TextDecoder().decode(bytes);
    const raw     = JSON.parse(text);
    const session = bookToSession(fromLegacySession(raw));
    return { ...session, filePath, _legacy: true };
  }

  throw new Error('Not a valid .authbook file');
}

// ─── File input picker (Android + web) ────────────────────────────────────────

/**
 * Show a native file picker using a hidden <input type="file"> element.
 * This is exactly how the avatar image picker in Settings works — it is
 * the standard Android WebView file picker and is always reliable.
 *
 * Returns a File object, or null if the user cancels.
 */
function pickFileViaInput(accept = '.authbook,*/*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = accept;
    input.style.display = 'none';

    // Resolve null if the dialog is closed without picking
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files?.length) resolve(null);
        document.body.removeEventListener('focus', onFocus, true);
      }, 500);
    };
    document.body.addEventListener('focus', onFocus, { capture: true, once: true });

    input.onchange = (e) => {
      document.body.removeEventListener('focus', onFocus, true);
      resolve(e.target.files?.[0] ?? null);
    };

    document.body.appendChild(input);
    input.click();
    // Clean up after a moment
    setTimeout(() => {
      if (document.body.contains(input)) document.body.removeChild(input);
    }, 60000);
  });
}

/** Read a File object as Uint8Array. */
function readFileAsBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Android filesystem helpers ───────────────────────────────────────────────

async function ensureSaveDir() {
  const { Filesystem, Directory } = await getFS();
  try {
    await Filesystem.mkdir({
      path: SAVE_DIR, directory: Directory.Documents, recursive: true,
    });
  } catch { /* already exists */ }
}

/** Write VCHS-ECS bytes to Documents/AuthNo/<filename> and return the path. */
async function writeToDocuments(session, bytes) {
  const { Filesystem, Directory } = await getFS();
  await ensureSaveDir();
  const filename = safeName(session);
  const path     = `${SAVE_DIR}/${filename}`;
  const base64   = bytesToBase64(bytes);

  // Capacitor Filesystem.writeFile accepts base64 when encoding is omitted
  await Filesystem.writeFile({
    path,
    data:      base64,
    directory: Directory.Documents,
  });
  return path;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Save the current session.
 *
 * Android : writes to Documents/AuthNo/<title>.authbook silently
 * Electron: overwrites the existing filePath, or opens Save-As if none
 *
 * Returns { success: true, filePath }
 */
export async function saveBook(session) {
  // ── Electron ──────────────────────────────────────────────────────────────
  if (isElectron()) {
    const bytes  = await encodeSession(session);
    const base64 = bytesToBase64(bytes);
    if (session.filePath)
      return window.electron.saveBookBytes({ filePath: session.filePath, base64 });
    return window.electron.saveAsBytesBook({
      base64, defaultName: safeName(session),
    });
  }

  // ── Android ───────────────────────────────────────────────────────────────
  if (isAndroid()) {
    const bytes    = await encodeSession(session);
    const filePath = await writeToDocuments(session, bytes);
    return { success: true, filePath };
  }

  return { success: true };
}

/**
 * Export / Save-As.
 *
 * Android : writes to Documents/AuthNo/ then opens the OS share sheet so
 *           the user can copy it to Google Drive, email, another folder, etc.
 * Electron: shows the native Save-As dialog.
 *
 * Returns { success: true, filePath } or { cancelled: true }
 */
export async function saveAsBook(session) {
  // ── Electron ──────────────────────────────────────────────────────────────
  if (isElectron()) {
    const bytes  = await encodeSession(session);
    const base64 = bytesToBase64(bytes);
    return window.electron.saveAsBytesBook({
      base64, defaultName: safeName(session),
    });
  }

  // ── Android: write to Documents + share ───────────────────────────────────
  if (isAndroid()) {
    const bytes    = await encodeSession(session);
    const { Filesystem, Directory } = await getFS();
    const Share    = await getShare();
    const filename = safeName(session);

    // Write to cache so the share sheet can send it anywhere
    await Filesystem.writeFile({
      path:      filename,
      data:      bytesToBase64(bytes),
      directory: Directory.Cache,
    });
    const { uri } = await Filesystem.getUri({
      path: filename, directory: Directory.Cache,
    });
    await Share.share({
      title:      `Export "${session.title}"`,
      url:        uri,
      dialogTitle: 'Save or share .authbook',
    });
    // Also persist to Documents in the background
    const savedPath = await writeToDocuments(session, bytes);
    return { success: true, filePath: savedPath };
  }

  return { success: true };
}

/**
 * Open an existing .authbook file.
 *
 * Android : shows a native file picker via <input type="file"> — identical
 *           to how the avatar image picker in Settings works.
 * Electron: shows the native Open dialog.
 *
 * Returns a flat session object or null if the user cancelled.
 */
export async function openBook() {
  // ── Electron ──────────────────────────────────────────────────────────────
  if (isElectron()) {
    const result = await window.electron.openBookBytes();
    if (!result) return null;
    return decodeBytes(base64ToBytes(result.base64), result.filePath);
  }

  // ── Android (and web fallback) ────────────────────────────────────────────
  const file = await pickFileViaInput('.authbook,*/*');
  if (!file) return null;

  const bytes = await readFileAsBytes(file);
  // Use the filename as the filePath on Android since we have no content URI
  return decodeBytes(bytes, file.name);
}

/**
 * Decode bytes that arrived via the MainActivity intent handler
 * (user tapped an .authbook in a file manager).
 */
export async function openBookFromBytes(base64, uri) {
  const bytes = base64ToBytes(base64);
  return decodeBytes(bytes, uri);
}

/**
 * Android only: re-read sessions that previously had SAF content:// URIs
 * from an older version of the app. Since we no longer use SAF for new saves,
 * these are just kept in-memory as-is (they'll be re-saved to Documents on
 * next Save).
 */
export async function restoreSafBooks(sessions) {
  if (!isAndroid() || !sessions?.length) return sessions ?? [];
  // No SAF reads — just return sessions unchanged.
  // On next save they will be written to Documents/AuthNo/ with VCHS-ECS format.
  return sessions;
}

/**
 * Android only: scan Documents/AuthNo/ for .authbook files and return them
 * as flat sessions. Handles both legacy JSON and VCHS-ECS formats.
 */
export async function listSavedBooks() {
  if (!isAndroid()) return [];
  const { Filesystem, Directory } = await getFS();

  try {
    await ensureSaveDir();
    const { files } = await Filesystem.readdir({
      path: SAVE_DIR, directory: Directory.Documents,
    });

    const books = [];
    for (const f of files) {
      if (!f.name.endsWith('.authbook')) continue;
      try {
        // Read as base64 (no encoding specified = binary/base64 mode)
        const { data } = await Filesystem.readFile({
          path: `${SAVE_DIR}/${f.name}`,
          directory: Directory.Documents,
        });
        const bytes   = base64ToBytes(data);
        const session = await decodeBytes(bytes, `${SAVE_DIR}/${f.name}`);
        books.push(session);
      } catch { /* skip corrupt files */ }
    }
    return books;
  } catch { return []; }
}
