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
import { isEpk, readEpk, inspectEpk }  from '../epkFormat.js';
import { validateManifest }            from '../manifest.js';

export async function cmdCheck(extbkFile) {
  const file = path.resolve(extbkFile);
  if (!fs.existsSync(file)) die(`File not found: ${file}`);

  log(`Checking ${chalk.cyan(path.basename(file))} ...\n`);

  const buf = fs.readFileSync(file);

  // Two formats ship, and this only knew one.
  //
  // `build` writes VCHS-EPK for apiVersion 2 and VCHS-ECS for everything else
  // — and `check` read every file as ECS, so it answered "Invalid magic bytes
  // — not an .extbk file" for a package it had just written itself. An
  // author's loop is build, check, ship; the middle step told them their own
  // output was broken.
  if (isEpk(buf)) return checkEpk(file, buf);

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

/**
 * The same questions, asked of a VCHS-EPK package.
 *
 * `readEpk` runs the repair ladder, so a package it returns is one the app
 * would also accept — which is the only thing this command is really for.
 */
async function checkEpk(file, buf) {
  let pkg, info;
  try {
    info = inspectEpk(buf);
    pkg  = await readEpk(buf);
  } catch (e) {
    bad(e.message);
    die('\nValidation failed');
  }

  ok('Magic bytes, header and section digests valid  (VCHS-EPK)');

  // validateManifest THROWS; it does not answer {ok, errors}. Same call shape
  // the ECS branch above uses.
  const { manifest } = pkg;
  try {
    validateManifest(manifest);
  } catch (e) {
    die(`manifest.json invalid: ${e.message}`);
  }
  ok(`manifest.json — id: ${chalk.bold(manifest.id)}, version: ${chalk.bold(manifest.version)}, name: ${manifest.name}`);

  const modules = Object.keys(pkg.modules ?? {});
  const entry = manifest.entry ?? 'index.js';
  if (!modules.includes(entry)) {
    bad(`entry "${entry}" is not in the package`);
    die('\nValidation failed');
  }
  ok(`${entry} found`);
  log(`  ${modules.length} module(s)${info?.repaired ? chalk.yellow('  · repaired on read') : ''}`);

  log('');
  log(chalk.green.bold('v Extension bundle is valid (VCHS-EPK binary format)'));
  return true;
}
