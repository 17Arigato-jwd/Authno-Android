/**
 * registry.js — single source of truth for "what themes exist right now".
 *
 * Combines the five built-in presets with any installed .thmbk themes and
 * notifies subscribers (the Settings picker) when the installed set changes.
 * Kept separate from ThemeBase to avoid a circular import (themeLoader →
 * ThemeBase.createTheme, and the picker → registry).
 */

import { DARK_DEFAULT } from './ThemeDarkDefault';
import { LIGHT_DEFAULT } from './ThemeLightDefault';
import { DARK_OLED } from './ThemeDarkOLED';
import { SEPIA } from './ThemeSepia';
import { PAPER } from './ThemePaper';

export const BUILTIN_THEMES = [DARK_DEFAULT, LIGHT_DEFAULT, DARK_OLED, SEPIA, PAPER];

let _installed = [];
const _subs = new Set();

export function setInstalledThemes(themes) {
  _installed = Array.isArray(themes) ? themes : [];
  for (const fn of _subs) { try { fn(getAllThemes()); } catch (e) { console.error('[registry]', e); } }
}

export function getInstalledThemes() { return _installed.slice(); }

export function getAllThemes() {
  // Installed themes with an id colliding with a built-in override the built-in.
  const byId = new Map(BUILTIN_THEMES.map(t => [t.meta.id, t]));
  for (const t of _installed) byId.set(t.meta.id, t);
  return Array.from(byId.values());
}

export function subscribeThemes(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

export function themeById(id) {
  return getAllThemes().find(t => t.meta.id === id) ?? DARK_DEFAULT;
}
