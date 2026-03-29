/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Android save strategy:
 *   Save (existing content:// file) → overwrite silently via writeBytesToUri (no picker)
 *   Save (new file)                 → open SAF CREATE_DOCUMENT picker; user picks location
 *   Save As                         → always open SAF picker
 *   Open                            → SAF ACTION_OPEN_DOCUMENT picker
 *
 * Book Index:
 *   A lightweight metadata array (title, filePath, folder, size, timestamps) is stored in:
 *     1. localStorage ('authnoBookIndex')    — fast reads, lost on app data wipe
 *     2. AuthNo/.authno-library (External)   — physical file, survives reinstalls
 *   Every open/save automatically upserts the index.
 *   initBookIndex() merges the physical file back into localStorage on startup.
 *   pruneBookIndex() verifies reachability in the background and removes stale entries.
 *   No full-device scan is ever performed.
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

const SAVE_SUBDIR        = 'AuthNo';
const BOOK_INDEX_LS_KEY  = 'authnoBookIndex';
const BOOK_INDEX_FILE    = 'AuthNo/.authno-library';
const MAX_INDEX_ENTRIES  = 300;

// ─── Book Index ───────────────────────────────────────────────────────────────

export function folderFromPath(filePath) {
  if (!filePath) return 'Internal Storage';
  if (filePath.startsWith('content://')) {
    try {
      const decoded  = decodeURIComponent(filePath);
      const colonIdx = decoded.lastIndexOf(':');
      if (colonIdx !== -1) {
        const parts = decoded.slice(colonIdx + 1).replace(/\\/g, '/').split('/');
        if (parts.length >= 2) return parts[parts.length - 2];
        if (parts.length === 1 && parts[0]) return parts[0];
      }
      const parts = decoded.replace(/\\/g, '/').split('/');
      return parts[parts.length - 2] || 'Device Storage';
    } catch { return 'Device Storage'; }
  }
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 2] || 'Internal Storage';
}

