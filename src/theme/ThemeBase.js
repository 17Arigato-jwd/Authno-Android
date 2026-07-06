/**
 * ThemeBase.js — Authno Theme Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure infrastructure. No colours live here.
 *
 * Exports
 *   createTheme(base, overrides)  — deep-merge helper
 *   applyTheme(theme)             — inject CSS vars + effects
 *   ThemeProvider                 — React context provider
 *   useTheme()                    — { theme, switchTheme }
 *   buildAccentPalette(hex)       — derive light/dark/alpha from one hex
 *   getBackgroundFxProps(theme)   — map theme.backgroundFx → <Background /> props
 *   resolveToolbarBg(theme, hex)  — derive EditorToolbar / BurgerMenu gradient
 *   resolveGlassCard(theme, hex)  — HomeScreen outer card style object
 *   resolveBookCard(theme, hex, hovered)
 *   resolveActionTile(theme, hex, hovered, comingSoon)
 *   injectThemeFonts(theme)       — load Google Fonts URL from theme
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { resolveFontStack, ensureFontsLoaded, injectCustomFontFaces } from '../utils/fontManager';

// ══════════════════════════════════════════════════════════════════════════════
// Colour math
// ══════════════════════════════════════════════════════════════════════════════

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r
    ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) }
    : { r: 0, g: 0, b: 0 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
function interpolateHex(hex1, hex2, t) {
  const a = hexToRgb(hex1), b = hexToRgb(hex2);
  return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}
function mixWithBlack(hex, pct) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * pct, g * pct, b * pct);
}

/**
 * buildAccentPalette(primaryHex)
 * Returns { primary, light, dark, base, alpha: { a08..a55 } }
 */
