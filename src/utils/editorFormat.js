/**
 * editorFormat.js — formatting helpers for the contentEditable editor.
 *
 * Everything routes through document.execCommand so operations join the
 * editor's native undo stack (the whole editor is execCommand-based —
 * see the same rule in ThreadLayer.jsx anchor insertion).
 */

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

/**
 * Convert chapter HTML to plain text. Unlike the old regex tag-strip, this
 * also DECODES entities — previews used to show raw "&nbsp;" to the user.
 */
export function htmlToText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').replace(/ /g, ' ');
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

// ── Chapter statistics (B9) ───────────────────────────────────────────────────

export function textStats(html) {
  const text = htmlToText(html);
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
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
