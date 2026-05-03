/**
 * Overlays.jsx — Modal, BottomSheet, Tooltip
 *
 * Exports: FrostedModal, BottomSheet, Tooltip
 */

import { useState, useEffect, useRef } from 'react';
import { COLORS, TYPOGRAPHY, RADIUS, SHADOWS } from './tokens';

// ══════════════════════════════════════════════════════════════════════════════
// FrostedModal — full-screen overlay with frosted glass panel
// ══════════════════════════════════════════════════════════════════════════════

/**
 * FrostedModal — full-screen overlay with frosted glass panel.
 *
 * Props:
 *   isOpen, onClose, title, accentHex, maxWidth, noPad, style
 */
export function FrostedModal({ isOpen, onClose, title, accentHex, maxWidth = '480px', noPad = false, style = {}, children }) {
  const accent = accentHex ?? COLORS.violet;

  useEffect(() => {
    if (!isOpen) return;
    const fn = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        animation: 'dsFadeIn 0.15s ease',
      }}
    >
      <style>{`@keyframes dsFadeIn{from{opacity:0}to{opacity:1}} @keyframes dsPanelIn{from{opacity:0;transform:scale(0.96) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
      <div style={{
        width: '90vw', maxWidth,
        backdropFilter: 'blur(24px) saturate(1.6)', WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
        background: 'rgba(20,20,26,0.82)',
        border: `1px solid ${accent}33`, borderRadius: 24,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.05) inset, ${SHADOWS.panel}, ${SHADOWS.glow(accent)}`,
        animation: 'dsPanelIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        overflow: 'hidden', ...style,
      }}>
        {/* Accent stripe */}
        <div style={{ height: 3, background: `linear-gradient(to right, transparent, ${accent}, transparent)` }} />
        {/* Header */}
        {title && (
          <div style={{ padding: '18px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.base, color: accent, letterSpacing: TYPOGRAPHY.tracking.pixel }}>
              {title}
            </span>
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(255,255,255,0.07)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: COLORS.textMuted, fontSize: 18, lineHeight: 1, transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = COLORS.textMuted; }}
              aria-label="Close"
            >×</button>
          </div>
        )}
        <div style={noPad ? {} : { padding: title ? '20px 24px 28px' : '28px 24px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BottomSheet — slides up from bottom, draggable to dismiss
// ══════════════════════════════════════════════════════════════════════════════

/**
 * BottomSheet — mobile-first modal that slides up from the bottom.
 * Drag the handle down > 100px to dismiss.
 *
 * Props: isOpen, onClose, title, accentHex, maxWidth, style
 */
export function BottomSheet({ isOpen, onClose, title, accentHex, maxWidth = '540px', style = {}, children }) {
  const accent = accentHex ?? COLORS.violet;
  const sheetRef = useRef(null);
  const dragRef  = useRef({ startY: 0, dy: 0, dragging: false });
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!isOpen) { setDragY(0); return; }
    const fn = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const onPointerDown = (e) => { dragRef.current = { startY: e.clientY, dy: 0, dragging: true }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onPointerMove = (e) => { if (!dragRef.current.dragging) return; const dy = Math.max(0, e.clientY - dragRef.current.startY); dragRef.current.dy = dy; setDragY(dy); };
  const onPointerUp = () => { if (dragRef.current.dy > 100) onClose?.(); else setDragY(0); dragRef.current.dragging = false; };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'rgba(0,0,0,0.68)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        animation: 'dsFadeIn 0.15s ease',
      }}
    >
      <style>{`@keyframes dsSheetIn{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      <div
        ref={sheetRef}
        style={{
          width: '100%', maxWidth, maxHeight: '88vh', overflowY: 'auto',
          backdropFilter: 'blur(24px) saturate(1.5)', WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
          background: 'rgba(22,22,28,0.96)',
          borderTop: `1px solid ${accent}33`,
          borderLeft: `1px solid ${COLORS.border}`, borderRight: `1px solid ${COLORS.border}`,
          borderRadius: `${RADIUS.xl}px ${RADIUS.xl}px 0 0`,
          boxShadow: `0 -12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset`,
          animation: dragY === 0 ? 'dsSheetIn 0.28s cubic-bezier(0.32,0.72,0,1)' : undefined,
          transform: `translateY(${dragY}px)`,
          transition: dragRef.current.dragging ? 'none' : 'transform 0.28s cubic-bezier(0.32,0.72,0,1)',
          willChange: 'transform', ...style,
        }}
      >
        <div
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 8px', cursor: 'grab', touchAction: 'none' }}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: COLORS.surface4 }} />
        </div>
        {title && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 14px' }}>
            <span style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.sm, color: accent, letterSpacing: TYPOGRAPHY.tracking.pixel }}>{title}</span>
            <button
              onClick={onClose}
              style={{ width: 28, height: 28, borderRadius: '50%', background: COLORS.surface3, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: COLORS.textMuted, fontSize: 16, transition: 'background 0.15s, color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = COLORS.surface4; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = COLORS.surface3; e.currentTarget.style.color = COLORS.textMuted; }}
            >×</button>
          </div>
        )}
        <div style={{ padding: title ? '0 20px 32px' : '8px 20px 32px' }}>{children}</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tooltip — hover tooltip, pure CSS position
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tooltip — wraps children and shows a label on hover.
 *
 * Props:
 *   content     string | ReactNode
 *   placement   'top' | 'bottom' | 'left' | 'right'
 *   delay       ms before appearing (default 400)
 *   accentHex   string
 *   style       object (wrapper div)
 */
export function Tooltip({ content, placement = 'top', delay = 400, accentHex, style = {}, children }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  const show = () => { timerRef.current = setTimeout(() => setVisible(true), delay); };
  const hide = () => { clearTimeout(timerRef.current); setVisible(false); };

  const offsets = {
    top:    { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
    bottom: { top:    'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
    left:   { right:  'calc(100% + 8px)', top:  '50%', transform: 'translateY(-50%)' },
    right:  { left:   'calc(100% + 8px)', top:  '50%', transform: 'translateY(-50%)' },
  }[placement] ?? { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' };

  return (
    <div onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      {children}
      {visible && (
        <div style={{
          position: 'absolute', zIndex: 500, whiteSpace: 'nowrap', maxWidth: 220,
          padding: '6px 12px', borderRadius: RADIUS.sm,
          background: COLORS.surface2,
          border: `1px solid ${accentHex ? `${accentHex}44` : COLORS.border}`,
          boxShadow: `0 8px 24px rgba(0,0,0,0.5)`,
          fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm,
          color: COLORS.textSecondary, lineHeight: 1.4,
          pointerEvents: 'none', animation: 'dsFadeIn 0.12s ease',
          ...offsets,
        }}>
          {content}
        </div>
      )}
    </div>
  );
}
