import {
  createCommandRegistry, CommandError, commandsUsedBy, undeclaredCommands,
} from './extensionCommands.js';

/** A controllable clock, so no test waits on real time. */
function harness({ declared = ['sync.now', 'auth.connect', 'sync.status'], impl = {} } = {}) {
  let t = 0;
  const timers = new Map();
  let nextId = 1;
  const calls = [];

  const reg = createCommandRegistry({
    extId: 'demo',
    declared,
    now: () => t,
    timeoutMs: 1000,
    call: async (name, args) => {
      calls.push([name, args]);
      const fn = impl[name];
      if (!fn) return undefined;
      return fn(args);
    },
    setTimeoutFn: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimeoutFn: (id) => timers.delete(id),
  });

  /**
   * Fire every timer due at or before the new time, oldest first.
   *
   * A tick's work is an async chain — invoke, into `call`, back out — and a
   * couple of `Promise.resolve()` turns is not enough to drain it. Yielding to
   * a real macrotask is; the registry's own timers are fake, so nothing here
   * races them. jsdom has no setImmediate, hence the real setTimeout.
   */
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const advance = async (ms) => {
    t += ms;
    await flush();
    for (let pass = 0; pass < 50; pass++) {
      const at = t;
      const due = [...timers.entries()].filter(([, x]) => x.at <= at).sort((a, b) => a[1].at - b[1].at);
      if (!due.length) break;
      for (const [id, x] of due) { timers.delete(id); x.fn(); }
      await flush();
    }
  };

  return { reg, advance, calls, pending: () => timers.size };
}

describe('the manifest is the contract', () => {
  test('a declared command can be registered', () => {
    const { reg } = harness();
    expect(reg.register('sync.now')).toBe(true);
    expect(reg.isRegistered('sync.now')).toBe(true);
  });

  test('an undeclared command cannot be registered', () => {
    // Otherwise a package reviewed as doing one thing registers another at
    // runtime, and the manifest stops describing what the extension does.
    const { reg } = harness();
    expect(() => reg.register('secretly.exfiltrate'))
      .toThrow(expect.objectContaining({ code: 'undeclared-command' }));
    expect(reg.live()).toEqual([]);
  });

  test('a nameless command is refused', () => {
    const { reg } = harness();
    for (const bad of ['', null, undefined]) {
      expect(() => reg.register(bad)).toThrow(CommandError);
    }
  });

  test('what was declared is readable without running anything', () => {
    const { reg } = harness();
    expect(reg.declared()).toEqual(['auth.connect', 'sync.now', 'sync.status']);
  });
});

describe('invoking', () => {
  test('a registered command runs and returns its value', async () => {
    const { reg, calls } = harness({ impl: { 'sync.now': async () => ({ uploaded: 3 }) } });
    reg.register('sync.now');
    await expect(reg.invoke('sync.now', [{ force: true }])).resolves.toEqual({ uploaded: 3 });
    expect(calls).toEqual([['sync.now', [{ force: true }]]]);
  });

  test('"declared but not registered" and "not declared" are told apart', async () => {
    // One is an extension still starting, or with a bug. The other is a
    // contribution pointing at nothing, which is an authoring error. A single
    // "unknown command" sends somebody looking in the wrong place.
    const { reg } = harness();
    await expect(reg.invoke('sync.now')).rejects.toMatchObject({ code: 'command-not-ready' });
    await expect(reg.invoke('never.declared')).rejects.toMatchObject({ code: 'undeclared-command' });
  });

  test('a throw inside the extension is an answer, not a broken channel', async () => {
    const { reg } = harness({ impl: { 'sync.now': async () => { throw new Error('no network'); } } });
    reg.register('sync.now');
    const err = await reg.invoke('sync.now').catch((e) => e);
    expect(err).toBeInstanceOf(CommandError);
    expect(err.code).toBe('command-failed');
    expect(err.message).toBe('no network');
  });

  test('a command that never answers is bounded, not a hang', async () => {
    // The button that called it must come back, whatever the extension does.
    const { reg, advance } = harness({ impl: { 'sync.now': () => new Promise(() => {}) } });
    reg.register('sync.now');
    const pending = reg.invoke('sync.now').catch((e) => e);
    await advance(1000);
    expect((await pending).code).toBe('command-timeout');
  });

  test('a fast command does not leave its timeout behind', async () => {
    const { reg, advance, pending } = harness({ impl: { 'sync.now': async () => 'ok' } });
    reg.register('sync.now');
    await reg.invoke('sync.now');
    await advance(0);
    expect(pending()).toBe(0);
  });

  test('args must be an array', async () => {
    const { reg } = harness();
    reg.register('sync.now');
    await expect(reg.invoke('sync.now', 'nope')).rejects.toMatchObject({ code: 'bad-args' });
  });

  test('unregistering stops it being invocable', async () => {
    const { reg } = harness({ impl: { 'sync.now': async () => 'ok' } });
    reg.register('sync.now');
    expect(reg.unregister('sync.now')).toBe(true);
    await expect(reg.invoke('sync.now')).rejects.toMatchObject({ code: 'command-not-ready' });
  });
});

