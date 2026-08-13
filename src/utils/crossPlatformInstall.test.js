/**
 * Installing a .extbk or a .thmbk on a desktop.
 *
 * Not a test of either binary format — extbkFormat and thmbkFormat have their
 * own. This asks the question that only appears once a platform boundary is
 * crossed: after installing a bundle the way the UI installs it, does the app
 * then FIND it?
 *
 * It did not, for .extbk. `installExtbkBytes` wrote through Capacitor's
 * `Filesystem` — whose web implementation is real, backed by IndexedDB — while
 * `discoverExtensions` had an `if (!isAndroid())` branch that read only the
 * localStorage dev store. Nothing in the codebase has ever *written* that key.
 * So on desktop the install ran to completion, reported success, and the
 * extension never appeared; and had it appeared, `readExtensionFile` returned
 * null off Android, so its UI page could only render "could not read".
 *
 * Everything here runs with isAndroid() false, which is every desktop and web
 * build.
 */

jest.mock('./platform', () => ({
  isAndroid: () => false,
  isElectron: () => true,
}));

// Bytes, keyed by path — modelling Capacitor's own contract, because getting
// that contract wrong is the class of bug being hunted here: writeFile with no
// `encoding` takes base64, with one it takes text; readFile mirrors it. A mock
// that echoed back whatever it was handed would pass a caller that had them
// backwards.
const mockFiles = new Map();
jest.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    mkdir: async () => {},
    writeFile: async ({ path, data, encoding }) => {
      mockFiles.set(path, Buffer.from(data, encoding ? 'utf8' : 'base64'));
    },
    readFile: async ({ path, encoding }) => {
      if (!mockFiles.has(path)) throw new Error(`no such file: ${path}`);
      const buf = mockFiles.get(path);
      return { data: encoding ? buf.toString('utf8') : buf.toString('base64') };
    },
    stat: async ({ path }) => {
      if (!mockFiles.has(path)) throw new Error(`no such file: ${path}`);
      return { type: 'file' };
    },
    readdir: async ({ path }) => {
      const names = new Set();
      for (const p of mockFiles.keys()) {
        if (p.startsWith(`${path}/`)) names.add(p.slice(path.length + 1).split('/')[0]);
      }
      return { files: [...names].map((name) => ({ name, type: 'directory' })) };
    },
    // Throws on a missing directory, like the real one. That is not incidental
    // detail — it is the exact condition uninstallExtension has to survive for
    // a hand-written entry, which has no directory at all.
    rmdir: async ({ path }) => {
      const doomed = [...mockFiles.keys()].filter((p) => p === path || p.startsWith(`${path}/`));
      if (doomed.length === 0) throw new Error(`no such directory: ${path}`);
      for (const p of doomed) mockFiles.delete(p);
    },
  },
}), { virtual: true });

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

beforeEach(() => { mockFiles.clear(); localStorage.clear(); });

// ── .extbk ───────────────────────────────────────────────────────────────────

