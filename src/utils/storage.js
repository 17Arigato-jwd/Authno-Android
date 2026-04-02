/**
 * storage.js — Unified file I/O for AuthNo
 *
 * Android save strategy:
 *   Save (existing file)  → overwrite silently using same path
 *   Save (new file)       → open SAF CREATE_DOCUMENT picker so user chooses location
 *   Save As               → SAF CREATE_DOCUMENT picker, always
 *   Open                  → SAF ACTION_OPEN_DOCUMENT picker (Android)
 *                           <input type="file"> (web / Electron fallback)
 *
 * Index functions (initBookIndex, listKnownBooks, pruneBookIndex, folderFromPath)
 * are exported as stubs so App.js and HomeScreen.jsx don't crash. The homescreen
 * book list is driven by App.js session state instead.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAVE_SUBDIR = 'AuthNo';

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

/**
 * Write bytes to the app-specific external directory.
 * Falls back to internal storage if External is unavailable.
 */
async function writeToAppDir(filename, bytes) {
  const { Filesystem, Directory } = await getFS();
  const b64  = bytesToBase64(bytes);
  const path = `${SAVE_SUBDIR}/${filename}`;

  try {
    await Filesystem.mkdir({
      path: SAVE_SUBDIR, directory: Directory.External, recursive: true,
    }).catch(() => {});
    await Filesystem.writeFile({ path, data: b64, directory: Directory.External });
    return { path, directory: 'External' };
  } catch (extErr) {
    console.warn('[storage] External dir failed, falling back to internal:', extErr.message);
  }

  await Filesystem.mkdir({
    path: SAVE_SUBDIR, directory: Directory.Data, recursive: true,
  }).catch(() => {});
  await Filesystem.writeFile({ path, data: b64, directory: Directory.Data });
  return { path, directory: 'Data' };
}

/**
 * Read all .authbook files from the app directory.
 * Checks External first, then Data.
 */
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
          const { data } = await Filesystem.readFile({
            path: `${SAVE_SUBDIR}/${f.name}`, directory: dir,
          });
          books.push(await decodeBytes(base64ToBytes(data), `${SAVE_SUBDIR}/${f.name}`));
        } catch { /* skip corrupt */ }
      }
    } catch { /* directory not available */ }
  }
  return books;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function initStoragePermissions() {}
export async function checkStoragePermission() { return 'granted'; }
export async function requestFullStoragePermission() { return 'granted'; }

// ─── Book Index stubs ─────────────────────────────────────────────────────────
// App.js and HomeScreen.jsx import these by name. They are no-ops in this
// version — the homescreen list is driven by App.js session state instead.

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

export async function initBookIndex() {}              // no-op — App.js calls on startup
export function listKnownBooks() { return []; }       // no-op — HomeScreen handles []
export async function pruneBookIndex() { return []; } // no-op — HomeScreen handles []

// ─── Core file I/O ────────────────────────────────────────────────────────────

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
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin('AuthnoFilePicker');

      // Existing SAF file — overwrite silently, no picker
      if (session.filePath?.startsWith('content://')) {
        try {
          await plugin.writeBytesToUri({ uri: session.filePath, base64: bytesToBase64(bytes) });
          return { success: true, filePath: session.filePath };
        } catch (writeErr) {
          const msg = writeErr?.message ?? '';
          if (
            msg.includes('Permission') ||
            msg.includes('No content provider') ||
            msg.includes('FILE_NOTCREATED') ||
            msg.includes('Could not open file descriptor') ||
            msg.includes('SecurityException')
          ) {
            // URI is permanently inaccessible — signal caller to clear it
            return { success: false, staleUri: true };
          }
          throw writeErr;
        }
      }

      // New file — open SAF picker so user chooses location
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
      const bytes = await encodeSession(session);
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin('AuthnoFilePicker');

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
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin('AuthnoFilePicker');
      const result = await plugin.openDocument();
      if (!result?.uri) return null;
      return decodeBytes(base64ToBytes(result.base64), result.uri);
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

export async function openBookFromBytes(base64, uri) {
  return decodeBytes(base64ToBytes(base64), uri);
}

export async function listSavedBooks() {
  if (!isAndroid()) return [];
  try {
    return await readAppDir();
  } catch (e) {
    logError('listSavedBooks', e);
    return [];
  }
}

export async function restoreSafBooks(sessions) {
  return sessions ?? [];
}

/**
 * Checks each session that has a filePath and returns an array of
 * sessions whose files are no longer accessible.
 */
