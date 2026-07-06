/**
 * ReadAloudBar.jsx — floating playback controls for Read Aloud (U2).
 *
 * Renders a compact bar with play/pause, prev/next chapter, a rate control,
 * and chapter progress. Driven by a BookReader instance.
 */

import { useEffect, useState, useRef } from 'react';
import { BookReader, isSpeechSupported, loadVoices } from '../utils/readAloud';
import { DSIcons } from '../DesignSystem';

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export default function ReadAloudBar({ session, accentHex = '#5a00d9', onClose }) {
  const readerRef = useRef(null);
  const [state, setState] = useState({ playing: false, paused: false, index: 0, total: 0, chapterIndex: null, rate: 1 });
  const [supported] = useState(isSpeechSupported());

  useEffect(() => {
    if (!supported) return;
    const reader = new BookReader();
    readerRef.current = reader;
    const off = reader.on(setState);
    loadVoices();
    reader.load(session);
    // Auto-start playback when opened.
    reader.play();
    return () => { off(); reader.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload if the book changes while open.
  useEffect(() => {
    const reader = readerRef.current;
    if (reader && session) { reader.load(session); reader.play(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  if (!supported) {
    return (
      <Bar accentHex={accentHex}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Read Aloud isn’t supported on this device.</span>
        <IconBtn onClick={onClose} label="Close"><DSIcons.X size={18} color="currentColor" /></IconBtn>
      </Bar>
    );
  }

  const reader = readerRef.current;
  const chapters = [...(session?.chapters || [])].sort((a, b) => a.order - b.order);
  const currentTitle = state.chapterIndex != null ? (chapters[state.chapterIndex]?.title ?? `Chapter ${state.chapterIndex + 1}`) : '';
  const pct = state.total ? Math.round((state.index / state.total) * 100) : 0;

  const cycleRate = () => {
    const i = RATES.indexOf(state.rate);
    reader?.setRate(RATES[(i + 1) % RATES.length]);
  };

  return (
    <Bar accentHex={accentHex}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconBtn onClick={() => reader?.prev()} label="Previous chapter"><DSIcons.ChevronLeft size={20} color="currentColor" /></IconBtn>
        <button
          onClick={() => (state.playing ? reader?.pause() : reader?.play())}
          aria-label={state.playing ? 'Pause' : 'Play'}
          style={{
            width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: accentHex, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 4px 14px ${accentHex}66`,
          }}
        >
          {state.playing
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>}
        </button>
        <IconBtn onClick={() => reader?.next()} label="Next chapter"><DSIcons.ChevronRight size={20} color="currentColor" /></IconBtn>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {currentTitle || 'Read Aloud'}
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'var(--surface-md)', marginTop: 6, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: accentHex, transition: 'width 300ms ease' }} />
        </div>
      </div>

      <button
        onClick={cycleRate}
        style={{
          padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
        }}
        aria-label="Playback speed"
      >
        {state.rate}×
      </button>
      <IconBtn onClick={onClose} label="Stop reading"><DSIcons.X size={18} color="currentColor" /></IconBtn>
    </Bar>
  );
}

function Bar({ children, accentHex }) {
  return (
    <div style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)',
      bottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
      width: 'min(560px, 94vw)', zIndex: 2500,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px', borderRadius: 16,
      background: 'var(--modal-bg)', border: '1px solid var(--border)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
      backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
    }}>
      {children}
    </div>
  );
}

function IconBtn({ onClick, children, label }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {children}
    </button>
  );
}
