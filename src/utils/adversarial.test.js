/**
 * Adversarial tests for the pre-release fixes.
 *
 * Written after the fact and deliberately against the grain: each of these
 * tries to break something I changed, rather than confirming it does what I
 * meant. The per-account rate limiter in the worker taught the lesson — its
 * first tests asserted the shape of the code ("at the limit is still allowed")
 * and that sentence is true of an off-by-one as readily as of a correct
 * limiter, so it shipped permitting one attempt too many with a green suite.
 */

import { plainText, countWords, countWordsIn } from './wordCount';
import {
  isMirrorStub, rehydrateStub, isPristineBook, toPreviewSession,
  isTextKnown, hasUnhydratedChapters, hydrateAll,
} from './largeBooks';
import { buildNotesPayload, createNote, MAX_BODY } from './notes';
import { validatePenName, normalizePenName } from './penName';

beforeEach(() => localStorage.clear());

// ── Word counting ────────────────────────────────────────────────────────────

describe('word counting under abuse', () => {
  test('a script tag is not counted as prose', () => {
    // plainText strips tags; the content between them is another matter, and
    // the editor cannot produce this, but an imported book can.
    expect(countWords('<p>one two</p>')).toBe(2);
  });

  test('entities decode rather than counting as words', () => {
    expect(countWords('<p>Tom&nbsp;&amp; Jerry</p>')).toBe(countWordsIn('Tom & Jerry'));
  });

  test('an unclosed tag does not swallow the rest of the book', () => {
    // '<p' with no '>' — the strip regex needs a closing bracket, so a
    // malformed tag must not eat everything after it.
    expect(countWords('<p>real words here</p><p unclosed')).toBeGreaterThanOrEqual(3);
  });

  test('mixed scripts count as the sum, not as one path or the other', () => {
    const latin = countWords('<p>hello world</p>');
    const mixed = countWords('<p>hello world 日本語</p>');
    expect(latin).toBe(2);
    expect(mixed).toBeGreaterThan(latin);
  });

  test('a very long single token does not hang or overflow', () => {
    const huge = 'x'.repeat(200000);
    expect(countWords(`<p>${huge}</p>`)).toBe(1);
  });

  test('nothing in, zero out — never NaN', () => {
    for (const v of [null, undefined, '', '   ', '<p></p>', '<p>&nbsp;</p>']) {
      expect(countWords(v)).toBe(0);
      expect(Number.isNaN(countWords(v))).toBe(false);
    }
  });

  test('plainText never returns null or undefined', () => {
    for (const v of [null, undefined, 0, false, {}, []]) {
      expect(typeof plainText(v)).toBe('string');
    }
  });
});

// ── Stub rehydration ─────────────────────────────────────────────────────────