function readIndexFromLS() {
  try {
    const raw    = localStorage.getItem(BOOK_INDEX_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeIndexToLS(items) {
  localStorage.setItem(BOOK_INDEX_LS_KEY, JSON.stringify(items.slice(0, MAX_INDEX_ENTRIES)));
}

async function writeIndexToFile(items) {
  if (!isAndroid()) return;
  try {
    const { Filesystem, Directory } = await getFS();
    await Filesystem.mkdir({ path: SAVE_SUBDIR, directory: Directory.External, recursive: true }).catch(() => {});
    const bytes = new TextEncoder().encode(JSON.stringify(items.slice(0, MAX_INDEX_ENTRIES)));
    await Filesystem.writeFile({ path: BOOK_INDEX_FILE, data: bytesToBase64(bytes), directory: Directory.External });
  } catch (e) { console.warn('[storage] Could not write book index file:', e?.message); }
}

async function readIndexFromFile() {
  if (!isAndroid()) return null;
  try {
    const { Filesystem, Directory } = await getFS();
    const { data } = await Filesystem.readFile({ path: BOOK_INDEX_FILE, directory: Directory.External });
    const parsed   = JSON.parse(new TextDecoder().decode(base64ToBytes(data)));
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function mergeIndexArrays(primary, secondary) {
  const seen   = new Set(primary.map(e => e.filePath));
  const merged = [...primary];
  for (const entry of secondary) {
    if (entry.filePath && !seen.has(entry.filePath)) { merged.push(entry); seen.add(entry.filePath); }
  }
  merged.sort((a, b) => new Date(b.lastOpened || 0) - new Date(a.lastOpened || 0));
  return merged.slice(0, MAX_INDEX_ENTRIES);
}

/**
 * Merge the physical .authno-library file back into localStorage.
 * Call once on Android startup — restores the book list after a fresh install.
 */
export async function initBookIndex() {
  if (!isAndroid()) return;
  try {
    const fileIndex = await readIndexFromFile();
    if (!fileIndex || fileIndex.length === 0) return;
    const lsIndex = readIndexFromLS();
    writeIndexToLS(lsIndex.length === 0 ? fileIndex : mergeIndexArrays(lsIndex, fileIndex));
  } catch (e) { console.warn('[storage] initBookIndex failed:', e?.message); }
}

function upsertBookIndex(entry) {
  if (!entry?.filePath) return;
  const now  = new Date().toISOString();
  const next = readIndexFromLS().filter(b => b.filePath !== entry.filePath);
  next.unshift({
    id:         entry.id          || entry.filePath,
    title:      entry.title       || 'Untitled Book',
    filePath:   entry.filePath,
    folder:     entry.folder      || folderFromPath(entry.filePath),
    fileSize:   entry.fileSize    ?? null,
    created:    entry.created     ?? null,
    updated:    entry.updated     ?? now,
    lastOpened: entry.lastOpened  ?? now,
  });
  const capped = next.slice(0, MAX_INDEX_ENTRIES);
  writeIndexToLS(capped);
  writeIndexToFile(capped); // fire-and-forget
}

/** Return the book index from localStorage. Instant — no filesystem access. */
export function listKnownBooks() {
  return readIndexFromLS();
}

/**
 * Background reachability check. Removes stale entries.
 * Only checks content:// entries not opened in the last 30 days — avoids
 * reading large files that were just used. Safe to call without await.
 */
export async function pruneBookIndex() {
  const index = readIndexFromLS();
  if (!index.length || !isAndroid()) return index;

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const toCheck = index.filter(e =>
    e.filePath?.startsWith('content://') &&
    new Date(e.lastOpened || 0).getTime() < thirtyDaysAgo
  );
  if (toCheck.length === 0) return index;

  let plugin = null;
  try { plugin = await getPlugin(); } catch { return index; }

  const stale = new Set();
  for (const entry of toCheck) {
    try { await plugin.readBytesFromUri({ uri: entry.filePath }); }
    catch { stale.add(entry.filePath); console.log('[storage] Pruning unreachable:', entry.filePath); }
  }
  if (stale.size === 0) return index;

  const pruned = index.filter(e => !stale.has(e.filePath));
  writeIndexToLS(pruned);
  writeIndexToFile(pruned);
  return pruned;
}

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

// ─── Public API ───────────────────────────────────────────────────────────────

/** No-ops — kept for compatibility. */
export async function initStoragePermissions() {}
export async function checkStoragePermission() { return 'granted'; }
export async function requestFullStoragePermission() { return 'granted'; }

/**
 * Save a session.
 *
 * Routing logic (Android):
 *   filePath starts with "content://"  → existing SAF file, overwrite silently via plugin
 *   filePath starts with "file://"     → came from Phase 2 raw scan; we cannot write back
 *                                        to an arbitrary path, so open the SAF picker to
 *                                        let the user confirm a save location. The new
 *                                        content:// URI replaces the file:// one going forward.
 *   no filePath (new book)             → open SAF CREATE_DOCUMENT picker so the user picks
 *                                        where to save. Returns a real content:// URI so that
 *                                        every subsequent auto-save overwrites the same file.
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

      // ── Existing SAF file (content:// URI) — overwrite silently, no picker ──
      if (session.filePath?.startsWith('content://')) {
        await plugin.writeBytesToUri({ uri: session.filePath, base64: bytesToBase64(bytes) });
        upsertBookIndex({ id: session.id, title: session.title, filePath: session.filePath,
          fileSize: bytes.length, created: session.created, updated: new Date().toISOString(),
          lastOpened: session.lastOpened });
        return { success: true, filePath: session.filePath };
      }

      // ── New file — open SAF picker so user picks destination ──────────────
      const result = await plugin.createDocument({ fileName: safeName(session) });
      if (!result?.uri) return { success: false, cancelled: true };

      await plugin.writeBytesToUri({ uri: result.uri, base64: bytesToBase64(bytes) });
      upsertBookIndex({ id: session.id, title: session.title, filePath: result.uri,
        fileSize: bytes.length, created: session.created, updated: new Date().toISOString(),
        lastOpened: new Date().toISOString() });
      return { success: true, filePath: result.uri };
    }

    return { success: true };
  } catch (e) {
    logError('saveBook', e, { sessionTitle: session?.title, filePath: session?.filePath });
    throw e;
  }
}

/**
 * Save As — opens the SAF picker so the user chooses destination.
 * Only called from an explicit user action (burger menu Save As button).
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
      upsertBookIndex({ id: session.id, title: session.title, filePath: result.uri,
        fileSize: bytes.length, created: session.created, updated: new Date().toISOString(),
        lastOpened: new Date().toISOString() });
      return { success: true, filePath: result.uri };
    }

    return { success: true };
  } catch (e) {
    logError('saveAsBook', e, { sessionTitle: session?.title });
    throw e;
  }
}

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
      const session = await decodeBytes(base64ToBytes(result.base64), result.uri);
      upsertBookIndex({ id: session.id, title: session.title, filePath: result.uri,
        fileSize: result.size ?? null, created: session.created, updated: session.updated,
        lastOpened: new Date().toISOString() });
      return session;
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

/** Decode bytes from the MainActivity intent handler (file tapped in Files app). */
export async function openBookFromBytes(base64, uri) {
  const session = await decodeBytes(base64ToBytes(base64), uri);
  if (uri) upsertBookIndex({ id: session.id, title: session.title, filePath: uri,
    created: session.created, updated: session.updated, lastOpened: new Date().toISOString() });
  return session;
}

/**
 * Return books from the index (no filesystem scan).
 * Kept for backward compatibility with App.js.
 */
export async function listSavedBooks() {
  return listKnownBooks();
}

/** No-op — kept for App.js API compatibility. */
export async function restoreSafBooks(sessions) {
  return sessions ?? [];
}

// ─── File input helpers ───────────────────────────────────────────────────────

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
