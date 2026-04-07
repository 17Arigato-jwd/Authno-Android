/**
 * extbk check <file.extbk>
 *
 * Validates a .extbk binary archive using VCHS-ECS structural checks:
 *   1. Magic bytes
 *   2. Format version
 *   3. Section index integrity
 *   4. CRC32 per section
 *   5. Required sections (MNFT, ENTR)
 *   6. Manifest field validation
 * Exit 0 = valid, 1 = invalid.
 */

import fs    from 'fs';
import path  from 'path';
import chalk from 'chalk';
import { validateExtbk, unpackExtbk } from '../format.js';
import { validateManifest }            from '../manifest.js';

export async function cmdCheck(extbkFile) {
  const file = path.resolve(extbkFile);
  if (!fs.existsSync(file)) die(`File not found: ${file}`);

  log(`Checking ${chalk.cyan(path.basename(file))} ...\n`);

  const buf = fs.readFileSync(file);

  // Structural + CRC validation
  const { ok: structOk, errors } = validateExtbk(buf);
  if (!structOk) {
    errors.forEach(e => bad(e));
    die('\nValidation failed');
  }
  ok('Magic bytes, version, and section CRCs valid');

  // Parse and validate manifest
  let manifest;
  try {
    const unpacked = await unpackExtbk(buf);
    manifest = unpacked.manifest;
  } catch (e) {
    die(`Failed to decode: ${e.message}`);
  }

  try {
    validateManifest(manifest);
  } catch (e) {
    die(`manifest.json invalid: ${e.message}`);
  }
  ok(`manifest.json — id: ${chalk.bold(manifest.id)}, version: ${chalk.bold(manifest.version)}, name: ${manifest.name}`);

  log('');
  log(chalk.green.bold('v Extension bundle is valid (VCHS-ECS binary format)'));
}

function log(msg) { process.stdout.write(msg + '\n'); }
function ok(msg)  { log(`  ${chalk.green('v')} ${msg}`); }
function bad(msg) { process.stderr.write(`  ${chalk.red('x')} ${msg}\n`); }
function die(msg) { process.stderr.write(`\n${chalk.red('x')} ${msg}\n`); process.exit(1); }
