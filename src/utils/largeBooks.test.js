import {
  estimateBookBytes, isLargeBook, shouldWarn, formatSize, snippetOf,
  isUnhydrated, hasUnhydratedChapters, toPreviewSession, hydrateChapter, hydrateAll, canDeferLoad, isTextKnown,
  isMirrorStub, rehydrateStub, isPristineBook,
  LARGE_BOOK_BYTES, WARN_BOOK_BYTES,
} from './largeBooks';

const chap = (idx, content, over = {}) => ({
  chap_idx: idx, title: `Chapter ${idx}`, order: idx, content, ...over,
});

// ~1 MB of text per chapter (UTF-16: half a million code units).
const bigText = (mb) => '<p>' + 'x'.repeat(mb * 512 * 1024) + '</p>';

const book = (chapters) => ({ id: 'b1', title: 'Novel', chapters });

describe('sizing', () => {
  test('an empty or missing book is zero', () => {
    expect(estimateBookBytes(null)).toBe(0);
    expect(estimateBookBytes({})).toBe(0);
    expect(estimateBookBytes(book([]))).toBe(0);
  });

  test('counts every chapter, not just the first', () => {
    const one = estimateBookBytes(book([chap(1, bigText(1))]));
    const two = estimateBookBytes(book([chap(1, bigText(1)), chap(2, bigText(1))]));
    expect(two).toBeGreaterThan(one * 1.9);
  });

  test('a book over the threshold is large; a small one is not', () => {
    expect(isLargeBook(book([chap(1, bigText(6))]))).toBe(true);
    expect(isLargeBook(book([chap(1, '<p>a short story</p>')]))).toBe(false);
  });

  test('the warning band sits below the deferred-loading threshold', () => {
    // A book between the two warns but is not forced into preview mode.
    expect(WARN_BOOK_BYTES).toBeLessThan(LARGE_BOOK_BYTES);
    const mid = book([chap(1, bigText(4.5))]);
    expect(shouldWarn(mid)).toBe(true);
    expect(isLargeBook(mid)).toBe(false);
  });

  test('formats sizes readably', () => {
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('snippetOf', () => {
  test('strips tags and collapses whitespace', () => {
    expect(snippetOf('<p>It was  a <em>dark</em>\n night.</p>')).toBe('It was a dark night.');
  });

  test('decodes the entities the editor emits', () => {
    expect(snippetOf('<p>Tom&nbsp;&amp; Jerry</p>')).toBe('Tom & Jerry');
  });

  test('truncates long text with an ellipsis', () => {
    const out = snippetOf('<p>' + 'word '.repeat(200) + '</p>');
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out.endsWith('…')).toBe(true);
  });

  test('survives empty and missing content', () => {
    expect(snippetOf('')).toBe('');
    expect(snippetOf(null)).toBe('');
    expect(snippetOf(undefined)).toBe('');
  });
});

describe('the null / empty distinction', () => {
  // This is the whole safety story. `null` means "not loaded yet"; `''` means
  // "a real chapter the writer has left blank". Treating them alike is how a
  // blank file gets written over a manuscript.
  test('null content is unhydrated', () => {
    expect(isUnhydrated(chap(1, null))).toBe(true);
  });

  test('an empty string is NOT unhydrated', () => {
    expect(isUnhydrated(chap(1, ''))).toBe(false);
  });

  test('real content is not unhydrated', () => {
    expect(isUnhydrated(chap(1, '<p>words</p>'))).toBe(false);
  });

  test('a book is incomplete if any single chapter is unloaded', () => {
    expect(hasUnhydratedChapters(book([chap(1, '<p>a</p>'), chap(2, null)]))).toBe(true);
    expect(hasUnhydratedChapters(book([chap(1, '<p>a</p>'), chap(2, '')]))).toBe(false);
    expect(hasUnhydratedChapters(book([]))).toBe(false);
    expect(hasUnhydratedChapters(null)).toBe(false);
  });
});

describe('toPreviewSession', () => {
  const full = book([
    chap(1, '<p>It was a dark night.</p>'),
    chap(2, '<p>Then it rained.</p>', { synopsis: 'Weather.' }),
  ]);

  test('drops the bodies but keeps the chapter list', () => {
    const p = toPreviewSession(full);
    expect(p.chapters).toHaveLength(2);
    expect(p.chapters.every((c) => c.content === null)).toBe(true);
    expect(p.chapters[0].title).toBe('Chapter 1');
    expect(p.chapters[1].synopsis).toBe('Weather.');
  });

  test('keeps a readable snippet of each chapter', () => {
    const p = toPreviewSession(full);
    expect(p.chapters[0].preview).toBe('It was a dark night.');
    expect(p.chapters[1].preview).toBe('Then it rained.');
  });

  test('computes word counts while the text is still in hand', () => {
    // Once bodies are gone there is no way to recount without re-reading.
    const p = toPreviewSession(full);
    expect(p.chapters[0].word_count).toBe(5);
  });

  test('actually reduces the measured size', () => {
    const heavy = book([chap(1, bigText(6))]);
    expect(estimateBookBytes(toPreviewSession(heavy)))
      .toBeLessThan(estimateBookBytes(heavy) / 100);
  });

  test('marks the session so the save guard can see it', () => {
    expect(toPreviewSession(full)._preview).toBe(true);
    expect(hasUnhydratedChapters(toPreviewSession(full))).toBe(true);
  });
});

describe('hydrateChapter', () => {
  const preview = toPreviewSession(book([chap(1, '<p>one</p>'), chap(2, '<p>two</p>')]));
  const fresh = book([chap(1, '<p>one</p>'), chap(2, '<p>two</p>')]);

  test('fills in only the chapter asked for', () => {
    const out = hydrateChapter(preview, 2, fresh);
    expect(out.chapters[1].content).toBe('<p>two</p>');
    expect(out.chapters[0].content).toBeNull();
    expect(hasUnhydratedChapters(out)).toBe(true);
  });

  test('leaves the book untouched when the file has no such chapter', () => {
    // A chapter in the list but not the file means the two have diverged.
    // Inventing an empty one would write fiction into the book.
    const out = hydrateChapter(preview, 99, fresh);
    expect(out.chapters.every((c) => c.content === null)).toBe(true);
  });

  test('an empty chapter in the file hydrates to empty, not to null', () => {
    const out = hydrateChapter(preview, 1, book([chap(1, '')]));
    expect(out.chapters[0].content).toBe('');
    expect(isUnhydrated(out.chapters[0])).toBe(false);
  });
});

describe('hydrateAll', () => {
  const preview = toPreviewSession(book([chap(1, '<p>one</p>'), chap(2, '<p>two</p>')]));

  test('restores every chapter and clears the flag', () => {
    const out = hydrateAll(preview, book([chap(1, '<p>one</p>'), chap(2, '<p>two</p>')]));
    expect(hasUnhydratedChapters(out)).toBe(false);
    expect(out._preview).toBe(false);
    expect(out.chapters.map((c) => c.content)).toEqual(['<p>one</p>', '<p>two</p>']);
  });

  test('does not overwrite a chapter the reader already edited', () => {
    const edited = hydrateChapter(preview, 1, book([chap(1, '<p>one</p>')]));
    const withEdit = {
      ...edited,
      chapters: edited.chapters.map((c) => (c.chap_idx === 1 ? { ...c, content: '<p>EDITED</p>' } : c)),
    };
    const out = hydrateAll(withEdit, book([chap(1, '<p>one</p>'), chap(2, '<p>two</p>')]));
    expect(out.chapters[0].content).toBe('<p>EDITED</p>');
    expect(out.chapters[1].content).toBe('<p>two</p>');
  });

  test('fails closed when the file is missing a chapter', () => {
    // Incomplete must stay incomplete, so the save guard keeps refusing.
    // Reporting "loaded" here would drop chapter 2 from the written file.
    const out = hydrateAll(preview, book([chap(1, '<p>one</p>')]));
    expect(hasUnhydratedChapters(out)).toBe(true);
    expect(out._preview).toBe(true);
  });

  test('fails closed when the file could not be read at all', () => {
    const out = hydrateAll(preview, null);
    expect(hasUnhydratedChapters(out)).toBe(true);
    expect(out._preview).toBe(true);
  });
});

describe('canDeferLoad', () => {
  test('a saved book can defer', () => {
    expect(canDeferLoad({ filePath: 'content://x/1' })).toBe(true);
    expect(canDeferLoad({ filePath: '/home/me/book.authbook' })).toBe(true);
  });

  test('a book that has never been saved cannot', () => {
    // Dropping the bodies would leave nowhere to fetch them back from.
    expect(canDeferLoad({ id: 'draft', title: 'Untitled' })).toBe(false);
    expect(canDeferLoad({ filePath: '' })).toBe(false);
    expect(canDeferLoad(null)).toBe(false);
  });
});

describe('isTextKnown', () => {
  const real = book([chap(1, '<p>words</p>')]);

  test('a book we hold in full is known', () => {
    expect(isTextKnown(real)).toBe(true);
    expect(isTextKnown(book([chap(1, '')]))).toBe(true); // genuinely empty
  });

  test('a preview-mode book is not', () => {
    expect(isTextKnown(toPreviewSession(real))).toBe(false);
  });

  test('a quota-degraded mirror stub is not', () => {
    expect(isTextKnown({ id: 'b1', title: 'Novel', filePath: 'content://x/1', _mirrorStub: true })).toBe(false);
  });

  test('a legacy stub with a file but no chapters is not', () => {
    // Predates the _mirrorStub flag; a real book always has chapter 1.
    expect(isTextKnown({ id: 'b1', title: 'Novel', filePath: 'content://x/1' })).toBe(false);
  });

  test('a partially loaded book is not', () => {
    expect(isTextKnown(book([chap(1, '<p>a</p>'), chap(2, null)]))).toBe(false);
  });

  test('a brand new unsaved book with no chapters yet IS known', () => {
    // No filePath, so nothing was dropped — it really is new and empty.
    expect(isTextKnown({ id: 'new', title: 'Untitled Book', chapters: [] })).toBe(true);
  });

  test('nothing is not known', () => {
    expect(isTextKnown(null)).toBe(false);
    expect(isTextKnown(undefined)).toBe(false);
  });
});

// ── Booting from a degraded mirror ───────────────────────────────────────────

// What App.js writes when the mirror write throws on quota.
const stub = (over = {}) => ({
  id: 'b1', title: 'Novel', filePath: 'content://x/1',
  type: 'book', updated: '2026-02-01T00:00:00.000Z', _mirrorStub: true, ...over,
});

// What readSessionFromFile hands back: the whole book, decoded from disk.
const onDisk = (over = {}) => ({
  id: 'file-side-id', title: 'Novel', filePath: 'content://x/1', type: 'book',
  updated: '2026-01-01T00:00:00.000Z',
  authors: ['A. Writer'], genre: 'Fiction', language: 'en',
  chapters: [chap(1, '<p>one</p>'), chap(2, '<p>two</p>')],
  ...over,
});

describe('isMirrorStub', () => {
  test('the flag is enough', () => {
    expect(isMirrorStub(stub())).toBe(true);
  });

  test('a file with no chapters is one even without the flag', () => {
    const { _mirrorStub, ...legacy } = stub();
    expect(isMirrorStub(legacy)).toBe(true);
  });

  test('a real book is not', () => {
    expect(isMirrorStub({ ...book([chap(1, '<p>a</p>')]), filePath: 'content://x/1' })).toBe(false);
  });

  test('a preview book is not — it knows its chapter list', () => {
    const preview = toPreviewSession({ ...book([chap(1, '<p>a</p>')]), filePath: 'content://x/1' });
    expect(isMirrorStub(preview)).toBe(false);
  });

  test('a new unsaved book with no chapters is not — there is no file it lost', () => {
    expect(isMirrorStub({ id: 'new', title: 'Untitled Book', chapters: [] })).toBe(false);
  });

  test('nothing is not', () => {
    expect(isMirrorStub(null)).toBe(false);
    expect(isMirrorStub(undefined)).toBe(false);
  });
});

describe('rehydrateStub', () => {
  test('produces a preview-mode book with the real chapter list', () => {
    const out = rehydrateStub(stub(), onDisk());
    expect(out._preview).toBe(true);
    expect(out.chapters).toHaveLength(2);
    expect(out.chapters.map((c) => c.chap_idx)).toEqual([1, 2]);
    expect(hasUnhydratedChapters(out)).toBe(true);
  });

  test('the stub flag is gone', () => {
    const out = rehydrateStub(stub(), onDisk());
    expect(isMirrorStub(out)).toBe(false);
    expect('_mirrorStub' in out).toBe(false);
  });

  test('bodies are dropped but counts and snippets survive', () => {
    const out = rehydrateStub(stub(), onDisk());
    out.chapters.forEach((c) => {
      expect(c.content).toBeNull();
      expect(typeof c.word_count).toBe('number');
      expect(typeof c.preview).toBe('string');
    });
    expect(out.chapters[0].word_count).toBe(1);
  });

  test('keeps the in-app id, not the one in the file', () => {
    // resume state, widget deep links, the remembered large-book choice and
    // currentId all point at the in-app id. Adopting the file's orphans them.
    expect(rehydrateStub(stub(), onDisk()).id).toBe('b1');
  });

  test('the stub wins on fields it carries', () => {
    const out = rehydrateStub(stub({ title: 'Renamed Since' }), onDisk({ title: 'Novel' }));
    expect(out.title).toBe('Renamed Since');
    expect(out.updated).toBe('2026-02-01T00:00:00.000Z');
  });

  test('the file fills in what the stub dropped', () => {
    const out = rehydrateStub(stub(), onDisk());
    expect(out.authors).toEqual(['A. Writer']);
    expect(out.genre).toBe('Fiction');
  });

  test('an unreadable file leaves the stub exactly as it was', () => {
    const s = stub();
    expect(rehydrateStub(s, null)).toBe(s);
    expect(rehydrateStub(s, undefined)).toBe(s);
  });

  test('a chapterless read leaves the stub alone rather than clearing the flag', () => {
    // Clearing it here would tell isTextKnown and isContentless the book is
    // genuinely empty, which is the claim the save guards exist to disbelieve.
    const s = stub();
    const out = rehydrateStub(s, onDisk({ chapters: [] }));
    expect(out).toBe(s);
    expect(isMirrorStub(out)).toBe(true);
    expect(isTextKnown(out)).toBe(false);
  });

  test('the result still reads as text-unknown, so nothing treats it as empty', () => {
    expect(isTextKnown(rehydrateStub(stub(), onDisk()))).toBe(false);
  });

  test('nothing in, nothing out', () => {
    expect(rehydrateStub(null, onDisk())).toBeNull();
  });
});

// ── isPristineBook ───────────────────────────────────────────────────────────

describe('isPristineBook', () => {
  const untitled = (chapters, over = {}) => ({
    id: 'b1', type: 'book', title: 'Untitled Book', chapters, ...over,
  });

  test('an untitled book with one empty chapter is pristine', () => {
    expect(isPristineBook(untitled([chap(1, '')]))).toBe(true);
  });

  test('so is one with no title at all', () => {
    expect(isPristineBook(untitled([chap(1, '')], { title: '' }))).toBe(true);
  });

  /**
   * The bug this was extracted for. contenteditable emits &nbsp; routinely —
   * pressing space in an empty paragraph is enough — and the old inline check
   * stripped tags without decoding entities, so this read as text. The book
   * looked blank to its writer, failed the test, and "start on a blank page"
   * stacked another Untitled Book beside it. Which is the pile-up the whole
   * predicate exists to prevent.
   */
  test('a chapter holding only a non-breaking space is still pristine', () => {
    expect(isPristineBook(untitled([chap(1, '<p>&nbsp;</p>')]))).toBe(true);
    expect(isPristineBook(untitled([chap(1, '<p>&NBSP;</p>')]))).toBe(true);
  });

  test('markup with no text in it is still pristine', () => {
    expect(isPristineBook(untitled([chap(1, '<p><br></p>')]))).toBe(true);
    expect(isPristineBook(untitled([chap(1, '<p>   </p>')]))).toBe(true);
  });

  test('one real word anywhere is not', () => {
    expect(isPristineBook(untitled([chap(1, '<p>word</p>')]))).toBe(false);
    expect(isPristineBook(untitled([chap(1, ''), chap(2, '<p>word</p>')]))).toBe(false);
  });

  test('legacy flat content counts too', () => {
    expect(isPristineBook(untitled([], { content: '<p>word</p>' }))).toBe(false);
    expect(isPristineBook(untitled([], { content: '<p>&nbsp;</p>' }))).toBe(true);
  });

  test('a named book is never pristine, however empty', () => {
    expect(isPristineBook(untitled([chap(1, '')], { title: 'The Long Novel' }))).toBe(false);
  });

  test('a storyboard is not a blank book to reuse', () => {
    expect(isPristineBook(untitled([chap(1, '')], { type: 'storyboard' }))).toBe(false);
  });

  /**
   * The isTextKnown guard, which is the dangerous half. A preview book or a
   * quota-degraded stub reads as empty to any content check without being
   * empty — reusing one drops the writer into their real manuscript believing
   * it is a fresh blank page.
   */
  test('a preview-mode book is NOT pristine even though it looks empty', () => {
    const preview = toPreviewSession({
      id: 'b1', type: 'book', title: 'Untitled Book',
      filePath: 'content://x/1', chapters: [chap(1, '<p>a whole novel</p>')],
    });
    expect(preview.chapters[0].content).toBeNull();
    expect(isPristineBook(preview)).toBe(false);
  });

  test('nor is a quota-degraded stub', () => {
    expect(isPristineBook({
      id: 'b1', type: 'book', title: 'Untitled Book',
      filePath: 'content://x/1', _mirrorStub: true,
    })).toBe(false);
  });

  test('nothing is not pristine', () => {
    expect(isPristineBook(null)).toBe(false);
    expect(isPristineBook(undefined)).toBe(false);
  });
});
