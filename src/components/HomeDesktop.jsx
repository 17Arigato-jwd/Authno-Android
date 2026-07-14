/**
 * HomeDesktop.jsx — the desktop-grade home screen (v1.1.17-beta.3 PC layout).
 *
 * Direction (author MCQ): a writer's dashboard first (Notion-home / Scrivener
 * feel) blended with a library cover grid (Apple Books) and quick hover
 * actions. Desktop-dense: 13–14px type, compact paddings, hover states,
 * right-click context menus on books.
 *
 * Layout:
 *   ┌ header (Welcome back · burger) ───────────────────────────┐
 *   │ [ Continue-writing hero ············ ] [ stats panel ]    │
 *   │ [ action row: New · Open · Import · Read aloud · Ext ]    │
 *   │ Library — responsive cover grid, hover lift + ⋯ menu      │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Mobile keeps HomeScreen.jsx untouched — App.js picks per platform.
 */

import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { DSIcons, toast } from '../DesignSystem';
import { useError } from '../utils/ErrorContext';
import { htmlToText } from '../utils/editorFormat';
import { isSpeechSupported } from '../utils/readAloud';
import { V, staggerContainer, PRESS, HOVER_LIFT, useMotionEnabled } from '../utils/motion';
import { CountUp } from './Motion';
import ContextMenu from './ContextMenu';
import Logo from '../logo.svg';

