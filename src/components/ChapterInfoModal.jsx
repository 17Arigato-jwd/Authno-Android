/**
 * ChapterInfoModal.jsx — "Chapter info" (B9), opened from the in-book burger
 * menu. Word/character/sentence/paragraph counts and estimated reading time
 * for the open chapter, plus whole-book totals.
 */

import { useMemo } from 'react';
import { DSIcons, CloseButton } from '../DesignSystem';
import { textStats, formatReadingTime } from '../utils/editorFormat';

function StatRow({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '9px 2px', borderBottom: '1px solid var(--border-sm)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

export default function ChapterInfoModal({ session, chapterIdx, onClose, accentHex = '#5a00d9' }) {
  const chapter = (session?.chapters || []).find(c => c.chap_idx === chapterIdx) || null;

  const chapStats = useMemo(() => textStats(chapter?.content || ''), [chapter?.content]);
  const bookStats = useMemo(() => {
    const all = (session?.chapters || []).map(c => textStats(c.content || ''));
    return all.reduce((acc, s) => ({
      words: acc.words + s.words,
      charsWithSpaces: acc.charsWithSpaces + s.charsWithSpaces,
      charsNoSpaces: acc.charsNoSpaces + s.charsNoSpaces,
      sentences: acc.sentences + s.sentences,
      paragraphs: acc.paragraphs + s.paragraphs,
      readingMins: acc.readingMins + s.readingMins,
    }), { words: 0, charsWithSpaces: 0, charsNoSpaces: 0, sentences: 0, paragraphs: 0, readingMins: 0 });
  }, [session?.chapters]);

  const n = (v) => v.toLocaleString();

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--modal-overlay-bg, rgba(0,0,0,0.6))', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 'min(92vw, 400px)', maxHeight: '84vh', overflowY: 'auto',
        background: 'var(--modal-bg)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '18px 20px', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${accentHex}18`, border: `1px solid ${accentHex}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accentHex, flexShrink: 0 }}>
            <DSIcons.Info size={16} color="currentColor" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {chapter?.title || 'Chapter info'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{session?.title || 'Untitled Book'}</div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {chapter && (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: accentHex, textTransform: 'uppercase', letterSpacing: '0.7px', margin: '4px 0 2px' }}>This chapter</div>
            <StatRow label="Words" value={n(chapStats.words)} />
            <StatRow label="Characters" value={n(chapStats.charsWithSpaces)} />
            <StatRow label="Characters (no spaces)" value={n(chapStats.charsNoSpaces)} />
            <StatRow label="Sentences" value={n(chapStats.sentences)} />
            <StatRow label="Paragraphs" value={n(chapStats.paragraphs)} />
            <StatRow label="Reading time" value={formatReadingTime(chapStats.readingMins)} />
          </>
        )}

        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.7px', margin: '16px 0 2px' }}>
          Whole book · {(session?.chapters || []).length} chapter{(session?.chapters || []).length === 1 ? '' : 's'}
        </div>
        <StatRow label="Words" value={n(bookStats.words)} />
        <StatRow label="Characters" value={n(bookStats.charsWithSpaces)} />
        <StatRow label="Sentences" value={n(bookStats.sentences)} />
        <StatRow label="Reading time" value={formatReadingTime(bookStats.readingMins)} />
      </div>
    </div>
  );
}
