/**
 * Controls.jsx — Chips, Badges, Selectors, Color Swatches
 *
 * Exports: Chip, Badge, ProBadge, OptionSelector, ColorSwatchRow
 */

import { COLORS, TYPOGRAPHY, RADIUS } from './tokens';

// ── Chip ──────────────────────────────────────────────────────────────────────

/**
 * Chip — inline tag/filter pill.
 * Props: variant 'default'|'active'|'success'|'warning'|'danger', icon, accentHex, onClick
 */
export function Chip({ variant = 'default', icon, accentHex, children, onClick, style = {} }) {
  const accent = accentHex ?? COLORS.violet;
  const variants = {
    default: { bg: 'rgba(255,255,255,0.06)', border: COLORS.border,         color: COLORS.textMuted  },
    active:  { bg: `${accent}22`,            border: `${accent}55`,         color: accent             },
    success: { bg: `${COLORS.success}1a`,    border: `${COLORS.success}55`, color: COLORS.success    },
    warning: { bg: `${COLORS.warning}1a`,    border: `${COLORS.warning}55`, color: COLORS.warning    },
    danger:  { bg: `${COLORS.danger}1a`,     border: `${COLORS.danger}55`,  color: COLORS.danger     },
  };
  const v = variants[variant] ?? variants.default;

  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: RADIUS.full,
        background: v.bg, border: `1px solid ${v.border}`, color: v.color,
        fontSize: TYPOGRAPHY.pixelSize.xs, fontFamily: TYPOGRAPHY.pixel,
        letterSpacing: TYPOGRAPHY.tracking.pixel,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'filter 0.15s', userSelect: 'none', lineHeight: 1.8, ...style,
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.filter = 'brightness(1.15)')}
      onMouseLeave={e => onClick && (e.currentTarget.style.filter = 'brightness(1)')}
    >
      {icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </span>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

/**
 * Badge — compact uppercase label.
 * Props: variant 'pro'|'beta'|'new'|'danger'|'success'|'warning', icon, accentHex
 */
export function Badge({ variant = 'pro', icon, accentHex, children, style = {} }) {
  const accent = accentHex ?? COLORS.violet;
  const variants = {
    pro:     { bg: `${accent}22`,            color: accent          },
    beta:    { bg: `${COLORS.sky}1a`,        color: COLORS.sky      },
    new:     { bg: `${COLORS.success}1a`,    color: COLORS.success  },
    danger:  { bg: `${COLORS.danger}1a`,     color: COLORS.danger   },
    success: { bg: `${COLORS.success}22`,    color: COLORS.success  },
    warning: { bg: `${COLORS.warning}1a`,    color: COLORS.warning  },
  };
  const v = variants[variant] ?? variants.pro;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 9px', borderRadius: RADIUS.full,
      background: v.bg, color: v.color,
      fontSize: TYPOGRAPHY.pixelSize.xs, fontFamily: TYPOGRAPHY.pixel,
      letterSpacing: TYPOGRAPHY.tracking.pixel, lineHeight: 1.8, userSelect: 'none', ...style,
    }}>
      {icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </span>
  );
}

/** ProBadge — convenience ★ Pro badge. */
export function ProBadge({ accentHex, style = {} }) {
  return (
    <Badge variant="pro" accentHex={accentHex} style={style}
      icon={<svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>}
    >Pro</Badge>
  );
}

// ── OptionSelector ────────────────────────────────────────────────────────────

/**
 * OptionSelector — circular radio indicator.
 * Unselected: dim ring. Selected: solid accent fill + checkmark.
 *
 * Props: selected bool, onChange fn(bool), accentHex, size number (default 28)
 */
export function OptionSelector({ selected = false, onChange, accentHex, size = 28, style = {} }) {
  const accent = accentHex ?? COLORS.violet;
  return (
    <button
      onClick={() => onChange?.(!selected)}
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        border: selected ? 'none' : `2px solid ${COLORS.surface4}`,
        background: selected ? `linear-gradient(135deg, ${accent}, ${accent}cc)` : 'transparent',
        boxShadow: selected ? `0 0 10px ${accent}55` : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        transition: 'all 0.18s cubic-bezier(0.34,1.56,0.64,1)',
        transform: selected ? 'scale(1.05)' : 'scale(1)', ...style,
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

// ── ColorSwatchRow ────────────────────────────────────────────────────────────

/**
 * ColorSwatchRow — horizontal row of tappable color swatches.
 *
 * Props:
 *   colors   Array<{ label, value } | string>
 *   selected string (hex)
 *   onChange fn(hex)
 *   size     number  swatch diameter px (default 28)
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
            key={hex} title={label} onClick={() => onChange?.(hex)}
            style={{
              width: size, height: size, borderRadius: '50%', background: hex, border: 'none', cursor: 'pointer',
              boxShadow: isSelected ? `0 0 0 2px #fff, 0 0 0 4px ${hex}` : `0 2px 6px rgba(0,0,0,0.4)`,
              transform: isSelected ? 'scale(1.15)' : 'scale(1)',
              transition: 'transform 0.15s, box-shadow 0.15s', flexShrink: 0,
            }}
          />
        );
      })}
    </div>
  );
}
