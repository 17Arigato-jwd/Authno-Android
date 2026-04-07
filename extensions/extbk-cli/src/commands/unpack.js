/**
 * extbk unpack <file.extbk> [destDir]
 *
 * Extracts all sections from a VCHS-ECS .extbk archive:
 *   manifest.json   — from MNFT section
 *   index.js        — from ENTR section
 *   assets/**       — from ASST sections, original paths preserved
 */

import fs    from 'fs';
import path  from 'path';
import chalk from 'chalk';
import { unpackExtbk } from '../format.js';

export async function cmdUnpack(extbkFile, destDir, opts) {
  const file = path.resolve(extbkFile);
  if (!fs.existsSync(file)) die(`File not found: ${file}`);

  const buf = fs.readFileSync(file);
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
