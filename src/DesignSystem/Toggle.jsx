/**
 * Toggle.jsx — Animated on/off switch
 *
 * BUG FIX: now accepts BOTH `on` and `checked` props so it works
 * whether called as <Toggle on={v} /> or <Toggle checked={v} />.
 * `on` takes priority; `checked` is the fallback alias.
 *
 * Exports: Toggle
 */

import { COLORS, TYPOGRAPHY } from './tokens';

/**
 * Toggle — animated on/off switch.
 *
 * Props:
 *   on          bool   primary prop
 *   checked     bool   alias for `on` (backward compat)
 *   onChange    fn(bool)
 *   accentHex   string   colour when on (default COLORS.violet)
 *   offColor    string   track colour when off (default COLORS.surface4)
 *   size        'sm' | 'md' | 'lg'
 *   disabled    bool
 *   label       string   shown to the right
 */
export function Toggle({
  on,
  checked,
  onChange,
  accentHex,
  offColor,
  size = 'md',
  disabled = false,
  label,
  style = {},
}) {
  // Accept either prop name — `on` wins if both are provided
  const isOn   = on !== undefined ? !!on : !!checked;
  const accent  = accentHex ?? COLORS.violet;
  const trackOff = offColor ?? COLORS.surface4;

  const sizes = {
    sm: { track: [36, 20], thumb: 14, travel: 16 },
    md: { track: [46, 26], thumb: 18, travel: 20 },
    lg: { track: [56, 32], thumb: 24, travel: 24 },
  };
  const s = sizes[size] ?? sizes.md;

  return (
    <label
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        ...style,
      }}
    >
      <div
        onClick={() => !disabled && onChange?.(!isOn)}
        style={{
          width: s.track[0], height: s.track[1],
          borderRadius: s.track[1] / 2,
          padding: (s.track[1] - s.thumb) / 2,
          background: isOn
            ? `linear-gradient(135deg, ${accent}, ${accent}cc)`
            : trackOff,
          boxShadow: isOn
            ? `0 0 12px ${accent}66`
            : 'inset 0 2px 4px rgba(0,0,0,0.4)',
          transition: 'background 220ms cubic-bezier(0.4,0,0.2,1), box-shadow 220ms',
          display: 'flex', alignItems: 'center', flexShrink: 0,
        }}
      >
        <div
          style={{
            width: s.thumb, height: s.thumb, borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
            transform: isOn ? `translateX(${s.travel}px)` : 'translateX(0)',
            transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      </div>
      {label && (
        <span
          style={{
            fontFamily: TYPOGRAPHY.sans,
            fontSize: TYPOGRAPHY.size.base,
            color: COLORS.textSecondary,
          }}
        >
          {label}
        </span>
      )}
    </label>
  );
}
