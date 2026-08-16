import {
  libraryCapabilities, projectBook, PROJECTION_FIELDS, PROJECTION_EXTRAS,
  ALLOWED_FORMATS,
} from './extensionLibraryV2.js';
import { createDispatch } from './extensionDispatchV2.js';
import { permissionSetFor } from './extensionPermissionsV2.js';

const BOOKS = [
  {
    id: 'open-one',
    title: 'The Open Book',
    author: 'A. Writer',
    isbn: '978-0000000001',
    created: 1000,
    updated: 2000,
    chapters: [
      { chap_idx: 0, title: 'Arrival', synopsis: 'She lands.', content: 'The plane touched down in a city that had already forgotten her name.' },
      { chap_idx: 1, title: 'The Betrayal', synopsis: 'He lies.', content: 'He said it plainly, and she believed him for exactly as long as it took to cross the room and reach the door, which is to say not very long at all, and afterwards she would remember the exact colour of the wallpaper.' },
    ],
    secretInternalField: 'must not cross',
  },
  {
    id: 'other-one',
    title: 'A Different Book',
    author: 'B. Writer',
    chapters: [{ chap_idx: 0, title: 'Alone', content: 'one two three four five' }],
  },
];

function harness({ granted, openId = 'open-one' } = {}) {
  const manifest = {
    apiVersion: 2,
    id: 'demo',
    permissions: {
      'library:read:current': { reason: 'Read the open book.' },
      'library:read:all': { reason: 'Read every book.' },
      'library:write': { reason: 'Write books.' },
      'library:export': { reason: 'Export books.' },
    },
  };
  const written = [];
  const caps = libraryCapabilities({
    list: async () => BOOKS,
    get: async (id) => BOOKS.find((b) => b.id === id) ?? null,
    currentId: () => openId,
    create: async (b) => { written.push(['create', b]); return { ...b, id: 'new-one', chapters: [] }; },
    update: async (id, patch) => { written.push(['update', id, patch]); return { ...BOOKS[0], ...patch }; },
    exportAs: async (book, fmt) => `${book.id}.${fmt}`,
  });
  const permissions = permissionSetFor(manifest, granted);
  const dispatch = createDispatch({ extId: 'demo', permissions, capabilities: caps });
  return { dispatch, permissions, written };
}

