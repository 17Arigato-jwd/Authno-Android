
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