describe('installing an extension on a desktop', () => {
  const manifest = {
    id: 'com.example.demo', name: 'Demo', version: '1.0.0',
    entry: 'index.js', permissions: [],
  };

  const build = async (over = {}) => {
    const { packExtbk } = require('./extbkFormat');
    return b64(await packExtbk({
      manifest: { ...manifest, ...over },
      entry: 'export default { activate() {} };',
      assets: [{ path: 'ui/page.html', data: '<p>hello</p>' }],
    }));
  };

  test('the files land where they were asked to', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const out = await installExtbkBytes(await build(), { silent: true });

    expect(out.id).toBe('com.example.demo');
    expect(mockFiles.has('AuthNo/extensions/com.example.demo/manifest.json')).toBe(true);
    expect(mockFiles.has('AuthNo/extensions/com.example.demo/index.js')).toBe(true);
    expect(mockFiles.has('AuthNo/extensions/com.example.demo/ui/page.html')).toBe(true);
  });

  /** The regression. Installing used to succeed and discovery to come up empty. */
  test('and the app then finds it', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const { discoverExtensions } = require('./extensionLoader');

    await installExtbkBytes(await build(), { silent: true });

    expect((await discoverExtensions()).map((m) => m.id)).toContain('com.example.demo');
  });

  test('its files read back as text, which is what a UI page needs', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    await installExtbkBytes(await build(), { silent: true });

    // The exact call ExtensionPage.readExtensionFile makes.
    const { Filesystem, Directory } = require('@capacitor/filesystem');
    const r = await Filesystem.readFile({
      path: 'AuthNo/extensions/com.example.demo/ui/page.html',
      directory: Directory.Data,
      encoding: 'utf8',
    });
    expect(r.data).toBe('<p>hello</p>');
  });

  test('isExtensionInstalled agrees with discovery', async () => {
    const { installExtbkBytes, isExtensionInstalled } = require('./extbkInstaller');
    expect(await isExtensionInstalled('com.example.demo')).toBe(false);
    await installExtbkBytes(await build(), { silent: true });
    expect(await isExtensionInstalled('com.example.demo')).toBe(true);
  });

  test('an update replaces rather than duplicates', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const { discoverExtensions } = require('./extensionLoader');

    await installExtbkBytes(await build(), { silent: true });
    await installExtbkBytes(await build({ version: '2.0.0' }), { silent: true });

    const found = await discoverExtensions();
    expect(found).toHaveLength(1);
    expect(found[0].version).toBe('2.0.0');
  });
});

describe('the hand-written dev store', () => {
  const devEntry = { id: 'dev.only', name: 'Dev Only', version: '0.1.0' };

  /**
   * Typing a manifest into localStorage is how an extension gets developed
   * without packing a .extbk first, and it is all a plain browser tab has. The
   * fix merges it with the real scan rather than replacing one with the other.
   */
  test('is still read', async () => {
    localStorage.setItem('__authno_dev_extensions', JSON.stringify([devEntry]));
    const { discoverExtensions } = require('./extensionLoader');
    expect((await discoverExtensions()).map((m) => m.id)).toContain('dev.only');
  });

  test('sits alongside an installed extension rather than hiding it', async () => {
    localStorage.setItem('__authno_dev_extensions', JSON.stringify([devEntry]));
    const { installExtbkBytes } = require('./extbkInstaller');
    const { packExtbk } = require('./extbkFormat');
    const { discoverExtensions } = require('./extensionLoader');

    await installExtbkBytes(b64(await packExtbk({
      manifest: { id: 'com.example.demo', name: 'Demo', version: '1.0.0', entry: 'index.js' },
      entry: 'export default {};',
    })), { silent: true });

    expect((await discoverExtensions()).map((m) => m.id).sort())
      .toEqual(['com.example.demo', 'dev.only']);
  });

  /**
   * An installed copy wins on a clash: its files are the ones actually on disk
   * for readExtensionFile to load, so a stale hand-written manifest for the
   * same id must not shadow them.
   */
  test('loses to an installed extension of the same id', async () => {
    localStorage.setItem('__authno_dev_extensions', JSON.stringify([
      { id: 'com.example.demo', name: 'Stale Hand Copy', version: '0.0.1' },
    ]));
    const { installExtbkBytes } = require('./extbkInstaller');
    const { packExtbk } = require('./extbkFormat');
    const { discoverExtensions } = require('./extensionLoader');

    await installExtbkBytes(b64(await packExtbk({
      manifest: { id: 'com.example.demo', name: 'Demo', version: '1.0.0', entry: 'index.js' },
      entry: 'export default {};',
    })), { silent: true });

    const found = await discoverExtensions();
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('Demo');
  });

  /**
   * Uninstall has to reach both stores, because discovery reads both. It used
   * to only rmdir: for a hand-written entry that threw (no such directory), the
   * card reported "Could not remove", and the extension was still in the list
   * afterwards because the dev store still held it. Failed and didn't take.
   */
  test('uninstalling a hand-written entry actually removes it', async () => {
    localStorage.setItem('__authno_dev_extensions', JSON.stringify([devEntry]));
    const { uninstallExtension } = require('./extbkInstaller');
    const { discoverExtensions } = require('./extensionLoader');

    await expect(uninstallExtension('dev.only')).resolves.toBe(true);
    expect((await discoverExtensions()).map((m) => m.id)).not.toContain('dev.only');
  });

  test('and leaves the other hand-written entries alone', async () => {
    localStorage.setItem('__authno_dev_extensions', JSON.stringify([
      devEntry, { id: 'dev.other', name: 'Other', version: '1.0.0' },
    ]));
    const { uninstallExtension } = require('./extbkInstaller');
    const { discoverExtensions } = require('./extensionLoader');

    await uninstallExtension('dev.only');
    expect((await discoverExtensions()).map((m) => m.id)).toEqual(['dev.other']);
  });

  test('uninstalling an installed extension still works', async () => {
    const { installExtbkBytes, uninstallExtension } = require('./extbkInstaller');
    const { packExtbk } = require('./extbkFormat');
    const { discoverExtensions } = require('./extensionLoader');

    await installExtbkBytes(b64(await packExtbk({
      manifest: { id: 'com.example.demo', name: 'Demo', version: '1.0.0', entry: 'index.js' },
      entry: 'export default {};',
    })), { silent: true });

    await uninstallExtension('com.example.demo');
    expect(await discoverExtensions()).toEqual([]);
  });

  test('a path-traversal id is refused before anything is touched', async () => {
    const { uninstallExtension } = require('./extbkInstaller');
    await expect(uninstallExtension('../../etc')).rejects.toThrow(/Invalid extension id/);
  });

  test('a corrupt dev store is ignored rather than fatal', async () => {
    localStorage.setItem('__authno_dev_extensions', 'not json at all');
    const { discoverExtensions } = require('./extensionLoader');
    await expect(discoverExtensions()).resolves.toEqual([]);
  });

  test('entries that fail validation are dropped, valid ones survive', async () => {
    localStorage.setItem('__authno_dev_extensions', JSON.stringify([
      { id: 'no.version', name: 'Missing Version' },
      { id: '../escape', name: 'Traversal', version: '1.0.0' },
      devEntry,
    ]));
    const { discoverExtensions } = require('./extensionLoader');
    expect((await discoverExtensions()).map((m) => m.id)).toEqual(['dev.only']);
  });
});

