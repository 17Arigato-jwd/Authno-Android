/**
 * history.js — change history for the Undo/Redo panel (v1.1.18)
 *
 * A book's history is a newest-first array of entries stored on the session
 * object (`session.history`). While writing, up to SESSION_HISTORY_LIMIT
 * entries are kept in memory; when the book is saved, the most recent
 * BOOK_HISTORY_LIMIT entries ride into the .authbook (inside META, like
 * threads) and come back on load.
 *
 * Model: every entry is a restorable snapshot of ONE chapter (plus a few
 * book-level kinds). Clicking an entry in the panel puts that chapter back
 * into the captured state; the restore itself is recorded as a new entry, so
 * clicking around is always safe — nothing is destructive.
 *
 * Typing is coalesced: consecutive edits to the same chapter within
 * COALESCE_MS collapse into a single entry whose snapshot tracks the latest
 * state of the burst (like Docs' "editing session" grouping). When a new
 * burst starts, a checkpoint of the pre-burst text is inserted so the state
 * BEFORE the burst stays reachable.
 */

export const SESSION_HISTORY_LIMIT = 50;
export const BOOK_HISTORY_LIMIT = 10;

// Bursts: edits to the same chapter closer together than this merge into one
// entry. 90s ≈ "kept typing"; a pause longer than that reads as a new change.
const COALESCE_MS = 90_000;

// localStorage mirrors the whole sessions array, so unbounded snapshots could
// blow the ~5MB quota on long sessions of a big book. Oldest entries are
// dropped once the sum of snapshot text exceeds this budget.
const CONTENT_CHAR_BUDGET = 1_000_000;

let _seq = 0;
function _id(now) { return `h${now.toString(36)}${(_seq++ & 0xfff).toString(36)}`; }

