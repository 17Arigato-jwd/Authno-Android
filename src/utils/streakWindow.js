/**
 * streakWindow.js — when a writing day ends, and how long is left of it.
 *
 * A streak needs a deadline before a countdown can mean anything, and midnight
 * is the wrong one. People who write in the evening are routinely still going
 * at half past twelve, and a day boundary that cuts the streak mid-sentence is
 * punishing them for the hour rather than for not writing.
 *
 * So a writing day runs from `graceHours` past midnight to `graceHours` past
 * the next midnight. Write at 01:00 on Tuesday and it counts for Monday, which
 * is the day you would say you wrote it. The countdown is time left in the
 * current writing day, which is a real deadline with a real consequence.
 *
 * That is the "freeze window": not a token you spend, but an amount of the
 * next morning that still belongs to the night before.
 *
 * Pure and dependency-free, like wordCount and reminderCopy. Everything takes
 * an explicit `now` so every branch is reachable from a test rather than at
 * 03:59 on a Wednesday.
 */

/** Hours past midnight that still belong to the previous writing day. */
export const DEFAULT_GRACE_HOURS = 4;

/** Nobody's evening runs to noon, and a 12-hour grace has no day left in it. */
export const MAX_GRACE_HOURS = 11;

export function clampGrace(hours) {
  // null, undefined and '' all pass Number() as 0, which is a legal setting
  // meaning "no grace at all" — so an absent value would silently switch the
  // feature off rather than fall back to the default. Only an explicit number
  // gets to say zero.
  if (hours === null || hours === undefined || hours === '') return DEFAULT_GRACE_HOURS;
  const h = Number(hours);
  if (!Number.isFinite(h)) return DEFAULT_GRACE_HOURS;
  return Math.min(MAX_GRACE_HOURS, Math.max(0, Math.trunc(h)));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Which writing day a moment belongs to, as "yyyy-mm-dd".
 *
 * The same key the streak log is already indexed by, so a grace window changes
 * which day a session lands in without changing the shape of anything stored.
 */
export function writingDayKey(now = new Date(), graceHours = DEFAULT_GRACE_HOURS) {
  const g = clampGrace(graceHours);
  const d = new Date(now);
  if (d.getHours() < g) d.setTime(d.getTime() - DAY_MS);
  return ymd(d);
}

/**
 * The moment the current writing day ends — the countdown's target.
 *
 * Local time throughout, deliberately. A writer's day is the one their clock
 * shows; converting to UTC would make the deadline jump by an hour twice a
 * year for no reason they could see.
 */
export function windowEnd(now = new Date(), graceHours = DEFAULT_GRACE_HOURS) {
  const g = clampGrace(graceHours);
  const end = new Date(now);
  end.setHours(g, 0, 0, 0);
  // Before the grace hour, the window closes this morning; after it, tomorrow.
  if (end.getTime() <= now.getTime()) end.setTime(end.getTime() + DAY_MS);
  return end;
}

/** Milliseconds left in the current writing day. Never negative. */
export function msRemaining(now = new Date(), graceHours = DEFAULT_GRACE_HOURS) {
  return Math.max(0, windowEnd(now, graceHours).getTime() - new Date(now).getTime());
}

/**
 * True when the clock has passed midnight but the writing day has not ended —
 * the borrowed hours. Worth naming because it is the one state where the
 * countdown and the calendar disagree, and a widget saying "3h left" on a date
 * that is already tomorrow needs to be able to explain itself.
 */
export function inGraceWindow(now = new Date(), graceHours = DEFAULT_GRACE_HOURS) {
  const g = clampGrace(graceHours);
  if (g <= 0) return false;
  return new Date(now).getHours() < g;
}

/**
 * "2:37:07" while it matters, "3h 12m" while it does not.
 *
 * Seconds appear under an hour because that is when they are information; a
 * widget showing them all day would tick 86,400 times to say nothing.
 */
export function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  if (h >= 1) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m >= 1) return `${m}:${String(s).padStart(2, '0')}`;
  return `${s}s`;
}

/**
 * Everything a countdown surface needs, in one call.
 *
 * Assembled here rather than in the widget bridge so the phone, the desktop
 * and any future surface agree on what "time left" means. Two of them
 * disagreeing about a deadline is worse than neither having one.
 *
 * @returns {{
 *   deadline: number, msLeft: number, label: string,
 *   dayKey: string, inGrace: boolean, urgent: boolean, met: boolean
 * }}
 */
export function countdownState({
  now = new Date(),
  graceHours = DEFAULT_GRACE_HOURS,
  wordsToday = 0,
  goalWords = 0,
} = {}) {
  const at = new Date(now);
  const end = windowEnd(at, graceHours);
  const msLeft = Math.max(0, end.getTime() - at.getTime());
  const met = goalWords > 0 && wordsToday >= goalWords;
  return {
    deadline: end.getTime(),
    msLeft,
    label: formatRemaining(msLeft),
    dayKey: writingDayKey(at, graceHours),
    inGrace: inGraceWindow(at, graceHours),
    // Under an hour, and only when there is still something to do. An urgent
    // countdown on a day already finished is a manufactured emergency, which
    // is exactly the manipulation this project's reminders refuse elsewhere.
    urgent: msLeft <= 60 * 60 * 1000 && !met,
    met,
  };
}
