import {
  writingDayKey, windowEnd, msRemaining, inExtension, extensionHours,
  formatRemaining, countdownState, LOOKBACK_MINUTES, HARD_CAP_HOUR,
} from './streakWindow';

/** Local time on purpose — the whole module works in the writer's clock. */
const at = (d, h, mi = 0) => new Date(2026, 7, d, h, mi, 0); // August 2026
const HOUR = 3600000;

/** Deadline as "day HH:MM", which is what every assertion here cares about. */
const endAs = (now, lastWrite) => {
  const e = windowEnd(now, lastWrite);
  return `${e.getDate()} ${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`;
};

describe('the rule: midnight', () => {
  test('someone who stopped in the evening resets at midnight', () => {
    expect(endAs(at(10, 21, 0), at(10, 20, 30))).toBe('11 00:00');
  });

  test('and so does someone who never wrote at all', () => {
    expect(endAs(at(10, 21, 0), null)).toBe('11 00:00');
  });

  test('a write from days ago earns nothing', () => {
    expect(endAs(at(10, 23, 59), at(3, 23, 55))).toBe('11 00:00');
  });

  /** 31 minutes before midnight is outside the look-back, by a minute. */
  test('stopping just outside the look-back earns nothing', () => {
    expect(endAs(at(10, 23, 59), at(10, 23, 29))).toBe('11 00:00');
  });
});

describe('the exception: still writing when it arrives', () => {
  test('writing at 23:50 runs the day to 01:00', () => {
    expect(endAs(at(10, 23, 55), at(10, 23, 50))).toBe('11 01:00');
  });

  test('exactly on the look-back boundary counts', () => {
    expect(endAs(at(10, 23, 59), at(10, 23, 30))).toBe('11 01:00');
  });

  /** The chain. Still going at the end of the extension buys another. */
  test('writing at 00:45 runs it to 02:00', () => {
    expect(endAs(at(11, 0, 50), at(11, 0, 45))).toBe('11 02:00');
  });

  test('writing at 01:40 runs it to 03:00', () => {
    expect(endAs(at(11, 1, 45), at(11, 1, 40))).toBe('11 03:00');
  });

  test('and it stops at 4am however late you are still going', () => {
    expect(endAs(at(11, 2, 55), at(11, 2, 50))).toBe('11 04:00');
    expect(endAs(at(11, 3, 55), at(11, 3, 50))).toBe('11 04:00');
    expect(HARD_CAP_HOUR).toBe(4);
  });

  test('a gap in the small hours ends it at the hour already earned', () => {
    // Wrote at 23:50, then stopped. At 00:40 the 01:00 deadline still stands,
    // but nothing has earned 02:00.
    expect(endAs(at(11, 0, 40), at(10, 23, 50))).toBe('11 01:00');
  });
});

describe('the evening must not read as yesterday', () => {
  /**
   * The trap. An evening write sits far past the PREVIOUS midnight, so a
   * naive look-back reads it as evidence that yesterday's window is open and
   * every writing day ends up permanently a day behind.
   */
  test('an evening write does not reopen yesterday', () => {
    expect(endAs(at(10, 22, 0), at(10, 21, 55))).toBe('11 00:00');
  });

  test('nor does a write at noon', () => {
    expect(endAs(at(10, 12, 0), at(10, 11, 55))).toBe('11 00:00');
  });

  test('after the cap, the new day is running normally', () => {
    expect(endAs(at(11, 4, 30), at(11, 3, 50))).toBe('12 00:00');
    expect(endAs(at(11, 6, 0), at(11, 5, 55))).toBe('12 00:00');
  });
});

describe('which day the writing counts for', () => {
  test('an evening session counts for that evening', () => {
    expect(writingDayKey(at(10, 21, 0), at(10, 20, 55))).toBe('2026-08-10');
  });

  test('a session inside an extension counts for the day that earned it', () => {
    expect(writingDayKey(at(11, 0, 30), at(10, 23, 50))).toBe('2026-08-10');
    expect(writingDayKey(at(11, 1, 30), at(11, 1, 20))).toBe('2026-08-10');
  });

  test('past the cap it is unambiguously the new day', () => {
    expect(writingDayKey(at(11, 5, 0), at(11, 4, 55))).toBe('2026-08-11');
  });

  test('someone who stopped early gets plain midnight', () => {
    expect(writingDayKey(at(11, 1, 0), at(10, 20, 0))).toBe('2026-08-11');
  });

  test('crossing a month', () => {
    expect(writingDayKey(new Date(2026, 7, 32, 0, 30), new Date(2026, 7, 31, 23, 50)))
      .toBe('2026-08-31');
  });
});

