/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Handles three file format generations transparently:
 *
 *   Format 0  Legacy plain JSON  (old app, no VCHS-ECS)
 *   Format 1  VCHS-ECS binary    (current, all new saves)
 *
 * On read:  detects format, migrates if needed, returns a flat session
 *           that App.js can use without any changes.
 * On write: always writes VCHS-ECS Format 1. A legacy file opened and
 *           saved is automatically upgraded on first save.
 *
 * Platform routing:
 *   Electron  → window.electron IPC (binary base64 bridge)
 *   Android   → AuthnoFilePicker SAF plugin (binary base64)
 *   Fallback  → no-op (web / test environment)
 */

import { isElectron, isAndroid } from './platform';
import {
  packSession, unpackSession, bookToSession, sessionToBook,
  detectFormat, fromLegacySession, base64ToBytes, bytesToBase64,
} from './authbook';

// ─── Lazy plugin loaders ──────────────────────────────────────────────────────

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

function isSafUri(p) { return typeof p === 'string' && p.startsWith('content://'); }

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('writerSettings')) ?? {}; } catch { return {}; }
}

// ─── Core format functions ────────────────────────────────────────────────────

/**
 * Encode a session to VCHS-ECS bytes.
 * session can be either a flat App.js session or already have a chapters array.
 */
async function encodeSession(session, settings) {
  const book    = sessionToBook(session);
  const rsLevel = loadSettings().rsLevel ?? 20;
  const bytes   = await packSession(book, settings ?? loadSettings(), rsLevel);
  return bytes;
}

/**
 * Decode raw bytes (VCHS-ECS or legacy JSON) into a flat App.js session.
 * filePath is stored on the returned session so storage can save back.
 */
