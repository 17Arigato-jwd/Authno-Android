/**
 * tokens.js — Authno Design Tokens
 * Single source of truth. Every component imports from here.
 * ─────────────────────────────────────────────────────────────────────────────
 * These are the *baseline* dark-theme values.
 * Active theme CSS vars (var(--app-bg), etc.) override these at runtime.
 */

// v1.1.16 fix: text/surface/border COLORS resolve to the --ds-* CSS variables
// that applyTheme() injects from the ACTIVE theme, not hardcoded dark hex.
// Previously every DesignSystem primitive (Buttons, Typography, Inputs, Toast…)
// read raw hex, so their text stayed white on light themes. 100+ references read
// these keys, so pointing them at the vars fixes theming everywhere at once.
// Each var has a dark fallback for pre-hydration / SSR.
export const COLORS = {
  // Brand — theme-independent accent hues (kept literal)
  violet:    '#8b5cf6',
  violetDark:'#5a00d9',
  indigo:    '#6366f1',
  sky:       '#38bdf8',
  // Semantic — active theme status colors
  success:   'var(--ds-success, #22c55e)',
  warning:   'var(--ds-warning, #f59e0b)',
  danger:    'var(--ds-danger, #ef4444)',
  info:      'var(--ds-info, #38bdf8)',
  rose:      '#ec4899',
  ember:     '#f97316',
  // Surfaces — follow the active theme
  surface0:  'var(--ds-surface0, #0b0b0c)',
  surface1:  'var(--ds-surface1, #111113)',
  surface2:  'var(--ds-surface2, #1a1b1e)',
  surface3:  'var(--ds-surface3, #2b2d31)',
  surface4:  'var(--ds-surface4, #313338)',
  // Text — follow the active theme (THIS is the white-on-light fix)
  textPrimary:   'var(--ds-text-primary, #ffffff)',
  textSecondary: 'var(--ds-text-secondary, #dcddde)',
  textMuted:     'var(--ds-text-muted, #b9bbbe)',
  textSubtle:    'var(--ds-text-subtle, #72767d)',
  textDisabled:  'var(--ds-text-disabled, #4f545c)',
  // Borders — follow the active theme
  border:       'var(--ds-border, rgba(255,255,255,0.08))',
  borderStrong: 'var(--ds-border-strong, rgba(255,255,255,0.16))',

  // Frosted panels — the translucent grounds that overlays float on.
  //
  // These were literal dark rgba() inside FrostedModal, BottomSheet and Toast,
  // which is how the text half of the v1.1.16 fix ended up painting themed —
  // and on light themes, dark — text on a panel that was still near-black. The
  // panel has to follow the theme for the same reason the text does.
  panel: 'var(--ds-panel, rgba(20,20,26,0.82))',
  sheet: 'var(--ds-sheet, rgba(22,22,28,0.96))',
  toast: 'var(--ds-toast, rgba(26,27,30,0.92))',

  // Tints — "a little lighter than the surface underneath". White on a dark
  // theme, black on a light one; the intent is contrast with the ground, and
  // white-over-cream has none.
  tintSubtle: 'var(--ds-tint-subtle, rgba(255,255,255,0.02))',
  tint:       'var(--ds-tint, rgba(255,255,255,0.06))',
  tintStrong: 'var(--ds-tint-strong, rgba(255,255,255,0.10))',
  tintHover:  'var(--ds-tint-hover, rgba(255,255,255,0.14))',
  hairline:   'var(--ds-hairline, rgba(255,255,255,0.05))',
  // A specular highlight stays white on both — it is a reflection, not a fill.
  sheen:      'var(--ds-sheen, rgba(255,255,255,0.10))',

  // Status tints, ready to use.
  //
  // `${COLORS.danger}1a` is not a colour once COLORS.danger is a var(), so the
  // badges and pills built that way painted nothing at all. Alpha is applied
  // in ThemeBase, where the value is still a hex, and arrives here finished.
  //   soft — a badge or pill ground   line — a border   fill — a solid button
  dangerSoft:  'var(--ds-danger-soft, rgba(237,66,69,0.15))',
  warningSoft: 'var(--ds-warning-soft, rgba(250,166,26,0.15))',
  successSoft: 'var(--ds-success-soft, rgba(34,197,94,0.15))',
  infoSoft:    'var(--ds-info-soft, rgba(56,189,248,0.15))',
  dangerLine:  'var(--ds-danger-line, rgba(237,66,69,0.33))',
  warningLine: 'var(--ds-warning-line, rgba(250,166,26,0.33))',
  successLine: 'var(--ds-success-line, rgba(34,197,94,0.33))',
  infoLine:    'var(--ds-info-line, rgba(56,189,248,0.33))',
  dangerFill:  'var(--ds-danger-fill, rgba(237,66,69,0.8))',
  successFill: 'var(--ds-success-fill, rgba(34,197,94,0.8))',

  // What can be read ON those fills.
  //
  // `onAccent()` has existed since v1.1.16 and its own comment names the two
  // presets a hardcoded white label fails on — Gold and Sage, both near 2:1.
  // Nothing but the CSS variable ever called it, so every button primitive in
  // here went on painting '#fff' regardless. These are that answer, per fill.
  // For a hex you hold at render time, call onAccent(hex) from ./_utils
  // instead — a variable cannot be computed from a prop.
  onAccent:  'var(--ds-on-accent, #ffffff)',
  onDanger:  'var(--ds-on-danger, #ffffff)',
  onWarning: 'var(--ds-on-warning, #111113)',
  onSuccess: 'var(--ds-on-success, #111113)',
  onInfo:    'var(--ds-on-info, #111113)',
};

