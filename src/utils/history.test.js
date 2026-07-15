/**
 * history.test.js — change-history engine (undo/redo panel, v1.1.18)
 */
import {
  recordEdit, recordOp, restorePatch, describeEntry, wordCountOf,
  SESSION_HISTORY_LIMIT,
} from './history';

const T0 = 1_750_000_000_000;

test('typing bursts coalesce; a pause starts a new entry with a checkpoint', () => {
  let h = [];
  h = recordEdit(h, { chapIdx: 1, chapTitle: 'One', beforeContent: '<p>a</p>', afterContent: '<p>a b</p>' }, T0);
  // First burst: the new entry plus a checkpoint of the pre-burst text.
  expect(h).toHaveLength(2);
  expect(h[0].kind).toBe('edit');
  expect(h[0].content).toBe('<p>a b</p>');
  expect(h[1].kind).toBe('checkpoint');
  expect(h[1].content).toBe('<p>a</p>');

  // 10s later, same chapter — coalesces into the same entry.
  h = recordEdit(h, { chapIdx: 1, chapTitle: 'One', beforeContent: '<p>a b</p>', afterContent: '<p>a b c</p>' }, T0 + 10_000);
  expect(h).toHaveLength(2);
  expect(h[0].content).toBe('<p>a b c</p>');

  // 5 minutes later — new burst. No new checkpoint needed: the previous
  // entry's snapshot already equals the pre-burst state.
  h = recordEdit(h, { chapIdx: 1, chapTitle: 'One', beforeContent: '<p>a b c</p>', afterContent: '<p>a b c d</p>' }, T0 + 300_000);
  expect(h).toHaveLength(3);
  expect(h[0].content).toBe('<p>a b c d</p>');
  expect(h[1].content).toBe('<p>a b c</p>');
});

test('switching chapters starts a separate entry', () => {
  let h = recordEdit([], { chapIdx: 1, chapTitle: 'One', beforeContent: '', afterContent: '<p>x</p>' }, T0);
  h = recordEdit(h, { chapIdx: 2, chapTitle: 'Two', beforeContent: '<p>old</p>', afterContent: '<p>new</p>' }, T0 + 1000);
  expect(h[0].chapIdx).toBe(2);
  expect(h.find((e) => e.chapIdx === 1)).toBeTruthy();
});

test('history is capped at the session limit', () => {
  let h = [];
  for (let i = 0; i < SESSION_HISTORY_LIMIT + 30; i++) {
    h = recordOp(h, { kind: 'move-chapter', chapIdx: 1, chapTitle: 'One', order: i }, T0 + i * 200_000);
  }
  expect(h.length).toBeLessThanOrEqual(SESSION_HISTORY_LIMIT);
  expect(h[0].order).toBe(SESSION_HISTORY_LIMIT + 29); // newest kept
});

test('restorePatch puts a chapter back into a captured state and records the restore', () => {
  const session = {
    title: 'Book',
    chapters: [
      { chap_idx: 1, title: 'One', order: 1, content: '<p>current</p>' },
      { chap_idx: 2, title: 'Two', order: 2, content: '<p>two</p>' },
    ],
    history: [
      { id: 'e1', ts: T0, kind: 'edit', chapIdx: 1, chapTitle: 'One', content: '<p>current</p>', words: 1 },
      { id: 'c1', ts: T0 - 1, kind: 'checkpoint', chapIdx: 1, chapTitle: 'One', content: '<p>older draft</p>', words: 2 },
    ],
  };
  const res = restorePatch(session, 'c1', (html) => html.slice(0, 10), T0 + 5000);
  expect(res).toBeTruthy();
  expect(res.patch.chapters.find((c) => c.chap_idx === 1).content).toBe('<p>older draft</p>');
  // First-chapter mirror follows.
  expect(res.patch.content).toBe('<p>older draft</p>');
  expect(res.patch.history[0].kind).toBe('restore');

  // Restoring the state we're already in is a no-op.
  expect(restorePatch(session, 'e1', null, T0 + 5000)).toBeNull();
});

test('restoring a delete-chapter entry brings the chapter back', () => {
  const session = {
    title: 'Book',
    chapters: [{ chap_idx: 1, title: 'One', order: 1, content: '<p>one</p>' }],
    history: [
      { id: 'd1', ts: T0, kind: 'delete-chapter', chapIdx: 3, chapTitle: 'Lost', content: '<p>lost text</p>', order: 2, synopsis: 'was deleted' },
    ],
  };
  const res = restorePatch(session, 'd1', null, T0 + 1000);
  const back = res.patch.chapters.find((c) => c.chap_idx === 3);
  expect(back).toBeTruthy();
  expect(back.content).toBe('<p>lost text</p>');
  expect(back.title).toBe('Lost');
  expect(back.synopsis).toBe('was deleted');
  expect(res.label).toContain('Brought back');
});

test('restoring an add-chapter entry never blanks a chapter that has text', () => {
  const session = {
    title: 'Book',
    chapters: [{ chap_idx: 2, title: 'Two', order: 2, content: '<p>written since</p>' }],
    history: [{ id: 'a1', ts: T0, kind: 'add-chapter', chapIdx: 2, chapTitle: 'Two', content: '' }],
  };
  expect(restorePatch(session, 'a1', null, T0 + 1000)).toBeNull();
});

test('a deleted chapter whose chap_idx was reused comes back under a fresh idx', () => {
  // Chapter 3 was deleted, then a NEW chapter took chap_idx 3.
  const session = {
    title: 'Book',
    chapters: [
      { chap_idx: 1, title: 'One', order: 1, content: '<p>one</p>' },
      { chap_idx: 3, title: 'Newcomer', order: 2, content: '<p>new text</p>' },
    ],
    history: [
      { id: 'd1', ts: T0, kind: 'delete-chapter', chapIdx: 3, chapTitle: 'Old Three', content: '<p>old text</p>', order: 3 },
    ],
  };
  const res = restorePatch(session, 'd1', null, T0 + 1000);
  // The newcomer is untouched…
  expect(res.patch.chapters.find((c) => c.chap_idx === 3).content).toBe('<p>new text</p>');
  // …and the old chapter is back under a fresh index.
  const revived = res.patch.chapters.find((c) => c.title === 'Old Three');
  expect(revived).toBeTruthy();
  expect(revived.chap_idx).toBe(4);
  expect(revived.content).toBe('<p>old text</p>');
});

test('describeEntry produces readable labels and word deltas', () => {
  expect(describeEntry({ kind: 'edit', chapTitle: 'One', words: 120, prevWords: 100 }))
    .toEqual({ title: 'Edited One', detail: '+20 words' });
  expect(describeEntry({ kind: 'edit', chapTitle: 'One', words: 90, prevWords: 100 }).detail).toBe('-10 words');
  expect(describeEntry({ kind: 'delete-chapter', chapTitle: 'Two' }).title).toBe('Deleted Two');
});

test('wordCountOf strips markup and entities', () => {
  expect(wordCountOf('<p>Hello <b>brave</b>&nbsp;world</p>')).toBe(3);
  expect(wordCountOf('')).toBe(0);
});
