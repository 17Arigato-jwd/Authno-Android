import { markWrote, lastWriteAt, clearWriteClock, currentWritingDay } from './writeClock';

beforeEach(() => { localStorage.clear(); });

describe('the write clock', () => {
  test('nothing written yet is null, not zero', () => {
    // Zero is a real timestamp as far as arithmetic is concerned — 1970 — and
    // streakWindow treats a falsy value as "no extension". Null says the same
    // thing without pretending to be a date.
    expect(lastWriteAt()).toBeNull();
  });

  test('a stamp comes back', () => {
    markWrote(1_700_000_000_000);
    expect(lastWriteAt()).toBe(1_700_000_000_000);
  });

  test('repeat calls within the minute do not touch storage', () => {
    const t = 1_700_000_000_000;
    expect(markWrote(t)).toBe(true);
    expect(markWrote(t + 1_000)).toBe(false);
    expect(markWrote(t + 59_000)).toBe(false);
    expect(markWrote(t + 60_000)).toBe(true);
    expect(lastWriteAt()).toBe(t + 60_000);
  });

  /**
   * The stamp is the left edge of a window somebody may currently be inside.
   * Moving it backwards — a clock correction, a timezone change, a device that
   * booted with a bad time — would end the night early on a session that is
   * still running.
   */
  test('it never moves backwards', () => {
    const t = 1_700_000_000_000;
    markWrote(t);
    expect(markWrote(t - 3_600_000)).toBe(false);
    expect(lastWriteAt()).toBe(t);
  });

  test('nonsense is refused rather than stored', () => {
    expect(markWrote(NaN)).toBe(false);
    expect(markWrote(0)).toBe(false);
    expect(markWrote(-5)).toBe(false);
    expect(markWrote('not a time')).toBe(false);
    expect(lastWriteAt()).toBeNull();
  });

  test('junk already in storage reads as nothing', () => {
    localStorage.setItem('authno_last_write_v1', 'yesterday afternoon');
    expect(lastWriteAt()).toBeNull();
  });

  test('clearing forgets it', () => {
    markWrote(1_700_000_000_000);
    clearWriteClock();
    expect(lastWriteAt()).toBeNull();
  });

  /**
   * localStorage throwing is a full disk or a locked-down browser, neither of
   * which is a reason to lose the words being written at the time.
   */
  test('storage that throws is survivable', () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
      expect(() => markWrote(1_700_000_000_000)).not.toThrow();
      expect(markWrote(1_700_000_000_000)).toBe(false);
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});

/**
 * One answer, shared. The streak logs against this key, the reminder decides
 * whether to stay quiet against it, and the widget counts down to the end of
 * it. Two of them disagreeing costs somebody a run they earned.
 */
describe('the day being counted', () => {
  const on = (iso) => new Date(iso);

  test('outside the small hours it is the calendar date', () => {
    expect(currentWritingDay(on('2026-08-14T14:30:00'))).toBe('2026-08-14');
    expect(currentWritingDay(on('2026-08-14T04:00:00'))).toBe('2026-08-14');
    expect(currentWritingDay(on('2026-08-14T23:59:00'))).toBe('2026-08-14');
  });

  test('nobody writing means midnight ended it', () => {
    expect(currentWritingDay(on('2026-08-15T00:30:00'))).toBe('2026-08-15');
  });

  test('a session still running holds the night open', () => {
    markWrote(on('2026-08-14T23:50:00').getTime());
    expect(currentWritingDay(on('2026-08-15T00:30:00'))).toBe('2026-08-14');
    expect(currentWritingDay(on('2026-08-15T01:30:00'))).toBe('2026-08-15');
  });

  test('4am ends it regardless', () => {
    markWrote(on('2026-08-15T03:55:00').getTime());
    expect(currentWritingDay(on('2026-08-15T04:01:00'))).toBe('2026-08-15');
  });
});
