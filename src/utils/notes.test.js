import {
  listNotes, getNote, createNote, updateNote, deleteNote,
  togglePinned, discardIfEmpty, noteTitle, notePreview,
  buildNotesPayload, noteCount, MAX_BODY, MAX_NOTES,
} from './notes';

beforeEach(() => localStorage.clear());

describe('capture', () => {
  /**
   * The capture flow is "give me somewhere to type". A button that does
   * nothing until there are words does nothing on the tap that matters.
   */
  test('an empty note is allowed, and comes back openable', () => {
    const n = createNote();
    expect(n.id).toBeTruthy();
    expect(n.body).toBe('');
    expect(getNote(n.id)).toMatchObject({ id: n.id, body: '' });
  });

  test('a note keeps exactly what was typed', () => {
    const body = 'the lighthouse keeper\nhas never seen the sea';
    expect(createNote(body).body).toBe(body);
  });

  test('two notes captured in the same millisecond get different ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createNote('x').id));
    expect(ids.size).toBe(50);
  });

  test('created and updated are set on the way in', () => {
    const n = createNote('hello');
    expect(Date.parse(n.created)).not.toBeNaN();
    expect(Date.parse(n.updated)).not.toBeNaN();
  });
});

describe('editing', () => {
  test('an edit changes the body and moves updated', async () => {
    const n = createNote('first');
    await new Promise((r) => setTimeout(r, 5));
    const out = updateNote(n.id, { body: 'second' });
    expect(out.body).toBe('second');
    expect(Date.parse(out.updated)).toBeGreaterThanOrEqual(Date.parse(n.updated));
  });

  /** The id and the creation time are the note's identity; a patch cannot move them. */
  test('a patch cannot rewrite the id or the creation time', () => {
    const n = createNote('x');
    const out = updateNote(n.id, { id: 'hijacked', created: '1999-01-01T00:00:00.000Z' });
    expect(out.id).toBe(n.id);
    expect(out.created).toBe(n.created);
    expect(getNote('hijacked')).toBeNull();
  });

  test('editing an id that is not there returns null rather than creating one', () => {
    expect(updateNote('nope', { body: 'x' })).toBeNull();
    expect(noteCount()).toBe(0);
  });

  test('delete removes it and says whether it did', () => {
    const n = createNote('x');
    expect(deleteNote(n.id)).toBe(true);
    expect(deleteNote(n.id)).toBe(false);
    expect(getNote(n.id)).toBeNull();
  });
});

describe('ordering', () => {
  test('newest first', async () => {
    const a = createNote('a');
    await new Promise((r) => setTimeout(r, 5));
    const b = createNote('b');
    expect(listNotes().map((n) => n.id)).toEqual([b.id, a.id]);
  });

  test('an edited note comes back to the top', async () => {
    const a = createNote('a');
    await new Promise((r) => setTimeout(r, 5));
    createNote('b');
    await new Promise((r) => setTimeout(r, 5));
    updateNote(a.id, { body: 'a again' });
    expect(listNotes()[0].id).toBe(a.id);
  });

  test('pinned sits above everything, however old', async () => {
    const old = createNote('old');
    await new Promise((r) => setTimeout(r, 5));
    createNote('new');
    togglePinned(old.id);
    expect(listNotes()[0].id).toBe(old.id);
    expect(listNotes()[0].pinned).toBe(true);
  });
});

describe('the title line', () => {
  test('is the first line with anything on it', () => {
    expect(noteTitle({ body: 'buy milk\nand bread' })).toBe('buy milk');
    expect(noteTitle({ body: '\n\n  the second line wins  \nthird' })).toBe('the second line wins');
  });

  /** A note is captured before it says anything; the row still has to render. */
  test('a note with no text still reads as something', () => {
    expect(noteTitle({ body: '' })).toBe('Empty note');
    expect(noteTitle({ body: '   \n\n  ' })).toBe('Empty note');
    expect(noteTitle({})).toBe('Empty note');
    expect(noteTitle(null)).toBe('Empty note');
  });

  test('a long first line is cut to fit its row', () => {
    const t = noteTitle({ body: 'x'.repeat(200) }, 20);
    expect(t).toHaveLength(20);
    expect(t.endsWith('…')).toBe(true);
  });

  test('the preview is what the title did not take', () => {
    expect(notePreview({ body: 'title\nbody one\nbody two' })).toBe('body one body two');
    expect(notePreview({ body: 'only a title' })).toBe('');
    expect(notePreview({ body: '' })).toBe('');
  });
});

