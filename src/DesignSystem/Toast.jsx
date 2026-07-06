/**
 * Toast.jsx — Imperative toast / snackbar notifications
 *
 * Exports: useToast, ToastContainer
 *
 * Usage:
 *   // Mount once at app root:
 *   <ToastContainer />
 *
 *   // Fire from any component:
 *   const toast = useToast();
 *   toast('Saved!', { variant: 'success' });
 *   toast('Failed to sync.', { variant: 'danger' });
 */

import { useState, useEffect, useCallback } from 'react';
import { COLORS, TYPOGRAPHY, RADIUS } from './tokens';

// Global event bus — no external dep
const _toastListeners = new Set();
export function _emitToast(item) { _toastListeners.forEach(fn => fn(item)); }

/**
 * toast() — module-level imperative fire, for code that runs outside React
 * (installers, native event handlers). Requires <ToastContainer /> at root.
 */
export function toast(message, opts = {}) {
  _emitToast({
    id: Date.now() + Math.random(),
    message,
    variant: opts.variant ?? 'default',
    duration: opts.duration ?? 3200,
    icon: opts.icon ?? null,
  });
}

/** useToast — returns an imperative toast() function. Requires <ToastContainer /> at root. */
export function useToast() {
  return useCallback((message, opts = {}) => {
    _emitToast({
      id: Date.now() + Math.random(),
      message,
      variant: opts.variant ?? 'default',
      duration: opts.duration ?? 3200,
      icon: opts.icon ?? null,
    });
  }, []);
}

const TOAST_ACCENT = {
  default: { color: COLORS.violet,  icon: null },
  success: { color: COLORS.success, icon: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
  danger:  { color: COLORS.danger,  icon: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> },
  warning: { color: COLORS.warning, icon: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
  info:    { color: COLORS.sky,     icon: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> },
};

function ToastItem({ item, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const acc = TOAST_ACCENT[item.variant] ?? TOAST_ACCENT.default;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(item.id), 350);
    }, item.duration);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      onClick={() => { setVisible(false); setTimeout(() => onDismiss(item.id), 350); }}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderRadius: RADIUS.md,
        backdropFilter: 'blur(20px) saturate(1.5)', WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
        background: 'rgba(26,27,30,0.92)',
        border: `1px solid ${acc.color}44`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset`,
        cursor: 'pointer', userSelect: 'none', maxWidth: 340, width: '100%',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)',
        transition: 'opacity 300ms cubic-bezier(0.4,0,0.2,1), transform 300ms cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      {/* Accent side stripe */}
      <div style={{ position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 3, borderRadius: 2, background: acc.color }} />
      {/* Icon */}
      {(item.icon ?? acc.icon) && (
        <span style={{ color: acc.color, display: 'flex', flexShrink: 0, marginLeft: 4 }}>
          {item.icon ?? acc.icon}
        </span>
      )}
      {/* Message */}
      <span style={{
        fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs,
        color: COLORS.textPrimary, flex: 1, lineHeight: 1.9, letterSpacing: TYPOGRAPHY.tracking.pixel,
      }}>
        {item.message}
      </span>
    </div>
  );
}

/**
 * ToastContainer — mount once in your app root.
 *
 * Props:
 *   position  'bottom-right' | 'bottom-center' | 'top-right' | 'top-center'
 */
export function ToastContainer({ position = 'bottom-right' }) {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const fn = (item) => setToasts(prev => [...prev, item]);
    _toastListeners.add(fn);
    return () => _toastListeners.delete(fn);
  }, []);

  const dismiss = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  const posStyle = {
    'bottom-right':  { bottom: 24, right: 24, alignItems: 'flex-end' },
    'bottom-center': { bottom: 24, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' },
    'top-right':     { top: 24, right: 24, alignItems: 'flex-end' },
    'top-center':    { top: 24, left: '50%', transform: 'translateX(-50%)', alignItems: 'center' },
  }[position] ?? { bottom: 24, right: 24, alignItems: 'flex-end' };

  return (
    <div style={{ position: 'fixed', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none', ...posStyle }}>
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: 'all', position: 'relative' }}>
          <ToastItem item={t} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}
