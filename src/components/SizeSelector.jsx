/**
 * SizeSelector.jsx — editor font-size control (Google Docs / Word style).
 *
 *   [ − ] [ 16.0 ▾ ] [ + ]
 *
 * The centre is an editable numeric field (accepts one decimal place); the
 * −/+ buttons step it; the ▾ opens a dropdown of common sizes. The field
 * shows the size at the caret. Applied as inline px so it joins the editor's
 * undo stack via the shared onApply path.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const PX_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];

const MIN = 1;
const MAX = 400;
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n) => Math.min(MAX, Math.max(MIN, n));

export default function SizeSelector({ onApply, editorRef }) {
  const [value, setValue] = useState(16);     // committed size at caret
  const [draft, setDraft] = useState('16');   // what's shown in the input
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);

  // Reflect the caret's font size.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const root = editorRef?.current;
        const sel = window.getSelection();
        const node = sel?.anchorNode;
        if (!root || !node || !root.contains(node)) return;
        const el = node.nodeType === 3 ? node.parentElement : node;
        if (!el) return;
        const px = round1(parseFloat(getComputedStyle(el).fontSize));
        if (px > 0) { setValue(px); setDraft(String(px)); }
      });
    };
    document.addEventListener('selectionchange', update);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('selectionchange', update); };
  }, [editorRef]);

  const apply = (px) => {
    const v = clamp(round1(px));
    setValue(v); setDraft(String(v));
    onApply?.({ fontSize: `${v}px` });
  };

  const commitDraft = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n)) apply(n);
    else setDraft(String(value));
  };

  const openDropdown = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 16;
    const maxH = Math.min(300, Math.max(150, below));
    setPos({ left: r.left, top: r.bottom + 6, width: Math.max(72, r.width), maxHeight: maxH, flip: below < 150 && r.top > below, bottom: window.innerHeight - r.top + 6 });
    setOpen(true);
  };

  const btn = {
    width: 24, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid var(--toolbar-divider)', background: 'transparent', color: 'var(--toolbar-item)',
    cursor: 'pointer', flexShrink: 0, fontSize: 15, lineHeight: 1, padding: 0,
  };

  return (
    <div ref={wrapRef} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }} title="Font size">
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => apply(value - 1)} style={{ ...btn, borderRadius: '6px 0 0 6px' }} aria-label="Decrease font size">−</button>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitDraft(); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); apply(value + 1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); apply(value - 1); }
        }}
        inputMode="decimal"
        style={{
          width: 40, height: 28, textAlign: 'center', border: '1px solid var(--toolbar-divider)',
          borderLeft: 'none', borderRight: 'none', background: 'transparent', color: 'var(--toolbar-item)',
          fontSize: 13, outline: 'none', padding: 0,
        }}
      />
      <button onMouseDown={(e) => e.preventDefault()} onClick={openDropdown} style={{ ...btn, width: 20, borderLeft: 'none' }} aria-label="Choose common size">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => apply(value + 1)} style={{ ...btn, borderRadius: '0 6px 6px 0', borderLeft: 'none' }} aria-label="Increase font size">+</button>

      {open && pos && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onMouseDown={() => setOpen(false)} />
          <div onMouseDown={(e) => e.preventDefault()} style={{
            position: 'fixed', zIndex: 61, left: pos.left, width: pos.width,
            ...(pos.flip ? { bottom: pos.bottom } : { top: pos.top }),
            maxHeight: pos.maxHeight, overflowY: 'auto',
            background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 6,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          }}>
            {PX_SIZES.map((s) => (
              <button key={s} onMouseDown={(e) => e.preventDefault()} onClick={() => { apply(s); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 7,
                  border: 'none', cursor: 'pointer', fontSize: 13,
                  background: Math.round(value) === s ? 'var(--accent-a18)' : 'transparent',
                  color: Math.round(value) === s ? 'var(--accent)' : 'var(--text-2)',
                }}
                onMouseEnter={(e) => { if (Math.round(value) !== s) e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = Math.round(value) === s ? 'var(--accent-a18)' : 'transparent'; }}
              >
                {s}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
