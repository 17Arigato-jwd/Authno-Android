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
import { packEpk, CODEC_STORE, CODEC_DEFLATE, KIND_ASSET, KIND_CODE, KIND_FONT }
  from '../epkFormat.js';
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

  // apiVersion 2 ships in VCHS-EPK; anything else stays on ECS. One extension
  // system, two container formats, told apart by the manifest rather than
  // by a flag — an author does not choose a binary layout, they choose an API.
  const buf = manifest.apiVersion === 2
    ? await packEpkBundle({ manifest, src, entryPath, assets, rsPct })
    : await packExtbk({
      manifest,
      entry: fs.readFileSync(entryPath),
      assets: assets.map((rel) => ({ path: rel, data: fs.readFileSync(path.join(src, rel)) })),
      rsPct,
    });

  fs.writeFileSync(out, buf);
  said(`Built ${chalk.bold(path.basename(out))} — ${fmtBytes(buf.length)}`
    + chalk.dim(manifest.apiVersion === 2 ? '  (VCHS-EPK)' : '  (VCHS-ECS)'));

  // The format allows a gigabyte. The app cannot open anything like that.
  //
  // Every install path holds the package whole and several times over — the
  // native read, its copy, its base64, the JS string, the decoded bytes — so
  // peak memory is six to eight times the file. The app refuses above 64 MB,
  // and refuses lower than that on a device with a small heap.
  //
  // Said here because this is the last moment it costs nothing to fix. An
  // author who learns it from a user's install failure has already shipped.
  if (buf.length > APP_READ_LIMIT) {
    warn(`This is larger than AuthNo will open (${fmtBytes(APP_READ_LIMIT)}).`);
    warn('Installing it will fail on every device. Ship large assets separately');
    warn('and fetch them, or split the extension.');
  } else if (buf.length > APP_READ_LIMIT / 2) {
    warn(`Over half of what AuthNo will open (${fmtBytes(APP_READ_LIMIT)}).`);
    warn('Devices with a small heap refuse lower than that.');
  }

  return { out, bytes: buf.length, manifest, assets };
}

/**
 * The most the app will read, matching MAX_JS_READ in src/utils/epkFormat.js.
 *
 * Not the format's ceiling — that is 4 GiB — and not its policy cap of 1 GB
 * either. This is what an install can actually carry across the bridge.
 */
const APP_READ_LIMIT = 64 * 1024 * 1024;

/** Which files are code and belong in the RS-protected core (spec §4). */
const CODE_EXT = /\.(m?js|cjs)$/i;
/** Already-compressed formats. Deflating one costs CPU and gains under 1%. */
const PRECOMPRESSED = /\.(png|jpe?g|webp|gif|avif|woff2?|mp[34]|m4a|ogg|opus|webm|zip|gz)$/i;
const FONT_EXT = /\.(woff2?|ttf|otf)$/i;

/**
 * Build a v2 package.
 *
 * The split that matters is core versus blob. Every .js file goes into the
 * core, which is Reed-Solomon protected and capped at 4 MB, because losing it
 * means there is no extension. Everything else is a blob entry: an image that
 * fails its hash is dropped and the extension runs with a gap, which is not a
 * lowering of standards but the same graceful-degradation stance the app takes
 * with a partially recoverable book.
 */
async function packEpkBundle({ manifest, src, entryPath, assets, rsPct }) {
  const modules = { 'index.js': fs.readFileSync(entryPath, 'utf8') };
  const blobs = [];

  for (const rel of assets) {
    const abs = path.join(src, rel);
    if (CODE_EXT.test(rel)) {
      modules[rel] = fs.readFileSync(abs, 'utf8');
      continue;
    }
    const data = fs.readFileSync(abs);
    blobs.push({
      path: rel,
      data,
      kind: rel.endsWith('.wasm') ? KIND_CODE : FONT_EXT.test(rel) ? KIND_FONT : KIND_ASSET,
      // Stored when already compressed, deflated when text-shaped.
      codec: PRECOMPRESSED.test(rel) ? CODEC_STORE : CODEC_DEFLATE,
    });
  }

  return Buffer.from(await packEpk({ manifest, modules, assets: blobs, rsPct }));
}
