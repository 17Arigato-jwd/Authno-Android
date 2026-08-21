/**
 * library.js — the books the sandbox host is furnished with.
 *
 * Fabricated, and deliberately not empty. An extension author's first question
 * is "where does my contribution appear", and the answer is different with no
 * books, one book and several: `when` clauses read `book.isOpen`,
 * `book.isSaved` and `book.chapterCount`, and a library of nothing exercises
 * none of them. So: one saved book with chapters, and one unsaved draft with
 * a single empty chapter, which is the pair that makes the difference visible.
 *
 * The shapes match src/utils/authbook.js exactly — chapters keyed by numeric
 * `chap_idx`, with `order` and `word_count`. The sandbox's old mock invented
 * its own shape, and every documented pattern (`chapters.find(c => c.chap_idx
 * === n)`) silently returned undefined against it, so code that passed in the
 * sandbox broke on the first device.
 */

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const countWords = (html) => String(html || '')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
  .trim().split(/\s+/).filter(Boolean).length;

function chapter(chapIdx, title, content, synopsis = '') {
  return {
    chap_idx: chapIdx,
    title,
    order: chapIdx,
    content,
    synopsis,
    word_count: countWords(content),
    created: iso(now - 9 * 864e5),
    updated: iso(now - 36e5),
  };
}

function book(id, title, chapters, extra = {}) {
  return {
    id,
    title,
    type: 'book',
    content: chapters[0]?.content ?? '',
    preview: String(chapters[0]?.content ?? '').replace(/<[^>]*>/g, ' ').trim().slice(0, 100),
    chapters,
    authors: [{ name: 'Sandbox Author' }],
    genre: '',
    description: '',
    language: 'en',
    publisher: '',
    isbn: '',
    devices: [],
    filePath: null,
    created: iso(now - 9 * 864e5),
    updated: iso(now - 36e5),
    ...extra,
  };
}

export const SANDBOX_LIBRARY = [
  book('sandbox-book-1', 'The Salt Road', [
    chapter(1, 'Chapter 1: The Weighing House',
      '<p>Every caravan out of Terrek was weighed twice — once by the guild, once by whoever the guild was frightened of that season.</p>',
      'Two weighings, and what the second one is really for.'),
    chapter(2, 'Chapter 2: What the Camels Knew',
      '<p>Camels are not wise. They are, however, extremely well informed.</p>',
      'The lead camel refuses a gate three days running.'),
    chapter(3, 'Chapter 3: Forty Days of Nothing',
      '<p>White, white, wind, white.</p>', ''),
  ], {
    genre: 'Historical fiction',
    description: 'Eleven years of caravans, told from the weighing-house window.',
    // A path is what `book.isSaved` reads. The draft below deliberately has
    // none, so a `when` clause that gates on it can be seen doing its job.
    filePath: '/sandbox/The Salt Road.authbook',
  }),

  book('sandbox-book-2', 'Untitled draft', [
    chapter(1, 'Chapter 1', '', ''),
  ], {
    genre: '',
    description: '',
  }),
];

/** A fresh copy, so a session edited in one tab does not leak into a reset. */
export const freshLibrary = () => SANDBOX_LIBRARY.map((b) => ({
  ...b,
  chapters: b.chapters.map((c) => ({ ...c })),
}));
