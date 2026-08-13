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

import { countWords } from './wordCount';

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
 * True when we can actually see this book's text, and so can say something
 * about what is in it.
 *
 * There are several ways to be holding a book whose text is not in memory —
 * preview mode dropped it, the localStorage mirror degraded under quota, or an
 * older build left a stub with no chapters at all. Every one of them LOOKS
 * empty to any check that inspects chapter content.
 *
 * That distinction decides real behaviour. "Start on a blank page" reuses an
 * existing empty untitled book rather than stacking a new one each launch;
 * without this, an untitled book in any of those states qualified, and the
 * writer would be dropped into their real manuscript believing it was a fresh
 * blank one. The save guards stop that reaching the file, but "your book looks
 * empty and you are typing into it" is its own kind of alarming.
 *
 * Absence of evidence is not evidence of emptiness.
 */
export function isTextKnown(session) {
  if (!session) return false;
  if (session._preview || session._mirrorStub) return false;
  if (hasUnhydratedChapters(session)) return false;
  // A saved book with no chapters in memory is a stub from a build that
  // predates the _mirrorStub flag. A real book always has at least chapter 1.
  if (session.filePath && !(session.chapters || []).length) return false;
  return true;
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

// ── Booting from a degraded mirror ───────────────────────────────────────────
//
// App.js mirrors the session array into localStorage, and that mirror has a
// ~5 MB quota. A writer with a few hundred thousand words exceeds it, the write
// throws, and App.js degrades the mirror to `{id,title,filePath,type,updated}`
// stubs so that something survives. On the next launch that mirror is the only
// source of sessions, so the app boots holding stubs: the shelf lists every
// book and each one opens with no chapters.
//
// Nothing is lost — the .authbook files are untouched, and the save guards in
// storage.js refuse to write a stub back over a real book. The problem is that
// it looks exactly like loss, which for a writing app is its own harm.
//
// A stub and a preview-mode book already mean nearly the same thing: the file
// on disk is the real copy, and the bodies are not in memory. The difference is
// that a preview book knows its chapter list and a stub does not. So the fix is
// not a second mechanism, it is one file read that turns the stub into the
// thing the app already knows how to render, open, hydrate and refuse to
// clobber.

/**
 * True when this session is a shell left behind by a degraded mirror write.
 *
 * The flag is the reliable signal; the second clause covers stubs written by
 * builds that predate it. A real saved book always has at least chapter 1, so
 * "has a file but no chapters" cannot be anything else.
 */
export function isMirrorStub(session) {
  if (!session) return false;
  if (session._mirrorStub) return true;
  return !!session.filePath && !(session.chapters || []).length;
}

/**
 * Turn a stub back into a preview-mode book, using a session freshly read from
 * the stub's own file.
 *
 * Fails closed. A `fresh` that is null (unreadable file, revoked SAF grant, no
 * filesystem on this platform) or that carries no chapters leaves the stub
 * exactly as it was. That matters more than it looks: returning a chapter-less
 * session with the stub flag cleared would tell every downstream guard the book
 * is genuinely empty, and `isContentless` and `isTextKnown` are what stand
 * between a failed read and an overwritten manuscript.
 *
 * Where the two copies disagree the stub wins, because the stub is the app's
 * own record of live state and the file may predate an unsaved rename. Only
 * fields the stub does not carry at all — authors, genre, cover, the chapter
 * list itself — come from the file. `id` is forced from the stub even though
 * the file has one of its own: the in-app id is what resume state, the widget
 * links, the remembered large-book choice and `currentId` all point at, and
 * adopting the file's id would quietly orphan every one of them.
 */
export function rehydrateStub(stub, fresh) {
  if (!stub) return stub;
  if (!fresh || !(fresh.chapters || []).length) return stub;

  const preview = toPreviewSession(fresh);
  // Drop the flag by omission rather than setting it false — `isMirrorStub`
  // reads it as a boolean, but so does anything else that ever checks it, and
  // a stale `_mirrorStub: false` on a normal book is a claim nobody needs.
  const { _mirrorStub, ...carried } = stub;

  return {
    ...preview,
    ...carried,
    id:       stub.id,
    chapters: preview.chapters,
    content:  '',
    _preview: true,
  };
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

// Was its own whitespace split; shares the one counter now.

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
