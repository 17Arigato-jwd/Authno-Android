/**
 * history.test.js — change-history engine v2 (paragraph-level diffs, 1.1.18-beta.1)
 */
import {
  recordEdit, recordOp, restorePatch, revertChangePatch, canRevertEntry,
  describeEntry, wordCountOf, splitBlocks, diffBlocks,
  visibleHistory, persistableHistory, SESSION_HISTORY_LIMIT,
} from './history';

const T0 = 1_750_000_000_000;
const P = (...lines) => lines.map((l) => `<p>${l}</p>`).join('');

test('splitBlocks splits top-level paragraphs and headings', () => {
  const blocks = splitBlocks('<p>one two</p><h2>Head</h2><p>three</p>');
  expect(blocks.map((b) => b.text)).toEqual(['one two', 'Head', 'three']);
});

test('diffBlocks reports changed, added and removed paragraphs', () => {
  const before = P('alpha beta gamma', 'delta epsilon', 'zeta');
  const after = P('alpha beta gamma', 'delta epsilon REWRITTEN HERE', 'zeta', 'brand new paragraph');
  const ops = diffBlocks(before, after);
  expect(ops).toHaveLength(2);
  expect(ops[0].type).toBe('changed');
  expect(ops[0].before.text).toBe('delta epsilon');
  expect(ops[0].after.text).toContain('REWRITTEN');
  expect(ops[1].type).toBe('added');
  expect(ops[1].after.text).toBe('brand new paragraph');
});

test('small edits stay provisional (hidden) until they cross ~10 words', () => {
  const base = P('The night was calm and quiet across the harbour.');
  // 3 words added — below the bar.
  let h = recordEdit([], {
    chapIdx: 1, chapTitle: 'One',
    beforeContent: base,
    afterContent: P('The night was calm and quiet across the harbour town of Vayle.'),
  }, T0);
  expect(h).toHaveLength(1);
  expect(h[0].provisional).toBe(true);
  expect(visibleHistory(h)).toHaveLength(0);

  // Keep typing in the same flush cadence — now 12+ new words vs baseline.
  h = recordEdit(h, {
    chapIdx: 1, chapTitle: 'One',
    beforeContent: P('The night was calm and quiet across the harbour town of Vayle.'),
    afterContent: P('The night was calm and quiet across the harbour town of Vayle where the lanterns burned low and the fishermen slept.'),
  }, T0 + 400);
  expect(visibleHistory(h)).toHaveLength(1);
  expect(h[0].provisional).toBeUndefined();
  expect(h[0].blocks[0].type).toBe('changed');
});

test('a deleted paragraph earns an entry immediately (structural)', () => {
  const before = P('keep me', 'this whole line gets deleted', 'keep me too');
  const after = P('keep me', 'keep me too');
  const h = recordEdit([], { chapIdx: 1, chapTitle: 'One', beforeContent: before, afterContent: after }, T0);
  expect(visibleHistory(h)).toHaveLength(1);
  expect(h[0].blocks[0].type).toBe('removed');
  expect(describeEntry(h[0]).title).toMatch(/^Deleted a (line|paragraph)/);
});

test('moving to a different paragraph starts a new entry; same paragraph merges', () => {
  const p1a = 'First paragraph starts here with several words already in place.';
  const p1b = 'First paragraph starts here with several words already in place plus a good deal of newly written material appended now.';
  const p2a = 'Second paragraph sits quietly untouched for the moment.';
  const p2b = 'Second paragraph now gets completely rewritten with many brand new words of its own to cross the bar.';

  // Burst 1: edit paragraph 1.
  let h = recordEdit([], { chapIdx: 1, chapTitle: 'One', beforeContent: P(p1a, p2a), afterContent: P(p1b, p2a) }, T0);
  expect(visibleHistory(h)).toHaveLength(1);

  // Merge: more edits to paragraph 1 shortly after → still one entry.
  const p1c = p1b + ' And even more words continue the same paragraph.';
  h = recordEdit(h, { chapIdx: 1, chapTitle: 'One', beforeContent: P(p1b, p2a), afterContent: P(p1c, p2a) }, T0 + 500);
  expect(visibleHistory(h)).toHaveLength(1);

  // Now rewrite paragraph 2 (still within the time window) → NEW entry.
  h = recordEdit(h, { chapIdx: 1, chapTitle: 'One', beforeContent: P(p1c, p2a), afterContent: P(p1c, p2b) }, T0 + 1000);
  expect(visibleHistory(h)).toHaveLength(2);
  expect(h[0].blocks[0].before.text).toBe(p2a);
});