function words(html) {
  const t = htmlToText(html || '').trim();
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

const card = {
  background: 'var(--sidebar-card-bg)', border: '1px solid var(--border)',
  borderRadius: 14, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
};

export default function HomeDesktop({
  sessions = [], accentHex, onNewBook, onSelect, onDelete,
  onToggleMenu, burgerBtnRef,
  resumeInfo, onResume, onReadAloud, onOpenSettings,
}) {
  const { showError } = useError();
  const motionOK = useMotionEnabled();
  const importInputRef = useRef(null);
  const [ctx, setCtx] = useState(null); // { x, y, book }

  const stats = useMemo(() => {
    let chapters = 0, totalWords = 0;
    for (const s of sessions) {
      const chs = s.chapters || [];
      chapters += chs.length;
      for (const c of chs) totalWords += words(c.content);
    }
    return { books: sessions.length, chapters, totalWords };
  }, [sessions]);

  const recent = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0)),
    [sessions]
  );

  const openExisting = async () => {
    try {
      const { openBook } = await import('../utils/storage');
      const session = await openBook();
      if (session) onSelect(session.id, session);
    } catch (err) { showError('openBook', err); }
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { convertFileToBook, bookToNewSession, ImportError } = await import('../utils/bookImport');
      try {
        const converted = await convertFileToBook(file);
        const session = bookToNewSession(converted);
        onSelect(session.id, session);
        toast(`Imported "${session.title}" (${session.chapters.length} ${session.chapters.length === 1 ? 'chapter' : 'chapters'})`, { variant: 'success' });
      } catch (err) {
        if (err instanceof ImportError) toast(err.message, { variant: 'danger', duration: 6000 });
        else throw err;
      }
    } catch (err) { showError('importBook', err); }
  };

  const actionBtn = (icon, label, onClick, primary = false) => (
    <motion.button
      key={label}
      onClick={onClick}
      whileTap={motionOK ? PRESS : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '8px 14px', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600,
        background: primary ? accentHex : 'var(--surface)',
        border: primary ? 'none' : '1px solid var(--border)',
        color: primary ? '#fff' : 'var(--text-2)',
      }}
    >
      {icon}{label}
    </motion.button>
  );

  const stat = (Icon, value, label, format) => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-a18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={15} color={accentHex} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.15 }}>
          <CountUp value={value} format={format} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-5)', fontWeight: 500 }}>{label}</div>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, minWidth: 0, height: '100%', overflowY: 'auto', position: 'relative', zIndex: 1 }}>
      <input ref={importInputRef} type="file" style={{ display: 'none' }}
        accept=".txt,.md,.markdown,.html,.htm,.rtf,.doc,.docx,.odt,.epub,.pdf" onChange={importFile} />

      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 22px', borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 10, background: 'var(--app-bg)',
      }}>
        <span style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700 }}>Welcome back</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-5)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', userSelect: 'none' }}
            title="Quick switcher">Ctrl K</span>
          <button ref={burgerBtnRef} onClick={onToggleMenu}
            style={{ padding: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'var(--text-1)', display: 'flex' }}>
            <DSIcons.MoreVertical size={18} color="var(--text-1)" />
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '20px 22px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Hero row: continue-writing + stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(230px, 1fr)', gap: 14 }}>
          {/* Continue writing hero */}
          <motion.button
            onClick={resumeInfo ? onResume : onNewBook}
            whileTap={motionOK ? PRESS : undefined}
            whileHover={motionOK ? { scale: 1.005 } : undefined}
            style={{
              ...card, textAlign: 'left', cursor: 'pointer', padding: '22px 24px',
              display: 'flex', alignItems: 'center', gap: 18,
              background: `linear-gradient(120deg, var(--accent-a18), transparent 60%), var(--sidebar-card-bg)`,
            }}
          >
            <span style={{ width: 46, height: 46, borderRadius: 12, background: accentHex, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 8px 22px ${accentHex}44` }}>
              {resumeInfo ? <DSIcons.Flame size={22} color="#fff" /> : <DSIcons.FilePlus size={22} color="#fff" />}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', color: accentHex, textTransform: 'uppercase', marginBottom: 4 }}>
                {resumeInfo ? 'Continue writing' : 'Start writing'}
              </span>
              <span style={{ display: 'block', fontSize: 19, fontWeight: 800, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {resumeInfo ? resumeInfo.title : 'Create your first book'}
              </span>
              {resumeInfo?.chapter && (
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-4)', marginTop: 3 }}>{resumeInfo.chapter}</span>
              )}
            </span>
            <DSIcons.ChevronRight size={18} style={{ marginLeft: 'auto', color: 'var(--text-4)', flexShrink: 0 }} />
          </motion.button>

          {/* Stats panel */}
          <div style={{ ...card, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 6 }}>
            {stat(DSIcons.Book, stats.books, stats.books === 1 ? 'Book' : 'Books')}
            <div style={{ height: 1, background: 'var(--border-sm)', margin: '0 12px' }} />
            {stat(DSIcons.BookOpen, stats.chapters, 'Chapters')}
            <div style={{ height: 1, background: 'var(--border-sm)', margin: '0 12px' }} />
            {stat(DSIcons.Text, stats.totalWords, 'Words written', (n) => n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n))}
          </div>
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {actionBtn(<DSIcons.FilePlus size={14} color="#fff" />, 'New book', onNewBook, true)}
          {actionBtn(<DSIcons.FolderOpen size={14} />, 'Open…', openExisting)}
          {actionBtn(<DSIcons.Download size={14} />, 'Import a book', () => importInputRef.current?.click())}
          {isSpeechSupported() && actionBtn(<DSIcons.Volume size={14} />, 'Read aloud', onReadAloud)}
          {actionBtn(<DSIcons.Settings size={14} />, 'Settings', onOpenSettings)}
        </div>

        {/* Library grid */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '6px 2px 10px' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-1)' }}>Library</h2>
            <span style={{ fontSize: 12, color: 'var(--text-5)' }}>{recent.length} {recent.length === 1 ? 'book' : 'books'}</span>
          </div>

          {recent.length === 0 ? (
            <div style={{ ...card, padding: '38px 20px', textAlign: 'center', color: 'var(--text-4)', fontSize: 13.5 }}>
              Your shelf is empty — create or import a book to get started.
            </div>
          ) : (
            <motion.div
              variants={staggerContainer(recent.length)} initial="hidden" animate="show"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))', gap: 12 }}
            >
              {recent.map((book) => (
                <motion.div
                  key={book.id}
                  variants={V.fadeRise}
                  whileHover={motionOK ? HOVER_LIFT : undefined}
                  whileTap={motionOK ? PRESS : undefined}
                  onClick={() => onSelect(book.id)}
                  onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, book }); }}
                  style={{ ...card, cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                >
                  <div style={{ aspectRatio: '3 / 4', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border-sm)' }}>
                    {book.coverBase64 ? (
                      <img src={`data:${book.coverMime || 'image/jpeg'};base64,${book.coverBase64}`} alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <img src={Logo} alt="" style={{ width: 40, height: 40, opacity: 0.75 }} />
                    )}
                  </div>
                  <div style={{ padding: '9px 11px 11px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {book.title || 'Untitled Book'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-5)', marginTop: 3 }}>
                      {(book.chapters || []).length} ch{book.filePath ? ' · saved' : ''}
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* Right-click menu on books */}
      <ContextMenu
        pos={ctx}
        onClose={() => setCtx(null)}
        items={ctx && [
          { label: 'Open', icon: <DSIcons.BookOpen size={14} />, onClick: () => onSelect(ctx.book.id) },
          onDelete && { label: 'Remove from list', icon: <DSIcons.Trash size={14} />, danger: true, onClick: () => onDelete(ctx.book.id) },
        ]}
      />
    </div>
  );
}
