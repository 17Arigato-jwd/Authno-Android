/**
 * fsText.js — a file's text, whatever the platform handed back.
 *
 * Capacitor's Filesystem is two implementations behind one name, and they
 * disagree about `encoding` on the way out. The native one honours it and
 * returns a string. The web one — which is what a browser, Electron and this
 * project's sandbox host all get — has the line commented out:
 *
 *     async readFile(options) {
 *       const path = this.getPath(options.directory, options.path);
 *       // const encoding = options.encoding;
 *       ...
 *       return { data: entry.content ? entry.content : '' };
 *     }
 *
 * It returns whatever `writeFile` put in IndexedDB. The installer wrote base64
 * — which native decodes on the way in and web stores verbatim — so on every
 * non-Android platform `readFile({ encoding: 'utf8' })` came back as base64 and
 * `JSON.parse` choked on the first character. Extensions installed cleanly on
 * desktop, reported success, and were then invisible: discovery read every
 * manifest, failed to parse every one, logged it and returned nothing.
 *
 * The installer now writes text as text, which is the actual fix and makes both
 * platforms store the same thing. This exists for what is already on disk: an
 * extension installed by a build that wrote base64 would otherwise stay
 * unreadable forever, with no way for anybody to tell why.
 */

/**
 * True only for a string that cannot be the text we were expecting.
 *
 * The base64 alphabet has no space, quote, brace, semicolon, dot or newline
 * outside padding — so JSON never matches (it opens with `{`), and neither
 * does any JavaScript with punctuation in it, which is all of it. The length
 * check is what stops a one-word file being mistaken for an encoding.
 */
function looksBase64(s) {
  return s.length >= 8
    && s.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

/** Decode UTF-8 base64, or throw. */
function decode(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * @param {unknown} data  whatever `Filesystem.readFile` resolved with
 * @returns {string}      the file's text, or '' if there is none
 */
export function fsText(data) {
  if (typeof data !== 'string') return '';
  if (!looksBase64(data)) return data;
  try { return decode(data); } catch { return data; }
}
