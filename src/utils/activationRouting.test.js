/**
 * Which runner an extension gets, and why it matters that it is not a choice.
 *
 * v1's dispatch is a flat switch with no permission checks. A v2 extension
 * reaching it would have every capability the switch can reach, regardless of
 * what its manifest declared or what the user granted — which is the exact
 * failure the whole version exists to prevent. So `apiVersion` decides, and
 * there is no third path.
 */

jest.mock('./platform', () => ({ isAndroid: () => false, isElectron: () => true }));

const v1Started = [];
const v2Started = [];

jest.mock('./extensionSandbox', () => ({
  runExtension: async (manifest) => { v1Started.push(manifest.id); return { ok: true }; },
  stopExtension: async () => {},
  stopAll: async () => {},
  readExtensionTree: async () => ({ 'index.js': 'export function activate() {}' }),
}));

jest.mock('./extensionRunnerV2', () => ({
  runExtensionV2: async ({ manifest, granted, userHosts }) => {
    v2Started.push({ id: manifest.id, granted: [...granted], userHosts: [...(userHosts ?? [])] });
    return { ok: true };
  },
  stopExtensionV2: async () => true,
  stopAllV2: async () => {},
  runningV2: () => v2Started.map((x) => x.id),
}));

beforeEach(() => {
  v1Started.length = 0;
  v2Started.length = 0;
  localStorage.clear();
});

const V1 = { id: 'old-one', name: 'Old', version: '1.5.0' };
const V2 = {
  apiVersion: 2, id: 'new-one', name: 'New', version: '2.0.0',
  permissions: { 'library:read:all': { reason: 'To read your books.' } },
};

describe('apiVersion decides, and nothing else does', () => {
  test('a v2 extension goes to the v2 runner', async () => {
    const { activateExtension } = require('./extensionRuntime');
    await activateExtension(V2, () => {});
    expect(v2Started.map((x) => x.id)).toEqual(['new-one']);
    expect(v1Started).toEqual([]);
  });

  test('a v1 extension goes to the v1 runner', async () => {
    const { activateExtension } = require('./extensionRuntime');
    await activateExtension(V1, () => {});
    expect(v1Started).toEqual(['old-one']);
    expect(v2Started).toEqual([]);
  });

  test('a v2 extension never reaches the unchecked dispatch', async () => {
    // The assertion the whole file exists for.
    const { activateExtension } = require('./extensionRuntime');
    await activateExtension(V2, () => {});
    expect(v1Started).not.toContain('new-one');
  });

  test('both can be running at once during the port', async () => {
    const { activateExtension } = require('./extensionRuntime');
    await activateExtension(V1, () => {});
    await activateExtension(V2, () => {});
    expect(v1Started).toEqual(['old-one']);
    expect(v2Started.map((x) => x.id)).toEqual(['new-one']);
  });

  test('an extension with no id is ignored rather than started', async () => {
    const { activateExtension } = require('./extensionRuntime');
    await activateExtension({ apiVersion: 2, name: 'Nameless' }, () => {});
    expect(v2Started).toEqual([]);
  });
});

describe('the grants on record are what the runner is given', () => {
  test('nothing granted means nothing granted', async () => {
    const { activateExtension } = require('./extensionRuntime');
    await activateExtension(V2, () => {});
    expect(v2Started[0].granted).toEqual([]);
  });

  test('stored grants reach the runner', async () => {
    const { writeGrants } = require('./extensionGrants');
    const { activateExtension } = require('./extensionRuntime');

    writeGrants('new-one', ['library:read:all'], []);
    await activateExtension(V2, () => {});
    expect(v2Started[0].granted).toEqual(['library:read:all']);
  });

  test('a grant for a permission that no longer exists is dropped on read', async () => {
    // A store written by an older build must not confer something the current
    // permission set does not define.
    const { activateExtension } = require('./extensionRuntime');
    localStorage.setItem('__authno_ext_grants_new-one',
      JSON.stringify({ granted: ['library:read:all', 'library:read:everything'], userHosts: [] }));

    await activateExtension(V2, () => {});
    expect(v2Started[0].granted).toEqual(['library:read:all']);
  });

  test('a runtime host that would not validate today is dropped', async () => {
    const { activateExtension } = require('./extensionRuntime');
    localStorage.setItem('__authno_ext_grants_new-one',
      JSON.stringify({ granted: [], userHosts: ['https://ok.example.com', 'https://*'] }));

    await activateExtension(V2, () => {});
    expect(v2Started[0].userHosts).toEqual(['https://ok.example.com']);
  });

  test('a grants store that will not parse fails closed', async () => {
    // The only safe direction: no grants at all, rather than guessing.
    const { activateExtension } = require('./extensionRuntime');
    localStorage.setItem('__authno_ext_grants_new-one', '{not json');
    await activateExtension(V2, () => {});
    expect(v2Started[0].granted).toEqual([]);
  });
});

describe('grants are not reachable from extension storage', () => {
  test('they live under a different key from the extension key/value store', async () => {
    // An extension that could write its own grants would not need to ask for
    // anything.
    const { writeGrants } = require('./extensionGrants');
    const { extStorage } = require('./extensionStorage');

    writeGrants('new-one', ['library:read:all'], []);
    const store = extStorage('new-one');
    await store.set('anything', 'x');

    const visible = await store.keys();
    expect(visible).toEqual(['anything']);
    expect(visible.join(' ')).not.toMatch(/grant/);
  });

  test('clearing the extension store leaves the grants alone, and vice versa', async () => {
    const { writeGrants, readGrants, clearGrants } = require('./extensionGrants');
    const { extStorage, clearExtStorage } = require('./extensionStorage');

    writeGrants('new-one', ['library:read:all'], []);
    await extStorage('new-one').set('k', 'v');

    clearExtStorage('new-one');
    expect(readGrants('new-one').granted).toEqual(['library:read:all']);

    clearGrants('new-one');
    expect(readGrants('new-one').granted).toEqual([]);
  });
});
