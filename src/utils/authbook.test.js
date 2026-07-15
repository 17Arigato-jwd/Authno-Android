/**
 * authbook.test.js — end-to-end persistence tests for the .authbook format.
 *
 * Verifies the full save→load path the app actually uses:
 *   session → sessionToBook → packSession (bytes) → unpackSession → bookToSession
 * covering the newer fields (chapter synopsis, threads, cover, extended
 * metadata) and single-byte corruption recovery via the RS parity.
 */
import {
  packSession, unpackSession, sessionToBook, bookToSession,
} from './authbook';

// A representative "real" session: multi-chapter, synopses on some chapters,
// threads, streak history, notes, cover and full metadata.
function makeSession() {
  return {
    id: 'test-book-1',
    title: 'The Iron Manuscript',
    type: 'book',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-07-01T00:00:00.000Z',
    description: 'A story about stories.',
    genre: 'Fantasy',
    language: 'en',
    publisher: 'VCHS Studios',
    isbn: '978-3-16-148410-0',
    content: '<p>It was a dark and stormy night.</p>',
    coverBase64: btoa('fake-jpeg-bytes-for-testing'),
    coverMime: 'image/jpeg',
    chapters: [
      {
        chap_idx: 1, order: 1, title: 'Discovery',
        content: '<p>It was a dark and stormy night.</p>',
        created: '2026-01-01T00:00:00.000Z', updated: '2026-07-01T00:00:00.000Z',
        synopsis: 'Mira finds the manuscript in the attic.',
      },
      {
        chap_idx: 2, order: 2, title: 'The Price',
        content: `<p>${'Words cost more than gold. '.repeat(2000)}</p>`,
        created: '2026-02-01T00:00:00.000Z', updated: '2026-06-01T00:00:00.000Z',
        synopsis: 'Every written word ages the writer by a minute.',
      },
      {
        chap_idx: 3, order: 3, title: 'No Synopsis Here',
        content: '<p>Chapter without a synopsis.</p>',
        created: '2026-03-01T00:00:00.000Z', updated: '2026-05-01T00:00:00.000Z',
      },
    ],
    streak: {
      log: { '2026-06-30': { words: 640, goal: 500 }, '2026-07-01': { words: 512, goal: 500 } },
      dailyBaseline: { '2026-07-01': 12000 },
      goalHistory: [],
    },
    threads: {
      version: 1,
      types: [],
      threads: [{ id: 'th_1', typeId: 'plotline', name: 'The Manuscript', entries: [
        { id: 'en_1', text: 'Found in the attic', anchorIds: ['an_1'], todo: false },
      ] }],
    },
    notes: [{ id: 'n1', text: 'Remember the attic key.' }],
  };
}

async function roundTrip(session) {
  const bytes = await packSession(sessionToBook(session), { displayName: 'Tester' });
  expect(bytes).toBeInstanceOf(Uint8Array);
  const book = await unpackSession(bytes);
  return { bytes, book, restored: bookToSession(book) };
}

test('chapters, synopsis, content and order round-trip through .authbook', async () => {
  const { restored } = await roundTrip(makeSession());

  expect(restored.chapters).toHaveLength(3);
  const [c1, c2, c3] = restored.chapters;

  expect(c1.title).toBe('Discovery');
  expect(c1.content).toBe('<p>It was a dark and stormy night.</p>');
  expect(c1.synopsis).toBe('Mira finds the manuscript in the attic.');

  expect(c2.synopsis).toBe('Every written word ages the writer by a minute.');
  expect(c2.content).toContain('Words cost more than gold.');

  // Absent synopsis must stay absent — not become "" or undefined-key noise.
  expect(c3.synopsis).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(c3, 'synopsis')).toBe(false);

  expect(restored.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
});

test('extended metadata, threads, streak, notes and cover round-trip', async () => {
  const session = makeSession();
  const { restored } = await roundTrip(session);

  expect(restored.title).toBe('The Iron Manuscript');
  expect(restored.description).toBe('A story about stories.');
  expect(restored.genre).toBe('Fantasy');
  expect(restored.language).toBe('en');
  expect(restored.publisher).toBe('VCHS Studios');
  expect(restored.isbn).toBe('978-3-16-148410-0');

  // Threads live in META and must survive byte-for-byte.
  expect(restored.threads).toEqual(session.threads);

  // Streak + notes.
  expect(restored.streak.log['2026-07-01']).toEqual({ words: 512, goal: 500 });
  expect(restored.notes).toEqual(session.notes);

  // Cover bytes + mime.
  expect(restored.coverBase64).toBe(session.coverBase64);
  expect(restored.coverMime).toBe('image/jpeg');

  // The author stamp from settings.displayName is recorded.
  expect(restored.authors.some((a) => a.name === 'Tester')).toBe(true);
});

test('a flipped byte in the big chapter payload is recovered (RS parity)', async () => {
  const session = makeSession();
  const bytes = await packSession(sessionToBook(session), {});

  // Chapter 2 is ~50 KB of the file, so a flip at 60% of the byte stream lands
  // inside its compressed payload — the deterministic target for this test.
  const corrupted = Uint8Array.from(bytes);
  corrupted[Math.floor(corrupted.length * 0.6)] ^= 0xff;

  const book = await unpackSession(corrupted);
  const restored = bookToSession(book);

  expect(restored.chapters).toHaveLength(3);
  expect(restored.chapters[1].content).toContain('Words cost more than gold.');
  expect(restored.chapters[1].synopsis).toBe('Every written word ages the writer by a minute.');
});

test('change history persists: last 10 entries ride in the book, order kept', async () => {
  const session = makeSession();
  // 14 session entries, newest first — only the newest 10 should be saved.
  session.history = Array.from({ length: 14 }, (_, i) => ({
    id: `h${i}`, ts: 1_700_000_000_000 - i * 60_000, kind: 'edit',
    chapIdx: 1, chapTitle: 'Discovery',
    content: `<p>Draft ${14 - i}</p>`, words: 2, prevWords: 1,
  }));

  const { restored } = await roundTrip(session);

  expect(restored.history).toHaveLength(10);
  expect(restored.history.map((e) => e.id)).toEqual(session.history.slice(0, 10).map((e) => e.id));
  expect(restored.history[0].content).toBe('<p>Draft 14</p>');
  expect(restored.history[0].kind).toBe('edit');

  // Books that never had a history load without one (no [] noise on old files).
  const plain = makeSession();
  const { restored: r2 } = await roundTrip(plain);
  expect(r2.history).toBeUndefined();
});

test('a legacy flat session (no chapters array) still packs and loads', async () => {
  const legacy = {
    id: 'legacy-1', title: 'Old Book',
    content: '<p>Single-chapter legacy body.</p>',
    streak: { log: { '2026-06-01': 300 }, goalWords: 500 },
  };
  const bytes = await packSession(legacy, {});
  const restored = bookToSession(await unpackSession(bytes));

  expect(restored.title).toBe('Old Book');
  expect(restored.chapters).toHaveLength(1);
  expect(restored.chapters[0].content).toBe('<p>Single-chapter legacy body.</p>');
  // Legacy int log entries are normalised to { words, goal }.
  expect(restored.streak.log['2026-06-01']).toEqual({ words: 300, goal: 500 });
});
