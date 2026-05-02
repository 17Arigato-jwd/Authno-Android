/**
 * DesignSystem.jsx — Authno Design System
 * ─────────────────────────────────────────────────────────────────────────────
 * Single file, single import. Every reusable UI primitive lives here.
 *
 * Usage:
 *   import {
 *     COLORS, GRADIENTS, TYPOGRAPHY, SHADOWS,
 *     PixelButton, GradientButton, GhostButton, DangerButton,
 *     FrostedCard, FrostedModal,
 *     PillSlider, DualPillSlider, Toggle,
 *     Chip, Badge, ProBadge,
 *     PixelInput, TextInput,
 *     PixelText, Heading, Body, Caption, MonoText,
 *     Divider, Spacer, Row,
 *   } from './DesignSystem';
 *
 * All components accept an optional `accentHex` prop that falls back
 * to COLORS.violet — the global brand accent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · DESIGN TOKENS
//
// COLORS / TYPOGRAPHY / SHADOWS — universal constants (shape, not colour).
// Surface/text/border entries in COLORS map to --ds-* CSS variables injected
// by the active theme file so the theme controls all appearance at runtime.
// Import from src/theme/index.js to switch themes; DesignSystem.jsx is stable.
// ══════════════════════════════════════════════════════════════════════════════

export const COLORS = {
  // Brand
  violet:   '#8b5cf6',
  violetDark:'#5a00d9',
  indigo:   '#6366f1',
  sky:      '#38bdf8',
  // Semantic
  success:  '#22c55e',
  warning:  '#f59e0b',
  danger:   '#ef4444',
  info:     '#38bdf8',
  rose:     '#ec4899',
  ember:    '#f97316',
  // Neutral surfaces (dark-first)
  surface0: '#0b0b0c',
  surface1: '#111113',
  surface2: '#1a1b1e',
  surface3: '#2b2d31',
  surface4: '#313338',
  // Text
  textPrimary:   '#ffffff',
  textSecondary: '#dcddde',
  textMuted:     '#b9bbbe',
  textSubtle:    '#72767d',
  textDisabled:  '#4f545c',
  // Borders
  border:        'rgba(255,255,255,0.08)',
  borderStrong:  'rgba(255,255,255,0.16)',
};

export const GRADIENTS = {
  // Brand
  violet:  'linear-gradient(135deg, #8b5cf6, #5a00d9)',
  violetSoft: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
  ocean:   'linear-gradient(135deg, #6366f1, #38bdf8)',
  aurora:  'linear-gradient(135deg, #8b5cf6, #38bdf8, #22c55e)',
  // UI accents
  rose:    'linear-gradient(135deg, #f43f5e, #ec4899)',
  ember:   'linear-gradient(135deg, #f97316, #ef4444)',
  sage:    'linear-gradient(135deg, #22c55e, #16a34a)',
  gold:    'linear-gradient(135deg, #f59e0b, #d97706)',
  sky:     'linear-gradient(135deg, #38bdf8, #6366f1)',
  candy:   'linear-gradient(135deg, #ec4899, #8b5cf6, #38bdf8)',
  // Sliders  (left → right, fill direction)
  sliderViolet: 'linear-gradient(to right, #8b5cf6, #5a00d9)',
  sliderOcean:  'linear-gradient(to right, #6366f1, #38bdf8)',
  sliderAurora: 'linear-gradient(to right, #8b5cf6, #38bdf8, #22c55e)',
  sliderEmber:  'linear-gradient(to right, #f97316, #ef4444)',
  sliderCandy:  'linear-gradient(to right, #ec4899, #8b5cf6, #38bdf8)',
};

export const TYPOGRAPHY = {
  // Font families
  // Silkscreen — clean retro pixel font, legible at all sizes (replaces Press Start 2P)
  pixel: "'Silkscreen', 'Courier New', monospace",
  mono:  "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
  sans:  "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
  // Scale (px)
  size: { xs: 9, sm: 11, base: 13, md: 15, lg: 18, xl: 22, xxl: 28, hero: 36 },
  // Pixel font scale — Silkscreen is more readable so we can go slightly larger
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

// ── Google Fonts loader (call once in your App entry) ──────────────────────
export function injectDesignSystemFonts() {
  if (document.getElementById('ds-fonts')) return;
  const link = document.createElement('link');
  link.id = 'ds-fonts';
  link.rel = 'stylesheet';
  // Silkscreen: clean retro pixel font · JetBrains Mono: UI mono
  link.href =
    'https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=JetBrains+Mono:wght@400;600;700&display=swap';
  document.head.appendChild(link);
}

// ── Global slider CSS (injected once) ─────────────────────────────────────
let _sliderStyleInjected = false;
function ensureSliderCSS() {
  if (_sliderStyleInjected) return;
  _sliderStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Pill Slider — webkit */
    .ds-pill-slider { -webkit-appearance: none; appearance: none; outline: none; cursor: pointer; background: transparent; }
    .ds-pill-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 32px; height: 32px; border-radius: 50%;
      background: radial-gradient(circle at 38% 38%, #ffffff, #e0e0e8);
      box-shadow: 0 3px 10px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,255,255,0.22), 0 0 16px rgba(139,92,246,0.35);
      cursor: pointer;
      transition: transform 0.14s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.14s;
    }
    .ds-pill-slider::-webkit-slider-thumb:hover {
      transform: scale(1.18);
      box-shadow: 0 5px 18px rgba(0,0,0,0.55), 0 0 0 4px rgba(255,255,255,0.28), 0 0 22px rgba(139,92,246,0.5);
    }
    .ds-pill-slider::-webkit-slider-thumb:active {
      transform: scale(0.93);
      box-shadow: 0 2px 8px rgba(0,0,0,0.6), 0 0 0 2px rgba(255,255,255,0.18);
    }
    .ds-pill-slider::-moz-range-thumb {
      width: 32px; height: 32px; border-radius: 50%;
      background: #fff; border: none; cursor: pointer;
      box-shadow: 0 3px 10px rgba(0,0,0,0.55);
    }
    /* Dual pill sliders */
    .ds-dual-slider { -webkit-appearance: none; appearance: none; outline: none; cursor: pointer; background: transparent; pointer-events: none; position: absolute; inset: 0; width: 100%; height: 100%; }
    .ds-dual-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 32px; height: 32px; border-radius: 50%;
      background: radial-gradient(circle at 38% 38%, #ffffff, #e0e0e8);
      box-shadow: 0 3px 10px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,255,255,0.22), 0 0 16px rgba(139,92,246,0.35);
      pointer-events: all; cursor: grab;
      transition: transform 0.14s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.14s;
    }
    .ds-dual-slider::-webkit-slider-thumb:hover {
      transform: scale(1.18);
      box-shadow: 0 5px 18px rgba(0,0,0,0.55), 0 0 0 4px rgba(255,255,255,0.28), 0 0 22px rgba(139,92,246,0.5);
    }
    .ds-dual-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(0.93); }
    .ds-dual-slider::-moz-range-thumb {
      width: 32px; height: 32px; border-radius: 50%;
      background: #fff; border: none; pointer-events: all; cursor: grab;
    }
  `;
  document.head.appendChild(style);
}

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · PIXEL BUTTON  (retro GBA-style chamfered corners)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Builds the stepped-corner clip-path used by all PixelButton variants.
 * `c` = corner cut size in px.
 */
function pixelClip(c = 12) {
  const h = c, q = c * 0.67, e = c * 0.33;
  // Approximated as 4-step staircase per corner
  return `polygon(
    0px ${h}px,
    ${e}px ${h}px, ${e}px ${q}px,
    ${q}px ${q}px, ${q}px ${e}px,
    ${h}px ${e}px, ${h}px 0px,
    calc(100% - ${h}px) 0px,
    calc(100% - ${h}px) ${e}px,
    calc(100% - ${q}px) ${e}px,
    calc(100% - ${q}px) ${q}px,
    calc(100% - ${e}px) ${q}px,
    calc(100% - ${e}px) ${h}px,
    100% ${h}px, 100% calc(100% - ${h}px),
    calc(100% - ${e}px) calc(100% - ${h}px),
    calc(100% - ${e}px) calc(100% - ${q}px),
    calc(100% - ${q}px) calc(100% - ${q}px),
    calc(100% - ${q}px) calc(100% - ${e}px),
    calc(100% - ${h}px) calc(100% - ${e}px),
    calc(100% - ${h}px) 100%,
    ${h}px 100%,
    ${h}px calc(100% - ${e}px),
    ${q}px calc(100% - ${e}px),
    ${q}px calc(100% - ${q}px),
    ${e}px calc(100% - ${q}px),
    ${e}px calc(100% - ${h}px),
    0px calc(100% - ${h}px)
  )`;
}

const PIXEL_SIZES = {
  xs: { fontSize: 8,  padding: '6px 12px',  gap: 5, corner: 6,  iconSize: 10 },
  sm: { fontSize: 9,  padding: '8px 14px',  gap: 6, corner: 8,  iconSize: 12 },
  md: { fontSize: 12, padding: '14px 24px', gap: 8, corner: 12, iconSize: 14 },
  lg: { fontSize: 16, padding: '18px 32px', gap: 10, corner: 14, iconSize: 18 },
};

const PIXEL_VARIANTS = {
  primary: (accent) => ({
    border:  accent ?? COLORS.violet,
    fill:    `${accent ?? COLORS.violet}cc`,
    color:   '#fff',
    shadow:  SHADOWS.glow(accent ?? COLORS.violet),
  }),
  gradient: (accent) => ({
    border:  'transparent',
    fill:    null, // signals gradient fill
    gradient: GRADIENTS.violet,
    color:   '#fff',
    shadow:  SHADOWS.violet,
  }),
  secondary: () => ({
    border:  COLORS.indigo,
    fill:    `${COLORS.indigo}22`,
    color:   COLORS.indigo,
    shadow:  'none',
  }),
  ghost: (accent) => ({
    border:  `${accent ?? COLORS.rose}66`,
    fill:    'transparent',
    color:   accent ?? COLORS.rose,
    shadow:  'none',
  }),
  danger: () => ({
    border:  COLORS.danger,
    fill:    `${COLORS.danger}cc`,
    color:   '#fff',
    shadow:  SHADOWS.danger,
  }),
  success: () => ({
    border:  COLORS.success,
    fill:    `${COLORS.success}cc`,
    color:   '#fff',
    shadow:  SHADOWS.success,
  }),
  info: () => ({
    border:  COLORS.sky,
    fill:    `${COLORS.sky}cc`,
    color:   '#fff',
    shadow:  SHADOWS.sky,
  }),
};

/**
 * PixelButton — retro GBA-style button with chamfered corners.
 *
 * Props:
 *   variant   'primary' | 'gradient' | 'secondary' | 'ghost' | 'danger' | 'success' | 'info'
 *   size      'xs' | 'sm' | 'md' | 'lg'
 *   icon      ReactNode  (rendered before children)
 *   accentHex string     overrides brand accent
 *   disabled  bool
 *   gradient  string     custom CSS gradient (only when variant='gradient')
 *   onClick   fn
 *   style     object
 *
 * Example:
 *   <PixelButton variant="primary" size="lg" icon={<StarIcon />}>
 *     Apply for Public Beta
 *   </PixelButton>
 */
export function PixelButton({
  variant = 'primary',
  size = 'md',
  icon,
  accentHex,
  disabled = false,
  gradient: customGradient,
  onClick,
  style = {},
  children,
}) {
  const sz = PIXEL_SIZES[size] ?? PIXEL_SIZES.md;
  const variantFn = PIXEL_VARIANTS[variant] ?? PIXEL_VARIANTS.primary;
  const v = variantFn(accentHex);
  const clip = pixelClip(sz.corner);
  const borderW = Math.max(2, Math.floor(sz.corner / 4));

  const gradientBg = customGradient ?? v.gradient ?? null;
  const outerBg = v.border === 'transparent' ? (gradientBg ?? v.fill) : v.border;

  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none',
        background: 'transparent',
        padding: 0,
        fontFamily: TYPOGRAPHY.pixel,
        textTransform: 'uppercase',
        letterSpacing: TYPOGRAPHY.tracking.pixel,
        lineHeight: 1,
        opacity: disabled ? 0.45 : 1,
        transition: 'transform 80ms ease, filter 150ms ease',
        filter: `drop-shadow(${v.shadow === 'none' ? '0 0 0 transparent' : v.shadow})`,
        ...style,
      }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.filter = `brightness(1.14) drop-shadow(${v.shadow === 'none' ? '0 0 0 transparent' : v.shadow})`)}
      onMouseLeave={e => !disabled && (e.currentTarget.style.filter = `drop-shadow(${v.shadow === 'none' ? '0 0 0 transparent' : v.shadow})`)}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.96) translateY(1px)')}
      onMouseUp={e => !disabled && (e.currentTarget.style.transform = 'scale(1) translateY(0)')}
    >
      {/* Outer border shell */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        clipPath: clip,
        padding: `${borderW}px`,
        background: outerBg,
      }}>
        {/* Inner face */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: `${sz.gap}px`,
          fontSize: `${sz.fontSize}px`,
          padding: sz.padding,
          clipPath: clip,
          background: gradientBg && v.fill === null
            ? `${gradientBg}`
            : (v.fill || 'transparent'),
          color: v.color,
          transition: 'filter 150ms ease',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}>
          {icon && (
            <span style={{ display: 'inline-flex', alignItems: 'center', width: sz.iconSize, height: sz.iconSize }}>
              {icon}
            </span>
          )}
          {children}
        </div>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · GRADIENT BUTTON  (smooth, rounded — Discord-style)
// ══════════════════════════════════════════════════════════════════════════════

const GRADIENT_BTN_VARIANTS = {
  primary:   { bg: GRADIENTS.violet,  shadow: SHADOWS.violet,  color: '#fff' },
  ocean:     { bg: GRADIENTS.ocean,   shadow: SHADOWS.indiglo, color: '#fff' },
  rose:      { bg: GRADIENTS.rose,    shadow: '0 0 20px rgba(236,72,153,0.4)', color: '#fff' },
  ember:     { bg: GRADIENTS.ember,   shadow: SHADOWS.danger,  color: '#fff' },
  sage:      { bg: GRADIENTS.sage,    shadow: SHADOWS.success, color: '#fff' },
  aurora:    { bg: GRADIENTS.aurora,  shadow: SHADOWS.violet,  color: '#fff' },
  secondary: { bg: 'rgba(139,92,246,0.14)', shadow: 'none', color: COLORS.violet, border: `1px solid rgba(139,92,246,0.3)` },
  ghost:     { bg: 'transparent', shadow: 'none', color: 'var(--ds-text-muted, #b9bbbe)', border: `1px solid ${'var(--ds-border, rgba(255,255,255,0.08))'}` },
  danger:    { bg: COLORS.danger, shadow: SHADOWS.danger, color: '#fff' },
};

const GRADIENT_BTN_SIZES = {
  sm:  { padding: '6px 14px',  fontSize: 12, radius: 10, iconSize: 13 },
  md:  { padding: '9px 18px',  fontSize: 14, radius: 14, iconSize: 14 },
  lg:  { padding: '13px 24px', fontSize: 16, radius: 16, iconSize: 16 },
};

/**
 * GradientButton — smooth rounded button, great for CTAs and modals.
 *
 * Props:
 *   variant   'primary' | 'ocean' | 'rose' | 'ember' | 'sage' | 'aurora' | 'secondary' | 'ghost' | 'danger'
 *   size      'sm' | 'md' | 'lg'
 *   icon      ReactNode
 *   disabled  bool
 */
export function GradientButton({
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  onClick,
  style = {},
  children,
}) {
  const v = GRADIENT_BTN_VARIANTS[variant] ?? GRADIENT_BTN_VARIANTS.primary;
  const sz = GRADIENT_BTN_SIZES[size] ?? GRADIENT_BTN_SIZES.md;

  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        padding: sz.padding,
        fontSize: sz.fontSize,
        fontFamily: TYPOGRAPHY.mono,
        fontWeight: TYPOGRAPHY.weight.bold,
        letterSpacing: TYPOGRAPHY.tracking.wide,
        borderRadius: sz.radius,
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: v.border ?? 'none',
        background: v.bg,
        color: v.color,
        boxShadow: v.shadow !== 'none' ? v.shadow : 'none',
        opacity: disabled ? 0.45 : 1,
        transition: 'transform 80ms ease, filter 150ms ease, box-shadow 150ms ease',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.filter = 'brightness(1.1)')}
      onMouseLeave={e => !disabled && (e.currentTarget.style.filter = 'brightness(1)')}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.97)')}
      onMouseUp={e => !disabled && (e.currentTarget.style.transform = 'scale(1)')}
    >
      {icon && (
        <span style={{ display: 'inline-flex', alignItems: 'center', width: sz.iconSize, height: sz.iconSize }}>
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}

// Convenience aliases
export const GhostButton  = (props) => <GradientButton variant="ghost"  {...props} />;
export const DangerButton = (props) => <GradientButton variant="danger" {...props} />;

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · FROSTED GLASS  (prompts, modals, cards)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * FrostedCard — inline frosted glass panel.
 *
 * Props:
 *   accentHex   string   optional accent tint on border
 *   blur        number   blur strength in px  (default 18)
 *   padding     string   CSS padding           (default '24px')
 *   radius      number   border-radius px      (default 20)
 *   style       object
 */
export function FrostedCard({ accentHex, blur = 18, padding = '24px', radius = 20, style = {}, children }) {
  return (
    <div style={{
      backdropFilter: `blur(${blur}px) saturate(1.4)`,
      WebkitBackdropFilter: `blur(${blur}px) saturate(1.4)`,
      background: 'var(--surface, rgba(255,255,255,0.06))',
      border: `1px solid ${accentHex ? `${accentHex}33` : 'var(--ds-border, rgba(255,255,255,0.08))'}`,
      borderRadius: radius,
      padding,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1), ${SHADOWS.card}`,
      ...style,
    }}>
      {children}
    </div>
  );
}

