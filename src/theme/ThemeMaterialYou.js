/**
 * ThemeMaterialYou.js — the dynamic "Material You" theme (Android).
 *
 * Not a static preset: built on demand from two live inputs —
 *   1. the DEVICE light/dark preference (prefers-color-scheme), which picks
 *      the Dark or Light default as the base, and
 *   2. the system wallpaper accent from MaterialYouPlugin (Android 12+),
 *      cached here by setMaterialYouAccent() so themeById() can stay sync.
 *
 * App.js owns the live wiring while this theme is active: it fetches the
 * accent (and refetches on app resume), listens for prefers-color-scheme
 * changes, and re-applies the rebuilt theme through switchTheme(). On
 * Android < 12 the accent fetch yields nothing and the theme gracefully
 * degrades to "follow device light/dark" with the default violet.
 *
 * This replaces the v1.1.18-beta.3 Appearance toggle, which fought the
 * user's custom accent override and visibly did nothing.
 */

import { createTheme } from './ThemeBase';
import { DARK_DEFAULT } from './ThemeDarkDefault';
import { LIGHT_DEFAULT } from './ThemeLightDefault';

export const MATERIAL_YOU_ID = 'material-you';

let _accent = null; // last known system accent hex — survives theme rebuilds

export function setMaterialYouAccent(hex) {
  _accent = hex || null;
}

export function getMaterialYouCachedAccent() {
  return _accent;
}

export function devicePrefersDark() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true;
  } catch {
    return true;
  }
}

/** Build the theme from the CURRENT device state (dark/light + cached accent). */
export function buildMaterialYouTheme() {
  const dark = devicePrefersDark();
  const base = dark ? DARK_DEFAULT : LIGHT_DEFAULT;
  const accent = _accent ?? base.accent.primary;
  return createTheme(base, {
    meta: {
      id: MATERIAL_YOU_ID,
      name: 'Material You',
      isDark: dark,
      description: "Follows your device — system light/dark and your wallpaper's colour (Android 12+).",
    },
    accent: { primary: accent, secondary: accent },
  });
}
