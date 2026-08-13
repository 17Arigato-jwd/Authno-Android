/**
 * devMode.js — the seven taps.
 *
 * Developer options used to sit in the settings nav for everybody, between
 * Appearance and About. They are diagnostics: a book scanner, an error log, a
 * tour replay. Useful when something has gone wrong and clutter the rest of
 * the time, and a "Developer" tab in a writing app invites a certain amount of
 * poking that support then has to explain.
 *
 * So they hide behind the oldest gesture on Android: tap the version seven
 * times. Nobody arrives there by accident, anybody who has been told how can
 * get there in four seconds, and it needs no password, no build flag and no
 * hidden URL.
 *
 * The counter is deliberately NOT persisted — only the unlocked state is.
 * A half-finished tap sequence surviving a restart is how somebody finds
 * themselves in developer mode without knowing what they did.
 */

const KEY = 'authno_dev_mode';

/** How many taps. Seven, because that is the number everyone already knows. */
export const TAPS_REQUIRED = 7;

/** Taps this far apart are two separate attempts, not one sequence. */
export const TAP_WINDOW_MS = 3000;

export function isDevModeUnlocked() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setDevModeUnlocked(on) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* private mode — developer options simply stay hidden */ }
  return !!on;
}

/**
 * Advance a tap sequence.
 *
 * Pure: takes the previous state and returns the next one, so the component
 * holding it stays a plain useState and this stays testable without a DOM.
 *
 * @param {{count: number, last: number}|null} state previous, or null to start
 * @param {number} now milliseconds
 * @returns {{count: number, last: number, unlocked: boolean, remaining: number}}
 *   `unlocked` is true only on the tap that crosses the line — it is an edge,
 *   not a level, so the caller can react once rather than on every further tap.
 */
export function tapVersion(state, now = Date.now()) {
  const fresh = !state || !Number.isFinite(state.last) || (now - state.last) > TAP_WINDOW_MS;
  const count = fresh ? 1 : (Number(state.count) || 0) + 1;
  const unlocked = count === TAPS_REQUIRED;
  return {
    count,
    last: now,
    unlocked,
    // Counts down, and stays at 0 once there: "4 taps away" is a useful thing
    // to show, "-2 taps away" is not.
    remaining: Math.max(0, TAPS_REQUIRED - count),
  };
}

/**
 * Whether to say anything yet.
 *
 * Silence for the first few, so an accidental double-tap on a version number
 * never produces a mysterious countdown. The hint only appears once the taps
 * are clearly deliberate — which is also when it becomes useful.
 */
export function tapHint(state) {
  const remaining = state?.remaining;
  if (typeof remaining !== 'number' || remaining <= 0) return null;
  if (remaining > 3) return null;
  return remaining === 1
    ? '1 more tap'
    : `${remaining} more taps`;
}
