/**
 * Buttons.jsx — All button variants
 *
 * Exports: PixelButton, GradientButton, GhostButton, DangerButton, MinimalButton
 */

import { useState } from 'react';
import { COLORS, GRADIENTS, TYPOGRAPHY, SHADOWS } from './tokens';
import { pixelClip } from './_utils';

// ══════════════════════════════════════════════════════════════════════════════
// PixelButton — retro GBA-style button with chamfered corners
// ══════════════════════════════════════════════════════════════════════════════

const PIXEL_SIZES = {
  xs: { fontSize: 8,  padding: '6px 12px',  gap: 5,  corner: 6,  iconSize: 10 },
  sm: { fontSize: 9,  padding: '8px 14px',  gap: 6,  corner: 8,  iconSize: 12 },
  md: { fontSize: 12, padding: '14px 24px', gap: 8,  corner: 12, iconSize: 14 },
  lg: { fontSize: 16, padding: '18px 32px', gap: 10, corner: 14, iconSize: 18 },
};

const PIXEL_VARIANTS = {
  primary:   (accent) => ({ border: accent ?? COLORS.violet, fill: `${accent ?? COLORS.violet}cc`, color: '#fff', shadow: SHADOWS.glow(accent ?? COLORS.violet) }),
  gradient:  ()       => ({ border: 'transparent', fill: null, gradient: GRADIENTS.violet, color: '#fff', shadow: SHADOWS.violet }),
  secondary: ()       => ({ border: COLORS.indigo, fill: `${COLORS.indigo}22`, color: COLORS.indigo, shadow: 'none' }),
  ghost:     (accent) => ({ border: `${accent ?? COLORS.rose}66`, fill: 'transparent', color: accent ?? COLORS.rose, shadow: 'none' }),
  danger:    ()       => ({ border: COLORS.danger, fill: `${COLORS.danger}cc`, color: '#fff', shadow: SHADOWS.danger }),
  success:   ()       => ({ border: COLORS.success, fill: `${COLORS.success}cc`, color: '#fff', shadow: SHADOWS.success }),
  info:      ()       => ({ border: COLORS.sky, fill: `${COLORS.sky}cc`, color: '#fff', shadow: SHADOWS.sky }),
};

/**
 * PixelButton — retro GBA-style chamfered-corner button.
 *
 * Props:
 *   variant   'primary' | 'gradient' | 'secondary' | 'ghost' | 'danger' | 'success' | 'info'
 *   size      'xs' | 'sm' | 'md' | 'lg'
 *   icon      ReactNode
 *   accentHex string     overrides brand accent
 *   disabled  bool
 *   gradient  string     custom CSS gradient (variant='gradient' only)
 *   onClick   fn
 *   style     object
 */
export function PixelButton({
  variant = 'primary', size = 'md', icon, accentHex,
  disabled = false, gradient: customGradient, onClick, style = {}, children,
}) {
  const sz = PIXEL_SIZES[size] ?? PIXEL_SIZES.md;
  const v  = (PIXEL_VARIANTS[variant] ?? PIXEL_VARIANTS.primary)(accentHex);
  const clip = pixelClip(sz.corner);
  const borderW = Math.max(2, Math.floor(sz.corner / 4));
  const gradientBg = customGradient ?? v.gradient ?? null;
  const outerBg = v.border === 'transparent' ? (gradientBg ?? v.fill) : v.border;
  const shadow = v.shadow === 'none' ? '0 0 0 transparent' : v.shadow;

  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none', background: 'transparent', padding: 0,
        fontFamily: TYPOGRAPHY.pixel, textTransform: 'uppercase',
        letterSpacing: TYPOGRAPHY.tracking.pixel, lineHeight: 1,
        opacity: disabled ? 0.45 : 1,
        transition: 'transform 80ms ease, filter 150ms ease',
        filter: `drop-shadow(${shadow})`,
        ...style,
      }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.filter = `brightness(1.14) drop-shadow(${shadow})`)}
      onMouseLeave={e => !disabled && (e.currentTarget.style.filter = `drop-shadow(${shadow})`)}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.96) translateY(1px)')}
      onMouseUp={e => !disabled && (e.currentTarget.style.transform = 'scale(1) translateY(0)')}
    >
      <div style={{ display: 'inline-flex', alignItems: 'stretch', clipPath: clip, padding: `${borderW}px`, background: outerBg }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          gap: `${sz.gap}px`, fontSize: `${sz.fontSize}px`, padding: sz.padding,
          clipPath: clip,
          background: gradientBg && v.fill === null ? gradientBg : (v.fill || 'transparent'),
          color: v.color, transition: 'filter 150ms ease',
          userSelect: 'none', whiteSpace: 'nowrap',
        }}>
          {icon && <span style={{ display: 'inline-flex', alignItems: 'center', width: sz.iconSize, height: sz.iconSize }}>{icon}</span>}
          {children}
        </div>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GradientButton — smooth rounded button (Discord-style)
// ══════════════════════════════════════════════════════════════════════════════