export async function checkFileIntegrity(sessions) {
  if (!isAndroid()) return [];
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const plugin = registerPlugin('AuthnoFilePicker');
    const broken = [];
    for (const s of sessions) {
      if (!s.filePath?.startsWith('content://')) continue;
      try {
        const result = await plugin.checkUri({ uri: s.filePath });
        if (!result?.accessible) broken.push(s);
      } catch {
        broken.push(s);
      }
    }
    return broken;
  } catch {
    return [];
  }
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

// ─── Export helpers ───────────────────────────────────────────────────────────

function _stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function _triggerDownload(filename, content, mimeType) {
  if (isAndroid()) {
    // ── Android / Capacitor WebView ──────────────────────────────────────────
    // <a download> is silently blocked inside a WebView. Instead write the file
    // to the cache directory then hand the URI to the OS share sheet so the user
    // can save / open it with any compatible app (Files, Drive, etc.).
    const { Filesystem, Directory } = await getFS();
    const { Share } = await import('@capacitor/share');

    // Encode content to base64 (Filesystem.writeFile expects a base64 string)
    let b64;
    if (typeof content === 'string') {
      // TextEncoder → UTF-8 bytes → base64
      const bytes = new TextEncoder().encode(content);
      let binary = '';
      bytes.forEach(b => { binary += String.fromCharCode(b); });
      b64 = btoa(binary);
    } else {
      // Uint8Array (epub binary)
      let binary = '';
      content.forEach(b => { binary += String.fromCharCode(b); });
      b64 = btoa(binary);
    }

    await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri, dialogTitle: `Save ${filename}` });
  } else {
    // ── Web / Electron ───────────────────────────────────────────────────────
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 5000);
  }
}

function _safeName(session) {
  return (session.title || 'Untitled').replace(/[^a-z0-9\-_ ]/gi, '_').slice(0, 60).trim();
}

/**
 * Export all chapters as a plain text file.
 */
export async function exportAsTxt(session) {
  const chapters = [...(session.chapters || [])].sort((a, b) => a.order - b.order);
  const lines = [];
  lines.push(session.title || 'Untitled');
  if (session.description) lines.push('', session.description);
  lines.push('');
  for (const ch of chapters) {
    lines.push(`\n${'─'.repeat(40)}\n${ch.title}\n${'─'.repeat(40)}\n`);
    lines.push(_stripHtml(ch.content));
  }
  await _triggerDownload(`${_safeName(session)}.txt`, lines.join('\n'), 'text/plain');
}

/**
 * Export all chapters as a styled standalone HTML file.
 * Page 1: cover image (if available), else a styled title splash.
 * Page 2: book metadata (title, author, description, genre, …).
 * Page 3+: chapters.
 */
