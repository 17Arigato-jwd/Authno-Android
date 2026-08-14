/**
 * Waiting for a redirect to come home, on both platforms.
 *
 * The failure mode everything here guards is the same one: a promise that
 * never settles. Whatever is spinning on it — a sign-in button, an extension's
 * authorisation — spins for the rest of the session, and nothing is logged
 * because nothing went wrong, exactly.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Desktop: main.js feeds an IPC channel and answers one question on the way in. */
function mockElectron({ pending = null } = {}) {
  const listeners = new Set();
  window.electron = {
    onDeepLink: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    claimPendingDeepLink: async () => pending,
    isDeepLinkRegistered: async () => true,
  };
  return {
    deliver: (url) => { for (const fn of [...listeners]) fn(url); },
    listenerCount: () => listeners.size,
  };
}

/** Android: Capacitor's appUrlOpen. */
function mockCapacitor() {
  const listeners = new Set();
  jest.doMock('@capacitor/app', () => ({
    App: {
      addListener: async (_name, fn) => {
        const wrapped = (url) => fn({ url });
        listeners.add(wrapped);
        return { remove: async () => { listeners.delete(wrapped); } };
      },
    },
  }), { virtual: true });
  return {
    deliver: (url) => { for (const fn of [...listeners]) fn(url); },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => { delete window.electron; jest.resetModules(); });

describe('on desktop', () => {
  test('a link that arrives while waiting resolves with its parameters', async () => {
    const bus = mockElectron();
    const { awaitDeepLink } = require('./deepLinkBus');

    const p = awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive');
    await flush();
    bus.deliver('com.aurorastudios.authno://oauth2/gdrive?code=abc&state=xyz');
    await expect(p).resolves.toEqual({ code: 'abc', state: 'xyz' });
  });

  /**
   * The cold start. Clicking "Open AuthNo?" with the app closed LAUNCHES it,
   * so the URL exists before anything in the renderer could have subscribed.
   */
  test('a link that arrived before anyone was listening still resolves', async () => {
    mockElectron({ pending: 'com.aurorastudios.authno://oauth2/gdrive?code=early' });
    const { awaitDeepLink } = require('./deepLinkBus');
    await expect(awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive'))
      .resolves.toEqual({ code: 'early' });
  });

  test('a link for another flow is ignored rather than resolving the wrong one', async () => {
    const bus = mockElectron();
    const { awaitDeepLink } = require('./deepLinkBus');

    const p = awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive', { timeoutMs: 120 });
    await flush();
    // The app's own sign-in coming home mid-flow. An extension waiting on a
    // Drive redirect must not be handed the handoff meant for the gate.
    bus.deliver('authno://auth/google?google=SECRET-HANDOFF');
    bus.deliver('com.aurorastudios.authno://oauth2/dropbox?code=other');
    await expect(p).rejects.toThrow('deep-link-timeout');
  });

  test('the listener is dropped once it has settled', async () => {
    const bus = mockElectron();
    const { awaitDeepLink } = require('./deepLinkBus');

    const p = awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive');
    await flush();
    expect(bus.listenerCount()).toBe(1);
    bus.deliver('com.aurorastudios.authno://oauth2/gdrive?code=1');
    await p;
    await flush();
    // A second attempt stacking a second listener would settle the first
    // attempt's promise with the second attempt's code.
    expect(bus.listenerCount()).toBe(0);
  });

  /**
   * A redirect that lands carrying nothing resolves empty rather than
   * rejecting. That is the useful distinction: rejecting would make it
   * indistinguishable from nothing arriving at all, and the two want different
   * things said to the writer — one is "the provider refused", the other is
   * "you closed the tab".
   */
  test('a redirect with no parameters resolves empty, not rejected', async () => {
    const bus = mockElectron();
    const { awaitDeepLink } = require('./deepLinkBus');
    const p = awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive');
    await flush();
    bus.deliver('com.aurorastudios.authno://oauth2/gdrive');
    await expect(p).resolves.toEqual({});
  });

  /**
   * A refusal is an answer. Providers send `?error=access_denied` when
   * somebody says no, and swallowing it would leave the caller waiting on a
   * consent screen that has already been dismissed.
   */
  test('a provider refusal is handed through rather than swallowed', async () => {
    const bus = mockElectron();
    const { awaitDeepLink } = require('./deepLinkBus');
    const p = awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive');
    await flush();
    bus.deliver('com.aurorastudios.authno://oauth2/gdrive?error=access_denied');
    await expect(p).resolves.toEqual({ error: 'access_denied' });
  });

  test('nothing arriving times out rather than hanging', async () => {
    mockElectron();
    const { awaitDeepLink } = require('./deepLinkBus');
    await expect(awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive', { timeoutMs: 60 }))
      .rejects.toThrow('deep-link-timeout');
  });
});

describe('on Android', () => {
  test('appUrlOpen resolves the same way', async () => {
    const bus = mockCapacitor();
    const { awaitDeepLink } = require('./deepLinkBus');

    const p = awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive');
    await flush();
    bus.deliver('com.aurorastudios.authno://oauth2/gdrive?code=abc');
    await expect(p).resolves.toEqual({ code: 'abc' });
  });

  test('and its listener is removed too', async () => {
    const bus = mockCapacitor();
    const { awaitDeepLink } = require('./deepLinkBus');
    const p = awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive');
    await flush();
    bus.deliver('com.aurorastudios.authno://oauth2/gdrive?code=1');
    await p;
    await flush();
    expect(bus.listenerCount()).toBe(0);
  });
});

describe('on a plain web build', () => {
  /**
   * No Electron and no Capacitor. Nothing can deliver a deep link, and the
   * honest answer is to fail rather than to wait for one.
   */
  test('it fails instead of waiting forever', async () => {
    jest.doMock('@capacitor/app', () => { throw new Error('no capacitor'); }, { virtual: true });
    const { awaitDeepLink } = require('./deepLinkBus');
    await expect(awaitDeepLink('com.aurorastudios.authno://oauth2/gdrive', { timeoutMs: 80 }))
      .rejects.toThrow(/deep-link-(unavailable|timeout)/);
  });
});