async function decodeBytes(bytes, filePath) {
  const fmt = detectFormat(bytes);

  if (fmt === 'vchs') {
    const book    = await unpackSession(bytes);
    const session = bookToSession(book);
    // Log any warnings so they're visible in dev tools
    if (book.warnings?.length) console.warn('[authbook] warnings:', book.warnings);
    return { ...session, filePath, _vchs: true };
  }

  if (fmt === 'legacy-json') {
    const text = new TextDecoder().decode(bytes);
    const raw  = JSON.parse(text);
    // Normalise legacy streak format (plain int log values → { words, goal })
    const session = bookToSession(fromLegacySession(raw));
    // filePath kept; will be overwritten as VCHS-ECS on first save
    return { ...session, filePath, _legacy: true };
  }

  throw new Error('Unrecognised file format — not a valid .authbook file');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Save the current session to disk.
 *
 * If the session came from a legacy JSON file (_legacy flag), the first save
 * rewrites it as VCHS-ECS automatically — the user sees no difference.
 *
 * Returns { success: true, filePath } or { cancelled: true }
 */
export async function saveBook(session, settingsOverride) {
  const settings = settingsOverride ?? loadSettings();
  const bytes    = await encodeSession(session, settings);
  const b64      = bytesToBase64(bytes);

  // ── Electron ──────────────────────────────────────────────────────────────
  if (isElectron()) {
    if (session.filePath)
      return window.electron.saveBookBytes({ filePath: session.filePath, base64: b64 });
    return window.electron.saveAsBytesBook({
      base64:      b64,
      defaultName: _safeName(session),
    });
  }

  // ── Android ───────────────────────────────────────────────────────────────
  if (isAndroid()) {
    if (isSafUri(session.filePath)) {
      const plugin = await getSAFPlugin();
      await plugin.writeBytesToUri({ uri: session.filePath, base64: b64 });
      return { success: true, filePath: session.filePath };
    }
    // No SAF URI yet — show the Create Document picker
    return saveAsBook(session, settings);
  }

  return { success: true };
}

/**
 * Save As — always shows the system file picker.
 * Returns { success: true, filePath } or { cancelled: true }
 */
export async function saveAsBook(session, settingsOverride) {
  const settings = settingsOverride ?? loadSettings();
  const bytes    = await encodeSession(session, settings);
  const b64      = bytesToBase64(bytes);

  if (isElectron())
    return window.electron.saveAsBytesBook({
      base64: b64, defaultName: _safeName(session),
    });

  if (isAndroid()) {
    const plugin = await getSAFPlugin();
    const result = await plugin.createDocument({ fileName: _safeName(session) });
    if (!result?.uri) return { cancelled: true };
    await plugin.writeBytesToUri({ uri: result.uri, base64: b64 });
    return { success: true, filePath: result.uri };
  }

  return { success: true };
}

/**
 * Open an existing .authbook file via the system file picker.
 * Handles both VCHS-ECS and legacy JSON transparently.
 * Returns a flat session or null if cancelled.
 */
export async function openBook() {
  if (isElectron()) {
    const result = await window.electron.openBookBytes();
    if (!result) return null;
    const bytes = base64ToBytes(result.base64);
    return decodeBytes(bytes, result.filePath);
  }

  if (isAndroid()) {
    const plugin = await getSAFPlugin();
    const result = await plugin.openDocument();
    if (!result?.uri) return null;
    const bytes = base64ToBytes(result.base64);
    return decodeBytes(bytes, result.uri);
  }

  return null;
}

/**
 * Decode bytes that arrived via the MainActivity intent handler.
 * Called by the 'open-authbook-android-bytes' event listener in App.js.
 * Returns a flat session or throws on unrecoverable corruption.
 */
export async function openBookFromBytes(base64, uri) {
  const bytes = base64ToBytes(base64);
  return decodeBytes(bytes, uri);
}

/**
 * Android only: re-read sessions that have SAF URIs from disk.
 * Refreshes content that may have been edited outside the app.
 * Legacy sessions (no SAF URI) are returned unchanged.
 */
export async function restoreSafBooks(sessions) {
  if (!isAndroid() || !sessions?.length) return sessions ?? [];
  const plugin   = await getSAFPlugin();
  const refreshed = [];

  for (const session of sessions) {
    if (!isSafUri(session.filePath)) {
      refreshed.push(session);
      continue;
    }
    try {
      const result  = await plugin.readBytesFromUri({ uri: session.filePath });
      const decoded = await decodeBytes(base64ToBytes(result.base64), session.filePath);
      refreshed.push(decoded);
    } catch {
      // URI revoked or file moved — keep last in-memory copy
      refreshed.push(session);
    }
  }
  return refreshed;
}

/**
 * Android only: scan Documents/AuthNo/ for legacy JSON files saved by
 * older versions of the app. Returns flat sessions ready for App.js.
 * They carry _legacy:true so the next save upgrades them to VCHS-ECS.
 */
export async function listSavedBooks() {
  if (!isAndroid()) return [];
  const { Filesystem, Directory, Encoding } = await getFS();
  const LEGACY_DIR = 'AuthNo';

  try {
    await Filesystem.mkdir({
      path: LEGACY_DIR, directory: Directory.Documents, recursive: true,
    }).catch(() => { /* already exists */ });

    const { files } = await Filesystem.readdir({
      path: LEGACY_DIR, directory: Directory.Documents,
    });

    const books = [];
    for (const f of files) {
      if (!f.name.endsWith('.authbook')) continue;
      try {
        const { data } = await Filesystem.readFile({
          path: `${LEGACY_DIR}/${f.name}`,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        // These are guaranteed to be legacy JSON (old app wrote them as UTF-8 text)
        const raw     = JSON.parse(data);
        const session = bookToSession(fromLegacySession(raw));
        books.push({
          ...session,
          filePath: raw.filePath || `${LEGACY_DIR}/${f.name}`,
          _legacy: true,
        });
      } catch { /* skip corrupt files */ }
    }
    return books;
  } catch { return []; }
}

/**
 * Export via the OS share sheet (Android).
 * Writes the VCHS-ECS file to cache then shares.
 */
export async function exportBook(session) {
  const bytes  = await encodeSession(session, loadSettings());
  const b64    = bytesToBase64(bytes);
  const name   = _safeName(session);
  const { Filesystem, Directory } = await getFS();
  const Share  = await getShare();

  await Filesystem.writeFile({ path: name, data: b64, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
  await Share.share({
    title: `Export "${session.title}"`, url: uri, dialogTitle: 'Export as .authbook',
  });
  return { success: true };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _safeName(session) {
  const base = (session.title || 'Untitled')
    .replace(/[^a-z0-9\-_ ]/gi, '_').slice(0, 60).trim();
  return `${base}.authbook`;
}
