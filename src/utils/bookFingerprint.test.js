import { bookFingerprint } from './bookFingerprint';

// A book whose fingerprint is unchanged is SKIPPED by the Android autosave
// loop and never written to its .authbook. So every case below is really the
// same assertion: "this edit still reaches the file."

const book = (over = {}) => ({
  id: 'b1',
  title: 'A Book',
  updated: '2026-01-01T00:00:00.000Z',
  chapters: [
    { chap_idx: 1, title: 'One', order: 1, content: '<p>hello</p>' },
    { chap_idx: 2, title: 'Two', order: 2, content: '<p>world</p>' },
  ],
  ...over,
});

const chapters = (b, idx, patch) => ({
  ...b,
  chapters: b.chapters.map((c) => (c.chap_idx === idx ? { ...c, ...patch } : c)),
});

describe('bookFingerprint', () => {
  test('is stable for an unchanged book', () => {
    expect(bookFingerprint(book())).toBe(bookFingerprint(book()));
  });

  test('survives a missing or empty book without throwing', () => {
    expect(bookFingerprint(null)).toBe('');
    expect(bookFingerprint(undefined)).toBe('');
    expect(() => bookFingerprint({})).not.toThrow();
    expect(() => bookFingerprint({ chapters: null })).not.toThrow();
  });

  // ── The three regressions ────────────────────────────────────────────────
  // Each of these left `updated`, the book title and the chapter count
  // identical, which is all the old fingerprint looked at.

  test('sees a chapter renamed from the editor', () => {
    const before = book();
    const after = chapters(before, 1, { title: 'Renamed' });
    expect(bookFingerprint(after)).not.toBe(bookFingerprint(before));
  });

  test('sees a changed writing goal', () => {
    const before = book({ streak: { goalWords: 300 } });
    const after = book({ streak: { goalWords: 500 } });
    expect(bookFingerprint(after)).not.toBe(bookFingerprint(before));
  });

  test('sees the coach clearing its demo paragraph', () => {
    const before = chapters(book(), 1, { content: '<p>hello</p><p data-coach-demo>demo</p>' });
    const after = chapters(book(), 1, { content: '<p>hello</p>' });
    expect(bookFingerprint(after)).not.toBe(bookFingerprint(before));
  });

  // ── Everything else that lands in the file ───────────────────────────────

  test('sees an edited synopsis', () => {
    const before = book();
    const after = chapters(before, 2, { synopsis: 'They meet.' });
    expect(bookFingerprint(after)).not.toBe(bookFingerprint(before));
  });

  test('sees chapters reordered', () => {
    const before = book();
    const after = { ...before, chapters: before.chapters.map((c) => ({ ...c, order: 3 - c.order })) };
    expect(bookFingerprint(after)).not.toBe(bookFingerprint(before));
  });

  test('sees a chapter added or deleted', () => {
    const before = book();
    const added = { ...before, chapters: [...before.chapters, { chap_idx: 3, title: 'Three', order: 3, content: '' }] };
    const removed = { ...before, chapters: before.chapters.slice(0, 1) };
    expect(bookFingerprint(added)).not.toBe(bookFingerprint(before));
    expect(bookFingerprint(removed)).not.toBe(bookFingerprint(before));
  });

  test('sees typing, via the length of the content', () => {
    const before = book();
    const after = chapters(before, 1, { content: '<p>hello there</p>' });
    expect(bookFingerprint(after)).not.toBe(bookFingerprint(before));
  });

  test('sees a same-length rewrite through the updated stamp', () => {
    // Length alone cannot separate these two, which is exactly why `updated`
    // is part of the fingerprint rather than being replaced by it.
    const before = chapters(book(), 1, { content: '<p>hello</p>' });
    const after = {
      ...chapters(book(), 1, { content: '<p>HELLO</p>' }),
      updated: '2026-01-02T00:00:00.000Z',
    };
    expect(bookFingerprint(after)).not.toBe(bookFingerprint(before));
  });

  // ── Field boundaries ─────────────────────────────────────────────────────

  test('does not confuse two books whose fields concatenate the same way', () => {
    // Titles "ab" + "c" versus "a" + "bc" — identical if the fields were
    // simply glued together, distinct because the separators cannot occur in
    // a title.
    const a = { ...book(), chapters: [
      { chap_idx: 1, title: 'ab', order: 1, content: '' },
      { chap_idx: 2, title: 'c', order: 2, content: '' },
    ] };
    const b = { ...book(), chapters: [
      { chap_idx: 1, title: 'a', order: 1, content: '' },
      { chap_idx: 2, title: 'bc', order: 2, content: '' },
    ] };
    expect(bookFingerprint(a)).not.toBe(bookFingerprint(b));
  });

  test('separates a title ending in digits from the content length beside it', () => {
    // title "Chapter 1" + length 0 must not read as title "Chapter" + length 10.
    const a = { ...book(), chapters: [{ chap_idx: 1, title: 'Chapter 1', order: 1, content: '' }] };
    const b = { ...book(), chapters: [{ chap_idx: 1, title: 'Chapter ', order: 1, content: '0123456789' }] };
    expect(bookFingerprint(a)).not.toBe(bookFingerprint(b));
  });
});