describe('readouts', () => {
  test('a readout asks immediately, then settles into its interval', async () => {
    // Showing nothing for five seconds after opening looks broken.
    const { reg, advance, calls } = harness({ impl: { 'sync.status': async () => 'Just now' } });
    reg.register('sync.status');
    const seen = [];
    reg.subscribeReadout('sync.status', (v) => seen.push(v), { intervalMs: 5000 });

    await advance(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].value).toBe('Just now');

    await advance(5000);
    expect(seen).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  test('polling stops with the last subscriber', async () => {
    // A settings page nobody has open must cost nothing.
    const { reg, advance } = harness({ impl: { 'sync.status': async () => 'x' } });
    reg.register('sync.status');
    const off = reg.subscribeReadout('sync.status', () => {}, { intervalMs: 5000 });
    await advance(0);
    expect(reg.isPolling()).toBe(true);
    off();
    expect(reg.isPolling()).toBe(false);
  });

  test('two subscribers share one poll', async () => {
    const { reg, advance, calls } = harness({ impl: { 'sync.status': async () => 'x' } });
    reg.register('sync.status');
    const a = []; const b = [];
    reg.subscribeReadout('sync.status', (v) => a.push(v), { intervalMs: 5000 });
    reg.subscribeReadout('sync.status', (v) => b.push(v), { intervalMs: 5000 });
    await advance(0);
    await advance(5000);
    expect(calls).toHaveLength(2);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  test('the interval has a floor — a status line is not a busy loop', async () => {
    const { reg, advance, calls } = harness({ impl: { 'sync.status': async () => 'x' } });
    reg.register('sync.status');
    reg.subscribeReadout('sync.status', () => {}, { intervalMs: 10 });
    await advance(0);
    await advance(1999);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);
  });

  test('a failing readout reports the failure and keeps polling', async () => {
    // A status that stops updating because it once failed is worse than one
    // that says it cannot read.
    const { reg, advance } = harness();
    const seen = [];
    reg.subscribeReadout('sync.status', (v) => seen.push(v), { intervalMs: 3000 });
    await advance(0);
    expect(seen[0]).toMatchObject({ value: null, error: 'command-not-ready' });
    await advance(3000);
    expect(seen).toHaveLength(2);
  });

  test('a listener that throws does not stop the others', async () => {
    const { reg, advance } = harness({ impl: { 'sync.status': async () => 'x' } });
    reg.register('sync.status');
    const good = [];
    reg.subscribeReadout('sync.status', () => { throw new Error('render bug'); }, { intervalMs: 3000 });
    reg.subscribeReadout('sync.status', (v) => good.push(v), { intervalMs: 3000 });
    await advance(0);
    expect(good.length).toBeGreaterThan(0);
  });

  test('subscribing a non-function is harmless', () => {
    const { reg } = harness();
    expect(() => reg.subscribeReadout('sync.status', null)()).not.toThrow();
    expect(reg.isPolling()).toBe(false);
  });
});

describe('disposal', () => {
  test('dispose stops every poll and refuses further work', async () => {
    const { reg, advance } = harness({ impl: { 'sync.status': async () => 'x' } });
    reg.register('sync.status');
    reg.subscribeReadout('sync.status', () => {}, { intervalMs: 3000 });
    await advance(0);
    expect(reg.isPolling()).toBe(true);

    reg.dispose();
    expect(reg.isPolling()).toBe(false);
    await expect(reg.invoke('sync.status')).rejects.toMatchObject({ code: 'extension-stopped' });
    expect(() => reg.register('sync.now')).toThrow(expect.objectContaining({ code: 'extension-stopped' }));
  });

  test('a poll in flight when dispose lands does not reschedule', async () => {
    const { reg, advance, pending } = harness({ impl: { 'sync.status': async () => 'x' } });
    reg.register('sync.status');
    reg.subscribeReadout('sync.status', () => {}, { intervalMs: 3000 });
    await advance(0);
    reg.dispose();
    await advance(3000);
    expect(pending()).toBe(0);
  });
});

describe('reading a manifest for the commands it reaches for', () => {
  const MANIFEST = {
    commands: ['sync.now', 'auth.connect', 'sync.status'],
    contributes: {
      bookActions: [
        { id: 'a', label: 'Back up now', command: 'sync.now' },
        { id: 'b', label: 'Files', page: 'cloud-files' },
      ],
    },
    settings: {
      schema: [
        { key: 'x', type: 'toggle', label: 'X' },
        { type: 'action', label: 'Connect', command: 'auth.connect' },
        { type: 'section', label: 'More', children: [
          { type: 'readout', label: 'Last copy', source: 'sync.status' },
        ] },
      ],
    },
  };

  test('it finds commands in contributions, actions and readouts alike', () => {
    expect(commandsUsedBy(MANIFEST)).toEqual(['auth.connect', 'sync.now', 'sync.status']);
  });

  test('a readout source inside a section is still found', () => {
    expect(commandsUsedBy(MANIFEST)).toContain('sync.status');
  });

  test('a fully declared manifest has nothing undeclared', () => {
    expect(undeclaredCommands(MANIFEST)).toEqual([]);
  });

  test('a button pointing at nothing is findable by reading the manifest', () => {
    // Better found while reading than by pressing it.
    const broken = { ...MANIFEST, commands: ['sync.now'] };
    expect(undeclaredCommands(broken)).toEqual(['auth.connect', 'sync.status']);
  });

  test('an empty manifest is not an error', () => {
    expect(commandsUsedBy({})).toEqual([]);
    expect(commandsUsedBy(null)).toEqual([]);
    expect(undeclaredCommands({})).toEqual([]);
  });
});
