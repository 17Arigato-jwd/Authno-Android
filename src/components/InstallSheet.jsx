/**
 * InstallSheet.jsx — animated install / update UI for .extbk and .thmbk (C1/U5).
 *
 * Mounts once at app root. Subscribes to the installEvents bus and renders a
 * frosted bottom sheet that slides up, walks through the install stages with a
 * progress bar, and morphs into a success check (or an error state). Handles
 * the "installing vs updating" distinction via fromVersion.
 *
 * This is the first consumer of the DesignSystem ProgressBar — previously the
 * whole install pipeline had no UI at all.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { subscribeInstall } from '../utils/installEvents';
import { ProgressBar } from '../DesignSystem';

const STAGE_LABEL = {
  validating: 'Checking file…',
  decoding:   'Reading contents…',
  writing:    'Installing files…',
  activating: 'Activating…',
  done:       'Done',
  error:      'Failed',
};

// Coarse progress per stage so the bar always moves even before file-count
// granular progress is available.
const STAGE_BASE = { validating: 0.08, decoding: 0.22, writing: 0.4, activating: 0.92, done: 1, error: 1 };

function CheckIcon({ color }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function CrossIcon({ color }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function BoxIcon({ color }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

export default function InstallSheet({ accentHex = '#5a00d9' }) {
  const [evt, setEvt] = useState(null);   // latest event for the active session
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // drives slide animation
  const hideTimer = useRef(null);
  const activeId = useRef(null);

  useEffect(() => {
    return subscribeInstall((e) => {
      // Track a single active session; a fresh validating event starts a new one.
      if (e.stage === 'validating' || activeId.current === null) activeId.current = e.id;
      if (e.id !== activeId.current) return;

      setEvt(e);
      setOpen(true);
      requestAnimationFrame(() => setShown(true));

      clearTimeout(hideTimer.current);
      if (e.stage === 'done' || e.stage === 'error') {
        hideTimer.current = setTimeout(() => {
          setShown(false);
          setTimeout(() => { setOpen(false); activeId.current = null; }, 340);
        }, e.stage === 'done' ? 1600 : 4200);
      }
    });
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(hideTimer.current);
    setShown(false);
    setTimeout(() => { setOpen(false); activeId.current = null; }, 340);
  }, []);

  if (!open || !evt) return null;

  const isError   = evt.stage === 'error';
  const isDone    = evt.stage === 'done';
  const isUpdate  = !!evt.fromVersion && evt.fromVersion !== evt.version;
  const kindLabel = evt.kind === 'theme' ? 'theme' : 'extension';

  const progress = evt.stage === 'writing' && typeof evt.progress === 'number'
    ? 0.4 + evt.progress * 0.5
    : (STAGE_BASE[evt.stage] ?? 0.1);

  const statusColor = isError ? 'var(--color-danger)' : isDone ? 'var(--color-success)' : accentHex;

  const title = isError
    ? `Couldn't install ${kindLabel}`
    : isDone
      ? (isUpdate ? `Updated ${evt.name ?? kindLabel}` : `Installed ${evt.name ?? kindLabel}`)
      : (isUpdate ? `Updating ${evt.name ?? kindLabel}…` : `Installing ${evt.name ?? kindLabel}…`);

  const subtitle = isError
    ? (evt.error ?? 'Unknown error')
    : isUpdate && evt.version
      ? `v${evt.fromVersion} → v${evt.version}`
      : evt.version ? `v${evt.version}` : STAGE_LABEL[evt.stage];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        pointerEvents: shown ? 'auto' : 'none',
        background: shown ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0)',
        transition: 'background 320ms ease',
      }}
      onClick={isDone || isError ? dismiss : undefined}
    >
      <div
        role="status"
        aria-live="polite"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 94vw)',
          margin: '0 0 max(16px, env(safe-area-inset-bottom, 0px))',
          background: 'var(--modal-bg)',
          border: '1px solid var(--modal-panel-border, var(--border))',
          borderRadius: 20,
          boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          padding: '20px 20px 22px',
          transform: shown ? 'translateY(0)' : 'translateY(120%)',
          opacity: shown ? 1 : 0,
          transition: 'transform 360ms cubic-bezier(0.16,1,0.3,1), opacity 300ms ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 48, height: 48, flexShrink: 0, borderRadius: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isError ? 'var(--color-danger-bg)' : isDone ? 'var(--color-success-bg)' : `${accentHex}18`,
            border: `1px solid ${isError ? 'var(--color-danger)' : isDone ? 'var(--color-success)' : accentHex}44`,
            transition: 'all 300ms ease',
          }}>
            {isError ? <CrossIcon color="var(--color-danger)" />
              : isDone ? <CheckIcon color="var(--color-success)" />
              : <BoxIcon color={accentHex} />}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
          </div>
        </div>

        {!isError && (
          <div style={{ marginTop: 16 }}>
            <ProgressBar value={progress} accentHex={statusColor} height={7} animated={!isDone} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{STAGE_LABEL[evt.stage]}</span>
              {evt.stage === 'writing' && evt.fileCount ? (
                <span style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{evt.filesWritten}/{evt.fileCount}</span>
              ) : null}
            </div>
          </div>
        )}

        {(isDone || isError) && (
          <button
            onClick={dismiss}
            style={{
              marginTop: 16, width: '100%', padding: '10px 0', borderRadius: 12,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-2)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {isError ? 'Dismiss' : 'Done'}
          </button>
        )}
      </div>
    </div>
  );
}
