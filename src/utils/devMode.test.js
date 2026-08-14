import {
  isDevModeUnlocked, setDevModeUnlocked, tapVersion, tapHint,
  TAPS_REQUIRED, TAP_WINDOW_MS,
} from './devMode';

beforeEach(() => localStorage.clear());

describe('the unlocked flag', () => {
  test('starts locked', () => {
    expect(isDevModeUnlocked()).toBe(false);
  });

  test('round-trips, and can be locked again', () => {
    setDevModeUnlocked(true);
    expect(isDevModeUnlocked()).toBe(true);
    setDevModeUnlocked(false);
    expect(isDevModeUnlocked()).toBe(false);
  });

  test('a junk value is not unlocked', () => {
    localStorage.setItem('authno_dev_mode', 'yes please');
    expect(isDevModeUnlocked()).toBe(false);
  });
});

describe('tapping the version', () => {
  const run = (n, startAt = 1000, gap = 200) => {
    let s = null;
    for (let i = 0; i < n; i++) s = tapVersion(s, startAt + i * gap);
    return s;
  };

  test('takes exactly seven', () => {
    expect(TAPS_REQUIRED).toBe(7);
    for (let i = 1; i < TAPS_REQUIRED; i++) expect(run(i).unlocked).toBe(false);
    expect(run(TAPS_REQUIRED).unlocked).toBe(true);
  });

  /**
   * An edge, not a level. The caller unlocks and says so once; if this stayed
   * true it would re-fire on every further tap.
   */
  test('reports the crossing once, not on every tap after it', () => {
    expect(run(TAPS_REQUIRED).unlocked).toBe(true);
    expect(run(TAPS_REQUIRED + 1).unlocked).toBe(false);
    expect(run(TAPS_REQUIRED + 5).unlocked).toBe(false);
  });

  test('counts down and stops at zero', () => {
    expect(run(1).remaining).toBe(6);
    expect(run(6).remaining).toBe(1);
    expect(run(7).remaining).toBe(0);
    expect(run(9).remaining).toBe(0);
  });

  test('a pause starts a new sequence', () => {
    let s = run(6);
    s = tapVersion(s, s.last + TAP_WINDOW_MS + 1);
    expect(s.count).toBe(1);
    expect(s.unlocked).toBe(false);
  });

  test('taps just inside the window keep counting', () => {
    let s = run(6, 1000, TAP_WINDOW_MS - 1);
    s = tapVersion(s, s.last + TAP_WINDOW_MS - 1);
    expect(s.unlocked).toBe(true);
  });

  test('starting from nothing is the first tap', () => {
    expect(tapVersion(null, 500).count).toBe(1);
    expect(tapVersion(undefined, 500).count).toBe(1);
  });

  test('a corrupt previous state restarts rather than throwing', () => {
    expect(() => tapVersion({ count: 'x', last: NaN }, 900)).not.toThrow();
    expect(tapVersion({ count: 'x', last: NaN }, 900).count).toBe(1);
  });
});

describe('the hint', () => {
  const at = (remaining) => tapHint({ remaining });

  /** Silence early, so a stray double-tap never produces a mystery countdown. */
  test('says nothing for the first few', () => {
    expect(at(6)).toBeNull();
    expect(at(5)).toBeNull();
    expect(at(4)).toBeNull();
  });

  test('speaks up once the taps are clearly deliberate', () => {
    expect(at(3)).toBe('3 more taps');
    expect(at(2)).toBe('2 more taps');
    expect(at(1)).toBe('1 more tap');
  });

  test('says nothing once unlocked, or when asked about nonsense', () => {
    expect(at(0)).toBeNull();
    expect(tapHint(null)).toBeNull();
    expect(tapHint({})).toBeNull();
  });
});
