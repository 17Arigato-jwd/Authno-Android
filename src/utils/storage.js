/**
 * storage.js — Unified file I/O for AuthNo
 *
 * On-Device scanning — two-phase approach:
 *
 *   Phase 1 (INSTANT, always works, no permission needed):
 *     Read getPersistedUriPermissions() — every file the user has ever
 *     opened or saved via SAF already has a persisted content:// URI.
 *     This gives back results immediately.
 *
 *   Phase 2 (broader scan, needs READ_EXTERNAL_STORAGE / MediaStore):
 *     plugin.scanForAuthbooks() — MediaStore query finds .authbook files
 *     anywhere on the device that weren't opened via SAF.
 *     Falls back gracefully if the plugin method is unavailable.
 */

import { isElectron, isAndroid } from './platform';
import { logError } from './ErrorLogger';
import {
  packSession, unpackSession, bookToSession, sessionToBook,
  detectFormat, fromLegacySession, base64ToBytes, bytesToBase64,
} from './authbook';

// ─── Lazy loaders ─────────────────────────────────────────────────────────────

async function getPlugin() {
  const { registerPlugin } = await import('@capacitor/core');
  return registerPlugin('AuthnoFilePicker');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Decode a list of { uri, base64, size?, lastModified? } entries ──────────

async function decodeFileList(files) {
  const CONCURRENCY = 4;
  const books = [];
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (f) => {
        try {
          const bytes   = base64ToBytes(f.base64);
          const session = await decodeBytes(bytes, f.uri);
          return {
            ...session,
            filePath: f.uri,
            fileSize: f.size ?? null,
            updated: session.updated || (f.lastModified ? new Date(f.lastModified).toISOString() : null),
            created: session.created || (f.lastModified ? new Date(f.lastModified).toISOString() : null),
          };
        } catch { return null; }
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) books.push(r.value);
    }
  }
  return books;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check current storage-read permission status.
 * Returns 'granted' | 'denied' | 'prompt'.
 * Returns 'granted' if the plugin method doesn't exist yet (safe default).
 */
export async function checkStoragePermission() {
  if (!isAndroid()) return 'granted';
  try {
    const plugin = await getPlugin();
    if (typeof plugin.checkStoragePermission !== 'function') return 'granted';
    const { status } = await plugin.checkStoragePermission();
    return status ?? 'granted';
  } catch { return 'granted'; }
}

/**
 * Request full external-storage permission.
 * On API 30+ opens "Allow all file access" settings page.
 * On API ≤29 triggers the runtime READ_EXTERNAL_STORAGE dialog.
 * Returns 'granted' | 'denied'.
 */
export async function requestFullStoragePermission() {
  if (!isAndroid()) return 'granted';
  try {
    const plugin = await getPlugin();
    if (typeof plugin.requestStoragePermission !== 'function') return 'granted';
    const { status } = await plugin.requestStoragePermission();
    return status ?? 'denied';
  } catch { return 'denied'; }
}

/** No-op — kept for App.js compatibility. */
export async function initStoragePermissions() {}

/**
 * Save silently.
 *   - Existing SAF file (content://): overwrite directly
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
 * Save As — opens SAF CREATE_DOCUMENT picker.
 * Caller must close all overlays ≥300ms before calling.
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

/** Open a file via the native SAF picker. */
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

/** Decode bytes coming from the MainActivity intent handler. */
export async function openBookFromBytes(base64, uri) {
  return decodeBytes(base64ToBytes(base64), uri);
}

/**
 * Scan the device for .authbook files.
 *
 * Phase 1 — plugin.listPersistedBooks():
 *   Reads ContentResolver.getPersistedUriPermissions() and re-reads every
 *   .authbook URI the app already has persistent access to. Returns instantly.
 *   NO extra permission required — this is the main source of results.
 *
 * Phase 2 — plugin.scanForAuthbooks():
 *   MediaStore query that finds .authbook files anywhere on the device.
 *   Needs READ_EXTERNAL_STORAGE (≤API32) or works without it on API33+ via
 *   MediaStore. De-duplicates against Phase 1 results by URI.
 *
 * Both plugin methods fall back gracefully if not implemented yet in the
 * native build — Phase 1 falls back to an empty list, Phase 2 is skipped.
 */
export async function listSavedBooks() {
  if (!isAndroid()) return [];

  try {
    const plugin = await getPlugin();
    const seen   = new Set();
    let   books  = [];

    // ── Phase 1: persisted SAF URIs (instant, always available) ──────────
    try {
      if (typeof plugin.listPersistedBooks === 'function') {
        const { files } = await plugin.listPersistedBooks();
        if (files?.length) {
          const decoded = await decodeFileList(files);
          for (const b of decoded) {
            if (b.filePath && !seen.has(b.filePath)) {
              seen.add(b.filePath);
              books.push(b);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[storage] listPersistedBooks failed:', e.message);
    }

    // ── Phase 2: MediaStore broad scan (needs perm on ≤API32) ─────────────
    try {
      if (typeof plugin.scanForAuthbooks === 'function') {
        const { files } = await plugin.scanForAuthbooks();
        if (files?.length) {
          // Only decode files we haven't already seen from Phase 1
          const newFiles = files.filter(f => !seen.has(f.uri));
          if (newFiles.length) {
            const decoded = await decodeFileList(newFiles);
            for (const b of decoded) {
              if (b.filePath && !seen.has(b.filePath)) {
                seen.add(b.filePath);
                books.push(b);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[storage] scanForAuthbooks failed:', e.message);
    }

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