describe('reporting the extension', () => {
  test('no extension normally', () => {
    expect(extensionHours(at(10, 21, 0), at(10, 20, 0))).toBe(0);
    expect(inExtension(at(10, 21, 0), at(10, 20, 0))).toBe(false);
  });

  test('counts the hours earned', () => {
    expect(extensionHours(at(11, 0, 30), at(10, 23, 50))).toBe(1);
    expect(extensionHours(at(11, 0, 50), at(11, 0, 45))).toBe(2);
  });

  test('true only once the clock has actually passed midnight', () => {
    expect(inExtension(at(11, 0, 30), at(10, 23, 50))).toBe(true);
    expect(inExtension(at(10, 23, 55), at(10, 23, 50))).toBe(false);
  });
});

describe('remaining time', () => {
  test('shrinks through the evening and is never negative', () => {
    const early = msRemaining(at(10, 18, 0), null);
    const late = msRemaining(at(10, 23, 0), null);
    expect(late).toBeLessThan(early);
    expect(msRemaining(at(11, 3, 59), at(11, 3, 55))).toBeGreaterThanOrEqual(0);
  });

  test('an extension really does add an hour of runway', () => {
    const without = msRemaining(at(10, 23, 55), at(10, 20, 0));
    const with_ = msRemaining(at(10, 23, 55), at(10, 23, 50));
    expect(with_ - without).toBeCloseTo(HOUR, -3);
  });
});

describe('how it reads', () => {
  test('hours, then minutes and seconds, then seconds', () => {
    expect(formatRemaining(3 * HOUR + 12 * 60000)).toBe('3h 12m');
    expect(formatRemaining(9 * 60000 + 5000)).toBe('9:05');
    expect(formatRemaining(9000)).toBe('9s');
  });

  test('junk reads as nothing left rather than NaN', () => {
    expect(formatRemaining(null)).toBe('0s');
    expect(formatRemaining(-500)).toBe('0s');
    expect(formatRemaining('x')).toBe('0s');
  });
});

describe('the state a countdown surface needs', () => {
  const base = { now: at(10, 21, 0), lastWriteAt: at(10, 20, 55), goalWords: 300 };

  test('carries a deadline the widget can hand to a system clock', () => {
    const s = countdownState(base);
    expect(s.deadline).toBeGreaterThan(base.now.getTime());
    expect(typeof s.label).toBe('string');
    expect(s.extended).toBe(0);
  });

  test('urgent under the last hour', () => {
    expect(countdownState({ ...base, now: at(10, 23, 30) }).urgent).toBe(true);
    expect(countdownState({ ...base, now: at(10, 20, 0) }).urgent).toBe(false);
  });

  /**
   * A countdown that goes urgent on a day already finished is a manufactured
   * emergency — the manipulation the reminder copy refuses elsewhere.
   */
  test('never urgent once the goal is met', () => {
    const s = countdownState({ ...base, now: at(10, 23, 30), wordsToday: 500 });
    expect(s.met).toBe(true);
    expect(s.urgent).toBe(false);
  });

  test('reports an extension so a widget can explain the date', () => {
    const s = countdownState({ now: at(11, 0, 30), lastWriteAt: at(10, 23, 50) });
    expect(s.extended).toBe(1);
    expect(s.inExtension).toBe(true);
    expect(s.dayKey).toBe('2026-08-10');
  });

  test('the look-back is configurable, and the default is documented', () => {
    expect(LOOKBACK_MINUTES).toBe(30);
    // 15 minutes is the tighter end of the range. A write at 23:50 is inside
    // it; the same write is outside a 5-minute one. (23:40 would be outside
    // BOTH, which is what this assertion got wrong the first time.)
    expect(windowEnd(at(10, 23, 59), at(10, 23, 50), { lookbackMinutes: 15 }).getHours()).toBe(1);
    expect(windowEnd(at(10, 23, 59), at(10, 23, 50), { lookbackMinutes: 5 }).getHours()).toBe(0);
  });

  test('called with nothing at all, it still answers', () => {
    const s = countdownState();
    expect(typeof s.deadline).toBe('number');
    expect(s.msLeft).toBeGreaterThanOrEqual(0);
    expect(s.met).toBe(false);
  });
});
