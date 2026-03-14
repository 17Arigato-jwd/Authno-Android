/**
 * storageAdapter.js — Unified file I/O for AuthNo
 *
 * On Electron  → delegates to window.electron IPC bridge (fileManager.js)
 * On Android   → uses @capacitor/filesystem for Documents storage
 *                and @capacitor/share for exporting .authbook files
 * Everywhere   → localStorage is used for session persistence (unchanged)
 */

import { isElectron, isAndroid } from './platform';

// ── Lazy-load Capacitor plugins (tree-shaken when unused) ──────────────────

async function getFilesystem() {
  try {
    const mod = await import('@capacitor/filesystem');
    return { Filesystem: mod.Filesystem, Directory: mod.Directory, Encoding: mod.Encoding };
  } catch {
    console.warn('[storageAdapter] @capacitor/filesystem not available.');
    return null;
  }
}

async function getShare() {
  try {
    const { Share } = await import('@capacitor/share');
    return Share;
  } catch {
    console.warn('[storageAdapter] @capacitor/share not available.');
    return null;
  }
}

// ── Android helpers ────────────────────────────────────────────────────────

const ANDROID_DIR = 'AuthNo'; // sub-folder inside Documents

async function ensureDir(cap) {
  try {
    await cap.Filesystem.mkdir({
      path: ANDROID_DIR,
      directory: cap.Directory.Documents,
      recursive: true,
    });
  } catch {
    // Directory already exists — ignore
  }
}

function sessionFileName(session) {
  const safe = (session.title || 'untitled').replace(/[^a-z0-9\-_]/gi, '_');
  return `${ANDROID_DIR}/${session.id}_${safe}.authbook`;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Save a session to a file.
 *  - Electron: uses existing filePath or triggers Save-As dialog
 *  - Android:  writes to Documents/AuthNo/<id>_<title>.authbook
 * Returns { success, filePath? } or throws on failure.
 */
export async function saveBook(session) {
  // ── Electron ──
  if (isElectron()) {
    if (session.filePath) {
      return window.electron.saveBook({ filePath: session.filePath, content: session });
    } else {
      return window.electron.saveAsBook({ content: session });
    }
  }

  // ── Android (Capacitor) ──
  if (isAndroid()) {
    const cap = await getFilesystem();
    if (!cap) throw new Error('Filesystem plugin not available');
    await ensureDir(cap);
    const path = sessionFileName(session);
    await cap.Filesystem.writeFile({
      path,
      data: JSON.stringify(session, null, 2),
      directory: cap.Directory.Documents,
      encoding: cap.Encoding.UTF8,
    });
    return { success: true, filePath: path };
  }

  // ── Web / localStorage fallback (session already synced by App.js) ──
  return { success: true };
}

/**
 * Trigger the Save-As dialog (Electron) or an OS share sheet (Android).
 */
export async function saveAsBook(session) {
  if (isElectron()) {
    return window.electron.saveAsBook({ content: session });
  }

  if (isAndroid()) {
    return exportBook(session);
  }

  return { success: true };
}

/**
 * Share / export a book file via the Android share sheet.
 * Writes to the cache dir first, then invokes the native share dialog.
 */
export async function exportBook(session) {
  const cap = await getFilesystem();
  const Share = await getShare();
  if (!cap || !Share) {
    alert('Export is not available on this device.');
    return;
  }

  const fileName = `${(session.title || 'book').replace(/[^a-z0-9\-_]/gi, '_')}.authbook`;
  try {
    // Write to cache so it can be shared as a file URI
    await cap.Filesystem.writeFile({
      path: fileName,
      data: JSON.stringify(session, null, 2),
      directory: cap.Directory.Cache,
      encoding: cap.Encoding.UTF8,
    });
    const { uri } = await cap.Filesystem.getUri({
      path: fileName,
      directory: cap.Directory.Cache,
    });
    await Share.share({
      title: `Export "${session.title}"`,
      url: uri,
      dialogTitle: 'Export Book as .authbook',
    });
    return { success: true };
  } catch (err) {
    console.error('[storageAdapter] exportBook failed:', err);
    throw err;
  }
}

/**
 * Open a book file.
 *  - Electron: native file-open dialog
 *  - Android:  not yet supported via dialog; books are loaded from Documents/AuthNo/
 */
export async function openBook() {
  if (isElectron()) {
    return window.electron.openBook();
  }

  if (isAndroid()) {
    // Android doesn't have a system file picker for arbitrary types without an
    // additional plugin. Return null here; the app uses localStorage sessions.
    // To add full file-picker support, integrate @capacitor-community/file-picker.
    return null;
  }

  return null;
}

/**
 * List saved .authbook files from Documents/AuthNo/ on Android.
 * Returns an array of parsed session objects.
 */
export async function listAndroidBooks() {
  if (!isAndroid()) return [];
  const cap = await getFilesystem();
  if (!cap) return [];

  try {
    await ensureDir(cap);
    const { files } = await cap.Filesystem.readdir({
      path: ANDROID_DIR,
      directory: cap.Directory.Documents,
    });

    const books = [];
    for (const file of files) {
      if (!file.name.endsWith('.authbook')) continue;
      try {
        const { data } = await cap.Filesystem.readFile({
          path: `${ANDROID_DIR}/${file.name}`,
          directory: cap.Directory.Documents,
          encoding: cap.Encoding.UTF8,
        });
        books.push(JSON.parse(data));
      } catch {
        // Skip unreadable files
      }
    }
    return books;
  } catch {
    return [];
  }
}
