import { isElectron, isAndroid } from './platform';
import { logError } from './ErrorLogger';
import {
  packSession, unpackSession, bookToSession, sessionToBook,
  detectFormat, fromLegacySession, base64ToBytes, bytesToBase64,
} from './authbook';

async function getPlugin() {
  const { registerPlugin } = await import('@capacitor/core');
  return registerPlugin('AuthnoFilePicker');
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
      const book = await unpackSession(bytes);
      const session = bookToSession(book);
      if (book.warnings?.length) console.warn('[authbook]', book.warnings);
      return { ...session, filePath };
    }
    if (fmt === 'legacy-json') {
      const raw = JSON.parse(new TextDecoder().decode(bytes));
      const session = bookToSession(fromLegacySession(raw));
      return { ...session, filePath, _legacy: true };
    }
    throw new Error('Not a valid .authbook file');
  } catch (e) {
    logError('decodeSession', e, { filePath });
    throw e;
  }
}

// Hard timeout — prevents any plugin call from hanging forever.
// If the native side never responds, we reject after ms milliseconds.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`plugin timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function decodeFileList(files) {
  const books = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(
      files.slice(i, i + CONCURRENCY).map(async (f) => {
        try {
          const bytes = base64ToBytes(f.base64);
          const session = await decodeBytes(bytes, f.uri);
          return {
            ...session, filePath: f.uri, fileSize: f.size ?? null,
            updated: session.updated || (f.lastModified ? new Date(f.lastModified).toISOString() : null),
            created: session.created || (f.lastModified ? new Date(f.lastModified).toISOString() : null),
          };
        } catch { return null; }
      })
    );
    for (const r of results)
      if (r.status === 'fulfilled' && r.value) books.push(r.value);
  }
  return books;
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Returns 'granted' | 'denied'.
// Returns 'denied' on ANY failure — so the UI shows the permission banner
// rather than silently proceeding as if all is fine.
export async function checkStoragePermission() {
  if (!isAndroid()) return 'granted';
  try {
    const plugin = await getPlugin();
    const result = await withTimeout(plugin.checkStoragePermission(), 3000);
    return result?.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied'; // timeout or bridge not ready → show banner
  }
}

// Opens the system "All Files Access" settings page.
// Resolves after the user returns with 'granted' | 'denied'.
export async function requestFullStoragePermission() {
  if (!isAndroid()) return 'granted';
  try {
    const plugin = await getPlugin();
    const result = await withTimeout(plugin.requestStoragePermission(), 120000);
    return result?.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function initStoragePermissions() {}

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
    return decodeBytes(await _readFileBytes(file), file.name);
  } catch (e) {
    logError('openBook', e);
    throw e;
  }
}

export async function openBookFromBytes(base64, uri) {
  return decodeBytes(base64ToBytes(base64), uri);
}

export async function listSavedBooks() {
  if (!isAndroid()) return [];
  try {
    const plugin = await getPlugin();
    const seen   = new Set();
    const books  = [];

    // ── Phase 1: Persisted SAF URIs ──────────────────────────────────────
    // Every file ever opened/saved via the SAF picker has a persistent
    // content:// grant stored by Android. No permission needed.
    // Timeout 3s — reading a list of URIs from ContentResolver is instant;
    // if it takes longer the bridge is broken and we move on.
    try {
      const { files } = await withTimeout(plugin.listPersistedBooks(), 3000);
      if (Array.isArray(files) && files.length > 0) {
        for (const b of await decodeFileList(files)) {
          if (b?.filePath && !seen.has(b.filePath)) {
            seen.add(b.filePath);
            books.push(b);
          }
        }
      }
    } catch (e) {
      console.warn('[storage] Phase 1 skipped:', e.message);
    }

    // ── Phase 2: Full filesystem scan ─────────────────────────────────────
    // Requires MANAGE_EXTERNAL_STORAGE (All Files Access).
    // We check permission HERE in JS before calling the plugin — this means
    // if permission is denied we skip Phase 2 immediately (no timeout wait).
    // The 25s timeout only matters if the recursive scan itself stalls.
    try {
      const perm = await withTimeout(plugin.checkStoragePermission(), 2000);
      if (perm?.status === 'granted') {
        const { files } = await withTimeout(plugin.scanForAuthbooks(), 25000);
        if (Array.isArray(files) && files.length > 0) {
          const newFiles = files.filter(f => f.uri && !seen.has(f.uri));
          for (const b of await decodeFileList(newFiles)) {
            if (b?.filePath && !seen.has(b.filePath)) {
              seen.add(b.filePath);
              books.push(b);
            }
          }
        }
      }
      // If perm !== 'granted': skip Phase 2 silently. The UI shows the banner.
    } catch (e) {
      console.warn('[storage] Phase 2 skipped:', e.message);
    }

    return books;
  } catch (e) {
    logError('listSavedBooks', e);
    return [];
  }
}

export async function restoreSafBooks(sessions) { return sessions ?? []; }

function _pickFileViaInput(accept = '.authbook,*/*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.style.display = 'none';
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
    setTimeout(() => { if (document.body.contains(input)) document.body.removeChild(input); }, 60000);
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
