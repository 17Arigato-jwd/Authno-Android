/**
 * FontSelector.jsx — editor font picker.
 *
 * Fed from the Font Customizer's library (curated Google/system families) plus
 * the user's uploaded custom fonts — one font system for app AND manuscript.
 * Each family is an <optgroup> whose options are its weight variants
 * (Regular / Medium / SemiBold / Bold …), per the author's grouping request.
 * Selecting a variant applies font-family + font-weight to the selection,
 * undo-safely, and lazy-loads the Google Fonts CSS on first use.
 */

import React from 'react';
import {
  FONT_LIBRARY, fontVariants, resolveFontStack, loadGoogleFont,
} from '../utils/fontManager';

const SELECT_STYLE = {
  background: 'transparent',
  border: `1px solid var(--toolbar-divider)`,
  color: 'var(--toolbar-item)',
  fontSize: 13,
  padding: '4px 8px',
  borderRadius: 6,
  outline: 'none',
  cursor: 'pointer',
  maxWidth: 150,
};

const OPT_STYLE = { background: 'var(--modal-bg)', color: 'var(--text-1)' };

export function FontSelector({ onApply, customFonts = [] }) {
  const handleChange = (e) => {
    if (!e.target.value) return;
    const { kind, id, weight } = JSON.parse(e.target.value);
    if (kind === 'lib') loadGoogleFont(id);
    const stack = resolveFontStack(id, customFonts);
    onApply?.({ fontFamily: stack, fontWeight: weight ?? 400 });
    e.target.value = '';        // let the same variant be re-picked later
  };

  return (
    <select defaultValue="" onChange={handleChange} style={SELECT_STYLE} title="Font family & weight"
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--toolbar-item)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--toolbar-divider)'}
    >
      <option value="" disabled style={OPT_STYLE}>Font…</option>

      {FONT_LIBRARY.map(f => {
        const variants = fontVariants(f);
        return variants.length > 1 ? (
          <optgroup key={f.id} label={f.label} style={OPT_STYLE}>
            {variants.map(v => (
              <option key={v.weight} style={OPT_STYLE}
                value={JSON.stringify({ kind: 'lib', id: f.id, weight: v.weight })}>
                {f.label} {v.label}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={f.id} style={OPT_STYLE}
            value={JSON.stringify({ kind: 'lib', id: f.id, weight: variants[0]?.weight ?? 400 })}>
            {f.label}
          </option>
        );
      })}

      {customFonts.length > 0 && (
        <optgroup label="Your fonts" style={OPT_STYLE}>
          {customFonts.map(f => (
            <option key={f.id} style={OPT_STYLE}
              value={JSON.stringify({ kind: 'custom', id: f.id, weight: 400 })}>
              {f.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export default FontSelector;
