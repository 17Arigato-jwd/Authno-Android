/**
 * Starting and stopping a v2 extension.
 *
 * Following the note in extensionSandbox.test.js: what is NOT here is whether
 * the frame is really isolated. jsdom has no origin model, so such a test would
 * pass just as happily against a frame carrying `allow-same-origin` — that
 * claim belongs to `npm run check:sandbox` in a real browser.
 *
 * What IS here is everything decided before the browser gets involved: which
 * document is built, which policy is inside it, which messages are believed,
 * and what teardown lets go of.
 */

import {
  runExtensionV2, stopExtensionV2, stopAllV2, runningV2, hostFor,
} from './extensionRunnerV2.js';
import { FRAME_SANDBOX } from './sandboxProtocol.js';
import { createActivityMeter } from './activityMeter.js';

const MANIFEST = {
  apiVersion: 2,
  id: 'demo',
  name: 'Demo',
  version: '2.0.0',
  permissions: {
    'library:read:all': { reason: 'To read your books.' },
    network: { reason: 'To sync.', hosts: ['https://api.example.com'] },
  },
};

function handlers() {
  const store = new Map();
  return {
    storage: {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => { store.set(k, v); return true; },
      remove: async (k) => store.delete(k),
      keys: async () => [...store.keys()],
    },
    ui: {
      toast: async () => true, navigate: async () => true,
      prompt: async () => null, confirm: async () => false,
      overlaySet: async () => true, overlayClear: async () => true,
    },
    app: { version: () => '1.1.20', platform: () => 'web', locale: () => 'en' },
    library: { list: async () => [], get: async () => null, currentId: () => null },
  };
}

/**
 * A frame that answers the way a real one does, without executing anything.
 * jsdom will not run a srcdoc script, so the handshake is played by hand.
 */
