/**
 * extensionCommands.js — the link between a contribution and behaviour.
 *
 * Spec: docs/extension-system-v2-spec.md §4 (targets) and §6 (`action`,
 * `readout`).
 *
 * Three places name a command and none of them could reach one until now:
 *
 *   contributes: [{ label: "Back up now", command: "sync.now" }]
 *   settings:    { type: "action",  command: "auth.connect" }
 *   settings:    { type: "readout", source:  "sync.status"  }
 *
 * The handler stays inside the frame; only the NAME crosses. That is the same
 * shape `registerHook` already uses, and for the same reason — a function
 * cannot cross a postMessage boundary, and a host holding a reference into a
 * sandbox is a host that has stopped being outside it.
 *
 * The manifest's `commands` array is the contract. An extension may only
 * register what it declared, so the list of things a button might invoke is
 * knowable by reading the manifest rather than by running the code — which is
 * what makes a contribution reviewable before it is installed.
 *
 * Everything here is bounded. A command that never answers must not stall the
 * button that called it, and a readout that polls must stop when nobody is
 * looking at it.
 */

const DEFAULT_TIMEOUT_MS = 10000;
const MIN_READOUT_MS = 2000;

export class CommandError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * @param {object}   o
 * @param {string}   o.extId
 * @param {string[]} o.declared     the manifest's `commands` array
 * @param {Function} o.call         (name, args) => Promise<any> — into the frame
 * @param {Function} [o.now]
 * @param {number}   [o.timeoutMs]
 */
export function createCommandRegistry({
  extId,
  declared = [],
  call,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutFn = (h) => clearTimeout(h),
}) {
  const allowed = new Set((declared ?? []).map(String));
  const registered = new Set();
  const readouts = new Map();   // source → { handle, listeners:Set, last, intervalMs }
  let disposed = false;

  function assertLive() {
    if (disposed) throw new CommandError('extension-stopped', 'this extension is no longer running');
  }

  /** Fail a call that never comes back, rather than leaving the caller hanging. */
  function withTimeout(promise, name) {
    return new Promise((resolve, reject) => {
      const handle = setTimeoutFn(() => {
        reject(new CommandError('command-timeout', `${name} did not answer in ${timeoutMs} ms`, { name }));
      }, timeoutMs);
      promise.then(
        (v) => { clearTimeoutFn(handle); resolve(v); },
        (e) => { clearTimeoutFn(handle); reject(e); },
      );
    });
  }

  return {
    /**
     * The frame says it has a handler for this name.
     *
     * Refused when the manifest never declared it: otherwise a package could
     * be reviewed as doing one thing and register another at runtime, and the
     * manifest would stop being a description of what the extension does.
     */
    register(name) {
      assertLive();
      const cmd = String(name ?? '');
      if (!cmd) throw new CommandError('bad-command', 'a command needs a name');
      if (!allowed.has(cmd)) {
        throw new CommandError('undeclared-command',
          `${cmd} is not in this extension's declared commands`, { name: cmd });
      }
      registered.add(cmd);
      return true;
    },

    unregister(name) { return registered.delete(String(name)); },

    isRegistered(name) { return registered.has(String(name)); },
    declared() { return [...allowed].sort(); },
    live() { return [...registered].sort(); },

    /**
     * Run a command, on behalf of a button the user pressed.
     *
     * The two failure modes are told apart on purpose. "Declared but never
     * registered" is an extension that has not finished starting, or has a
     * bug; "not declared at all" is a contribution pointing at nothing, which
     * is an authoring error the manifest validator should have caught. A single
     * "unknown command" would send somebody looking in the wrong place.
     */
    async invoke(name, args = []) {
      assertLive();
      const cmd = String(name ?? '');
      if (!allowed.has(cmd)) {
        throw new CommandError('undeclared-command', `${cmd} is not declared`, { name: cmd });
      }
      if (!registered.has(cmd)) {
        throw new CommandError('command-not-ready',
          `${cmd} is declared but the extension has not registered it`, { name: cmd });
      }
      if (!Array.isArray(args)) throw new CommandError('bad-args', 'args must be an array');

      try {
        return await withTimeout(Promise.resolve(call(cmd, args)), cmd);
      } catch (e) {
        if (e instanceof CommandError) throw e;
        // A throw inside the extension is an answer, not a broken channel.
        throw new CommandError('command-failed', String(e?.message ?? e), { name: cmd });
      }
    },

    /**
     * A `readout` control asking its source for a value, repeatedly.
     *
     * Polling starts on the first subscriber and stops with the last, so a
     * settings page nobody has open costs nothing. The floor exists because a
     * readout is a status line, and a status line asking ten times a second is
     * a busy loop wearing a label.
     */
    subscribeReadout(source, listener, { intervalMs = 5000 } = {}) {
      assertLive();
      const key = String(source ?? '');
      if (typeof listener !== 'function') return () => {};
      const every = Math.max(MIN_READOUT_MS, Number(intervalMs) || 0);

      let state = readouts.get(key);
      if (!state) {
        state = { handle: null, listeners: new Set(), last: null, intervalMs: every };
        readouts.set(key, state);
      }
      state.listeners.add(listener);

      const tick = async () => {
        if (disposed || state.listeners.size === 0) return;
        let value = null;
        let error = null;
        try { value = await this.invoke(key, []); } catch (e) { error = e.code ?? 'command-failed'; }
        state.last = { value, error, at: now() };
        for (const fn of [...state.listeners]) {
          // One readout's render bug must not stop the others updating.
          try { fn(state.last); } catch { /* the page's problem */ }
        }
        if (state.listeners.size > 0 && !disposed) {
          state.handle = setTimeoutFn(tick, state.intervalMs);
        }
      };

      if (state.handle === null) {
        // Ask immediately, then settle into the interval: a readout that shows
        // nothing for five seconds after opening looks broken.
        state.handle = setTimeoutFn(tick, 0);
      } else if (state.last) {
        try { listener(state.last); } catch { /* the page's problem */ }
      }

      return () => {
        state.listeners.delete(listener);
        if (state.listeners.size === 0 && state.handle !== null) {
          clearTimeoutFn(state.handle);
          state.handle = null;
        }
      };
    },

    /** True while any readout is actually polling. */
    isPolling() {
      for (const s of readouts.values()) if (s.handle !== null) return true;
      return false;
    },

    extId,

    dispose() {
      disposed = true;
      for (const s of readouts.values()) {
        if (s.handle !== null) clearTimeoutFn(s.handle);
        s.handle = null;
        s.listeners.clear();
      }
      readouts.clear();
      registered.clear();
    },
  };
}

/**
 * Which commands a manifest's contributions and settings actually reach for.
 *
 * Used by the validator and by the Extensions tab: a contribution naming a
 * command the manifest never declared is a button that cannot work, and it is
 * better found while reading the manifest than by pressing it.
 */
export function commandsUsedBy(manifest) {
  const used = new Set();

  for (const entries of Object.values(manifest?.contributes ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) if (e && typeof e.command === 'string') used.add(e.command);
  }

  const walk = (list) => {
    if (!Array.isArray(list)) return;
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      if (c.type === 'section') { walk(c.children); continue; }
      if (typeof c.command === 'string') used.add(c.command);
      if (typeof c.source === 'string') used.add(c.source);
    }
  };
  walk(manifest?.settings?.schema);

  return [...used].sort();
}

/** Commands something points at that the manifest never declared. */
export function undeclaredCommands(manifest) {
  const declared = new Set(manifest?.commands ?? []);
  return commandsUsedBy(manifest).filter((c) => !declared.has(c));
}
