/**
 * FontCustomizer.jsx — per-target font picker (Appearance → Fonts)
 *
 * Mirrors the Gradient Customizer: opens as a themed modal, lets the user choose
 * a font for each target (Body / Editor / Headings), preview it live, and upload
 * their own font file (.ttf/.otf/.woff/.woff2) which is embedded offline.
 *
 * Fully theme-aware — every colour comes from CSS vars, so it looks right on all
 * five built-in themes and any installed .thmbk theme.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { DSIcons, CloseButton } from '../DesignSystem';
import {
  FONT_LIBRARY, DEFAULT_FONTS, resolveFontStack, loadGoogleFont, readCustomFontFile,
} from '../utils/fontManager';

const TARGETS = [
  { id: 'body',    label: 'Interface',  hint: 'Buttons, menus, labels — the whole app UI', sample: 'The quick brown fox jumps over the lazy dog.' },
  { id: 'editor',  label: 'Editor',     hint: 'Your writing canvas',                        sample: 'It was a bright cold day in April, and the clocks were striking thirteen.' },
  { id: 'heading', label: 'Headings',   hint: 'Titles and section headers',                 sample: 'Chapter One' },
];

const CATEGORY_LABEL = { sans: 'Sans-serif', serif: 'Serif', mono: 'Monospace', display: 'Display' };

function FontOption({ font, selected, onSelect, accentHex, previewStack }) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        width: '100%', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
        textAlign: 'left',
        background: selected ? `${accentHex}18` : 'var(--surface)',
        border: `1px solid ${selected ? accentHex + '66' : 'var(--border)'}`,
        transition: 'all 0.12s',
      }}
    >
      <span style={{ fontFamily: previewStack, fontSize: 15, color: selected ? accentHex : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {font.label}
      </span>
      {selected && (
        <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', background: accentHex, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <DSIcons.Check size={10} color="#fff" />
        </span>
      )}
    </button>
  );
}

function FontTargetPanel({ target, fonts, onChange, accentHex }) {
  const custom = fonts.custom || [];
  const selectedId = fonts[target.id] ?? DEFAULT_FONTS[target.id];
  const previewStack = resolveFontStack(selectedId, custom);

  const byCat = FONT_LIBRARY.reduce((acc, f) => { (acc[f.category] ??= []).push(f); return acc; }, {});
  const cats = ['sans', 'serif', 'mono', 'display'].filter(c => byCat[c]);

  const select = (id) => { loadGoogleFont(id); onChange({ [target.id]: id }); };

  return (
    <div>
      {/* Live preview */}
      <div style={{
        padding: '18px 16px', borderRadius: 12, marginBottom: 18,
        background: 'var(--editor-bg)', border: '1px solid var(--border)',
      }}>
        <div style={{ fontFamily: previewStack, fontSize: target.id === 'heading' ? 26 : 16, fontWeight: target.id === 'heading' ? 700 : 400, color: 'var(--text-1)', lineHeight: 1.5 }}>
          {target.sample}
        </div>
      </div>

      {cats.map(cat => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
            {CATEGORY_LABEL[cat]}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
            {byCat[cat].map(f => (
              <FontOption key={f.id} font={f} selected={selectedId === f.id}
                onSelect={() => select(f.id)} accentHex={accentHex}
                previewStack={f.stack} />
            ))}
          </div>
        </div>
      ))}

      {custom.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
            Your Fonts
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
            {custom.map(f => (
              <FontOption key={f.id} font={{ label: f.name }} selected={selectedId === f.id || selectedId === f.name}
                onSelect={() => onChange({ [target.id]: f.id })} accentHex={accentHex}
                previewStack={resolveFontStack(f.id, custom)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function FontCustomizer({ isOpen, onClose, fonts = DEFAULT_FONTS, onSave, accentHex = '#5a00d9' }) {
  const [active, setActive] = useState('body');
  const [uploadErr, setUploadErr] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  const change = useCallback((patch) => {
    onSave?.({ ...DEFAULT_FONTS, ...fonts, ...patch });
  }, [fonts, onSave]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadErr(null);
    try {
      const entry = await readCustomFontFile(file);
      const custom = [...(fonts.custom || []).filter(f => f.name !== entry.name), entry];
      change({ custom, [active]: entry.id });   // apply to current target immediately
    } catch (err) {
      setUploadErr(err.message || 'Could not read that font file.');
    }
  };

  const resetDefaults = () => onSave?.({ ...DEFAULT_FONTS, custom: fonts.custom || [] });

  if (!isOpen) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--modal-overlay-bg, rgba(0,0,0,0.8))', backdropFilter: 'blur(8px)', animation: 'fcFadeIn 0.15s ease' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`
        @keyframes fcFadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fcPanelIn { from { opacity: 0; transform: scale(0.97) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>

      <div style={{
        width: '92vw', maxWidth: 780, height: '82vh', maxHeight: 680,
        display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden',
        background: 'var(--modal-bg)', border: '1px solid var(--border)',
        boxShadow: `0 32px 80px rgba(0,0,0,0.6), 0 0 80px ${accentHex}18`,
        animation: 'fcPanelIn 0.2s ease',
      }}>
        {/* Sticky header — stays put while the font grid scrolls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'var(--nav-bg)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <DSIcons.Text size={18} color={accentHex} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Fonts</div>
              <div style={{ fontSize: 12, color: 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Pick a font for each part of the app, or upload your own.</div>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* Target tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px', background: 'var(--nav-bg)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {TARGETS.map(t => {
            const on = active === t.id;
            return (
              <button key={t.id} onClick={() => setActive(t.id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: on ? `${accentHex}22` : 'transparent', borderBottom: on ? `2px solid ${accentHex}` : '2px solid transparent' }}>
                <span style={{ fontSize: 13, fontWeight: on ? 700 : 500, color: on ? 'var(--text-1)' : 'var(--text-4)' }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 8px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 16 }}>
            {TARGETS.find(t => t.id === active)?.hint}
          </div>
          {TARGETS.map(t => active === t.id && (
            <FontTargetPanel key={t.id} target={t} fonts={{ ...DEFAULT_FONTS, ...fonts }} onChange={change} accentHex={accentHex} />
          ))}
          {uploadErr && (
            <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 8 }}>{uploadErr}</div>
          )}
        </div>

        {/* Sticky footer actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 20px', background: 'var(--nav-bg)', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={resetDefaults}
            style={{ fontSize: 12.5, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
            Reset to defaults
          </button>
          <div>
            <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleUpload} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: `1px solid ${accentHex}55`, background: `${accentHex}18`, color: accentHex, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <DSIcons.Upload size={14} color="currentColor" /> Upload a font
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FontCustomizer;