function fakeDom({ autoReady = true, readyError = null, autoBoot = true, onDeactivate = null } = {}) {
  const listeners = [];
  const posted = [];
  const frames = [];

  const contentWindow = {
    postMessage(msg) {
      posted.push(msg);
      if (msg.type === 'ext-load' && autoReady) {
        deliver(readyError ? { type: 'ext-ready', error: readyError } : { type: 'ext-ready' });
      }
      if (msg.type === 'ext-deactivate') {
        // A real extension's deactivate() makes its last host calls BEFORE
        // reporting that it has finished. Answering instantly would model a
        // frame that never writes on the way out, which is the case that
        // cannot catch a dispose-too-early bug.
        if (onDeactivate) onDeactivate(deliver);
        deliver({ type: 'ext-deactivated' });
      }
    },
  };

  function deliver(data, source = contentWindow) {
    for (const fn of [...listeners]) fn({ source, data });
  }

  // A real frame starts loading when it is appended, and posts `ext-boot` from
  // inside itself once the bootstrap runs. Booting any earlier than this would
  // fire before the host has added its message listener — which is exactly
  // what the first version of this harness did, and every test timed out.
  const body = {
    appendChild: (el) => {
      frames.push(el);
      if (autoBoot) setTimeout(() => deliver({ type: 'ext-boot' }), 0);
    },
  };
  const document = {
    body,
    createElement: () => {
      const attrs = {};
      return {
        style: {},
        setAttribute: (k, v) => { attrs[k] = v; },
        getAttribute: (k) => attrs[k],
        get attrs() { return attrs; },
        contentWindow,
        removed: false,
        remove() { this.removed = true; },
      };
    },
  };
  const window = {
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: (t, fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };

  return {
    dom: { document, window },
    frames, posted, deliver, contentWindow,
    listenerCount: () => listeners.length,
    /** Play the frame's side of the handshake by hand, if autoBoot is off. */
    boot: () => deliver({ type: 'ext-boot' }),
  };
}

afterEach(async () => { await stopAllV2(); });

describe('a v1 extension is refused, not adapted', () => {
  test('a manifest with no apiVersion is refused with a readable reason', async () => {
    const f = fakeDom();
    const r = await runExtensionV2({
      manifest: { id: 'old', name: 'Old', version: '1.5.0' },
      handlers: handlers(), dom: f.dom,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rebuild it with extbk build against v2/);
    expect(f.frames).toHaveLength(0);
  });

  test('a future apiVersion is refused too', async () => {
    const f = fakeDom();
    const r = await runExtensionV2({
      manifest: { ...MANIFEST, apiVersion: 3 }, handlers: handlers(), dom: f.dom,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/apiVersion 3 is not supported/);
  });

  test('an invalid v2 manifest is refused before a frame exists', async () => {
    const f = fakeDom();
    const r = await runExtensionV2({
      manifest: { apiVersion: 2, id: 'a/b', name: 'X', version: '1.0.0' },
      handlers: handlers(), dom: f.dom,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/id may contain only/);
    expect(f.frames).toHaveLength(0);
  });
});

describe('the frame that gets built', () => {
  test('it carries allow-scripts and nothing else', async () => {
    const f = fakeDom();
    const r = await runExtensionV2({
      manifest: MANIFEST, granted: [], handlers: handlers(), dom: f.dom,
    });
    expect(r.ok).toBe(true);
    const frame = f.frames[0];
    expect(frame.getAttribute('sandbox')).toBe(FRAME_SANDBOX);
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  test('its document carries the policy for the grants actually held', async () => {
    const f = fakeDom();
    await runExtensionV2({
      manifest: MANIFEST, granted: ['library:read:all'], handlers: handlers(), dom: f.dom,
    });
    const doc = f.frames[0].srcdoc;
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain("default-src &#x27;none&#x27;".replace(/&#x27;/g, "'"));
    // network was not granted, so no host may appear anywhere in the policy.
    expect(doc).not.toContain('api.example.com');
    expect(doc).toContain("connect-src &#x27;none&#x27;".replace(/&#x27;/g, "'"));
  });

  test('granting network puts the declared host in the document', async () => {
    const f = fakeDom();
    await runExtensionV2({
      manifest: MANIFEST, granted: ['network'], handlers: handlers(), dom: f.dom,
    });
    expect(f.frames[0].srcdoc).toContain('https://api.example.com');
  });

  test('the frame is hidden and labelled', async () => {
    const f = fakeDom();
    await runExtensionV2({ manifest: MANIFEST, handlers: handlers(), dom: f.dom });
    const frame = f.frames[0];
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.getAttribute('title')).toContain('Demo');
    expect(frame.style.cssText).toContain('visibility:hidden');
  });

  test('the entry module is listed last', async () => {
    const f = fakeDom();
    await runExtensionV2({
      manifest: MANIFEST, handlers: handlers(), dom: f.dom,
      files: { 'index.js': 'entry', 'lib/a.js': 'a', 'lib/b.js': 'b' },
      entry: 'index.js',
    });
    const load = f.posted.find((m) => m.type === 'ext-load');
    expect(load.modules.map((m) => m.path).at(-1)).toBe('index.js');
    expect(load.modules).toHaveLength(3);
  });
});

describe('only this frame is believed', () => {
  test('a message from another window is ignored', async () => {
    const f = fakeDom();
    await runExtensionV2({
      manifest: MANIFEST, granted: ['library:read:all'], handlers: handlers(), dom: f.dom,
    });
    const before = f.posted.length;

    // Identity, not origin: an opaque frame reports origin "null" and so do
    // several other things, so the window reference is the only real check.
    f.deliver({ type: 'ext-call', id: 99, method: 'library.list', args: [] }, { notOurFrame: true });
    await Promise.resolve();

    expect(f.posted.length).toBe(before);
  });

  test('a call from this frame is answered', async () => {
    const f = fakeDom();
    await runExtensionV2({
      manifest: MANIFEST, granted: ['library:read:all'], handlers: handlers(), dom: f.dom,
    });
    f.deliver({ type: 'ext-call', id: 1, method: 'library.list', args: [] });
    await new Promise((r) => setTimeout(r, 0));

    const reply = f.posted.find((m) => m.type === 'ext-reply' && m.id === 1);
    expect(reply.error).toBeNull();
    expect(reply.result).toEqual([]);
  });

  test('an ungranted call comes back as an error, not a dropped channel', async () => {
    const f = fakeDom();
    await runExtensionV2({ manifest: MANIFEST, granted: [], handlers: handlers(), dom: f.dom });
    f.deliver({ type: 'ext-call', id: 2, method: 'library.list', args: [] });
    await new Promise((r) => setTimeout(r, 0));

    const reply = f.posted.find((m) => m.type === 'ext-reply' && m.id === 2);
    expect(reply.result).toBeNull();
    expect(reply.error).toMatch(/permission-denied/);
  });
});

describe('lifecycle', () => {
  test('a started extension is listed and has a host', async () => {
    const f = fakeDom();
    await runExtensionV2({ manifest: MANIFEST, handlers: handlers(), dom: f.dom });
    expect(runningV2()).toEqual(['demo']);
    expect(hostFor('demo')).not.toBeNull();
  });

  test('activation that fails leaves nothing running or listening', async () => {
    const f = fakeDom({ readyError: 'no activate() export' });
    const r = await runExtensionV2({ manifest: MANIFEST, handlers: handlers(), dom: f.dom });
    expect(r.ok).toBe(false);
    expect(runningV2()).toEqual([]);
    expect(f.frames[0].removed).toBe(true);
    expect(f.listenerCount()).toBe(0);
  });

  test('activation that never answers times out and cleans up', async () => {
    const f = fakeDom({ autoReady: false });
    const r = await runExtensionV2({
      manifest: MANIFEST, handlers: handlers(), dom: f.dom, activateTimeoutMs: 10,
    });
    expect(r).toMatchObject({ ok: false, error: 'activation timed out' });
    expect(runningV2()).toEqual([]);
    expect(f.frames[0].removed).toBe(true);
  });

  test('stopping removes the frame, the listener and the dispatcher', async () => {
    const f = fakeDom();
    await runExtensionV2({
      manifest: MANIFEST, granted: ['library:read:all'], handlers: handlers(), dom: f.dom,
    });
    const host = hostFor('demo');

    expect(await stopExtensionV2('demo')).toBe(true);
    expect(runningV2()).toEqual([]);
    expect(f.frames[0].removed).toBe(true);
    expect(f.listenerCount()).toBe(0);
    await expect(host.dispatch('library.list', []))
      .rejects.toMatchObject({ code: 'extension-stopped' });
  });

  test('dispose happens AFTER teardown, so a last write still lands', async () => {
    // An extension's deactivate() flushes its queue, and those are host calls
    // that need the app still answering. Disposing first would refuse them —
    // silently losing whatever the extension was saving on the way out.
    const f = fakeDom({
      onDeactivate: (deliver) => {
        deliver({ type: 'ext-call', id: 7, method: 'storage.set', args: ['last', 'write'] });
      },
    });
    await runExtensionV2({
      manifest: MANIFEST, granted: ['library:read:all'], handlers: handlers(), dom: f.dom,
    });

    await stopExtensionV2('demo');
    await new Promise((r) => setTimeout(r, 0));

    const reply = f.posted.find((m) => m.type === 'ext-reply' && m.id === 7);
    expect(reply).toBeDefined();
    expect(reply.error).toBeNull();
  });

  test('stopping something that is not running is harmless', async () => {
    expect(await stopExtensionV2('nobody')).toBe(false);
  });

  test('starting the same id twice replaces rather than duplicates', async () => {
    const f = fakeDom();
    await runExtensionV2({ manifest: MANIFEST, handlers: handlers(), dom: f.dom });
    await runExtensionV2({ manifest: MANIFEST, handlers: handlers(), dom: f.dom });
    expect(runningV2()).toEqual(['demo']);
    expect(f.frames[0].removed).toBe(true);
    expect(f.frames[1].removed).toBe(false);
  });

  test('an activity subscription is released when the extension stops', async () => {
    let tick = null;
    const meter = createActivityMeter({
      now: () => 0,
      setIntervalFn: (fn) => { tick = fn; return 1; },
      clearIntervalFn: () => { tick = null; },
    });
    const withActivity = {
      ...MANIFEST,
      permissions: { ...MANIFEST.permissions, activity: { reason: 'To time writing.' } },
    };
    const f = fakeDom();
    await runExtensionV2({
      manifest: withActivity, granted: ['activity'], handlers: handlers(), dom: f.dom, meter,
    });

    f.deliver({ type: 'ext-call', id: 3, method: 'activity.onWriting', args: [true] });
    await new Promise((r) => setTimeout(r, 0));
    expect(tick).not.toBeNull();

    await stopExtensionV2('demo');
    expect(tick).toBeNull();
  });

  test('activity events are pushed into the frame', async () => {
    let tick = null;
    const meter = createActivityMeter({
      now: () => 0,
      setIntervalFn: (fn) => { tick = fn; return 1; },
      clearIntervalFn: () => { tick = null; },
    });
    const withActivity = {
      ...MANIFEST,
      permissions: { ...MANIFEST.permissions, activity: { reason: 'To time writing.' } },
    };
    const f = fakeDom();
    await runExtensionV2({
      manifest: withActivity, granted: ['activity'], handlers: handlers(), dom: f.dom, meter,
    });

    f.deliver({ type: 'ext-call', id: 4, method: 'activity.onWriting', args: [true] });
    await new Promise((r) => setTimeout(r, 0));
    meter.record(5);
    tick();

    const event = f.posted.find((m) => m.type === 'ext-event');
    expect(event.event.charsPerSecond).toBe(5);
  });

  test('running with no DOM is refused rather than throwing', async () => {
    const r = await runExtensionV2({
      manifest: MANIFEST, handlers: handlers(), dom: { document: null, window: null },
    });
    expect(r).toMatchObject({ ok: false, error: 'no DOM to run an extension in' });
  });
});
