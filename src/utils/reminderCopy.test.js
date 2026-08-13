import {
  buildReminder, fillTokens, situationFor, slotFor, allLines, plural, group,
} from './reminderCopy';

const ctx = (over = {}) => ({
  streakDays: 0, goalWords: 300, wordsToday: 0,
  bookTitle: 'The Long Novel', metToday: false, daysAway: 0,
  hour: 9, dayKey: '2026-08-13', ...over,
});

describe('tokens', () => {
  test('fills the ones it knows', () => {
    expect(fillTokens('{streak} days, {goal}, {book}', ctx({ streakDays: 12 })))
      .toBe('12 days, 300 words, The Long Novel');
  });

  /** A line reading "Write undefined words" is worse than one reading oddly. */
  test('leaves an unknown token alone rather than writing undefined', () => {
    expect(fillTokens('a {nope} b', ctx())).toBe('a {nope} b');
  });

  test('an untitled book still reads as a sentence', () => {
    expect(fillTokens('{book}', ctx({ bookTitle: '' }))).toBe('your book');
    expect(fillTokens('{book}', ctx({ bookTitle: '   ' }))).toBe('your book');
    expect(fillTokens('{book}', ctx({ bookTitle: null }))).toBe('your book');
  });

  test('remaining never goes negative', () => {
    expect(fillTokens('{remaining}', ctx({ goalWords: 300, wordsToday: 900 })))
      .toBe('0 words');
  });

  test('singular and plural', () => {
    expect(plural(1, 'word')).toBe('1 word');
    expect(plural(0, 'word')).toBe('0 words');
    expect(plural(2, 'day')).toBe('2 days');
  });

  test('grouping matches the native formatter, and survives junk', () => {
    expect(group(1204)).toBe('1,204');
    expect(group(999)).toBe('999');
    expect(group(1000000)).toBe('1,000,000');
    expect(group(-1204)).toBe('-1,204');
    expect(group(null)).toBe('0');
    expect(group(NaN)).toBe('0');
    expect(group('1204')).toBe('1,204');
  });
});

describe('which situation the day is in', () => {
  test('nothing yet, no streak', () => {
    expect(situationFor(ctx())).toBe('start');
  });

  test('a live streak, nothing written today', () => {
    expect(situationFor(ctx({ streakDays: 4 }))).toBe('keep');
  });

  test('started but short of the goal', () => {
    expect(situationFor(ctx({ streakDays: 4, wordsToday: 120 }))).toBe('partway');
  });

  test('goal reached, by count or by report', () => {
    expect(situationFor(ctx({ wordsToday: 300, goalWords: 300 }))).toBe('met');
    expect(situationFor(ctx({ wordsToday: 900, goalWords: 300 }))).toBe('met');
    expect(situationFor(ctx({ metToday: true }))).toBe('met');
  });

  test('a broken streak with time away is a comeback, not a cold start', () => {
    expect(situationFor(ctx({ streakDays: 0, daysAway: 5 }))).toBe('comeback');
  });

  test('nonsense input still lands somewhere sane', () => {
    expect(situationFor({})).toBe('start');
    expect(situationFor({ streakDays: -3, wordsToday: -9, goalWords: -1 })).toBe('start');
    expect(situationFor(undefined)).toBe('start');
  });
});

describe('morning and evening', () => {
  test('noon is the divide', () => {
    expect(slotFor(0)).toBe('morning');
    expect(slotFor(11)).toBe('morning');
    expect(slotFor(12)).toBe('evening');
    expect(slotFor(21)).toBe('evening');
  });

  test('the two slots say different things on the same day', () => {
    const m = buildReminder(ctx({ streakDays: 3, hour: 9 }));
    const e = buildReminder(ctx({ streakDays: 3, hour: 20 }));
    expect(m.slot).toBe('morning');
    expect(e.slot).toBe('evening');
    expect(`${m.title}|${m.body}`).not.toBe(`${e.title}|${e.body}`);
  });

  test('an explicit slot wins over the hour', () => {
    expect(buildReminder(ctx({ hour: 9, slot: 'evening' })).slot).toBe('evening');
  });
});

