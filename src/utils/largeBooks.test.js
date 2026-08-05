import {
  estimateBookBytes, isLargeBook, shouldWarn, formatSize, snippetOf,
  isUnhydrated, hasUnhydratedChapters, toPreviewSession, hydrateChapter, hydrateAll, canDeferLoad,
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