// ── .thmbk ───────────────────────────────────────────────────────────────────

describe('installing a theme on a desktop', () => {
  const manifest = { type: 'theme', id: 'midnight', name: 'Midnight', version: '1.0.0', author: 'x' };
  const theme = {
    meta: { id: 'midnight', name: 'Midnight', isDark: true },
    colors: { bg: '#000000', text: '#ffffff' },
  };

  // This half was already right: themeLoader writes and reads the same
  // localStorage store off Android, so both ends agree.
  test('installs and is then listed', async () => {
    const { packThmbk } = require('./thmbkFormat');
    const { installThmbkBytes, refreshInstalledThemes } = require('./themeLoader');

    const out = await installThmbkBytes(b64(await packThmbk({ manifest, theme })));
    expect(out.id).toBe('midnight');

    expect((await refreshInstalledThemes()).map((t) => t?.meta?.id)).toContain('midnight');
  });

  test('the built theme carries what the picker renders', async () => {
    const { packThmbk } = require('./thmbkFormat');
    const { installThmbkBytes, refreshInstalledThemes } = require('./themeLoader');

    await installThmbkBytes(b64(await packThmbk({ manifest, theme })));
    const built = (await refreshInstalledThemes()).find((t) => t?.meta?.id === 'midnight');

    expect(built.meta.name).toBe('Midnight');
    expect(built.meta.isDark).toBe(true);
    expect(built.meta.installed).toBe(true);
    expect(built.meta.version).toBe('1.0.0');
  });

  test('uninstalling removes it from the list', async () => {
    const { packThmbk } = require('./thmbkFormat');
    const { installThmbkBytes, refreshInstalledThemes, uninstallTheme } = require('./themeLoader');

    await installThmbkBytes(b64(await packThmbk({ manifest, theme })));
    await uninstallTheme('midnight');

    expect((await refreshInstalledThemes()).map((t) => t?.meta?.id)).not.toContain('midnight');
  });

  test('a file that is not a .thmbk is refused', async () => {
    const { installThmbkBytes } = require('./themeLoader');
    await expect(installThmbkBytes(b64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))))
      .rejects.toThrow();
  });
});
