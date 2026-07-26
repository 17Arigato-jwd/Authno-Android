/**
 * extbk watch <srcDir> [outFile] [options]
 *
 * Rebuilds on every change. There was no watch mode at all before, so the loop
 * was: edit, alt-tab, re-run build, re-read the output. This keeps the archive
 * current while you work.
 *
 * Uses fs.watch rather than pulling in chokidar — the CLI has two dependencies
 * and adding a third for a convenience command is a poor trade.
 */

import fs    from 'fs';
import path  from 'path';
import chalk from 'chalk';
import { buildOnce } from './build.js';
import { loadIgnores } from '../pack.js';
import { log, ok, warn, clock, fmtBytes, TICK, CROSS } from '../ui.js';

export async function cmdWatch(srcDir, outFile, opts) {
  const src = path.resolve(srcDir);
  const ignores = loadIgnores(src);

  log('');
  log(chalk.bold('extbk watch') + chalk.dim(` — ${src}`));
  log(chalk.dim('─'.repeat(52)));

  let building = false;
  let queued = false;

  const rebuild = async (reason) => {
    if (building) { queued = true; return; }
    building = true;
    const started = Date.now();
    try {
      const { out, bytes } = await buildOnce(src, outFile, { ...opts, overwrite: true }, { quiet: true });
      log(`${chalk.dim(clock())} ${chalk.green(TICK)} ${path.basename(out)} — ${fmtBytes(bytes)} ${chalk.dim(`(${Date.now() - started}ms)`)}${reason ? chalk.dim(`  ← ${reason}`) : ''}`);
    } catch (e) {
      // buildOnce calls process.exit on fatal errors, so anything landing here
      // is unexpected. Never let it kill the watcher — the developer is mid-edit.
      log(`${chalk.dim(clock())} ${chalk.red(CROSS)} ${e.message}`);
    } finally {
      building = false;
      if (queued) { queued = false; setTimeout(() => rebuild('queued change'), 0); }
    }
  };

  await rebuild('initial build');

  // Debounced: editors write a file two or three times when saving, and some
  // write a temp file first. One rebuild per burst is what anybody wants.
  let timer = null;
  const onChange = (rel) => {
    if (!rel) return;
    if (ignores.some((m) => m(rel, false))) return;
    clearTimeout(timer);
    timer = setTimeout(() => rebuild(rel), 120);
  };

  try {
    fs.watch(src, { recursive: true }, (_event, filename) => onChange(filename));
  } catch (e) {
    // recursive:true is unsupported on some Linux kernels; fall back to
    // watching the top level, which still covers the common flat layout.
    warn(`Recursive watch unavailable (${e.code}) — watching top-level files only.`);
    fs.watch(src, (_event, filename) => onChange(filename));
  }

  log(chalk.dim('  Watching for changes. Ctrl-C to stop.'));
  log('');

  process.on('SIGINT', () => { log('\n' + chalk.dim('Stopped.')); process.exit(0); });
}