export function buildAccentPalette(primaryHex) {
  return {
    primary: primaryHex,
    light:   interpolateHex(primaryHex, '#ffffff', 0.35),
    dark:    mixWithBlack(primaryHex, 0.25),
    base:    mixWithBlack(primaryHex, 0.08),
    alpha: {
      a08: `${primaryHex}14`,
      a12: `${primaryHex}1e`,
      a18: `${primaryHex}2e`,
      a22: `${primaryHex}38`,
      a33: `${primaryHex}54`,
      a55: `${primaryHex}8c`,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Deep merge
// ══════════════════════════════════════════════════════════════════════════════

function deepMerge(base, override) {
  if (!override) return base;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const bv = base[key], ov = override[key];
    if (ov !== null && typeof ov === 'object' && !Array.isArray(ov)
        && bv !== null && typeof bv === 'object' && !Array.isArray(bv)) {
      result[key] = deepMerge(bv, ov);
    } else {
      result[key] = ov;
    }
  }
  return result;
}

/**
 * createTheme(base, overrides?)
 * Deep-merges overrides onto base. Both args are theme objects.
 * If called with one arg, returns it as-is.
 *
 * Usage:
 *   export const MY_THEME = createTheme(DARK_DEFAULT, {
 *     meta: { name: 'Midnight', id: 'midnight' },
 *     accent: { primary: '#3b82f6' },
 *   });
 */
export function createTheme(base, overrides = {}) {
  return deepMerge(base, overrides);
}

// ══════════════════════════════════════════════════════════════════════════════
// CSS injection
// ══════════════════════════════════════════════════════════════════════════════

const STYLE_ID   = 'authno-theme-vars';
const EFFECTS_ID = 'authno-theme-effects';

export function applyTheme(theme, selector = ':root') {
  const acc = buildAccentPalette(theme.accent.primary);

  const vars = `
    --app-bg:               ${theme.backgrounds.app};
    --sidebar-bg:           ${theme.backgrounds.sidebar};
    --editor-bg:            ${theme.backgrounds.editor};
    --modal-bg:             ${theme.backgrounds.modal};
    --nav-bg:               ${theme.backgrounds.nav};

    --text-1:               ${theme.text.t1};
    --text-2:               ${theme.text.t2};
    --text-3:               ${theme.text.t3};
    --text-4:               ${theme.text.t4};
    --text-5:               ${theme.text.t5};

    --border:               ${theme.borders.standard};
    --border-sm:            ${theme.borders.subtle};

    --surface:              ${theme.surfaces.low};
    --surface-md:           ${theme.surfaces.mid};

    --input-bg:             ${theme.inputs.background};
    --input-border:         ${theme.inputs.border};
    --input-focus:          ${theme.inputs.focusBorder ?? theme.accent.primary};
    --input-placeholder:    ${theme.inputs.placeholder};

    --accent:               ${acc.primary};
    --accent-light:         ${acc.light};
    --accent-dark:          ${acc.dark};
    --accent-base:          ${acc.base};
    --accent-a08:           ${acc.alpha.a08};
    --accent-a18:           ${acc.alpha.a18};
    --accent-a33:           ${acc.alpha.a33};
    --accent-a55:           ${acc.alpha.a55};

    --color-danger:         ${theme.statusColors.danger};
    --color-warning:        ${theme.statusColors.warning};
    --color-success:        ${theme.statusColors.success};
    --color-info:           ${theme.statusColors.info};
    --color-danger-bg:      ${theme.statusColors.dangerBg};
    --color-warning-bg:     ${theme.statusColors.warningBg};
    --color-success-bg:     ${theme.statusColors.successBg};
    --color-info-bg:        ${theme.statusColors.infoBg};

    --font-pixel:           ${theme.typography.pixelFont};
    --font-mono:            ${theme.typography.monoFont};
    --font-body:            ${theme.typography.bodyFont};
    --font-editor:          ${theme.typography.editorFont};
    --font-heading:         ${theme.typography.headingFont ?? theme.typography.bodyFont};

    --editor-font-size:     ${theme.editor.fontSize}px;
    --editor-line-height:   ${theme.editor.lineHeight};
    --editor-text:          ${theme.editor.textColor};
    --editor-caret:         ${theme.editor.caretColor ?? theme.accent.primary};
    --editor-selection-bg:  ${theme.editor.selectionBg};
    --editor-highlight:     ${theme.editor.highlightColor};

    --modal-overlay-bg:     ${theme.modals.overlayBg};
    --modal-overlay-blur:   ${theme.modals.overlayBlur};
    --modal-panel-border:   ${theme.modals.panelBorder};
    --modal-panel-shadow:   ${theme.modals.panelShadow};

    --toolbar-bg:           ${resolveToolbarBg(theme, theme.accent.primary)};
    --toolbar-stop:         ${theme.toolbar.darkStop ?? 'rgba(0,0,0,0.45)'};
    --toolbar-border:       ${theme.toolbar.border};
    --toolbar-divider:      ${theme.toolbar.dividerColor};
    --toolbar-item:         ${theme.toolbar.itemColor};
    --toolbar-item-hover:   ${theme.toolbar.itemHoverBg};

    --sidebar-card-bg:      ${theme.sidebar.sessionCardBg};
    --sidebar-card-border:  ${theme.sidebar.sessionCardBorder};
    --sidebar-active-border:${theme.sidebar.activeSessionBorder ?? theme.accent.primary};
    --sidebar-tab-bg:       ${theme.sidebar.bottomTabBg};
    --sidebar-tab-border:   ${theme.sidebar.bottomTabBorder};

    --streak-day-empty:     ${theme.streakCalendar.dayEmpty};
    --streak-day-met:       ${theme.streakCalendar.dayMet};
    --streak-day-missed:    ${theme.streakCalendar.dayMissed};
    --streak-day-today:     ${theme.streakCalendar.dayToday ?? theme.accent.primary};
    --streak-day-text:      ${theme.streakCalendar.dayText};

    --ds-surface0:          ${theme.backgrounds.app};
    --ds-surface1:          ${theme.backgrounds.nav};
    --ds-surface2:          ${theme.backgrounds.modal};
    --ds-surface3:          ${theme.backgrounds.customizer};
    --ds-surface4:          ${theme.backgrounds.customizerNav};
    --ds-text-primary:      ${theme.text.t1};
    --ds-text-secondary:    ${theme.text.t2};
    --ds-text-muted:        ${theme.text.t3};
    --ds-text-subtle:       ${theme.text.t4};
    --ds-text-disabled:     ${theme.text.t5};
    --ds-border:            ${theme.borders.standard};
    --ds-border-strong:     ${theme.borders.subtle};
    --ds-accent:            ${theme.accent.primary};
    --ds-danger:            ${theme.statusColors.danger};
    --ds-success:           ${theme.statusColors.success};
    --ds-warning:           ${theme.statusColors.warning};
    --ds-info:              ${theme.statusColors.info};

    --glass-bg:             ${theme.glass?.background ?? theme.backgrounds.modal};
    --glass-border:         ${theme.glass?.border ?? `1px solid ${theme.borders.standard}`};
    --glass-blur:           ${theme.glass?.backdropFilter ?? 'blur(18px)'};
    --scrim:                ${theme.meta.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.60)'};
    --scrim-strong:         ${theme.meta.isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)'};
  `.trim();

  let el = document.getElementById(STYLE_ID);
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
  el.textContent = `${selector} {\n${vars}\n}`;

  // Light-mode class. Toggle on <html> — it always exists, unlike `.app-root`,
  // which is absent during ThemeProvider's pre-render init. The old code fell
  // back to <body> at init and `.app-root` later, leaving stale classes behind
  // when themes changed (part of B2's split-brain light mode).
  document.documentElement.classList.toggle('light-mode', !theme.meta.isDark);
  const root = document.querySelector('.app-root');
  if (root) root.classList.toggle('light-mode', !theme.meta.isDark);

  // Themed body background — was hardcoded #060606 in index.css, so Paper and
  // Sepia showed a black glow on overscroll and behind transparent surfaces.
  document.body.style.background = theme.backgrounds.app;

  // CSS filter
  (root ?? document.body).style.filter = theme.effects?.cssFilter ?? '';

  // Effects overlay
  _applyEffects(theme.effects ?? {});

  // Re-assert the user's custom accent (if any) on top of the theme's default.
  _reapplyAccentOverride();
  // Re-assert the user's custom fonts (if any) on top of the theme's default.
  _reapplyFontOverride();
}

// ── Font override ─────────────────────────────────────────────────────────────
// The Font Customizer lets the user pick a font per target (body / editor /
// headings) and upload their own. Like the accent override, we write a second
// style tag that outranks the base theme's --font-* vars, and re-assert it after
// every theme switch so the choice survives.
let _fontOverride = null;
const FONT_STYLE_ID = 'authno-font-override';

export function applyFonts(fonts) {
  _fontOverride = fonts || null;
  _reapplyFontOverride();
}

function _reapplyFontOverride() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(FONT_STYLE_ID);
  const f = _fontOverride;
  if (!f) { el?.remove(); return; }
  const custom = f.custom || [];
  injectCustomFontFaces(custom);
  ensureFontsLoaded(f);
  const body    = resolveFontStack(f.body,    custom);
  const editor  = resolveFontStack(f.editor,  custom);
  const heading = resolveFontStack(f.heading, custom);
  if (!el) { el = document.createElement('style'); el.id = FONT_STYLE_ID; document.head.appendChild(el); }
  el.textContent = `:root {
    --font-body:    ${body};
    --font-editor:  ${editor};
    --font-heading: ${heading};
  }`;
}

// ── Accent override ───────────────────────────────────────────────────────────
// The customizer's accent colour previously updated component PROPS only —
// every component reading var(--accent) kept showing the theme's default
// violet, so accents looked inconsistent across the app. applyAccent() writes
// a second style tag that outranks the base theme vars.
let _accentOverrideHex = null;
const ACCENT_STYLE_ID = 'authno-accent-override';

export function applyAccent(hex) {
  _accentOverrideHex = hex || null;
  _reapplyAccentOverride();
}

function _reapplyAccentOverride() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(ACCENT_STYLE_ID);
  if (!_accentOverrideHex) { el?.remove(); return; }
  const acc = buildAccentPalette(_accentOverrideHex);
  if (!el) { el = document.createElement('style'); el.id = ACCENT_STYLE_ID; document.head.appendChild(el); }
  el.textContent = `:root {
    --accent:        ${acc.primary};
    --accent-light:  ${acc.light};
    --accent-dark:   ${acc.dark};
    --accent-base:   ${acc.base};
    --accent-a08:    ${acc.alpha.a08};
    --accent-a18:    ${acc.alpha.a18};
    --accent-a33:    ${acc.alpha.a33};
    --accent-a55:    ${acc.alpha.a55};
    --ds-accent:     ${acc.primary};
    --input-focus:   ${acc.primary};
    --sidebar-active-border: ${acc.primary};
    --editor-caret:  ${acc.primary};
    --streak-day-today: ${acc.primary};
  }`;
}

