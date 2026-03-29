import { isElectron, isAndroid } from './platform';
import { logError } from './ErrorLogger';
import {
  packSession, unpackSession, bookToSession, sessionToBook,
  detectFormat, fromLegacySession, base64ToBytes, bytesToBase64,
} from './authbook';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAVE_SUBDIR = 'AuthNo';

async function getFS() {
  const m = await import('@capacitor/filesystem');
  return { Filesystem: m.Filesystem, Directory: m.Directory };
}

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

// Prevents any plugin call from hanging forever when the native side
// doesn't respond (e.g. method not implemented yet).
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`plugin timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ─── App-dir helpers (Capacitor Filesystem) ───────────────────────────────────
// Used for silent auto-save and Phase 0 re-discovery.
// These directories are app-specific — zero permissions required.

async function writeToAppDir(filename, bytes) {
  const { Filesystem, Directory } = await getFS();
  const b64  = bytesToBase64(bytes);
  const path = `${SAVE_SUBDIR}/${filename}`;
  try {
    await Filesystem.mkdir({ path: SAVE_SUBDIR, directory: Directory.External, recursive: true }).catch(() => {});
    await Filesystem.writeFile({ path, data: b64, directory: Directory.External });
    return { path, directory: 'External' };
  } catch {
    console.warn('[storage] External dir failed, falling back to Data');
  }
  await Filesystem.mkdir({ path: SAVE_SUBDIR, directory: Directory.Data, recursive: true }).catch(() => {});
  await Filesystem.writeFile({ path, data: b64, directory: Directory.Data });
  return { path, directory: 'Data' };
}

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
          const { data } = await Filesystem.readFile({ path: `${SAVE_SUBDIR}/${f.name}`, directory: dir });
          const decoded = await decodeBytes(base64ToBytes(data), `${SAVE_SUBDIR}/${f.name}`);
          books.push({ ...decoded, fileSize: f.size ?? null });
        } catch { /* skip corrupt */ }
      }
    } catch { /* dir unavailable */ }
  }
  return books;
}

// ─── Plugin file list decoder ─────────────────────────────────────────────────

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

export async function checkStoragePermission() {
  if (!isAndroid()) return 'granted';
  try {
    const plugin = await getPlugin();
    const result = await withTimeout(plugin.checkStoragePermission(), 3000);
    return result?.status === 'granted' ? 'granted' : 'denied';
  } catch { return 'denied'; }
}

export async function requestFullStoragePermission() {
  if (!isAndroid()) return 'granted';
  try {
    const plugin = await getPlugin();
    const result = await withTimeout(plugin.requestStoragePermission(), 120000);
    return result?.status === 'granted' ? 'granted' : 'denied';
  } catch { return 'denied'; }
}

export async function initStoragePermissions() {}

/**
 * Save a session.
 * - Existing SAF file (content://): overwrite directly via plugin, no picker.
 * - New file (no filePath): write silently to app-specific directory.
 *   The app dir is always readable by this app; re-discovered on next launch
 *   via Phase 0 of listSavedBooks. No picker, no user interaction.
 *
 * Note: saveAsBook() is the explicit user action that opens the SAF picker.
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
      // Existing SAF URI → overwrite silently
      if (session.filePath?.startsWith('content://')) {
        const plugin = await getPlugin();
        await plugin.writeBytesToUri({ uri: session.filePath, base64: bytesToBase64(bytes) });
        return { success: true, filePath: session.filePath };
      }
      // No filePath → save to app dir silently (no picker)
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
 * Save As — opens the SAF picker so the user chooses destination.
 * Only called from explicit user action (burger menu Save As button).
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

/**
 * Scan for .authbook files in three phases:
 *
 * Phase 0 — App-specific directory (Capacitor Filesystem).
 *   Always works. Finds files auto-saved by saveBook().
 *   No permissions required. Completes in <1s.
 *
 * Phase 1 — Persisted SAF URIs.
 *   Finds any file ever opened/saved-as via the SAF picker.
 *   No permissions required. 3s timeout.
 *
 * Phase 2 — Full device scan (MANAGE_EXTERNAL_STORAGE).
 *   Skipped entirely if permission is denied — no timeout wait.
 *   25s timeout if permission is granted.
 */
export async function listSavedBooks() {
  if (!isAndroid()) return [];
  try {
    const seen  = new Set();
    const books = [];

    const add = (b) => {
      if (b?.filePath && !seen.has(b.filePath)) {
        seen.add(b.filePath);
        books.push(b);
      }
    };

    // Phase 0: app-specific directory — always available, no permissions
    try {
      for (const b of await readAppDir()) add(b);
    } catch (e) {
      console.warn('[storage] Phase 0 skipped:', e.message);
    }

    // Phase 1: persisted SAF URIs — instant, no permissions
    try {
      const plugin = await getPlugin();
      const { files } = await withTimeout(plugin.listPersistedBooks(), 3000);
      if (Array.isArray(files) && files.length > 0)
        for (const b of await decodeFileList(files)) add(b);
    } catch (e) {
      console.warn('[storage] Phase 1 skipped:', e.message);
    }

    // Phase 2: full device scan — only if MANAGE_EXTERNAL_STORAGE granted
    try {
      const plugin = await getPlugin();
      const perm = await withTimeout(plugin.checkStoragePermission(), 2000);
      if (perm?.status === 'granted') {
        const { files } = await withTimeout(plugin.scanForAuthbooks(), 25000);
        if (Array.isArray(files) && files.length > 0)
          for (const b of await decodeFileList(files.filter(f => !seen.has(f.uri)))) add(b);
      }
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
