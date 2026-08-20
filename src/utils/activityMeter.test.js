import { createActivityMeter, activityMeter, __resetActivityMeter } from './activityMeter.js';

/** A controllable clock and scheduler, so nothing here depends on real time. */
function harness({ bucketMs = 1000, idleAfterMs = 3000 } = {}) {
  let t = 0;
  let tick = null;
  const meter = createActivityMeter({
    now: () => t,
    setIntervalFn: (fn) => { tick = fn; return 1; },
    clearIntervalFn: () => { tick = null; },
    bucketMs,
    idleAfterMs,
  });
  return {
    meter,
    advance(ms) { t += ms; },
    /** Cross a bucket boundary the way a real interval would. */
    bucket(ms = bucketMs) { t += ms; if (tick) tick(); },
    hasTimer: () => tick !== null,
    at: () => t,
  };
}

afterEach(() => __resetActivityMeter());

describe('rate reporting', () => {
  test('characters in a second come back as that second rate', () => {
    const h = harness();
    const seen = [];
    h.meter.subscribe((e) => seen.push(e));

    h.meter.record(5);
    h.meter.record(3);
    h.bucket();

    expect(seen.filter((e) => e.type === 'writing')[0].charsPerSecond).toBe(8);
  });

  test('an empty second while active still reports zero', () => {
    const h = harness();
    const seen = [];
    h.meter.subscribe((e) => seen.push(e));

    h.meter.record(4);
    h.bucket();
    seen.length = 0;
    h.bucket();

    const writing = seen.filter((e) => e.type === 'writing');
    expect(writing).toHaveLength(1);
    expect(writing[0].charsPerSecond).toBe(0);
  });

  test('getRate reports the last bucket and how long since input', () => {
    const h = harness();
    h.meter.subscribe(() => {});
    h.meter.record(6);
    h.bucket();
    h.advance(2000);

    const r = h.meter.getRate();
    expect(r.charsPerSecond).toBe(6);
    expect(r.idleSeconds).toBe(3);
    expect(r.sessionChars).toBe(6);
  });

  test('session totals accumulate across buckets', () => {
    const h = harness();
    h.meter.subscribe(() => {});
    for (let i = 0; i < 5; i++) { h.meter.record(4); h.bucket(); }
    expect(h.meter.getRate().sessionChars).toBe(20);
  });

  test('a deletion counts as activity and is not flagged as one', () => {
    const h = harness();
    const seen = [];
    h.meter.subscribe((e) => seen.push(e));
    h.meter.record(3);   // three characters changed; insert or delete, same thing
    h.bucket();

    const e = seen.find((x) => x.type === 'writing');
    expect(e.charsPerSecond).toBe(3);
    expect(Object.keys(e).sort()).toEqual(['at', 'charsPerSecond', 'idle', 'type']);
  });
});

describe('what the meter refuses to reveal', () => {
  /**
   * The whole reason the rate is bucketed. Keystroke dynamics identify a
   * person; a per-second count does not. If these two ever diverge, the meter
   * has started leaking timing.
   */
  test('a burst and an even spread within one second are indistinguishable', () => {
    const burst = harness();
    const burstSeen = [];
    burst.meter.subscribe((e) => burstSeen.push(e));
    burst.meter.record(10);           // ten characters, all at once
    burst.bucket();

    const spread = harness();
    const spreadSeen = [];
    spread.meter.subscribe((e) => spreadSeen.push(e));
    for (let i = 0; i < 10; i++) {    // ten characters, 100 ms apart
      spread.advance(100);
      spread.meter.record(1);
    }
    spread.bucket(0);

    const strip = (list) => list.map(({ type, charsPerSecond, idle }) => ({ type, charsPerSecond, idle }));
    expect(strip(spreadSeen)).toEqual(strip(burstSeen));
  });

  test('two different rhythms with the same per-second totals emit the same stream', () => {
    const rhythm = (pattern) => {
      const h = harness();
      const seen = [];
      h.meter.subscribe((e) => seen.push(e));
      for (const second of pattern) {
        for (const [offset, n] of second) { h.advance(offset); h.meter.record(n); }
        h.bucket(0);
      }
      return seen.map((e) => `${e.type}:${e.charsPerSecond}`);
    };

    const staccato = [[[0, 6]], [[0, 4]], [[0, 9]]];
    const legato = [
      [[100, 2], [300, 2], [300, 2]],
      [[250, 1], [250, 1], [250, 2]],
      [[100, 3], [400, 3], [400, 3]],
    ];
    expect(rhythm(legato)).toEqual(rhythm(staccato));
  });

  test('the emitted event carries no key identity or ordering', () => {
    const h = harness();
    const seen = [];
    h.meter.subscribe((e) => seen.push(e));
    h.meter.record(4);
    h.bucket();

    for (const e of seen) {
      // Only these four fields exist. Anything else would be a new channel.
      expect(Object.keys(e).sort()).toEqual(
        e.type === 'writing' ? ['at', 'charsPerSecond', 'idle', 'type'] : ['at', 'charsPerSecond', 'type'],
      );
    }
  });

  test('sub-second resolution is not obtainable by subscribing repeatedly', () => {
    // Every listener sees the same bucketed value; there is no per-listener
    // sampling that could be combined into finer timing.
    const h = harness();
    const a = [];
    const b = [];
    h.meter.subscribe((e) => a.push(e.charsPerSecond));
    h.meter.subscribe((e) => b.push(e.charsPerSecond));

    h.advance(120); h.meter.record(1);
    h.advance(700); h.meter.record(1);
    h.bucket(180);

    expect(a).toEqual(b);
  });
});

