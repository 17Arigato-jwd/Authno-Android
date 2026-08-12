/**
 * The reminder bridge, exercised against a mock that behaves the way
 * Capacitor's plugin object actually does — a Proxy answering every property
 * with a callable, `then` included.
 *
 * That detail is the whole reason these tests exist. The widget bridge shipped
 * a version of this same code that returned the proxy from an `async`
 * function, which handed it to promise resolution, which called
 * `proxy.then(resolve, reject)` and never got either callback back. The await
 * hung forever and nothing was ever logged. So every case here races against a
 * timeout: asserting "it did not reject" would pass on a permanent hang.
 */

const capacitorLikeProxy = (impl) => new Proxy({}, {
  get(_t, prop) {
    if (prop === '$$typeof' || prop === 'toJSON') return undefined;
    return (...args) => (typeof impl[prop] === 'function'
      ? impl[prop](...args)
      : Promise.reject(new Error(`"Reminders.${String(prop)}()" is not implemented`)));
  },
});

/** Fails loudly on a hang instead of waiting for Jest's default timeout. */
const within = (promise, ms = 2000) => Promise.race([
  promise,
  new Promise((_r, rej) => setTimeout(() => rej(new Error('never settled')), ms)),
]);

const book = (over = {}) => ({ id: 'b1', title: 'A Book', type: 'book', ...over });

function mockPlugin(impl, { android = true } = {}) {
  jest.resetModules();
  jest.doMock('./platform', () => ({ isAndroid: () => android, isElectron: () => false }));
  jest.doMock('@capacitor/core', () => ({
    registerPlugin: () => capacitorLikeProxy(impl),
  }), { virtual: true });
  return require('./reminders');
}

afterEach(() => jest.resetModules());

describe('scheduling', () => {
  test('schedules at the configured time when a book is counting', async () => {
    const calls = [];
    const m = mockPlugin({ schedule: (p) => { calls.push(p); return Promise.resolve(); } });
    const out = await within(m.syncReminder([book()], {
      streakReminder: { enabled: true, hour: 7, minute: 5 },
    }));
    expect(out).toBe('scheduled');
    expect(calls).toEqual([{ hour: 7, minute: 5, skipWhenMet: true }]);
  });

  test('cancels rather than schedules when the reminder is off', async () => {
    let cancelled = 0;
    const m = mockPlugin({ cancel: () => { cancelled++; return Promise.resolve(); } });
    expect(await within(m.syncReminder([book()], {}))).toBe('cancelled');
    expect(cancelled).toBe(1);
  });

  /**
   * The point of routing this through streakSettings: switching streaks off
   * has to take the alarm with it, or the phone keeps buzzing about a feature
   * the writer just turned off.
   */
  test('turning streaks off globally cancels a scheduled reminder', async () => {
    let cancelled = 0;
    const m = mockPlugin({
      cancel: () => { cancelled++; return Promise.resolve(); },
      schedule: () => Promise.reject(new Error('should not have been called')),
    });
    const out = await within(m.syncReminder([book()], {
      streakEnabled: false,
      streakReminder: { enabled: true },
    }));
    expect(out).toBe('cancelled');
    expect(cancelled).toBe(1);
  });

  test('cancels when the last counting book opts out', async () => {
    let cancelled = 0;
    const m = mockPlugin({ cancel: () => { cancelled++; return Promise.resolve(); } });
    const out = await within(m.syncReminder([book({ streak: { streakEnabled: false } })], {
      streakReminder: { enabled: true },
    }));
    expect(out).toBe('cancelled');
  });
});

describe('permission', () => {
  test('granted comes back as granted', async () => {
    const m = mockPlugin({ requestPermission: () => Promise.resolve({ status: 'granted' }) });
    expect(await within(m.requestNotificationPermission())).toBe('granted');
  });

  test('anything that is not granted is a refusal, not a crash', async () => {
    const m = mockPlugin({ requestPermission: () => Promise.resolve({ status: 'denied' }) });
    expect(await within(m.requestNotificationPermission())).toBe('denied');
    const m2 = mockPlugin({ requestPermission: () => Promise.resolve({}) });
    expect(await within(m2.requestNotificationPermission())).toBe('denied');
  });

  test('a plugin that throws is unavailable, not denied', async () => {
    const m = mockPlugin({ requestPermission: () => Promise.reject(new Error('boom')) });
    expect(await within(m.requestNotificationPermission())).toBe('unavailable');
  });

  test('checking does not prompt and reports the same three states', async () => {
    const m = mockPlugin({ checkPermission: () => Promise.resolve({ status: 'granted' }) });
    expect(await within(m.checkNotificationPermission())).toBe('granted');
  });
});

describe('off Android', () => {
  /**
   * Every entry point has to settle on desktop and on the web build, where
   * there is no plugin at all — this module is imported by App.js
   * unconditionally.
   */
  test('every call resolves rather than hanging or throwing', async () => {
    const m = mockPlugin({}, { android: false });
    expect(await within(m.syncReminder([book()], { streakReminder: { enabled: true } }))).toBe('unavailable');
    expect(await within(m.requestNotificationPermission())).toBe('unavailable');
    expect(await within(m.checkNotificationPermission())).toBe('unavailable');
    expect(await within(m.reportProgress(true, 3))).toBe(false);
  });

  test('a Capacitor import that fails is survivable', async () => {
    jest.resetModules();
    jest.doMock('./platform', () => ({ isAndroid: () => true, isElectron: () => false }));
    jest.doMock('@capacitor/core', () => { throw new Error('no capacitor'); }, { virtual: true });
    const m = require('./reminders');
    expect(await within(m.syncReminder([book()], {}))).toBe('unavailable');
  });
});

describe('reporting progress', () => {
  test('sends a normalised payload with a date stamp', async () => {
    const calls = [];
    const m = mockPlugin({ reportProgress: (p) => { calls.push(p); return Promise.resolve(); } });
    expect(await within(m.reportProgress(true, 4))).toBe(true);
    expect(calls[0]).toMatchObject({ metToday: true, streakDays: 4 });
    expect(calls[0].dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * The receiver reads a stored number with the app closed; a NaN or a
   * negative would render as "-1 day streak" on somebody's lock screen.
   */
  test('a nonsense streak count is normalised, not forwarded', async () => {
    const calls = [];
    const m = mockPlugin({ reportProgress: (p) => { calls.push(p); return Promise.resolve(); } });
    await within(m.reportProgress(false, NaN));
    await within(m.reportProgress(false, -3));
    await within(m.reportProgress(false, undefined));
    expect(calls.map((c) => c.streakDays)).toEqual([0, 0, 0]);
    expect(calls.every((c) => c.metToday === false)).toBe(true);
  });
});
