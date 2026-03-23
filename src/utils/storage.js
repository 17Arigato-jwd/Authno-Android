/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Electron  → window.electron IPC bridge (fileManager.js)     — unchanged
 * Android   → FilePickerPlugin (SAF) for save / save-as / open
 *             Falls back to @capacitor/filesystem for scanning
 *             legacy files that were saved before this change.
 *
 * SAF URI storage
 * ───────────────
 * When a file is created or opened via the SAF picker its content URI
 * (content://…) is stored in session.filePath.  Android holds a
 * persistent permission for that URI so we can read/write it in future
 * without showing the picker again.
 *
 * Legacy files (Documents/AuthNo/<id>_<title>.authbook)
 * ─────────────────────────────────────────────────────
 * listSavedBooks() still scans that directory so books saved by older
 * versions of the app are surfaced on first launch.  After the user
 * performs a "Save" or "Save As" those sessions will receive a SAF URI
 * and subsequent saves go through the SAF path.
 */

import { isElectron, isAndroid } from "./platform";

// ─── Lazy plugin loaders ──────────────────────────────────────────────────────

async function getSAFPlugin() {
  const { registerPlugin } = await import("@capacitor/core");
  return registerPlugin("AuthnoFilePicker");
}

async function getFS() {
  const m = await import("@capacitor/filesystem");
  return { Filesystem: m.Filesystem, Directory: m.Directory, Encoding: m.Encoding };
}

async function getShare() {
  return (await import("@capacitor/share")).Share;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when a filePath value is an Android SAF content URI. */
function isSafUri(filePath) {
  return typeof filePath === "string" && filePath.startsWith("content://");
}

/** Legacy Documents/AuthNo directory used by old versions. */
const LEGACY_DIR = "AuthNo";

async function ensureLegacyDir() {
  const { Filesystem, Directory } = await getFS();
  try {
    await Filesystem.mkdir({ path: LEGACY_DIR, directory: Directory.Documents, recursive: true });
  } catch {
    /* already exists */
  }
}

function legacyBookPath(session) {
  const safe = (session.title || "untitled").replace(/[^a-z0-9\-_]/gi, "_").slice(0, 60);
  return `${LEGACY_DIR}/${session.id}_${safe}.authbook`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Save the current session to disk.
 *
 * Electron  → overwrites filePath if it exists, else triggers Save-As dialog
 * Android   → if filePath is a SAF URI  → write directly (no picker)
 *             if filePath is a legacy path → write via Filesystem API
 *             if no filePath             → behave like saveAsBook (show picker)
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
    // ── SAF URI already known: write without a picker ──
    if (isSafUri(session.filePath)) {
      const plugin = await getSAFPlugin();
      await plugin.writeToUri({
        uri: session.filePath,
        content: JSON.stringify(session, null, 2),
      });
      return { success: true, filePath: session.filePath };
    }

    // ── Legacy path: use Capacitor Filesystem ──
    if (session.filePath && !isSafUri(session.filePath)) {
      const { Filesystem, Directory, Encoding } = await getFS();
      await Filesystem.writeFile({
        path: session.filePath,
        data: JSON.stringify(session, null, 2),
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      return { success: true, filePath: session.filePath };
    }

    // ── No path yet: open the "Create Document" picker (first save) ──
    return saveAsBook(session);
  }

  return { success: true };
}

/**
 * "Save As" — always opens the system file picker so the user can choose
 * a filename and location.
 *
 * Electron  → native Save dialog (unchanged)
 * Android   → SAF ACTION_CREATE_DOCUMENT picker
 *
 * Returns { success: true, filePath } or { cancelled: true }
 */
export async function saveAsBook(session) {
  if (isElectron()) return window.electron.saveAsBook({ content: session });

  if (isAndroid()) {
    const plugin = await getSAFPlugin();

    // Pre-fill the filename with the session title
    const safeName = (session.title || "Untitled").replace(/[^a-z0-9\-_ ]/gi, "_").slice(0, 60);
    const result = await plugin.createDocument({ fileName: `${safeName}.authbook` });

    if (!result?.uri) return { cancelled: true }; // user dismissed the picker

    // Write the content to the chosen location
    await plugin.writeToUri({
      uri: result.uri,
      content: JSON.stringify(session, null, 2),
    });

    return { success: true, filePath: result.uri };
  }

  return { success: true };
}

/**
 * Open an existing .authbook file.
 *
 * Electron  → native file-open dialog (unchanged)
 * Android   → SAF ACTION_OPEN_DOCUMENT picker
 *
 * Returns a parsed session object (with filePath set to the SAF URI),
 * or null if the user cancelled.
 */
export async function openBook() {
  if (isElectron()) return window.electron.openBook();

  if (isAndroid()) {
    const plugin = await getSAFPlugin();
    const result = await plugin.openDocument();

    if (!result?.uri) return null; // cancelled

    let parsed;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      throw new Error("Selected file is not a valid .authbook file.");
    }

    // Store the SAF URI so subsequent saves don't need a picker
    return { ...parsed, filePath: result.uri };
  }

  return null;
}

/**
 * Android only: scan the legacy Documents/AuthNo/ directory for books
 * saved by older versions of the app.
 *
 * New saves go through SAF and their URIs live in the session list in
 * localStorage — no directory scan needed for those.
 */
export async function listSavedBooks() {
  if (!isAndroid()) return [];

  const { Filesystem, Directory, Encoding } = await getFS();
  await ensureLegacyDir();

  try {
    const { files } = await Filesystem.readdir({ path: LEGACY_DIR, directory: Directory.Documents });
    const books = [];
    for (const f of files) {
      if (!f.name.endsWith(".authbook")) continue;
      try {
        const { data } = await Filesystem.readFile({
          path: `${LEGACY_DIR}/${f.name}`,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        const book = JSON.parse(data);
        // Keep the legacy path so older saves can still be overwritten
        books.push({ ...book, filePath: book.filePath || `${LEGACY_DIR}/${f.name}` });
      } catch {
        /* skip corrupt files */
      }
    }
    return books;
  } catch {
    return [];
  }
}

/**
 * Android only: re-read all sessions that have SAF URIs from disk.
 * Call on startup alongside listSavedBooks() to restore SAF-based files.
 *
 * Pass in the full sessions array from localStorage; this function
 * refreshes any session whose filePath is a content:// URI.
 */
export async function restoreSafBooks(sessions) {
  if (!isAndroid() || !sessions?.length) return sessions ?? [];

  const plugin = await getSAFPlugin();
  const refreshed = [];

  for (const session of sessions) {
    if (!isSafUri(session.filePath)) {
      refreshed.push(session);
      continue;
    }
    try {
      const result = await plugin.readFromUri({ uri: session.filePath });
      const parsed = JSON.parse(result.content);
      refreshed.push({ ...parsed, filePath: session.filePath });
    } catch {
      // URI no longer valid (file deleted / permission revoked) — keep the
      // last in-memory copy so the user can still see and re-save it.
      refreshed.push(session);
    }
  }

  return refreshed;
}

/**
 * Android: export via OS share sheet (kept for any "Share" action you
 * want to add alongside Save / Save As).
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
