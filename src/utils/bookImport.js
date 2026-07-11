/**
 * bookImport.js — convert external documents into AuthNo book sessions.
 *
 * Home → "Import a Book" accepts:
 *   .txt .md               plain text / markdown (light md → html)
 *   .html .htm             sanitized through the paste whitelist
 *   .rtf                   control words stripped
 *   .docx                  word/document.xml out of the zip
 *   .odt                   content.xml out of the zip
 *   .epub                  spine chapters → AuthNo chapters
 *   .pdf                   text layer via pdfjs (lazy-loaded)
 *   .doc                   rejected with guidance (binary format — resave as .docx)
 *
 * Every converter returns { title, chapters: [{ title, html }] } and throws
 * ImportError with a human message when the file is faulty — including
 * "this is a whole webpage, not a manuscript" for scraped HTML.
 *
 * The imported session has NO filePath, so on Android the existing autosave
 * loop places it in the AuthNo folder until the user explicitly saves it.
 */

import { sanitizePastedHtml } from './editorFormat';

export class ImportError extends Error {}

const MAX_BYTES = 60 * 1024 * 1024;

// ── Small helpers ─────────────────────────────────────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function linesToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => (l.trim() ? `<p>${esc(l)}</p>` : '<p><br></p>'))
    .join('');
}

/** Light markdown: headings, bold, italics, hr. Everything else stays text. */
function mdToHtml(text) {
  const inline = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/_([^_]+)_/g, '<i>$1</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => {
      const t = l.trim();
      if (!t) return '<p><br></p>';
      if (/^(-{3,}|\*{3,})$/.test(t)) return '<hr>';
      const h = t.match(/^(#{1,3})\s+(.*)$/);
      if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      return `<p>${inline(t)}</p>`;
    })
    .join('');
}

function textOf(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return (tpl.content.textContent || '').trim();
}

function requireSubstance(html, what) {
  if (textOf(html).length < 20) {
    throw new ImportError(`Couldn't find any readable text in this ${what} — the file may be corrupted.`);
  }
  return html;
}

// ── Per-format converters ─────────────────────────────────────────────────────

function fromHtml(raw, filename) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  if (doc.querySelector('parsererror')) throw new ImportError('This HTML file could not be parsed.');

  // "Full-on webpage" detection: manuscripts exported from editors are almost
  // pure prose; scraped pages carry scripts, nav chrome and link farms.
  const links = doc.querySelectorAll('a[href]').length;
  const paras = doc.querySelectorAll('p').length;
  const chrome = doc.querySelectorAll('script, nav, iframe, form, header nav, [role="navigation"]').length;
  if (chrome > 2 || (links > 20 && links > paras)) {
    throw new ImportError('This looks like a saved webpage, not a manuscript — import rejected. Copy the text into a .txt or .docx instead.');
  }

  const root = doc.querySelector('article') || doc.querySelector('main') || doc.body;
  const html = requireSubstance(sanitizePastedHtml(root?.innerHTML || ''), 'HTML file');
  const title = doc.querySelector('title')?.textContent?.trim() || baseName(filename);
  return { title, chapters: [{ title: 'Chapter 1', html }] };
}

function fromRtf(raw, filename) {
  if (!raw.startsWith('{\\rtf')) throw new ImportError('Not a valid RTF file.');
  let t = raw
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(((+n % 65536) + 65536) % 65536))
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '');
  return { title: baseName(filename), chapters: [{ title: 'Chapter 1', html: requireSubstance(linesToHtml(t), 'RTF file') }] };
}

async function fromDocx(bytes, filename) {
  const zip = await loadZip(bytes, 'DOCX');
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new ImportError('This .docx has no document body — the file may be corrupted.');
  const xml = new DOMParser().parseFromString(docXml, 'application/xml');
  if (xml.querySelector('parsererror')) throw new ImportError('This .docx could not be parsed.');
  const paras = [...xml.getElementsByTagName('w:p')].map((pEl) =>
    [...pEl.getElementsByTagName('w:t')].map((t) => t.textContent).join('')
  );
  const html = requireSubstance(paras.map((t) => (t.trim() ? `<p>${esc(t)}</p>` : '<p><br></p>')).join(''), 'Word document');
  return { title: baseName(filename), chapters: [{ title: 'Chapter 1', html }] };
}

async function fromOdt(bytes, filename) {
  const zip = await loadZip(bytes, 'ODT');
  const contentXml = await zip.file('content.xml')?.async('string');
  if (!contentXml) throw new ImportError('This .odt has no content — the file may be corrupted.');
  const xml = new DOMParser().parseFromString(contentXml, 'application/xml');
  if (xml.querySelector('parsererror')) throw new ImportError('This .odt could not be parsed.');
  const paras = [...xml.getElementsByTagName('text:p')].map((p) => p.textContent ?? '');
  const html = requireSubstance(paras.map((t) => (t.trim() ? `<p>${esc(t)}</p>` : '<p><br></p>')).join(''), 'ODT document');
  return { title: baseName(filename), chapters: [{ title: 'Chapter 1', html }] };
}

