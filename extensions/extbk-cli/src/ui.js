/**
 * ui.js — shared console output.
 *
 * The commands each had their own copy of log/ok/die, and they had drifted:
 * build printed `v` and `x`, init printed `✔` and `✘`, check printed both. One
 * module, one set of glyphs, with an ASCII fallback for terminals that cannot
 * render them.
 */
import chalk from 'chalk';

const UNICODE_OK = process.platform !== 'win32'
  || Boolean(process.env.WT_SESSION)      // Windows Terminal
  || process.env.TERM_PROGRAM === 'vscode';

export const TICK  = UNICODE_OK ? '✔' : 'v';
export const CROSS = UNICODE_OK ? '✘' : 'x';
export const BULL  = UNICODE_OK ? '·' : '-';
export const WARN  = UNICODE_OK ? '▲' : '!';

export function log(msg = '')  { process.stdout.write(msg + '\n'); }
export function ok(msg)        { log(`${chalk.green(TICK)} ${msg}`); }
export function step(msg)      { log(`  ${chalk.dim(BULL)} ${msg}`); }
export function warn(msg)      { process.stderr.write(`${chalk.yellow(WARN)} ${msg}\n`); }
export function bad(msg)       { process.stderr.write(`  ${chalk.red(CROSS)} ${msg}\n`); }

export function die(msg) {
  process.stderr.write(`${chalk.red(CROSS)} ${msg}\n`);
  process.exit(1);
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** HH:MM:SS, for watch-mode rebuild lines. */
export function clock() {
  return new Date().toTimeString().slice(0, 8);
}
