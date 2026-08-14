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
  if (data.lastBookId === bookId) data.lastBookId = pickNewest(data.points, bookId);
  store(data);
}

/**
 * Drop points for books that no longer exist, and re-point `lastBookId` if it
 * was one of them.
 *
 * Called once at boot, and it is the belt to clearResume's braces. clearResume
 * had no callers at all: deleting a book left its point behind, and if it was
 * the book you were last writing in, `lastBookId` went on naming it. Nothing
 * downstream can resolve a deleted id, so the resume widget showed "Nothing
 * open yet", the home Continue card vanished, and the 'resume' startup mode
 * quietly degraded — with other books sitting right there, and no way for the
 * writer to know why. It healed itself only on the next write.
 *
 * Pruning at boot rather than only on delete because there is more than one
 * way a book leaves the list: handleDeleteBook is one, and the broken-file
 * modal's Remove is another that never went near it. A sweep against the
 * surviving ids does not care which door was used.
 *
 * @param {Iterable<string>} existingIds ids still in the library
 * @returns {number} how many stale points were dropped
 */
export function pruneResume(existingIds) {
  const live = new Set(existingIds || []);
  // An empty library at boot is more likely "not loaded yet" than "everything
  // was deleted", and wiping resume state on a slow start is not recoverable.
  if (live.size === 0) return 0;

  const data = load();
  const points = data.points || {};
  const stale = Object.keys(points).filter((id) => !live.has(id));
  if (!stale.length && (!data.lastBookId || live.has(data.lastBookId))) return 0;

  for (const id of stale) delete points[id];
  data.points = points;
  if (data.lastBookId && !live.has(data.lastBookId)) {
    data.lastBookId = pickNewest(points, data.lastBookId);
  }
  store(data);
  return stale.length;
}

/**
 * The most recently written-in book still on record, excluding one.
 *
 * Falling back to this rather than to null: losing the book you were last in
 * should send you to the one before it, not to an empty card.
 */
function pickNewest(points, excludeId) {
  let bestId = null;
  let bestTs = -1;
  for (const [id, p] of Object.entries(points || {})) {
    if (id === excludeId) continue;
    const ts = Number(p?.ts) || 0;
    if (ts > bestTs) { bestTs = ts; bestId = id; }
  }
  return bestId;
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
