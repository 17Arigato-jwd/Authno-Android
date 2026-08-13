/**
 * resumeState — where the user stopped writing.
 *
 * It was untested, and the gap hid a real one: `clearResume` had no callers
 * anywhere in the app. Deleting a book left its point behind, and if it was
 * the book you were last in, `lastBookId` went on naming an id nothing could
 * resolve — so the resume widget showed its empty state, the home Continue
 * card vanished and the 'resume' startup mode degraded, with your other books
 * sitting right there.
 */

import {
  saveResumePoint, getResumePoint, getLastResume,
  clearResume, pruneResume,
} from './resumeState';

beforeEach(() => localStorage.clear());

describe('recording a point', () => {
  test('round-trips what was saved, plus a timestamp', () => {
    saveResumePoint('b1', { chapIdx: 3, caret: 120, scroll: 40 });
    const p = getResumePoint('b1');
    expect(p).toMatchObject({ chapIdx: 3, caret: 120, scroll: 40 });
    expect(typeof p.ts).toBe('number');
  });

  test('the newest write becomes the last book', () => {
    saveResumePoint('b1', { chapIdx: 1 });
    saveResumePoint('b2', { chapIdx: 2 });
    expect(getLastResume()).toMatchObject({ bookId: 'b2', chapIdx: 2 });
  });

  test('a book with no id is ignored rather than stored under undefined', () => {
    saveResumePoint(null, { chapIdx: 1 });
    saveResumePoint('', { chapIdx: 1 });
    expect(getLastResume()).toBeNull();
  });

  test('an unknown book has no point, and that is not an error', () => {
    expect(getResumePoint('nope')).toBeNull();
    expect(getLastResume()).toBeNull();
  });

  test('a corrupt store reads as empty rather than throwing', () => {
    localStorage.setItem('authno_resume_v1', 'not json');
    expect(getLastResume()).toBeNull();
    expect(() => saveResumePoint('b1', { chapIdx: 1 })).not.toThrow();
  });
});

describe('clearing one book', () => {
  test('drops its point', () => {
    saveResumePoint('b1', { chapIdx: 1 });
    clearResume('b1');
    expect(getResumePoint('b1')).toBeNull();
  });

  /**
   * The behaviour the missing call cost. Losing the book you were last in
   * should send you to the one before it, not to an empty card.
   */
  test('falls back to the next most recent book, not to nothing', () => {
    saveResumePoint('older', { chapIdx: 1 });
    saveResumePoint('newer', { chapIdx: 2 });
    clearResume('newer');
    expect(getLastResume()).toMatchObject({ bookId: 'older' });
  });

  test('with nothing left, there is honestly nothing to resume', () => {
    saveResumePoint('only', { chapIdx: 1 });
    clearResume('only');
    expect(getLastResume()).toBeNull();
  });

  test('clearing a book that was not the last one leaves the last one alone', () => {
    saveResumePoint('other', { chapIdx: 1 });
    saveResumePoint('current', { chapIdx: 2 });
    clearResume('other');
    expect(getLastResume()).toMatchObject({ bookId: 'current' });
  });
});

describe('pruning against the surviving library', () => {
  test('drops points for books that are gone', () => {
    saveResumePoint('kept', { chapIdx: 1 });
    saveResumePoint('gone', { chapIdx: 2 });
    expect(pruneResume(['kept'])).toBe(1);
    expect(getResumePoint('gone')).toBeNull();
    expect(getResumePoint('kept')).not.toBeNull();
  });

  test('re-points the last book when it was one of the deleted', () => {
    saveResumePoint('kept', { chapIdx: 1 });
    saveResumePoint('gone', { chapIdx: 2 });
    pruneResume(['kept']);
    expect(getLastResume()).toMatchObject({ bookId: 'kept' });
  });

  test('leaves a healthy store completely alone', () => {
    saveResumePoint('a', { chapIdx: 1 });
    saveResumePoint('b', { chapIdx: 2 });
    const before = localStorage.getItem('authno_resume_v1');
    expect(pruneResume(['a', 'b'])).toBe(0);
    expect(localStorage.getItem('authno_resume_v1')).toBe(before);
  });

  /**
   * The dangerous input. An empty library at boot is far more likely to mean
   * "sessions have not loaded yet" than "the writer deleted everything", and
   * wiping resume state on a slow start is not something the writer can undo.
   */
  test('an empty library is treated as not-loaded, not as everything-deleted', () => {
    saveResumePoint('b1', { chapIdx: 1 });
    expect(pruneResume([])).toBe(0);
    expect(pruneResume(null)).toBe(0);
    expect(pruneResume(undefined)).toBe(0);
    expect(getLastResume()).toMatchObject({ bookId: 'b1' });
  });

  test('a Set works as well as an array — it takes any iterable', () => {
    saveResumePoint('kept', { chapIdx: 1 });
    saveResumePoint('gone', { chapIdx: 2 });
    expect(pruneResume(new Set(['kept']))).toBe(1);
    expect(getResumePoint('gone')).toBeNull();
  });

  test('pruning an empty store is a no-op', () => {
    expect(pruneResume(['a'])).toBe(0);
    expect(getLastResume()).toBeNull();
  });

  test('is idempotent', () => {
    saveResumePoint('kept', { chapIdx: 1 });
    saveResumePoint('gone', { chapIdx: 2 });
    expect(pruneResume(['kept'])).toBe(1);
    expect(pruneResume(['kept'])).toBe(0);
    expect(getLastResume()).toMatchObject({ bookId: 'kept' });
  });

  test('a lastBookId with no point of its own is still cleaned up', () => {
    // Reachable if a write was interrupted between the two localStorage keys.
    localStorage.setItem('authno_resume_v1', JSON.stringify({ lastBookId: 'ghost', points: {} }));
    pruneResume(['real']);
    expect(getLastResume()).toBeNull();
  });
});
