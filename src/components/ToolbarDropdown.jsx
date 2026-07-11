/**
 * ToolbarDropdown.jsx — shared shell for the toolbar's Font / Size pickers.
 *
 * Replaces the native <select>s, which Chromium rendered as an in-window list
 * that ran straight off the bottom of the screen. This panel:
 *   • is portaled + fixed-positioned (survives the toolbar's scroll row),
 *   • clamps to a max height with its own scrollbar,
 *   • flips above the trigger when there isn't room below,
 *   • scrolls the current item into view on open.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAX_H = 320;

export default function ToolbarDropdown({ label, title, minWidth = 0, children, open, setOpen }) {
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(200, r.width);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      if (below >= Math.min(MAX_H, 180) || below >= above) {
        setPos({ left, top: r.bottom + 6, maxHeight: Math.min(MAX_H, below), width });
      } else {
        setPos({ left, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(MAX_H, above), width });
      }
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  // Bring the highlighted row into view once the panel is placed.
  useEffect(() => {
    if (!open || !pos) return;
    const el = panelRef.current?.querySelector('[data-current="true"]');
    el?.scrollIntoView({ block: 'center' });
  }, [open, pos]);

  return (
    <>
      <button
        ref={btnRef}
        title={title}
        onMouseDown={(e) => e.preventDefault()}   // keep the editor selection
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'transparent', border: '1px solid var(--toolbar-divider)',
          color: 'var(--toolbar-item)', fontSize: 13, padding: '4px 8px',
          borderRadius: 6, cursor: 'pointer', flexShrink: 0,
          maxWidth: 150, minWidth, whiteSpace: 'nowrap', overflow: 'hidden',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--toolbar-item)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--toolbar-divider)'; }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.6 }}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && pos && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onMouseDown={() => setOpen(false)} />
          <div
            ref={panelRef}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'fixed', zIndex: 61,
              left: pos.left, top: pos.top, bottom: pos.bottom,
              width: pos.width, maxHeight: pos.maxHeight, overflowY: 'auto',
              background: 'var(--modal-bg)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 6,
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            }}
          >
            {children}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

/** One row in the dropdown list. */
export function DropdownRow({ current, indent = false, onClick, children }) {
  return (
    <button
      data-current={current ? 'true' : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: indent ? '6px 10px 6px 22px' : '6px 10px',
        borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13,
        background: current ? 'var(--accent-a18)' : 'transparent',
        color: current ? 'var(--accent)' : 'var(--text-2)',
      }}
      onMouseEnter={(e) => { if (!current) e.currentTarget.style.background = 'var(--surface)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = current ? 'var(--accent-a18)' : 'transparent'; }}
    >
      {children}
    </button>
  );
}

/** Non-clickable family header. */
export function DropdownHeader({ children }) {
  return (
    <div style={{ padding: '7px 10px 3px', fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {children}
    </div>
  );
}
