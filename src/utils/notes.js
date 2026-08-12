/**
 * notes.js — quick capture, kept away from the books.
 *
 * A note is what you write when an idea arrives and there is no time to pick
 * a book, find the chapter and place a cursor. It has no title you are made
 * to invent, no folder to file it in, and it is never part of a manuscript.
 *
 * Deliberately NOT the `notes` array in the `.authbook` format. That one is
 * per-book and travels inside a single file — which is exactly wrong for
 * "an idea arrived and I do not yet know which book it belongs to". These
 * live on their own, so capture never depends on a book being open, loaded,
 * or even existing.
 *
 * Storage is localStorage. Notes are small, capture has to be instantaneous,
 * and a round-trip to the filesystem for three lines of text is a worse
 * trade than the quota risk — which is bounded here rather than hoped away:
 * see MAX_NOTES and MAX_BODY.
 */

const KEY = 'authno_notes_v1';

/**
 * Bounds, because this shares the localStorage budget with the session
 * mirror, and the session mirror holds manuscripts. A runaway notes list
 * must never be the reason a book cannot be written back.
 */
export const MAX_NOTES = 200;
export const MAX_BODY = 20000;

/** Everything a caller can rely on. Anything else on the object is internal. */
export const NOTE_SHAPE = ['id', 'body', 'created', 'updated', 'pinned'];

function nowIso() { return new Date().toISOString(); }

function newId() {
  // Time-ordered so a list sorted by id is roughly chronological even if a
  // timestamp is ever lost, plus a random tail because two notes captured in
  // the same millisecond is a thing that happens when a button is double-hit.
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Anything unparseable reads as "no notes yet" rather than throwing. */
function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(raw) ? raw.filter(isNote) : [];
  } catch { return []; }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    // Quota. Notes are the newer, smaller and more replaceable thing in this
    // budget, so they yield rather than take: drop the oldest unpinned half
    // and try once more. Failing that, the write is lost and the caller is
    // told, rather than the app pretending it saved.
    try {
      const trimmed = trimOldest(list, Math.ceil(list.length / 2));
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return true;
    } catch { return false; }
  }
}

function isNote(n) {
  return !!n && typeof n === 'object' && typeof n.id === 'string' && n.id.length > 0;
}

function normalise(n) {
  return {
    id: n.id,
    body: typeof n.body === 'string' ? n.body : '',
    created: n.created || nowIso(),
    updated: n.updated || n.created || nowIso(),
    pinned: !!n.pinned,
  };
}

/** Newest first, pinned above everything. */
function sort(list) {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return String(b.updated || '').localeCompare(String(a.updated || ''));
  });
}

function trimOldest(list, howMany) {
  if (howMany <= 0) return list;
  const pinned = list.filter((n) => n.pinned);
  const rest = sort(list.filter((n) => !n.pinned));
  return [...pinned, ...rest.slice(0, Math.max(0, rest.length - howMany))];
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** @returns {Array<{id,body,created,updated,pinned}>} newest first. */
export function listNotes() {
  return sort(read().map(normalise));
}

export function getNote(id) {
  if (!id) return null;
  const found = read().find((n) => n.id === id);
  return found ? normalise(found) : null;
}

export function noteCount() {
  return read().length;
}

/**
 * The first line, for a list row or a widget.
 *
 * A note has no title, so its first line is the title — which means a note
 * that opens with a blank line still needs to show something. Falls through
 * to the first line that has any text on it.
 */
export function noteTitle(note, max = 60) {
  const body = String(note?.body ?? '');
  const line = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  if (!line) return 'Empty note';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The rest, after the line noteTitle took. */
export function notePreview(note, max = 90) {
  const lines = String(note?.body ?? '').split('\n');
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) return '';
  const rest = lines.slice(firstIdx + 1).join(' ').replace(/\s+/g, ' ').trim();
  if (!rest) return '';
  return rest.length > max ? `${rest.slice(0, max - 1)}…` : rest;
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * A new note, returned so the caller can open it immediately.
 *
 * Creating an empty one is allowed on purpose: the capture flow is "give me
 * somewhere to type", and refusing until there are words would mean the
 * button does nothing on the tap that matters.
 */
export function createNote(body = '') {
  const note = normalise({ id: newId(), body: clampBody(body), created: nowIso(), updated: nowIso() });
  const list = read();
  write(trimOldest([note, ...list], Math.max(0, list.length + 1 - MAX_NOTES)));
  return note;
}

/** @returns the updated note, or null if the id is unknown. */
export function updateNote(id, patch) {
  const list = read();
  const i = list.findIndex((n) => n.id === id);
  if (i === -1) return null;
  const next = normalise({
    ...list[i],
    ...patch,
    id: list[i].id,
    created: list[i].created,
    updated: nowIso(),
  });
  if (typeof next.body === 'string') next.body = clampBody(next.body);
  list[i] = next;
  write(list);
  return next;
}

export function deleteNote(id) {
  const list = read();
  const next = list.filter((n) => n.id !== id);
  if (next.length === list.length) return false;
  write(next);
  return true;
}

export function togglePinned(id) {
  const n = getNote(id);
  if (!n) return null;
  return updateNote(id, { pinned: !n.pinned });
}

/**
 * A note that was opened and left without a word typed in it is not a note.
 * Called when the editor closes so the list does not fill with blanks from
 * mis-taps — but only for genuinely empty bodies, never merely short ones.
 */
export function discardIfEmpty(id) {
  const n = getNote(id);
  if (!n) return false;
  if (n.body.trim().length > 0) return false;
  return deleteNote(id);
}

function clampBody(body) {
  const s = String(body ?? '');
  return s.length > MAX_BODY ? s.slice(0, MAX_BODY) : s;
}

// ── The widget's slice ───────────────────────────────────────────────────────

/**
 * What a home-screen notes widget would show: a few rows, already trimmed.
 *
 * Pure and exported ahead of the widget itself, because this is the part with
 * the edge cases — an empty note, a note that is only whitespace, a body long
 * enough to blow a `RemoteViews` row — and it can be pinned down here without
 * a device. See docs/todo/notes-widget.md.
 */
export function buildNotesPayload(limit = 4) {
  return listNotes().slice(0, Math.max(0, limit)).map((n) => ({
    id: n.id,
    title: noteTitle(n, 40),
    preview: notePreview(n, 60),
    updated: Date.parse(n.updated) || 0,
    pinned: !!n.pinned,
  }));
}
