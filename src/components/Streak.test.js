/**
 * The two exported pure pieces of the streak: which day is being counted, and
 * how many days in a row have been.
 *
 * These matter more than they look. getTodayKey is the key the log, the
 * baseline, the calendar's highlight and the reminder all index by, so getting
 * it wrong does not show up as a wrong number in one place — it shows up as
 * today's words landing on a day nobody is looking at.
 */

import { getTodayKey, computeStreak, bookStreakStats } from './Streak';
import { markWrote, clearWriteClock } from '../utils/writeClock';

/** Freeze the wall clock. Everything here depends on what time it is. */
function at(iso, fn) {
  const fixed = new Date(iso).getTime();
  const RealDate = Date;
  const spy = jest.spyOn(global, 'Date').mockImplementation((...args) => (
    args.length ? new RealDate(...args) : new RealDate(fixed)
  ));
  global.Date.now = () => fixed;
  try { return fn(); } finally { spy.mockRestore(); }
}

const met = (words = 500, goal = 500) => ({ words, goal });

beforeEach(() => { localStorage.clear(); clearWriteClock(); });

describe('which day is being counted', () => {
  test('during the day it is simply today', () => {
    at('2026-08-14T14:30:00', () => expect(getTodayKey()).toBe('2026-08-14'));
    at('2026-08-14T23:10:00', () => expect(getTodayKey()).toBe('2026-08-14'));
  });

  test('after midnight, with nobody writing, it is the new day', () => {
    at('2026-08-15T00:30:00', () => expect(getTodayKey()).toBe('2026-08-15'));
    at('2026-08-15T03:59:00', () => expect(getTodayKey()).toBe('2026-08-15'));
  });

  test('a session still running at midnight keeps counting for the night before', () => {
    at('2026-08-14T23:50:00', () => markWrote());
    at('2026-08-15T00:30:00', () => expect(getTodayKey()).toBe('2026-08-14'));
  });

  test('the extension follows the writing rather than the clock', () => {
    at('2026-08-14T23:50:00', () => markWrote());
    // 01:00 is where a single extension ends. Nothing more was written, so the
    // night is over and the calendar wins.
    at('2026-08-15T01:30:00', () => expect(getTodayKey()).toBe('2026-08-15'));

    at('2026-08-15T00:45:00', () => markWrote());
    at('2026-08-15T01:30:00', () => expect(getTodayKey()).toBe('2026-08-14'));
  });

  test('4am is the end of it however long the session has run', () => {
    at('2026-08-15T03:50:00', () => markWrote());
    at('2026-08-15T04:05:00', () => expect(getTodayKey()).toBe('2026-08-15'));
  });

  test('an evening write does not reopen the morning', () => {
    // The trap: a write at 20:00 sits far past that day's midnight, and a rule
    // that only asked "was there a write?" would read it as evidence yesterday
    // is still open and leave every day permanently one behind.
    at('2026-08-14T20:00:00', () => markWrote());
    at('2026-08-14T20:05:00', () => expect(getTodayKey()).toBe('2026-08-14'));
  });
});

describe('counting the days in a row', () => {
  test('an unbroken run ending today', () => {
    at('2026-08-14T12:00:00', () => {
      expect(computeStreak({
        '2026-08-12': met(), '2026-08-13': met(), '2026-08-14': met(),
      })).toBe(3);
    });
  });

  test('today not written yet does not break yesterday', () => {
    at('2026-08-14T09:00:00', () => {
      expect(computeStreak({
        '2026-08-12': met(), '2026-08-13': met(), '2026-08-14': met(10, 500),
      })).toBe(2);
    });
  });

  test('a gap ends the run', () => {
    at('2026-08-14T12:00:00', () => {
      expect(computeStreak({
        '2026-08-10': met(), '2026-08-12': met(), '2026-08-13': met(),
      })).toBe(2);
    });
  });

  /**
   * The regression this exists for: the walk used to start from the date on
   * the clock. At 00:30 inside an extension that is tomorrow, which has no
   * entry, so a run somebody was in the middle of extending read as zero.
   */
  test('a run being extended past midnight still counts', () => {
    at('2026-08-14T23:55:00', () => markWrote());
    at('2026-08-15T00:30:00', () => {
      expect(computeStreak({
        '2026-08-12': met(), '2026-08-13': met(), '2026-08-14': met(),
      })).toBe(3);
    });
  });

  test('an empty or missing log is zero, not a crash', () => {
    expect(computeStreak(null)).toBe(0);
    expect(computeStreak({})).toBe(0);
  });

  test('the older bare-number log shape still counts', () => {
    // Entries used to be a plain word count. normalizeLog upgrades them before
    // this sees them, so a raw log of numbers reads as unmet rather than
    // throwing — which is the safe direction.
    at('2026-08-14T12:00:00', () => {
      expect(() => computeStreak({ '2026-08-14': 900 })).not.toThrow();
    });
  });
});

/**
 * What anything outside FlameButton has to call to say a number out loud.
 *
 * The bug this replaced: `book.streak.current` and `book.streak.wordsToday`
 * read as 0 forever, because a session's streak object holds `log`,
 * `dailyBaseline` and `goalWords` and has never held either of those. A zero
 * that looks like an answer is worse than a crash — the test notification
 * announced a first day to somebody fifty days in, and nothing looked broken.
 */
describe('a book\'s streak, read from outside', () => {
  const withLog = (log, over = {}) => ({ id: 'b1', title: 'A Book', streak: { goalWords: 500, log, ...over } });

  test('reports the run, today\'s words and the goal', () => {
    at('2026-08-14T12:00:00', () => {
      const s = bookStreakStats(withLog({
        '2026-08-12': { words: 600, goal: 500 },
        '2026-08-13': { words: 500, goal: 500 },
        '2026-08-14': { words: 120, goal: 500 },
      }));
      expect(s.streakDays).toBe(2);
      expect(s.wordsToday).toBe(120);
      expect(s.goalWords).toBe(500);
      expect(s.dayKey).toBe('2026-08-14');
    });
  });

  test('a book with no streak data at all is zeroes, not a crash', () => {
    expect(() => bookStreakStats(null)).not.toThrow();
    expect(bookStreakStats(null)).toMatchObject({ streakDays: 0, wordsToday: 0 });
    expect(bookStreakStats({ id: 'b1' }, 300)).toMatchObject({ streakDays: 0, goalWords: 300 });
  });

  test('the book\'s own goal beats the global fallback', () => {
    at('2026-08-14T12:00:00', () => {
      expect(bookStreakStats(withLog({}), 300).goalWords).toBe(500);
      expect(bookStreakStats({ id: 'b1', streak: {} }, 300).goalWords).toBe(300);
    });
  });

  test('the older bare-number log is normalised before it is counted', () => {
    at('2026-08-14T12:00:00', () => {
      const s = bookStreakStats(withLog({ '2026-08-13': 900, '2026-08-14': 700 }));
      expect(s.wordsToday).toBe(700);
      expect(s.streakDays).toBe(2);
    });
  });

  test('inside an extension it reports the night before, not an empty new day', () => {
    at('2026-08-14T23:50:00', () => markWrote());
    at('2026-08-15T00:30:00', () => {
      const s = bookStreakStats(withLog({ '2026-08-14': { words: 800, goal: 500 } }));
      expect(s.dayKey).toBe('2026-08-14');
      expect(s.wordsToday).toBe(800);
      expect(s.streakDays).toBe(1);
    });
  });
});
