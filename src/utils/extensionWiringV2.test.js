/**
 * extensionWiringV2.test.js — the seams between the v2 model and the app.
 *
 * Every module the v2 work built is tested on its own, thoroughly, and all of
 * those tests passed while four capabilities did not reach the app at all:
 *
 *   - `handlers.browser` was never built, so `browser.open`, `auth.oauth` and
 *     `auth.requestDriveToken` came back `unknown-method` — a permission a
 *     user could grant and an extension could never use.
 *   - `handlers.network` likewise, so `network.requestHost` could not be
 *     called and a WebDAV server could never be added.
 *   - `currentId` was not supplied, so `library:read:current` refused every
 *     read with "no book is open" while a book was open.
 *   - `exportSessionAs` was not supplied, so `library.export` answered
 *     "this build cannot export books".
 *
 * That is what a seam is: both halves correct, nothing joining them. These
 * tests assert the join, at the level of "the capability exists and the call
 * arrives", because the halves themselves are covered elsewhere.
 */

import { createExtensionHost } from './extensionHostV2';

const MANIFEST = {
  apiVersion: 2,
  id: 'wiring-probe',
  name: 'Wiring Probe',
  version: '1.0.0',
  minAppVersion: '1.1.20-beta.0',
  permissions: {
    'library:read:current': { reason: 'To read the open book.' },
    'library:export': { reason: 'To turn it into a file.' },
    browser: { reason: 'To sign in.' },
    network: {
      reason: 'To reach a server.',
      hosts: ['https://example.com'],
      userHosts: { reason: 'To reach the one you type in.', max: 2 },
    },
  },
};

const OPEN_BOOK = { id: 'open-1', title: 'The Open One', chapters: [{ title: 'I', content: 'a b c' }] };
const OTHER_BOOK = { id: 'other-1', title: 'Not Open', chapters: [] };

function handlers(over = {}) {
  return {
    app: { version: () => '1.1.20', platform: () => 'android', locale: () => 'en' },
    ui: {
      toast: () => null, navigate: () => null,
      prompt: () => Promise.resolve(''), confirm: () => Promise.resolve(true),
      overlaySet: () => null, overlayClear: () => null,
    },
    storage: { get: async () => null, set: async () => null, remove: async () => null, keys: async () => [] },
    library: {
      list: async () => [OPEN_BOOK, OTHER_BOOK],
      get: async (id) => [OPEN_BOOK, OTHER_BOOK].find((b) => b.id === id) ?? null,
      currentId: () => OPEN_BOOK.id,
      exportAs: async (book, format) => ({ filename: `${book.title}.${format}`, base64: 'AA==' }),
    },
    ...over,
  };
}

function hostWith(over = {}, granted = ['library:read:current', 'library:export', 'browser', 'network'], userHosts = []) {
  return createExtensionHost({ manifest: MANIFEST, granted, userHosts, handlers: handlers(over) });
}

describe('library:read:current reaches the open book', () => {
  it('answers for the book that is open', async () => {
    const host = hostWith();
    const book = await host.dispatch('library.get', [OPEN_BOOK.id]);
    expect(book.title).toBe('The Open One');
  });

  it('still refuses any other book', async () => {
    const host = hostWith();
    await expect(host.dispatch('library.get', [OTHER_BOOK.id]))
      .rejects.toThrow(/only read the book you have open/);
  });

  it('refuses everything when nothing is open, rather than picking one', async () => {
    const host = hostWith({ library: { ...handlers().library, currentId: () => null } });
    await expect(host.dispatch('library.get', [OPEN_BOOK.id]))
      .rejects.toThrow(/no book is open/);
  });
});

describe('library.export reaches the app', () => {
  it('exports, rather than answering "this build cannot"', async () => {
    const host = hostWith();
    const out = await host.dispatch('library.export', [OPEN_BOOK.id, 'txt']);
    expect(out.filename).toBe('The Open One.txt');
  });

  it('is still refused a format that is not one of ours', async () => {
    const host = hostWith();
    await expect(host.dispatch('library.export', [OPEN_BOOK.id, 'exe']))
      .rejects.toThrow(/not an export format/);
  });
});

