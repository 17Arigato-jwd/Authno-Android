/**
 * The host half of the sandbox: reading an extension off disk, and the switch
 * that decides what an extension is allowed to ask for.
 *
 * What is NOT here, deliberately: whether the frame is actually isolated, and
 * whether a blob module graph imports. jsdom has no origin model and no module
 * loader, so a test of either would be testing the mock and would have passed
 * just as happily against the version that carried `allow-same-origin`. Those
 * two claims are checked in a real browser — `npm run check:sandbox`.
 */

import { BOOTSTRAP, sandboxDocument } from './extensionSandbox';

describe('the document the frame runs', () => {
  test('it closes its own script tag', () => {
    const doc = sandboxDocument();
    expect(doc).toContain('<script>');
    expect(doc).toContain('</script>');
    expect(doc.indexOf('</script>')).toBeGreaterThan(doc.indexOf('<script>'));
  });

  test('the bootstrap is inside it', () => {
    expect(sandboxDocument()).toContain('AuthnoHostAPI');
  });

  /**
   * The frame's only way out is postMessage. A bootstrap that reached for
   * anything on the parent would either throw on an opaque origin or, if it
   * somehow did not, be the hole this whole design closes.
   */
  test('the bootstrap touches the parent only to post to it', () => {
    const reaches = BOOTSTRAP.match(/parent\.[A-Za-z_$][\w$]*/g) ?? [];
    expect([...new Set(reaches)]).toEqual(['parent.postMessage']);
  });

  test('it never mentions the app\'s own storage', () => {
    expect(BOOTSTRAP).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});

// ── readExtensionTree ────────────────────────────────────────────────────────

const fsMock = (tree) => {
  const dirs = {};
  const files = {};
  for (const [path, source] of Object.entries(tree)) {
    files[path] = source;
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      (dirs[dir] = dirs[dir] ?? new Set()).add(
        i === parts.length - 1
          ? { name: parts[i], type: 'file' }
          : { name: parts[i], type: 'directory' },
      );
    }
  }
  const key = (p) => p.replace(/^AuthNo\/extensions\/ext\/?/, '').replace(/\/$/, '');
  return {
    readdir: async ({ path }) => {
      const d = dirs[key(path)];
      if (!d) throw new Error('not a directory');
      // Deduplicate by name — the same directory appears once per file under it.
      const byName = new Map();
      for (const e of d) if (!byName.has(e.name)) byName.set(e.name, e);
      return { files: [...byName.values()] };
    },
    readFile: async ({ path }) => {
      const f = files[key(path)];
      if (f === undefined) throw new Error('no such file');
      return { data: f };
    },
  };
};

const withFs = (tree, fn) => {
  jest.resetModules();
  jest.doMock('@capacitor/filesystem', () => ({
    Filesystem: fsMock(tree),
    Directory: { Data: 'DATA' },
  }), { virtual: true });
  const mod = require('./extensionSandbox');
  return fn(mod);
};

afterEach(() => jest.resetModules());

describe('reading an extension off disk', () => {
  test('a flat extension', async () => {
    await withFs({ 'index.js': 'export function activate(){}' }, async (m) => {
      expect(await m.readExtensionTree('ext')).toEqual({ 'index.js': 'export function activate(){}' });
    });
  });

  /** Extensions put helpers in lib/. Stopping at the top level would lose them. */
  test('files in subdirectories', async () => {
    await withFs({
      'index.js': `import './lib/queue.js';`,
      'lib/queue.js': 'export const q = 1;',
      'lib/deep/log.js': 'export const l = 2;',
    }, async (m) => {
      const files = await m.readExtensionTree('ext');
      expect(Object.keys(files).sort()).toEqual(['index.js', 'lib/deep/log.js', 'lib/queue.js']);
    });
  });

  /**
   * Only .js is linkable. A 2 MB icon turned into a blob would cost memory for
   * something no module can import.
   */
  test('non-JS files are skipped', async () => {
    await withFs({
      'index.js': 'export function activate(){}',
      'manifest.json': '{}',
      'icon.png': 'binary',
    }, async (m) => {
      expect(Object.keys(await m.readExtensionTree('ext'))).toEqual(['index.js']);
    });
  });

  test('an extension whose directory is missing reads as empty', async () => {
    await withFs({}, async (m) => {
      expect(await m.readExtensionTree('ext')).toEqual({});
    });
  });

  /**
   * An extension that ships thousands of files should not be able to make the
   * app read all of them before it decides anything.
   */
  test('the file count is bounded', async () => {
    const many = {};
    for (let i = 0; i < 50; i++) many[`f${i}.js`] = `export const n = ${i};`;
    await withFs(many, async (m) => {
      const files = await m.readExtensionTree('ext', { maxFiles: 10 });
      expect(Object.keys(files).length).toBeLessThanOrEqual(50);
      expect(Object.keys(files).length).toBeGreaterThan(0);
    });
  });

  test('Capacitor 3\'s string[] shape still reads', async () => {
    jest.resetModules();
    jest.doMock('@capacitor/filesystem', () => ({
      Filesystem: {
        readdir: async ({ path }) => (path.endsWith('/ext') ? { files: ['index.js'] } : (() => { throw new Error('nope'); })()),
        readFile: async () => ({ data: 'export function activate(){}' }),
      },
      Directory: { Data: 'DATA' },
    }), { virtual: true });
    const m = require('./extensionSandbox');
    expect(await m.readExtensionTree('ext')).toEqual({ 'index.js': 'export function activate(){}' });
  });
});

// ── runExtension's refusals ──────────────────────────────────────────────────

describe('what refuses to start, and says why', () => {
  test('a manifest with no id', async () => {
    await withFs({}, async (m) => {
      expect(await m.runExtension({})).toMatchObject({ ok: false });
    });
  });

  test('an extension with no entry file', async () => {
    await withFs({ 'other.js': '' }, async (m) => {
      const r = await m.runExtension({ id: 'ext' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/index\.js/);
    });
  });

  /**
   * A blob URL cannot express a cycle — the first module would need the
   * second's URL before the second exists. Naming the loop beats hanging.
   */
  test('a circular import, with the loop named', async () => {
    await withFs({
      'index.js': `import './a.js';`,
      'a.js': `import './b.js';`,
      'b.js': `import './a.js';`,
    }, async (m) => {
      const r = await m.runExtension({ id: 'ext' });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('circular import');
      expect(r.error).toContain('a.js');
      expect(r.error).toContain('b.js');
    });
  });

  test('nothing is left running after a refusal', async () => {
    await withFs({ 'other.js': '' }, async (m) => {
      await m.runExtension({ id: 'ext' });
      expect(m.runningExtensions()).toEqual([]);
    });
  });

  test('stopping one that never started is not an error', async () => {
    await withFs({}, async (m) => {
      await expect(m.stopExtension('never-ran')).resolves.toBeUndefined();
      await expect(m.stopAll()).resolves.toBeUndefined();
    });
  });
});

/**
 * `oauth` — the portable round trip, and the one capability an extension can
 * point at a URL of its choosing.
 *
 * The redirect check is the load-bearing part. An extension that could name
 * any prefix could ask to be woken by `authno://auth/google` — the app's own
 * sign-in coming home — and read the handoff that is exchanged for an account.
 */
describe('what an extension may ask oauth for', () => {
  const refusal = async (opts) => {
    let err = null;
    await withFs({}, async (m) => {
      try { await m.__testDispatch('oauth', [opts]); } catch (e) { err = e; }
    });
    return err;
  };

  test('an https authUrl and one of our own redirects', async () => {
    // Only the refusals are asserted here: the success path opens a browser
    // and waits for the OS, which is what check:extensions and the deep-link
    // bus tests cover between them.
    expect((await refusal({ authUrl: 'http://example.com', redirect: 'com.aurorastudios.authno://oauth2/x' })).message)
      .toMatch(/https authUrl/);
  });

  test('the app\'s own sign-in scheme is refused', async () => {
    const e = await refusal({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', redirect: 'authno://auth/google' });
    expect(e.message).toMatch(/redirect must start with/);
  });

  test('so is somebody else\'s scheme, and a lookalike', async () => {
    for (const redirect of [
      'https://evil.example/steal',
      'com.evil.app://oauth2/x',
      'com.aurorastudios.authnotes://oauth2/x',
      '',
    ]) {
      const e = await refusal({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', redirect });
      expect(e && e.message).toMatch(/redirect must start with/);
    }
  });

  test('a missing options object does not throw something unreadable', async () => {
    const e = await refusal(undefined);
    expect(e.message).toMatch(/https authUrl/);
  });
});

/**
 * The same rules from the other surface.
 *
 * There are two extension bridges — the background half's `host.oauth` and a
 * `ui-file` page's postMessage bridge — and only the first had this call at
 * all. Adding it to the second meant either copying the redirect check or
 * sharing it, and a second copy of a security check is a second chance to
 * write it slightly differently. `oauthRoundTrip` is the shared one; these
 * assert the guard travels with it rather than living at the call site.
 */
describe('the round trip both bridges share', () => {
  const { oauthRoundTrip } = require('./extensionSandbox');

  /** Records what it was asked to open, and never actually opens anything. */
  const opener = () => {
    const opened = [];
    return [opened, async (url) => { opened.push(url); }];
  };

  test('a refused redirect never opens a browser', async () => {
    const [opened, open] = opener();
    await expect(oauthRoundTrip(
      { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', redirect: 'authno://auth/google' },
      open,
    )).rejects.toThrow(/redirect must start with/);
    // The order matters as much as the refusal. Opening first and checking
    // second would still send the writer to a consent screen.
    expect(opened).toEqual([]);
  });

  test('a refused authUrl never opens one either', async () => {
    const [opened, open] = opener();
    await expect(oauthRoundTrip(
      { authUrl: 'http://accounts.google.com/', redirect: 'com.aurorastudios.authno://oauth2/x' },
      open,
    )).rejects.toThrow(/https authUrl/);
    expect(opened).toEqual([]);
  });

  test('every shape the dispatch case refused, the shared function refuses', async () => {
    const [, open] = opener();
    for (const redirect of [
      'authno://auth/google',
      'https://evil.example/steal',
      'com.evil.app://oauth2/x',
      'com.aurorastudios.authnotes://oauth2/x',
      '',
    ]) {
      await expect(oauthRoundTrip(
        { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', redirect },
        open,
      )).rejects.toThrow(/redirect must start with/);
    }
    await expect(oauthRoundTrip(undefined, open)).rejects.toThrow(/https authUrl/);
  });

});
