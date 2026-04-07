/**
 * extbk build <srcDir> [outFile] [options]
 *
 * Packs an extension directory into a VCHS-ECS .extbk binary archive.
 *
 * Required files:
 *   manifest.json   — validated before any bytes are written
 *   index.js        — extension entry point (ENTR section)
 *
 * All other files become ASST sections with their relative paths preserved.
 */

import fs    from 'fs';
import path  from 'path';
import chalk from 'chalk';
import { packExtbk }               from '../format.js';
import { loadAndValidateManifest } from '../manifest.js';

export async function cmdBuild(srcDir, outFile, opts) {
  const src = path.resolve(srcDir);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory())
    die(`Source directory not found: ${src}`);

  const manifest = loadAndValidateManifest(src);
  ok(`Manifest valid — ${chalk.bold(manifest.id)} v${manifest.version}`);

  const entryPath = path.join(src, 'index.js');
  if (!fs.existsSync(entryPath)) die('Missing required file: index.js');
  ok('index.js found');

  const rsPct = Math.max(0, Math.min(100, parseInt(opts.rsPct ?? '20', 10)));
  if (isNaN(rsPct)) die('--rs-pct must be an integer 0-100');

  const outName = outFile ?? `${manifest.id}-${manifest.version}.extbk`;
  const out     = path.resolve(outName);
  if (fs.existsSync(out) && !opts.overwrite)
    die(`Output already exists: ${out}\nUse --overwrite to replace it.`);

  const assets = [];
  collectFiles(src, src, assets, ['manifest.json', 'index.js']);
  log(`  ${chalk.dim(`${assets.length} asset file(s)`)}`);
  log(`Building ${chalk.cyan(path.basename(out))} (RS ${rsPct}%) ...`);

  const assetData = assets.map(rel => ({
    path: rel,
    data: fs.readFileSync(path.join(src, rel)),
  }));

  const buf = await packExtbk({
    manifest,
    entry: fs.readFileSync(entryPath),
    assets: assetData,
    rsPct,
  });

  fs.writeFileSync(out, buf);
  ok(`Built ${chalk.bold(path.basename(out))} — ${fmtBytes(buf.length)}`);
  log(chalk.dim(out));
}

function collectFiles(base, dir, out, exclude) {
  for (const name of fs.readdirSync(dir)) {
    if (exclude.includes(name) || name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    const rel = path.relative(base, abs);
    if (fs.statSync(abs).isDirectory()) collectFiles(base, abs, out, []);
    else out.push(rel);
  }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(2)} MB`;
}
function log(msg) { process.stdout.write(msg + '\n'); }
function ok(msg)  { log(`${chalk.green('v')} ${msg}`); }
function die(msg) { process.stderr.write(`${chalk.red('x')} ${msg}\n`); process.exit(1); }