describe('library.list is metadata, never manuscript', () => {
  test('it returns only allowlisted fields', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const rows = await dispatch('library.list', []);
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]).sort()).toEqual([...PROJECTION_FIELDS].sort());
  });

  test('chapter text never appears, in any field', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const rows = await dispatch('library.list', []);
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain('The plane touched down');
    expect(blob).not.toContain('he believed him');
  });

  test('an internal field on the book does not leak', async () => {
    // The projection is an allowlist rather than a delete-list, so a field
    // added to a book elsewhere in the app does not silently start crossing.
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const rows = await dispatch('library.list', []);
    expect(JSON.stringify(rows)).not.toContain('must not cross');
    expect(rows[0].secretInternalField).toBeUndefined();
  });

  test('counts are computed, not copied', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const [first, second] = await dispatch('library.list', []);
    expect(first.chapterCount).toBe(2);
    expect(second.wordCount).toBe(5);
  });

  test('chapter titles are opt-in, because titles carry plot', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const plain = await dispatch('library.list', [{}]);
    expect(plain[0].chapterTitles).toBeUndefined();

    const withTitles = await dispatch('library.list', [{ include: [PROJECTION_EXTRAS.chapterTitles] }]);
    expect(withTitles[0].chapterTitles).toEqual(['Arrival', 'The Betrayal']);
  });

  test('a long chapter is cut short in a preview', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const rows = await dispatch('library.list', [{ include: [PROJECTION_EXTRAS.chapterPreview] }]);
    for (const p of rows[0].chapterPreview) expect(p.length).toBeLessThanOrEqual(160);
    expect(rows[0].chapterPreview[1]).toContain('He said it plainly');
    expect(rows[0].chapterPreview[1]).not.toContain('colour of the wallpaper');
  });

  test('a chapter shorter than the limit IS fully visible in a preview', async () => {
    // Stated rather than glossed over. A preview exists to identify a chapter,
    // and for a chapter shorter than the limit the whole text is the
    // identification — there is no version of this feature where that is not
    // true. The consequence worth knowing: a book of very short chapters can
    // be read in full through previews alone, so `chapter.preview` is a real
    // grant over content and not merely over shape. It is opt-in for that
    // reason.
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const rows = await dispatch('library.list', [{ include: [PROJECTION_EXTRAS.chapterPreview] }]);
    expect(rows[1].chapterPreview[0]).toBe('one two three four five');
  });

  test('an unknown extra is ignored rather than honoured', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const rows = await dispatch('library.list', [{ include: ['chapter.content', 'everything'] }]);
    expect(Object.keys(rows[0]).sort()).toEqual([...PROJECTION_FIELDS].sort());
  });

  test('listing needs read:all — read:current is not enough', async () => {
    const { dispatch } = harness({ granted: ['library:read:current'] });
    await expect(dispatch('library.list', [])).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('read:current is a scope, not a method', () => {
  test('it reads the open book', async () => {
    const { dispatch } = harness({ granted: ['library:read:current'] });
    const book = await dispatch('library.get', ['open-one']);
    expect(book.title).toBe('The Open Book');
  });

  test('it refuses any other book', async () => {
    // The whole distinction. A static method check cannot see the argument, so
    // if this ever passes, read:current has become a synonym for read:all.
    const { dispatch } = harness({ granted: ['library:read:current'] });
    await expect(dispatch('library.get', ['other-one']))
      .rejects.toMatchObject({ code: 'capability-failed' });
  });

  test('it refuses everything when no book is open', async () => {
    // Defaulting to the first book would quietly widen the permission.
    const { dispatch } = harness({ granted: ['library:read:current'], openId: null });
    await expect(dispatch('library.get', ['open-one']))
      .rejects.toMatchObject({ code: 'capability-failed' });
  });

  test('the scope follows the open book as it changes', async () => {
    let open = 'open-one';
    const caps = libraryCapabilities({
      list: async () => BOOKS,
      get: async (id) => BOOKS.find((b) => b.id === id) ?? null,
      currentId: () => open,
    });
    const permissions = permissionSetFor(
      { permissions: { 'library:read:current': { reason: 'r' } } },
      ['library:read:current'],
    );
    const dispatch = createDispatch({ extId: 'demo', permissions, capabilities: caps });

    await expect(dispatch('library.get', ['open-one'])).resolves.toBeTruthy();
    open = 'other-one';
    await expect(dispatch('library.get', ['open-one'])).rejects.toMatchObject({ code: 'capability-failed' });
    await expect(dispatch('library.get', ['other-one'])).resolves.toBeTruthy();
  });

  test('read:all reads any book, open or not', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    await expect(dispatch('library.get', ['other-one'])).resolves.toBeTruthy();
    await expect(dispatch('library.getAny', ['other-one'])).resolves.toBeTruthy();
  });

  test('getAny is unreachable with only read:current', async () => {
    const { dispatch } = harness({ granted: ['library:read:current'] });
    await expect(dispatch('library.getAny', ['other-one']))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('revoking read:all mid-session falls back to the narrow scope', async () => {
    const { dispatch, permissions } = harness({ granted: ['library:read:all', 'library:read:current'] });
    await expect(dispatch('library.get', ['other-one'])).resolves.toBeTruthy();
    permissions.revoke('library:read:all');
    await expect(dispatch('library.get', ['other-one'])).rejects.toMatchObject({ code: 'capability-failed' });
    await expect(dispatch('library.get', ['open-one'])).resolves.toBeTruthy();
  });
});

describe('library.get returns metadata unless text is asked for', () => {
  test('the default carries no chapter content', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const book = await dispatch('library.get', ['open-one']);
    expect(JSON.stringify(book)).not.toContain('The plane touched down');
  });

  test('chapters:true returns the whole book', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const book = await dispatch('library.get', ['open-one', { chapters: true }]);
    expect(book.chapters[0].content).toContain('The plane touched down');
  });

  test('a missing id and a missing book are distinguishable', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    const noId = await dispatch('library.get', ['']).catch((e) => e.message);
    const noBook = await dispatch('library.get', ['nope']).catch((e) => e.message);
    expect(noId).toMatch(/needs a book id/);
    expect(noBook).toMatch(/no book with id/);
  });
});

