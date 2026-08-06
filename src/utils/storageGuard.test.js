import { isContentless } from './storage';
import { sessionToBook } from './authbook';

// The scenario these guard against, start to finish:
//
//   1. A writer's books exceed the ~5 MB localStorage quota.
//   2. App.js catches the failed mirror write and degrades the mirror to
//      { id, title, filePath, type, updated } stubs so something survives.
//   3. The next launch boots from that mirror — nothing re-reads the .authbook
//      files, initBookIndex() is a no-op — so sessions are stubs.
//   4. Two seconds later the autosave loop hands each stub to saveBook.
//   5. sessionToBook turns a chapter-less session into one EMPTY chapter, and
//      the stub still carries filePath, so every manuscript is overwritten.
//
// Step 5 is the one that cannot be allowed to happen.

const stub = () => ({
  id: 'b1',
  title: 'My Novel',
  filePath: 'content://com.android.providers/document/1234',
  type: 'book',
  updated: '2026-01-01T00:00:00.000Z',
  _mirrorStub: true,
});

const realBook = () => ({
  id: 'b1',
  title: 'My Novel',
  filePath: 'content://com.android.providers/document/1234',
  type: 'book',
  chapters: [{ chap_idx: 1, title: 'One', order: 1, content: '<p>It was a dark night.</p>' }],
});

describe('isContentless', () => {
  test('recognises a degraded mirror stub', () => {
    expect(isContentless(stub())).toBe(true);
  });

  test('recognises a real book as having content', () => {
    expect(isContentless(realBook())).toBe(false);
  });

  test('accepts a legacy flat session with content but no chapters', () => {
    // Pre-chapter .authbook files load this way; they are real work.
    expect(isContentless({ id: 'b1', title: 'Old', content: '<p>words</p>' })).toBe(false);
  });

  test('treats whitespace-only flat content as contentless', () => {
    expect(isContentless({ id: 'b1', title: 'Old', content: '   \n  ' })).toBe(true);
  });

  test('treats a book with an empty chapter as having content', () => {
    // A genuinely new book: chapter 1 exists but is unwritten. It must still
    // be savable, or a new book could never be given a file.
    expect(isContentless({ id: 'b1', chapters: [{ chap_idx: 1, content: '' }] })).toBe(false);
  });

  test('survives null and undefined', () => {
    expect(isContentless(null)).toBe(true);
    expect(isContentless(undefined)).toBe(true);
    expect(isContentless({})).toBe(true);
  });
});

describe('the destruction path this guards', () => {
  test('a stub really does encode to a single empty chapter', () => {
    // This is the mechanism, asserted directly: without the guard, THIS is
    // what would be written over a finished manuscript.
    const book = sessionToBook(stub());
    expect(book.chapters).toHaveLength(1);
    expect((book.chapters[0].content ?? '').trim()).toBe('');
  });

  test('a real book still encodes its chapters', () => {
    const book = sessionToBook(realBook());
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].content).toContain('dark night');
  });

  test('the guard fires exactly on the sessions that would destroy a file', () => {
    // Has a filePath to overwrite AND nothing to write => refuse.
    expect(isContentless(stub()) && !!stub().filePath).toBe(true);
    // Real book => allow.
    expect(isContentless(realBook())).toBe(false);
    // Contentless but no filePath: nothing to destroy, so it must NOT be
    // blocked — a brand new book needs its first save to succeed.
    const fresh = { id: 'new', title: 'Untitled' };
    expect(!!fresh.filePath).toBe(false);
  });
});

describe('exports refuse a partially-loaded book', () => {
  // The text helpers in storage.js are all null-safe, so an unloaded chapter
  // does not throw on the way out — it renders as nothing. Without this guard
  // the writer gets their novel with blank chapters and no indication why.
  const preview = {
    id: 'b1',
    title: 'My Novel',
    filePath: 'content://com.android.providers/document/1234',
    chapters: [
      { chap_idx: 1, title: 'One', order: 1, content: '<p>loaded</p>', preview: 'loaded' },
      { chap_idx: 2, title: 'Two', order: 2, content: null, preview: 'not loaded yet' },
    ],
  };

  // Under jsdom there is no Electron bridge and no Android plugin, so
  // readSessionFromFile returns null and hydrateAll fails closed — the same
  // path as a genuinely unreadable file on a device.
  test.each(['exportAsTxt', 'exportAsHtml', 'exportAsEpub'])(
    '%s throws rather than emitting empty chapters',
    async (name) => {
      const mod = await import('./storage');
      await expect(mod[name](preview, { returnBytes: true })).rejects.toThrow(/whole book/i);
    }
  );

  test('a fully loaded book still exports', async () => {
    const { exportAsTxt } = await import('./storage');
    const whole = {
      ...preview,
      chapters: preview.chapters.map((c) => ({ ...c, content: c.content ?? '<p>now here</p>' })),
    };
    await expect(exportAsTxt(whole, { returnBytes: true })).resolves.toBeDefined();
  });
});

describe('chapter titles are defaulted on the way out, not just in', () => {
  test('an untitled chapter is written as Untitled', async () => {
    const { sessionToBook } = await import('./authbook');
    const book = sessionToBook({
      id: 'b1', title: 'Novel',
      chapters: [{ chap_idx: 1, order: 1, content: '<p>x</p>' }], // no title
    });
    expect(book.chapters[0].title).toBe('Untitled');
  });

  test('a real title is left alone', async () => {
    const { sessionToBook } = await import('./authbook');
    const book = sessionToBook({
      id: 'b1', title: 'Novel',
      chapters: [{ chap_idx: 1, order: 1, title: 'The Arrival', content: '<p>x</p>' }],
    });
    expect(book.chapters[0].title).toBe('The Arrival');
  });
});
