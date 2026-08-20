
describe('a package too large to open', () => {
  /**
   * The bridge holds an extension whole, several times over: Android's
   * ByteArrayOutputStream, its copy, its base64, the JS string, the
   * Uint8Array. Peak is six to eight times the file. Nothing capped it, and
   * the format's own policy cap is 1 GB — so a large-but-legal package was
   * read, encoded and handed over until the process died.
   *
   * An OutOfMemoryError mid-bridge is a crash, not a refusal: no message, no
   * toast, nothing anybody can act on. A refusal has to happen before the
   * allocation, which means before `atob`, which means on the string length.
   */
  it('is refused before it is decoded', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    // 96 MB of base64 — over the 90 MB ceiling, and never decoded.
    const huge = 'A'.repeat(96 * 1024 * 1024);
    await expect(installExtbkBytes(huge, { silent: true }))
      .rejects.toThrow(/too large to open/);
  });

  it('says how large it was, so the number is actionable', async () => {
    const { installExtbkBytes } = require('./extbkInstaller');
    const huge = 'A'.repeat(96 * 1024 * 1024);
    await expect(installExtbkBytes(huge, { silent: true }))
      .rejects.toThrow(/72 MB.*limit is 64 MB/);
  });
});

describe('what an uninstall takes with it', () => {
  const EXT = 'com.example.leaver';

  beforeEach(() => {
    const { clearGrants } = require('./extensionGrants');
    const { clearExtensionConfig } = require('./extensionLoader');
    clearGrants(EXT);
    clearExtensionConfig(EXT);
  });

  // `.catch` on every call here is load-bearing: there is no filesystem under
  // jsdom, so the rmdir throws. That is the case worth pinning — revoking must
  // not be something a failed removal can skip past.
  it('destroys the grants', async () => {
    const { writeGrants, readGrants } = require('./extensionGrants');
    writeGrants(EXT, ['library:read:all']);
    expect(readGrants(EXT).granted).toEqual(['library:read:all']);

    const { uninstallExtension } = require('./extbkInstaller');
    await uninstallExtension(EXT).catch(() => {});
    expect(readGrants(EXT).granted).toEqual([]);
  });

  it('destroys the config, which is where an extension keeps its tokens', async () => {
    const { setExtensionConfig, getExtensionConfig } = require('./extensionLoader');
    setExtensionConfig(EXT, { token: 'secret' });
    expect(getExtensionConfig(EXT).token).toBe('secret');

    const { uninstallExtension } = require('./extbkInstaller');
    await uninstallExtension(EXT).catch(() => {});
    expect(getExtensionConfig(EXT).token).toBeUndefined();
  });

  it('means a package reinstalling under the same id is asked again', async () => {
    const { writeGrants, readGrants } = require('./extensionGrants');
    const { promptPlan } = require('./extensionPermissionsV2');
    writeGrants(EXT, ['library:read:all']);
    const { uninstallExtension } = require('./extbkInstaller');
    await uninstallExtension(EXT).catch(() => {});

    // The install path builds its plan from whatever grants are on record.
    // While they survived an uninstall, a DIFFERENT package declaring the same
    // id carried them all and prompted for nothing — access acquired without
    // ever being asked for.
    const plan = promptPlan({ 'library:read:all': { reason: 'why' } }, readGrants(EXT).granted);
    expect(plan.carried).toEqual([]);
    expect(plan.prompt.map((p) => p.permission)).toEqual(['library:read:all']);
  });
});
