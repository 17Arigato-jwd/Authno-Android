/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Electron  → window.electron IPC bridge (fileManager.js) — 100% unchanged
 * Android   → @capacitor/filesystem  (read/write)
 *             @capawesome/capacitor-file-picker  (open file dialog)
 *             @capacitor/share  (export via OS share sheet)
 */

import { isElectron, isAndroid } from "./platform";

// ─── Lazy plugin loaders (tree-shaken when unused) ────────────────────────────

async function getFS() {
  const m = await import("@capacitor/filesystem");
  return { Filesystem: m.Filesystem, Directory: m.Directory, Encoding: m.Encoding };
}

async function getShare() {
  return (await import("@capacitor/share")).Share;
}

async function getPicker() {
  return (await import("@capawesome/capacitor-file-picker")).FilePicker;
}

// ─── Android helpers ──────────────────────────────────────────────────────────

const DIR = "AuthNo"; // sub-folder inside Documents

async function ensureDir() {
  const { Filesystem, Directory } = await getFS();
  try {
    await Filesystem.mkdir({ path: DIR, directory: Directory.Documents, recursive: true });
  } catch {
    /* already exists */
  }
}

function bookPath(session) {
  const safe = (session.title || "untitled").replace(/[^a-z0-9\-_]/gi, "_").slice(0, 60);
  return `${DIR}/${session.id}_${safe}.authbook`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Save the current session to disk.
 *
 * Electron  → overwrites filePath if it exists, else triggers Save-As dialog
 * Android   → writes to Documents/AuthNo/<id>_<title>.authbook
 *
 * Returns { success: true, filePath? }
 */
export async function saveBook(session) {
  if (isElectron()) {
    if (session.filePath)
      return window.electron.saveBook({ filePath: session.filePath, content: session });
    return window.electron.saveAsBook({ content: session });
  }

  if (isAndroid()) {
    const { Filesystem, Directory, Encoding } = await getFS();
    await ensureDir();
    const path = bookPath(session);
    await Filesystem.writeFile({
      path,
      data: JSON.stringify(session, null, 2),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    return { success: true, filePath: path };
  }

  return { success: true };
}

/**
 * Save-As dialog (Electron) / OS share sheet (Android).
 */
export async function saveAsBook(session) {
  if (isElectron()) return window.electron.saveAsBook({ content: session });
  if (isAndroid()) return exportBook(session);
  return { success: true };
}

/**
 * Android: write to cache then open the native share sheet so the user
 * can send the file to Files, Drive, email, etc.
 */
export async function exportBook(session) {
  const { Filesystem, Directory, Encoding } = await getFS();
  const Share = await getShare();

  const safe = (session.title || "book").replace(/[^a-z0-9\-_]/gi, "_").slice(0, 60);
  const fileName = `${safe}.authbook`;

  await Filesystem.writeFile({
    path: fileName,
    data: JSON.stringify(session, null, 2),
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
  await Share.share({ title: `Export "${session.title}"`, url: uri, dialogTitle: "Export as .authbook" });
  return { success: true };
}

/**
 * Open an existing .authbook file.
 *
 * Electron  → native file-open dialog (unchanged)
 * Android   → system file picker via @capawesome/capacitor-file-picker
 *             Returns a parsed session object, or null if cancelled.
 */
export async function openBook() {
  if (isElectron()) return window.electron.openBook();

  if (isAndroid()) {
    const FilePicker = await getPicker();

    const result = await FilePicker.pickFiles({
      types: ["*/*"],
      multiple: false,
      readData: true, // returns base64 inline — no second FS read needed
    });

    if (!result?.files?.length) return null; // cancelled

    const file = result.files[0];
    let raw;

    if (file.data) {
      raw = atob(file.data);
    } else if (file.path) {
      const { Filesystem, Encoding } = await getFS();
      const r = await Filesystem.readFile({ path: file.path, encoding: Encoding.UTF8 });
      raw = r.data;
    } else {
      throw new Error("Could not read selected file.");
    }

    const content = JSON.parse(raw);
    return { ...content, filePath: file.path || file.name || null };
  }

  return null;
}

/**
 * Android only: scan Documents/AuthNo/ on startup and return all valid
 * sessions found there (used to restore previously saved books).
 */
export async function listSavedBooks() {
  if (!isAndroid()) return [];

  const { Filesystem, Directory, Encoding } = await getFS();
  await ensureDir();

  try {
    const { files } = await Filesystem.readdir({ path: DIR, directory: Directory.Documents });
    const books = [];
    for (const f of files) {
      if (!f.name.endsWith(".authbook")) continue;
      try {
        const { data } = await Filesystem.readFile({
          path: `${DIR}/${f.name}`,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        books.push(JSON.parse(data));
      } catch {
        /* skip corrupt files */
      }
    }
    return books;
  } catch {
    return [];
  }
}