describe('browser and auth reach the app', () => {
  const calls = [];
  const browser = {
    open: async (url) => { calls.push(['open', url]); return null; },
    close: async () => { calls.push(['close']); return null; },
    oauth: async (o) => { calls.push(['oauth', o]); return { code: 'c', state: o.state }; },
    googleSignIn: async () => ({ idToken: 'x' }),
    requestDriveToken: async () => ({ accessToken: 't' }),
    signOut: async () => { calls.push(['signOut']); },
  };

  beforeEach(() => { calls.length = 0; });

  it('opens an https url', async () => {
    await hostWith({ browser }).dispatch('browser.open', ['https://example.com/a']);
    expect(calls).toEqual([['open', 'https://example.com/a']]);
  });

  it('refuses a url that is not https, before the app sees it', async () => {
    await expect(hostWith({ browser }).dispatch('browser.open', ['javascript:alert(1)']))
      .rejects.toThrow(/https/);
    expect(calls).toHaveLength(0);
  });

  it('round-trips oauth', async () => {
    const out = await hostWith({ browser })
      .dispatch('auth.oauth', [{ authUrl: 'https://example.com', redirect: 'x', state: 's' }]);
    expect(out.code).toBe('c');
  });

  it('reports an unsupported signOut instead of failing a teardown', async () => {
    const host = hostWith({ browser: { ...browser, signOut: undefined } });
    await expect(host.dispatch('auth.signOut', [])).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });

  it('reports a signOut that threw, rather than rejecting', async () => {
    const host = hostWith({ browser: { ...browser, signOut: async () => { throw new Error('no-native-signout'); } } });
    const out = await host.dispatch('auth.signOut', []);
    expect(out).toMatchObject({ ok: false, reason: 'failed', detail: 'no-native-signout' });
  });

  it('is refused entirely without the browser permission', async () => {
    const host = hostWith({ browser }, ['library:read:current']);
    await expect(host.dispatch('browser.open', ['https://example.com']))
      .rejects.toThrow(/permission/i);
  });
});

describe('network.requestHost reaches the app', () => {
  it('asks, grants, persists, and says a restart is needed', async () => {
    const asked = [];
    const persisted = [];
    const host = hostWith({
      network: {
        ask: async (id, url) => { asked.push([id, url]); return true; },
        persist: (id, hosts) => { persisted.push([id, [...hosts]]); },
      },
    });

    const out = await host.dispatch('network.requestHost', ['https://dav.example.org']);
    expect(out).toMatchObject({ ok: true, host: 'https://dav.example.org', needsRestart: true });
    expect(asked).toEqual([['wiring-probe', 'https://dav.example.org']]);
    expect(persisted).toEqual([['wiring-probe', ['https://dav.example.org']]]);
  });

  it('grants nothing when the user says no', async () => {
    const persisted = [];
    const host = hostWith({
      network: { ask: async () => false, persist: (id, h) => persisted.push([id, h]) },
    });
    await expect(host.dispatch('network.requestHost', ['https://dav.example.org']))
      .resolves.toEqual({ ok: false, reason: 'declined' });
    expect(persisted).toHaveLength(0);
  });

  it('does not ask about a host that could never be accepted', async () => {
    const asked = [];
    const host = hostWith({
      network: { ask: async (...a) => { asked.push(a); return true; }, persist: () => {} },
    });
    const out = await host.dispatch('network.requestHost', ['http://dav.example.org']);
    expect(out.ok).toBe(false);
    expect(asked).toHaveLength(0);
  });
});

describe('a host the user approved earlier is in the policy', () => {
  it('appears in the CSP on the next start', () => {
    const host = hostWith({}, ['network'], ['https://dav.example.org']);
    expect(host.csp()).toContain('https://dav.example.org');
  });

  it('is absent when it was dropped on the way through — the bug this covers', () => {
    const host = hostWith({}, ['network'], []);
    expect(host.csp()).not.toContain('dav.example.org');
  });
});
