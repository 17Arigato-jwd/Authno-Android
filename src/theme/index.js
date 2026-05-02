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

// ── Engine ────────────────────────────────────────────────────────────────────
export {
  createTheme,
  applyTheme,
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
// Imported once at the top so they can be both re-exported and used in ALL_THEMES.
// (Avoids `import/first` lint errors caused by having imports after export-from lines.)
import { DARK_DEFAULT }  from './ThemeDarkDefault';
import { LIGHT_DEFAULT } from './ThemeLightDefault';
import { DARK_OLED }     from './ThemeDarkOLED';
import { SEPIA }         from './ThemeSepia';
import { PAPER }         from './ThemePaper';

export { DARK_DEFAULT, LIGHT_DEFAULT, DARK_OLED, SEPIA, PAPER };

// ── Registry — ordered list for the theme picker dropdown ─────────────────────

/**
 * ALL_THEMES — array of every built-in preset, in display order.
 * The AppearancePanel theme picker maps over this.
 */
export const ALL_THEMES = [
  DARK_DEFAULT,
  LIGHT_DEFAULT,
  DARK_OLED,
  SEPIA,
  PAPER,
];

/**
 * themeById(id) — look up a preset by its meta.id string.
 * Returns DARK_DEFAULT if no match (safe fallback).
 *
 * Usage:
 *   const saved = localStorage.getItem('authno_theme_id');
 *   applyTheme(themeById(saved));
 */
export function themeById(id) {
  return ALL_THEMES.find(t => t.meta.id === id) ?? DARK_DEFAULT;
}