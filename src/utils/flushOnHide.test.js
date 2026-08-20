/**
 * Typing is not lost to the home button.
 *
 * The editor debounces 400 ms into the sessions array, and everything that
 * flushed it early was something happening INSIDE the app — a blur, a chapter
 * change, an unmount. None of those fire when somebody backgrounds the app
 * mid-sentence, and on Android the WebView can be reclaimed after that without
 * another line of JS running.
 *
 * This tests the rule rather than App.js's tree, which cannot be mounted in
 * jsdom without the whole app: the listeners are registered, they fire the
 * flush, and they are removed on unmount. The shape is the same one App.js
 * uses, and `flushOnHide.js` is what App.js calls.
 */

import { renderHook } from '@testing-library/react';
import { useFlushOnHide } from './flushOnHide';

const hide = (state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

it('flushes when the page is hidden', () => {
  const flush = jest.fn();
  renderHook(() => useFlushOnHide(flush));
  hide('hidden');
  expect(flush).toHaveBeenCalledTimes(1);
});

it('does not flush when the page merely becomes visible again', () => {
  const flush = jest.fn();
  renderHook(() => useFlushOnHide(flush));
  hide('visible');
  expect(flush).not.toHaveBeenCalled();
});

it('flushes on pagehide, for a hard close', () => {
  const flush = jest.fn();
  renderHook(() => useFlushOnHide(flush));
  window.dispatchEvent(new Event('pagehide'));
  expect(flush).toHaveBeenCalledTimes(1);
});

it('stops listening when the editor goes away', () => {
  const flush = jest.fn();
  const { unmount } = renderHook(() => useFlushOnHide(flush));
  unmount();
  hide('hidden');
  window.dispatchEvent(new Event('pagehide'));
  expect(flush).not.toHaveBeenCalled();
});
