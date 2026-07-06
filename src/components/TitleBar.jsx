/**
 * TitleBar.jsx — themed custom window title bar (Electron desktop only)
 *
 * The app used to sit under the raw OS title bar, which made it read as "a
 * website in a window". This is a frameless, draggable title bar whose colours
 * follow the active theme, with real minimise / maximise / close controls wired
 * to the main process (see main.js window-* IPC + Preload windowControls).
 *
 * Renders nothing on Android or in the plain web build.
 */

import { useEffect, useState } from 'react';
import { isElectron } from '../utils/platform';
import Logo from '../logo.svg';

const wc = () => (typeof window !== 'undefined' ? window.electron?.windowControls : null);

function ControlButton({ onClick, label, hoverBg, hoverColor, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 46, height: '100%', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hover ? (hoverBg ?? 'var(--surface-md)') : 'transparent',
        color: hover && hoverColor ? hoverColor : 'var(--text-3)',
        transition: 'background 0.12s, color 0.12s',
        WebkitAppRegion: 'no-drag',
      }}
    >
      {children}
    </button>
  );
}

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const controls = wc();
    if (!controls) return;
    let dispose;
    controls.isMaximized?.().then((v) => setMaximized(!!v)).catch(() => {});
    if (controls.onMaximizeChange) dispose = controls.onMaximizeChange((v) => setMaximized(!!v));
    return () => { if (typeof dispose === 'function') dispose(); };
  }, []);

  if (!isElectron()) return null;

  const controls = wc();

  return (
    <div
      className="authno-titlebar"
      style={{
        height: 'var(--titlebar-h, 36px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--nav-bg)',
        borderBottom: '1px solid var(--border)',
        color: 'var(--text-2)',
        userSelect: 'none', WebkitUserSelect: 'none',
        flexShrink: 0, position: 'relative', zIndex: 5000,
      }}
    >
      {/* Left: app identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', minWidth: 0 }}>
        <img src={Logo} alt="" style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          AuthNo
        </span>
      </div>

      {/* Right: window controls */}
      <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
        <ControlButton label="Minimise" onClick={() => controls?.minimize?.()}>
          <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="5" width="9" height="1.2" fill="currentColor" /></svg>
        </ControlButton>
        <ControlButton label={maximized ? 'Restore' : 'Maximise'} onClick={() => controls?.toggleMaximize?.()}>
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1">
              <rect x="1.5" y="3" width="6" height="6" /><path d="M3 3V1.5h6.5V8H8" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1">
              <rect x="1.5" y="1.5" width="8" height="8" />
            </svg>
          )}
        </ControlButton>
        <ControlButton label="Close" onClick={() => controls?.close?.()} hoverBg="#e81123" hoverColor="#fff">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" />
          </svg>
        </ControlButton>
      </div>
    </div>
  );
}
