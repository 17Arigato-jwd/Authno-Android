/**
 * src/theme/index.js — Authno Theme System barrel
 * ─────────────────────────────────────────────────────────────────────────────
 * Import everything from one place:
 *
 *   import {
 *     ThemeProvider, useTheme, applyTheme, createTheme,
 *     buildAccentPalette, injectThemeFonts, buildWidgetTheme,
 *     resolveToolbarBg, resolveGlassCard, resolveBookCard, resolveActionTile,
 *     getBackgroundFxProps,
 *     DARK_DEFAULT, LIGHT_DEFAULT, DARK_OLED, SEPIA, PAPER,
 *     ALL_THEMES, themeById,
 *   } from './theme';
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── All imports must appear before any export statements (import/first rule) ──
import { DARK_DEFAULT }  from './ThemeDarkDefault';
import { LIGHT_DEFAULT } from './ThemeLightDefault';
import { DARK_OLED }     from './ThemeDarkOLED';
import { SEPIA }         from './ThemeSepia';
import { PAPER }         from './ThemePaper';
import { getAllThemes as _getAll } from './registry';

// ── Engine ────────────────────────────────────────────────────────────────────
export {
  createTheme,
  applyTheme,
  applyAccent,
  ThemeProvider,
  useTheme,
  buildAccentPalette,
  injectThemeFonts,
  buildWidgetTheme,
  resolveToolbarBg,
  resolveGlassCard,
  resolveBookCard,
  resolveActionTile,
  getBackgroundFxProps,
} from './ThemeBase';

// ── Presets ───────────────────────────────────────────────────────────────────
export { DARK_DEFAULT, LIGHT_DEFAULT, DARK_OLED, SEPIA, PAPER };

// ── Registry — built-ins + installed .thmbk themes (reactive) ─────────────────
// ALL_THEMES/themeById now come from the registry so downloadable themes show
// up in the picker and resolve at boot. subscribeThemes lets the picker live-
// update when a .thmbk is installed or removed.
export {
  BUILTIN_THEMES,
  getAllThemes,
  getInstalledThemes,
  setInstalledThemes,
  subscribeThemes,
  themeById,
} from './registry';

// Back-compat: some call sites import ALL_THEMES as a static array. Expose a
// getter-backed snapshot of the current set.
export const ALL_THEMES = new Proxy([], {
  get(_t, prop) { const arr = _getAll(); return typeof arr[prop] === 'function' ? arr[prop].bind(arr) : arr[prop]; },
});