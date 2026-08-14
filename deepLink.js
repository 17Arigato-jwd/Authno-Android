/**
 * deepLink.js — finding an `authno://` URL among the arguments an OS hands us.
 *
 * The desktop half of the Google sign-in round trip. The gate already ends
 * that trip by redirecting to `authno://auth/google?google=<handoff>` — that
 * branch has been in the Worker since Android shipped — so desktop needs only
 * two things: to be registered as the handler for the scheme, and to find the
 * URL once the OS launches it with one.
 *
 * The second part sounds trivial and is not, which is why it lives here rather
 * than inline in main.js. Every platform delivers it differently:
 *
 *   - Windows appends the URL to argv of a NEW process. If the app is already
 *     running, single-instance forwards that argv to the running one.
 *   - Linux does the same via the .desktop entry's Exec line.
 *   - macOS does not use argv at all; it fires `open-url`, sometimes before
 *     the app is ready.
 *
 * And argv is not just the URL. A packaged launch carries the executable path;
 * an unpackaged one carries Electron's path and the script; Chromium adds its
 * own switches; and the same argv may also hold a `.authbook` path, because
 * both file associations and the scheme point at the same binary. So this
 * searches rather than indexes, and it is a pure function over an array of
 * strings, which means the shapes above are all reachable from a test on a
 * machine that is none of those platforms.
 *
 * CommonJS, because main.js is not a module.
 */

/** The one scheme this app claims. Must match AndroidManifest and the Worker. */
const SCHEME = 'authno';

/**
 * The first `authno://` argument, or null.
 *
 * Matching is on the scheme alone, not on `authno://auth/google`, so a future
 * deep link does not need this function edited to be delivered. Deciding what
 * to do with one is the renderer's job.
 *
 * @param {string[]} argv
 * @param {string} scheme
 * @returns {string|null}
 */
function deepLinkFromArgv(argv, scheme = SCHEME) {
  const prefix = `${scheme}://`;
  for (const a of argv || []) {
    if (typeof a !== 'string') continue;
    // Windows can hand it over quoted when the URL contains characters cmd
    // treats as special, and a base64url handoff contains `-` and `_` but the
    // query separator `&` is enough to earn quotes on its own.
    const clean = a.trim().replace(/^"(.*)"$/, '$1');
    if (clean.toLowerCase().startsWith(prefix)) return clean;
  }
  return null;
}

/**
 * Whether a URL is one we should act on.
 *
 * The OS will hand us anything registered to the scheme, including whatever a
 * web page put in an anchor href. Nothing here trusts the contents — the
 * handoff inside is exchanged over TLS and refused if it is wrong — but a URL
 * that is not even ours should not reach the renderer at all.
 */
function isAuthnoLink(url, scheme = SCHEME) {
  if (typeof url !== 'string') return false;
  return url.trim().toLowerCase().startsWith(`${scheme}://`);
}

module.exports = { SCHEME, deepLinkFromArgv, isAuthnoLink };
