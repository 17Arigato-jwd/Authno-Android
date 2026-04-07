/**
 * manifest.js — shared manifest helpers for extbk-cli
 */

import fs   from 'fs';
import path from 'path';

/**
 * Validate a raw manifest object.
 * Throws with a human-readable message on any failure.
 * Returns the manifest on success.
 */
export function validateManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('must be a JSON object');
  if (!raw.id      || typeof raw.id      !== 'string') throw new Error('"id" is required (string)');
  if (!raw.name    || typeof raw.name    !== 'string') throw new Error('"name" is required (string)');
  if (!raw.version || typeof raw.version !== 'string') throw new Error('"version" is required (string)');
  if (!/^[\w.-]+$/.test(raw.id))
    throw new Error('"id" must contain only letters, numbers, dots, or dashes');
  if (raw.id.includes('..') || raw.id.includes('/') || raw.id.includes('\\'))
    throw new Error('"id" must not contain path separators');
  return raw;
}

/**
 * Load manifest.json from a source directory and validate it.
 * Exits the process with a readable error on failure.
 */
export function loadAndValidateManifest(srcDir) {
  const p = path.join(srcDir, 'manifest.json');
  if (!fs.existsSync(p)) {
    process.stderr.write(`✘ manifest.json not found in ${srcDir}\n`);
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    process.stderr.write(`✘ manifest.json parse error: ${e.message}\n`);
    process.exit(1);
  }
  try {
    return validateManifest(raw);
  } catch (e) {
    process.stderr.write(`✘ manifest.json invalid: ${e.message}\n`);
    process.exit(1);
  }
}
