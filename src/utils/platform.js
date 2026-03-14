/**
 * platform.js
 * Detects whether the app is running inside Electron or Capacitor Android.
 * Import these helpers anywhere — they never trigger re-renders.
 */

/** Running inside Electron (Windows / Linux desktop). */
export const isElectron = () => Boolean(window.electron);

/** Running inside a Capacitor Android WebView. */
export const isAndroid = () => {
  if (typeof window === "undefined") return false;
  if (window.Capacitor?.getPlatform() === "android") return true;
  return /Android/i.test(navigator.userAgent);
};