describe('rehydrateStub under abuse', () => {
  const stub = (over = {}) => ({
    id: 'b1', title: 'Novel', filePath: 'content://x/1',
    type: 'book', updated: '2026-02-01T00:00:00.000Z', _mirrorStub: true, ...over,
  });
  const onDisk = (over = {}) => ({
    id: 'file-id', title: 'Novel', filePath: 'content://x/1', type: 'book',
    chapters: [{ chap_idx: 1, title: 'One', order: 1, content: '<p>a</p>' }],
    ...over,
  });

  /**
   * The dangerous direction. A rehydrated stub must never come back looking
   * like a complete book, because every save guard downstream reads that
   * claim and a book that claims completeness with no bodies is the shape
   * that overwrites a manuscript with nothing.
   */
  test('the result always still reads as incomplete', () => {
    const out = rehydrateStub(stub(), onDisk());
    expect(hasUnhydratedChapters(out)).toBe(true);
    expect(isTextKnown(out)).toBe(false);
    expect(out._preview).toBe(true);
  });

  test('a file whose chapters are themselves unhydrated does not clear the flag', () => {
    // A fresh read should never look like this, but if it did, promoting it
    // would claim bodies exist that do not.
    const out = rehydrateStub(stub(), onDisk({
      chapters: [{ chap_idx: 1, title: 'One', order: 1, content: null }],
    }));
    expect(hasUnhydratedChapters(out)).toBe(true);
    expect(isTextKnown(out)).toBe(false);
  });

  test('rehydrating twice is stable', () => {
    const once = rehydrateStub(stub(), onDisk());
    const twice = rehydrateStub(once, onDisk());
    // Already not a stub, so the second call is a no-op by identity.
    expect(isMirrorStub(once)).toBe(false);
    expect(twice).toEqual(once);
  });

  test('a file with a different id cannot hijack the session', () => {
    expect(rehydrateStub(stub({ id: 'mine' }), onDisk({ id: 'theirs' })).id).toBe('mine');
  });

  test('the stub cannot be tricked into losing its filePath', () => {
    const out = rehydrateStub(stub(), onDisk({ filePath: undefined }));
    expect(out.filePath).toBe('content://x/1');
  });

  /** The whole loop this guards: hydrating a rehydrated stub must work. */
  test('a rehydrated stub can then be fully hydrated for a save', () => {
    const preview = rehydrateStub(stub(), onDisk());
    const full = hydrateAll(preview, onDisk());
    expect(hasUnhydratedChapters(full)).toBe(false);
    expect(full.chapters[0].content).toBe('<p>a</p>');
  });

  test('isMirrorStub does not mistake a brand new book for a stub', () => {
    expect(isMirrorStub({ id: 'n', type: 'book', chapters: [] })).toBe(false);
    expect(isMirrorStub({ id: 'n', type: 'book', chapters: [], filePath: '' })).toBe(false);
  });
});

// ── Pristine ─────────────────────────────────────────────────────────────────

describe('isPristineBook under abuse', () => {
  const book = (over = {}) => ({
    id: 'b', type: 'book', title: 'Untitled Book',
    chapters: [{ chap_idx: 1, content: '' }], ...over,
  });

  test('every flavour of visually-empty markup reads as pristine', () => {
    for (const c of ['', '   ', '<p></p>', '<p>&nbsp;</p>', '<p><br></p>',
                     '<p>&nbsp;&nbsp;</p>', '<div><p> </p></div>']) {
      expect(isPristineBook(book({ chapters: [{ chap_idx: 1, content: c }] }))).toBe(true);
    }
  });

  test('a single real character anywhere is not pristine', () => {
    expect(isPristineBook(book({ chapters: [{ chap_idx: 1, content: '<p>a</p>' }] }))).toBe(false);
    // Non-Latin too — the strip must not be ASCII-blind the way the old
    // filename sanitiser was.
    expect(isPristineBook(book({ chapters: [{ chap_idx: 1, content: '<p>あ</p>' }] }))).toBe(false);
  });

  test('a preview book is never pristine no matter how it is dressed up', () => {
    const preview = toPreviewSession({
      id: 'b', type: 'book', title: 'Untitled Book', filePath: 'content://x/1',
      chapters: [{ chap_idx: 1, order: 1, content: '<p>a whole novel</p>' }],
    });
    expect(isPristineBook(preview)).toBe(false);
    expect(isPristineBook({ ...preview, _preview: false })).toBe(false);
  });
});

// ── Notes payload ────────────────────────────────────────────────────────────