describe('writing and exporting', () => {
  test('create and update need library:write', async () => {
    const { dispatch } = harness({ granted: ['library:read:all'] });
    await expect(dispatch('library.create', [{ title: 'New' }]))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(dispatch('library.update', ['open-one', { title: 'x' }]))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('with the grant they run and return metadata only', async () => {
    const { dispatch, written } = harness({ granted: ['library:write'] });
    const made = await dispatch('library.create', [{ title: 'New' }]);
    expect(made.id).toBe('new-one');
    expect(Object.keys(made).sort()).toEqual([...PROJECTION_FIELDS].sort());
    expect(written[0][0]).toBe('create');
  });

  test('updating a book that does not exist is refused', async () => {
    const { dispatch } = harness({ granted: ['library:write'] });
    await expect(dispatch('library.update', ['nope', { title: 'x' }]))
      .rejects.toMatchObject({ code: 'capability-failed' });
  });

  test('a non-object patch is refused rather than coerced', async () => {
    const { dispatch } = harness({ granted: ['library:write'] });
    for (const bad of ['string', 42, null, undefined]) {
      await expect(dispatch('library.update', ['open-one', bad]))
        .rejects.toMatchObject({ code: 'capability-failed' });
    }
  });

  test('export needs its own permission, separate from reading', async () => {
    // Turning a book into a file is a different act from reading it — an
    // extension that can read one on screen need not be able to emit it.
    const { dispatch } = harness({ granted: ['library:read:all'] });
    await expect(dispatch('library.export', ['open-one', 'txt']))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('export runs with the grant, and only in known formats', async () => {
    const { dispatch } = harness({ granted: ['library:export'] });
    await expect(dispatch('library.export', ['open-one', 'epub'])).resolves.toBe('open-one.epub');
    await expect(dispatch('library.export', ['open-one', 'exe']))
      .rejects.toMatchObject({ code: 'capability-failed' });
  });

  test('the format list is exactly what the spec names', () => {
    expect([...ALLOWED_FORMATS].sort())
      .toEqual(['authbook', 'docx', 'epub', 'html', 'md', 'pdf', 'txt']);
  });

  test('a build without a capability says so rather than pretending', async () => {
    const caps = libraryCapabilities({
      list: async () => [], get: async () => null, currentId: () => null,
    });
    const permissions = permissionSetFor(
      { permissions: { 'library:write': { reason: 'r' }, 'library:export': { reason: 'r' } } },
      ['library:write', 'library:export'],
    );
    const dispatch = createDispatch({ extId: 'demo', permissions, capabilities: caps });
    await expect(dispatch('library.create', [{}])).rejects.toMatchObject({ code: 'capability-failed' });
    await expect(dispatch('library.export', ['x'])).rejects.toMatchObject({ code: 'capability-failed' });
  });
});

describe('projectBook on its own', () => {
  test('a malformed book does not throw', async () => {
    for (const junk of [null, undefined, {}, { chapters: 'not an array' }, { chapters: [null] }]) {
      const out = projectBook(junk);
      expect(typeof out.title).toBe('string');
      expect(typeof out.chapterCount).toBe('number');
      expect(Number.isFinite(out.wordCount)).toBe(true);
    }
  });

  test('word counting handles empty and whitespace-only chapters', () => {
    expect(projectBook({ chapters: [{ content: '' }, { content: '   ' }] }).wordCount).toBe(0);
    expect(projectBook({ chapters: [{ content: ' one  two \n three ' }] }).wordCount).toBe(3);
  });
});