describe('the built reminder', () => {
  /** Re-rendering must not change the words under the reader. */
  test('is stable for the same day and slot', () => {
    const a = buildReminder(ctx({ streakDays: 3 }));
    const b = buildReminder(ctx({ streakDays: 3 }));
    expect(a).toEqual(b);
  });

  test('varies across days rather than repeating one line forever', () => {
    const seen = new Set();
    for (let d = 1; d <= 28; d++) {
      const dayKey = `2026-08-${String(d).padStart(2, '0')}`;
      seen.add(buildReminder(ctx({ streakDays: 3, dayKey })).body);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test('never leaves an unfilled token in anything it emits', () => {
    const cases = [
      ctx(), ctx({ streakDays: 1 }), ctx({ streakDays: 7 }), ctx({ streakDays: 30 }),
      ctx({ streakDays: 100 }), ctx({ streakDays: 365 }),
      ctx({ wordsToday: 100 }), ctx({ metToday: true }), ctx({ daysAway: 9 }),
      ctx({ bookTitle: '' }), ctx({ goalWords: 0 }),
    ];
    for (const c of cases) {
      for (const hour of [8, 20]) {
        const r = buildReminder({ ...c, hour });
        expect(r.title).not.toMatch(/[{}]/);
        expect(r.body).not.toMatch(/[{}]/);
        expect(r.title.length).toBeGreaterThan(0);
        expect(r.body.length).toBeGreaterThan(0);
      }
    }
  });

  test('milestones outrank variety', () => {
    expect(buildReminder(ctx({ streakDays: 7 })).title).toBe('A week');
    expect(buildReminder(ctx({ streakDays: 30 })).title).toBe('A month');
    expect(buildReminder(ctx({ streakDays: 100 })).title).toBe('100 days');
    expect(buildReminder(ctx({ streakDays: 365 })).title).toBe('A year');
  });

  test('a milestone reads the same whichever slot it lands in', () => {
    expect(buildReminder(ctx({ streakDays: 7, hour: 8 })).title)
      .toBe(buildReminder(ctx({ streakDays: 7, hour: 20 })).title);
  });

  test('a day off a milestone is back to ordinary lines', () => {
    expect(buildReminder(ctx({ streakDays: 6 })).title).not.toBe('A week');
    expect(buildReminder(ctx({ streakDays: 8 })).title).not.toBe('A week');
  });

  test('the book title actually appears when a line asks for it', () => {
    const withBook = allLines().filter((l) => l.body.includes('{book}') || l.title.includes('{book}'));
    expect(withBook.length).toBeGreaterThan(0);
    for (const l of withBook) {
      expect(fillTokens(l.body, ctx({ bookTitle: 'Wolf Hall' })) + fillTokens(l.title, ctx({ bookTitle: 'Wolf Hall' })))
        .toContain('Wolf Hall');
    }
  });

  test('missing context does not throw', () => {
    expect(() => buildReminder()).not.toThrow();
    expect(() => buildReminder({})).not.toThrow();
    const r = buildReminder({});
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.body).not.toMatch(/[{}]/);
  });
});

describe('the house tone', () => {
  const lines = allLines();

  /**
   * The rule ReminderText.java set and this file inherits: no guilt, no
   * exclamation marks, no implication that a missed day undoes anything.
   * Duolingo's structure, not Duolingo's manners.
   */
  test('nothing shouts', () => {
    for (const l of lines) {
      expect(l.title).not.toContain('!');
      expect(l.body).not.toContain('!');
    }
  });

  test('nothing guilts, shames or begs', () => {
    const forbidden = /\b(don'?t lose|you'?ll lose|last chance|hurry|missing out|disappoint|sad|failed|failure|broke your|lost your|shame|guilt|come back!|we miss you)\b/i;
    for (const l of lines) {
      expect(`${l.title} ${l.body}`).not.toMatch(forbidden);
    }
  });

  test('every line is short enough for a lock screen', () => {
    for (const l of lines) {
      expect(l.title.length).toBeLessThanOrEqual(32);
      expect(l.body.length).toBeLessThanOrEqual(90);
    }
  });

  test('every body offers something actionable — a number or a book', () => {
    for (const l of lines) {
      expect(`${l.title} ${l.body}`).toMatch(/\{goal\}|\{remaining\}|\{words\}|\{wordsNum\}|\{book\}|\{goalNum\}/);
    }
  });

  test('the comeback lines never mention what was lost', () => {
    for (const l of allLines().filter((x) => x.situation === 'comeback')) {
      expect(`${l.title} ${l.body}`).not.toMatch(/streak of|\d+ days|lost|gone|broken/i);
    }
  });
});
