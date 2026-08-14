/**
 * editorFormat.js — formatting helpers for the contentEditable editor.
 *
 * Everything routes through document.execCommand so operations join the
 * editor's native undo stack (the whole editor is execCommand-based —
 * see the same rule in ThreadLayer.jsx anchor insertion).
 */

import { countWordsIn } from './wordCount';

// ── Range helpers ─────────────────────────────────────────────────────────────

function selectionRangeIn(editorEl) {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !editorEl) return null;
  const range = s.getRangeAt(0);
  return editorEl.contains(range.commonAncestorContainer) ? range : null;
}

function rangeToHtml(range) {
  const div = document.createElement('div');
  div.appendChild(range.cloneContents());
  return div.innerHTML;
}

const esc = (v) => String(v).replace(/"/g, '&quot;');

/**
 * Apply arbitrary inline CSS (font-size in px, font-family, font-weight, …) to
 * the current selection inside editorEl, undo-safely via insertHTML.
 * execCommand only speaks legacy fontSize 1–7 / fontName — this is the escape
 * hatch that gives the toolbar real px sizes and font weights.
 */
export function applyInlineStyle(editorEl, styleObj) {
  const range = selectionRangeIn(editorEl);
  if (!range || range.collapsed) return false;
  const css = Object.entries(styleObj)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
    .join(';');
  const html = `<span style="${esc(css)}">${rangeToHtml(range)}</span>`;
  editorEl.focus();
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(range);
  try {
    if (document.execCommand('insertHTML', false, html)) return true;
  } catch { /* fall through */ }
  // Fallback: direct DOM wrap (loses undo for this op only).
  const span = document.createElement('span');
  span.setAttribute('style', css);
  try { range.surroundContents(span); }
  catch { const frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); }
  return true;
}

/** Select the editor's entire content (for the custom Select-all action). */
export function selectAllIn(editorEl) {
  if (!editorEl) return;
  const range = document.createRange();
  range.selectNodeContents(editorEl);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(range);
}

/** Insert plain text at the caret, undo-safely (custom Paste action). */
export function insertTextAtSelection(editorEl, text) {
  editorEl?.focus();
  try { document.execCommand('insertText', false, text); } catch { /* ignore */ }
}

export function insertHtmlAtSelection(editorEl, html) {
  editorEl?.focus();
  try { document.execCommand('insertHTML', false, html); } catch { /* ignore */ }
}

// ── HTML → text (entity-safe) ─────────────────────────────────────────────────

const TEXT_BLOCK_TAGS = /^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|TABLE|TR|HR|SECTION|ARTICLE|FIGURE|FIGCAPTION)$/;

function serializeText(node, out) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) { out.push(child.nodeValue || ''); continue; }
    if (child.nodeType !== 1) continue;
    if (child.tagName === 'BR') { out.push('\n'); continue; }
    serializeText(child, out);
    if (TEXT_BLOCK_TAGS.test(child.tagName)) out.push('\n');
  }
}

/**
 * Convert chapter HTML to plain text. Unlike the old regex tag-strip, this
 * also DECODES entities — previews used to show raw "&nbsp;" to the user.
 *
 * Block elements are separated by newlines. Plain `textContent` glued them
 * together, so the studio preview read "…a wet thumb.Her breathing had…" and
 * textStats().paragraphs — which splits on \n — always reported 1.
 */
export function htmlToText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  const out = [];
  serializeText(div, out);
  return out.join('').replace(/\n{3,}/g, '\n\n').replace(/ /g, ' ');
}

/** Preview snippet used by session lists. */
export function previewOf(html, len = 60) {
  const text = htmlToText(html).trim().replace(/\s+/g, ' ');
  return text.length > len ? `${text.slice(0, len)}…` : text;
}

// ── Paste sanitisation (F4) ───────────────────────────────────────────────────

const KEEP_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV',
  'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'HR', 'SPAN', 'A',
]);
// Inline styles that may survive a paste (ours; everything else is web junk).
const KEEP_STYLES = ['font-weight', 'font-style', 'text-decoration'];

/**
 * Strip foreign fonts/colors/classes/scripts from pasted HTML while keeping
 * the structure a writer cares about (bold/italic/lists/paragraphs/links).
 */
