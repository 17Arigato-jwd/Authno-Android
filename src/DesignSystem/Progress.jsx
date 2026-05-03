/**
 * Progress.jsx — Linear and circular progress indicators
 *
 * Exports: ProgressBar, CircularProgress, Tabs
 */

import { useRef } from 'react';
import { COLORS, TYPOGRAPHY, RADIUS } from './tokens';
import { pixelClip } from './_utils';

// ══════════════════════════════════════════════════════════════════════════════
// ProgressBar — horizontal fill bar with pixel-stepped edges
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ProgressBar
 *
 * Props:
 *   value       0–100
 *   gradient    CSS gradient string
 *   accentHex   solid color fallback
 *   height      px (default 8)
 *   label       string shown left above
 *   showPct     bool shows percentage right above
 *   animated    bool pulse animation for indeterminate
 */
export function ProgressBar({ value = 0, gradient, accentHex, height = 8, label, showPct = false, animated = false, style = {} }) {
  const accent = accentHex ?? COLORS.violet;
  const fill   = gradient ?? `linear-gradient(to right, ${accent}cc, ${accent})`;
  const pct    = Math.min(100, Math.max(0, value));

  const ch = Math.max(2, Math.floor(height * 0.55));
  const trackClip = pixelClip(ch);
  const fillClip  = `polygon(
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
          {label && <span style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs, color: COLORS.textMuted, letterSpacing: TYPOGRAPHY.tracking.pixel, textTransform: 'uppercase' }}>{label}</span>}
          {showPct && <span style={{ fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>}
        </div>
      )}
      <div style={{ width: '100%', height, clipPath: trackClip, background: COLORS.surface3, position: 'relative', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: animated ? '60%' : `${pct}%`,
          clipPath: fillClip, background: fill,
          transition: 'width 0.45s cubic-bezier(0.4,0,0.2,1)',
          backgroundSize: animated ? '200% 100%' : undefined,
          animation: animated ? 'dsProgressSlide 1.5s linear infinite' : undefined,
          minWidth: height * 1.5,
        }} />
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

// ══════════════════════════════════════════════════════════════════════════════
// CircularProgress — SVG ring indicator
// ══════════════════════════════════════════════════════════════════════════════

/**
 * CircularProgress
 *
 * Props:
 *   value       0–100
 *   size        px (default 56)
 *   strokeWidth px (default 4)
 *   accentHex   string
 *   showValue   bool renders value text in center
 *   label       string small label under value
 *   animated    bool spinning indeterminate
 */
export function CircularProgress({ value = 0, size = 56, strokeWidth = 4, accentHex, showValue = false, label, animated = false, style = {} }) {
  const accent = accentHex ?? COLORS.violet;
  const pct    = Math.min(100, Math.max(0, value));
  const r      = (size - strokeWidth) / 2;
  const circ   = 2 * Math.PI * r;
  const dash   = circ * (pct / 100);
  const uid    = useRef(`cpg${Math.floor(Math.random() * 1e6)}`).current;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0, ...style }}>
      <style>{`@keyframes dsSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ animation: animated ? 'dsSpin 1.2s linear infinite' : undefined }}>
        <defs>
          <linearGradient id={uid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
            <stop offset="100%" stopColor={`${accent}66`} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.surface3} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={`url(#${uid})`} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.5s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      {showValue && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: TYPOGRAPHY.mono, fontSize: size * 0.22, fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1 }}>{pct}</span>
          {label && <span style={{ fontFamily: TYPOGRAPHY.sans, fontSize: size * 0.13, color: COLORS.textSubtle, marginTop: 2 }}>{label}</span>}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tabs — horizontal tab bar with animated underline or pill indicator
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tabs
 *
 * Props:
 *   items       Array<{ key, label, icon?, badge? }>
 *   active      string  key of active tab
 *   onChange    fn(key)
 *   variant     'underline' | 'pill'
 *   accentHex   string
 *   size        'sm' | 'md'
 *   fullWidth   bool
 */
export function Tabs({ items = [], active, onChange, variant = 'underline', accentHex, size = 'md', fullWidth = false, style = {} }) {
  const accent   = accentHex ?? COLORS.violet;
  const fontSize = size === 'sm' ? TYPOGRAPHY.size.sm : TYPOGRAPHY.size.base;
  const padding  = size === 'sm' ? '8px 14px' : '10px 18px';

  return (
    <div style={{
      display: 'flex', position: 'relative',
      borderBottom: variant === 'underline' ? `1px solid ${COLORS.border}` : 'none',
      background: variant === 'pill' ? COLORS.surface2 : 'transparent',
      borderRadius: variant === 'pill' ? RADIUS.full : 0,
      padding: variant === 'pill' ? 4 : 0,
      gap: variant === 'pill' ? 4 : 0, ...style,
    }}>
      {items.map(item => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            onClick={() => onChange?.(item.key)}
            style={{
              flex: fullWidth ? 1 : undefined,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding, fontSize, fontFamily: TYPOGRAPHY.mono,
              fontWeight: isActive ? 700 : 500, letterSpacing: '0.02em',
              border: 'none', cursor: 'pointer', userSelect: 'none',
              position: 'relative', whiteSpace: 'nowrap',
              transition: 'color 0.18s, background 0.18s',
              borderRadius: variant === 'pill' ? RADIUS.full : 0,
              color: isActive ? (variant === 'pill' ? '#fff' : accent) : COLORS.textSubtle,
              background: variant === 'pill' ? (isActive ? `linear-gradient(135deg, ${accent}, ${accent}cc)` : 'transparent') : 'transparent',
            }}
          >
            {item.icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{item.icon}</span>}
            {item.label}
            {item.badge != null && (
              <span style={{
                minWidth: 17, height: 17, borderRadius: RADIUS.full,
                background: isActive ? 'rgba(255,255,255,0.25)' : COLORS.surface4,
                color: isActive ? '#fff' : COLORS.textMuted,
                fontSize: 9, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              }}>
                {item.badge}
              </span>
            )}
            {variant === 'underline' && isActive && (
              <div style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, borderRadius: '2px 2px 0 0', background: accent, boxShadow: `0 0 8px ${accent}88` }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