function _applyEffects(fx) {
  let el = document.getElementById(EFFECTS_ID);
  if (!el) { el = document.createElement('style'); el.id = EFFECTS_ID; document.head.appendChild(el); }
  const rules = [];
  if (fx.scanlines) rules.push(`.app-root::after{content:'';position:fixed;inset:0;z-index:9999;pointer-events:none;background:repeating-linear-gradient(to bottom,rgba(0,0,0,${fx.scanlinesOpacity ?? 0.04}) 0px,rgba(0,0,0,${fx.scanlinesOpacity ?? 0.04}) 1px,transparent 1px,transparent 2px);}`);
  if (fx.vignette)  rules.push(`.app-root::before{content:'';position:fixed;inset:0;z-index:9998;pointer-events:none;background:radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,${fx.vignetteOpacity ?? 0.4}) 100%);}`);
  if (fx.tintOverlay) {
    rules.push(`#authno-tint{position:fixed;inset:0;z-index:9997;pointer-events:none;background:${fx.tintOverlay};}`);
    if (!document.getElementById('authno-tint')) { const d = document.createElement('div'); d.id = 'authno-tint'; document.body.appendChild(d); }
  } else {
    document.getElementById('authno-tint')?.remove();
  }
  if (fx.pixelatedScrollbar) rules.push(`::-webkit-scrollbar{width:6px;height:6px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:var(--accent-a33);border-radius:0;}::-webkit-scrollbar-thumb:hover{background:var(--accent-a55);}`);
  el.textContent = rules.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
// React context
// ══════════════════════════════════════════════════════════════════════════════

const ThemeContext = createContext(null);

export function ThemeProvider({ initialTheme, children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof document !== 'undefined') applyTheme(initialTheme);
    return initialTheme;
  });

  const switchTheme = useCallback((next) => {
    applyTheme(next);
    setTheme(next);
    // N1: persist the choice. The boot path reads 'authno_theme_id', but nothing
    // ever wrote it, so every restart fell back to the dark default regardless
    // of what the user picked. Write it here, the single point of theme change.
    try { localStorage.setItem('authno_theme_id', next?.meta?.id ?? 'dark-default'); } catch { /* ignore */ }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, switchTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  // Fallback: if used outside provider, import DARK_DEFAULT lazily to avoid circular dep
  if (!ctx) {
    console.warn('[Authno] useTheme() called outside <ThemeProvider>. Returning no-op.');
    return { theme: null, switchTheme: () => {} };
  }
  return ctx;
}

// ══════════════════════════════════════════════════════════════════════════════
// Component helpers — consumed by DesignSystem.jsx components
// ══════════════════════════════════════════════════════════════════════════════

export function resolveToolbarBg(theme, accentHex) {
  if (theme.toolbar.background) return theme.toolbar.background;
  const alpha = theme.toolbar.accentAlpha ?? '66';
  const dark  = theme.toolbar.darkStop    ?? 'rgba(0,0,0,0.45)';
  return `linear-gradient(to bottom right, ${accentHex}${alpha}, ${dark})`;
}

export function resolveGlassCard(theme, accentHex) {
  const g = theme.glass;
  return {
    background:           g.background,
    backdropFilter:       g.backdropFilter,
    WebkitBackdropFilter: g.backdropFilter,
    border:               g.border,
    borderRadius:         g.borderRadius,
  };
}

export function resolveBookCard(theme, accentHex, hovered = false) {
  const g = theme.glass;
  return {
    display:              'flex', alignItems: 'center', gap: '12px', padding: '12px 14px',
    borderRadius:         16,
    background:           hovered ? (g.bookCardBgHover ?? `${accentHex}28`) : (g.bookCardBg ?? `${accentHex}18`),
    backdropFilter:       'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
    border:               `1px solid ${hovered ? (g.bookCardBorderHover ?? `${accentHex}55`) : (g.bookCardBorder ?? `${accentHex}28`)}`,
    cursor:               'pointer',
    transition:           'background 0.15s ease, border-color 0.15s ease',
  };
}

export function resolveActionTile(theme, accentHex, hovered = false, comingSoon = false) {
  const g = theme.glass;
  return {
    width: 72, height: 72, borderRadius: 18,
    background:           hovered && !comingSoon ? (g.tileBgHover ?? `${accentHex}22`) : g.tileBg,
    backdropFilter:       'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
    border:               `1.5px solid ${hovered && !comingSoon ? (g.tileBorderHover ?? `${accentHex}55`) : g.tileBorder}`,
    display:              'flex', alignItems: 'center', justifyContent: 'center',
    fontSize:             28,
    transition:           'all 0.15s ease',
  };
}

export function getBackgroundFxProps(theme) {
  const fx = theme.backgroundFx;
  return {
    type:                fx.type,           // 'gradient' | 'grain' | 'none'
    visible:             fx.enabled,
    baseColor:           fx.baseColor,
    colorRange:          { from: fx.colorFrom, to: fx.colorTo },
    minBlobs:            fx.minBlobs,
    maxBlobs:            fx.maxBlobs,
    blobSizeRange:       fx.blobSizeRange,
    blobSpeedMultiplier: fx.speedMultiplier,
    backgroundOpacity:   fx.opacity,
    grainOpacity:        fx.grainOpacity,
    grainSize:           fx.grainSize,
  };
}

export function injectThemeFonts(theme) {
  const url = theme?.typography?.googleFontsUrl;
  if (!url) return;
  const id = `authno-font-${btoa(url).slice(0, 16)}`;
  if (document.getElementById(id)) return;
  const link = Object.assign(document.createElement('link'), { id, rel: 'stylesheet', href: url });
  document.head.appendChild(link);
}

/**
 * buildWidgetTheme(theme) → plain object for widgetBridge.syncWidget()
 */
export function buildWidgetTheme(theme) {
  return {
    bgColor:       theme.backgrounds.modal,
    textPrimary:   theme.text.t1,
    textDim:       theme.text.t4,
    textFaint:     theme.text.t5,
    progressTrack: theme.surfaces.mid,
  };
}
