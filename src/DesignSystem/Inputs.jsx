/**
 * Inputs.jsx — Text input variants
 *
 * Exports: PixelInput, TextInput
 */

import { useState } from 'react';
import { COLORS, TYPOGRAPHY, RADIUS } from './tokens';
import { pixelClip } from './_utils';

/**
 * PixelInput — pixel-bordered text input with chamfered corners.
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
  const sz = {
    sm: { font: 8,  pad: '8px 12px',  corner: 8  },
    md: { font: 9,  pad: '11px 14px', corner: 10 },
    lg: { font: 10, pad: '13px 18px', corner: 12 },
  }[size] ?? { font: 9, pad: '11px 14px', corner: 10 };
  const clip = pixelClip(sz.corner);

  return (
    <div style={{ width: '100%', ...style }}>
      {label && (
        <div style={{
          fontFamily: TYPOGRAPHY.pixel, fontSize: 8, color: COLORS.textSubtle,
          letterSpacing: TYPOGRAPHY.tracking.pixel, marginBottom: 8,
          textTransform: 'uppercase',
        }}>
          {label}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center',
        clipPath: clip,
        background: focused ? `${accent}44` : COLORS.surface3,
        padding: 2, transition: 'background 0.15s',
      }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          background: COLORS.surface2, clipPath: clip, padding: sz.pad,
        }}>
          {icon && (
            <span style={{ color: focused ? accent : COLORS.textDisabled, display: 'flex', transition: 'color 0.15s' }}>
              {icon}
            </span>
          )}
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
              color: COLORS.textPrimary, letterSpacing: TYPOGRAPHY.tracking.pixel,
              cursor: disabled ? 'not-allowed' : 'text', opacity: disabled ? 0.5 : 1,
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
        <div style={{
          fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm,
          fontWeight: TYPOGRAPHY.weight.semibold, color: COLORS.textMuted,
          marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px',
        }}>
          {label}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: COLORS.surface3, borderRadius: RADIUS.md,
        border: `1px solid ${focused ? `${accent}88` : error ? COLORS.danger : COLORS.border}`,
        boxShadow: focused ? `0 0 0 3px ${accent}22` : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}>
        {icon && (
          <span style={{ color: focused ? accent : COLORS.textDisabled, display: 'flex', transition: 'color 0.15s' }}>
            {icon}
          </span>
        )}
        <input
          type={type} value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder} disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.base,
            color: COLORS.textPrimary, cursor: disabled ? 'not-allowed' : 'text',
            opacity: disabled ? 0.5 : 1,
          }}
          {...rest}
        />
      </div>
      {(hint || error) && (
        <div style={{ marginTop: 5, fontSize: TYPOGRAPHY.size.sm, color: error ? COLORS.danger : COLORS.textSubtle }}>
          {error ?? hint}
        </div>
      )}
    </div>
  );
}
