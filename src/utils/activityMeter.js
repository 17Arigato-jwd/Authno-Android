/**
 * activityMeter.js — writing cadence for the `activity` permission.
 *
 * Spec: docs/extension-system-v2-spec.md §2.2a.
 *
 * An extension holding `activity` learns how fast you are typing, which is what
 * a writing timer, a pace tracker or a streak widget needs. The design question
 * is not what to send but what to withhold, and there is a real reason to care:
 *
 * **Raw inter-keystroke timing is a behavioural biometric.** Keystroke dynamics
 * are identifying enough to be used for authentication, and an extension
 * holding `activity` together with `network` could fingerprint the person
 * typing and send that fingerprint somewhere. The defence is not a policy about
 * how the data may be used — it is arithmetic that destroys the signal before
 * anything crosses the bridge.
 *
 * So the meter accumulates into fixed one-second buckets and emits a count. The
 * timing information *within* a bucket is discarded at the point of collection
 * and is not recoverable downstream. Ten characters typed in a burst and ten
 * spread evenly across the same second are the same event here, and there is a
 * test that says so.
 *
 * What crosses                     What does not
 * ------------                     -------------
 * characters in the last second    when, within that second
 * an idle/active edge              which keys, in what order
 * session totals, on request       backspaces told apart from characters
 *
 * The other property worth keeping: with nobody subscribed the meter does not
 * run at all, so the editor pays nothing for a permission no extension is
 * using. That matters because this sits on the typing path.
 */

const BUCKET_MS = 1000;
const IDLE_AFTER_MS = 3000;

/** One input event cannot report more than this. A huge paste is still finite. */
const MAX_PER_RECORD = 1_000_000;

/**
 * @param {object}   [o]
 * @param {Function} [o.now]           clock, injectable for tests
 * @param {Function} [o.setIntervalFn]
 * @param {Function} [o.clearIntervalFn]
 * @param {number}   [o.bucketMs]      the quantum; smaller is more identifying
 * @param {number}   [o.idleAfterMs]
 */
export function createActivityMeter({
  now = () => Date.now(),
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
  clearIntervalFn = (h) => clearInterval(h),
  bucketMs = BUCKET_MS,
  idleAfterMs = IDLE_AFTER_MS,
} = {}) {
  let pending = 0;          // characters accumulated in the bucket being filled
  let lastRate = 0;         // the most recently emitted bucket
  let sessionTotal = 0;
  let lastInputAt = null;
  let idle = true;
  let startedAt = null;

  const listeners = new Set();
  let handle = null;

  function emit(event) {
    for (const fn of [...listeners]) {
      // One extension's throw must never stop another's delivery, and must
      // never propagate onto the editor's input path.
      try { fn(event); } catch { /* the listener's problem, not the editor's */ }
    }
  }

  /** One bucket boundary. This is the only place a rate is ever produced. */
  function flush() {
    const at = now();
    const charsPerSecond = bucketMs === 1000 ? pending : (pending * 1000) / bucketMs;
    lastRate = charsPerSecond;
    pending = 0;

    const wasIdle = idle;
    idle = lastInputAt === null || at - lastInputAt >= idleAfterMs;

    // The edge is reported, not the level, so an extension can start and stop a
    // timer without polling.
    if (idle !== wasIdle) emit({ type: idle ? 'idle' : 'active', charsPerSecond, at });
    if (charsPerSecond > 0 || !idle) emit({ type: 'writing', charsPerSecond, idle, at });
  }

  function start() {
    if (handle !== null) return;
    startedAt = now();
    handle = setIntervalFn(flush, bucketMs);
  }

  function stop() {
    if (handle === null) return;
    clearIntervalFn(handle);
    handle = null;
  }

  return {
    /**
     * The editor calls this. `count` is how many characters changed — an
     * insertion of three and a deletion of three are both 3, because telling
     * them apart is exactly the kind of detail that makes a stream
     * identifying, and no timer needs it.
     */
    record(count = 1) {
      const raw = Number(count);
      // Finiteness is checked rather than assumed: Math.floor(Infinity) is
      // Infinity, `Infinity || 0` is Infinity, and one such call would leave
      // sessionChars at Infinity for the rest of the session with no way back.
      // A single input event is also capped — a paste is large, not unbounded.
      if (!Number.isFinite(raw)) return;
      const n = Math.min(MAX_PER_RECORD, Math.max(0, Math.floor(raw)));
      if (n === 0) return;
      pending += n;
      sessionTotal += n;
      lastInputAt = now();
    },

    /**
     * Subscribe to the 1 Hz stream. Returns an unsubscribe.
     *
     * The interval only exists while somebody is listening: an unused
     * permission must not cost a timer on the typing path.
     */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      start();
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) stop();
      };
    },

    /** A snapshot, for an extension that would rather poll than subscribe. */
    getRate() {
      const at = now();
      return {
        charsPerSecond: lastRate,
        idleSeconds: lastInputAt === null ? null : Math.floor((at - lastInputAt) / 1000),
        sessionChars: sessionTotal,
        sessionSeconds: startedAt === null ? 0 : Math.floor((at - startedAt) / 1000),
      };
    },

    /** True while the meter is actually running. */
    isRunning() { return handle !== null; },
    listenerCount() { return listeners.size; },

    /** Test seam: advance one bucket without waiting for a real timer. */
    _flush: flush,

    /** Drop every listener and stop. Called when the last extension unloads. */
    reset() {
      listeners.clear();
      stop();
      pending = 0;
      lastRate = 0;
      sessionTotal = 0;
      lastInputAt = null;
      idle = true;
      startedAt = null;
    },
  };
}

/** The app's single meter. The editor records into it; extensions subscribe. */
let shared = null;
export function activityMeter() {
  if (!shared) shared = createActivityMeter();
  return shared;
}

/** Tests and teardown only. */
export function __resetActivityMeter() {
  if (shared) shared.reset();
  shared = null;
}
