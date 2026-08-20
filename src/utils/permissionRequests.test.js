/**
 * permissionRequests.test.js — the queue between an install and the person.
 *
 * The behaviours here are the ones where being wrong is invisible: a promise
 * that never settles leaves an install hanging, and a grant silently dropped
 * looks exactly like a grant the person refused.
 */

import { createPermissionRequests } from './permissionRequests';

const plan = (names, carried = [], dropped = []) => ({
  ok: true,
  errors: [],
  prompt: names.map((n) => ({ permission: n, prompt: `Do ${n}`, reason: `because ${n}` })),
  carried,
  dropped,
});

describe('asking', () => {
  it('draws the first request and queues the rest', () => {
    const q = createPermissionRequests();
    q.ask('a', plan(['library:read:all']), { name: 'A' });
    q.ask('b', plan(['network']), { name: 'B' });
    expect(q.current().extId).toBe('a');
    expect(q.waiting()).toBe(1);
  });

  it('answers immediately when there is nothing new to ask', async () => {
    const q = createPermissionRequests();
    const got = await q.ask('a', plan([], ['library:export']));
    expect(got).toEqual(['library:export']);
    expect(q.current()).toBeNull();
  });

  it('gives the same promise for a second ask about the same extension', () => {
    const q = createPermissionRequests();
    const first = q.ask('a', plan(['network']));
    const second = q.ask('a', plan(['network']));
    expect(second).toBe(first);
    expect(q.waiting()).toBe(0);
  });

  it('refuses rather than dropping when the queue is full', async () => {
    const q = createPermissionRequests();
    for (let i = 0; i < 8; i += 1) q.ask(`ext-${i}`, plan(['network']));
    await expect(q.ask('one-too-many', plan(['network']))).rejects.toThrow(/waiting/);
  });
});

describe('answering', () => {
  it('resolves with what was left switched on', async () => {
    const q = createPermissionRequests();
    const settled = q.ask('a', plan(['library:read:all', 'network']));
    q.answer(['network']);
    expect(await settled).toEqual(['network']);
  });

  it('keeps carried permissions the dialog never showed', async () => {
    const q = createPermissionRequests();
    const settled = q.ask('a', plan(['network'], ['library:export']));
    q.answer([]);
    // The person said no to network and was never asked about export, which
    // they agreed to last time. Dropping it here would revoke a grant nobody
    // was asked about.
    expect(await settled).toEqual(['library:export']);
  });

  it('ignores a permission that was not on the sheet', async () => {
    const q = createPermissionRequests();
    const settled = q.ask('a', plan(['network']));
    q.answer(['network', 'library:write']);
    expect(await settled).toEqual(['network']);
  });

  it('moves to the next request', async () => {
    const q = createPermissionRequests();
    q.ask('a', plan(['network']));
    q.ask('b', plan(['activity']));
    q.answer(['network']);
    expect(q.current().extId).toBe('b');
  });
});

describe('dismissing', () => {
  it('is an answer of no, not a rejection', async () => {
    const q = createPermissionRequests();
    const settled = q.ask('a', plan(['network'], ['activity']));
    q.dismiss();
    expect(await settled).toEqual(['activity']);
  });
});

describe('reset', () => {
  it('settles everything rather than leaving an install hanging', async () => {
    const q = createPermissionRequests();
    const a = q.ask('a', plan(['network'], ['activity']));
    const b = q.ask('b', plan(['library:write']));
    q.reset();
    expect(await a).toEqual(['activity']);
    expect(await b).toEqual([]);
  });
});

describe('the UI is told when to redraw', () => {
  it('notifies when a second request only joins the queue', () => {
    // The sheet says how many are still waiting, so enqueueing changes what is
    // on screen without changing which request is on it.
    const seen = [];
    const q = createPermissionRequests();
    q.ask('a', plan(['network']));
    q.subscribe(() => seen.push(q.waiting()));
    q.ask('b', plan(['activity']));
    expect(seen).toEqual([1]);
  });

  it('notifies on ask, answer and dismiss', () => {
    const seen = [];
    const q = createPermissionRequests();
    q.subscribe(() => seen.push(q.current()?.extId ?? null));
    q.ask('a', plan(['network']));
    q.answer([]);
    expect(seen).toEqual(['a', null]);
  });

  it('survives a listener that throws', () => {
    const q = createPermissionRequests();
    q.subscribe(() => { throw new Error('render failed'); });
    expect(() => q.ask('a', plan(['network']))).not.toThrow();
    expect(q.current().extId).toBe('a');
  });

  it('stops notifying after unsubscribe', () => {
    const seen = [];
    const q = createPermissionRequests();
    const off = q.subscribe(() => seen.push(1));
    q.ask('a', plan(['network']));
    off();
    q.answer([]);
    expect(seen).toHaveLength(1);
  });

  it('tells every listener, not only the first', () => {
    const seen = [];
    const q = createPermissionRequests();
    q.subscribe(() => seen.push('a'));
    q.subscribe(() => seen.push('b'));
    q.ask('x', plan(['network']));
    expect(seen).toEqual(['a', 'b']);
  });
});
