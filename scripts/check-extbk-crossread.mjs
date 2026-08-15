/**
 * Can the app read what the CLI writes? — `npm run check:extbk`
 *
 * The .extbk format has two independent implementations. The CLI writes it
 * (node's zlib, its own copy of the Reed-Solomon codec) and the app reads it
 * (pako, its own copy). Neither has ever been pointed at the other.
 *
 * `extensions/extbk-cli`'s own suite is `node src/cli.js --help`, and its CI
 * round-trip is CLI-writes then CLI-reads. That cannot catch the failure that
 * matters: a *shared* misreading of the format is invisible to it, because
 * both halves would agree with each other and disagree with nothing. Extension
 * authors would ship files no copy of AuthNo could open, and every check in
 * both repositories would stay green.
 *
 * The two reedSolomon.js copies already differ by one function. That one is
 * dead code and harmless — and it is exactly the shape of the drift that would
 * not be.
 *
 * So: build a real bundle with the CLI, decode it with the app's reader, and
 * compare what came back against what went in. Bytes, not filenames.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'extensions', 'extbk-cli', 'src', 'cli.js');

let failed = 0;
const ok = (cond, name) => {
  if (cond) console.log(`  ✔ ${name}`);
  else { failed++; console.error(`  ✘ ${name}`); }
};

/**
 * The app's reader is ESM inside a CommonJS package, so node cannot import it
 * by its own path. Copy the three files to .mjs in a temp dir and rewrite the
 * two relative specifiers. Copies rather than a rewritten source tree: this
 * has to exercise the file the app actually bundles, unedited.
 */
function appReaderIn(dir) {
  const files = {
    'extbkFormat.mjs': path.join(ROOT, 'src', 'utils', 'extbkFormat.js'),
    'rs.mjs': path.join(ROOT, 'src', 'utils', 'rs.js'),
    'reedSolomon.mjs': path.join(ROOT, 'src', 'utils', 'reedSolomon.js'),
  };
  for (const [name, src] of Object.entries(files)) {
    const text = fs.readFileSync(src, 'utf8')
      .replace(/from '\.\/rs\.js'/g, "from './rs.mjs'")
      .replace(/from '\.\/reedSolomon\.js'/g, "from './reedSolomon.mjs'");
    fs.writeFileSync(path.join(dir, name), text);
  }
  // pako lives in the app's node_modules; the temp dir needs to see it.
  const link = path.join(dir, 'node_modules');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(ROOT, 'node_modules'), link, 'dir');
  return path.join(dir, 'extbkFormat.mjs');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extbk-cross-'));
const srcDir = path.join(tmp, 'ext');
fs.mkdirSync(path.join(srcDir, 'lib'), { recursive: true });

// Deliberately not a hello-world. A nested asset, a relative import the app's
// module graph has to resolve, non-ASCII bytes that a text/binary confusion
// would mangle, and a file big enough to span several RS chunks.
const MANIFEST = {
  id: 'com.example.crosscheck',
  name: 'Cross Check',
  version: '1.2.3',
  description: 'built by the CLI, read by the app',
};
const ENTRY = `import { helper } from './lib/helper.js';\nexport function activate({ registerHook }) { registerHook('onSave', () => helper()); }\n`;
const HELPER = 'export const helper = () => "ok";\n';
const UNICODE = '{"nested":true,"unicode":"日本語 — ok","emoji":"🖋"}';
const BULK = 'x'.repeat(40000);

fs.writeFileSync(path.join(srcDir, 'manifest.json'), JSON.stringify(MANIFEST, null, 2));
fs.writeFileSync(path.join(srcDir, 'index.js'), ENTRY);
fs.writeFileSync(path.join(srcDir, 'lib', 'helper.js'), HELPER);
fs.writeFileSync(path.join(srcDir, 'lib', 'config.json'), UNICODE);
fs.writeFileSync(path.join(srcDir, 'lib', 'bulk.txt'), BULK);

const bundle = path.join(tmp, 'out.extbk');
console.log('building with the CLI:');
try {
  execFileSync('node', [CLI, 'build', srcDir, bundle, '--overwrite'], { stdio: 'pipe' });
  ok(fs.existsSync(bundle), 'the CLI produced a bundle');
} catch (e) {
  console.error('  ✘ the CLI could not build:', e.stderr?.toString() || e.message);
  process.exit(1);
}

console.log('reading it with the app:');
const { validateExtbk, unpackExtbk } = await import(appReaderIn(tmp));
const bytes = new Uint8Array(fs.readFileSync(bundle));

const { ok: valid, errors } = validateExtbk(bytes);
ok(valid, `the app's validator accepts it${valid ? '' : ` (${errors})`}`);
if (!valid) process.exit(1);

// Structure can validate while the payloads still do not decode — the CRCs
// cover the compressed bytes, not what they inflate to. A compression
// mismatch (raw deflate one side, zlib-wrapped the other) lands exactly here,
// and thrown from a bare `await` it reads as a crash in this script rather
// than as the two implementations disagreeing.
let manifest, entry, assets;
try {
  ({ manifest, entry, assets } = await unpackExtbk(bytes));
} catch (e) {
  console.error(`  ✘ the app could not decode a bundle the CLI just wrote: ${e?.message ?? e}`);
  console.error('\nThe two implementations of the .extbk format have diverged.');
  console.error('Compare src/utils/extbkFormat.js against extensions/extbk-cli/src/format.js.');
  process.exit(1);
}

ok(manifest.id === MANIFEST.id, 'the manifest id survives');
ok(manifest.version === MANIFEST.version, 'and the version');
ok(entry === ENTRY, 'the entry file is byte-identical');
// The relative import is what the app's module graph resolves. A format that
// mangled it would fail much later, inside a frame, as a bare-specifier error.
ok(entry.includes("'./lib/helper.js'"), 'including the relative import in it');

const byPath = new Map(assets.map((a) => [a.path, a]));
ok(byPath.size === 3, `all three assets came back (got ${byPath.size}: ${[...byPath.keys()].join(', ')})`);

const dec = new TextDecoder();
const asText = (a) => (typeof a?.data === 'string' ? a.data : dec.decode(new Uint8Array(Object.values(a?.data ?? {}))));

ok(asText(byPath.get('lib/helper.js')) === HELPER, 'a nested .js asset is byte-identical');
// The one a text/binary mix-up mangles rather than drops.
ok(asText(byPath.get('lib/config.json')) === UNICODE, 'and a UTF-8 asset, emoji and all');
ok(asText(byPath.get('lib/bulk.txt')) === BULK, 'and one large enough to span RS chunks');

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failed) {
  console.error(`${failed} check(s) FAILED — the CLI and the app disagree about the .extbk format.`);
  process.exit(1);
}
console.log('✔ the app reads what the CLI writes.');
