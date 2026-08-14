/**
 * Which addresses an extension may put under the app's own chrome.
 *
 * The `url` page type drops a manifest-supplied address straight into an
 * iframe. That frame keeps `allow-same-origin`, which is right for a remote
 * page — the origin it keeps is the extension author's server, cross-origin to
 * the app either way — and wrong for anything local. Nothing checked, and on
 * desktop the app is itself a `file://` document: measured in Electron, an
 * extension naming `file:///…` got a frame that was same-origin with the app,
 * could read the file it named, and could read the app back.
 *
 * `allow-popups` is on that frame too, so whatever it found had somewhere to
 * go.
 */

import { isLoadablePageUrl } from './ExtensionPage';

describe('addresses an extension page may be loaded from', () => {
  test('https, which is the whole allowlist', () => {
    expect(isLoadablePageUrl('https://ext.example/page')).toBe(true);
    expect(isLoadablePageUrl('https://ext.example:8443/a/b?c=d#e')).toBe(true);
    // Scheme comparison is case-insensitive per the URL parser, and a manifest
    // is hand-written.
    expect(isLoadablePageUrl('HTTPS://ext.example/page')).toBe(true);
  });

  /** The measured escape. */
  test('not a local file, on any spelling', () => {
    expect(isLoadablePageUrl('file:///etc/passwd')).toBe(false);
    expect(isLoadablePageUrl('file://C:/Users/me/books/novel.authbook')).toBe(false);
    expect(isLoadablePageUrl('FILE:///etc/passwd')).toBe(false);
  });

  /** No address bar under it, so nothing can be seen to be insecure. */
  test('not cleartext', () => {
    expect(isLoadablePageUrl('http://ext.example/page')).toBe(false);
    expect(isLoadablePageUrl('http://localhost:3000/page')).toBe(false);
  });

  test('and not a scheme that runs something', () => {
    for (const u of [
      'javascript:alert(document.domain)',
      'data:text/html,<script>fetch("//evil")</script>',
      'blob:https://ext.example/abc',
      'authno://auth/google?google=handoff',
      'com.aurorastudios.authno://oauth2/gdrive',
    ]) {
      expect(isLoadablePageUrl(u)).toBe(false);
    }
  });

  /**
   * A manifest is JSON somebody else wrote. Anything that is not a URL at all
   * must read as "no" rather than throwing inside a render.
   */
  test('and not something that is not a URL', () => {
    for (const u of ['', '   ', 'ext.example/page', '//ext.example/page', null, undefined, 42, {}, []]) {
      expect(isLoadablePageUrl(u)).toBe(false);
    }
  });

  /**
   * The near-misses a prefix test would wave through. `new URL().protocol` is
   * exact, and this is what says so.
   */
  test('and not something that merely starts like https', () => {
    expect(isLoadablePageUrl('https:/ext.example')).toBe(true);   // parser repairs this one
    expect(isLoadablePageUrl('httpsx://ext.example/page')).toBe(false);
    expect(isLoadablePageUrl(' https://ext.example/page')).toBe(true); // leading space is trimmed
  });
});
