/**
 * ContextMenu.jsx — lightweight right-click menu (desktop refinement, Q4-B).
 *
 * Controlled: the parent captures onContextMenu, stores {x, y} and renders
 *   <ContextMenu pos={pos} items={items} onClose={...} />
 * items: [{ label, icon?, danger?, disabled?, onClick }] — null/false entries
 * are skipped so callers can build lists conditionally.
 *
 * Portal + fixed positioning, clamped to the viewport, scale-fade entrance,
 * closes on outside pointer-down / Esc / scroll.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { T } from '../utils/motion';

const MENU_W = 190;

export default function ContextMenu({ pos, items = [], onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!pos) return undefined;
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose?.(); };
    const key = (e) => { if (e.key === 'Escape') onClose?.(); };
    const scroll = () => onClose?.();
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', scroll, { capture: true });
    };
  }, [pos, onClose]);

  if (!pos) return null;
  const list = items.filter(Boolean);
  if (!list.length) return null;

  const left = Math.min(pos.x, window.innerWidth - MENU_W - 8);
  const estH = list.length * 34 + 12;
  const top = Math.min(pos.y, window.innerHeight - estH - 8);

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={T.fast}
      style={{
        position: 'fixed', left, top, zIndex: 10000, width: MENU_W,
        background: 'var(--modal-bg)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 5, boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        transformOrigin: 'top left',
      }}
    >
      {list.map((item, i) => (
        <button
          key={i}
          disabled={item.disabled}
          onClick={() => { onClose?.(); item.onClick?.(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 9, width: '100%',
            padding: '7px 10px', borderRadius: 7, border: 'none', textAlign: 'left',
            background: 'transparent', fontSize: 13, cursor: item.disabled ? 'default' : 'pointer',
            color: item.disabled ? 'var(--text-5)' : item.danger ? '#e5484d' : 'var(--text-2)',
            opacity: item.disabled ? 0.5 : 1,
          }}
          onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = item.danger ? 'rgba(224,60,60,0.12)' : 'var(--surface)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {item.icon && <span style={{ display: 'inline-flex', width: 16, justifyContent: 'center', flexShrink: 0 }}>{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </motion.div>,
    document.body
  );
}
