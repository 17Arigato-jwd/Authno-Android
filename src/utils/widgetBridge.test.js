import { buildResumePayload } from './widgetBridge';

const chap = (idx, over = {}) => ({
  chap_idx: idx, order: idx, title: `Chapter ${idx}`, content: '<p>one two three</p>', ...over,
});

const book = (over = {}) => ({
  id: 'b1', title: 'The Long Novel', chapters: [chap(1), chap(2), chap(3)], ...over,
});

describe('buildResumePayload', () => {
  test('describes the book and chapter you were last in', () => {
    const out = buildResumePayload([book()], { bookId: 'b1', chapIdx: 2, ts: 1700000000000 });
    expect(out).toMatchObject({
      bookId: 'b1',
      bookTitle: 'The Long Novel',
      chapIdx: 2,
      chapTitle: 'Chapter 2',
      ts: 1700000000000,
    });
  });

  test('nothing recorded yet means no card', () => {
    expect(buildResumePayload([book()], null)).toBeNull();
    expect(buildResumePayload([book()], {})).toBeNull();
    expect(buildResumePayload([book()], { bookId: '' })).toBeNull();
  });

  test('a book deleted since gives no card, not a dead button', () => {
    expect(buildResumePayload([book()], { bookId: 'gone', chapIdx: 1 })).toBeNull();
    expect(buildResumePayload([], { bookId: 'b1', chapIdx: 1 })).toBeNull();
  });

  test('a chapter deleted since falls back rather than hiding the book', () => {
    const out = buildResumePayload([book()], { bookId: 'b1', chapIdx: 99 });
    expect(out.chapIdx).toBe(1);
    expect(out.chapTitle).toBe('Chapter 1');
  });

  test('the fallback is the first chapter BY ORDER, not by array position', () => {
    // The reorder trap: handleMoveChapter swaps `order` and leaves the array
    // alone, so index 0 is not the opening chapter afterwards.
    const reordered = book({
      chapters: [chap(1, { order: 3 }), chap(2, { order: 1 }), chap(3, { order: 2 })],
    });
    const out = buildResumePayload([reordered], { bookId: 'b1', chapIdx: 99 });
    expect(out.chapIdx).toBe(2);
  });

  test('counts the chapter you would land in', () => {
    const out = buildResumePayload([book()], { bookId: 'b1', chapIdx: 1 });
    expect(out.words).toBe(3);
  });

  test('prefers the maintained count over re-counting the text', () => {
    const withCount = book({ chapters: [chap(1, { word_count: 4210 })] });
    expect(buildResumePayload([withCount], { bookId: 'b1', chapIdx: 1 }).words).toBe(4210);
  });

  test('a chapter whose text is not loaded still reports its words', () => {
    // Deferred loading leaves content null but keeps word_count. Counting the
    // text alone would report zero on exactly the large books that need this.
    const deferred = book({ chapters: [chap(1, { content: null, word_count: 88000 })] });
    expect(buildResumePayload([deferred], { bookId: 'b1', chapIdx: 1 }).words).toBe(88000);
  });

  test('an untitled book and chapter still read as something', () => {
    const bare = { id: 'b1', chapters: [{ chap_idx: 1, order: 1, content: '' }] };
    const out = buildResumePayload([bare], { bookId: 'b1', chapIdx: 1 });
    expect(out.bookTitle).toBe('Untitled Book');
    expect(out.chapTitle).toBe('Untitled chapter');
    expect(out.words).toBe(0);
  });

  test('a book with no chapters at all does not throw', () => {
    const empty = { id: 'b1', title: 'Fresh', chapters: [] };
    const out = buildResumePayload([empty], { bookId: 'b1', chapIdx: 1 });
    expect(out).toMatchObject({ bookId: 'b1', bookTitle: 'Fresh', chapIdx: null, words: 0 });
  });

  test('survives malformed sessions in the list', () => {
    expect(() => buildResumePayload([null, undefined, {}, book()], { bookId: 'b1', chapIdx: 1 }))
      .not.toThrow();
    expect(buildResumePayload([null, book()], { bookId: 'b1', chapIdx: 1 }).bookId).toBe('b1');
  });

  test('is serialisable — it crosses the bridge as JSON', () => {
    const out = buildResumePayload([book()], { bookId: 'b1', chapIdx: 2, ts: 1 });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});
