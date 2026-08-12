import {
  streaksEnabledGlobally,
  bookStreakPreference,
  streaksEnabledFor,
  withBookStreakPreference,
  booksWithStreaks,
  reminderConfig,
  shouldScheduleReminder,
  formatReminderTime,
  parseReminderTime,
  DEFAULT_REMINDER,
} from './streakSettings';

const book = (over = {}) => ({ id: 'b1', title: 'A Book', type: 'book', ...over });

describe('the global switch', () => {
  test('streaks are on when nothing has been set', () => {
    expect(streaksEnabledGlobally({})).toBe(true);
    expect(streaksEnabledGlobally(undefined)).toBe(true);
    expect(streaksEnabledFor(book(), {})).toBe(true);
  });

  test('off globally means off for every book', () => {
    const s = { streakEnabled: false };
    expect(streaksEnabledFor(book(), s)).toBe(false);
    expect(streaksEnabledFor(book({ streak: { streakEnabled: true } }), s)).toBe(false);
  });
});

describe('the per-book switch', () => {
  test('one book can opt out while the rest keep counting', () => {
    const settings = {};
    const off = book({ id: 'off', streak: { streakEnabled: false } });
    expect(streaksEnabledFor(off, settings)).toBe(false);
    expect(streaksEnabledFor(book(), settings)).toBe(true);
  });

  /**
   * "Follow the global" is a third state, not a synonym for `true`. A book
   * that has never been touched must start counting again when the writer
   * turns streaks back on globally — a stored `true` would look identical
   * today and diverge the moment the global changes.
   */
  test('no opinion is distinct from an explicit yes', () => {
    expect(bookStreakPreference(book())).toBeNull();
    expect(bookStreakPreference(book({ streak: {} }))).toBeNull();
    expect(bookStreakPreference(book({ streak: { streakEnabled: true } }))).toBe(true);
    expect(bookStreakPreference(book({ streak: { streakEnabled: false } }))).toBe(false);
  });

  test('junk in the stored flag reads as no opinion', () => {
    expect(bookStreakPreference(book({ streak: { streakEnabled: 'yes' } }))).toBeNull();
    expect(bookStreakPreference(book({ streak: { streakEnabled: 1 } }))).toBeNull();
  });
});

describe('writing the per-book flag', () => {
  test('keeps everything else in the streak object', () => {
    const b = book({ streak: { goalWords: 800, log: { '2026-08-01': { words: 5, goal: 800 } } } });
    const out = withBookStreakPreference(b, false);
    expect(out.streakEnabled).toBe(false);
    expect(out.goalWords).toBe(800);
    expect(out.log).toEqual(b.streak.log);
  });

  /**
   * Back to "follow global" removes the key. Writing `true` would freeze the
   * book at today's global value forever.
   */
  test('null removes the key rather than writing true', () => {
    const b = book({ streak: { streakEnabled: false, goalWords: 300 } });
    const out = withBookStreakPreference(b, null);
    expect('streakEnabled' in out).toBe(false);
    expect(out.goalWords).toBe(300);
  });

  test('does not mutate the book it was given', () => {
    const b = book({ streak: { goalWords: 300 } });
    withBookStreakPreference(b, false);
    expect(b.streak).toEqual({ goalWords: 300 });
  });

  test('survives a book with no streak object at all', () => {
    expect(withBookStreakPreference(book(), true)).toEqual({ streakEnabled: true });
    expect(withBookStreakPreference(undefined, true)).toEqual({ streakEnabled: true });
  });
});

describe('which books are still counting', () => {
  const sessions = [
    book({ id: 'a' }),
    book({ id: 'b', streak: { streakEnabled: false } }),
    book({ id: 'c', streak: { streakEnabled: true } }),
    { id: 'sb', type: 'storyboard' },
  ];

  test('excludes opted-out books and storyboards', () => {
    expect(booksWithStreaks(sessions, {}).map((s) => s.id)).toEqual(['a', 'c']);
  });

  test('is empty when the global switch is off', () => {
    expect(booksWithStreaks(sessions, { streakEnabled: false })).toEqual([]);
  });

  test('survives a malformed session list', () => {
    expect(() => booksWithStreaks([null, undefined, {}], {})).not.toThrow();
    expect(booksWithStreaks(null, {})).toEqual([]);
  });
});

describe('the reminder config', () => {
  test('is off until asked for', () => {
    expect(reminderConfig({}).enabled).toBe(false);
    expect(reminderConfig(undefined)).toEqual(DEFAULT_REMINDER);
  });

  test('clamps a time that could not exist', () => {
    expect(reminderConfig({ streakReminder: { hour: 99, minute: -5 } }))
      .toMatchObject({ hour: 23, minute: 0 });
    expect(reminderConfig({ streakReminder: { hour: 'nine' } }))
      .toMatchObject({ hour: DEFAULT_REMINDER.hour });
  });

  test('skipWhenMet defaults on and can be turned off', () => {
    expect(reminderConfig({ streakReminder: {} }).skipWhenMet).toBe(true);
    expect(reminderConfig({ streakReminder: { skipWhenMet: false } }).skipWhenMet).toBe(false);
  });
});

describe('whether to schedule at all', () => {
  const on = { streakReminder: { enabled: true } };

  test('needs the reminder switched on', () => {
    expect(shouldScheduleReminder([book()], {})).toBe(false);
    expect(shouldScheduleReminder([book()], on)).toBe(true);
  });

  /**
   * Turning streaks off globally has to cancel the alarm. A phone that keeps
   * buzzing about a feature the writer just switched off reads as the app
   * being broken, not as a second setting they missed.
   */
  test('turning streaks off globally stops the reminder', () => {
    expect(shouldScheduleReminder([book()], { ...on, streakEnabled: false })).toBe(false);
  });

  test('stops when the last counting book opts out', () => {
    const only = [book({ streak: { streakEnabled: false } })];
    expect(shouldScheduleReminder(only, on)).toBe(false);
  });

  test('stops when there are no books', () => {
    expect(shouldScheduleReminder([], on)).toBe(false);
  });
});

describe('reminder time text', () => {
  test('pads to a 24-hour clock', () => {
    expect(formatReminderTime({ hour: 20, minute: 0 })).toBe('20:00');
    expect(formatReminderTime({ hour: 7, minute: 5 })).toBe('07:05');
    expect(formatReminderTime({ hour: 0, minute: 0 })).toBe('00:00');
  });

  test('round-trips', () => {
    ['00:00', '07:05', '20:00', '23:59'].forEach((t) => {
      expect(formatReminderTime(parseReminderTime(t))).toBe(t);
    });
  });

  test('refuses a time that could not exist rather than guessing', () => {
    expect(parseReminderTime('24:00')).toBeNull();
    expect(parseReminderTime('12:60')).toBeNull();
    expect(parseReminderTime('8pm')).toBeNull();
    expect(parseReminderTime('')).toBeNull();
    expect(parseReminderTime(null)).toBeNull();
  });

  test('accepts what an <input type=time> actually sends', () => {
    expect(parseReminderTime('08:30')).toEqual({ hour: 8, minute: 30 });
    expect(parseReminderTime('8:30')).toEqual({ hour: 8, minute: 30 });
  });
});
