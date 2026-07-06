/**
 * extbk thmbk-build <srcDir|theme.json> [outFile] [options]
 *
 * Packs a theme into a .thmbk downloadable-theme archive. Same VCHS-ECS
 * container as .extbk, so theme authors work in plain JSON and pack at the end.
 *
 * Accepts either:
 *   - a directory containing manifest.json + theme.json, or
 *   - a single theme.json that also carries a `manifest` key.
 *
 * manifest.json / manifest key must contain:
 *   { "type": "theme", "id": "...", "name": "...", "version": "...", "author"? }
 */

import fs    from 'fs';
import path  from 'path';
import chalk from 'chalk';
import { packExtbk } from '../format.js';

export async function cmdThmbkBuild(srcPath, outFile, opts) {
  const src = path.resolve(srcPath);
  if (!fs.existsSync(src)) die(`Source not found: ${src}`);

  let manifest, theme;

  if (fs.statSync(src).isDirectory()) {
    const mPath = path.join(src, 'manifest.json');
    const tPath = path.join(src, 'theme.json');
    if (!fs.existsSync(mPath)) die('Missing manifest.json in theme directory');
    if (!fs.existsSync(tPath)) die('Missing theme.json in theme directory');
    manifest = readJson(mPath, 'manifest.json');
    theme    = readJson(tPath, 'theme.json');
  } else {
    // Single JSON file that bundles both.
    const obj = readJson(src, path.basename(src));
    manifest = obj.manifest;
    theme    = obj.theme ?? obj;
    if (theme && theme.manifest) delete theme.manifest;
  }

  validateThemeManifest(manifest);
  ok(`Theme manifest valid — ${chalk.bold(manifest.id)} v${manifest.version}`);

  if (!theme || typeof theme !== 'object' || Array.isArray(theme))
    die('theme.json must be a JSON object');
  if (theme.meta?.id && theme.meta.id !== manifest.id)
    die(`theme.meta.id (${theme.meta.id}) must match manifest.id (${manifest.id})`);

  const rsPct = Math.max(0, Math.min(100, parseInt(opts.rsPct ?? '20', 10)));
  const outName = outFile ?? `${manifest.id}-${manifest.version}.thmbk`;
  const out     = path.resolve(outName);
  if (fs.existsSync(out) && !opts.overwrite)
    die(`Output already exists: ${out}\nUse --overwrite to replace it.`);

  log(`Building ${chalk.cyan(path.basename(out))} (RS ${rsPct}%) ...`);

  // theme.json rides in the ENTR section — same slot .extbk uses for index.js.
  const buf = await packExtbk({
    manifest,
    entry: JSON.stringify(theme, null, 2),
    assets: [],
    rsPct,
  });

  fs.writeFileSync(out, buf);
  ok(`Wrote ${chalk.bold(path.basename(out))} — ${fmtBytes(buf.length)}`);
}

function validateThemeManifest(m) {
  if (!m || typeof m !== 'object') die('theme manifest must be a JSON object');
  if (m.type !== 'theme') die("manifest.type must be 'theme' for a .thmbk file");
  for (const k of ['id', 'name', 'version']) {
    if (!m[k] || typeof m[k] !== 'string') die(`theme manifest.${k} is required`);
  }
  if (!/^[\w.-]+$/.test(m.id) || m.id.includes('..'))
    die('theme manifest.id must be alphanumeric, dots, or dashes');
}

function readJson(p, label) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(`${label} is not valid JSON: ${e.message}`); }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const ok  = (m) => console.log(chalk.green('✓ ') + m);
const log = (m) => console.log(m);
function die(m) { console.error(chalk.red('✗ ') + m); process.exit(1); }
