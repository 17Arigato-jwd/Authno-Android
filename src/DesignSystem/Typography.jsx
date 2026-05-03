/**
 * Typography.jsx — Text components
 *
 * Exports: PixelText, Heading, Body, Caption, MonoText, GradientText
 */

import { COLORS, GRADIENTS, TYPOGRAPHY, RADIUS } from './tokens';

/** PixelText — Silkscreen retro text. For logos, headings, labels. */
export function PixelText({ size = 'base', color, gradient, style = {}, children }) {
  const fs = TYPOGRAPHY.pixelSize[size] ?? TYPOGRAPHY.pixelSize.base;
  return (
    <span style={{
      fontFamily: TYPOGRAPHY.pixel, fontSize: fs,
      letterSpacing: TYPOGRAPHY.tracking.pixel,
      color: gradient ? 'transparent' : (color ?? COLORS.violet),
      background: gradient ?? undefined,
      WebkitBackgroundClip: gradient ? 'text' : undefined,
      backgroundClip: gradient ? 'text' : undefined,
      lineHeight: 1.6, ...style,
    }}>
      {children}
    </span>
  );
}

/** Heading — large display text (mono, bold). level 1–6. */
export function Heading({ level = 1, color, gradient, style = {}, children }) {
  const sizes = [36, 28, 22, 18, 15, 13];
  const fs = sizes[level - 1] ?? 22;
  return (
    <div style={{
      fontFamily: TYPOGRAPHY.mono, fontSize: fs,
      fontWeight: TYPOGRAPHY.weight.bold,
      color: gradient ? 'transparent' : (color ?? COLORS.textPrimary),
      background: gradient ?? undefined,
      WebkitBackgroundClip: gradient ? 'text' : undefined,
      backgroundClip: gradient ? 'text' : undefined,
      letterSpacing: TYPOGRAPHY.tracking.tight,
      lineHeight: 1.25, ...style,
    }}>
      {children}
    </div>
  );
}

/** Body — standard paragraph text. */
export function Body({ size = 'base', color, muted = false, style = {}, children }) {
  return (
    <p style={{
      fontFamily: TYPOGRAPHY.sans,
      fontSize: TYPOGRAPHY.size[size] ?? TYPOGRAPHY.size.base,
      color: color ?? (muted ? COLORS.textSubtle : COLORS.textSecondary),
      lineHeight: 1.6, margin: 0, ...style,
    }}>
      {children}
    </p>
  );
}

/** Caption — small label text. */
export function Caption({ color, uppercase = false, style = {}, children }) {
  return (
    <span style={{
      fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm,
      fontWeight: TYPOGRAPHY.weight.medium,
      color: color ?? COLORS.textSubtle,
      letterSpacing: uppercase ? '0.6px' : 0,
      textTransform: uppercase ? 'uppercase' : undefined, ...style,
    }}>
      {children}
    </span>
  );
}

/** MonoText — JetBrains Mono, for code, values, IDs. */
export function MonoText({ size = 'base', color, style = {}, children }) {
  return (
    <code style={{
      fontFamily: TYPOGRAPHY.mono,
      fontSize: TYPOGRAPHY.size[size] ?? TYPOGRAPHY.size.base,
      color: color ?? COLORS.textMuted,
      background: COLORS.surface3,
      padding: '2px 6px', borderRadius: RADIUS.sm,
      letterSpacing: '-0.01em', ...style,
    }}>
      {children}
    </code>
  );
}

/** GradientText — inline text with animated gradient fill. */
export function GradientText({ gradient = GRADIENTS.violet, animate = false, style = {}, children }) {
  return (
    <>
      {animate && (
        <style>{`@keyframes dsGradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}`}</style>
      )}
      <span style={{
        background: animate ? `${gradient}, ${gradient}` : gradient,
        WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
        backgroundSize: animate ? '200% 200%' : undefined,
        animation: animate ? 'dsGradientShift 3s ease infinite' : undefined,
        fontWeight: 'inherit', fontFamily: 'inherit', fontSize: 'inherit', ...style,
      }}>
        {children}
      </span>
    </>
  );
}
