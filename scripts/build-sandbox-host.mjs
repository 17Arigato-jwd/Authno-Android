#!/usr/bin/env node
/**
 * build-sandbox-host.mjs — the app an extension author develops against.
 *
 * The sandbox used to ship a copy of AuthNo's production build, downloaded
 * from CI and dropped into the installer. That is the thing the owner asked to
 * stop: the tool exists so somebody can test an extension, and shipping the
 * whole app to do it hands over the gate, the onboarding, the account system
 * and the billing flow to anybody who downloads a dev tool — none of which an
 * extension can call, look at, or be affected by.
 *
 * So this builds a different app. `src/sandbox/` imports the eight surfaces an
 * extension can reach and nothing else, and esbuild follows imports: what the
 * host does not import does not enter the graph, and what is not in the graph
 * is not in the bytes. That is a stronger claim than a hidden route, and it is
 * checkable — `check-sandbox-bundle.mjs` reads the output and fails on any of
 * the excluded modules or on strings that only the excluded code contains.
 *
 * Two things are replaced rather than dropped:
 *
 *   storage.js  → src/sandbox/stubs/storage.js. Four export functions are
 *                 reachable through `library.export`; the other 1300 lines are
 *                 the app's business with the device.
 *
 * No source map. A map would put every excluded module's original source back
 * into the package as text, which would undo the entire exercise.
 *
 * Usage: npm run build:sandbox-host [-- --outdir <dir>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'src/sandbox/index.jsx');

const argIdx = process.argv.indexOf('--outdir');
const OUT = path.resolve(
  argIdx > -1 ? process.argv[argIdx + 1] : path.join(ROOT, 'extensions/extbk-sandbox/host'),
);

/**
 * storage.js, swapped for the stub.
 *
 * Matched on the resolved path rather than the specifier: it is imported as
 * './storage' from extensionRuntime.js and as '../utils/storage' from
 * elsewhere, and a specifier-only rule would catch one and miss the other.
 */
const stubStorage = {
  name: 'stub-storage',
  setup(b) {
    b.onResolve({ filter: /(^|\/)storage(\.js)?$/ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      if (!resolved.startsWith(path.join(ROOT, 'src/utils'))) return null;
      return { path: path.join(ROOT, 'src/sandbox/stubs/storage.js') };
    });
  },
};

/** What went into the bundle, so the check can look at the graph as well as the bytes. */
function writeManifest(meta, outFile) {
  const modules = Object.keys(meta.outputs[Object.keys(meta.outputs)[0]].inputs)
    .map((p) => p.replace(/\\/g, '/'))
    .sort();
  fs.writeFileSync(outFile, `${JSON.stringify({ modules }, null, 2)}\n`);
  return modules;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: path.join(OUT, 'host.js'),
  format: 'iife',
  target: ['chrome110', 'firefox110', 'safari16'],
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  // Deliberate. See the header: a map is the excluded source, shipped.
  sourcemap: false,
  metafile: true,
  plugins: [stubStorage],
  logLevel: 'error',
});

const modules = writeManifest(result.metafile, path.join(OUT, 'modules.json'));

fs.writeFileSync(path.join(OUT, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AuthNo sandbox host</title>
<link rel="stylesheet" href="./host.css">
<style>html,body,#root{height:100%;margin:0}body{background:#0f0f11}</style>
</head>
<body><div id="root"></div><script src="./host.js"></script></body>
</html>
`);

const bytes = fs.statSync(path.join(OUT, 'host.js')).size;
console.log(`✔ sandbox host → ${path.relative(ROOT, OUT)}`);
console.log(`  ${(bytes / 1024).toFixed(0)} KB from ${modules.length} modules`);