/**
 * FrostedModal — full-screen overlay with a frosted glass panel.
 *
 * Props:
 *   isOpen      bool
 *   onClose     fn        called when backdrop is clicked or Escape pressed
 *   title       string    optional header text
 *   accentHex   string
 *   maxWidth    string    (default '480px')
 *   noPad       bool      removes inner padding for custom layouts
 */
export function FrostedModal({ isOpen, onClose, title, accentHex, maxWidth = '480px', noPad = false, style = {}, children }) {
  const accent = accentHex ?? COLORS.violet;

  useEffect(() => {
    if (!isOpen) return;
    const fn = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        animation: 'dsFadeIn 0.15s ease',
      }}
    >
      <style>{`@keyframes dsFadeIn{from{opacity:0}to{opacity:1}} @keyframes dsPanelIn{from{opacity:0;transform:scale(0.96) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
      <div style={{
        width: '90vw',
        maxWidth,
        backdropFilter: 'blur(24px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
        background: 'rgba(20,20,26,0.82)',
        border: `1px solid ${accent}33`,
        borderRadius: 24,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.05) inset, ${SHADOWS.panel}, ${SHADOWS.glow(accent)}`,
        animation: 'dsPanelIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        overflow: 'hidden',
        ...style,
      }}>
        {/* Accent gradient stripe at top */}
        <div style={{
          height: 3,
          background: `linear-gradient(to right, transparent, ${accent}, transparent)`,
        }} />

        {/* Header */}
        {title && (
          <div style={{
            padding: '18px 24px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{
              fontFamily: TYPOGRAPHY.pixel,
              fontSize: TYPOGRAPHY.pixelSize.base,
              color: accent,
              letterSpacing: TYPOGRAPHY.tracking.pixel,
            }}>
              {title}
            </span>
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(255,255,255,0.07)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--ds-text-muted, #b9bbbe)', fontSize: 18,
                lineHeight: 1, transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'var(--ds-text-muted, #b9bbbe)'; }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        )}

        {/* Body */}
        <div style={noPad ? {} : { padding: title ? '20px 24px 28px' : '28px 24px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · SLIDERS  (pill-shaped, gradient-filled — image reference)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PillSlider — single-thumb pill-shaped slider.
 *
 * Visual: tall capsule track with a gradient fill and a glassy thumb.
 *
 * Props:
 *   min, max, step   number
 *   value            number
 *   onChange         fn(number)
 *   gradient         string   CSS gradient for filled portion  (default violet)
 *   accentHex        string   fallback accent for thumb ring
 *   height           number   track height in px               (default 36)
 *   showValue        bool     shows current value label above
 *   formatValue      fn(v)    custom label formatter
 */
export function PillSlider({
  min = 0, max = 100, step = 1,
  value,
  onChange,
  gradient,
  accentHex,
  height = 36,
  showValue = false,
  formatValue,
  style = {},
}) {
  ensureSliderCSS();
  const accent = accentHex ?? COLORS.violet;
  const fillGradient = gradient ?? GRADIENTS.sliderViolet;
  const pct = ((value - min) / (max - min)) * 100;
  const trackBg = `linear-gradient(to right, transparent 0%, transparent ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`;

  return (
    <div style={{ width: '100%', ...style }}>
      {showValue && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          marginBottom: 6,
          fontFamily: TYPOGRAPHY.mono,
          fontSize: TYPOGRAPHY.size.sm,
          color: 'var(--ds-text-muted, #b9bbbe)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {formatValue ? formatValue(value) : value}
        </div>
      )}
      {/* Outer pill shell — does NOT clip (allows thumb to sit inside naturally) */}
      <div style={{
        position: 'relative',
        height,
        borderRadius: height / 2,
        background: 'var(--surface, rgba(255,255,255,0.06))',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: `inset 0 2px 6px rgba(0,0,0,0.4), ${SHADOWS.glow(accent)}`,
      }}>
        {/* Inner clip layer — only clips the fill bar and sheen, NOT the thumb */}
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: height / 2,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}>
          {/* Gradient fill bar — pill shape both ends */}
          <div style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0,
            width: `${pct}%`,
            background: fillGradient,
            borderRadius: height / 2,
            transition: 'width 0.05s',
            minWidth: height,
          }} />
          {/* Frosted sheen overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.1) 0%, transparent 55%)',
          }} />
        </div>
        {/* Native range input — sits above clip layer, thumb renders inside pill */}
        <input
          type="range"
          className="ds-pill-slider"
          min={min} max={max} step={step}
          value={value}
          onChange={e => onChange?.(Number(e.target.value))}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            margin: 0, zIndex: 2,
          }}
        />
      </div>
    </div>
  );
}