const GRADIENT_BTN_VARIANTS = {
  primary:   { bg: GRADIENTS.violet,  shadow: SHADOWS.violet,  color: '#fff' },
  ocean:     { bg: GRADIENTS.ocean,   shadow: SHADOWS.indiglo, color: '#fff' },
  rose:      { bg: GRADIENTS.rose,    shadow: '0 0 20px rgba(236,72,153,0.4)', color: '#fff' },
  ember:     { bg: GRADIENTS.ember,   shadow: SHADOWS.danger,  color: '#fff' },
  sage:      { bg: GRADIENTS.sage,    shadow: SHADOWS.success, color: '#fff' },
  aurora:    { bg: GRADIENTS.aurora,  shadow: SHADOWS.violet,  color: '#fff' },
  secondary: { bg: 'rgba(139,92,246,0.14)', shadow: 'none', color: COLORS.violet, border: `1px solid rgba(139,92,246,0.3)` },
  ghost:     { bg: 'transparent', shadow: 'none', color: COLORS.textMuted, border: `1px solid ${COLORS.border}` },
  danger:    { bg: COLORS.danger, shadow: SHADOWS.danger, color: '#fff' },
};

const GRADIENT_BTN_SIZES = {
  sm: { padding: '6px 14px',  fontSize: 12, radius: 10, iconSize: 13 },
  md: { padding: '9px 18px',  fontSize: 14, radius: 14, iconSize: 14 },
  lg: { padding: '13px 24px', fontSize: 16, radius: 16, iconSize: 16 },
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
export function GradientButton({ variant = 'primary', size = 'md', icon, disabled = false, onClick, style = {}, children }) {
  const v  = GRADIENT_BTN_VARIANTS[variant] ?? GRADIENT_BTN_VARIANTS.primary;
  const sz = GRADIENT_BTN_SIZES[size] ?? GRADIENT_BTN_SIZES.md;

  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 7, padding: sz.padding, fontSize: sz.fontSize,
        fontFamily: TYPOGRAPHY.mono, fontWeight: TYPOGRAPHY.weight.bold,
        letterSpacing: TYPOGRAPHY.tracking.wide, borderRadius: sz.radius,
        cursor: disabled ? 'not-allowed' : 'pointer', border: v.border ?? 'none',
        background: v.bg, color: v.color,
        boxShadow: v.shadow !== 'none' ? v.shadow : 'none',
        opacity: disabled ? 0.45 : 1,
        transition: 'transform 80ms ease, filter 150ms ease, box-shadow 150ms ease',
        userSelect: 'none', whiteSpace: 'nowrap', ...style,
      }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.filter = 'brightness(1.1)')}
      onMouseLeave={e => !disabled && (e.currentTarget.style.filter = 'brightness(1)')}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.97)')}
      onMouseUp={e => !disabled && (e.currentTarget.style.transform = 'scale(1)')}
    >
      {icon && <span style={{ display: 'inline-flex', alignItems: 'center', width: sz.iconSize, height: sz.iconSize }}>{icon}</span>}
      {children}
    </button>
  );
}

// Convenience aliases
export const GhostButton  = (props) => <GradientButton variant="ghost"  {...props} />;
export const DangerButton = (props) => <GradientButton variant="danger" {...props} />;

// ══════════════════════════════════════════════════════════════════════════════
// MinimalButton — outline-only, no background fill
// ══════════════════════════════════════════════════════════════════════════════

/**
 * MinimalButton — border + text only. Two shapes: 'smooth' | 'pixel'.
 *
 * Props:
 *   variant   'pixel' | 'smooth'
 *   size      'xs' | 'sm' | 'md' | 'lg'
 *   color     CSS color for border + text + icon  (default '#fff')
 *   icon      ReactNode
 *   disabled  bool
 */
export function MinimalButton({ variant = 'smooth', size = 'md', color = '#ffffff', icon, disabled = false, onClick, style = {}, children }) {
  const [hovered, setHovered] = useState(false);

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
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          gap: sz.gap, padding: sz.padding, fontSize: sz.fontSize,
          fontFamily: TYPOGRAPHY.mono, fontWeight: TYPOGRAPHY.weight.bold,
          letterSpacing: TYPOGRAPHY.tracking.wide, borderRadius: sz.radius,
          border: `1.5px solid ${color}`,
          background: hovered ? `${color}14` : 'transparent',
          color, cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          transition: 'background 0.15s, transform 80ms ease',
          userSelect: 'none', whiteSpace: 'nowrap',
          transform: hovered ? 'scale(1.02)' : 'scale(1)', ...style,
        }}
      >
        {icon && <span style={{ display: 'inline-flex', alignItems: 'center', width: sz.iconSize, height: sz.iconSize }}>{icon}</span>}
        {children}
      </button>
    );
  }

  // Pixel variant
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
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none', background: 'transparent', padding: 0,
        fontFamily: TYPOGRAPHY.pixel, textTransform: 'uppercase',
        letterSpacing: TYPOGRAPHY.tracking.pixel, lineHeight: 1,
        opacity: disabled ? 0.4 : 1,
        transition: 'transform 80ms ease, filter 150ms ease',
        filter: hovered ? 'brightness(1.2)' : 'brightness(1)',
        transform: hovered ? 'scale(1.02)' : 'scale(1)', ...style,
      }}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.96) translateY(1px)')}
      onMouseUp={e => !disabled && (e.currentTarget.style.transform = hovered ? 'scale(1.02)' : 'scale(1)')}
    >
      <div style={{ display: 'inline-flex', alignItems: 'stretch', clipPath: clip, padding: px.border, background: color }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          gap: px.gap, fontSize: px.fontSize, padding: px.padding,
          clipPath: clip, background: hovered ? `${color}18` : COLORS.surface0,
          color, transition: 'background 0.15s', userSelect: 'none', whiteSpace: 'nowrap',
        }}>
          {icon && <span style={{ display: 'inline-flex', alignItems: 'center', width: px.iconSize, height: px.iconSize }}>{icon}</span>}
          {children}
        </div>
      </div>
    </button>
  );
}
