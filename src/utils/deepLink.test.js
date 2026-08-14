/**
 * Pulling an `authno://` URL out of argv.
 *
 * Every case below is a real shape some platform actually produces, and the
 * failure mode they share is silent: the URL is not found, no deep link
 * reaches the renderer, and the sign-in promise sits spinning until the user
 * gives up. Nothing throws, nothing logs, and it only happens on the platform
 * you did not test on.
 */

const { deepLinkFromArgv, isAuthnoLink, SCHEME } = require('../../deepLink');

const LINK = 'authno://auth/google?google=abc-123_XYZ';

describe('finding the link', () => {
  /** Packaged Windows: the exe, then the URL. */
  test('after the executable path', () => {
    expect(deepLinkFromArgv(['C:\\Program Files\\AuthNo\\AuthNo.exe', LINK])).toBe(LINK);
  });

  /** Packaged Linux, from the .desktop Exec line. */
  test('after a unix executable path', () => {
    expect(deepLinkFromArgv(['/opt/AuthNo/authno', LINK])).toBe(LINK);
  });

  /**
   * Unpackaged: electron, then the script, then the URL. This is the shape you
   * develop against, so it is the one that hides a bug that only bites users.
   */
  test('after electron and a script path', () => {
    expect(deepLinkFromArgv(['/usr/bin/electron', '/home/me/authno/main.js', LINK])).toBe(LINK);
  });

  /** Chromium adds its own switches, and they can come before or after. */
  test('among chromium switches', () => {
    expect(deepLinkFromArgv([
      'AuthNo.exe', '--allow-file-access-from-files', LINK, '--no-sandbox',
    ])).toBe(LINK);
  });

  /**
   * Windows quotes an argument containing characters cmd treats as special,
   * and a query string with `&` in it earns quotes on its own. Unquoted, the
   * URL fails the prefix test and vanishes.
   */
  test('quoted', () => {
    expect(deepLinkFromArgv(['AuthNo.exe', `"${LINK}"`])).toBe(LINK);
  });

  test('with surrounding whitespace', () => {
    expect(deepLinkFromArgv(['AuthNo.exe', `  ${LINK}  `])).toBe(LINK);
  });

  /** Registry and .desktop entries do not agree on case. */
  test('with the scheme in capitals', () => {
    const shouty = 'AUTHNO://auth/google?google=abc';
    expect(deepLinkFromArgv(['AuthNo.exe', shouty])).toBe(shouty);
  });

  /**
   * The same binary handles .authbook files and the scheme, so both can be in
   * one argv — a file opened while a sign-in is in flight, say.
   */
  test('beside a .authbook path, without taking the file', () => {
    expect(deepLinkFromArgv(['AuthNo.exe', '/home/me/Book.authbook', LINK])).toBe(LINK);
  });

  test('the first one wins when there are somehow two', () => {
    expect(deepLinkFromArgv(['AuthNo.exe', LINK, 'authno://auth/google?google=second'])).toBe(LINK);
  });
});

describe('finding nothing', () => {
  test('an ordinary launch', () => {
    expect(deepLinkFromArgv(['AuthNo.exe'])).toBeNull();
    expect(deepLinkFromArgv(['/usr/bin/electron', '/home/me/authno/main.js'])).toBeNull();
  });

  test('a file-association launch', () => {
    expect(deepLinkFromArgv(['AuthNo.exe', '/home/me/Book.authbook'])).toBeNull();
  });

  /** A scheme that merely starts the same way is not ours. */
  test('a lookalike scheme', () => {
    expect(deepLinkFromArgv(['AuthNo.exe', 'authnotes://auth/google?google=x'])).toBeNull();
    expect(deepLinkFromArgv(['AuthNo.exe', 'https://authno.pages.dev/auth'])).toBeNull();
  });

  test('nothing at all', () => {
    expect(deepLinkFromArgv([])).toBeNull();
    expect(deepLinkFromArgv(null)).toBeNull();
    expect(deepLinkFromArgv(undefined)).toBeNull();
  });

  test('argv holding things that are not strings', () => {
    expect(() => deepLinkFromArgv([null, undefined, 42, {}, LINK])).not.toThrow();
    expect(deepLinkFromArgv([null, undefined, 42, {}, LINK])).toBe(LINK);
  });
});

describe('deciding whether a URL is ours', () => {
  test('ours', () => {
    expect(isAuthnoLink(LINK)).toBe(true);
    expect(isAuthnoLink('AUTHNO://anything')).toBe(true);
  });

  /**
   * macOS hands `open-url` whatever is registered to the scheme, which is not
   * the same as whatever we expect. A URL that is not even ours should not
   * reach the renderer, whatever the renderer would then do with it.
   */
  test('not ours', () => {
    expect(isAuthnoLink('https://example.com')).toBe(false);
    expect(isAuthnoLink('file:///etc/passwd')).toBe(false);
    expect(isAuthnoLink('')).toBe(false);
    expect(isAuthnoLink(null)).toBe(false);
    expect(isAuthnoLink(undefined)).toBe(false);
    expect(isAuthnoLink(42)).toBe(false);
  });

  test('the scheme is the one both other halves use', () => {
    // AndroidManifest.xml and the Worker's APP_RETURN both say `authno`.
    // Three places, one string, and nothing else checks they agree.
    expect(SCHEME).toBe('authno');
  });
});