export const GRADIENTS = {
  // Brand
  violet:     'linear-gradient(135deg, #8b5cf6, #5a00d9)',
  violetSoft: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
  ocean:      'linear-gradient(135deg, #6366f1, #38bdf8)',
  aurora:     'linear-gradient(135deg, #8b5cf6, #38bdf8, #22c55e)',
  // UI accents
  rose:    'linear-gradient(135deg, #f43f5e, #ec4899)',
  ember:   'linear-gradient(135deg, #f97316, #ef4444)',
  sage:    'linear-gradient(135deg, #22c55e, #16a34a)',
  gold:    'linear-gradient(135deg, #f59e0b, #d97706)',
  sky:     'linear-gradient(135deg, #38bdf8, #6366f1)',
  candy:   'linear-gradient(135deg, #ec4899, #8b5cf6, #38bdf8)',
  // Sliders (left → right, fill direction)
  sliderViolet: 'linear-gradient(to right, #8b5cf6, #5a00d9)',
  sliderOcean:  'linear-gradient(to right, #6366f1, #38bdf8)',
  sliderAurora: 'linear-gradient(to right, #8b5cf6, #38bdf8, #22c55e)',
  sliderEmber:  'linear-gradient(to right, #f97316, #ef4444)',
  sliderCandy:  'linear-gradient(to right, #ec4899, #8b5cf6, #38bdf8)',
};

export const TYPOGRAPHY = {
  // Font families
  pixel: "'Silkscreen', 'Courier New', monospace",
  mono:  "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
  sans:  "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
  // Scale (px)
  size: { xs: 9, sm: 11, base: 13, md: 15, lg: 18, xl: 22, xxl: 28, hero: 36 },
  // Pixel font scale — Silkscreen is more readable so slightly larger
  pixelSize: { xs: 8, sm: 10, base: 12, md: 14, lg: 18 },
  // Weight
  weight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  // Letter spacing
  tracking: { tight: '-0.02em', normal: 0, wide: '0.06em', wider: '0.12em', pixel: '0.05em' },
};

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

export const RADIUS = { none: 0, sm: 6, md: 10, lg: 14, xl: 20, full: 9999 };

export const SHADOWS = {
  violet:  '0 0 24px rgba(139,92,246,0.4)',
  indiglo: '0 0 20px rgba(99,102,241,0.35)',
  sky:     '0 0 20px rgba(56,189,248,0.35)',
  danger:  '0 0 20px rgba(239,68,68,0.45)',
  success: '0 0 20px rgba(34,197,94,0.35)',
  glow:    (hex) => `0 0 24px ${hex}55`,
  panel:   '0 32px 80px rgba(0,0,0,0.6)',
  card:    '0 8px 32px rgba(0,0,0,0.4)',
};
