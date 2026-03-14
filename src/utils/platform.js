/**
 * platform.js — Runtime environment detection for AuthNo
 * Supports: Electron (Windows/Linux), Capacitor Android, and plain browser.
 */

/** True when running inside Electron with the preload bridge available. */
export const isElectron = () => Boolean(window.electron);

/** True when running inside a Capacitor Android WebView. */
export const isAndroid = () => {
  if (typeof window === 'undefined') return false;
  // Capacitor injects window.Capacitor at runtime
  if (window.Capacitor?.getPlatform() === 'android') return true;
  // Fallback: UA sniff (useful in dev with browser preview)
  return /Android/i.test(navigator.userAgent);
};

/** True on any touch-first mobile device. */
export const isMobile = () => isAndroid();

/** True on desktop (Electron). */
export const isDesktop = () => isElectron();
