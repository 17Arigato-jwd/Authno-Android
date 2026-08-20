/**
 * The canonical resolution target for `@capacitor/filesystem` under jest.
 *
 * This file exists to fix a class of flake rather than to be useful. The real
 * package has a working web implementation backed by IndexedDB, jsdom has no
 * IndexedDB, and several suites mock the package with a factory. The trouble is
 * that `discoverExtensions` and friends reach it through a *dynamic*
 * `await import('@capacitor/filesystem')`, and when the real package is also
 * resolvable, jest could satisfy that import from the real path while the test's
 * `jest.mock(...)` factory sat under a different one — intermittently, because
 * which happens depends on how work lands across workers.
 *
 * The symptom was a suite that failed roughly one run in ten with
 * "installed, then not found", and the cause was invisible because the code
 * under test swallowed the underlying "This browser doesn't support IndexedDB".
 *
 * A `moduleNameMapper` entry in package.json points every reference here, so
 * there is exactly ONE resolved path however the module is reached. A test that
 * supplies its own `jest.mock` factory still wins; a test that forgets gets the
 * loud failure below instead of a confusing IndexedDB message from a real
 * implementation it never meant to touch.
 */

const notMocked = (method) => () => {
  throw new Error(
    `@capacitor/filesystem.${method} was called without a mock. ` +
    'Add a jest.mock("@capacitor/filesystem", ...) factory to this test file — ' +
    'the real implementation needs IndexedDB, which jsdom does not have.',
  );
};

export const Directory = { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' };
export const Encoding = { UTF8: 'utf8' };

export const Filesystem = {
  mkdir: notMocked('mkdir'),
  rmdir: notMocked('rmdir'),
  readdir: notMocked('readdir'),
  readFile: notMocked('readFile'),
  writeFile: notMocked('writeFile'),
  deleteFile: notMocked('deleteFile'),
  stat: notMocked('stat'),
  getUri: notMocked('getUri'),
  rename: notMocked('rename'),
  copy: notMocked('copy'),
};

export default { Filesystem, Directory, Encoding };
