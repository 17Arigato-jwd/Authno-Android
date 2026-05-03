/**
 * Sliders.jsx — Pill-shaped gradient sliders
 *
 * Exports: PillSlider, DualPillSlider
 */

import { COLORS, GRADIENTS, TYPOGRAPHY, SHADOWS } from './tokens';
import { ensureSliderCSS } from './_utils';

/**
 * PillSlider — single-thumb pill-shaped slider.
 *
 * Props:
 *   min, max, step   number
 *   value            number
 *   onChange         fn(number)
 *   gradient         string   CSS gradient for filled portion (default violet)
 *   accentHex        string   fallback accent for thumb ring
 *   height           number   track height in px (default 36)
 *   showValue        bool     shows current value label above
 *   formatValue      fn(v)    custom label formatter
 */
export function PillSlider({
  min = 0, max = 100, step = 1,
  value, onChange,
  gradient, accentHex,
  height = 36,
  showValue = false,
  formatValue,
  style = {},
}) {
  ensureSliderCSS();
  const accent = accentHex ?? COLORS.violet;
  const fillGradient = gradient ?? GRADIENTS.sliderViolet;
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div style={{ width: '100%', ...style }}>
      {showValue && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end', marginBottom: 6,
          fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.sm,
          color: COLORS.textMuted, fontVariantNumeric: 'tabular-nums',
        }}>
          {formatValue ? formatValue(value) : value}
        </div>
      )}
      <div style={{
        position: 'relative', height,
        borderRadius: height / 2,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: `inset 0 2px 6px rgba(0,0,0,0.4), ${SHADOWS.glow(accent)}`,
      }}>
        {/* Clipped fill + sheen */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: height / 2, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${pct}%`, background: fillGradient,
            borderRadius: height / 2, transition: 'width 0.05s', minWidth: height,
          }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(255,255,255,0.1) 0%, transparent 55%)' }} />
        </div>
        <input
          type="range"
          className="ds-pill-slider"
          min={min} max={max} step={step}
          value={value}
          onChange={e => onChange?.(Number(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, zIndex: 2 }}
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
 *   gradient            string
 *   accentHex           string
 *   height              number (default 36)
 */
export function DualPillSlider({
  min = 0, max = 100, step = 1,
  valueMin, valueMax,
  onChangeMin, onChangeMax,
  gradient, accentHex,
  height = 36,
  style = {},
}) {
  ensureSliderCSS();
  const accent = accentHex ?? COLORS.violet;
  const fillGradient = gradient ?? GRADIENTS.sliderViolet;
  const pMin = ((valueMin - min) / (max - min)) * 100;
  const pMax = ((valueMax - min) / (max - min)) * 100;

  return (
    <div style={{ width: '100%', ...style }}>
      <div style={{
        position: 'relative', height,
        borderRadius: height / 2,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: `inset 0 2px 6px rgba(0,0,0,0.4), ${SHADOWS.glow(accent)}`,
      }}>
        {/* Clipped range fill + sheen */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: height / 2, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${pMin}%`, width: `${pMax - pMin}%`,
            background: fillGradient, borderRadius: height / 2,
            transition: 'left 0.04s, width 0.04s',
          }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(255,255,255,0.1) 0%, transparent 55%)' }} />
        </div>
        <input
          type="range" className="ds-dual-slider"
          min={min} max={max} step={step} value={valueMin}
          onChange={e => onChangeMin?.(Math.min(Number(e.target.value), valueMax - step))}
          style={{ height }}
        />
        <input
          type="range" className="ds-dual-slider"
          min={min} max={max} step={step} value={valueMax}
          onChange={e => onChangeMax?.(Math.max(Number(e.target.value), valueMin + step))}
          style={{ height }}
        />
      </div>
    </div>
  );
}
