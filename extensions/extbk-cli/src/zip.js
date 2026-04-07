/**
 * zip.js — thin wrapper around adm-zip for the check/info/unpack commands.
 *
 * adm-zip is an optional peer dependency — build (which uses archiver) works
 * without it.  check/info/unpack import this module; if adm-zip is absent they
 * will print a helpful install message and exit.
 */

let AdmZip;

function requireAdmZip() {
  if (AdmZip) return AdmZip;
  try {
    AdmZip = (await import('adm-zip')).default;
    return AdmZip;
  } catch {
    process.stderr.write(
      '✘ adm-zip is required for this command.\n' +
      '  Install it: npm install adm-zip\n'
    );
    process.exit(1);
  }
}

/**
 * Open a .extbk (ZIP) file and return an adm-zip instance.
 * Throws if the file is not a valid ZIP.
 */
export function openZip(filePath) {
  // adm-zip is sync — we rely on it being already available (installed as optional dep)
  // If it's missing, the dynamic import in requireAdmZip() will handle it.
  // For the sync path, we attempt a direct require-style import:
  try {
    // Node 18+ supports synchronous-looking top-level modules when loaded as CJS
    // Here we use a sync workaround: createRequire
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const AZ = require('adm-zip');
    return new AZ(filePath);
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      process.stderr.write(
        '✘ adm-zip is required for check/info/unpack commands.\n' +
        '  Install it: npm install adm-zip\n'
      );
      process.exit(1);
    }
    throw e;
  }
}

/**
 * List all non-directory entries in an adm-zip instance.
 * Returns an array of { name, compSize, uncompSize, method } objects.
 */
export function listEntries(zip) {
  return zip.getEntries()
    .filter(e => !e.isDirectory)
    .map(e => ({
      name:       e.entryName,
      compSize:   e.header.compressedSize,
      uncompSize: e.header.size,
      method:     e.header.method,
    }));
}