test('revertChangePatch surgically undoes one change, keeping later edits elsewhere', () => {
  const p1 = 'Opening paragraph that stays the same throughout all of this.';
  const p2before = 'The middle paragraph in its original quiet form here.';
  const p2after = 'The middle paragraph rewritten into something much louder and longer with many extra words attached.';
  const p3 = 'A closing paragraph added afterwards which must survive the revert.';

  let h = recordEdit([], { chapIdx: 1, chapTitle: 'One', beforeContent: P(p1, p2before), afterContent: P(p1, p2after) }, T0);
  const entryId = h[0].id;

  // Later (new burst), a third paragraph is appended.
  h = recordEdit(h, { chapIdx: 1, chapTitle: 'One', beforeContent: P(p1, p2after), afterContent: P(p1, p2after, p3) }, T0 + 200_000);
  const session = { title: 'B', chapters: [{ chap_idx: 1, title: 'One', order: 1, content: P(p1, p2after, p3) }], history: h };

  expect(canRevertEntry(session, h.find((e) => e.id === entryId))).toBe(true);
  const res = revertChangePatch(session, entryId, null, T0 + 300_000);
  expect(res).toBeTruthy();
  const content = res.patch.chapters[0].content;
  expect(content).toContain(p2before);       // the change is undone…
  expect(content).not.toContain('louder');
  expect(content).toContain(p3);             // …but the later paragraph survives
  expect(res.patch.history[0].kind).toBe('restore');
});

test('revert is refused when the paragraph has changed beyond recognition', () => {
  const entry = {
    id: 'e1', ts: T0, kind: 'edit', chapIdx: 1, chapTitle: 'One',
    content: '<p>x</p>',
    blocks: [{ type: 'changed', before: { html: '<p>old</p>', text: 'old' }, after: { html: '<p>mid</p>', text: 'mid' }, aIndex: 0, bIndex: 0, words: 1 }],
  };
  const session = { title: 'B', chapters: [{ chap_idx: 1, title: 'One', order: 1, content: '<p>totally different now</p>' }], history: [entry] };
  expect(canRevertEntry(session, entry)).toBe(false);
  expect(revertChangePatch(session, 'e1', null, T0 + 1)).toBeNull();
});

test('restorePatch still jumps a chapter back to a captured state', () => {
  const session = {
    title: 'Book',
    chapters: [{ chap_idx: 1, title: 'One', order: 1, content: '<p>current</p>' }],
    history: [
      { id: 'e1', ts: T0, kind: 'edit', chapIdx: 1, chapTitle: 'One', content: '<p>older draft</p>', words: 2 },
    ],
  };
  const res = restorePatch(session, 'e1', (html) => html.slice(0, 10), T0 + 5000);
  expect(res.patch.chapters[0].content).toBe('<p>older draft</p>');
  expect(res.patch.history[0].kind).toBe('restore');
});

test('restoring a delete-chapter entry brings the chapter back (fresh idx when reused)', () => {
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
  expect(res.patch.chapters.find((c) => c.chap_idx === 3).content).toBe('<p>new text</p>');
  const revived = res.patch.chapters.find((c) => c.title === 'Old Three');
  expect(revived.chap_idx).toBe(4);
  expect(revived.content).toBe('<p>old text</p>');
});

test('restoring an add-chapter entry never blanks a chapter that has text', () => {
  const session = {
    title: 'Book',
    chapters: [{ chap_idx: 2, title: 'Two', order: 2, content: '<p>written since</p>' }],
    history: [{ id: 'a1', ts: T0, kind: 'add-chapter', chapIdx: 2, chapTitle: 'Two', content: '' }],
  };
  expect(restorePatch(session, 'a1', null, T0 + 1000)).toBeNull();
});

test('persistableHistory strips baselines and provisional entries', () => {
  const h = [
    { id: 'p1', ts: T0, kind: 'edit', chapIdx: 1, content: '<p>a</p>', baseline: '<p></p>', provisional: true, blocks: [] },
    { id: 'f1', ts: T0 - 1, kind: 'edit', chapIdx: 1, content: '<p>b</p>', baseline: '<p>a</p>', blocks: [] },
  ];
  const out = persistableHistory(h);
  expect(out).toHaveLength(1);
  expect(out[0].id).toBe('f1');
  expect(out[0].baseline).toBeUndefined();
});

test('history is capped at the session limit', () => {
  let h = [];
  for (let i = 0; i < SESSION_HISTORY_LIMIT + 30; i++) {
    h = recordOp(h, { kind: 'move-chapter', chapIdx: 1, chapTitle: 'One', order: i }, T0 + i * 200_000);
  }
  expect(h.length).toBeLessThanOrEqual(SESSION_HISTORY_LIMIT);
  expect(h[0].order).toBe(SESSION_HISTORY_LIMIT + 29);
});

test('describeEntry summarises paragraph-level ops', () => {
  const added = { kind: 'edit', chapTitle: 'One', words: 30, prevWords: 10, blocks: [{ type: 'added', after: { html: '', text: 'twenty words or so of new prose in a fresh paragraph appended at the end of the chapter now' }, words: 20 }] };
  expect(describeEntry(added).title).toBe('Added a paragraph in One');
  const del = { kind: 'edit', chapTitle: 'One', words: 5, prevWords: 10, blocks: [{ type: 'removed', before: { html: '', text: 'short line here' }, words: 3 }] };
  expect(describeEntry(del).title).toBe('Deleted a line in One');
  // Old beta.0 entries (no blocks) still describe sensibly.
  expect(describeEntry({ kind: 'edit', chapTitle: 'One', words: 120, prevWords: 100 }))
    .toEqual({ title: 'Edited One', detail: '+20 words' });
});

test('wordCountOf strips markup and entities', () => {
  expect(wordCountOf('<p>Hello <b>brave</b>&nbsp;world</p>')).toBe(3);
  expect(wordCountOf('')).toBe(0);
});
