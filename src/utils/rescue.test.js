/**
 * rescue.test.js — the escape hatch has to work on the worst day, so its
 * failure modes are the interesting cases: no store, corrupt store, a store
 * degraded to stubs. None of them may throw, because a throw here is a writer
 * who can't get their book out.
 */

import { readLocalLibrary, bookWordCount, isStub, RESCUE_FORMATS, exportBookAs } from './rescue';

const KEY = 'offlineWriterSessions';

const chapter = (title, content, order = 1) => ({ chap_idx: order, title, order, content });
const book = (over = {}) => ({
  id: 'b1', title: 'A Book', type: 'book', updated: '2026-01-01T00:00:00.000Z',
  chapters: [chapter('One', '<p>alpha beta gamma</p>')],
  ...over,
});

beforeEach(() => localStorage.clear());

describe('readLocalLibrary', () => {
  it('returns an empty library when nothing is stored', () => {
    expect(readLocalLibrary()).toEqual([]);
  });

  it('returns an empty library rather than throwing on a corrupt store', () => {
    localStorage.setItem(KEY, '{not json at all');
    expect(readLocalLibrary()).toEqual([]);
  });

  it('returns an empty library when the store holds a non-array', () => {
    localStorage.setItem(KEY, '{"nope":true}');
    expect(readLocalLibrary()).toEqual([]);
  });

  it('reads books out of the mirror', () => {
    localStorage.setItem(KEY, JSON.stringify([book()]));
    const lib = readLocalLibrary();
    expect(lib).toHaveLength(1);
    expect(lib[0].title).toBe('A Book');
  });

  it('drops the onboarding demo book', () => {
    localStorage.setItem(KEY, JSON.stringify([book(), book({ id: 'd', _demo: true })]));
    expect(readLocalLibrary().map((b) => b.id)).toEqual(['b1']);
  });

  it('skips null and non-object entries instead of choking on them', () => {
    localStorage.setItem(KEY, JSON.stringify([null, 'nope', 7, book()]));
    expect(readLocalLibrary()).toHaveLength(1);
  });

  it('sorts newest first', () => {
    localStorage.setItem(KEY, JSON.stringify([
      book({ id: 'old', updated: '2025-01-01T00:00:00.000Z' }),
      book({ id: 'new', updated: '2026-06-01T00:00:00.000Z' }),
    ]));
    expect(readLocalLibrary().map((b) => b.id)).toEqual(['new', 'old']);
  });

  it('gives every entry a title and a chapters array', () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'x' }]));
    const [b] = readLocalLibrary();
    expect(b.title).toBe('Untitled');
    expect(Array.isArray(b.chapters)).toBe(true);
  });

  it('never writes to the store it reads', () => {
    const raw = JSON.stringify([book()]);
    localStorage.setItem(KEY, raw);
    readLocalLibrary();
    expect(localStorage.getItem(KEY)).toBe(raw);
  });
});

describe('bookWordCount', () => {
  it('counts words across chapters, ignoring markup', () => {
    expect(bookWordCount(book())).toBe(3);
  });

  it('adds up multiple chapters', () => {
    expect(bookWordCount(book({
      chapters: [chapter('One', '<p>one two</p>', 1), chapter('Two', '<b>three</b> four', 2)],
    }))).toBe(4);
  });

  it('counts a legacy top-level body', () => {
    expect(bookWordCount({ content: '<p>just these words</p>', chapters: [] })).toBe(3);
  });

  it('is zero for an empty book', () => {
    expect(bookWordCount(book({ chapters: [chapter('One', '')] }))).toBe(0);
  });

  it('does not throw on a missing session', () => {
    expect(bookWordCount(undefined)).toBe(0);
  });
});

describe('isStub', () => {
  it('is false for a book with text', () => {
    expect(isStub(book())).toBe(false);
  });

  it('is true for the quota-degraded mirror entry', () => {
    // What App.js writes when localStorage refuses the full mirror.
    expect(isStub({ id: 'b1', title: 'A Book', filePath: '/x.authbook', type: 'book', updated: '' })).toBe(true);
  });

  it('is true for a book whose chapters are all empty', () => {
    expect(isStub(book({ chapters: [chapter('One', '<p></p>'), chapter('Two', '   ')] }))).toBe(true);
  });

  it('is false when only a legacy top-level body carries the text', () => {
    expect(isStub({ id: 'b', chapters: [], content: '<p>words here</p>' })).toBe(false);
  });

  it('treats markup-only content as empty', () => {
    expect(isStub(book({ chapters: [chapter('One', '<p><br></p>')] }))).toBe(true);
  });
});

describe('exportBookAs', () => {
  it('rejects a format the app cannot write', async () => {
    await expect(exportBookAs(book(), 'docx')).rejects.toThrow('unknown-format');
  });

  it('offers only formats storage.js actually implements', async () => {
    const storage = await import('./storage');
    const NAMES = { txt: 'exportAsTxt', html: 'exportAsHtml', epub: 'exportAsEpub', pdf: 'exportAsPdf' };
    for (const f of RESCUE_FORMATS) {
      expect(typeof storage[NAMES[f.id]]).toBe('function');
    }
  });
});
