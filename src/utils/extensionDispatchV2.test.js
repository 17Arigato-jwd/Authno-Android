import {
  createDispatch, DispatchError, freeCapabilities, activityCapabilities,
} from './extensionDispatchV2.js';
import { permissionSetFor, PermissionSet } from './extensionPermissionsV2.js';
import { createActivityMeter } from './activityMeter.js';

const MANIFEST = {
  apiVersion: 2,
  id: 'cloud-backup',
  permissions: {
    'library:read:all': { reason: 'To upload every book.' },
    activity: { reason: 'To time your writing.' },
  },
};

function build({ granted = ['library:read:all'], caps = {}, onDenied } = {}) {
  const calls = [];
  const capabilities = {
    'library.list': async (args, ctx) => { calls.push(['library.list', args, ctx.extId]); return ['a', 'b']; },
    'library.get': async ([id]) => ({ id, title: 'Book' }),
    'library.export': async () => 'exported',
    'ui.toast': async ([msg]) => { calls.push(['ui.toast', msg]); return true; },
    ...caps,
  };
  const permissions = permissionSetFor(MANIFEST, granted);
  const dispatch = createDispatch({ extId: 'cloud-backup', permissions, capabilities, onDenied });
  return { dispatch, permissions, calls };
}

describe('the gate', () => {
  test('a granted method runs and returns its result', async () => {
    const { dispatch } = build();
    await expect(dispatch('library.list', [])).resolves.toEqual(['a', 'b']);
  });

  test('an ungranted method is refused before the capability is reached', async () => {
    const ran = jest.fn();
    const { dispatch } = build({ caps: { 'library.export': ran } });
    await expect(dispatch('library.export', [])).rejects.toMatchObject({
      code: 'permission-denied', permission: 'library:export',
    });
    expect(ran).not.toHaveBeenCalled();
  });

  test('a free method needs no grant', async () => {
    const { dispatch, calls } = build({ granted: [] });
    await expect(dispatch('ui.toast', ['hi'])).resolves.toBe(true);
    expect(calls).toContainEqual(['ui.toast', 'hi']);
  });

  test('the capability receives the args and the extension id', async () => {
    const { dispatch, calls } = build();
    await dispatch('library.list', [{ limit: 5 }]);
    expect(calls[0]).toEqual(['library.list', [{ limit: 5 }], 'cloud-backup']);
  });

  test('a revoked permission takes effect on the next call, with no restart', async () => {
    const { dispatch, permissions } = build();
    await expect(dispatch('library.list', [])).resolves.toBeTruthy();
    permissions.revoke('library:read:all');
    await expect(dispatch('library.list', [])).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('a granted permission works immediately too', async () => {
    const { dispatch, permissions } = build({ granted: [] });
    await expect(dispatch('library.list', [])).rejects.toMatchObject({ code: 'permission-denied' });
    permissions.grant('library:read:all');
    await expect(dispatch('library.list', [])).resolves.toEqual(['a', 'b']);
  });

  test('denials are reported so the app can warn rather than look broken', async () => {
    const onDenied = jest.fn();
    const { dispatch } = build({ granted: [], onDenied });
    await expect(dispatch('library.list', [])).rejects.toMatchObject({ code: 'permission-denied' });
    expect(onDenied).toHaveBeenCalledWith('library:read:all', 'library.list');
  });

  test('a throwing onDenied never turns a refusal into a crash', async () => {
    const onDenied = () => { throw new Error('reporting is broken'); };
    const { dispatch } = build({ granted: [], onDenied });
    await expect(dispatch('library.list', [])).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('the door cannot be walked around', () => {
  test('prototype keys do not resolve to functions on Object.prototype', async () => {
    // `capabilities` is a plain object, so without an own-property check a
    // method named "constructor" or "toString" resolves to something real and
    // gets called.
    const { dispatch } = build();
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      await expect(dispatch(key, [])).rejects.toMatchObject({ code: 'unknown-method' });
    }
  });

  test('an unknown method is refused before it is looked up, not after', async () => {
    // If existence were checked first, an extension could enumerate the host's
    // method table by watching which names answer "unknown" and which answer
    // "denied" — a map of everything it might later be granted.
    const { dispatch } = build({ granted: [] });
    const denied = await dispatch('library.list', []).catch((e) => e);
    const unknown = await dispatch('library.nonsense', []).catch((e) => e);
    expect(denied.code).toBe('permission-denied');
    expect(unknown.code).toBe('unknown-method');

    // And a gated method the host has not implemented still reads as denied
    // while the permission is missing, revealing nothing about the table.
    const notImplemented = await dispatch('library.create', []).catch((e) => e);
    expect(notImplemented.code).toBe('permission-denied');
  });

  test('a bad method name is refused', async () => {
    const { dispatch } = build();
    for (const bad of [null, undefined, 42, {}, [], '']) {
      await expect(dispatch(bad, [])).rejects.toMatchObject({ code: 'bad-method' });
    }
  });

  test('args must be an array, and a bounded one', async () => {
    const { dispatch } = build();
    await expect(dispatch('library.list', 'nope')).rejects.toMatchObject({ code: 'bad-args' });
    await expect(dispatch('library.list', { 0: 'a' })).rejects.toMatchObject({ code: 'bad-args' });
    await expect(dispatch('library.list', new Array(9).fill(1)))
      .rejects.toMatchObject({ code: 'too-many-args' });
  });

  test('a capability that throws becomes a catchable refusal, without a stack', async () => {
    const { dispatch } = build({
      caps: { 'library.list': async () => { throw new Error('disk on fire'); } },
    });
    const err = await dispatch('library.list', []).catch((e) => e);
    expect(err).toBeInstanceOf(DispatchError);
    expect(err.code).toBe('capability-failed');
    expect(err.message).toBe('disk on fire');
    // A host stack would tell the sandbox about paths it has no business knowing.
    expect(String(err.message)).not.toMatch(/\/home\/|\.js:\d+/);
  });

  test('a disposed dispatch answers nothing', async () => {
    const { dispatch } = build();
    dispatch.dispose();
    expect(dispatch.isDisposed()).toBe(true);
    await expect(dispatch('library.list', [])).rejects.toMatchObject({ code: 'extension-stopped' });
    await expect(dispatch('ui.toast', ['hi'])).rejects.toMatchObject({ code: 'extension-stopped' });
  });
});

describe('the free capabilities', () => {
  const harness = () => {
    const store = new Map();
    const seen = [];
    const caps = freeCapabilities({
      extId: 'demo',
      storage: {
        get: async (k) => (store.has(k) ? store.get(k) : null),
        set: async (k, v) => { store.set(k, v); return true; },
        remove: async (k) => store.delete(k),
        keys: async () => [...store.keys()],
      },
      ui: {
        toast: async (m) => { seen.push(['toast', m]); return true; },
        navigate: async (id, page) => { seen.push(['navigate', id, page]); return true; },
        prompt: async (id, o) => { seen.push(['prompt', id, o]); return 'typed'; },
        confirm: async () => false,
        overlaySet: async (id, t) => { seen.push(['overlay', id, t]); return true; },
        overlayClear: async () => true,
      },
      app: { version: () => '1.1.20', platform: () => 'web', locale: () => 'en' },
    });
    const dispatch = createDispatch({
      extId: 'demo', permissions: new PermissionSet([]), capabilities: caps,
    });
    return { dispatch, store, seen };
  };

  test('storage round-trips', async () => {
    const { dispatch } = harness();
    await dispatch('storage.set', ['k', 'v']);
    await expect(dispatch('storage.get', ['k'])).resolves.toBe('v');
    await expect(dispatch('storage.keys', [])).resolves.toEqual(['k']);
    await dispatch('storage.remove', ['k']);
    await expect(dispatch('storage.get', ['k'])).resolves.toBeNull();
  });

  test('getJSON returns the fallback for corrupt data, not undefined', async () => {
    // Undefined would let a caller mistake "broken" for "absent" and write
    // over it — the bug every hand-rolled version of this has.
    const { dispatch, store } = harness();
    store.set('cfg', '{not json');
    await expect(dispatch('storage.getJSON', ['cfg', { a: 1 }])).resolves.toEqual({ a: 1 });
    await expect(dispatch('storage.getJSON', ['missing', { b: 2 }])).resolves.toEqual({ b: 2 });
    await expect(dispatch('storage.getJSON', ['missing'])).resolves.toBeNull();
  });

  test('setJSON and getJSON agree', async () => {
    const { dispatch } = harness();
    await dispatch('storage.setJSON', ['cfg', { deep: { x: [1, 2] } }]);
    await expect(dispatch('storage.getJSON', ['cfg'])).resolves.toEqual({ deep: { x: [1, 2] } });
  });

  test('prompt and confirm are host-drawn and carry the extension id', async () => {
    const { dispatch, seen } = harness();
    await expect(dispatch('ui.prompt', [{ title: 'Name?' }])).resolves.toBe('typed');
    await expect(dispatch('ui.confirm', [{ title: 'Sure?' }])).resolves.toBe(false);
    expect(seen).toContainEqual(['prompt', 'demo', { title: 'Name?' }]);
  });

  test('the overlay is set per extension, and the host owns the colour', async () => {
    const { dispatch, seen } = harness();
    await dispatch('ui.overlay.set', ['1,204 words']);
    expect(seen).toContainEqual(['overlay', 'demo', '1,204 words']);
    await expect(dispatch('ui.overlay.clear', [])).resolves.toBe(true);
  });

  test('every free capability really is reachable without a grant', async () => {
    const { dispatch } = harness();
    for (const method of [
      'app.version', 'app.platform', 'app.locale',
      'ui.toast', 'ui.navigate', 'ui.prompt', 'ui.confirm',
      'ui.overlay.set', 'ui.overlay.clear',
      'storage.get', 'storage.set', 'storage.remove', 'storage.keys',
      'storage.getJSON', 'storage.setJSON',
    ]) {
      // Reaching the capability at all is the assertion: a missing grant
      // would surface as permission-denied before the capability ran.
      const outcome = await dispatch(method, ['k', 'v']).then(() => 'ran', (e) => e.code);
      expect({ method, outcome }).toEqual({ method, outcome: 'ran' });
    }
  });
});

describe('activity is gated and stays bucketed', () => {
  function activityHarness(granted) {
    let t = 0;
    let tick = null;
    const meter = createActivityMeter({
      now: () => t,
      setIntervalFn: (fn) => { tick = fn; return 1; },
      clearIntervalFn: () => { tick = null; },
    });
    const pushed = [];
    const caps = activityCapabilities({ meter, push: (e) => pushed.push(e) });
    const dispatch = createDispatch({
      extId: 'timer',
      permissions: permissionSetFor(MANIFEST, granted),
      capabilities: caps,
    });
    return {
      dispatch, meter, pushed, caps,
      advance: (ms) => { t += ms; },
      bucket: (ms = 1000) => { t += ms; if (tick) tick(); },
      running: () => tick !== null,
    };
  }

  test('without the permission, neither method answers', async () => {
    const h = activityHarness([]);
    await expect(h.dispatch('activity.getRate', [])).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(h.dispatch('activity.onWriting', [true])).rejects.toMatchObject({ code: 'permission-denied' });
    expect(h.running()).toBe(false);
  });

  test('with it, the extension gets a 1 Hz stream', async () => {
    const h = activityHarness(['activity']);
    await h.dispatch('activity.onWriting', [true]);
    h.meter.record(7);
    h.bucket();
    expect(h.pushed.some((e) => e.type === 'writing' && e.charsPerSecond === 7)).toBe(true);
  });

  test('polling getRate cannot beat the bucket', async () => {
    // Two reads inside one second must return the same number, or an extension
    // could sample its way to finer timing than the meter is meant to expose.
    const h = activityHarness(['activity']);
    await h.dispatch('activity.onWriting', [true]);
    h.meter.record(3);
    h.bucket();

    h.advance(100);
    const a = await h.dispatch('activity.getRate', []);
    h.meter.record(5);
    h.advance(300);
    const b = await h.dispatch('activity.getRate', []);
    expect(b.charsPerSecond).toBe(a.charsPerSecond);
  });

  test('unsubscribing stops the meter, so the editor stops paying', async () => {
    const h = activityHarness(['activity']);
    await h.dispatch('activity.onWriting', [true]);
    expect(h.running()).toBe(true);
    await h.dispatch('activity.onWriting', [false]);
    expect(h.running()).toBe(false);
  });

  test('teardown drops the subscription even if the extension never did', async () => {
    const h = activityHarness(['activity']);
    await h.dispatch('activity.onWriting', [true]);
    h.caps.__unsubscribe();
    expect(h.running()).toBe(false);
  });

  test('revoking activity mid-session stops the next call', async () => {
    const h = activityHarness(['activity']);
    await h.dispatch('activity.getRate', []);
    const perms = permissionSetFor(MANIFEST, ['activity']);
    perms.revoke('activity');
    const stopped = createDispatch({
      extId: 'timer', permissions: perms, capabilities: h.caps,
    });
    await expect(stopped('activity.getRate', [])).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
