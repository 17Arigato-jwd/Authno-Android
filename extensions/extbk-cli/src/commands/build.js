/**
 * extbk build <srcDir> [outFile] [options]
 *
 * Packs an extension directory into a VCHS-ECS .extbk binary archive.
 *
 * Required files:
 *   manifest.json   — validated before any bytes are written
 *   index.js        — extension entry point (ENTR section)
 *
 * Everything else becomes an ASST section with its relative path preserved,
 * minus the default exclusions and anything in .extbkignore (see pack.js).
 */

import fs    from 'fs';
import path  from 'path';
import chalk from 'chalk';
import { packExtbk }               from '../format.js';
import { loadAndValidateManifest } from '../manifest.js';
import { collectAssets, auditManifest } from '../pack.js';
import { ok, warn, bad, die, log, step, fmtBytes } from '../ui.js';

export async function cmdBuild(srcDir, outFile, opts) {
  const result = await buildOnce(srcDir, outFile, opts);
  log(chalk.dim(result.out));
}

/**
 * The build itself, factored out so `extbk watch` can call it in a loop
 * without re-implementing any of it.
 */
export async function buildOnce(srcDir, outFile, opts = {}, { quiet = false } = {}) {
  const say  = quiet ? () => {} : log;
  const said = quiet ? () => {} : ok;
  const sub  = quiet ? () => {} : step;

  const src = path.resolve(srcDir);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory())
    die(`Source directory not found: ${src}`);

  const manifest = loadAndValidateManifest(src);
  said(`Manifest valid — ${chalk.bold(manifest.id)} v${manifest.version}`);

  const entryPath = path.join(src, 'index.js');
  if (!fs.existsSync(entryPath)) {
    die('Missing required file: index.js\n' +
        '  Every extension needs an entry point exporting activate().\n' +
        `  Run ${chalk.cyan('extbk init')} to scaffold one.`);
  }
  said('index.js found');

  const rsPct = parseInt(opts.rsPct ?? '20', 10);
  if (Number.isNaN(rsPct) || rsPct < 0 || rsPct > 100)
    die('--rs-pct must be an integer between 0 and 100');

  const assets = collectAssets(src);

  // Cross-check the manifest against what is actually going into the bundle.
  // Every one of these used to build cleanly and fail later on a device.
  const problems = auditManifest(manifest, src, assets);
  if (problems.length) {
    if (opts.force) {
      problems.forEach((p) => warn(p));
    } else {
      problems.forEach((p) => bad(p));
      die(`${problems.length} problem(s) in manifest.json.\n` +
          `  These build fine and then fail on device, usually as a blank screen.\n` +
          `  Fix them, or pass ${chalk.cyan('--force')} if you know better.`);
    }
  }

  const outName = outFile ?? `${manifest.id}-${manifest.version}.extbk`;
  const outDir  = opts.outDir ? path.resolve(opts.outDir) : process.cwd();
  const out     = path.isAbsolute(outName) ? outName : path.join(outDir, outName);

  if (fs.existsSync(out) && !opts.overwrite)
    die(`Output already exists: ${out}\n  Use --overwrite to replace it.`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  say(`  ${chalk.dim(`${assets.length} asset file(s)`)}`);
  if (!quiet) {
    for (const a of assets.slice(0, 12)) sub(chalk.dim(a));
    if (assets.length > 12) sub(chalk.dim(`…and ${assets.length - 12} more`));
  }
  say(`Building ${chalk.cyan(path.basename(out))} (RS ${rsPct}%) ...`);

  const buf = await packExtbk({
    manifest,
    entry: fs.readFileSync(entryPath),
    assets: assets.map((rel) => ({ path: rel, data: fs.readFileSync(path.join(src, rel)) })),
    rsPct,
  });

  fs.writeFileSync(out, buf);
  said(`Built ${chalk.bold(path.basename(out))} — ${fmtBytes(buf.length)}`);
  return { out, bytes: buf.length, manifest, assets };
}
