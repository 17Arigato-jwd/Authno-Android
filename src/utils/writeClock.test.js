import { markWrote, lastWriteAt, clearWriteClock } from './writeClock';

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
