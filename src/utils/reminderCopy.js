/**
 * reminderCopy.js — the words on a writing reminder.
 *
 * One file, so the wording can be changed without touching scheduling,
 * permissions, or any platform's notification API. Nothing here imports
 * anything: it is a pure function from a description of your day to a title
 * and a body, which means every line below can be read on a screen in a test
 * rather than waited for on a lock screen at 8pm.
 *
 * ── On taking inspiration from Duolingo ──────────────────────────────────────
 *
 * What is worth borrowing is the *structure*: many lines rather than one, so
 * the notification does not become wallpaper; the numbers that are actually
 * yours (your streak, your goal, the book you were in) rather than a generic
 * nudge; and a different message in the morning from the one in the evening,
 * because those are different moments.
 *
 * What is not worth borrowing is the tone. Duolingo's reminders are famous for
 * escalating — passive aggression, mock sadness, guilt. That works on a game
 * with a mascot. This arrives on the lock screen of somebody writing a novel,
 * and the existing rule in ReminderText.java is the right one:
 *
 *     it says what is true and stops: no guilt, no exclamation marks, no
 *     implication that a missed day undoes anything.
 *
 * So: variety and personalisation, yes. Manipulation, no. A missed day is a
 * missed day; the app does not have feelings about it.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 *
 * Selection is seeded on the date and the slot, never on Math.random(). Two
 * reasons. A notification that is re-rendered (a redraw, a retry, a test tap)
 * must not change its words underneath the reader. And a test that cannot
 * predict the output cannot assert anything about it.
 */

// ── Tokens ───────────────────────────────────────────────────────────────────

/**
 * Fill {tokens} from the context. An unknown token is left alone rather than
 * replaced with "undefined" — a line that reads oddly is a bug to notice, and
 * a line reading "Write undefined words" is one to be ashamed of.
 */
export function fillTokens(template, ctx = {}) {
  const values = {
    streak:    group(ctx.streakDays ?? 0),
    goal:      plural(ctx.goalWords ?? 0, 'word'),
    goalNum:   group(ctx.goalWords ?? 0),
    words:     plural(ctx.wordsToday ?? 0, 'word'),
    wordsNum:  group(ctx.wordsToday ?? 0),
    remaining: plural(Math.max(0, (ctx.goalWords ?? 0) - (ctx.wordsToday ?? 0)), 'word'),
    book:      (ctx.bookTitle || '').trim() || 'your book',
    days:      plural(ctx.daysAway ?? 0, 'day'),
  };
  return String(template ?? '').replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole);
}

/** "1,204 words" / "1 word" — pluralised and grouped. */
export function plural(n, noun) {
  return `${group(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * 1,204. Deliberately not toLocaleString: this string is written once and read
 * on a lock screen that may be in a different locale from the one the number
 * was formatted in, and the native side groups the same way.
 */
export function group(n) {
  const v = Math.trunc(Number(n) || 0);
  const s = Math.abs(v).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (v < 0 ? '-' : '') + out;
}

// ── The lines ────────────────────────────────────────────────────────────────
//
// Grouped by the situation they belong to. Each group has several so the same
// words do not arrive every day; the seed picks one.
//
// Every body names something actionable — a number of words, a book — because
// "keep it going" is not a decision anybody can act on in the two seconds they
// spend looking at a notification.

const LINES = {
  /** No streak yet, and nothing written today. The first nudge anyone sees. */
  start: {
    morning: [
      ['Time to write', 'Your goal is {goal} today.'],
      ['A blank page', '{goal} is all it takes to start a streak.'],
      ['Today’s goal', '{goal}, whenever it suits you.'],
    ],
    evening: [
      ['Still time', '{goal} today, if you want it.'],
      ['Time to write', 'The day is not over. {goal}.'],
      ['Your goal', '{goal} — the evening is usually quieter.'],
    ],
  },

  /** A streak is running and today is not written yet. */
  keep: {
    morning: [
      ['{streak} days so far', 'Write {goal} to keep the run going.'],
      ['Day {streak}', '{goal} in {book}.'],
      ['{streak} days so far', '{book} is where you left it. {goal} today.'],
    ],
    evening: [
      ['{streak} days so far', '{goal} left to keep today counted.'],
      ['Day {streak}', 'Still time for {goal}.'],
      ['{streak} days so far', '{book}, {goal}, and the day is yours.'],
    ],
  },

  /** Started today but not yet at the goal — the most useful reminder there is. */
  partway: {
    morning: [
      ['{wordsNum} down', '{remaining} to go in {book}.'],
      ['Underway', '{words} so far today. {remaining} to the goal.'],
    ],
    evening: [
      ['{remaining} to go', 'You are at {words} today.'],
      ['Almost', '{remaining} left in {book}.'],
    ],
  },

  /**
   * The goal is already met. Only sent when the writer has asked to hear from
   * us anyway — the default is silence, and silence is the better default.
   */
  met: {
    morning: [
      ['Goal met', '{words} today. Anything more is yours.'],
      ['Done for today', '{words} in {book}.'],
    ],
    evening: [
      ['Day {streak} counted', '{words} today.'],
      ['Goal met', '{words}, and {streak} days behind it.'],
    ],
  },

  /**
   * A streak that ended. This is where a guilt-based app would push hardest,
   * and where this one says least: the number is stated, the door is open, and
   * nothing implies the previous run was wasted.
   */
  comeback: {
    morning: [
      ['{book} is still here', 'Whenever you want it. {goal} starts a new run.'],
      ['Back when you are', '{goal} today, if today is the day.'],
    ],
    evening: [
      ['{book} is still here', 'No streak to protect. {goal} whenever.'],
      ['Still here', '{goal} starts a new run.'],
    ],
  },
};

/**
 * Milestones get their own line, because "7 days so far" on the seventh day is
 * the one time the number is the message. Checked before the seeded pick so a
 * milestone is never missed to variety.
 */
const MILESTONES = {
  7:    ['A week', 'Seven days of {book}. {goal} today.'],
  30:   ['A month', 'Thirty days. {goal} today.'],
  100:  ['100 days', 'A hundred days of showing up. {goal} today.'],
  365:  ['A year', '365 days. {goal} today.'],
};

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * A small stable hash. Same day and slot in, same index out — see the note on
 * determinism at the top.
 */
function seedIndex(dayKey, slot, length) {
  if (length <= 0) return 0;
  const s = `${dayKey}:${slot}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % length;
}

