/**
 * writeClock.js — when words were last added.
 *
 * One number, and it exists because the writing day's deadline depends on it.
 * A day ends at midnight unless somebody is still writing when midnight
 * arrives, and "still writing" has to mean something a machine can check.
 *
 * The signal is deliberately narrower than "the app was open" or "the caret
 * moved". Reading your own chapter at 23:55 is not writing, and an extension
 * granted for it would quietly move which day the next hour's words counted
 * for. So this is stamped from the one place that knows the word count went
 * up, and nowhere else.
 *
 * localStorage rather than the sessions array: it is a fact about the writer,
 * not about any one book, and it must survive a reload without waiting for the
 * library to load.
 */

const KEY = 'authno_last_write_v1';

/**
 * Writes coalesce to the minute. The deadline rule works in half-hours, so
 * finer resolution buys nothing, and this is called from an effect that
 * follows the word count — i.e. potentially on every flush of the editor.
 */
const COALESCE_MS = 60 * 1000;

/** @returns {number|null} epoch ms, or null if nothing has ever been recorded */
export function lastWriteAt() {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Records that words were just written.
 *
 * @param {number} at epoch ms, defaulting to now — passed explicitly by tests
 * @returns {boolean} whether the stamp was actually moved
 */
export function markWrote(at = Date.now()) {
  const when = Number(at);
  if (!Number.isFinite(when) || when <= 0) return false;
  const prev = lastWriteAt();
  // Never move it backwards. A clock correction mid-session would otherwise
  // shorten a window somebody is currently inside.
  if (prev !== null && when < prev + COALESCE_MS) return false;
  try {
    localStorage.setItem(KEY, String(when));
    return true;
  } catch {
    // Quota. The consequence is a day that ends at midnight, which is the
    // rule anyway — worth nothing louder than this comment.
    return false;
  }
}

/** Test seam, and the thing to call if "forget everything" ever grows a button. */
export function clearWriteClock() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
