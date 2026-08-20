/**
 * protocolScript.mjs — sandboxProtocol.js, as a classic script.
 *
 * Three browser checks need the REAL protocol module running in a REAL page:
 * check-extensions, stress-extensions and check-cloud-backup-v2. Each had its
 * own copy of this eight-line transform, and each carried its own guard
 * asserting the shape it strips.
 *
 * Then the module was refactored — `const BOOTSTRAP = \`…\`` became
 * `frameBootstrap(apiSource)` so v1 and v2 could share one protocol — and two
 * of the three guards were updated. The third failed CI, which is the good
 * outcome: the guard exists precisely so that a transform that has stopped
 * matching announces itself instead of silently testing nothing.
 *
 * It is one function now. A guard worth having is worth having once.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The module's source with `export` stripped, ready for `addScriptTag`.
 *
 * @param {string[]} [needs] identifiers the caller relies on being global
 *                           after the strip. Checked here so a caller that
 *                           needs BOOTSTRAP_V2 fails loudly rather than
 *                           finding `undefined` inside the page.
 */
export function protocolScript(needs = ['BOOTSTRAP', 'createHostRouter']) {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'sandboxProtocol.js'), 'utf8');
  const out = src.replace(/^export /gm, '');

  // The shape the strip depends on. `frameBootstrap` is the template both
  // bootstraps are built from; if it is gone the file has been restructured
  // again and every check downstream is testing a fixture of itself.
  const shape = [
    [/function frameBootstrap\(/, 'function frameBootstrap('],
    [/function createHostRouter\(/, 'function createHostRouter('],
  ];
  for (const [re, what] of shape) {
    if (!re.test(out)) {
      throw new Error(
        `sandboxProtocol.js no longer contains ${what} — the transform in `
        + 'scripts/protocolScript.mjs has stopped matching. Fix the transform; '
        + 'do not delete the check, or every browser check below it starts '
        + 'passing against nothing.',
      );
    }
  }

  for (const name of needs) {
    // Declared at top level after the strip, which is what makes it reachable
    // as a bare identifier inside page.evaluate.
    if (!new RegExp(`^(?:const|let|function)\\s+${name}\\b`, 'm').test(out)) {
      throw new Error(`sandboxProtocol.js no longer defines ${name} at top level`);
    }
  }

  return out;
}
