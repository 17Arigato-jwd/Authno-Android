/**
 * extbk unpack <file.extbk> [destDir]
 *
 * Extracts every file from a .extbk archive, in either format:
 *   VCHS-ECS  manifest.json from MNFT, index.js from ENTR, assets from ASST
 *   VCHS-EPK  manifest.json and the module graph from CORE, the rest from the
 *             directory — so a multi-file extension comes back as it went in
 *
 * `check` and `info` learned to read VCHS-EPK when the CLI could not validate
 * its own output. This one was missed, so `build` wrote a package that
 * `unpack` refused with "Invalid magic bytes — not an .extbk file". An
 * author's loop is build, check, ship; theirs is also unpack somebody else's
 * and read it, and that is the loop this broke.
 */

import fs    from 'fs';
import path  from 'path';
import chalk from 'chalk';
import { unpackExtbk } from '../format.js';
import { isEpk, readEpk } from '../epkFormat.js';

export async function cmdUnpack(extbkFile, destDir, opts) {
  const file = path.resolve(extbkFile);
  if (!fs.existsSync(file)) die(`File not found: ${file}`);

  const buf = fs.readFileSync(file);
  if (isEpk(buf)) return unpackEpk(file, buf, destDir, opts);

  let unpacked;
  try {
    unpacked = await unpackExtbk(buf);
  } catch (e) {
    die(`Failed to decode: ${e.message}`);
  }

  const { manifest, entry, assets } = unpacked;

  // Determine destination directory
  let dest = destDir
    ? path.resolve(destDir)
    : path.resolve(`${manifest.id}-${manifest.version}`);

  if (fs.existsSync(dest)) {
    if (!opts.overwrite) die(`Destination exists: ${dest}\nUse --overwrite to replace.`);
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });

  log(`Unpacking ${chalk.cyan(path.basename(file))} -> ${chalk.cyan(dest)}\n`);

  // Write manifest.json
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  log(`  ${chalk.dim('+')} manifest.json`);

  // Write index.js
  fs.writeFileSync(path.join(dest, 'index.js'), entry, 'utf8');
  log(`  ${chalk.dim('+')} index.js`);

  // Write assets
  for (const { path: relPath, data } of assets) {
    // Path traversal guard
    const outPath = path.join(dest, relPath);
    if (!outPath.startsWith(dest + path.sep)) {
      log(`  ${chalk.yellow('!')} Skipping unsafe path: ${relPath}`);
      continue;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, data);
    log(`  ${chalk.dim('+')} ${relPath}`);
  }

  log('');
  log(chalk.green.bold(`v Unpacked ${2 + assets.length} files to ${dest}`));
}

function log(msg) { process.stdout.write(msg + '\n'); }
function die(msg) { process.stderr.write(`${chalk.red('x')} ${msg}\n`); process.exit(1); }

/**
 * The same, from a VCHS-EPK package.
 *
 * A v2 package is a module graph plus a directory, not one entry file and a
 * pile of assets — so every module lands at its own path and every directory
 * record beside it. readEpk has already run the repair ladder and dropped
 * anything it could not verify, which is reported rather than passed off as a
 * complete extraction.
 */
async function unpackEpk(file, buf, destDir, opts) {
  let pkg;
  try {
    pkg = await readEpk(buf);
  } catch (e) {
    die(`Failed to decode: ${e.message}`);
  }

  const { manifest, modules, entries } = pkg;
  const dest = prepareDest(destDir, manifest, opts);

  log(`Unpacking ${chalk.cyan(path.basename(file))} -> ${chalk.cyan(dest)}  ${chalk.dim('(VCHS-EPK)')}\n`);

  write(dest, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  let n = 1;
  for (const name of Object.keys(modules).sort()) {
    if (write(dest, name, Buffer.from(modules[name], 'utf8'))) n++;
  }
  for (const relPath of [...entries.keys()].sort()) {
    const raw = await pkg.read(relPath);
    // Rung 8: a record whose hash never matched is dropped, not invented.
    if (!raw) { log(`  ${chalk.yellow('!')} ${relPath} — unreadable, skipped`); continue; }
    if (write(dest, relPath, Buffer.from(raw))) n++;
  }

  for (const r of pkg.repairs) log(chalk.dim(`  · repaired rung ${r.rung}: ${r.what}`));
  for (const w of pkg.warnings) log(chalk.yellow(`  ! ${w.path}: ${w.why}`));

  log('');
  log(chalk.green.bold(`v Unpacked ${n} files to ${dest}`));
}

/** Resolve, guard and create the output directory. */
function prepareDest(destDir, manifest, opts) {
  const dest = destDir
    ? path.resolve(destDir)
    : path.resolve(`${manifest.id}-${manifest.version}`);
  if (fs.existsSync(dest)) {
    if (!opts.overwrite) die(`Destination exists: ${dest}\nUse --overwrite to replace.`);
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  return dest;
}

/** Write one file under dest, refusing anything that climbs out of it. */
function write(dest, relPath, data) {
  const outPath = path.join(dest, relPath);
  if (outPath !== dest && !outPath.startsWith(dest + path.sep)) {
    log(`  ${chalk.yellow('!')} Skipping unsafe path: ${relPath}`);
    return false;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, data);
  log(`  ${chalk.dim('+')} ${relPath}`);
  return true;
}
