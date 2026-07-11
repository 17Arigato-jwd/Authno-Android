/**
 * resumeState.js — where the user stopped writing, per book.
 *
 * Backs the "Resume writing" fast path: startup mode, the home-screen
 * Continue card, the widget's Start Writing button and the launcher
 * shortcut all reopen the exact chapter, caret position and scroll offset
 * recorded here. Stored in localStorage — tiny, synchronous, survives
 * restarts, and never worth a native round-trip.
 */

const KEY = 'authno_resume_v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function store(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota — resume is best-effort */ }
}

/** point: { chapIdx, caret, scroll } — merged with a timestamp. */
export function saveResumePoint(bookId, point) {
  if (!bookId) return;
  const data = load();
  data.points = { ...(data.points || {}), [bookId]: { ...point, ts: Date.now() } };
  data.lastBookId = bookId;
  store(data);
}

export function getResumePoint(bookId) {
  return load().points?.[bookId] ?? null;
}

/** @returns {null | { bookId, chapIdx?, caret?, scroll?, ts? }} */
export function getLastResume() {
  const data = load();
  if (!data.lastBookId) return null;
  return { bookId: data.lastBookId, ...(data.points?.[data.lastBookId] ?? {}) };
}

export function clearResume(bookId) {
  const data = load();
  if (data.points) delete data.points[bookId];
  if (data.lastBookId === bookId) data.lastBookId = null;
  store(data);
}

// ── Caret helpers (contentEditable) ──────────────────────────────────────────
// The caret is stored as a plain character offset into the editor's text
// content — stable across re-renders because restoring walks text nodes the
// same way the offset was measured.

export function caretOffsetIn(root) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !root) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

export function restoreCaretIn(root, offset) {
  if (!root || offset == null) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (remaining <= len) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }
    remaining -= len;
  }
  // Offset beyond current content (book edited elsewhere) — land at the end.
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  return false;
}
