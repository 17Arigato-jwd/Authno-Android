/**
 * streakWindow.js — when a writing day ends, and how long is left of it.
 *
 * The day ends at midnight. That is the rule, and for almost everybody it is
 * the whole rule.
 *
 * The exception is the one case where midnight is obviously wrong: you are
 * still writing when it arrives. Cutting a streak off mid-sentence punishes
 * somebody for the hour rather than for not writing, so a session that is
 * still warm at the deadline buys another hour — and if you are still going at
 * the end of THAT hour, another. It stops at 4am, because by then the question
 * is no longer whether you wrote today.
 *
 * So:
 *
 *   stopped at 21:00   → resets at midnight
 *   still writing 23:50 → runs to 01:00
 *   still writing 00:45 → runs to 02:00
 *   still writing 02:50 → runs to 04:00, and no further
 *
 * The extension is earned, never granted. Nothing here gives time to somebody
 * who has stopped, which is what separates it from a grace period: it follows
 * the writing rather than the clock.
 *
 * Pure and dependency-free, like wordCount and reminderCopy. Everything takes
 * an explicit `now` and an explicit `lastWriteAt`, so every branch is reachable
 * from a test rather than at 03:59 on a Wednesday.
 */

/**
 * How recently you must have written, at the moment a deadline arrives, for it
 * to move. Half an hour: long enough that a pause to think does not cost the
 * extension, short enough that it means you are actually still at it.
 */
export const LOOKBACK_MINUTES = 30;

/** Extensions come one hour at a time. */
export const EXTENSION_HOURS = 1;

/** And stop here. Past 4am it is tomorrow by any reading. */
export const HARD_CAP_HOUR = 4;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 00:00 on the same calendar date as `d`. */
function midnightOf(d) {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  return m;
}

/** The next 00:00 strictly after `d`. */
function nextMidnightAfter(d) {
  const m = new Date(d);
  m.setHours(24, 0, 0, 0);
  return m;
}

/** HARD_CAP_HOUR on the same calendar date as `d`. */
function capOn(d, capHour) {
  const c = new Date(d);
  c.setHours(capHour, 0, 0, 0);
  return c;
}

/**
 * Walk a midnight deadline forward, one hour at a time, for as long as the
 * last write was recent enough at each step.
 *
 * The condition is `lastWrite >= end - lookback` with no upper bound, and the
 * missing upper bound is deliberate. A write that lands *after* a candidate
 * deadline can only have happened because an earlier extension had already
 * moved that deadline past it — so it is evidence the window is still open,
 * not evidence of a clock error. Requiring `lastWrite < end` instead stops the
 * chain dead at the first extension, which was the first version of this and
 * was wrong.
 *
 * Bounded by the cap, so at most four iterations. No write, no extension.
 */
function extendFromMidnight(dayEnd, lastWriteAt, lookbackMs, capHour) {
  const cap = capOn(dayEnd, capHour);
  const lw = lastWriteAt ? new Date(lastWriteAt).getTime() : 0;
  if (!lw) return dayEnd;

  let end = new Date(dayEnd);
  while (end.getTime() < cap.getTime() && lw >= end.getTime() - lookbackMs) {
    end = new Date(end.getTime() + EXTENSION_HOURS * HOUR);
  }
  return end.getTime() > cap.getTime() ? cap : end;
}

function options(opts = {}) {
  const lookbackMinutes = Number(opts.lookbackMinutes);
  const capHour = Number(opts.capHour);
  return {
    lookbackMs: (Number.isFinite(lookbackMinutes) && lookbackMinutes >= 0
      ? lookbackMinutes : LOOKBACK_MINUTES) * MINUTE,
    capHour: Number.isFinite(capHour) && capHour >= 0 && capHour <= 12
      ? capHour : HARD_CAP_HOUR,
  };
}

/**
 * The moment the writing day containing `now` ends — the countdown's target.
 *
 * Local time throughout, deliberately. A writer's day is the one their clock
 * shows; converting to UTC would move the deadline by an hour twice a year for
 * no reason they could see.
 *
 * @param {Date|number} now
 * @param {Date|number|null} lastWriteAt the most recent writing activity
 */
