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

/**
 * syncWidget's one job is to reach the native plugin. It stopped doing that
 * silently — see the comment on getPlugin — because Capacitor's plugin object
 * is a Proxy that answers `then` with a callable, so returning it from an
 * `async` function fed it to the runtime's thenable-unwrapping, which never
 * settled. No error reached the caller; the widgets simply stopped updating.
 *
 * The mock below is the part of Capacitor that matters: a proxy that responds
 * to every property with a plugin-method wrapper, `then` included.
 */
describe('syncWidget reaches the plugin', () => {
  const calls = [];

  const capacitorLikeProxy = (impl) => new Proxy({}, {
    get(_t, prop) {
      if (prop === '$$typeof' || prop === 'toJSON') return undefined;
      return (...args) => {
        if (typeof impl[prop] === 'function') return impl[prop](...args);
        // Capacitor's behaviour for an unknown method: a rejected promise,
        // which is what makes `then` so dangerous.
        return Promise.reject(new Error(`"WidgetData.${String(prop)}()" is not implemented`));
      };
    },
  });

  beforeEach(() => {
    calls.length = 0;
    jest.resetModules();
    jest.doMock('@capacitor/core', () => ({
      registerPlugin: () => capacitorLikeProxy({
        syncBooks: (payload) => { calls.push(payload); return Promise.resolve(); },
      }),
    }), { virtual: true });
  });

  afterEach(() => { jest.dounmock?.('@capacitor/core'); });

  const sessions = [{ id: 'b1', title: 'The Long Novel', chapters: [chap(1)], streak: { goalWords: 300 } }];

  test('syncBooks is actually called, and within a tick or two', async () => {
    const { syncWidget } = require('./widgetBridge');
    // A timeout, because the failure mode is a hang rather than a throw: the
    // await never settles and the test would otherwise sit here until Jest
    // gives up with an unrelated message.
    await Promise.race([
      syncWidget(sessions, '#5a00d9', null),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('syncWidget never settled')), 2000)),
    ]);
    expect(calls).toHaveLength(1);
  });

  test('it sends the books, the accent and the resume slot', async () => {
    const { syncWidget } = require('./widgetBridge');
    await syncWidget(sessions, '#ff8800', null);
    expect(calls).toHaveLength(1);
    const p = calls[0];
    expect(p.accentHex).toBe('#ff8800');
    expect(JSON.parse(p.booksJson)).toEqual([
      { id: 'b1', title: 'The Long Novel', streak: { goalWords: 300 } },
    ]);
    expect(typeof p.resumeJson).toBe('string');
    expect(typeof p.themeJson).toBe('string');
  });

  test('it sends the notes rows and the real total, not the row count', async () => {
    // The two are different on purpose. buildNotesPayload trims to what a
    // widget can show, so a native side that counted the array would tell a
    // writer with six notes that they have four.
    const { createNote } = require('./notes');
    for (let i = 0; i < 6; i++) createNote(`note ${i}`);

    const { syncWidget } = require('./widgetBridge');
    await syncWidget(sessions, '#5a00d9', null);
    const p = calls[0];
    expect(JSON.parse(p.notesJson)).toHaveLength(4);
    expect(p.notesTotal).toBe(6);
    localStorage.clear();
  });

  test('an empty notes store still sends a payload the widget can parse', async () => {
    localStorage.clear();
    const { syncWidget } = require('./widgetBridge');
    await syncWidget(sessions, '#5a00d9', null);
    // Not undefined and not '': the provider does JSON.parse on this, and the
    // widget's empty state is an empty array rather than an absent field.
    expect(JSON.parse(calls[0].notesJson)).toEqual([]);
    expect(calls[0].notesTotal).toBe(0);
  });

  /**
   * The countdown widget cannot work out its own deadline: the rule depends on
   * when the writer last wrote, which lives in localStorage on this side of
   * the bridge. These two tests are the wiring — streakWindow can be perfectly
   * correct and the widget still end every night at midnight if the timestamp
   * never makes the trip.
   */
  test('the countdown deadline crosses with it', async () => {
    localStorage.clear();
    const { syncWidget } = require('./widgetBridge');
    await syncWidget(sessions, '#5a00d9', null);
    const cd = JSON.parse(calls[0].countdownJson);
    expect(typeof cd.deadline).toBe('number');
    expect(cd.deadline).toBeGreaterThan(Date.now());
    expect(cd.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('a write minutes ago is what pushes the deadline past midnight', async () => {
    localStorage.clear();
    const { saveResumePoint } = require('./resumeState');
    saveResumePoint('b1', { chapIdx: 1 });

    const { syncWidget } = require('./widgetBridge');
    await syncWidget(sessions, '#5a00d9', null);
    const cd = JSON.parse(calls[0].countdownJson);

    // Only the small hours can be inside an extension, so assert the rule
    // rather than a clock this test does not control: `extended` is non-zero
    // exactly when the deadline has been moved off midnight.
    const end = new Date(cd.deadline);
    expect(cd.extended).toBe(end.getHours() === 0 ? 0 : end.getHours());
    // An unextended day is never "in an extension", whatever the hour.
    expect(cd.inExtension && cd.extended === 0).toBe(false);
  });

  test('a plugin that is not there is not an error', async () => {
    jest.resetModules();
    jest.doMock('@capacitor/core', () => { throw new Error('no capacitor here'); }, { virtual: true });
    const { syncWidget } = require('./widgetBridge');
    await expect(syncWidget(sessions, '#5a00d9', null)).resolves.toBeUndefined();
  });
});
