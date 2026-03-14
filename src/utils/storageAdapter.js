/**
 * storageAdapter.js — Unified file I/O for AuthNo
 *
 * Electron  → window.electron IPC bridge (fileManager.js) — unchanged
 * Android   → @capacitor/filesystem   for reading/writing
 *             @capawesome/capacitor-file-picker  for opening files
 *             @capacitor/share        for exporting via share sheet
 */

import { isElectron, isAndroid } from './platform';

// ─── Lazy Capacitor plugin loaders ────────────────────────────────────────────

async function getFilesystem() {
  try {
    const mod = await import('@capacitor/filesystem');
    return { Filesystem: mod.Filesystem, Directory: mod.Directory, Encoding: mod.Encoding };
  } catch (e) {
    console.warn('[storageAdapter] @capacitor/filesystem unavailable:', e);
    return null;
  }
}

async function getShare() {
  try {
    return (await import('@capacitor/share')).Share;
  } catch (e) {
    console.warn('[storageAdapter] @capacitor/share unavailable:', e);
    return null;
  }
}

async function getFilePicker() {
  try {
    return (await import('@capawesome/capacitor-file-picker')).FilePicker;
  } catch (e) {
    console.warn('[storageAdapter] @capawesome/capacitor-file-picker unavailable:', e);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ANDROID_DIR = 'AuthNo';

async function ensureDir(cap) {
  try {
    await cap.Filesystem.mkdir({
      path: ANDROID_DIR,
      directory: cap.Directory.Documents,
      recursive: true,
    });
  } catch {
    // Already exists — fine
  }
}

/** Deterministic filename: id_sanitisedTitle.authbook */
function sessionFileName(session) {
  const safe = (session.title || 'untitled').replace(/[^a-z0-9\-_]/gi, '_').slice(0, 60);
  return `${ANDROID_DIR}/${session.id}_${safe}.authbook`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * SAVE
 * Electron  → overwrites existing filePath, or shows Save-As dialog for new files
 * Android   → writes to Documents/AuthNo/<id>_<title>.authbook
 */
export async function saveBook(session) {
  if (isElectron()) {
    if (session.filePath) {
      return window.electron.saveBook({ filePath: session.filePath, content: session });
    }
    return window.electron.saveAsBook({ content: session });
  }

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

  return { success: true };
}

/**
 * SAVE AS
 * Electron  → shows native Save-As dialog
 * Android   → triggers the OS share sheet so the user can send the file anywhere
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
 * EXPORT / SHARE  (Android only)
 * Writes the .authbook to the app cache directory, then opens the native
 * share sheet so the user can save it to Files, Drive, send via email, etc.
 */
export async function exportBook(session) {
  const cap = await getFilesystem();
  const Share = await getShare();
  if (!cap || !Share) {
    alert('Export is not available on this device.');
    return;
  }

  const safeName = (session.title || 'book').replace(/[^a-z0-9\-_]/gi, '_').slice(0, 60);
  const fileName = `${safeName}.authbook`;

  try {
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
      title: `Export "${session.title || 'Book'}"`,
      url: uri,
      dialogTitle: 'Export as .authbook',
    });
    return { success: true };
  } catch (err) {
    console.error('[storageAdapter] exportBook failed:', err);
    throw err;
  }
}

/**
 * OPEN BOOK
 * Electron  → native file-open dialog (unchanged)
 * Android   → opens the system file picker via @capawesome/capacitor-file-picker.
 *             The user selects any .authbook file from their storage and it is
 *             read back as a parsed session object.
 */
export async function openBook() {
  if (isElectron()) {
    return window.electron.openBook();
  }

  if (isAndroid()) {
    const FilePicker = await getFilePicker();
    if (!FilePicker) {
      alert('File picker is not available. Please update the app.');
      return null;
    }

    try {
      const result = await FilePicker.pickFiles({
        // .authbook has no registered MIME; request octet-stream + json as fallback
        types: ['application/octet-stream', 'application/json', '*/*'],
        multiple: false,
        readData: true, // returns base64 data inline — no second filesystem read needed
      });

      if (!result?.files?.length) return null; // user cancelled

      const file = result.files[0];
      let raw;

      if (file.data) {
        // readData:true → base64-encoded content
        raw = atob(file.data);
      } else if (file.path) {
        // Fallback: read from path
        const cap = await getFilesystem();
        if (!cap) return null;
        const read = await cap.Filesystem.readFile({
          path: file.path,
          encoding: cap.Encoding.UTF8,
        });
        raw = read.data;
      } else {
        alert('Could not read the selected file.');
        return null;
      }

      const content = JSON.parse(raw);
      return { ...content, filePath: file.path || file.name || null };
    } catch (err) {
      // User pressed back / cancelled — err.message usually contains "cancel"
      if (/cancel/i.test(err?.message || '')) return null;
      console.error('[storageAdapter] openBook error:', err);
      alert('Could not open that file — make sure it is a valid .authbook file.');
      return null;
    }
  }

  return null;
}

/**
 * LIST ANDROID BOOKS
 * Scans Documents/AuthNo/ and returns all valid parsed sessions.
 * Used on first launch to surface previously saved books.
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
        // Skip corrupt / unreadable files silently
      }
    }
    return books;
  } catch {
    return [];
  }
}