export function windowEnd(now = new Date(), lastWriteAt = null, opts = {}) {
  const { lookbackMs, capHour } = options(opts);
  const n = new Date(now);

  // Only the small hours can still belong to yesterday. Without this guard, an
  // evening write sits far past the previous midnight and reads as evidence
  // that yesterday's window is still open — which would keep every writing day
  // permanently one day behind.
  if (n.getTime() < capOn(n, capHour).getTime()) {
    const yesterdayEnd = extendFromMidnight(midnightOf(n), lastWriteAt, lookbackMs, capHour);
    if (n.getTime() < yesterdayEnd.getTime()) return yesterdayEnd;
  }

  return extendFromMidnight(nextMidnightAfter(n), lastWriteAt, lookbackMs, capHour);
}

/**
 * Which writing day a moment belongs to, as "yyyy-mm-dd" — the same key the
 * streak log is already indexed by.
 *
 * A moment inside an extension belongs to the day that earned it, which is the
 * day before the one the calendar is showing.
 */
export function writingDayKey(now = new Date(), lastWriteAt = null, opts = {}) {
  const n = new Date(now);
  const end = windowEnd(n, lastWriteAt, opts);
  // Work back from the DEADLINE, not from `now`, so an extension carries its
  // date with it: the window ending at 01:00 on Tuesday is Monday's, and so is
  // the one ending at 00:00 on Tuesday.
  //
  // Strip the extension first. An end at 01:00 rewinds to that morning's
  // midnight; an end already at midnight is its own base. One millisecond
  // before that midnight is the day the window belonged to.
  const base = end.getHours() === 0 ? new Date(end) : midnightOf(end);
  return ymd(new Date(base.getTime() - 1));
}

/** Milliseconds left in the current writing day. Never negative. */
export function msRemaining(now = new Date(), lastWriteAt = null, opts = {}) {
  return Math.max(0, windowEnd(now, lastWriteAt, opts).getTime() - new Date(now).getTime());
}

/**
 * True when the clock has passed midnight and an extension is holding the day
 * open. Worth naming: it is the one state where the countdown and the calendar
 * disagree, and a widget saying "58:12 left" on a date that is already tomorrow
 * needs to be able to explain itself.
 */
export function inExtension(now = new Date(), lastWriteAt = null, opts = {}) {
  const n = new Date(now);
  const { capHour } = options(opts);
  if (n.getTime() >= capOn(n, capHour).getTime()) return false;
  return n.getTime() < windowEnd(n, lastWriteAt, opts).getTime()
      && windowEnd(n, lastWriteAt, opts).getTime() > midnightOf(n).getTime();
}

/**
 * How many hours past midnight the deadline sits. 0 normally.
 *
 * Exposed so a surface can say "extended" honestly rather than inferring it.
 * Counted on the wall clock, not in elapsed time — see below for why those
 * differ, and for the night this got wrong.
 */
export function extensionHours(now = new Date(), lastWriteAt = null, opts = {}) {
  const end = windowEnd(now, lastWriteAt, opts);
  // The deadline's LOCAL hour is the extension, because midnight is where the
  // count starts and both are wall-clock facts.
  //
  // This used to subtract timestamps and divide by an hour, which measures
  // REAL hours instead — and on the two days a year that are 23 or 25 hours
  // long the two are different numbers. On a fall-back night, local midnight
  // to 04:00 really is five hours, because 1am happens twice, so a cap of four
  // reported five. On a spring-forward night the same sum reported three.
  // Neither is what a writer looking at their clock would say.
  return end.getHours();
}

/**
 * "3h 12m" while it is far off, "9:05" once it is close, "9s" at the end.
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
 */
export function countdownState({
  now = new Date(),
  lastWriteAt = null,
  wordsToday = 0,
  goalWords = 0,
  lookbackMinutes,
  capHour,
} = {}) {
  const opts = { lookbackMinutes, capHour };
  const at = new Date(now);
  const end = windowEnd(at, lastWriteAt, opts);
  const msLeft = Math.max(0, end.getTime() - at.getTime());
  const met = goalWords > 0 && wordsToday >= goalWords;
  const extended = extensionHours(at, lastWriteAt, opts);
  return {
    deadline: end.getTime(),
    msLeft,
    label: formatRemaining(msLeft),
    dayKey: writingDayKey(at, lastWriteAt, opts),
    extended,
    inExtension: extended > 0 && at.getTime() >= midnightOf(at).getTime()
      && at.getHours() < HARD_CAP_HOUR,
    // Under an hour, and only when there is still something to do. An urgent
    // countdown on a day already finished is a manufactured emergency, which
    // is exactly what this project's reminders refuse elsewhere.
    urgent: msLeft <= HOUR && !met,
    met,
  };
}
