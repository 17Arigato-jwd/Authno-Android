/**
 * Where the browser is.
 *
 * Every browser-driven check in this repo took `CHROMIUM_PATH` from the
 * environment and passed `undefined` when it was unset — which makes
 * playwright-core look in its own download directory. This image does not have
 * one: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` holds a chromium that
 * playwright-core was not the one to install, so the default lookup resolves to
 * a path that does not exist and the script dies before its first assertion:
 *
 *   browserType.launch: Executable doesn't exist at
 *   …/chromium_headless_shell-1234/chrome-headless-shell-linux64/…
 *
 * That is not a check failing. It is a check not running, and it exits with the
 * same code either way if nobody is reading. `npm run check:sandbox` — the one
 * standing between an extension and the manuscripts — has been in that state,
 * which is part of how the UI frame kept `allow-same-origin` while the docs
 * recorded it as closed.
 *
 * So: look where this image actually keeps one, and say so out loud when
 * nothing is found rather than handing playwright a path to fail on.
 */
import fs from 'node:fs';

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

export function chromiumPath() {
  for (const p of CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  // undefined lets playwright-core try its own install, which is right on a
  // developer machine that has one. Say what was tried either way — the error
  // playwright raises names a path nobody chose, which reads like a broken
  // install rather than a missing browser.
  console.warn(
    'No chromium found at any of:\n  '
    + CANDIDATES.filter(Boolean).join('\n  ')
    + "\nFalling back to playwright's own. Set CHROMIUM_PATH to point somewhere else.",
  );
  return undefined;
}

/** The launch options every check in this repo uses. */
export function launchOptions(extra = {}) {
  return {
    executablePath: chromiumPath(),
    // Required in the container images this runs in; harmless elsewhere.
    args: ['--no-sandbox', ...(extra.args ?? [])],
    ...extra,
  };
}
