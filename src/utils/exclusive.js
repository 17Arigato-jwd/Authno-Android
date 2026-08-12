/**
 * exclusive.js — "one at a time, and don't lose the one you turned away".
 *
 * For work that is scheduled on a debounce but takes longer than the debounce
 * to finish. clearTimeout cancels a timer that has not fired; it cannot stop a
 * callback already running. So a second run starts on top of the first, and if
 * that work is writing a file, two writes overlap on the same path.
 *
 * Dropping the second run instead is not safe either: it may be the only one
 * that would have saved the latest edit, and if the writer has stopped typing
 * there is nothing left to re-trigger it.
 *
 * So a turned-away run is remembered, and the caller re-arms once at the end.
 * One pending re-run is enough however many were turned away — they would all
 * do the same work against the same current state.
 */

export function makeGate() {
  let running = false;
  let missed = false;

  return {
    /** True if you may proceed. False means someone else is running. */
    tryEnter() {
      if (running) { missed = true; return false; }
      running = true;
      return true;
    },

    /**
     * Call from a `finally`. Returns true when at least one run was turned
     * away while you held the gate, meaning the caller should schedule one
     * more pass.
     */
    exit() {
      running = false;
      const wasMissed = missed;
      missed = false;
      return wasMissed;
    },

    get isRunning() { return running; },
    get hasMissed() { return missed; },
  };
}

export default makeGate;
