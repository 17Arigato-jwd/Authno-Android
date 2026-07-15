/**
 * materialYou.js — Android 12+ dynamic colour ("Material You") bridge.
 *
 * Thin face of MaterialYouPlugin. When the "Material You colour" setting is on,
 * App.js routes the system accent through ThemeBase.applyAccent so the whole
 * CSS-var system (accents, focus rings, streak colours…) follows the wallpaper.
 *
 * Off Android (or below Android 12) everything here degrades to "unsupported"
 * without touching the plugin proxy — registerPlugin() returns a web shim that
 * throws when called, which is exactly the ExtbkAssets error class we've fixed
 * before. Guard first, call second.
 */

import { registerPlugin } from '@capacitor/core';
import { isAndroid } from './platform';

const MaterialYou = registerPlugin('MaterialYou');

let _cache = null; // { supported, accent, ... } — palette only changes with the wallpaper

/**
 * Fetch the dynamic palette. Resolves { supported:false } off Android/pre-12.
 * @param {boolean} fresh  bypass the session cache (e.g. on app resume)
 */
export async function getMaterialYouColors(fresh = false) {
  if (!isAndroid()) return { supported: false };
  if (_cache && !fresh) return _cache;
  try {
    const res = await MaterialYou.getColors();
    _cache = res?.supported ? res : { supported: false };
  } catch {
    _cache = { supported: false };
  }
  return _cache;
}

/** Convenience: the headline accent hex, or null when unavailable. */
export async function getMaterialYouAccent(fresh = false) {
  const c = await getMaterialYouColors(fresh);
  return c.supported ? c.accent : null;
}
