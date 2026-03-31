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
          if (msg.includes('Permission') || msg.includes('No content provider')) {
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
 */
export async function exportAsHtml(session) {
  const chapters = [...(session.chapters || [])].sort((a, b) => a.order - b.order);
  const chapHtml = chapters.map(ch => `
    <section class="chapter">
      <h2>${ch.title}</h2>
      <div class="content">${ch.content || ''}</div>
    </section>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="${session.language || 'en'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${session.title || 'Untitled'}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.8; color: #222; }
    h1   { font-size: 2em; margin-bottom: .2em; }
    .meta { color: #666; margin-bottom: 2em; font-size: .9em; }
    .chapter { margin-top: 3em; }
    h2   { font-size: 1.4em; border-bottom: 1px solid #eee; padding-bottom: .3em; }
    .content { margin-top: 1em; }
  </style>
</head>
<body>
  <h1>${session.title || 'Untitled'}</h1>
  <div class="meta">
    ${(session.authors || []).map(a => a.name).filter(Boolean).join(', ')}
    ${session.genre ? `&nbsp;·&nbsp; ${session.genre}` : ''}
  </div>
  ${session.description ? `<p class="description"><em>${session.description}</em></p>` : ''}
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
  const chapters = [...(session.chapters || [])].sort((a, b) => a.order - b.order);
  const bookId   = session.id || String(Date.now());
  const title    = session.title    || 'Untitled';
  const language = session.language || 'en';
  const author   = (session.authors || []).map(a => a.name).filter(Boolean).join(', ') || 'Unknown';

  // ── Build file map ────────────────────────────────────────────────────────
  const files = {};

  // mimetype (must be first, uncompressed)
  files['mimetype'] = 'application/epub+zip';

  // META-INF/container.xml
  files['META-INF/container.xml'] = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  // Chapter XHTML files
  const chapItems   = [];
  const chapSpine   = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch   = chapters[i];
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
    chapItems.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    chapSpine.push(`<itemref idref="${id}"/>`);
  }

  // OEBPS/content.opf
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
    ${chapItems.join('\n    ')}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>${chapSpine.join('')}</spine>
</package>`;

  // OEBPS/nav.xhtml
  const navLi = chapters.map(ch =>
    `<li><a href="chap${ch.chap_idx}.xhtml">${ch.title}</a></li>`
  ).join('\n      ');
  files['OEBPS/nav.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body>
  <nav epub:type="toc"><ol>${navLi}</ol></nav>
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
  let cdSize = cdParts.reduce((n, b) => n + b.length, 0);

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
