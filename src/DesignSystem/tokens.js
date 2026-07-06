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
