/**
 * ShareImportSheet.jsx — landing flow for text shared into AuthNo.
 *
 * Step 1: pick a book (or "New book").
 * Step 2 (existing book with chapters): pick a chapter to append to, or
 *         "Paste as new chapter".
 *
 * Bottom sheet on Android, centered card on desktop — same conventions as
 * the burger menu / threads sheets. All theming via CSS vars.
 */

import { useState } from 'react';
import { DSIcons, CloseButton } from '../DesignSystem';
import { isAndroid } from '../utils/platform';

function Row({ icon: Icon, title, subtitle, accent, onClick, accentHex }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-sm)',
        background: accent ? `${accentHex}14` : 'var(--surface)',
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: accent ? `${accentHex}26` : 'var(--surface-md)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} color={accent ? accentHex : 'var(--text-3)'} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: accent ? accentHex : 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        {subtitle && (
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </span>
        )}
      </span>
      <DSIcons.ChevronRight size={15} color="var(--text-5)" />
    </button>
  );
}

export default function ShareImportSheet({ text, subject, sessions, accentHex, onClose, onImport }) {
  const [book, setBook] = useState(null); // null = book-picker step
  const android = isAndroid();

  const books = [...(sessions || [])]
    .filter((s) => s.type !== 'storyboard')
    .sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));

  const preview = (text || '').trim().slice(0, 120);
  const wordCount = (text || '').trim().split(/\s+/).filter(Boolean).length;

  const chapters = book ? [...(book.chapters || [])].sort((a, b) => a.order - b.order) : [];

  const shell = {
    position: 'fixed', inset: 0, zIndex: 2600,
    display: 'flex', alignItems: android ? 'flex-end' : 'center', justifyContent: 'center',
    background: 'var(--scrim, rgba(0,0,0,0.5))',
  };
  const sheet = {
    background: 'var(--modal-bg)', border: '1px solid var(--border)',
    borderRadius: android ? '16px 16px 0 0' : 16,
    width: android ? '100%' : 'min(440px, 92vw)',
    maxHeight: android ? '72dvh' : '70vh',
    display: 'flex', flexDirection: 'column',
    paddingBottom: android ? 'env(safe-area-inset-bottom)' : 0,
  };

  return (
    <div style={shell} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border-sm)' }}>
          {book && (
            <button onClick={() => setBook(null)} aria-label="Back" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--surface)', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <DSIcons.ChevronLeft size={16} />
            </button>
          )}
          <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {book ? book.title || 'Untitled Book' : 'Add to AuthNo'}
          </span>
          <CloseButton onClick={onClose} />
        </div>

        {/* Shared-text preview */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-sm)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-4)', fontStyle: 'italic', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            “{preview}{(text || '').trim().length > 120 ? '…' : ''}”
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-5)', marginTop: 4 }}>
            {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}{subject ? ` · ${subject}` : ''}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!book ? (
            <>
              <Row
                icon={DSIcons.FilePlus} accent accentHex={accentHex}
                title="New book"
                subtitle={subject ? `“${subject}”` : 'Start a fresh book from this text'}
                onClick={() => onImport({ mode: 'new-book' })}
              />
              {books.map((b) => (
                <Row
                  key={b.id}
                  icon={DSIcons.BookOpen} accentHex={accentHex}
                  title={b.title || 'Untitled Book'}
                  subtitle={`${(b.chapters || []).length || 1} ${(b.chapters || []).length === 1 ? 'chapter' : 'chapters'}`}
                  onClick={() => {
                    // Books with chapters get the chapter step; a book with
                    // none (legacy flat session) takes the text directly.
                    if ((b.chapters || []).length >= 1) setBook(b);
                    else onImport({ mode: 'append', bookId: b.id, chapIdx: 1 });
                  }}
                />
              ))}
            </>
          ) : (
            <>
              <Row
                icon={DSIcons.FilePlus} accent accentHex={accentHex}
                title="Paste as new chapter"
                subtitle={subject ? `“${subject}”` : 'Adds a chapter at the end'}
                onClick={() => onImport({ mode: 'new-chapter', bookId: book.id })}
              />
              {chapters.map((c) => (
                <Row
                  key={c.chap_idx}
                  icon={DSIcons.Text} accentHex={accentHex}
                  title={c.title || `Chapter ${c.chap_idx}`}
                  subtitle="Append to the end of this chapter"
                  onClick={() => onImport({ mode: 'append', bookId: book.id, chapIdx: c.chap_idx })}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
