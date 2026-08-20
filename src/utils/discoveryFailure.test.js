/**
 * "Nothing is installed" and "I could not look" are not the same answer.
 *
 * `discoverExtensions` returned `[]` for both, and the UI drew an empty list
 * either way. So a storage backend that fails — IndexedDB unavailable in
 * private browsing, a quota wall, a permission refusal — made every installed
 * extension silently disappear, with no way for anyone to tell that from having
 * installed none.
 *
 * Found while chasing an intermittent suite failure whose real message,
 * "This browser doesn't support IndexedDB", was being swallowed by exactly this
 * catch. The flake was a test-harness problem; the swallow was a product one.
 *
 * This lives in its own file rather than in crossPlatformInstall.test.js so the
 * failing readdir is a property of the mock from the start, instead of being
 * monkey-patched onto a shared one mid-run.
 */

jest.mock('./platform', () => ({ isAndroid: () => false, isElectron: () => true }));

let mockReaddirBehaviour = 'empty';

jest.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    mkdir: async () => {},
    writeFile: async () => {},
    stat: async () => ({ type: 'file' }),
    readFile: async () => { throw new Error('no such file'); },
    readdir: async () => {
      if (mockReaddirBehaviour === 'broken') {
        // Verbatim from @capacitor/filesystem's web build under jsdom.
        throw new Error("This browser doesn't support IndexedDB");
      }
      if (mockReaddirBehaviour === 'absent') throw new Error('no such directory: AuthNo/extensions');
      return { files: [] };
    },
  },
}), { virtual: true });

beforeEach(() => {
  mockReaddirBehaviour = 'empty';
  localStorage.clear();
});

describe('discovery tells "empty" apart from "unreadable"', () => {
  test('an empty store is not an error', async () => {
    const { discoverExtensions } = require('./extensionLoader');
    const found = await discoverExtensions();
    expect(found).toEqual([]);
    expect(found.error).toBeNull();
  });

  test('a directory that does not exist yet is not an error either', async () => {
    // The ordinary state of a fresh install. Reporting it would put a scary
    // banner in front of everyone who has never installed an extension.
    mockReaddirBehaviour = 'absent';
    const { discoverExtensions } = require('./extensionLoader');
    const found = await discoverExtensions();
    expect(found).toEqual([]);
    expect(found.error).toBeNull();
  });

  test('a storage backend that fails IS an error', async () => {
    mockReaddirBehaviour = 'broken';
    const { discoverExtensions } = require('./extensionLoader');
    const found = await discoverExtensions();

    expect(found).toEqual([]);                       // still an array
    expect(found.error).toBeInstanceOf(Error);
    expect(found.error.message).toMatch(/IndexedDB/);
  });

  test('the signal is non-enumerable, so every existing caller is unaffected', async () => {
    mockReaddirBehaviour = 'broken';
    const { discoverExtensions } = require('./extensionLoader');
    const found = await discoverExtensions();

    // These four are how the app and the rest of the suite consume it.
    expect(found).toEqual([]);
    expect([...found]).toEqual([]);
    expect(found.map((m) => m.id)).toEqual([]);
    expect(Object.keys(found)).toEqual([]);
    expect(JSON.stringify(found)).toBe('[]');
  });

  test('a hand-written dev-store extension still surfaces when the store is broken', async () => {
    // The dev store is localStorage, not the filesystem, so a filesystem
    // failure must not take it down with it.
    mockReaddirBehaviour = 'broken';
    localStorage.setItem('__authno_dev_extensions', JSON.stringify([
      { id: 'dev.only', name: 'Dev', version: '1.0.0', entry: 'index.js', permissions: [] },
    ]));
    const { discoverExtensions } = require('./extensionLoader');
    const found = await discoverExtensions();

    expect(found.map((m) => m.id)).toEqual(['dev.only']);
    expect(found.error).toBeInstanceOf(Error);
  });
});
