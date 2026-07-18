/**
 * firstBookTour.js — state + signals for the interactive "Create My First
 * Book" coach.
 *
 * Unlike GuidedTour (a passive spotlight walkthrough), this coach is
 * action-gated: compulsory steps stay locked until the user actually does the
 * thing. It also PERSISTS — the writing step is meant to pause indefinitely
 * ("write a few words, continue whenever"), so the tour must survive reloads
 * and resume exactly where it left off, bound to the real book the user is
 * building.
 *
 * State shape (localStorage 'authno_first_book_tour'):
 *   { status: 'idle'|'active'|'done', step: number, bookId: string|null }
 *
 * Signals: ephemeral actions the coach can't read off the session object
 * (a save happened, the History panel opened, an export ran, an import
 * completed) are announced with emitTourSignal(name); the coach subscribes.
 */

const KEY = 'authno_first_book_tour';
const _subs = new Set();

function _read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { status: 'idle', step: 0, bookId: null };
    const s = JSON.parse(raw);
    return { status: s.status ?? 'idle', step: s.step ?? 0, bookId: s.bookId ?? null };
  } catch {
    return { status: 'idle', step: 0, bookId: null };
  }
}

function _write(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  for (const fn of _subs) { try { fn(next); } catch (e) { console.error('[firstBookTour]', e); } }
}

export function getTourState() { return _read(); }

export function isTourActive() { return _read().status === 'active'; }

export function hasCompletedTour() { return _read().status === 'done'; }

/** Begin the coach, bound to the real book the user will build up. */
export function startFirstBookTour(bookId) {
  _write({ status: 'active', step: 0, bookId: bookId ?? null });
}

export function setTourStep(step) {
  const s = _read();
  if (s.status !== 'active') return;
  _write({ ...s, step });
}

export function setTourBookId(bookId) {
  const s = _read();
  _write({ ...s, bookId });
}

/** Finish (completed) or abandon (skipped) — either way the banner won't return. */
export function endFirstBookTour(completed = true) {
  _write({ status: completed ? 'done' : 'idle', step: 0, bookId: null });
}

/** Testing/dev: forget the tour so the banner shows again. */
export function resetFirstBookTour() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  _write({ status: 'idle', step: 0, bookId: null });
}

export function subscribeTour(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

// ── Ephemeral action signals ────────────────────────────────────────────────
const _sigSubs = new Set();

/** Announce a one-off action: 'save' | 'history-open' | 'export' | 'import'. */
export function emitTourSignal(name) {
  for (const fn of _sigSubs) { try { fn(name); } catch (e) { console.error('[firstBookTour]', e); } }
}

export function subscribeTourSignal(fn) {
  _sigSubs.add(fn);
  return () => _sigSubs.delete(fn);
}