describe('discarding a note nobody wrote in', () => {
  test('an untouched note is removed when it closes', () => {
    const n = createNote();
    expect(discardIfEmpty(n.id)).toBe(true);
    expect(getNote(n.id)).toBeNull();
  });

  /** Short is not the same as empty. One character is a note. */
  test('a note with any text at all is kept', () => {
    const n = createNote('!');
    expect(discardIfEmpty(n.id)).toBe(false);
    expect(getNote(n.id)).not.toBeNull();
  });

  test('whitespace only counts as empty', () => {
    const n = createNote('   \n\t ');
    expect(discardIfEmpty(n.id)).toBe(true);
  });
});

describe('bounds, because this shares a budget with the manuscripts', () => {
  test('a body past the cap is cut rather than stored whole', () => {
    const n = createNote('y'.repeat(MAX_BODY + 500));
    expect(n.body).toHaveLength(MAX_BODY);
    expect(updateNote(n.id, { body: 'z'.repeat(MAX_BODY + 500) }).body).toHaveLength(MAX_BODY);
  });

  test('the list stops growing at the cap, dropping the oldest', () => {
    for (let i = 0; i < MAX_NOTES + 5; i++) createNote(`note ${i}`);
    expect(noteCount()).toBeLessThanOrEqual(MAX_NOTES);
    const bodies = listNotes().map((n) => n.body);
    expect(bodies).toContain(`note ${MAX_NOTES + 4}`);
    expect(bodies).not.toContain('note 0');
  });

  /** Pinning is the writer saying "keep this one"; the cap must respect that. */
  test('a pinned note survives the cap', () => {
    const keep = createNote('the one that matters');
    togglePinned(keep.id);
    for (let i = 0; i < MAX_NOTES + 5; i++) createNote(`filler ${i}`);
    expect(getNote(keep.id)).not.toBeNull();
  });
});

describe('reading a store that has been damaged', () => {
  test('junk in localStorage reads as no notes', () => {
    localStorage.setItem('authno_notes_v1', 'not json at all');
    expect(listNotes()).toEqual([]);
    expect(() => createNote('after the damage')).not.toThrow();
    expect(listNotes()).toHaveLength(1);
  });

  test('an entry with no id is dropped rather than rendered', () => {
    localStorage.setItem('authno_notes_v1', JSON.stringify([{ body: 'orphan' }, { id: 'ok', body: 'kept' }]));
    expect(listNotes().map((n) => n.id)).toEqual(['ok']);
  });

  test('a stored object instead of an array reads as no notes', () => {
    localStorage.setItem('authno_notes_v1', JSON.stringify({ id: 'x' }));
    expect(listNotes()).toEqual([]);
  });
});

describe('the widget payload', () => {
  test('is trimmed to the row count asked for', () => {
    for (let i = 0; i < 10; i++) createNote(`note ${i}`);
    expect(buildNotesPayload(4)).toHaveLength(4);
    expect(buildNotesPayload(0)).toHaveLength(0);
  });

  test('carries a title and a numeric timestamp, not an ISO string', () => {
    createNote('an idea\nabout the ending');
    const [row] = buildNotesPayload(1);
    expect(row.title).toBe('an idea');
    expect(row.preview).toBe('about the ending');
    expect(typeof row.updated).toBe('number');
  });

  test('is serialisable — it crosses the bridge as JSON', () => {
    createNote('x');
    const p = buildNotesPayload(4);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  test('an empty store gives an empty list, not a row saying nothing', () => {
    expect(buildNotesPayload(4)).toEqual([]);
  });

  /**
   * A widget row with no text in it reads as a broken widget rather than as an
   * empty note, so the payload must never send one. The native side repeats
   * this check in NotesText.title() because the value crosses a JSON bridge
   * and a SharedPreferences round-trip on the way there.
   */
  test('a note that is only whitespace still gives the row something to show', () => {
    createNote('   \n\t  \n ');
    const [row] = buildNotesPayload(1);
    expect(row.title).toBe('Empty note');
    expect(row.preview).toBe('');
  });

  test('a note with no second line sends an empty preview, not undefined', () => {
    createNote('one line only');
    const [row] = buildNotesPayload(1);
    expect(row.preview).toBe('');
    expect(row.title).toBe('one line only');
  });
});