export function sanitizePastedHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  div.querySelectorAll('script,style,meta,link,iframe,object,embed,img,video,audio,form,input,button').forEach(el => el.remove());

  const walk = (node) => {
    [...node.children].forEach(walk);
    if (node === div) return;
    if (!KEEP_TAGS.has(node.tagName)) {
      node.replaceWith(...node.childNodes);   // unwrap unknown tags, keep text
      return;
    }
    // Scrub attributes: keep only href on links + a whitelisted style subset.
    const style = node.getAttribute('style') || '';
    const href = node.tagName === 'A' ? node.getAttribute('href') : null;
    [...node.attributes].forEach(a => node.removeAttribute(a.name));
    if (href && /^https?:/i.test(href)) { node.setAttribute('href', href); node.setAttribute('rel', 'noopener'); }
    const kept = style.split(';')
      .map(s => s.trim())
      .filter(s => KEEP_STYLES.some(k => s.toLowerCase().startsWith(k + ':')));
    if (kept.length) node.setAttribute('style', kept.join(';'));
  };
  [...div.children].forEach(walk);
  return div.innerHTML;
}

// ── Defanging book files (paste sanitisation's quieter sibling) ───────────────

/** Tags that can execute or fetch. None has ever been written by the editor. */
const DANGEROUS_TAGS = 'script,style,link,meta,iframe,frame,frameset,object,embed,applet,base,form,input,button,textarea,select,svg,math,img,video,audio,source,track';

/**
 * Strip the parts of a chapter's HTML that can run, and nothing else.
 *
 * Not sanitizePastedHtml. That one is a whitelist, and it is right for paste —
 * foreign HTML arrives full of the source site's fonts and colours and a
 * writer wants none of it. Running it over a book being loaded would delete
 * the writer's OWN colours, highlights, fonts and line spacing, because those
 * ride on inline styles the paste whitelist does not keep. Every book on the
 * device would quietly lose its formatting on the next open.
 *
 * So this removes only what can execute: script-ish elements, every `on*`
 * handler, and hrefs that are not plain links. Nothing the editor produces
 * matches any of that, which is why it is safe to run on files the writer
 * wrote themselves — and it has to be, because a book that arrived from
 * somebody else and a book that has been on this device for a year come
 * through the same door and cannot be told apart there.
 *
 * The threat is not hypothetical: a `.authbook` is a file people send each
 * other, chapters are dropped straight into a contentEditable, and an
 * `<img onerror>` in one would run with the app's own reach — the books on
 * disk and everything in localStorage.
 */
export function defangHtml(html) {
  if (!html || typeof html !== 'string') return html ?? '';
  // Nothing here is ever attached to the document, so setting innerHTML
  // neither runs a script nor fires an onerror — the parse is inert, and the
  // dangerous parts are gone before anything sees the result.
  if (typeof document === 'undefined') return html;
  const div = document.createElement('div');
  div.innerHTML = html;

  div.querySelectorAll(DANGEROUS_TAGS).forEach((el) => el.remove());

  div.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action')
          && !/^(https?:|mailto:|#|\/|$)/i.test(String(attr.value).trim())) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return div.innerHTML;
}

/** Every chapter of a book, defanged. Returns a new array; never mutates. */
export function defangChapters(chapters) {
  if (!Array.isArray(chapters)) return chapters;
  return chapters.map((c) => (
    c && typeof c.content === 'string' ? { ...c, content: defangHtml(c.content) } : c
  ));
}

// ── Chapter statistics (B9) ───────────────────────────────────────────────────

export function textStats(html) {
  const text = htmlToText(html);
  const trimmed = text.trim();
  // Not a space-split: these numbers are shown per chapter, and a chapter of
  // Japanese, Chinese or Thai has no spaces in it, so that reported 1 word and
  // a reading time of "< 1 min" for the whole thing.
  const words = countWordsIn(trimmed);
  const charsWithSpaces = text.length;
  const charsNoSpaces = text.replace(/\s/g, '').length;
  const sentences = trimmed ? (trimmed.match(/[.!?…]+(?=\s|$)/g) || []).length || (words > 0 ? 1 : 0) : 0;
  const paragraphs = trimmed ? trimmed.split(/\n{1,}|\r\n{1,}/).filter(p => p.trim()).length : 0;
  const readingMins = words / 200; // ~200 wpm average reader
  return { words, charsWithSpaces, charsNoSpaces, sentences, paragraphs, readingMins };
}

export function formatReadingTime(mins) {
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${Math.round(mins % 60)} min`;
}