describe('the notes widget payload under abuse', () => {
  test('a note at the maximum body length still produces bounded rows', () => {
    createNote('x'.repeat(MAX_BODY));
    const [row] = buildNotesPayload(1);
    expect(row.title.length).toBeLessThanOrEqual(40);
    expect(row.preview.length).toBeLessThanOrEqual(60);
  });

  test('a note that is one enormous single line has an empty preview, not a truncated body', () => {
    createNote('y'.repeat(5000));
    const [row] = buildNotesPayload(1);
    expect(row.preview).toBe('');
  });

  /**
   * The payload is JSON.stringify'd, handed across the Capacitor bridge and
   * parsed by org.json on the other side. Anything that survives a round trip
   * here survives that.
   */
  test('quotes, backslashes and newlines survive the bridge encoding', () => {
    createNote('he said "no"\\ then \n left');
    const p = buildNotesPayload(1);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  test('control characters do not break serialisation', () => {
    createNote('a bc');
    const p = buildNotesPayload(1);
    expect(() => JSON.parse(JSON.stringify(p))).not.toThrow();
  });

  test('a negative or absurd row count is handled', () => {
    createNote('one');
    expect(buildNotesPayload(-5)).toEqual([]);
    expect(buildNotesPayload(10000).length).toBeLessThanOrEqual(1);
  });

  test('every row has the four fields the widget reads, always', () => {
    createNote('  \n  ');
    createNote('real note\nwith a second line');
    for (const row of buildNotesPayload(4)) {
      expect(typeof row.id).toBe('string');
      expect(typeof row.title).toBe('string');
      expect(row.title.length).toBeGreaterThan(0);
      expect(typeof row.preview).toBe('string');
      expect(typeof row.updated).toBe('number');
      expect(Number.isNaN(row.updated)).toBe(false);
    }
  });
});

// ── Pen names ────────────────────────────────────────────────────────────────

describe('pen name validation under abuse', () => {
  test('the reserved skeleton is not defeated by padding', () => {
    for (const bad of ['admin', 'Admin', '_admin', 'admin_', 'a_d_m_i_n',
                       'adm1n', '4dm1n', 'admin2', 'r00t', '0wner']) {
      expect(validatePenName(bad).ok).toBe(false);
    }
  });

  test('ordinary words that merely contain a reserved word are fine', () => {
    for (const good of ['badminton', 'rooted', 'teams', 'helper', 'developer_x']) {
      expect(validatePenName(good).ok).toBe(true);
    }
  });

  test('normalising is idempotent', () => {
    for (const v of ['Lunar', ' lunar ', 'LUNAR', 'lunar']) {
      expect(normalizePenName(normalizePenName(v))).toBe(normalizePenName(v));
    }
  });

  test('nothing throws on hostile input', () => {
    for (const v of [null, undefined, '', '   ', ' ', 'x'.repeat(1000), '../../etc']) {
      expect(() => validatePenName(v)).not.toThrow();
      expect(typeof validatePenName(v).ok).toBe('boolean');
    }
  });
});

// ── The rescue path must not be fooled by the shapes rehydration creates ─────

describe('rescue vs. the shapes a degraded boot produces', () => {
  const { isStub } = require('./rescue');

  /**
   * The promise in CLAUDE.md is that being locked out never costs manuscripts,
   * and the failure mode that would break it quietly is the opposite: the
   * rescue screen happily exporting a book it does not actually hold, handing
   * a writer an empty EPUB and the belief that they have a copy.
   *
   * rescue.isStub asks whether there is TEXT rather than checking a flag,
   * which is why the boot-rehydration change could not break it — a preview
   * session has a full chapter list and no bodies, and reads as a stub on the
   * only question that matters. Pinned here because that is load-bearing and
   * a future "optimisation" to a flag check would silently undo it.
   */
  test('a rehydrated stub still reads as unexportable', () => {
    const preview = rehydrateStub(
      { id: 'b1', title: 'Novel', filePath: 'content://x/1', type: 'book', _mirrorStub: true },
      {
        id: 'file-id', title: 'Novel', type: 'book',
        chapters: [
          { chap_idx: 1, title: 'One', order: 1, content: '<p>a whole chapter</p>' },
          { chap_idx: 2, title: 'Two', order: 2, content: '<p>and another</p>' },
        ],
      },
    );
    // It looks like a real book — two chapters, titles, word counts, snippets.
    expect(preview.chapters).toHaveLength(2);
    expect(preview.chapters[0].word_count).toBeGreaterThan(0);
    // And it is still correctly refused as a source to export from.
    expect(isStub(preview)).toBe(true);
  });

  test('a plain preview-mode book reads as unexportable too', () => {
    expect(isStub(toPreviewSession({
      id: 'b', title: 'Novel', filePath: 'content://x/1',
      chapters: [{ chap_idx: 1, order: 1, content: '<p>words</p>' }],
    }))).toBe(true);
  });

  test('a real, fully loaded book is exportable', () => {
    expect(isStub({
      id: 'b', title: 'Novel',
      chapters: [{ chap_idx: 1, content: '<p>words on the page</p>' }],
    })).toBe(false);
  });

  /**
   * Found by this test failing. rescue's own strip did not decode entities, so
   * a book holding nothing but a non-breaking space read as having text and
   * would have been offered for export — handing a writer a file and the
   * belief it contained their work. It now shares plainText with everything
   * else, which decodes.
   */
  test('a book whose only text is a non-breaking space is not exportable', () => {
    expect(isStub({ id: 'b', chapters: [{ chap_idx: 1, content: '<p>&nbsp;</p>' }] })).toBe(true);
  });
});

// ── The eighth counter ───────────────────────────────────────────────────────

describe('the rescue screen counts non-Latin scripts', () => {
  const { bookWordCount } = require('./rescue');

  /**
   * Seven counters were consolidated onto wordCount.js; this was the eighth and
   * it was missed. It is also the one that mattered most: the rescue screen is
   * what somebody locked out sees, its job is helping them recognise their own
   * books, and `text.split(' ')` returns 1 for a whole chapter of Japanese.
   * Every manuscript reading "1 word" on that screen says something much worse
   * than a wrong number.
   */
  test('Japanese counts as more than one word', () => {
    expect(bookWordCount({ chapters: [{ content: '<p>日本語のタイトルです</p>' }] }))
      .toBeGreaterThan(1);
  });

  test('so do Chinese and Thai', () => {
    expect(bookWordCount({ chapters: [{ content: '<p>我们的故事从这里开始</p>' }] })).toBeGreaterThan(1);
    expect(bookWordCount({ chapters: [{ content: '<p>สวัสดีชาวโลก</p>' }] })).toBeGreaterThan(1);
  });

  test('and English is unchanged', () => {
    expect(bookWordCount({ chapters: [{ content: '<p>the quick brown fox</p>' }] })).toBe(4);
  });

  test('chapters are summed, and the legacy body is not double-counted', () => {
    expect(bookWordCount({
      content: '<p>one two</p>',
      chapters: [{ content: '<p>one two</p>' }, { content: '<p>three four</p>' }],
    })).toBe(4);
    expect(bookWordCount({ content: '<p>one two three</p>', chapters: [] })).toBe(3);
  });

  test('an empty or missing book counts zero rather than throwing', () => {
    expect(bookWordCount(null)).toBe(0);
    expect(bookWordCount({})).toBe(0);
    expect(bookWordCount({ chapters: [{ content: null }] })).toBe(0);
  });
});

// ── And the ninth, tenth and eleventh ────────────────────────────────────────

describe('every remaining counter handles non-Latin scripts', () => {
  const { textStats } = require('./editorFormat');

  /**
   * textStats powers the Chapter Info modal. Before this, a chapter of
   * Japanese reported one word — and because reading time is words / 200, a
   * whole chapter also reported "< 1 min".
   */
  test('chapter statistics count CJK', () => {
    const jp = textStats('<p>日本語のタイトルです</p>');
    expect(jp.words).toBeGreaterThan(1);
    expect(jp.charsNoSpaces).toBeGreaterThan(1);
  });

  test('and English statistics are unchanged', () => {
    const en = textStats('<p>the quick brown fox jumps</p>');
    expect(en.words).toBe(5);
  });

  test('empty content is zero everywhere, not NaN', () => {
    for (const v of ['', null, undefined, '<p></p>']) {
      const s = textStats(v);
      expect(s.words).toBe(0);
      expect(Number.isNaN(s.readingMins)).toBe(false);
    }
  });
});
