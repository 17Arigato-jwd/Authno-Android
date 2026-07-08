/**
 * threads.test.js — engine tests for the Threads feature (docs/threads-spec.md)
 */
import {
  emptyThreadsData, getThreadsData, getAllTypes, typeById,
  addType, addThread, addEntry, updateEntry,
  addRelation, relationsOf, sortedEntries, todoCount, allOpenTodos,
  locateAnchors, exportOutlineMarkdown,
} from './threads';

const chapter = (idx, order, content) => ({ chap_idx: idx, order, title: `Chapter ${idx}`, content });

test('builtin types are present and user types extend them', () => {
  let data = emptyThreadsData();
  expect(getAllTypes(data).map(t => t.id)).toEqual(['plotline', 'character-arc']);

  const res = addType(data, { name: 'Theme', icon: 'Star', color: '#a855f7', fields: [{ key: 'motif', label: 'Motif' }] });
  data = res.data;
  const types = getAllTypes(data);
  expect(types).toHaveLength(3);
  expect(typeById(data, res.type.id).fields[0].key).toBe('motif');
  // Unknown type ids degrade gracefully instead of crashing.
  expect(typeById(data, 'nope').name).toBe('nope');
});

test('entries sort by manuscript position with unanchored TODOs pinned on top', () => {
  let data = emptyThreadsData();
  const t = addThread(data, { typeId: 'plotline', name: 'Heist' });
  data = t.data;
  const th = t.thread;

  data = addEntry(data, th.id, { text: 'late beat',  anchorIds: ['a_late']  }).data;
  data = addEntry(data, th.id, { text: 'reminder',   todo: true            }).data;
  data = addEntry(data, th.id, { text: 'early beat', anchorIds: ['a_early'] }).data;
  data = addEntry(data, th.id, { text: 'loose note'                        }).data;

  const session = {
    chapters: [
      chapter(1, 1, 'aa <span data-authno-anchor="a_early">x</span> bb'),
      chapter(2, 2, 'cc <span data-authno-pin="a_late">​</span> dd'),
    ],
  };
  const sorted = sortedEntries(getThreadsData({ threads: data }).threads[0], locateAnchors(session));
  expect(sorted.map(e => e.text)).toEqual(['reminder', 'early beat', 'late beat', 'loose note']);
});

test('todo counting, completion, and the global roll-up', () => {
  let data = emptyThreadsData();
  const t = addThread(data, { typeId: 'character-arc', name: 'Mara', meta: { character: 'Mara' } });
  data = t.data;
  data = addEntry(data, t.thread.id, { text: 'add her flaw', todo: true }).data;
  const entryId = data.threads[0].entries[0].id;

  expect(todoCount(data.threads[0])).toBe(1);
  expect(allOpenTodos(data)).toHaveLength(1);

  data = updateEntry(data, t.thread.id, entryId, { done: true });
  expect(todoCount(data.threads[0])).toBe(0);
  expect(allOpenTodos(data)).toHaveLength(0);
});

test('relations are symmetric, deduped, and never self-linking', () => {
  let data = emptyThreadsData();
  const a = addThread(data, { typeId: 'plotline', name: 'A' }); data = a.data;
  const b = addThread(data, { typeId: 'plotline', name: 'B' }); data = b.data;

  data = addRelation(data, a.thread.id, b.thread.id).data;
  data = addRelation(data, b.thread.id, a.thread.id).data;  // duplicate, reversed
  data = addRelation(data, a.thread.id, a.thread.id).data;  // self — ignored
  expect(data.relations).toHaveLength(1);
  expect(relationsOf(data, a.thread.id)[0].otherId).toBe(b.thread.id);
  expect(relationsOf(data, b.thread.id)[0].otherId).toBe(a.thread.id);
});

test('markdown outline lists threads, TODO checkboxes and chapter locations', () => {
  let data = emptyThreadsData();
  const t = addThread(data, { typeId: 'plotline', name: 'The Heist' });
  data = t.data;
  data = addEntry(data, t.thread.id, { text: 'crew assembles', anchorIds: ['a1'] }).data;
  data = addEntry(data, t.thread.id, { text: 'plant the twist', todo: true }).data;

  const session = { title: 'My Book', chapters: [chapter(1, 1, 'x <span data-authno-anchor="a1">y</span> z')] };
  const md = exportOutlineMarkdown(session, data);
  expect(md).toContain('# My Book — Threads outline');
  expect(md).toContain('### The Heist');
  expect(md).toContain('- crew assembles _(Chapter 1)_');
  expect(md).toContain('- [ ] plant the twist');
});