/**
 * DualPillSlider — two-thumb range selector inside a pill track.
 *
 * Props:
 *   min, max, step      number
 *   valueMin, valueMax  number
 *   onChangeMin         fn(number)
 *   onChangeMax         fn(number)
 *   gradient            string  CSS gradient for selected range
 *   accentHex           string
 *   height              number  (default 36)
 */
export function DualPillSlider({
  min = 0, max = 100, step = 1,
  valueMin, valueMax,
  onChangeMin, onChangeMax,
  gradient,
  accentHex,
  height = 36,
  style = {},
}) {
  ensureSliderCSS();
  const accent = accentHex ?? COLORS.violet;
  const fillGradient = gradient ?? GRADIENTS.sliderViolet;
  const pMin = ((valueMin - min) / (max - min)) * 100;
  const pMax = ((valueMax - min) / (max - min)) * 100;

  const trackBg = `linear-gradient(to right,
    rgba(255,255,255,0.06) 0%,
    rgba(255,255,255,0.06) ${pMin}%,
    transparent ${pMin}%,
    transparent ${pMax}%,
    rgba(255,255,255,0.06) ${pMax}%,
    rgba(255,255,255,0.06) 100%)`;

  return (
    <div style={{ width: '100%', ...style }}>
      {/* Outer pill shell — no overflow clip so thumbs stay inside the pill */}
      <div style={{
        position: 'relative',
        height,
        borderRadius: height / 2,
        background: 'var(--surface, rgba(255,255,255,0.06))',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: `inset 0 2px 6px rgba(0,0,0,0.4), ${SHADOWS.glow(accent)}`,
      }}>
        {/* Inner clip layer — fill + sheen only, not the thumbs */}
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: height / 2,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}>
          {/* Range gradient fill — pill-shaped both ends */}
          <div style={{
            position: 'absolute',
            top: 0, bottom: 0,
            left: `${pMin}%`,
            width: `${pMax - pMin}%`,
            background: fillGradient,
            borderRadius: height / 2,
            transition: 'left 0.04s, width 0.04s',
          }} />
          {/* Frosted sheen */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.1) 0%, transparent 55%)',
          }} />
        </div>
        {/* Min thumb input */}
        <input
          type="range"
          className="ds-dual-slider"
          min={min} max={max} step={step}
          value={valueMin}
          onChange={e => {
            const v = Math.min(Number(e.target.value), valueMax - step);
            onChangeMin?.(v);
          }}
          style={{ height }}
        />
        {/* Max thumb input */}
        <input
          type="range"
          className="ds-dual-slider"
          min={min} max={max} step={step}
          value={valueMax}
          onChange={e => {
            const v = Math.max(Number(e.target.value), valueMin + step);
            onChangeMax?.(v);
          }}
          style={{ height }}
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 6 · TOGGLE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Toggle — animated on/off switch.
 *
 * Props:
 *   on          bool
 *   onChange    fn(bool)
 *   accentHex   string   colour when on
 *   size        'sm' | 'md' | 'lg'
 *   disabled    bool
 *   label       string   shown to the right
 */
export function Toggle({ on = false, onChange, accentHex, size = 'md', disabled = false, label, style = {} }) {
  const accent = accentHex ?? COLORS.violet;
  const sizes = {
    sm: { track: [36, 20], thumb: 14, travel: 16 },
    md: { track: [46, 26], thumb: 18, travel: 20 },
    lg: { track: [56, 32], thumb: 24, travel: 24 },
  };
  const s = sizes[size] ?? sizes.md;

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, ...style }}>
      <div
        onClick={() => !disabled && onChange?.(!on)}
        style={{
          width: s.track[0], height: s.track[1],
          borderRadius: s.track[1] / 2,
          padding: (s.track[1] - s.thumb) / 2,
          background: on ? `linear-gradient(135deg, ${accent}, ${accent}cc)` : 'var(--ds-surface4, #313338)',
          boxShadow: on ? `0 0 12px ${accent}66` : 'inset 0 2px 4px rgba(0,0,0,0.4)',
          transition: 'background 220ms cubic-bezier(0.4,0,0.2,1), box-shadow 220ms',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{
          width: s.thumb, height: s.thumb, borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          transform: on ? `translateX(${s.travel}px)` : 'translateX(0)',
          transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>
      {label && (
        <span style={{ fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.base, color: 'var(--ds-text-secondary, #dcddde)' }}>
          {label}
        </span>
      )}
    </label>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 7 · CHIP · BADGE · PRO BADGE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Chip — inline tag/filter pill.
 * Props: variant 'default'|'active'|'success'|'warning', icon, accentHex
 */
export function Chip({ variant = 'default', icon, accentHex, children, onClick, style = {} }) {
  const accent = accentHex ?? COLORS.violet;
  const variants = {
    default: { bg: 'rgba(255,255,255,0.06)', border: 'var(--ds-border, rgba(255,255,255,0.08))', color: 'var(--ds-text-muted, #b9bbbe)' },
    active:  { bg: `${accent}22`, border: `${accent}55`, color: accent },
    success: { bg: `${COLORS.success}1a`, border: `${COLORS.success}55`, color: COLORS.success },
    warning: { bg: `${COLORS.warning}1a`, border: `${COLORS.warning}55`, color: COLORS.warning },
    danger:  { bg: `${COLORS.danger}1a`, border: `${COLORS.danger}55`, color: COLORS.danger },
  };
  const v = variants[variant] ?? variants.default;

  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: RADIUS.full,
        background: v.bg, border: `1px solid ${v.border}`, color: v.color,
        fontSize: TYPOGRAPHY.pixelSize.xs,
        fontFamily: TYPOGRAPHY.pixel,
        letterSpacing: TYPOGRAPHY.tracking.pixel,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'filter 0.15s', userSelect: 'none',
        lineHeight: 1.8,
        ...style,
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.filter = 'brightness(1.15)')}
      onMouseLeave={e => onClick && (e.currentTarget.style.filter = 'brightness(1)')}
    >
      {icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </span>
  );
}

/**
 * Badge — compact uppercase label.
 * Props: variant 'pro'|'beta'|'new'|'danger'|'success'
 */
export function Badge({ variant = 'pro', icon, accentHex, children, style = {} }) {
  const accent = accentHex ?? COLORS.violet;
  const variants = {
    pro:     { bg: `${accent}22`,            color: accent },
    beta:    { bg: `${COLORS.sky}1a`,        color: COLORS.sky },
    new:     { bg: `${COLORS.success}1a`,    color: COLORS.success },
    danger:  { bg: `${COLORS.danger}1a`,     color: COLORS.danger },
    success: { bg: `${COLORS.success}22`,    color: COLORS.success },
    warning: { bg: `${COLORS.warning}1a`,    color: COLORS.warning },
  };
  const v = variants[variant] ?? variants.pro;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 9px', borderRadius: RADIUS.full,
      background: v.bg, color: v.color,
      fontSize: TYPOGRAPHY.pixelSize.xs,
      fontFamily: TYPOGRAPHY.pixel,
      letterSpacing: TYPOGRAPHY.tracking.pixel,
      lineHeight: 1.8,
      userSelect: 'none',
      ...style,
    }}>
      {icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </span>
  );
}

