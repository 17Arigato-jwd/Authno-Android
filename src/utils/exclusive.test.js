import { makeGate } from './exclusive';

describe('makeGate', () => {
  test('the first caller gets in', () => {
    const g = makeGate();
    expect(g.tryEnter()).toBe(true);
    expect(g.isRunning).toBe(true);
  });

  test('a second caller is turned away while the first holds it', () => {
    const g = makeGate();
    g.tryEnter();
    expect(g.tryEnter()).toBe(false);
    expect(g.tryEnter()).toBe(false);
  });

  test('exit reports that someone was turned away', () => {
    const g = makeGate();
    g.tryEnter();
    g.tryEnter();          // turned away
    expect(g.exit()).toBe(true);
  });

  test('exit reports nothing when no one was turned away', () => {
    const g = makeGate();
    g.tryEnter();
    expect(g.exit()).toBe(false);
  });

  test('many turned away still means exactly one re-run', () => {
    // Re-running once is enough: every turned-away pass would have done the
    // same work against the same current state.
    const g = makeGate();
    g.tryEnter();
    for (let i = 0; i < 50; i++) g.tryEnter();
    expect(g.exit()).toBe(true);
    g.tryEnter();
    expect(g.exit()).toBe(false); // the backlog does not accumulate
  });

  test('the gate reopens after exit', () => {
    const g = makeGate();
    g.tryEnter();
    g.exit();
    expect(g.isRunning).toBe(false);
    expect(g.tryEnter()).toBe(true);
  });

  test('holds across a real await, which is the case it exists for', async () => {
    const g = makeGate();
    const order = [];

    const pass = async (label, ms) => {
      if (!g.tryEnter()) { order.push(`${label}:turned-away`); return; }
      try {
        order.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${label}:end`);
      } finally {
        if (g.exit()) order.push('rescheduled');
      }
    };

    // Second starts while the first is still awaiting — the exact shape of the
    // autosave race: a write slower than the debounce that re-arms it.
    const first = pass('A', 30);
    await new Promise((r) => setTimeout(r, 5));
    await pass('B', 1);
    await first;

    // B never ran concurrently, and the work was not silently lost.
    expect(order).toEqual(['A:start', 'B:turned-away', 'A:end', 'rescheduled']);
  });

  test('two gates do not share state', () => {
    const a = makeGate();
    const b = makeGate();
    a.tryEnter();
    expect(b.tryEnter()).toBe(true);
  });
});
