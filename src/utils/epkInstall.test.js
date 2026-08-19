/**
 * Installing a v2 package through the app's real install path.
 *
 * The v2 work built a complete model layer that nothing in the app imported —
 * 1300 tests of code the app never called. This is the first wire: a .extbk
 * file the user picks is routed by its magic bytes, so both formats keep the
 * same extension and picking the wrong one is impossible.
 */

jest.mock('./platform', () => ({ isAndroid: () => false, isElectron: () => true }));

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
      const seen = new Map();
      for (const p of mockFiles.keys()) {
        if (!p.startsWith(`${path}/`)) continue;
        const rest = p.slice(path.length + 1);
        seen.set(rest.split('/')[0], rest.includes('/') ? 'directory' : 'file');
      }
      if (seen.size === 0) throw new Error(`no such directory: ${path}`);
      return { files: [...seen].map(([name, type]) => ({ name, type })) };
    },
    rmdir: async ({ path }) => {
      const doomed = [...mockFiles.keys()].filter((p) => p === path || p.startsWith(`${path}/`));
      if (!doomed.length) throw new Error(`no such directory: ${path}`);
      for (const p of doomed) mockFiles.delete(p);
    },
  },
}), { virtual: true });

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

beforeEach(() => { mockFiles.clear(); localStorage.clear(); });

const V2 = {
  apiVersion: 2,
  id: 'com.example.v2',
  name: 'V2 Demo',
  version: '2.0.0',
  permissions: { 'library:read:all': { reason: 'To read your books.' } },
};

async function buildV2(over = {}, assets = []) {
  const { packEpk } = require('./epkFormat');
  return packEpk({
    manifest: { ...V2, ...over },
    modules: { 'index.js': 'export function activate() {}', 'lib/q.js': 'export const q = 1;' },
    assets,
  });
}

describe('a v2 package installs through the same door as a v1 one', () => {
  test('it is routed by its magic bytes, not by anything the caller says', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const out = await installExtbkBytes(b64(await buildV2()), { silent: true });

    expect(out.id).toBe('com.example.v2');
    expect(out._format).toBe('epk');
    expect(mockFiles.has('AuthNo/extensions/com.example.v2/manifest.json')).toBe(true);
    expect(mockFiles.has('AuthNo/extensions/com.example.v2/index.js')).toBe(true);
    expect(mockFiles.has('AuthNo/extensions/com.example.v2/lib/q.js')).toBe(true);
  });

  test('the app then finds it, like any other extension', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const { discoverExtensions } = require('./extensionLoader');

    await installExtbkBytes(b64(await buildV2()), { silent: true });
    expect((await discoverExtensions()).map((m) => m.id)).toContain('com.example.v2');
  });

  test('the sandbox can read back the module graph', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const { readExtensionTree } = require('./extensionSandbox');

    await installExtbkBytes(b64(await buildV2()), { silent: true });
    const files = await readExtensionTree('com.example.v2');
    expect(Object.keys(files).sort()).toEqual(['index.js', 'lib/q.js']);
    expect(files['lib/q.js']).toBe('export const q = 1;');
  });

  test('the permissions block survives to disk, where the grant flow reads it', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    await installExtbkBytes(b64(await buildV2()), { silent: true });

    const written = JSON.parse(mockFiles.get('AuthNo/extensions/com.example.v2/manifest.json').toString('utf8'));
    expect(written.apiVersion).toBe(2);
    expect(written.permissions['library:read:all'].reason).toBe('To read your books.');
  });

  test('an asset entry is written alongside the code, byte for byte', async () => {
    // Existence is not the interesting assertion. These bytes are chosen to
    // break if anything on the path treats them as text: 0x89 and 0xFF are not
    // valid UTF-8, and a lossy round trip would replace them rather than fail.
    const { installExtbkBytes } = require('./extbkInstaller');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80]);
    await installExtbkBytes(
      b64(await buildV2({}, [{ path: 'icon.png', data: png, codec: 0 }])), { silent: true },
    );

    const written = mockFiles.get('AuthNo/extensions/com.example.v2/icon.png');
    expect(written).toBeDefined();
    expect([...written]).toEqual([...png]);
  });

  test('a deflated asset also round-trips exactly', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const text = new TextEncoder().encode(JSON.stringify({ padding: 'x'.repeat(400) }));
    await installExtbkBytes(
      b64(await buildV2({}, [{ path: 'data.json', data: text, codec: 1 }])), { silent: true },
    );
    const written = mockFiles.get('AuthNo/extensions/com.example.v2/data.json');
    expect([...written]).toEqual([...text]);
  });

  test('an asset whose digest fails is dropped, and the rest still installs', async () => {
    // Graceful degradation, the same stance the app takes with a partially
    // recoverable book: one bad image must not cost the whole extension.
    const { installExtbkBytes } = require('./extbkInstaller');
    const { readEpk } = require('./epkFormat');
    const { damageEntry } = require('./epkCorpus');

    const png = new Uint8Array(64).fill(7);
    const pkg = await buildV2({}, [{ path: 'icon.png', data: png, codec: 0 }]);
    const probe = await readEpk(pkg);
    const rec = probe.entries.get('icon.png');
    const damaged = damageEntry(pkg, rec.entryOffset, rec.storedSize, 4, 5);

    const out = await installExtbkBytes(b64(damaged), { silent: true });
    expect(out.id).toBe('com.example.v2');
    expect(out._droppedAssets).toEqual(['icon.png']);
    expect(mockFiles.has('AuthNo/extensions/com.example.v2/index.js')).toBe(true);
    expect(mockFiles.has('AuthNo/extensions/com.example.v2/icon.png')).toBe(false);
  });
});