describe('idle edges', () => {
  test('going quiet reports an idle edge exactly once', () => {
    const h = harness({ idleAfterMs: 2000 });
    const seen = [];
    h.meter.subscribe((e) => seen.push(e));

    h.meter.record(5);
    h.bucket();                       // active
    h.bucket(); h.bucket();           // silence past the idle threshold
    h.bucket();

    const edges = seen.filter((e) => e.type === 'idle' || e.type === 'active');
    expect(edges.map((e) => e.type)).toEqual(['active', 'idle']);
  });

  test('typing again reports an active edge', () => {
    const h = harness({ idleAfterMs: 2000 });
    const seen = [];
    h.meter.subscribe((e) => seen.push(e));

    h.meter.record(2);
    h.bucket();
    h.bucket(); h.bucket(); h.bucket();     // idle
    h.meter.record(1);
    h.bucket();

    expect(seen.filter((e) => e.type === 'idle' || e.type === 'active').map((e) => e.type))
      .toEqual(['active', 'idle', 'active']);
  });

  test('a fully idle meter stops emitting writing events', () => {
    const h = harness({ idleAfterMs: 1000 });
    const seen = [];
    h.meter.subscribe((e) => seen.push(e));
    h.bucket(); h.bucket();
    expect(seen.filter((e) => e.type === 'writing')).toHaveLength(0);
  });
});

describe('the editor pays nothing for an unused permission', () => {
  test('no timer runs until something subscribes', () => {
    const h = harness();
    expect(h.hasTimer()).toBe(false);
    expect(h.meter.isRunning()).toBe(false);

    const off = h.meter.subscribe(() => {});
    expect(h.meter.isRunning()).toBe(true);

    off();
    expect(h.meter.isRunning()).toBe(false);
    expect(h.hasTimer()).toBe(false);
  });

  test('the timer stops only when the LAST listener goes', () => {
    const h = harness();
    const offA = h.meter.subscribe(() => {});
    const offB = h.meter.subscribe(() => {});
    offA();
    expect(h.meter.isRunning()).toBe(true);
    offB();
    expect(h.meter.isRunning()).toBe(false);
  });

  test('recording with nobody listening is cheap and still counts', () => {
    const h = harness();
    h.meter.record(7);
    expect(h.meter.isRunning()).toBe(false);
    expect(h.meter.getRate().sessionChars).toBe(7);
  });

  test('unsubscribing twice is harmless', () => {
    const h = harness();
    const off = h.meter.subscribe(() => {});
    off(); off();
    expect(h.meter.listenerCount()).toBe(0);
  });

  test('subscribing a non-function is ignored rather than throwing', () => {
    const h = harness();
    expect(() => h.meter.subscribe(null)()).not.toThrow();
    expect(h.meter.isRunning()).toBe(false);
  });
});

describe('one extension cannot break another, or the editor', () => {
  test('a listener that throws does not stop the others', () => {
    const h = harness();
    const good = [];
    h.meter.subscribe(() => { throw new Error('extension bug'); });
    h.meter.subscribe((e) => good.push(e));

    h.meter.record(3);
    expect(() => h.bucket()).not.toThrow();
    expect(good.length).toBeGreaterThan(0);
  });

  test('a listener that throws does not stop the editor recording', () => {
    const h = harness();
    h.meter.subscribe(() => { throw new Error('extension bug'); });
    h.meter.record(1);
    h.bucket();
    expect(() => h.meter.record(1)).not.toThrow();
    expect(h.meter.getRate().sessionChars).toBe(2);
  });

  test('unsubscribing during delivery does not skip a listener', () => {
    const h = harness();
    const seen = [];
    const off = h.meter.subscribe(() => off());
    h.meter.subscribe((e) => seen.push(e));
    h.meter.record(2);
    h.bucket();
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('input hygiene', () => {
  test('nonsense counts are ignored', () => {
    const h = harness();
    // `undefined` is deliberately absent: it is indistinguishable from calling
    // record() with no argument at all, which means one character — see below.
    for (const bad of [0, -5, NaN, null, 'abc', {}, Infinity, -Infinity]) {
      h.meter.record(bad);
    }
    expect(h.meter.getRate().sessionChars).toBe(0);
  });

  test('record() with no argument counts one character', () => {
    const h = harness();
    h.meter.record();
    h.meter.record();
    expect(h.meter.getRate().sessionChars).toBe(2);
  });

  test('Infinity cannot poison the session total', () => {
    // Math.floor(Infinity) is Infinity and `Infinity || 0` is Infinity, so a
    // single such call used to leave sessionChars at Infinity permanently —
    // every later reading meaningless, with no way back short of a restart.
    const h = harness();
    h.meter.record(Infinity);
    h.meter.record(5);
    expect(Number.isFinite(h.meter.getRate().sessionChars)).toBe(true);
    expect(h.meter.getRate().sessionChars).toBe(5);
  });

  test('an absurd single event is capped rather than trusted', () => {
    const h = harness();
    h.meter.record(5e9);
    expect(h.meter.getRate().sessionChars).toBe(1_000_000);
  });

  test('a fractional count is floored', () => {
    const h = harness();
    h.meter.record(2.9);
    expect(h.meter.getRate().sessionChars).toBe(2);
  });

  test('idleSeconds is null before any input, not zero', () => {
    // Zero would read as "typing right now" to a timer extension.
    const h = harness();
    expect(h.meter.getRate().idleSeconds).toBeNull();
  });
});

describe('the shared meter', () => {
  test('is one instance', () => {
    expect(activityMeter()).toBe(activityMeter());
  });

  test('reset drops listeners and stops', () => {
    const m = activityMeter();
    m.subscribe(() => {});
    expect(m.listenerCount()).toBe(1);
    __resetActivityMeter();
    expect(m.listenerCount()).toBe(0);
    expect(m.isRunning()).toBe(false);
  });
});