export function wordCountOf(html) {
  const text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

function _trim(history) {
  let out = history.slice(0, SESSION_HISTORY_LIMIT);
  let chars = 0;
  for (let i = 0; i < out.length; i++) {
    chars += (out[i].content?.length || 0);
    if (chars > CONTENT_CHAR_BUDGET && i > 0) { out = out.slice(0, i); break; }
  }
  return out;
}

/**
 * Record a typing/formatting burst on one chapter.
 * Coalesces with the newest entry when it's the same chapter inside the
 * window; otherwise starts a new entry (adding a pre-burst checkpoint when
 * that state isn't already reachable).
 * Returns the new history array (input is not mutated).
 */
export function recordEdit(history, { chapIdx, chapTitle, beforeContent, afterContent }, now = Date.now()) {
  const h = history || [];
  const head = h[0];

  if (head && head.kind === 'edit' && head.chapIdx === chapIdx && now - head.ts < COALESCE_MS) {
    const updated = {
      ...head,
      ts: now,
      chapTitle: chapTitle ?? head.chapTitle,
      content: afterContent,
      words: wordCountOf(afterContent),
    };
    return _trim([updated, ...h.slice(1)]);
  }

  const prepend = [];
  const words = wordCountOf(afterContent);
  const prevWords = wordCountOf(beforeContent);
  prepend.push({
    id: _id(now), ts: now, kind: 'edit', chapIdx,
    chapTitle: chapTitle || `Chapter ${chapIdx}`,
    content: afterContent, words, prevWords,
  });

  // Keep the pre-burst state reachable: if no snapshot of this chapter in the
  // list already equals it, insert a checkpoint underneath the new entry.
  const lastForChap = h.find((e) => e.chapIdx === chapIdx && e.content != null);
  if ((!lastForChap || lastForChap.content !== beforeContent) && beforeContent != null) {
    prepend.push({
      id: _id(now - 1), ts: now - 1, kind: 'checkpoint', chapIdx,
      chapTitle: chapTitle || `Chapter ${chapIdx}`,
      content: beforeContent, words: prevWords,
    });
  }

  return _trim([...prepend, ...h]);
}

/**
 * Record a structural / book-level change. Kinds:
 *   'add-chapter'    { chapIdx, chapTitle, content? }        — restore re-creates it empty
 *   'delete-chapter' { chapIdx, chapTitle, content, order, synopsis } — restore brings it back
 *   'rename-chapter' { chapIdx, chapTitle }  (chapTitle = new title; coalesced)
 *   'rename-book'    { chapTitle }           (chapTitle = new book title; coalesced)
 *   'move-chapter'   { chapIdx, chapTitle, order }
 * Returns the new history array.
 */
export function recordOp(history, entry, now = Date.now()) {
  const h = history || [];
  const head = h[0];
  // Renames arrive per keystroke from the title inputs — collapse them.
  if (head && head.kind === entry.kind && head.chapIdx === (entry.chapIdx ?? null) &&
      (entry.kind === 'rename-chapter' || entry.kind === 'rename-book') &&
      now - head.ts < COALESCE_MS) {
    return _trim([{ ...head, ...entry, ts: now }, ...h.slice(1)]);
  }
  return _trim([{ id: _id(now), ts: now, chapIdx: null, ...entry }, ...h]);
}

/**
 * Build the state patch for restoring an entry onto a session.
 * Returns null when there's nothing to do (unknown id, or already in that
 * state); otherwise { patch, label } where patch = { chapters, content,
 * preview, history } ready for setSessions, and label describes the restore
 * for a toast.
 */
export function restorePatch(session, entryId, previewOf, now = Date.now()) {
  const h = session?.history || [];
  const entry = h.find((e) => e.id === entryId);
  if (!entry) return null;

  const chapters = [...(session.chapters || [])];

  if (entry.kind === 'rename-book') {
    if (session.title === entry.chapTitle) return null;
    const history = recordOp(h, { kind: 'restore', chapIdx: null, chapTitle: entry.chapTitle, label: 'Book title' }, now);
    return { patch: { title: entry.chapTitle, history }, label: `Restored title "${entry.chapTitle}"` };
  }

  if (entry.chapIdx == null || entry.content == null) {
    // Rename/move entries: re-apply the captured after-values.
    if (entry.kind === 'rename-chapter') {
      const i = chapters.findIndex((c) => c.chap_idx === entry.chapIdx);
      if (i === -1 || chapters[i].title === entry.chapTitle) return null;
      chapters[i] = { ...chapters[i], title: entry.chapTitle };
      const history = recordOp(h, { kind: 'restore', chapIdx: entry.chapIdx, chapTitle: entry.chapTitle }, now);
      return { patch: { chapters, history }, label: `Restored chapter name "${entry.chapTitle}"` };
    }
    return null;
  }

  const idx = chapters.findIndex((c) => c.chap_idx === entry.chapIdx);
  const nowIso = new Date(now).toISOString();

  // "Added chapter" is a marker, not a text snapshot — if the chapter still
  // exists, restoring it must NOT blank out whatever has been written since.
  if (entry.kind === 'add-chapter' && idx >= 0) return null;

  let restoredAsNew = false;
  if (idx >= 0) {
    if (chapters[idx].content === entry.content) return null; // already there
    if (entry.kind === 'delete-chapter') {
      // The deleted chapter's chap_idx has been REUSED by a newer chapter
      // (indices come from max+1, so deleting the highest then adding reuses
      // it). Never overwrite the newcomer — resurrect under a fresh idx.
      restoredAsNew = true;
    } else {
      chapters[idx] = { ...chapters[idx], content: entry.content, updated: nowIso };
    }
  }
  if (idx < 0 || restoredAsNew) {
    const freeIdx = restoredAsNew
      ? Math.max(...chapters.map((c) => c.chap_idx)) + 1
      : entry.chapIdx;
    const maxOrder = chapters.length ? Math.max(...chapters.map((c) => c.order)) : 0;
    chapters.push({
      chap_idx: freeIdx,
      title: entry.chapTitle || `Chapter ${entry.chapIdx}`,
      order: restoredAsNew ? maxOrder + 1 : (entry.order ?? maxOrder + 1),
      content: entry.content,
      created: nowIso, updated: nowIso,
      ...(entry.synopsis ? { synopsis: entry.synopsis } : {}),
    });
  }

  // Keep the first-chapter mirror honest (home preview reads it).
  const first = [...chapters].sort((a, b) => a.order - b.order)[0];
  const content = first?.content ?? '';
  const history = recordOp(h, {
    kind: 'restore', chapIdx: entry.chapIdx,
    chapTitle: entry.chapTitle || `Chapter ${entry.chapIdx}`,
    content: entry.content, words: wordCountOf(entry.content),
  }, now);

  return {
    patch: { chapters, content, preview: previewOf ? previewOf(content) : undefined, history },
    label: (idx >= 0 && !restoredAsNew)
      ? `Restored "${entry.chapTitle || `Chapter ${entry.chapIdx}`}"`
      : `Brought back "${entry.chapTitle || `Chapter ${entry.chapIdx}`}"`,
  };
}

/** Human label + detail line for a panel row. */
export function describeEntry(entry) {
  const chap = entry.chapTitle || (entry.chapIdx ? `Chapter ${entry.chapIdx}` : '');
  switch (entry.kind) {
    case 'edit': {
      const delta = (entry.words ?? 0) - (entry.prevWords ?? entry.words ?? 0);
      const d = delta > 0 ? `+${delta} words` : delta < 0 ? `${delta} words` : 'edited';
      return { title: `Edited ${chap}`, detail: d };
    }
    case 'checkpoint':     return { title: `Earlier version of ${chap}`, detail: `${entry.words ?? 0} words` };
    case 'add-chapter':    return { title: `Added ${chap}`, detail: 'new chapter' };
    case 'delete-chapter': return { title: `Deleted ${chap}`, detail: 'click to bring it back' };
    case 'rename-chapter': return { title: `Renamed chapter`, detail: `to "${chap}"` };
    case 'rename-book':    return { title: `Renamed book`, detail: `to "${chap}"` };
    case 'move-chapter':   return { title: `Moved ${chap}`, detail: 'reordered' };
    case 'restore':        return { title: `Restored ${chap || 'earlier version'}`, detail: entry.words != null ? `${entry.words} words` : '' };
    default:               return { title: 'Change', detail: '' };
  }
}

/** Short relative timestamp for panel rows ("just now", "5m ago", "2h ago"). */
export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const d = Math.round(hrs / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