export async function exportAsHtml(session) {
  const chapters  = [...(session.chapters || [])].sort((a, b) => a.order - b.order);
  const title     = session.title    || 'Untitled';
  const language  = session.language || 'en';
  const authors   = (session.authors || []).map(a => a.name).filter(Boolean).join(', ');
  const hasCover  = !!session.coverBase64;
  const coverMime = session.coverMime || 'image/jpeg';

  // ── Cover page ────────────────────────────────────────────────────────────
  const coverPage = hasCover
    ? `<section class="cover-page">
        <img src="data:${coverMime};base64,${session.coverBase64}" alt="Book cover" class="cover-img" />
      </section>`
    : `<section class="cover-page cover-page--text">
        <div class="cover-title-block">
          <h1 class="cover-title">${title}</h1>
          ${authors ? `<p class="cover-author">${authors}</p>` : ''}
        </div>
      </section>`;

  // ── Metadata page ─────────────────────────────────────────────────────────
  const metaRows = [
    authors                && ['Author(s)',    authors],
    session.genre          && ['Genre',        session.genre],
    session.language       && ['Language',     session.language],
    session.publisher      && ['Publisher',    session.publisher],
    session.isbn           && ['ISBN',         session.isbn],
    session.created        && ['Written',      new Date(session.created).getFullYear()],
  ].filter(Boolean);

  const metaPage = `<section class="meta-page">
    <h2 class="meta-heading">${title}</h2>
    ${session.description ? `<p class="meta-desc">${session.description}</p>` : ''}
    ${metaRows.length ? `<table class="meta-table">
      ${metaRows.map(([k, v]) => `<tr><td class="meta-key">${k}</td><td class="meta-val">${v}</td></tr>`).join('\n      ')}
    </table>` : ''}
  </section>`;

  // ── Chapter pages ─────────────────────────────────────────────────────────
  const chapHtml = chapters.map(ch => `
    <section class="chapter">
      <h2>${ch.title}</h2>
      <div class="content">${ch.content || ''}</div>
    </section>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body   { font-family: Georgia, serif; margin: 0; padding: 0; color: #222; }

    /* Cover page */
    .cover-page {
      width: 100%; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      page-break-after: always; break-after: page;
      background: #111;
    }
    .cover-img  { max-width: 100%; max-height: 100vh; object-fit: contain; display: block; }
    .cover-page--text { background: #1a1a2e; }
    .cover-title-block { text-align: center; padding: 3rem 2rem; }
    .cover-title  { font-size: 3em; color: #fff; margin: 0 0 .4em; letter-spacing: -1px; }
    .cover-author { font-size: 1.3em; color: #aaa; margin: 0; }

    /* Metadata page */
    .meta-page {
      max-width: 640px; margin: 0 auto; padding: 60px 32px;
      page-break-after: always; break-after: page;
    }
    .meta-heading { font-size: 1.8em; margin: 0 0 .6em; }
    .meta-desc    { color: #555; font-style: italic; line-height: 1.7; margin: 0 0 1.8em; }
    .meta-table   { border-collapse: collapse; width: 100%; font-size: .9em; }
    .meta-key     { color: #888; font-weight: 600; padding: 5px 16px 5px 0; white-space: nowrap; vertical-align: top; }
    .meta-val     { color: #333; padding: 5px 0; }

    /* Chapters */
    .chapter  { max-width: 700px; margin: 0 auto; padding: 60px 32px 40px; line-height: 1.8; }
    h2        { font-size: 1.4em; border-bottom: 1px solid #eee; padding-bottom: .3em; margin-top: 0; }
    .content  { margin-top: 1em; }
  </style>
</head>
<body>
  ${coverPage}
  ${metaPage}
  ${chapHtml}
</body>
</html>`;

  await _triggerDownload(`${_safeName(session)}.html`, html, 'text/html');
}

/**
 * Export as a valid ePub 3 file.
 * Builds the zip structure in-memory without any external library.
 */
export async function exportAsEpub(session) {
  const chapters  = [...(session.chapters || [])].sort((a, b) => a.order - b.order);
  const bookId    = session.id || String(Date.now());
  const title     = session.title    || 'Untitled';
  const language  = session.language || 'en';
  const author    = (session.authors || []).map(a => a.name).filter(Boolean).join(', ') || 'Unknown';
  const hasCover  = !!session.coverBase64;
  const coverMime = session.coverMime || 'image/jpeg';
  const coverExt  = coverMime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';

  // ── Build file map ────────────────────────────────────────────────────────
  // files entries are either strings (UTF-8) or Uint8Arrays (binary)
  const files = {};

  // mimetype — must be first and uncompressed
  files['mimetype'] = 'application/epub+zip';

  // META-INF/container.xml
  files['META-INF/container.xml'] = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  // ── Cover image (binary) ─────────────────────────────────────────────────
  if (hasCover) {
    // Decode the base64 cover stored in session and write it as a raw binary file
    const binary = atob(session.coverBase64);
    const imgBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) imgBytes[i] = binary.charCodeAt(i);
    files[`OEBPS/cover.${coverExt}`] = imgBytes;
  }

  // ── Spine items & manifest entries (prepend cover + metadata) ────────────
  const manifestItems = [];
  const spineItems    = [];

  // 1. Cover page XHTML (page 1)
  if (hasCover) {
    files['OEBPS/cover.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head>
  <title>Cover</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #111; }
    .cover-wrap { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  <div class="cover-wrap">
    <img src="cover.${coverExt}" alt="Cover" />
  </div>
</body>
</html>`;
    manifestItems.push(`<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>`);
    manifestItems.push(`<item id="cover-img"  href="cover.${coverExt}" media-type="${coverMime}" properties="cover-image"/>`);
    spineItems.push(`<itemref idref="cover-page"/>`);
  } else {
    // No image — generate a styled text splash as the cover page
    files['OEBPS/cover.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head>
  <title>Cover</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #1a1a2e; color: #fff; }
    .splash { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2em; box-sizing: border-box; }
    h1 { font-family: Georgia, serif; font-size: 2.4em; margin: 0 0 .4em; letter-spacing: -0.5px; }
    p  { font-family: Georgia, serif; font-size: 1.1em; color: #aaa; margin: 0; }
  </style>
</head>
<body>
  <div class="splash">
    <h1>${title}</h1>
    ${author !== 'Unknown' ? `<p>${author}</p>` : ''}
  </div>
</body>
</html>`;
    manifestItems.push(`<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="cover-page"/>`);
  }

  // 2. Metadata / title page (page 2)
  const metaRows = [
    author !== 'Unknown'  && ['Author(s)',  author],
    session.genre         && ['Genre',      session.genre],
    session.language      && ['Language',   session.language],
    session.publisher     && ['Publisher',  session.publisher],
    session.isbn          && ['ISBN',       session.isbn],
    session.created       && ['Written',    new Date(session.created).getFullYear()],
  ].filter(Boolean);

  files['OEBPS/metadata.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head>
  <title>About this book</title>
  <style>
    body { font-family: Georgia, serif; margin: 3em auto; max-width: 520px; padding: 0 2em; color: #222; line-height: 1.7; }
    h2   { font-size: 1.8em; margin: 0 0 .5em; }
    .desc { font-style: italic; color: #555; margin: 0 0 1.8em; }
    table { border-collapse: collapse; width: 100%; font-size: .9em; margin-top: 1em; }
    .k { color: #888; font-weight: 600; padding: 5px 16px 5px 0; white-space: nowrap; vertical-align: top; }
    .v { color: #333; padding: 5px 0; }
  </style>
</head>
<body>
  <h2>${title}</h2>
  ${session.description ? `<p class="desc">${session.description}</p>` : ''}
  ${metaRows.length ? `<table>${metaRows.map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`).join('')}</table>` : ''}
</body>
</html>`;
  manifestItems.push(`<item id="metadata-page" href="metadata.xhtml" media-type="application/xhtml+xml"/>`);
  spineItems.push(`<itemref idref="metadata-page"/>`);

  // 3. Chapter XHTML files (pages 3+)
  for (const ch of chapters) {
    const id   = `chap${ch.chap_idx}`;
    const href = `${id}.xhtml`;
    files[`OEBPS/${href}`] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head><title>${ch.title}</title>
<style>body{font-family:Georgia,serif;line-height:1.8;margin:2em;}</style>
</head>
<body>
  <h1>${ch.title}</h1>
  ${ch.content || ''}
</body>
</html>`;
    manifestItems.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
  }

  // ── OEBPS/content.opf ────────────────────────────────────────────────────
  files['OEBPS/content.opf'] = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${bookId}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${language}</dc:language>
    <dc:creator>${author}</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;

  // ── OEBPS/nav.xhtml ───────────────────────────────────────────────────────
  const navLi = [
    `<li><a href="cover.xhtml">Cover</a></li>`,
    `<li><a href="metadata.xhtml">About this Book</a></li>`,
    ...chapters.map(ch => `<li><a href="chap${ch.chap_idx}.xhtml">${ch.title}</a></li>`),
  ].join('\n      ');
  files['OEBPS/nav.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body>
  <nav epub:type="toc"><ol>
      ${navLi}
  </ol></nav>
</body>
</html>`;

  // ── Zip in-memory (store-only, no compression — valid for ePub) ───────────
  const enc     = new TextEncoder();
  const parts   = [];
  const entries = [];

  const crc32 = (bytes) => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = (t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const u32le = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const u16le = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };

  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const dataBytes = typeof content === 'string' ? enc.encode(content) : content;
    const crc       = crc32(dataBytes);
    const local     = new Uint8Array([
      0x50, 0x4B, 0x03, 0x04, // Local file header sig
      0x14, 0x00,             // version needed
      0x00, 0x00,             // general purpose flags
      0x00, 0x00,             // compression: store
      0x00, 0x00, 0x00, 0x00, // mod time/date (zero)
      ...u32le(crc),
      ...u32le(dataBytes.length),
      ...u32le(dataBytes.length),
      ...u16le(nameBytes.length),
      0x00, 0x00,
    ]);
    entries.push({ name: nameBytes, crc, size: dataBytes.length, offset });
    offset += local.length + nameBytes.length + dataBytes.length;
    parts.push(local, nameBytes, dataBytes);
  }

  // Central directory
  const cdParts = [];
  for (const e of entries) {
    const cd = new Uint8Array([
      0x50, 0x4B, 0x01, 0x02,
      0x14, 0x00, 0x14, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      ...u32le(e.crc),
      ...u32le(e.size), ...u32le(e.size),
      ...u16le(e.name.length),
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      ...u32le(e.offset),
    ]);
    cdParts.push(cd, e.name);
  }

  const cdOffset = offset;
  const cdSize   = cdParts.reduce((n, b) => n + b.length, 0);

  const eocd = new Uint8Array([
    0x50, 0x4B, 0x05, 0x06,
    0x00, 0x00, 0x00, 0x00,
    ...u16le(entries.length), ...u16le(entries.length),
    ...u32le(cdSize), ...u32le(cdOffset),
    0x00, 0x00,
  ]);

  // Concatenate everything
  const allParts = [...parts, ...cdParts, eocd];
  const total    = allParts.reduce((n, b) => n + b.length, 0);
  const out      = new Uint8Array(total);
  let at = 0;
  for (const b of allParts) { out.set(b, at); at += b.length; }

  await _triggerDownload(`${_safeName(session)}.epub`, out, 'application/epub+zip');
}