/** Which of the two daily slots a time belongs to. Noon is the divide. */
export function slotFor(hour) {
  const h = Number(hour);
  return Number.isFinite(h) && h >= 12 ? 'evening' : 'morning';
}

/**
 * Which set of lines the day calls for.
 *
 * Order matters: met beats partway beats keep, and a broken streak is only
 * "comeback" if there was something to break.
 */
export function situationFor(ctx = {}) {
  const streak = Math.max(0, Number(ctx.streakDays) || 0);
  const words = Math.max(0, Number(ctx.wordsToday) || 0);
  const goal = Math.max(0, Number(ctx.goalWords) || 0);

  if (ctx.metToday || (goal > 0 && words >= goal)) return 'met';
  if (words > 0 && goal > 0) return 'partway';
  if (streak > 0) return 'keep';
  if ((Number(ctx.daysAway) || 0) > 0) return 'comeback';
  return 'start';
}

/**
 * The reminder for a given day.
 *
 * @param {object} ctx
 * @param {number} ctx.streakDays  live streak, 0 if none
 * @param {number} ctx.goalWords   the daily goal
 * @param {number} ctx.wordsToday  written so far today
 * @param {string} ctx.bookTitle   the book the streak belongs to
 * @param {boolean} ctx.metToday   goal already reached
 * @param {number} ctx.daysAway    days since the last writing day
 * @param {number} ctx.hour        the hour this reminder fires at
 * @param {string} ctx.dayKey      "yyyy-mm-dd", the variety seed
 * @returns {{ title: string, body: string, situation: string, slot: string }}
 */
export function buildReminder(ctx = {}) {
  const slot = ctx.slot === 'morning' || ctx.slot === 'evening'
    ? ctx.slot
    : slotFor(ctx.hour ?? 9);
  const situation = situationFor(ctx);
  const streak = Math.max(0, Number(ctx.streakDays) || 0);

  // A milestone outranks variety — see MILESTONES.
  const pair = (situation === 'keep' && MILESTONES[streak])
    ? MILESTONES[streak]
    : pickLine(situation, slot, ctx.dayKey);

  return {
    title: fillTokens(pair[0], ctx),
    body: fillTokens(pair[1], ctx),
    situation,
    slot,
  };
}

function pickLine(situation, slot, dayKey) {
  const group_ = LINES[situation] || LINES.start;
  const list = group_[slot] || group_.morning;
  if (!list || !list.length) return LINES.start.morning[0];
  return list[seedIndex(String(dayKey ?? ''), slot, list.length)];
}

/**
 * Every line, for a settings preview or a test that wants to check them all
 * render without a stray token. Exported so nothing has to reach into LINES.
 */
export function allLines() {
  const out = [];
  for (const [situation, slots] of Object.entries(LINES)) {
    for (const [slot, list] of Object.entries(slots)) {
      for (const [title, body] of list) out.push({ situation, slot, title, body });
    }
  }
  for (const [days, [title, body]] of Object.entries(MILESTONES)) {
    out.push({ situation: 'milestone', slot: 'any', days: Number(days), title, body });
  }
  return out;
}
