import {
  writingDayKey, windowEnd, msRemaining, inGraceWindow, formatRemaining,
  countdownState, clampGrace, DEFAULT_GRACE_HOURS, MAX_GRACE_HOURS,
} from './streakWindow';

/** Local time on purpose — the whole module works in the writer's clock. */
const at = (y, mo, d, h, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);
const HOUR = 3600000;

describe('the grace setting', () => {
  test('clamps to something a day can survive', () => {
    expect(clampGrace(4)).toBe(4);
    expect(clampGrace(0)).toBe(0);
    expect(clampGrace(-3)).toBe(0);
    expect(clampGrace(99)).toBe(MAX_GRACE_HOURS);
    expect(clampGrace(2.7)).toBe(2);
  });

  test('junk falls back to the default rather than to zero', () => {
    // Zero would silently remove the feature; the default is the safer guess.
    expect(clampGrace(null)).toBe(DEFAULT_GRACE_HOURS);
    expect(clampGrace('x')).toBe(DEFAULT_GRACE_HOURS);
    expect(clampGrace(undefined)).toBe(DEFAULT_GRACE_HOURS);
  });
});

describe('which day a moment belongs to', () => {
  /** The point of the whole module. */
  test('01:00 on Tuesday still counts for Monday', () => {
    expect(writingDayKey(at(2026, 8, 11, 1, 0), 4)).toBe('2026-08-10');
  });

  test('and so does 03:59', () => {
    expect(writingDayKey(at(2026, 8, 11, 3, 59), 4)).toBe('2026-08-10');
  });

  test('04:00 is a new day', () => {
    expect(writingDayKey(at(2026, 8, 11, 4, 0), 4)).toBe('2026-08-11');
  });

  test('the evening is unremarkable', () => {
    expect(writingDayKey(at(2026, 8, 11, 23, 30), 4)).toBe('2026-08-11');
    expect(writingDayKey(at(2026, 8, 11, 12, 0), 4)).toBe('2026-08-11');
  });

  test('a grace of zero is plain midnight', () => {
    expect(writingDayKey(at(2026, 8, 11, 0, 30), 0)).toBe('2026-08-11');
  });

  test('crossing a month, and a year', () => {
    expect(writingDayKey(at(2026, 9, 1, 2, 0), 4)).toBe('2026-08-31');
    expect(writingDayKey(at(2026, 1, 1, 2, 0), 4)).toBe('2025-12-31');
  });
});

describe('when the window closes', () => {
  test('an evening counts down to tomorrow morning', () => {
    const end = windowEnd(at(2026, 8, 11, 21, 0), 4);
    expect(end.getDate()).toBe(12);
    expect(end.getHours()).toBe(4);
  });

  test('the borrowed hours count down to this morning', () => {
    const end = windowEnd(at(2026, 8, 12, 1, 0), 4);
    expect(end.getDate()).toBe(12);
    expect(end.getHours()).toBe(4);
  });

  test('exactly on the boundary rolls to the next day rather than showing zero', () => {
    // A countdown that reads 0:00 for a whole second is a broken clock.
    const end = windowEnd(at(2026, 8, 12, 4, 0), 4);
    expect(end.getDate()).toBe(13);
  });

  test('remaining is never negative and shrinks as the evening goes on', () => {
    const early = msRemaining(at(2026, 8, 11, 18, 0), 4);
    const late = msRemaining(at(2026, 8, 11, 23, 0), 4);
    expect(late).toBeLessThan(early);
    expect(msRemaining(at(2026, 8, 11, 3, 59, 59), 4)).toBeGreaterThan(0);
  });

  test('a whole writing day is 24 hours long, wherever it starts', () => {
    const justAfter = msRemaining(at(2026, 8, 11, 4, 0, 1), 4);
    expect(justAfter).toBeGreaterThan(23 * HOUR);
    expect(justAfter).toBeLessThanOrEqual(24 * HOUR);
  });
});

describe('the borrowed hours', () => {
  test('are the ones before the grace hour', () => {
    expect(inGraceWindow(at(2026, 8, 12, 0, 30), 4)).toBe(true);
    expect(inGraceWindow(at(2026, 8, 12, 3, 59), 4)).toBe(true);
    expect(inGraceWindow(at(2026, 8, 12, 4, 0), 4)).toBe(false);
    expect(inGraceWindow(at(2026, 8, 12, 22, 0), 4)).toBe(false);
  });

  test('do not exist when the grace is off', () => {
    expect(inGraceWindow(at(2026, 8, 12, 0, 30), 0)).toBe(false);
  });
});

describe('how it reads', () => {
  test('hours and minutes while there is time', () => {
    expect(formatRemaining(3 * HOUR + 12 * 60000)).toBe('3h 12m');
    expect(formatRemaining(HOUR)).toBe('1h 00m');
  });

  test('minutes and seconds once it matters', () => {
    expect(formatRemaining(9 * 60000 + 5000)).toBe('9:05');
    expect(formatRemaining(59 * 60000)).toBe('59:00');
  });

  test('seconds at the very end', () => {
    expect(formatRemaining(9000)).toBe('9s');
    expect(formatRemaining(0)).toBe('0s');
  });

  test('junk reads as nothing left rather than NaN', () => {
    expect(formatRemaining(null)).toBe('0s');
    expect(formatRemaining(-500)).toBe('0s');
    expect(formatRemaining('x')).toBe('0s');
  });
});

describe('the state a countdown surface needs', () => {
  const base = { now: at(2026, 8, 11, 21, 0), graceHours: 4, goalWords: 300 };

  test('carries a deadline the widget can hand to a system clock', () => {
    const s = countdownState(base);
    expect(typeof s.deadline).toBe('number');
    expect(s.deadline).toBeGreaterThan(base.now.getTime());
    expect(s.label).toMatch(/h |:|s/);
  });

  test('urgent under the last hour', () => {
    expect(countdownState({ ...base, now: at(2026, 8, 12, 3, 30) }).urgent).toBe(true);
    expect(countdownState({ ...base, now: at(2026, 8, 11, 20, 0) }).urgent).toBe(false);
  });

  /**
   * A countdown that goes urgent on a day already finished is a manufactured
   * emergency — the same manipulation the reminder copy refuses elsewhere.
   */
  test('never urgent once the goal is met', () => {
    const s = countdownState({ ...base, now: at(2026, 8, 12, 3, 30), wordsToday: 500 });
    expect(s.met).toBe(true);
    expect(s.urgent).toBe(false);
  });

  test('met needs a goal to be met against', () => {
    expect(countdownState({ ...base, goalWords: 0, wordsToday: 900 }).met).toBe(false);
  });

  test('reports the borrowed hours so a widget can explain the date', () => {
    expect(countdownState({ ...base, now: at(2026, 8, 12, 1, 0) }).inGrace).toBe(true);
    expect(countdownState({ ...base, now: at(2026, 8, 12, 1, 0) }).dayKey).toBe('2026-08-11');
  });

  test('called with nothing at all, it still answers', () => {
    const s = countdownState();
    expect(typeof s.deadline).toBe('number');
    expect(s.msLeft).toBeGreaterThanOrEqual(0);
    expect(typeof s.label).toBe('string');
    expect(s.met).toBe(false);
  });
});