/** Convenience: ★ Pro badge */
export function ProBadge({ accentHex, style = {} }) {
  return (
    <Badge variant="pro" accentHex={accentHex} style={style}
      icon={<svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>}
    >Pro</Badge>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 8 · INPUTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PixelInput — pixel-bordered text input.
 *
 * Props: value, onChange, placeholder, accentHex, size 'sm'|'md'|'lg', disabled, icon, label
 */
export function PixelInput({
  value, onChange, placeholder = '', accentHex,
  size = 'md', disabled = false, icon, label, style = {},
  ...rest
}) {
  const [focused, setFocused] = useState(false);
  const accent = accentHex ?? COLORS.violet;
  const sz = { sm: { font: 8, pad: '8px 12px', corner: 8 }, md: { font: 9, pad: '11px 14px', corner: 10 }, lg: { font: 10, pad: '13px 18px', corner: 12 } }[size] ?? { font: 9, pad: '11px 14px', corner: 10 };
  const clip = pixelClip(sz.corner);

  return (
    <div style={{ width: '100%', ...style }}>
      {label && (
        <div style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: 8, color: 'var(--ds-text-subtle, #72767d)', letterSpacing: TYPOGRAPHY.tracking.pixel, marginBottom: 8, textTransform: 'uppercase' }}>
          {label}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center',
        clipPath: clip,
        background: focused ? `${accent}44` : 'var(--ds-surface3, #2b2d31)',
        padding: 2,
        transition: 'background 0.15s',
      }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--ds-surface2, #1a1b1e)', clipPath: clip,
          padding: sz.pad,
        }}>
          {icon && <span style={{ color: focused ? accent : 'var(--ds-text-disabled, #4f545c)', display: 'flex', transition: 'color 0.15s' }}>{icon}</span>}
          <input
            value={value}
            onChange={e => onChange?.(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: TYPOGRAPHY.pixel, fontSize: sz.font,
              color: 'var(--ds-text-primary, #ffffff)', letterSpacing: TYPOGRAPHY.tracking.pixel,
              cursor: disabled ? 'not-allowed' : 'text',
              opacity: disabled ? 0.5 : 1,
              '::placeholder': { color: 'var(--ds-text-disabled, #4f545c)' },
            }}
            {...rest}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * TextInput — smooth rounded text input.
 *
 * Props: value, onChange, placeholder, accentHex, icon, label, hint, error, type, disabled
 */
export function TextInput({ value, onChange, placeholder = '', accentHex, icon, label, hint, error, type = 'text', disabled = false, style = {}, ...rest }) {
  const [focused, setFocused] = useState(false);
  const accent = accentHex ?? COLORS.violet;

  return (
    <div style={{ width: '100%', ...style }}>
      {label && (
        <div style={{ fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.semibold, color: 'var(--ds-text-muted, #b9bbbe)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          {label}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        background: 'var(--ds-surface3, #2b2d31)',
        borderRadius: RADIUS.md,
        border: `1px solid ${focused ? `${accent}88` : error ? COLORS.danger : 'var(--ds-border, rgba(255,255,255,0.08))'}`,
        boxShadow: focused ? `0 0 0 3px ${accent}22` : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}>
        {icon && <span style={{ color: focused ? accent : 'var(--ds-text-disabled, #4f545c)', display: 'flex', transition: 'color 0.15s' }}>{icon}</span>}
        <input
          type={type}
          value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.base,
            color: 'var(--ds-text-primary, #ffffff)', cursor: disabled ? 'not-allowed' : 'text',
            opacity: disabled ? 0.5 : 1,
          }}
          {...rest}
        />
      </div>
      {(hint || error) && (
        <div style={{ marginTop: 5, fontSize: TYPOGRAPHY.size.sm, color: error ? COLORS.danger : 'var(--ds-text-subtle, #72767d)' }}>
          {error ?? hint}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 9 · TYPOGRAPHY COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PixelText — Press Start 2P retro text. Use for logos, headings, labels.
 *
 * Props: size 'xs'|'sm'|'base'|'md'|'lg', color, gradient (CSS gradient string), style
 */
export function PixelText({ size = 'base', color, gradient, style = {}, children }) {
  const fs = TYPOGRAPHY.pixelSize[size] ?? TYPOGRAPHY.pixelSize.base;
  return (
    <span style={{
      fontFamily: TYPOGRAPHY.pixel,
      fontSize: fs,
      letterSpacing: TYPOGRAPHY.tracking.pixel,
      color: gradient ? 'transparent' : (color ?? COLORS.violet),
      background: gradient ?? undefined,
      WebkitBackgroundClip: gradient ? 'text' : undefined,
      backgroundClip: gradient ? 'text' : undefined,
      lineHeight: 1.6,
      ...style,
    }}>
      {children}
    </span>
  );
}

/** Heading — large display text (mono, bold) */
export function Heading({ level = 1, color, gradient, style = {}, children }) {
  const sizes = [36, 28, 22, 18, 15, 13];
  const fs = sizes[level - 1] ?? 22;
  return (
    <div style={{
      fontFamily: TYPOGRAPHY.mono,
      fontSize: fs,
      fontWeight: TYPOGRAPHY.weight.bold,
      color: gradient ? 'transparent' : (color ?? 'var(--ds-text-primary, #ffffff)'),
      background: gradient ?? undefined,
      WebkitBackgroundClip: gradient ? 'text' : undefined,
      backgroundClip: gradient ? 'text' : undefined,
      letterSpacing: TYPOGRAPHY.tracking.tight,
      lineHeight: 1.25,
      ...style,
    }}>
      {children}
    </div>
  );
}

/** Body — standard paragraph text */
export function Body({ size = 'base', color, muted = false, style = {}, children }) {
  return (
    <p style={{
      fontFamily: TYPOGRAPHY.sans,
      fontSize: TYPOGRAPHY.size[size] ?? TYPOGRAPHY.size.base,
      color: color ?? (muted ? 'var(--ds-text-subtle, #72767d)' : 'var(--ds-text-secondary, #dcddde)'),
      lineHeight: 1.6,
      margin: 0,
      ...style,
    }}>
      {children}
    </p>
  );
}

/** Caption — small label text */
export function Caption({ color, uppercase = false, style = {}, children }) {
  return (
    <span style={{
      fontFamily: TYPOGRAPHY.sans,
      fontSize: TYPOGRAPHY.size.sm,
      fontWeight: TYPOGRAPHY.weight.medium,
      color: color ?? 'var(--ds-text-subtle, #72767d)',
      letterSpacing: uppercase ? '0.6px' : 0,
      textTransform: uppercase ? 'uppercase' : undefined,
      ...style,
    }}>
      {children}
    </span>
  );
}

/** MonoText — JetBrains Mono, for code, values, IDs */
export function MonoText({ size = 'base', color, style = {}, children }) {
  return (
    <code style={{
      fontFamily: TYPOGRAPHY.mono,
      fontSize: TYPOGRAPHY.size[size] ?? TYPOGRAPHY.size.base,
      color: color ?? 'var(--ds-text-muted, #b9bbbe)',
      background: 'var(--ds-surface3, #2b2d31)',
      padding: '2px 6px',
      borderRadius: RADIUS.sm,
      letterSpacing: '-0.01em',
      ...style,
    }}>
      {children}
    </code>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 10 · LAYOUT PRIMITIVES
// ══════════════════════════════════════════════════════════════════════════════

/** Divider — horizontal separator */
export function Divider({ accent = false, accentHex, style = {} }) {
  return (
    <div style={{
      height: 1,
      background: accent
        ? `linear-gradient(to right, transparent, ${accentHex ?? COLORS.violet}66, transparent)`
        : 'var(--ds-border, rgba(255,255,255,0.08))',
      margin: `${SPACING.xl}px 0`,
      ...style,
    }} />
  );
}

/** Spacer — vertical gap */
export function Spacer({ size = 'md' }) {
  return <div style={{ height: SPACING[size] ?? SPACING.md }} />;
}

/** Row — horizontal flex row */
export function Row({ align = 'center', gap = 'md', wrap = false, style = {}, children }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: align,
      gap: SPACING[gap] ?? SPACING.md,
      flexWrap: wrap ? 'wrap' : 'nowrap',
      ...style,
    }}>
      {children}
    </div>
  );
}

/** SectionLabel — small uppercase label with border below */
export function SectionLabel({ style = {}, children }) {
  return (
    <div style={{
      fontFamily: TYPOGRAPHY.pixel,
      fontSize: TYPOGRAPHY.pixelSize.xs,
      letterSpacing: TYPOGRAPHY.tracking.pixel,
      textTransform: 'uppercase',
      color: 'var(--ds-text-disabled, #4f545c)',
      paddingBottom: 10,
      marginBottom: 14,
      borderBottom: `1px solid ${'var(--ds-border, rgba(255,255,255,0.08))'}`,
      lineHeight: 2,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 11 · COLOR SWATCH GRID  (for settings / customizer UIs)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ColorSwatchRow — horizontal row of tappable color swatches.
 *
 * Props:
 *   colors     array of { label, value } or strings (hex)
 *   selected   string (hex)
 *   onChange   fn(hex)
 *   size       number  swatch diameter in px  (default 28)
 */
export function ColorSwatchRow({ colors = [], selected, onChange, size = 28, style = {} }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', ...style }}>
      {colors.map((c) => {
        const hex = typeof c === 'string' ? c : c.value;
        const label = typeof c === 'string' ? '' : c.label;
        const isSelected = selected === hex;
        return (
          <button
            key={hex}
            title={label}
            onClick={() => onChange?.(hex)}
            style={{
              width: size, height: size, borderRadius: '50%',
              background: hex, border: 'none', cursor: 'pointer',
              boxShadow: isSelected ? `0 0 0 2px #fff, 0 0 0 4px ${hex}` : `0 2px 6px rgba(0,0,0,0.4)`,
              transform: isSelected ? 'scale(1.15)' : 'scale(1)',
              transition: 'transform 0.15s, box-shadow 0.15s',
              flexShrink: 0,
            }}
          />
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 12 · GRADIENT LABEL  (animated gradient text helper)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GradientText — inline text with animated gradient fill.
 *
 * Props: gradient string, animate bool, children
 */
export function GradientText({ gradient = GRADIENTS.violet, animate = false, style = {}, children }) {
  return (
    <>
      {animate && (
        <style>{`@keyframes dsGradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}`}</style>
      )}
      <span style={{
        background: animate ? `${gradient}, ${gradient}` : gradient,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        backgroundSize: animate ? '200% 200%' : undefined,
        animation: animate ? 'dsGradientShift 3s ease infinite' : undefined,
        fontWeight: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        ...style,
      }}>
        {children}
      </span>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 13 · PIXEL ICONS  — @hackernoon/pixel-icon-library
//
// Install:  npm install @hackernoon/pixel-icon-library
// Import once in App entry:
//   import '@hackernoon/pixel-icon-library/fonts/iconfont.css'
//
// Docs / icon browser:  https://pixeliconlibrary.com
// Library:              github.com/hackernoon/pixel-icon-library
// Licence:              CC BY 4.0 (attribution required — see §24 ATTRIBUTION)
//
// The library uses an icon font, so each icon is:
//   <i className="hn hn-{name}" />
//
// DSIcon wraps this into a consistent size/color API matching the rest of
// the design system.  Every DSIcons.Xxx component honours `size` and `color`.
//
// ⚠️  PREVIEW HTML NOTE:
//   The preview .html file loads icons via CDN:
//   <link href="https://unpkg.com/@hackernoon/pixel-icon-library/fonts/iconfont.css" rel="stylesheet">
//   This works in the browser. The React project uses the npm package instead.
//
// Usage:
//   import { DSIcons } from './DesignSystem';
//   <DSIcons.Home size={20} color={COLORS.violet} />
//   <DSIcons.Trash size={16} color={COLORS.danger} />
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Base icon component — wraps an <i className="hn hn-{name}"> with size/color.
 * `name` must match a valid hn-* class from the library.
 */
function HNIcon({ name, size = 16, color = 'currentColor', style = {} }) {
  return (
    <i
      className={`hn hn-${name}`}
      style={{
        fontSize: size,
        color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        ...style,
      }}
    />
  );
}

// ── Shorthand factory ──────────────────────────────────────────────────────
const icon = (name) => ({ size, color, style }) =>
  <HNIcon name={name} size={size} color={color} style={style} />;

export const DSIcons = {
  // Navigation
  Home:          icon('home'),
  ChevronRight:  icon('chevron-right'),
  ChevronLeft:   icon('chevron-left'),
  ChevronUp:     icon('chevron-up'),
  ChevronDown:   icon('chevron-down'),
  Menu:          icon('bars'),
  More:          icon('ellipsis-h'),
  MoreVertical:  icon('ellipsis-v'),
  // Content & files
  Book:          icon('book'),
  BookOpen:      icon('book-open'),
  File:          icon('file'),
  FilePlus:      icon('file-plus'),
  FileText:      icon('file-alt'),
  Folder:        icon('folder'),
  FolderOpen:    icon('folder-open'),
  Archive:       icon('archive'),
  Save:          icon('save'),
  // Actions
  Check:         icon('check'),
  X:             icon('times'),
  Plus:          icon('plus'),
  Minus:         icon('minus'),
  Search:        icon('search'),
  Edit:          icon('pen'),
  Eraser:        icon('eraser'),
  Trash:         icon('trash'),
  Copy:          icon('copy'),
  Link:          icon('link'),
  Upload:        icon('upload'),
  Download:      icon('download'),
  Refresh:       icon('redo'),
  // Status
  Info:          icon('info-circle'),
  Warning:       icon('exclamation-triangle'),
  CheckCircle:   icon('check-circle'),
  XCircle:       icon('times-circle'),
  WarningCircle: icon('exclamation-circle'),
  Bell:          icon('bell'),
  BellRinging:   icon('bell-solid'),
  // Security
  Lock:          icon('lock'),
  Unlock:        icon('lock-open'),
  Shield:        icon('shield-alt'),
  Key:           icon('key'),
  // Visual / settings
  Eye:           icon('eye'),
  EyeOff:        icon('eye-slash'),
  Palette:       icon('palette'),
  Text:          icon('font'),
  Sliders:       icon('sliders-h'),
  // Social / app
  Discord:       icon('discord'),
  Chat:          icon('comments'),
  Star:          icon('star'),
  StarFill:      icon('star-solid'),
  Rocket:        icon('rocket'),
  Sparkle:       icon('magic'),
  Lightning:     icon('bolt'),
  // System
  Settings:      icon('cog'),
  Extension:     icon('puzzle-piece'),
  Code:          icon('code'),
  Terminal:      icon('terminal'),
  Bug:           icon('bug'),
  Tag:           icon('tag'),
  Bookmark:      icon('bookmark'),
  Clock:         icon('clock'),
  Calendar:      icon('calendar'),
  User:          icon('user'),
  UserCircle:    icon('user-circle'),
  Infinity:      icon('infinity'),
  List:          icon('list'),
  Package:       icon('box'),
  Npm:           icon('npm'),
  Github:        icon('github'),
  Figma:         icon('figma'),
  Heart:         icon('heart'),
};

// ══════════════════════════════════════════════════════════════════════════════
// § 14 · MINIMAL BUTTON
//
// A borderline-ghost button: no fill, just Icon + Text inside a thin outline
// rectangle (either chamfered-pixel or smooth-rounded). Color is always the
// same value for border, icon, and text.  On dark surfaces use color="#fff";
// on light surfaces use color="#111".
// ══════════════════════════════════════════════════════════════════════════════

/**
 * MinimalButton — outline-only, no background fill.
 *
 * Props:
 *   variant   'pixel' | 'smooth'   shape style
 *   size      'xs' | 'sm' | 'md' | 'lg'
 *   color     string  CSS color for border + text + icon  (default '#fff')
 *   icon      ReactNode
 *   disabled  bool
 *   onClick   fn
 *   style     object
 *
 * Examples:
 *   <MinimalButton icon={<DSIcons.Discord size={13} />}>Discord</MinimalButton>
 *   <MinimalButton variant="smooth" color="#8b5cf6">View Log</MinimalButton>
 *   <MinimalButton variant="pixel" color="#ef4444" size="sm">Clear</MinimalButton>
 */
export function MinimalButton({
  variant = 'smooth',
  size = 'md',
  color = '#ffffff',
  icon,
  disabled = false,
  onClick,
  style = {},
  children,
}) {
  const [hovered, setHovered] = useState(false);

  // ── Smooth variant ────────────────────────────────────────────────────────
  if (variant === 'smooth') {
    const sz = {
      xs: { padding: '5px 11px',  fontSize: 11, radius: 8,  iconSize: 11, gap: 5 },
      sm: { padding: '7px 13px',  fontSize: 12, radius: 10, iconSize: 12, gap: 6 },
      md: { padding: '9px 17px',  fontSize: 13, radius: 13, iconSize: 14, gap: 7 },
      lg: { padding: '12px 22px', fontSize: 15, radius: 15, iconSize: 16, gap: 8 },
    }[size] ?? { padding: '9px 17px', fontSize: 13, radius: 13, iconSize: 14, gap: 7 };

    return (
      <button
        onClick={disabled ? undefined : onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: sz.gap,
          padding: sz.padding,
          fontSize: sz.fontSize,
          fontFamily: TYPOGRAPHY.mono,
          fontWeight: TYPOGRAPHY.weight.bold,
          letterSpacing: TYPOGRAPHY.tracking.wide,
          borderRadius: sz.radius,
          border: `1.5px solid ${color}`,
          background: hovered ? `${color}14` : 'transparent',
          color,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          transition: 'background 0.15s, transform 80ms ease',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          transform: hovered ? 'scale(1.02)' : 'scale(1)',
          ...style,
        }}
      >
        {icon && (
          <span style={{ display: 'inline-flex', alignItems: 'center', width: sz.iconSize, height: sz.iconSize }}>
            {icon}
          </span>
        )}
        {children}
      </button>
    );
  }

  // ── Pixel variant (chamfered corners) ─────────────────────────────────────
  const px = {
    xs: { fontSize: 7,  padding: '6px 12px',  gap: 5, corner: 6,  iconSize: 10, border: 1.5 },
    sm: { fontSize: 8,  padding: '8px 14px',  gap: 6, corner: 8,  iconSize: 11, border: 1.5 },
    md: { fontSize: 9,  padding: '12px 20px', gap: 8, corner: 12, iconSize: 13, border: 2   },
    lg: { fontSize: 11, padding: '16px 26px', gap: 9, corner: 14, iconSize: 15, border: 2   },
  }[size] ?? { fontSize: 9, padding: '12px 20px', gap: 8, corner: 12, iconSize: 13, border: 2 };

  const clip = pixelClip(px.corner);

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none',
        background: 'transparent',
        padding: 0,
        fontFamily: TYPOGRAPHY.pixel,
        textTransform: 'uppercase',
        letterSpacing: TYPOGRAPHY.tracking.pixel,
        lineHeight: 1,
        opacity: disabled ? 0.4 : 1,
        transition: 'transform 80ms ease, filter 150ms ease',
        filter: hovered ? 'brightness(1.2)' : 'brightness(1)',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        ...style,
      }}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.96) translateY(1px)')}
      onMouseUp={e => !disabled && (e.currentTarget.style.transform = hovered ? 'scale(1.02)' : 'scale(1)')}
    >
      {/* Outer border shell — color fill, clipped */}
      <div style={{ display: 'inline-flex', alignItems: 'stretch', clipPath: clip, padding: px.border, background: color }}>
        {/* Inner face — transparent, same clip */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: px.gap,
          fontSize: px.fontSize,
          padding: px.padding,
          clipPath: clip,
          background: hovered ? `${color}18` : 'var(--ds-surface0, #0b0b0c)',
          color,
          transition: 'background 0.15s',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}>
          {icon && (
            <span style={{ display: 'inline-flex', alignItems: 'center', width: px.iconSize, height: px.iconSize }}>
              {icon}
            </span>
          )}
          {children}
        </div>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 15 · OPTION SELECTOR  (radio-style circle used in SettingCard)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * OptionSelector — circular radio indicator.
 * Unselected: dim outline ring.  Selected: solid accent fill + checkmark.
 *
 * Props:
 *   selected    bool
 *   onChange    fn(bool)
 *   accentHex   string
 *   size        number  diameter px  (default 28)
 */
export function OptionSelector({ selected = false, onChange, accentHex, size = 28, style = {} }) {
  const accent = accentHex ?? COLORS.violet;
  return (
    <button
      onClick={() => onChange?.(!selected)}
      style={{
        width: size, height: size, borderRadius: '50%',
        flexShrink: 0,
        border: selected ? 'none' : `2px solid ${'var(--ds-surface4, #313338)'}`,
        background: selected
          ? `linear-gradient(135deg, ${accent}, ${accent}cc)`
          : 'transparent',
        boxShadow: selected ? `0 0 10px ${accent}55` : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.18s cubic-bezier(0.34,1.56,0.64,1)',
        transform: selected ? 'scale(1.05)' : 'scale(1)',
        ...style,
      }}
    >
      {selected && (
        <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none"
          stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 16 · SETTING CARD
//
// The universal settings row:  [IconBox]  [Title + Description]  [Control]
//
// "Control" on the right can be:
//   • controlType="option"  → OptionSelector (radio circle)  — use for mutually exclusive choices
//   • controlType="toggle"  → Toggle switch
//   • controlType="button"  → MinimalButton (pass buttonLabel + buttonVariant + onButtonClick)
//   • controlType="custom"  → render `control` prop as-is
//
// Selected state (controlType="option", selected=true) adds an accent border
// and a subtle tinted background — matching the screenshot highlight.
//
// Props:
//   icon            ReactNode   icon rendered inside the icon box
//   iconBg          string      icon box background  (default surface3)
//   iconColor       string      icon color           (default violet)
//   title           string
//   description     string
//   accentHex       string
//   danger          bool        uses danger red accent
//   warning         bool        uses warning amber accent
//
//   controlType     'option' | 'toggle' | 'button' | 'custom'
//
//   — option props —
//   selected        bool
//   onSelect        fn()
//
//   — toggle props —
//   toggleOn        bool
//   onToggleChange  fn(bool)
//
//   — button props —
//   buttonLabel     string
//   buttonVariant   'smooth' | 'pixel'       passed to MinimalButton
//   onButtonClick   fn()
//
//   — custom props —
//   control         ReactNode   rendered verbatim on the right
//
//   onClick         fn()        makes the whole card tappable (optional)
//   style           object
//
// Usage:
//   <SettingCard
//     icon={<DSIcons.BookOpen />}  iconBg="rgba(139,92,246,0.25)"
//     title="Show home screen"
//     description="Browse and choose a book on launch"
//     controlType="option"  selected={startup === 'home'}  onSelect={() => setStartup('home')}
//   />
//
//   <SettingCard
//     icon={<DSIcons.Refresh />}  iconBg="rgba(245,158,11,0.2)"  iconColor={COLORS.warning}
//     title="Restore previously open books"
//     description="Re-open all books that were open last session"
//     controlType="toggle"  toggleOn={restoreBooks}  onToggleChange={setRestoreBooks}
//   />
//
//   <SettingCard
//     icon={<DSIcons.Trash />}  danger
//     title="Clear All Sessions"
//     description="Removes all writing sessions from local storage"
//     controlType="button"  buttonLabel="Clear"  onButtonClick={handleClear}
//   />
// ══════════════════════════════════════════════════════════════════════════════

export function SettingCard({
  // icon box
  icon,
  iconBg,
  iconColor,
  // text
  title,
  description,
  // theming
  accentHex,
  danger = false,
  warning = false,
  // control
  controlType = 'option',
  // option
  selected = false,
  onSelect,
  // toggle
  toggleOn = false,
  onToggleChange,
  // button
  buttonLabel,
  buttonVariant = 'smooth',
  onButtonClick,
  // custom slot
  control,
  // card
  onClick,
  style = {},
}) {
  // Resolve accent
  const accent = danger  ? COLORS.danger
               : warning ? COLORS.warning
               : (accentHex ?? COLORS.violet);

  // Selected option cards get a tinted border + background
  const isOptionSelected = controlType === 'option' && selected;

  // Default icon box colors
  const resolvedIconBg    = iconBg    ?? `${accent}28`;
  const resolvedIconColor = iconColor ?? accent;

  // ── Right control ──────────────────────────────────────────────────────────
  let rightControl = null;

  if (controlType === 'option') {
    rightControl = (
      <OptionSelector
        selected={selected}
        onChange={() => onSelect?.()}
        accentHex={accent}
        size={26}
      />
    );
  } else if (controlType === 'toggle') {
    rightControl = (
      <Toggle
        on={toggleOn}
        onChange={onToggleChange}
        accentHex={accent}
        size="md"
      />
    );
  } else if (controlType === 'button') {
    rightControl = (
      <MinimalButton
        variant={buttonVariant}
        color={accent}
        size="sm"
        onClick={e => { e.stopPropagation(); onButtonClick?.(); }}
      >
        {buttonLabel}
      </MinimalButton>
    );
  } else if (controlType === 'custom') {
    rightControl = control;
  }

  return (
    <div
      onClick={onClick ?? (controlType === 'option' ? onSelect : undefined)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 18px',
        borderRadius: RADIUS.lg,
        background: isOptionSelected ? `${accent}0f` : 'var(--ds-surface2, #1a1b1e)',
        border: `1px solid ${isOptionSelected ? `${accent}55` : 'var(--ds-border, rgba(255,255,255,0.08))'}`,
        boxShadow: isOptionSelected ? `0 0 16px ${accent}18` : 'none',
        cursor: onClick || controlType === 'option' ? 'pointer' : 'default',
        transition: 'background 0.18s, border-color 0.18s, box-shadow 0.18s',
        userSelect: 'none',
        ...style,
      }}
      onMouseEnter={e => {
        if (!isOptionSelected) e.currentTarget.style.background = `${'var(--ds-surface3, #2b2d31)'}`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = isOptionSelected ? `${accent}0f` : 'var(--ds-surface2, #1a1b1e)';
      }}
    >
      {/* ── Icon box ── */}
      {icon && (
        <div style={{
          width: 42, height: 42, borderRadius: 10,
          flexShrink: 0,
          background: resolvedIconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: resolvedIconColor,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08)`,
        }}>
          {icon}
        </div>
      )}

      {/* ── Text ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: TYPOGRAPHY.sans,
          fontSize: TYPOGRAPHY.size.md,
          fontWeight: TYPOGRAPHY.weight.semibold,
          color: 'var(--ds-text-primary, #ffffff)',
          marginBottom: 3,
          lineHeight: 1.3,
        }}>
          {title}
        </div>
        {description && (
          <div style={{
            fontFamily: TYPOGRAPHY.sans,
            fontSize: TYPOGRAPHY.size.sm,
            color: 'var(--ds-text-subtle, #72767d)',
            lineHeight: 1.5,
          }}>
            {description}
          </div>
        )}
      </div>

      {/* ── Right control ── */}
      {rightControl && (
        <div style={{ flexShrink: 0, marginLeft: 8 }}
          onClick={e => controlType !== 'option' && e.stopPropagation()}
        >
          {rightControl}
        </div>
      )}
    </div>
  );
}

/**
 * SettingGroup — wraps a section of SettingCards with a label above.
 *
 * Props:
 *   label    string   uppercase section heading
 *   gap      number   gap between cards in px  (default 8)
 *   style    object
 */
export function SettingGroup({ label, gap = 8, style = {}, children }) {
  return (
    <div style={style}>
      {label && (
        <div style={{
          fontFamily: TYPOGRAPHY.pixel,
          fontSize: TYPOGRAPHY.pixelSize.xs,
          letterSpacing: TYPOGRAPHY.tracking.pixel,
          textTransform: 'uppercase',
          color: 'var(--ds-text-disabled, #4f545c)',
          marginBottom: 12,
          paddingLeft: 4,
          lineHeight: 2,
        }}>
          {label}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap }}>
        {children}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 17 · TOAST / SNACKBAR
//
// Imperative API — call useToast() inside any component to get a `toast()`
// function. Mount <ToastContainer /> once at the root of your app.
//
// toast(message, { variant, duration, icon })
//   variant   'default' | 'success' | 'danger' | 'warning' | 'info'
//   duration  ms  (default 3200)
//   icon      ReactNode
//
// Usage:
//   const toast = useToast();
//   toast('Chapter saved!', { variant: 'success' });
//   toast('Failed to sync.', { variant: 'danger' });
// ══════════════════════════════════════════════════════════════════════════════

// Global toast emitter (no external dep — just a tiny event bus)
const _toastListeners = new Set();
export function _emitToast(item) { _toastListeners.forEach(fn => fn(item)); }

/**
 * useToast — returns a toast() imperative function.
 * Must be used inside a component tree that has <ToastContainer /> mounted.
 */
export function useToast() {
  return useCallback((message, opts = {}) => {
    _emitToast({
      id: Date.now() + Math.random(),
      message,
      variant: opts.variant ?? 'default',
      duration: opts.duration ?? 3200,
      icon: opts.icon ?? null,
    });
  }, []);
}

const TOAST_ACCENT = {
  default: { color: COLORS.violet,  icon: null },
  success: { color: COLORS.success, icon: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
  danger:  { color: COLORS.danger,  icon: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> },
  warning: { color: COLORS.warning, icon: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
  info:    { color: COLORS.sky,     icon: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> },
};

function ToastItem({ item, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const acc = TOAST_ACCENT[item.variant] ?? TOAST_ACCENT.default;

  useEffect(() => {
    // mount → animate in
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(item.id), 350);
    }, item.duration);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      onClick={() => { setVisible(false); setTimeout(() => onDismiss(item.id), 350); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        borderRadius: RADIUS.md,
        backdropFilter: 'blur(20px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
        background: 'rgba(26,27,30,0.92)',
        border: `1px solid ${acc.color}44`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset`,
        cursor: 'pointer',
        userSelect: 'none',
        maxWidth: 340,
        width: '100%',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)',
        transition: 'opacity 300ms cubic-bezier(0.4,0,0.2,1), transform 300ms cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      {/* Accent side stripe */}
      <div style={{
        position: 'absolute', left: 0, top: '20%', bottom: '20%',
        width: 3, borderRadius: 2,
        background: acc.color,
      }} />
      {/* Icon */}
      {(item.icon ?? acc.icon) && (
        <span style={{ color: acc.color, display: 'flex', flexShrink: 0, marginLeft: 4 }}>
          {item.icon ?? acc.icon}
        </span>
      )}
      {/* Message */}
      <span style={{
        fontFamily: TYPOGRAPHY.pixel,
        fontSize: TYPOGRAPHY.pixelSize.xs,
        color: 'var(--ds-text-primary, #ffffff)',
        flex: 1,
        lineHeight: 1.9,
        letterSpacing: TYPOGRAPHY.tracking.pixel,
      }}>
        {item.message}
      </span>
    </div>
  );
}

/**
 * ToastContainer — mount once in your app root.
 * Toasts stack from bottom-right by default.
 *
 * Props:
 *   position  'bottom-right' | 'bottom-center' | 'top-right' | 'top-center'
 */
export function ToastContainer({ position = 'bottom-right' }) {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const fn = (item) => setToasts(prev => [...prev, item]);
    _toastListeners.add(fn);
    return () => _toastListeners.delete(fn);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const posStyle = {
    'bottom-right':  { bottom: 24, right: 24, alignItems: 'flex-end' },
    'bottom-center': { bottom: 24, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' },
    'top-right':     { top: 24, right: 24, alignItems: 'flex-end' },
    'top-center':    { top: 24, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' },
  }[position] ?? { bottom: 24, right: 24, alignItems: 'flex-end' };

  return (
    <div style={{
      position: 'fixed', zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 10,
      pointerEvents: 'none',
      ...posStyle,
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: 'all', position: 'relative' }}>
          <ToastItem item={t} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 18 · PROGRESS BAR
//
// Linear and circular variants. Both animate on value change.
//
// Usage:
//   <ProgressBar value={72} />
//   <ProgressBar value={45} gradient={GRADIENTS.aurora} label="Word Goal" showPct />
//   <CircularProgress value={68} size={64} strokeWidth={5} />
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ProgressBar — horizontal fill bar.
 *
 * Props:
 *   value       0–100
 *   gradient    CSS gradient string
 *   accentHex   solid color fallback
 *   height      px  (default 8)
 *   radius      px  (default full pill)
 *   label       string  shown left above
 *   showPct     bool    shows percentage right above
 *   animated    bool    pulse animation on indeterminate
 *   style       object
 */
export function ProgressBar({
  value = 0,
  gradient,
  accentHex,
  height = 8,
  label,
  showPct = false,
  animated = false,
  style = {},
}) {
  const accent = accentHex ?? COLORS.violet;
  const fill   = gradient ?? `linear-gradient(to right, ${accent}cc, ${accent})`;
  const pct    = Math.min(100, Math.max(0, value));

  // Chamfer size scales with track height — matches the button pixel aesthetic
  const ch  = Math.max(2, Math.floor(height * 0.55));  // corner cut in px
  // Track outer clip (all 4 corners chamfered)
  const trackClip = pixelClip(ch);
  // Fill right-edge: 2-step pixel staircase so it looks like a cut brick wall
  const fillClip = `polygon(
    0 0,
    calc(100% - ${ch}px) 0,
    100% ${ch}px,
    100% calc(100% - ${ch}px),
    calc(100% - ${ch}px) 100%,
    0 100%
  )`;

  return (
    <div style={{ width: '100%', ...style }}>
      {(label || showPct) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
          {label && <span style={{
            fontFamily: TYPOGRAPHY.pixel,
            fontSize: TYPOGRAPHY.pixelSize.xs,
            color: 'var(--ds-text-muted, #b9bbbe)',
            letterSpacing: TYPOGRAPHY.tracking.pixel,
            textTransform: 'uppercase',
          }}>{label}</span>}
          {showPct && <span style={{
            fontFamily: TYPOGRAPHY.mono,
            fontSize: TYPOGRAPHY.size.sm,
            color: 'var(--ds-text-subtle, #72767d)',
            fontVariantNumeric: 'tabular-nums',
          }}>{pct}%</span>}
        </div>
      )}
      {/* Track — chamfered pixel corners */}
      <div style={{
        width: '100%',
        height,
        clipPath: trackClip,
        background: 'var(--ds-surface3, #2b2d31)',
        position: 'relative',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
        imageRendering: 'pixelated',
      }}>
        {/* Fill — left end follows track shape, right edge is pixel-stepped */}
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: animated ? '60%' : `${pct}%`,
          clipPath: fillClip,
          background: fill,
          transition: 'width 0.45s cubic-bezier(0.4,0,0.2,1)',
          backgroundSize: animated ? '200% 100%' : undefined,
          animation: animated ? 'dsProgressSlide 1.5s linear infinite' : undefined,
          minWidth: height * 1.5,
        }} />
        {/* Pixel scanline sheen */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 2px)',
          pointerEvents: 'none', mixBlendMode: 'overlay',
        }} />
      </div>
      <style>{`@keyframes dsProgressSlide{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>
    </div>
  );
}

/**
 * CircularProgress — SVG ring progress indicator.
 *
 * Props:
 *   value       0–100
 *   size        px  (default 56)
 *   strokeWidth px  (default 4)
 *   accentHex   string
 *   gradient    CSS gradient (applied via SVG linearGradient)
 *   showValue   bool    renders value text in center
 *   label       string  small label under value
 *   animated    bool    spinning indeterminate
 */
export function CircularProgress({
  value = 0,
  size = 56,
  strokeWidth = 4,
  accentHex,
  showValue = false,
  label,
  animated = false,
  style = {},
}) {
  const accent = accentHex ?? COLORS.violet;
  const pct  = Math.min(100, Math.max(0, value));
  const r    = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  const uid  = useRef(`cpg${Math.floor(Math.random() * 1e6)}`).current;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0, ...style }}>
      <style>{`@keyframes dsSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <svg
        width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ animation: animated ? 'dsSpin 1.2s linear infinite' : undefined }}
      >
        <defs>
          <linearGradient id={uid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
            <stop offset="100%" stopColor={`${accent}66`} />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={'var(--ds-surface3, #2b2d31)'} strokeWidth={strokeWidth}
        />
        {/* Fill */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={`url(#${uid})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.5s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      {/* Center text */}
      {showValue && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: TYPOGRAPHY.mono, fontSize: size * 0.22, fontWeight: TYPOGRAPHY.weight.bold, color: 'var(--ds-text-primary, #ffffff)', lineHeight: 1 }}>
            {pct}
          </span>
          {label && <span style={{ fontFamily: TYPOGRAPHY.sans, fontSize: size * 0.13, color: 'var(--ds-text-subtle, #72767d)', marginTop: 2 }}>{label}</span>}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 19 · TABS
//
// Horizontal tab bar with animated underline indicator.
// Two visual modes: 'underline' (default) and 'pill'.
//
// Usage:
//   const [tab, setTab] = useState('appearance');
//   <Tabs
//     items={[
//       { key: 'appearance', label: 'Appearance' },
//       { key: 'startup',    label: 'Startup' },
//       { key: 'extensions', label: 'Extensions', badge: 2 },
//     ]}
//     active={tab}
//     onChange={setTab}
//   />
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tabs — horizontal tab strip.
 *
 * Props:
 *   items       Array<{ key, label, icon?, badge? }>
 *   active      string  key of active tab
 *   onChange    fn(key)
 *   variant     'underline' | 'pill'
 *   accentHex   string
 *   size        'sm' | 'md'
 *   fullWidth   bool   tabs share equal width
 *   style       object
 */
export function Tabs({
  items = [],
  active,
  onChange,
  variant = 'underline',
  accentHex,
  size = 'md',
  fullWidth = false,
  style = {},
}) {
  const accent   = accentHex ?? COLORS.violet;
  const fontSize = size === 'sm' ? TYPOGRAPHY.size.sm : TYPOGRAPHY.size.base;
  const padding  = size === 'sm' ? '8px 14px' : '10px 18px';

  return (
    <div style={{
      display: 'flex',
      position: 'relative',
      borderBottom: variant === 'underline' ? `1px solid ${'var(--ds-border, rgba(255,255,255,0.08))'}` : 'none',
      background: variant === 'pill' ? 'var(--ds-surface2, #1a1b1e)' : 'transparent',
      borderRadius: variant === 'pill' ? RADIUS.full : 0,
      padding: variant === 'pill' ? 4 : 0,
      gap: variant === 'pill' ? 4 : 0,
      ...style,
    }}>
      {items.map(item => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            onClick={() => onChange?.(item.key)}
            style={{
              flex: fullWidth ? 1 : undefined,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding,
              fontSize,
              fontFamily: TYPOGRAPHY.mono,
              fontWeight: isActive ? TYPOGRAPHY.weight.bold : TYPOGRAPHY.weight.medium,
              letterSpacing: '0.02em',
              border: 'none',
              cursor: 'pointer',
              userSelect: 'none',
              position: 'relative',
              whiteSpace: 'nowrap',
              transition: 'color 0.18s, background 0.18s',
              borderRadius: variant === 'pill' ? RADIUS.full : 0,
              // Colors
              color: isActive ? (variant === 'pill' ? '#fff' : accent) : 'var(--ds-text-subtle, #72767d)',
              background: variant === 'pill'
                ? (isActive ? `linear-gradient(135deg, ${accent}, ${accent}cc)` : 'transparent')
                : 'transparent',
              boxShadow: variant === 'pill' && isActive ? SHADOWS.glow(accent) : 'none',
            }}
          >
            {item.icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{item.icon}</span>}
            {item.label}
            {item.badge != null && (
              <span style={{
                minWidth: 17, height: 17, borderRadius: RADIUS.full,
                background: isActive ? 'rgba(255,255,255,0.25)' : 'var(--ds-surface4, #313338)',
                color: isActive ? '#fff' : 'var(--ds-text-muted, #b9bbbe)',
                fontSize: 9, fontWeight: TYPOGRAPHY.weight.bold,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 4px',
              }}>
                {item.badge}
              </span>
            )}
            {/* Underline indicator */}
            {variant === 'underline' && isActive && (
              <div style={{
                position: 'absolute', bottom: -1, left: 0, right: 0,
                height: 2, borderRadius: '2px 2px 0 0',
                background: accent,
                boxShadow: `0 0 8px ${accent}88`,
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 20 · BOTTOM SHEET
//
// Mobile-first modal that slides up from the bottom.
// Supports drag-to-dismiss via pointer events.
//
// Usage:
//   const [open, setOpen] = useState(false);
//   <BottomSheet isOpen={open} onClose={() => setOpen(false)} title="Options">
//     …content…
//   </BottomSheet>
// ══════════════════════════════════════════════════════════════════════════════

/**
 * BottomSheet — slides up from bottom, draggable to close.
 *
 * Props:
 *   isOpen      bool
 *   onClose     fn
 *   title       string
 *   accentHex   string
 *   snapPoints  array  not required — sheet auto-sizes to content
 *   maxWidth    string  (default '540px')
 *   style       object
 */
export function BottomSheet({ isOpen, onClose, title, accentHex, maxWidth = '540px', style = {}, children }) {
  const accent = accentHex ?? COLORS.violet;
  const sheetRef = useRef(null);
  const dragRef  = useRef({ startY: 0, dy: 0, dragging: false });
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!isOpen) { setDragY(0); return; }
    const fn = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const onPointerDown = (e) => {
    dragRef.current = { startY: e.clientY, dy: 0, dragging: true };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current.dragging) return;
    const dy = Math.max(0, e.clientY - dragRef.current.startY);
    dragRef.current.dy = dy;
    setDragY(dy);
  };
  const onPointerUp = () => {
    if (dragRef.current.dy > 100) { onClose?.(); }
    else { setDragY(0); }
    dragRef.current.dragging = false;
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'rgba(0,0,0,0.68)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        animation: 'dsFadeIn 0.15s ease',
      }}
    >
      <style>{`@keyframes dsSheetIn{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      <div
        ref={sheetRef}
        style={{
          width: '100%',
          maxWidth,
          maxHeight: '88vh',
          overflowY: 'auto',
          backdropFilter: 'blur(24px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
          background: 'rgba(22,22,28,0.96)',
          borderTop: `1px solid ${accent}33`,
          borderLeft: `1px solid ${'var(--ds-border, rgba(255,255,255,0.08))'}`,
          borderRight: `1px solid ${'var(--ds-border, rgba(255,255,255,0.08))'}`,
          borderRadius: `${RADIUS.xl}px ${RADIUS.xl}px 0 0`,
          boxShadow: `0 -12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset`,
          animation: dragY === 0 ? 'dsSheetIn 0.28s cubic-bezier(0.32,0.72,0,1)' : undefined,
          transform: `translateY(${dragY}px)`,
          transition: dragRef.current.dragging ? 'none' : 'transform 0.28s cubic-bezier(0.32,0.72,0,1)',
          willChange: 'transform',
          ...style,
        }}
      >
        {/* Drag handle */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            display: 'flex', justifyContent: 'center', padding: '14px 0 8px',
            cursor: 'grab', touchAction: 'none',
          }}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--ds-surface4, #313338)' }} />
        </div>

        {/* Title bar */}
        {title && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 20px 14px',
          }}>
            <span style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.sm, color: accent, letterSpacing: TYPOGRAPHY.tracking.pixel }}>
              {title}
            </span>
            <button
              onClick={onClose}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'var(--ds-surface3, #2b2d31)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--ds-text-muted, #b9bbbe)', fontSize: 16,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--ds-surface4, #313338)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--ds-surface3, #2b2d31)'; e.currentTarget.style.color = 'var(--ds-text-muted, #b9bbbe)'; }}
            >×</button>
          </div>
        )}

        {/* Content */}
        <div style={{ padding: title ? '0 20px 32px' : '8px 20px 32px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 21 · LIST ITEM
//
// Generic list row: leading element + title/subtitle + trailing element.
// Composable — leading/trailing accept any ReactNode.
//
// Usage:
//   <ListItem
//     leading={<DSIcons.BookOpen size={18} />}
//     leadingBg="rgba(139,92,246,0.2)"
//     title="My Journal"
//     subtitle="Last edited 2 minutes ago"
//     trailing={<ChevronRight />}
//     onClick={() => navigate('/journal')}
//   />
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ListItem — single row in a list.
 *
 * Props:
 *   leading       ReactNode   icon or avatar shown on left
 *   leadingBg     string      background of the leading box
 *   leadingSize   number      size of leading box px  (default 40)
 *   title         string | ReactNode
 *   subtitle      string | ReactNode
 *   trailing      ReactNode   element on right (chevron, value, button, etc.)
 *   accentHex     string      accent for active/hover tint
 *   active        bool        highlight this row
 *   divider       bool        show bottom divider line
 *   onClick       fn
 *   style         object
 */
export function ListItem({
  leading,
  leadingBg,
  leadingSize = 40,
  title,
  subtitle,
  trailing,
  accentHex,
  active = false,
  divider = false,
  onClick,
  style = {},
}) {
  const accent = accentHex ?? COLORS.violet;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: RADIUS.md,
        background: active ? `${accent}12` : 'transparent',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s',
        borderBottom: divider ? `1px solid ${'var(--ds-border, rgba(255,255,255,0.08))'}` : 'none',
        ...style,
      }}
      onMouseEnter={e => onClick && !active && (e.currentTarget.style.background = 'var(--ds-surface2, #1a1b1e)')}
      onMouseLeave={e => onClick && !active && (e.currentTarget.style.background = 'transparent')}
    >
      {/* Leading */}
      {leading && (
        <div style={{
          width: leadingSize, height: leadingSize,
          borderRadius: leadingSize * 0.26,
          flexShrink: 0,
          background: leadingBg ?? 'var(--ds-surface3, #2b2d31)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: active ? accent : 'var(--ds-text-muted, #b9bbbe)',
          transition: 'color 0.15s',
        }}>
          {leading}
        </div>
      )}

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: TYPOGRAPHY.pixel,
          fontSize: TYPOGRAPHY.pixelSize.xs,
          color: active ? 'var(--ds-text-primary, #ffffff)' : 'var(--ds-text-secondary, #dcddde)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: 1.9,
          letterSpacing: TYPOGRAPHY.tracking.pixel,
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{
            fontFamily: TYPOGRAPHY.sans,
            fontSize: TYPOGRAPHY.size.sm,
            color: 'var(--ds-text-subtle, #72767d)',
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* Trailing */}
      {trailing && (
        <div style={{ flexShrink: 0, color: 'var(--ds-text-disabled, #4f545c)', display: 'flex', alignItems: 'center' }}>
          {trailing}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 22 · EMPTY STATE
//
// Zero-content placeholder with icon, heading, body, and optional CTA.
//
// Usage:
//   <EmptyState
//     icon={<DSIcons.BookOpen size={32} />}
//     title="No books yet"
//     description="Import a file or create a new blank book to get started."
//     action={<PixelButton variant="primary" size="md">Create Book</PixelButton>}
//   />
// ══════════════════════════════════════════════════════════════════════════════

/**
 * EmptyState — centered placeholder for empty screens/lists.
 *
 * Props:
 *   icon          ReactNode
 *   iconBg        string
 *   accentHex     string
 *   title         string
 *   description   string
 *   action        ReactNode   CTA button
 *   compact       bool        less vertical padding
 *   style         object
 */
export function EmptyState({ icon, iconBg, accentHex, title, description, action, compact = false, style = {} }) {
  const accent = accentHex ?? COLORS.violet;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: compact ? '32px 24px' : '64px 32px',
      gap: 0,
      ...style,
    }}>
      {/* Icon circle */}
      {icon && (
        <div style={{
          width: 72, height: 72, borderRadius: RADIUS.xl,
          background: iconBg ?? `${accent}18`,
          border: `1px solid ${accent}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accent,
          marginBottom: 20,
          boxShadow: `0 0 32px ${accent}18`,
        }}>
          {icon}
        </div>
      )}

      {title && (
        <div style={{
          fontFamily: TYPOGRAPHY.pixel,
          fontSize: TYPOGRAPHY.pixelSize.sm,
          color: 'var(--ds-text-secondary, #dcddde)',
          letterSpacing: TYPOGRAPHY.tracking.pixel,
          marginBottom: 10,
          lineHeight: 1.8,
        }}>
          {title}
        </div>
      )}

      {description && (
        <div style={{
          fontFamily: TYPOGRAPHY.sans,
          fontSize: TYPOGRAPHY.size.base,
          color: 'var(--ds-text-subtle, #72767d)',
          lineHeight: 1.6,
          maxWidth: 280,
          marginBottom: action ? 24 : 0,
        }}>
          {description}
        </div>
      )}

      {action}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 23 · TOOLTIP
//
// Hover/focus tooltip that appears above (or below/left/right) an element.
// Pure CSS-position based — no Popper dependency.
//
// Usage:
//   <Tooltip content="This feature is Pro only" placement="top">
//     <ProBadge />
//   </Tooltip>
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tooltip — wraps children and shows a label on hover.
 *
 * Props:
 *   content     string | ReactNode
 *   placement   'top' | 'bottom' | 'left' | 'right'
 *   delay       ms before appearing  (default 400)
 *   accentHex   string  optional accent tint on the tooltip border
 *   style       object  applied to wrapper div
 */
export function Tooltip({ content, placement = 'top', delay = 400, accentHex, style = {}, children }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const accent = accentHex;

  const show = () => { timerRef.current = setTimeout(() => setVisible(true), delay); };
  const hide = () => { clearTimeout(timerRef.current); setVisible(false); };

  const offsets = {
    top:    { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
    bottom: { top:    'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
    left:   { right:  'calc(100% + 8px)', top:  '50%', transform: 'translateY(-50%)' },
    right:  { left:   'calc(100% + 8px)', top:  '50%', transform: 'translateY(-50%)' },
  }[placement] ?? { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' };

  return (
    <div
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ position: 'relative', display: 'inline-flex', ...style }}
    >
      {children}
      {visible && (
        <div style={{
          position: 'absolute',
          zIndex: 500,
          whiteSpace: 'nowrap',
          maxWidth: 220,
          padding: '6px 12px',
          borderRadius: RADIUS.sm,
          background: 'var(--ds-surface2, #1a1b1e)',
          border: `1px solid ${accent ? `${accent}44` : 'var(--ds-border, rgba(255,255,255,0.08))'}`,
          boxShadow: `0 8px 24px rgba(0,0,0,0.5)`,
          fontFamily: TYPOGRAPHY.sans,
          fontSize: TYPOGRAPHY.size.sm,
          color: 'var(--ds-text-secondary, #dcddde)',
          lineHeight: 1.4,
          pointerEvents: 'none',
          animation: 'dsFadeIn 0.12s ease',
          ...offsets,
        }}>
          {content}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// § 24 · ABOUT SECTION + ATTRIBUTION
//
// ⚠️  ACTION REQUIRED — Before shipping:
//   1. Add a dedicated "About" screen at the bottom of Settings.
//   2. Render <AboutSection /> there — it handles layout, version, and credits.
//   3. Update APP_META.version and APP_META.buildDate on every release.
//   4. Add or remove entries in ATTRIBUTION as your dependency list changes.
//
// Licence obligations:
//   • @2hoch1/pixel-icon-library-react — MIT → keep copyright notice visible
//   • Press Start 2P (CodeMan38)       — OFL-1.1 → credit in UI or docs
//   • JetBrains Mono (JetBrains)       — OFL-1.1 → credit in UI or docs
//   • React / Expo                     — MIT → include in bundled notices
// ══════════════════════════════════════════════════════════════════════════════

/** Bump on every release. */
export const APP_META = {
  name:        'Authno',
  version:     '1.0.0',
  buildDate:   '2026-04-29',
  platform:    'Android',
  author:      'Your Name / Studio',
  repository:  'https://github.com/your-org/authno-android',
  supportEmail:'support@authno.app',
};

/** One entry per library / asset requiring attribution. */
export const ATTRIBUTION = [
  {
    name:    'Pixel Icon Library',
    author:  'HackerNoon',
    licence: 'CC BY 4.0',
    url:     'https://pixeliconlibrary.com',
    note:    'Retro pixel icons — attribution required. Use <i class="hn hn-{name}"> or npm: @hackernoon/pixel-icon-library',
  },
  {
    name:    'Press Start 2P',
    author:  'CodeMan38',
    licence: 'OFL-1.1',
    url:     'https://fonts.google.com/specimen/Press+Start+2P',
    note:    'GBA-style pixel font used for headings and labels',
  },
  {
    name:    'JetBrains Mono',
    author:  'JetBrains',
    licence: 'OFL-1.1',
    url:     'https://fonts.google.com/specimen/JetBrains+Mono',
    note:    'Monospace font used for UI text and code',
  },
  {
    name:    'React',
    author:  'Meta Platforms, Inc.',
    licence: 'MIT',
    url:     'https://react.dev',
  },
  {
    name:    'React Native / Expo',
    author:  'Expo, Inc.',
    licence: 'MIT',
    url:     'https://expo.dev',
  },
  // Add more entries here as dependencies grow:
  // { name: 'react-native-reanimated', author: 'Software Mansion', licence: 'MIT', url: '...' },
];

/**
 * AboutSection — renders the full About + Credits block.
 * Drop it at the bottom of your Settings screen.
 *
 * Props:
 *   meta          APP_META-shaped object
 *   attribution   ATTRIBUTION-shaped array
 *   accentHex     string
 *   style         object
 */
export function AboutSection({
  meta = APP_META,
  attribution = ATTRIBUTION,
  accentHex,
  style = {},
}) {
  const accent = accentHex ?? COLORS.violet;

  return (
    <div style={style}>

      {/* ── App identity ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 24px 24px', textAlign: 'center',
        borderBottom: `1px solid ${'var(--ds-border, rgba(255,255,255,0.08))'}`,
        marginBottom: 20,
      }}>
        <div style={{
          fontFamily: TYPOGRAPHY.pixel,
          fontSize: TYPOGRAPHY.pixelSize.lg,
          background: `linear-gradient(135deg, ${accent}, ${accent}99)`,
          WebkitBackgroundClip: 'text', backgroundClip: 'text',
          color: 'transparent',
          letterSpacing: TYPOGRAPHY.tracking.pixel,
          marginBottom: 12, lineHeight: 1.6,
        }}>
          {meta.name}
        </div>

        {/* Version pill */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 14px',
          background: `${accent}14`,
          border: `1px solid ${accent}33`,
          borderRadius: RADIUS.full,
          marginBottom: 10,
        }}>
          <span style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs, color: accent, letterSpacing: TYPOGRAPHY.tracking.pixel, lineHeight: 1.8 }}>
            v{meta.version}
          </span>
          <div style={{ width: 1, height: 10, background: `${accent}44` }} />
          <span style={{ fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.sm, color: 'var(--ds-text-subtle, #72767d)' }}>
            {meta.buildDate}
          </span>
        </div>

        <span style={{ fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm, color: 'var(--ds-text-subtle, #72767d)' }}>
          {meta.platform} · Built by {meta.author}
        </span>
      </div>

      {/* ── Attribution list ── */}
      <SettingGroup label="Open Source & Credits">
        {attribution.map((lib, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: '13px 16px',
            background: 'var(--ds-surface2, #1a1b1e)',
            border: `1px solid ${'var(--ds-border, rgba(255,255,255,0.08))'}`,
            borderRadius: RADIUS.md,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{
                fontFamily: TYPOGRAPHY.pixel,
                fontSize: TYPOGRAPHY.pixelSize.xs,
                color: 'var(--ds-text-secondary, #dcddde)',
                letterSpacing: TYPOGRAPHY.tracking.pixel,
                lineHeight: 1.9,
              }}>
                {lib.name}
              </span>
              <span style={{
                fontFamily: TYPOGRAPHY.pixel,
                fontSize: TYPOGRAPHY.pixelSize.xs,
                color: accent,
                background: `${accent}18`,
                border: `1px solid ${accent}33`,
                borderRadius: RADIUS.sm,
                padding: '2px 7px',
                letterSpacing: TYPOGRAPHY.tracking.pixel,
                lineHeight: 1.8,
                flexShrink: 0,
              }}>
                {lib.licence}
              </span>
            </div>
            <span style={{ fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm, color: 'var(--ds-text-subtle, #72767d)' }}>
              {lib.author}
            </span>
            {lib.note && (
              <span style={{ fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.xs, color: 'var(--ds-text-disabled, #4f545c)', fontStyle: 'italic' }}>
                {lib.note}
              </span>
            )}
            {lib.url && (
              <a href={lib.url} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.xs, color: accent, textDecoration: 'none', marginTop: 1 }}>
                {lib.url}
              </a>
            )}
          </div>
        ))}
      </SettingGroup>

      {/* ── Footer ── */}
      <div style={{
        marginTop: 24,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        paddingBottom: 8,
      }}>
        {meta.repository && (
          <a href={meta.repository} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.sm, color: 'var(--ds-text-subtle, #72767d)', textDecoration: 'none' }}>
            {meta.repository}
          </a>
        )}
        {meta.supportEmail && (
          <a href={`mailto:${meta.supportEmail}`}
            style={{ fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.sm, color: 'var(--ds-text-subtle, #72767d)', textDecoration: 'none' }}>
            {meta.supportEmail}
          </a>
        )}
        <span style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs, color: 'var(--ds-text-disabled, #4f545c)', letterSpacing: TYPOGRAPHY.tracking.pixel, marginTop: 8, lineHeight: 2 }}>
          © {new Date().getFullYear()} {meta.author}
        </span>
      </div>

    </div>
  );
}