async function fromEpub(bytes, filename) {
  const zip = await loadZip(bytes, 'EPUB');
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new ImportError('Not a valid EPUB (missing container.xml).');
  const opfPath = new DOMParser()
    .parseFromString(container, 'application/xml')
    .querySelector('rootfile')?.getAttribute('full-path');
  const opfXmlRaw = opfPath && (await zip.file(opfPath)?.async('string'));
  if (!opfXmlRaw) throw new ImportError('Not a valid EPUB (missing package document).');
  const opf = new DOMParser().parseFromString(opfXmlRaw, 'application/xml');

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = {};
  opf.querySelectorAll('manifest > item').forEach((it) => { manifest[it.getAttribute('id')] = it.getAttribute('href'); });
  const spineIds = [...opf.querySelectorAll('spine > itemref')].map((it) => it.getAttribute('idref'));
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || baseName(filename);

  const chapters = [];
  for (const id of spineIds) {
    const href = manifest[id];
    if (!href) continue;
    const file = zip.file(decodeURIComponent(opfDir + href).replace(/^\//, ''));
    if (!file) continue;
    const xhtml = await file.async('string');
    const doc = new DOMParser().parseFromString(xhtml, 'text/html');
    const body = sanitizePastedHtml(doc.body?.innerHTML || '');
    if (textOf(body).length < 20) continue; // covers, toc pages
    const chTitle = doc.querySelector('h1, h2, title')?.textContent?.trim() || `Chapter ${chapters.length + 1}`;
    chapters.push({ title: chTitle.slice(0, 80), html: body });
  }
  if (!chapters.length) throw new ImportError('No readable chapters found in this EPUB.');
  return { title, chapters };
}

async function fromPdf(bytes, filename) {
  // pdfjs is ~2 MB, loaded only when a PDF is actually imported. The legacy
  // UMD build avoids CRA/webpack ESM friction; worker runs inline (fake
  // worker) — fine for one-shot imports.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = false;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useWorkerFetch: false }).promise;
  } catch {
    throw new ImportError('This PDF could not be opened — it may be corrupted or password-protected.');
  }
  const paras = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = '';
    let lastY = null;
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { paras.push(line); line = ''; }
      line += item.str;
      lastY = y;
    }
    if (line) paras.push(line);
    paras.push(''); // page break → blank paragraph
  }
  try { doc.destroy(); } catch { /* best-effort */ }
  const html = requireSubstance(paras.map((t) => (t.trim() ? `<p>${esc(t)}</p>` : '<p><br></p>')).join(''), 'PDF');
  return { title: baseName(filename), chapters: [{ title: 'Chapter 1', html }] };
}

async function loadZip(bytes, what) {
  const { default: JSZip } = await import('jszip');
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new ImportError(`This ${what} file is corrupted (not a readable archive).`);
  }
}

function baseName(filename) {
  return (filename || 'Imported Book').replace(/\.[^.]+$/, '').slice(0, 80) || 'Imported Book';
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const IMPORT_ACCEPT = '.txt,.md,.markdown,.html,.htm,.rtf,.doc,.docx,.odt,.epub,.pdf';

/**
 * @param {File} file  from an <input type="file">
 * @returns {Promise<{title, chapters:[{title, html}]}>}
 * @throws {ImportError} with a user-facing message
 */
export async function convertFileToBook(file) {
  if (!file) throw new ImportError('No file selected.');
  if (file.size > MAX_BYTES) throw new ImportError('This file is too large to import (60 MB limit).');
  const ext = (file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

  if (ext === 'doc') {
    throw new ImportError('Legacy .doc files aren’t supported — open it in Word/LibreOffice and save as .docx, then import that.');
  }

  const asText = () => file.text();
  const asBytes = async () => new Uint8Array(await file.arrayBuffer());

  switch (ext) {
    case 'txt':      return { title: baseName(file.name), chapters: [{ title: 'Chapter 1', html: requireSubstance(linesToHtml(await asText()), 'text file') }] };
    case 'md':
    case 'markdown': return { title: baseName(file.name), chapters: [{ title: 'Chapter 1', html: requireSubstance(mdToHtml(await asText()), 'markdown file') }] };
    case 'html':
    case 'htm':      return fromHtml(await asText(), file.name);
    case 'rtf':      return fromRtf(await asText(), file.name);
    case 'docx':     return fromDocx(await asBytes(), file.name);
    case 'odt':      return fromOdt(await asBytes(), file.name);
    case 'epub':     return fromEpub(await asBytes(), file.name);
    case 'pdf':      return fromPdf(await asBytes(), file.name);
    default:
      throw new ImportError(`Unsupported file type ".${ext}". Supported: txt, md, html, rtf, docx, odt, epub, pdf.`);
  }
}

/** Build a full AuthNo session object from a converted book. */
export function bookToNewSession({ title, chapters }) {
  const now = new Date().toISOString();
  const chaps = chapters.map((c, i) => ({
    chap_idx: i + 1, title: c.title || `Chapter ${i + 1}`, order: i + 1,
    content: c.html, created: now, updated: now,
  }));
  const first = chaps[0]?.content ?? '';
  return {
    id: Date.now().toString(), title, type: 'book',
    content: first, preview: textOf(first).slice(0, 120),
    created: now, updated: now, chapters: chaps,
    authors: [], devices: [], genre: '', description: '', language: 'en', publisher: '', isbn: '',
  };
}
