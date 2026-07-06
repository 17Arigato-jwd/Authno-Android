/**
 * FontSelector.jsx — Font family picker for the editor toolbar
 * SizeSelector.jsx  — Font size picker for the editor toolbar
 *
 * Both live in this file for brevity (they're tiny).
 * Tailwind `className` removed; pure inline styles referencing COLORS from tokens.
 */

import React from 'react';
import { FONT_OPTIONS } from './constants';

const SELECT_STYLE = {
  background: 'transparent',
  border: `1px solid var(--toolbar-divider)`,
  color: 'var(--toolbar-item)',
  fontSize: 13,
  padding: '4px 8px',
  borderRadius: 6,
  outline: 'none',
  cursor: 'pointer',
  transition: 'border-color 0.15s',
};

export function FontSelector({ onChange, defaultValue }) {
  return (
    <select
      defaultValue={defaultValue}
      onChange={onChange}
      style={SELECT_STYLE}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--toolbar-item)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--toolbar-divider)'}
    >
      {FONT_OPTIONS.map(font => (
        <option key={font.value} value={font.value} style={{ background: 'var(--modal-bg)', color: 'var(--text-1)' }}>
          {font.label}
        </option>
      ))}
    </select>
  );
}

// Default export for backward compat with existing imports
export default FontSelector;
