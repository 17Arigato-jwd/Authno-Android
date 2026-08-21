#!/usr/bin/env node
/**
 * check-all.mjs — every check this repo has, in one command.
 *
 * There are twelve of them and they are easy to run selectively, which is how
 * a `frameBootstrap` refactor updated two of three copies of the same shape
 * guard and shipped: the two were in checks I ran, the third was in one I did
 * not. CI caught it, three commits later, which is three commits of a red
 * branch that a single command locally would have prevented.
 *
 * It runs the build too. The build is a separate CI job, so a lint error that
 * fails it — an import in the body of a module, say — passes every test and
 * every browser check and is invisible until CI gets there.
 *
 * Everything runs even when something fails, because knowing about one broken
 * check is worth less than knowing about all of them.
 *
 * Usage: npm run check:all [-- --quick]
 *   --quick  skips the browser checks and the build, for a fast inner loop.
 */

import { spawnSync } from 'node:child_process';

const quick = process.argv.includes('--quick');

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';

/** [label, command, args, slow] — slow ones need a browser or a full build. */
const CHECKS = [
  ['unit tests', 'npx', ['react-scripts', 'test', '--watchAll=false'], false, { CI: 'true' }],
  ['epk cross-read', 'npm', ['run', 'test:epk-crosscheck'], false],
  ['vendored copies', 'npm', ['run', 'check:vendored'], false],
  ['cli build', 'npm', ['run', 'check:cli-build'], false],
  ['widget scale', 'npm', ['run', 'check:widget-scale'], false],
  ['widget fit', 'npm', ['run', 'check:widget-fit'], false],
  ['widget ids + java', 'npm', ['run', 'check:widget-ids'], false],
  ['timezones', 'npm', ['run', 'check:timezones'], false],
  ['theme tokens', 'npm', ['run', 'check:theme-tokens'], false],
  ['opened file kinds', 'npm', ['run', 'check:opened-file'], false],
  ['extension sandbox', 'npm', ['run', 'check:sandbox'], true],
  ['extension protocol', 'npm', ['run', 'check:extensions'], true],
  ['extensions under load', 'npm', ['run', 'stress:extensions'], true],
  ['cloud backup runs', 'npm', ['run', 'check:cloud-backup'], true],
  ['production build', 'npm', ['run', 'build'], true],
  // After the build, because it loads what the build produced. The other
  // browser checks drive synthetic harnesses; this one boots the real app and
  // fails on anything uncaught.
  ['app boots clean', 'npm', ['run', 'check:boot'], true],
];

const results = [];
for (const [label, cmd, args, slow, env] of CHECKS) {
  if (quick && slow) { results.push([label, 'skip', 0]); continue; }
  process.stdout.write(`${DIM}· ${label}…${OFF}\r`);
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(env ?? {}) },
    encoding: 'utf8',
    // 64 MB, because the default is 1 MB and jest writes far past it: every
    // console.error a test deliberately provokes is echoed with a stack. Past
    // the limit spawnSync kills the child with SIGTERM and reports ENOBUFS,
    // which arrives as `status: null` — indistinguishable from a real failure
    // unless you look at `error`, and a passing suite reported as failing is
    // worse than no check at all.
    maxBuffer: 64 * 1024 * 1024,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  // `error` covers the cases where the child never ran or was killed — a
  // missing binary, a buffer overrun — none of which set a status.
  const ok = r.status === 0 && !r.error;
  const detail = r.error
    ? `${r.error.message}\n${r.stderr ?? ''}`
    : `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  results.push([label, ok ? 'pass' : 'FAIL', secs, ok ? null : detail]);
  process.stdout.write(`${ok ? GREEN + '✔' : RED + '✖'} ${label}${OFF} ${DIM}${secs}s${OFF}\n`);
}

const failed = results.filter((r) => r[1] === 'FAIL');
if (failed.length) {
  console.log(`\n${BOLD}${RED}${failed.length} check(s) failed${OFF}\n`);
  for (const [label, , , output] of failed) {
    console.log(`${RED}── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}${OFF}`);
    // The tail is where the reason is; the head is a banner.
    console.log((output ?? '').split('\n').slice(-25).join('\n').trim());
    console.log('');
  }
  process.exit(1);
}

const skipped = results.filter((r) => r[1] === 'skip').length;
console.log(`\n${GREEN}Everything passes.${OFF}`
  + (skipped ? ` ${DIM}(${skipped} skipped — drop --quick before pushing)${OFF}` : ''));
