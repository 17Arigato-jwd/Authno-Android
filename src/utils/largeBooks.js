/**
 * largeBooks.js — sizing, and the deferred-loading ("preview") shape.
 *
 * ── What the size limit actually is ──────────────────────────────────────────
 * There is no cap on how large a .authbook can be. The file format has none,
 * and neither does the editor. The pressure comes from the localStorage mirror
 * App.js keeps so books survive a restart: that store has a ~5 MB quota, it is
 * shared by EVERY book, and it holds full chapter text.
 *
 * So a single 5 MB book does not merely risk the quota — it consumes the whole
 * budget by itself and leaves nothing for the rest of the shelf. And the cost
 * is paid on every edit, because the mirror is re-serialised each time.
 *
 * That is why the threshold here is per book even though the budget is shared:
 * one book that big is the case a writer can actually act on.
 *
 * ── Preview mode ─────────────────────────────────────────────────────────────
 * A book opened in preview mode keeps its chapter list, titles, word counts and
 * a short text snippet, but NOT the chapter bodies. A body is fetched from the
 * file when its chapter is opened.
 *
 * An unhydrated chapter has `content: null`. That is deliberately distinct from
 * `''`, which is a real, empty, user-created chapter. Confusing the two is how
 * you write a blank file over somebody's manuscript, so nothing in this module
 * ever treats null and empty as interchangeable.
 */

/** A book at or above this is offered deferred loading. */
export const LARGE_BOOK_BYTES = 5 * 1024 * 1024;

/** Below this the warning would be noise; between the two we stay quiet. */
export const WARN_BOOK_BYTES = 4 * 1024 * 1024;

/**
 * Approximate on-disk/in-mirror size of a book.
 *
 * Measured from chapter text rather than JSON.stringify of the whole session:
 * stringify allocates a second copy of the entire book, which on the very books
 * this exists to identify is exactly the allocation we are trying to avoid.
 *
 * Uses UTF-16 code units (String.length) — what the JS engine actually holds,
 * and what localStorage counts against its quota.
 */
export function estimateBookBytes(session) {
  if (!session) return 0;
  let n = (session.content ?? '').length;
  for (const c of session.chapters || []) {
    n += (c.content ?? '').length;
    n += (c.title ?? '').length;
    n += (c.synopsis ?? '').length;
  }
  return n * 2; // UTF-16: two bytes per code unit
}

export function isLargeBook(session) {
  return estimateBookBytes(session) >= LARGE_BOOK_BYTES;
}

export function shouldWarn(session) {
  return estimateBookBytes(session) >= WARN_BOOK_BYTES;
}

export function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Longest sensible preview snippet kept per chapter. */
const SNIPPET_CHARS = 240;

/** Strip tags and squeeze whitespace, for a plain-text snippet. */
export function snippetOf(html, max = SNIPPET_CHARS) {
  const text = String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** True when this chapter's body has not been loaded yet. */
export function isUnhydrated(chapter) {
  return !!chapter && chapter.content === null;
}

/** True when any chapter still needs loading — i.e. the book is incomplete. */
export function hasUnhydratedChapters(session) {
  return (session?.chapters || []).some(isUnhydrated);
}

/**
 * Convert a fully-loaded session into the deferred shape.
 *
 * Keeps everything the chapter list renders (title, order, word count, dates,
 * synopsis) plus a snippet, and drops the bodies. Word counts are computed here
 * while the text is still in hand, because once the body is gone there is no
 * way to recount without going back to the file.
 */
export function toPreviewSession(session) {
  if (!session) return session;
  return {
    ...session,
    _preview: true,
    content: '',
    chapters: (session.chapters || []).map((c) => ({
      ...c,
      word_count: typeof c.word_count === 'number' ? c.word_count : countWords(c.content),
      preview: c.preview ?? snippetOf(c.content),
      content: null,
    })),
  };
}

/**
 * True when a book could be loaded a chapter at a time.
 *
 * Deferred loading fetches each body back from the book's own file, so this is
 * simply "is there a file". A book that has only ever lived in memory — never
 * saved, or on a platform with no file access — has nothing to fetch from, and
 * putting it in preview mode would produce a chapter list whose chapters
 * cannot be opened. Worse, the bodies would be dropped to make it, and then
 * there is nowhere to get them back.
 */
export function canDeferLoad(session) {
  return !!session?.filePath;
}

// ── Remembering the answer ───────────────────────────────────────────────────
// Per book, not global: a writer may want one enormous manuscript deferred and
// still open everything else normally.

const CHOICE_KEY = 'authnoLargeBookChoice';

function readChoices() {
  try { return JSON.parse(localStorage.getItem(CHOICE_KEY)) ?? {}; }
  catch { return {}; }
}

/** 'preview' | 'full' | null (never asked, or the answer was not remembered). */
export function getLargeBookChoice(bookId) {
  const v = readChoices()[bookId];
  return v === 'preview' || v === 'full' ? v : null;
}

export function setLargeBookChoice(bookId, choice) {
  try {
    const all = readChoices();
    if (choice) all[bookId] = choice; else delete all[bookId];
    localStorage.setItem(CHOICE_KEY, JSON.stringify(all));
  } catch { /* the prompt simply reappears next time — not worth failing over */ }
}

export function clearLargeBookChoice(bookId) {
  setLargeBookChoice(bookId, null);
}

function countWords(html) {
  const text = snippetOf(html, Infinity);
  return text ? text.split(/\s+/).length : 0;
}

/**
 * Fill in one chapter's body from a freshly-read copy of the book.
 *
 * Returns the session unchanged when the chapter is not found, rather than
 * inventing an empty one — a missing chapter means the file and the list have
 * diverged, and guessing at that point writes fiction into somebody's book.
 */
export function hydrateChapter(session, chapIdx, fresh) {
  const body = (fresh?.chapters || []).find((c) => c.chap_idx === chapIdx);
  if (!body) return session;
  return {
    ...session,
    chapters: (session.chapters || []).map((c) =>
      c.chap_idx === chapIdx ? { ...c, content: body.content ?? '' } : c
    ),
  };
}

/**
 * Fill in every outstanding chapter. Used before saving, so a partially-loaded
 * book is never what gets written.
 *
 * Chapters absent from the fresh copy keep `content: null`, which leaves
 * hasUnhydratedChapters() true and the save refused. Failing closed is the
 * point: the alternative is silently dropping a chapter the file still has.
 */
export function hydrateAll(session, fresh) {
  const byIdx = new Map((fresh?.chapters || []).map((c) => [c.chap_idx, c]));
  const chapters = (session.chapters || []).map((c) => {
    if (!isUnhydrated(c)) return c;
    const body = byIdx.get(c.chap_idx);
    return body ? { ...c, content: body.content ?? '' } : c;
  });
  // Only drop the flag once nothing is outstanding. Clearing it while a
  // chapter is still missing would describe the book as complete when it is
  // not, and every guard downstream reads that claim.
  const complete = !chapters.some(isUnhydrated);
  return { ...session, ...(complete ? { _preview: false } : {}), chapters };
}
