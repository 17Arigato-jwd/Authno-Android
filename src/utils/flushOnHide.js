/**
 * flushOnHide.js — write the last words down before the app goes away.
 *
 * Typing is debounced 400 ms into the sessions array. Everything that used to
 * flush that early was something happening INSIDE the app — a blur, a chapter
 * change, an unmount — and none of those fire when somebody presses home
 * mid-sentence. On Android the WebView can then be reclaimed without another
 * line of JS running, so the last word typed was simply gone.
 *
 * Four hundred milliseconds is a few characters, and a few characters is still
 * words. This is the app that promises being locked out never costs
 * manuscripts; losing a word to the home button is the same promise.
 *
 * In its own file so it can be tested. App.js cannot be mounted in jsdom
 * without standing up the entire application, which is how a rule this small
 * ends up with no test at all.
 */

import { useEffect } from 'react';

/**
 * @param {Function} flush  called when the app is going away
 */
export function useFlushOnHide(flush) {
  useEffect(() => {
    if (typeof flush !== 'function') return undefined;

    // `visibilitychange` is the one that matters. Android fires it on
    // background while the page is still alive, so the state update and the
    // write it triggers both have time to happen.
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    // `pagehide` is best effort for a hard close, where nothing can be
    // guaranteed — but a flush that usually lands beats one that never runs.
    const onPageHide = () => flush();

    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flush]);
}