describe('what a bad v2 package does', () => {
  test('an invalid manifest is refused, and nothing is written', async () => {
    // v1 writes as it decodes, so a package that fails halfway leaves a partial
    // extension behind. This path checks everything first.
    const { installExtbkBytes } = require('./extbkInstaller');
    const bytes = await buildV2({ id: 'a/b' });
    await expect(installExtbkBytes(b64(bytes), { silent: true })).rejects.toThrow(/Invalid manifest/);
    expect(mockFiles.size).toBe(0);
  });

  test('a truncated file says it is incomplete, not corrupt', async () => {
    // The difference between "try again" and "start again".
    const { installExtbkBytes } = require('./extbkInstaller');
    const full = await buildV2();
    const cut = full.slice(0, Math.floor(full.length * 0.6));
    await expect(installExtbkBytes(b64(cut), { silent: true })).rejects.toThrow(/incomplete/);
    expect(mockFiles.size).toBe(0);
  });

  test('a damaged core is repaired rather than refused', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const { corrupt, locate } = require('./epkCorpus');
    const pkg = await buildV2();
    const L = locate(pkg);
    const damaged = corrupt(pkg, { from: L.coreOffset, to: L.coreOffset + 150, count: 4, seed: 31 });

    const out = await installExtbkBytes(b64(damaged), { silent: true });
    expect(out.id).toBe('com.example.v2');
    expect(out._repairs.length).toBeGreaterThan(0);
  });
});

describe('v1 still installs exactly as before', () => {
  test('an ECS package takes the old path', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const { packExtbk } = require('./extbkFormat');

    const bytes = await packExtbk({
      manifest: { id: 'com.example.v1', name: 'Old', version: '1.0.0', entry: 'index.js', permissions: [] },
      entry: 'export default { activate() {} };',
      assets: [{ path: 'ui/page.html', data: '<p>hi</p>' }],
    });

    const out = await installExtbkBytes(b64(bytes), { silent: true });
    expect(out.id).toBe('com.example.v1');
    expect(out._format).toBeUndefined();
    expect(mockFiles.has('AuthNo/extensions/com.example.v1/ui/page.html')).toBe(true);
  });

  test('the two formats can sit side by side', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const { packExtbk } = require('./extbkFormat');
    const { discoverExtensions } = require('./extensionLoader');

    await installExtbkBytes(b64(await buildV2()), { silent: true });
    await installExtbkBytes(b64(await packExtbk({
      manifest: { id: 'com.example.v1', name: 'Old', version: '1.0.0', entry: 'index.js', permissions: [] },
      entry: 'export default { activate() {} };',
      assets: [],
    })), { silent: true });

    expect((await discoverExtensions()).map((m) => m.id).sort())
      .toEqual(['com.example.v1', 'com.example.v2']);
  });
});
