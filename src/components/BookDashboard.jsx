/**
 * BookDashboard.jsx
 * Per-book homescreen hub — opened whenever a book is created or selected.
 * Visual design: manga/novel reader-style info card + scrollable chapter list.
 *
 * Props:
 *   session          — current book session object
 *   accentHex        — theme accent colour string
 *   onBack()         — navigate back to HomeScreen
 *   onEditChapter(chapIdx) — open a chapter in the editor
 *   onNewChapter()   — create a new chapter and open it
 *   onUpdateSession(updates) — merge metadata changes into App.js sessions
 *   onDeleteChapter(chapIdx) — delete a chapter by index
 *   onMoveChapter(chapIdx, direction) — reorder (+1 down, -1 up)
 *   onOpenMetadata() — open the MetadataEditor panel (future)
 *   onToggleMenu     — burger menu toggle
 *   burgerBtnRef     — ref for burger button positioning
 *   onToggleSidebar  — left drawer toggle
 *   goalWords        — daily word goal
 *   onStreakUpdate   — streak callback
 *   streakEnabled    — bool
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  ArrowLeft, Upload, Edit3, Plus, Search, ChevronDown, ChevronUp,
  ArrowUp, SlidersHorizontal, BookOpen, Settings2, Image as ImageIcon,
  BarChart2, FileText, X, Menu,
} from 'lucide-react';
import { FlameButton } from './Streak';
import { FlameIcon, BookIcon, WordsIcon, GlobeIcon } from './GradientIcons';

// ─── MIME normaliser ──────────────────────────────────────────────────────────
// Some Android gallery/file-picker implementations return an empty file.type for
// JPEG images (and occasionally other formats). Fall back to extension detection
// so the data-URL src is never "data:;base64,…" which renders as a black box.
function normaliseMime(file) {
  if (file.type) return file.type;
  const ext = (file.name || '').split('.').pop().toLowerCase();
  const MAP = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',  gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp',
    heic: 'image/heic', heif: 'image/heif',
    avif: 'image/avif',
  };
  return MAP[ext] || 'image/jpeg';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date)) return '';
  const secs = Math.floor((Date.now() - date) / 1000);
  if (secs < 60)      return 'just now';
  if (secs < 3600)    return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)   return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 172800)  return 'yesterday';
  if (secs < 604800)  return `${Math.floor(secs / 86400)} days ago`;
  if (secs < 1209600) return 'last week';
  if (secs < 2592000) return `${Math.floor(secs / 604800)} weeks ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(html) {
  const t = stripHtml(html);
  return t ? t.split(' ').length : 0;
}

function formatWords(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function currentStreakDays(streak) {
  if (!streak?.log) return 0;
  let count = 0;
  const d = new Date();
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (!streak.log[key]) break;
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

// ─── Light-mode detector ──────────────────────────────────────────────────────
function useLightMode() {
  const [light, setLight] = useState(() => document.querySelector('.light-mode') !== null);
  useEffect(() => {
    const obs = new MutationObserver(
      () => setLight(document.querySelector('.light-mode') !== null)
    );
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return light;
}

// ─── ExportPanel (inline sub-panel) ──────────────────────────────────────────
function ExportPanel({ session, accentHex, onClose, onExportTxt, onExportHtml, onExportEpub, light }) {
  const glass = {
    background: light ? 'rgba(255,255,255,0.8)' : 'rgba(20,20,28,0.95)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: `1px solid ${light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: '20px',
  };

  const formats = [
    { icon: <WordsIcon size={26} />, label: 'Plain Text (.txt)', sub: 'Raw text, no formatting', action: onExportTxt, ready: true },
    { icon: <GlobeIcon size={26} />, label: 'HTML (.html)',       sub: 'Styled web document',     action: onExportHtml, ready: true },
    { icon: <BookIcon  size={26} />, label: 'ePub (.epub)',        sub: 'Standard e-book format',  action: onExportEpub, ready: true },
    { icon: <BookIcon  size={26} />, label: 'PDF (.pdf)',          sub: 'Coming soon',             action: null,         ready: false },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.55)', display: 'flex',
      alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{ ...glass, width: '100%', maxWidth: '480px', padding: '24px', marginBottom: '0', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--text-1)' }}>Export Options</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px' }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {formats.map((f, i) => (
            <button key={i} onClick={f.ready ? f.action : undefined}
              disabled={!f.ready}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '14px 16px', borderRadius: '14px', cursor: f.ready ? 'pointer' : 'default',
                background: light ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)'}`,
                textAlign: 'left', opacity: f.ready ? 1 : 0.45,
                transition: 'background 0.12s',
              }}>
              <span style={{ width: '30px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{f.icon}</span>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-1)' }}>{f.label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-4)', marginTop: '2px' }}>{f.sub}</div>
              </div>
            </button>
          ))}
        </div>
        <div style={{ height: 'env(safe-area-inset-bottom, 16px)' }} />
      </div>
    </div>
  );
}

// ─── MetadataPanel (inline sub-panel) ────────────────────────────────────────
function MetadataPanel({ session, accentHex, onClose, onSave, light }) {
  const [form, setForm] = useState({
    title:       session?.title       || '',
    description: session?.description || '',
    genre:       session?.genre       || '',
    language:    session?.language    || 'en',
    authors:     (session?.authors || []).map(a => a.name).join(', '),
    publisher:   session?.publisher   || '',
    isbn:        session?.isbn        || '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    onSave({
      title:       form.title,
      description: form.description,
      genre:       form.genre,
      language:    form.language,
      publisher:   form.publisher,
      isbn:        form.isbn,
      authors:     form.authors
        ? form.authors.split(',').map(s => ({ name: s.trim() })).filter(a => a.name)
        : session?.authors || [],
    });
    onClose();
  };

  const field = (label, key, opts = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </label>
      {opts.multiline ? (
        <textarea
          rows={4}
          value={form[key]}
          onChange={e => set(key, e.target.value)}
          style={{
            background: light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '10px', padding: '10px 12px',
            color: 'var(--text-1)', fontSize: '14px', resize: 'vertical',
            outline: 'none', fontFamily: 'inherit',
          }}
          placeholder={opts.placeholder || ''}
        />
      ) : (
        <input
          value={form[key]}
          onChange={e => set(key, e.target.value)}
          placeholder={opts.placeholder || ''}
          style={{
            background: light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '10px', padding: '10px 12px',
            color: 'var(--text-1)', fontSize: '14px',
            outline: 'none',
          }}
        />
      )}
    </div>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.55)',
      overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '24px',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: '480px',
        background: light ? '#f5f5f0' : '#1a1a22',
        borderRadius: '20px', padding: '24px',
        margin: '0 0 40px',
        border: `1px solid ${light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)'}`,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--text-1)' }}>Book Metadata</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px' }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {field('Title',       'title',       { placeholder: 'Untitled Book' })}
          {field('Author(s)',   'authors',     { placeholder: 'Comma-separated names' })}
          {field('Description', 'description', { multiline: true, placeholder: 'A short blurb about the book…' })}
          {field('Genre',       'genre',       { placeholder: 'e.g. Fantasy, Romance, Sci-Fi' })}
          {field('Language',    'language',    { placeholder: 'en' })}
          {field('Publisher',   'publisher',   { placeholder: 'Self-published' })}
          {field('ISBN',        'isbn',        { placeholder: 'Optional' })}
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '13px', borderRadius: '12px', cursor: 'pointer',
            background: 'none',
            border: `1px solid ${light ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
            color: 'var(--text-3)', fontSize: '14px', fontWeight: 600,
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            flex: 2, padding: '13px', borderRadius: '12px', cursor: 'pointer',
            background: accentHex, border: 'none',
            color: '#fff', fontSize: '14px', fontWeight: 700,
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── CoverPicker ──────────────────────────────────────────────────────────────
function CoverPicker({ onPick }) {
  const inputRef = useRef(null);

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      // Strip the data URL prefix to store pure base64
      const b64 = ev.target.result.split(',')[1];
      onPick(b64, normaliseMime(file));
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleChange} />
      <button onClick={() => inputRef.current?.click()}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px' }}>
        <Upload size={28} style={{ opacity: 0.5, color: 'var(--text-4)' }} />
        <span style={{ fontSize: '12px', color: 'var(--text-5)' }}>Add Cover</span>
      </button>
    </>
  );
}

// ─── BookDashboard ────────────────────────────────────────────────────────────
export default function BookDashboard({
  session,
  accentHex,
  onBack,
  onEditChapter,
  onNewChapter,
  onUpdateSession,
  onDeleteChapter,
  onMoveChapter,
  onExportTxt,
  onExportHtml,
  onExportEpub,
  onToggleMenu,
  burgerBtnRef,
  onToggleSidebar,
  goalWords,
  onStreakUpdate,
  streakEnabled,
}) {
  const light = useLightMode();

  // Sub-panel state
  const [showExport,   setShowExport]   = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  // Chapter list state
  const [descExpanded,   setDescExpanded]   = useState(false);
  const [chapterSearch,  setChapterSearch]  = useState('');
  const [sortOrder,      setSortOrder]      = useState('newest');
  const [showScrollTop,  setShowScrollTop]  = useState(false);
  const [deleteConfirm,  setDeleteConfirm]  = useState(null); // chap_idx pending delete

  const scrollRef = useRef(null);

  // ── Derived values ──────────────────────────────────────────────────────────
  const chapters = useMemo(() =>
    [...(session?.chapters || [])].sort((a, b) => a.order - b.order),
    [session?.chapters]
  );

  const totalWords = useMemo(() =>
    chapters.reduce((n, c) => n + wordCount(c.content), 0),
    [chapters]
  );

  const streakDays = useMemo(() => currentStreakDays(session?.streak), [session?.streak]);

  const visibleChapters = useMemo(() => {
    let list = chapters;
    if (chapterSearch.trim()) {
      const q = chapterSearch.toLowerCase();
      list = list.filter(c => c.title.toLowerCase().includes(q));
    }
    return sortOrder === 'newest' ? [...list].reverse() : list;
  }, [chapters, chapterSearch, sortOrder]);

  const description   = session?.description || '';
  const shortDesc     = description.slice(0, 160);
  const needsExpand   = description.length > 160;
  const hasCover      = !!session?.coverBase64;
  const coverMime     = session?.coverMime || 'image/jpeg';
  const nextChapNum   = chapters.length + 1;

  // ── Scroll ──────────────────────────────────────────────────────────────────
  const handleScroll = useCallback((e) => {
    setShowScrollTop(e.target.scrollTop > 220);
  }, []);

  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  // ── Cover pick ──────────────────────────────────────────────────────────────
  const handleCoverPick = (b64, mime) => {
    onUpdateSession({ coverBase64: b64, coverMime: mime });
  };

  // ── Metadata save ────────────────────────────────────────────────────────────
  const handleMetadataSave = (updates) => {
    onUpdateSession(updates);
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const card = {
    background: light ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: '18px',
    border: `1px solid ${light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}`,
    padding: '20px',
  };

  const ghostBtn = {
    background: light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)',
    border: `1px solid ${light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'}`,
    borderRadius: '12px',
    color: 'var(--text-1)',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '13px',
  };

  const statDivider = {
    borderRight: `1px solid ${light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}`,
  };

  return (
    <>
      {/* ── Sub-panels (rendered as overlays) ─── */}
      {showExport && (
        <ExportPanel
          session={session}
          accentHex={accentHex}
          light={light}
          onClose={() => setShowExport(false)}
          onExportTxt={onExportTxt}
          onExportHtml={onExportHtml}
          onExportEpub={onExportEpub}
        />
      )}
      {showMetadata && (
        <MetadataPanel
          session={session}
          accentHex={accentHex}
          light={light}
          onClose={() => setShowMetadata(false)}
          onSave={handleMetadataSave}
        />
      )}

      {/* ── Main scroll container ──────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1, height: '100%', overflowY: 'auto', overflowX: 'hidden',
          background: 'var(--app-bg)', position: 'relative', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* ── Sticky header ── */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', position: 'sticky', top: 0, zIndex: 20,
          background: light ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'}`,
        }}>
          <button onClick={onBack} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', color: 'var(--text-1)',
            cursor: 'pointer', fontSize: '15px', fontWeight: 700, padding: '4px',
          }}>
            <ArrowLeft size={18} />
            Library
          </button>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {streakEnabled && (
              <FlameButton current={session} accentHex={accentHex}
                goalWords={goalWords} onStreakUpdate={onStreakUpdate} />
            )}
            <button ref={burgerBtnRef} onClick={onToggleMenu}
              className="p-2 border-2 border-white rounded-md hover:bg-white/5 transition"
              style={{ background: 'none', cursor: 'pointer', color: 'var(--text-1)' }}>
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div style={{ padding: '24px 16px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── Cover ── */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
              width: '168px', height: '240px', borderRadius: '14px',
              overflow: 'hidden', position: 'relative',
              boxShadow: hasCover
                ? `0 12px 40px ${accentHex}55, 0 4px 16px rgba(0,0,0,0.4)`
                : `0 4px 20px rgba(0,0,0,0.2)`,
              background: light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)',
              border: hasCover ? 'none' : `2px dashed ${accentHex}66`,
              cursor: 'pointer',
              flexShrink: 0,
            }}>
              {hasCover ? (
                <>
                  <img
                    src={`data:${coverMime};base64,${session.coverBase64}`}
                    alt="Book cover"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  {/* Edit overlay */}
                  <div style={{
                    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s',
                  }}>
                    <label style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}>
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            onUpdateSession({ coverBase64: ev.target.result.split(',')[1], coverMime: normaliseMime(file) });
                          };
                          reader.readAsDataURL(file);
                        }} />
                    </label>
                  </div>
                </>
              ) : (
                <CoverPicker onPick={handleCoverPick} />
              )}
            </div>
          </div>

          {/* ── Info card ── */}
          <div style={card}>

            {/* Title */}
            <h1 style={{ margin: '0 0 12px', fontSize: '22px', fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
              {session?.title || 'Untitled Book'}
            </h1>

            {/* Streak badge */}
            {streakDays > 0 && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                background: 'linear-gradient(135deg, #FF6B2B, #FF8C00)',
                borderRadius: '20px', padding: '5px 13px',
                fontSize: '13px', fontWeight: 700, color: '#fff',
                marginBottom: '12px',
                boxShadow: '0 2px 10px rgba(255,107,43,0.4)',
              }}>
                <FlameIcon size={15} /> Streak {streakDays}Day{streakDays !== 1 ? 's' : ''}
              </div>
            )}

            {/* Metadata quick-edit link */}
            <button onClick={() => setShowMetadata(true)} style={{
              display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '14px',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: accentHex, fontSize: '13px', fontWeight: 600,
            }}>
              <Settings2 size={13} /> Edit Metadata
            </button>

            {/* Description */}
            {description ? (
              <div style={{ marginBottom: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-3)', lineHeight: 1.7 }}>
                  {descExpanded ? description : shortDesc}
                  {needsExpand && !descExpanded && '…'}
                </p>
                {needsExpand && (
                  <button onClick={() => setDescExpanded(v => !v)} style={{
                    background: 'none', border: 'none', color: accentHex,
                    cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    marginTop: '4px', padding: 0,
                    display: 'flex', alignItems: 'center', gap: '3px',
                  }}>
                    {descExpanded
                      ? <><span>Show less</span><ChevronUp size={14} /></>
                      : <><span>Show more</span><ChevronDown size={14} /></>}
                  </button>
                )}
              </div>
            ) : (
              <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-5)', lineHeight: 1.7, fontStyle: 'italic' }}>
                No description yet —{' '}
                <button onClick={() => setShowMetadata(true)} style={{ background: 'none', border: 'none', color: accentHex, cursor: 'pointer', fontSize: '14px', fontWeight: 600, fontStyle: 'normal', padding: 0 }}>
                  add one
                </button>
              </p>
            )}

            {/* Stats */}
            <div style={{
              display: 'flex', borderRadius: '14px', overflow: 'hidden',
              border: `1px solid ${light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}`,
              marginBottom: '16px',
            }}>
              <div style={{ flex: 1, padding: '14px 16px', ...statDivider }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                  <BookIcon size={20} />
                  <span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-1)' }}>{chapters.length}</span>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-5)', fontWeight: 500 }}>Chapters</span>
              </div>
              <div style={{ flex: 1, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                  <WordsIcon size={20} />
                  <span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-1)' }}>{formatWords(totalWords)}</span>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-5)', fontWeight: 500 }}>Words</span>
              </div>
            </div>

            {/* Export button */}
            <button onClick={() => setShowExport(true)} style={{
              width: '100%', padding: '15px', borderRadius: '14px', border: 'none',
              background: accentHex, color: '#fff', fontSize: '15px', fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '9px', letterSpacing: '0.1px', marginBottom: '12px',
              boxShadow: `0 4px 20px ${accentHex}44`,
              transition: 'opacity 0.12s',
            }}>
              <Upload size={17} />
              Export Options
            </button>

            {/* Chapter action buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => chapters.length > 0 && onEditChapter(chapters[0].chap_idx)}
                disabled={chapters.length === 0}
                style={{
                  ...ghostBtn, flex: 1,
                  opacity: chapters.length === 0 ? 0.4 : 1,
                  cursor: chapters.length === 0 ? 'default' : 'pointer',
                }}>
                <Edit3 size={15} />
                First Chapter
              </button>
              <button onClick={onNewChapter} style={{ ...ghostBtn, flex: 1 }}>
                <Edit3 size={15} />
                New Chapter [{nextChapNum}]
              </button>
            </div>
          </div>

          {/* ── Chapter List ── */}
          <div style={{ paddingBottom: '0' }}>

            {/* List header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-1)' }}>
                {chapters.length} Chapter{chapters.length !== 1 ? 's' : ''}
              </h2>
              <button onClick={() => setSortOrder(v => v === 'newest' ? 'oldest' : 'newest')} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                background: light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '8px', padding: '7px 12px',
                color: 'var(--text-3)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              }}>
                <SlidersHorizontal size={13} />
                {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
              </button>
            </div>

            {/* Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              background: light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
              borderRadius: '12px',
              border: `1px solid ${light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}`,
              padding: '0 14px', marginBottom: '8px',
            }}>
              <Search size={15} style={{ color: 'var(--text-5)', flexShrink: 0 }} />
              <input
                value={chapterSearch}
                onChange={e => setChapterSearch(e.target.value)}
                placeholder="Search chapters..."
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  color: 'var(--text-1)', fontSize: '14px', padding: '12px 0',
                }}
              />
              {chapterSearch && (
                <button onClick={() => setChapterSearch('')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-5)', padding: '2px' }}>
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Rows */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {visibleChapters.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-5)', fontSize: '14px' }}>
                  {chapterSearch ? 'No chapters match your search.' : 'No chapters yet — create your first one!'}
                </div>
              ) : visibleChapters.map((chap, i) => {
                const isLast       = i === visibleChapters.length - 1;
                const isPendingDel = deleteConfirm === chap.chap_idx;
                // Move direction depends on sort order display
                const canMoveUp   = i > 0;
                const canMoveDown = i < visibleChapters.length - 1;
                // When sorted newest-first, pressing ↑ in the list means order+1 (later)
                const upDir   = sortOrder === 'newest' ? 1  : -1;
                const downDir = sortOrder === 'newest' ? -1 : 1;

                return (
                  <div key={chap.chap_idx} style={{
                    borderBottom: !isLast
                      ? `1px solid ${light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'}`
                      : 'none',
                  }}>
                    {isPendingDel ? (
                      /* ── Delete confirmation inline ── */
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 2px', gap: '10px',
                      }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>
                          Delete <strong style={{ color: 'var(--text-1)' }}>{chap.title}</strong>?
                        </span>
                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                          <button onClick={() => setDeleteConfirm(null)} style={{
                            padding: '6px 14px', borderRadius: '8px', border: `1px solid ${light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)'}`,
                            background: 'none', color: 'var(--text-3)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                          }}>Cancel</button>
                          <button onClick={() => { onDeleteChapter?.(chap.chap_idx); setDeleteConfirm(null); }} style={{
                            padding: '6px 14px', borderRadius: '8px', border: 'none',
                            background: '#e03c3c', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                          }}>Delete</button>
                        </div>
                      </div>
                    ) : (
                      /* ── Normal row ── */
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0',
                      }}>
                        {/* Reorder buttons */}
                        {!chapterSearch && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                            <button
                              onClick={() => onMoveChapter?.(chap.chap_idx, upDir)}
                              disabled={!canMoveUp}
                              style={{
                                width: '22px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'none', border: 'none', cursor: canMoveUp ? 'pointer' : 'default',
                                color: canMoveUp ? 'var(--text-4)' : 'var(--text-6)',
                                opacity: canMoveUp ? 1 : 0.25, padding: 0, borderRadius: '4px',
                              }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                                <path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            <button
                              onClick={() => onMoveChapter?.(chap.chap_idx, downDir)}
                              disabled={!canMoveDown}
                              style={{
                                width: '22px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'none', border: 'none', cursor: canMoveDown ? 'pointer' : 'default',
                                color: canMoveDown ? 'var(--text-4)' : 'var(--text-6)',
                                opacity: canMoveDown ? 1 : 0.25, padding: 0, borderRadius: '4px',
                              }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        )}

                        {/* Title + timestamp — tappable to open editor */}
                        <button onClick={() => onEditChapter(chap.chap_idx)} style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                          minWidth: 0,
                        }}>
                          <span style={{
                            fontSize: '15px', fontWeight: 600, color: 'var(--text-1)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {chap.title}
                          </span>
                          <span style={{ fontSize: '13px', color: 'var(--text-5)', flexShrink: 0, marginLeft: '12px' }}>
                            {timeAgo(chap.updated || chap.created)}
                          </span>
                        </button>

                        {/* Delete button */}
                        {chapters.length > 1 && (
                          <button
                            onClick={() => setDeleteConfirm(chap.chap_idx)}
                            style={{
                              width: '28px', height: '28px', flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--text-5)', borderRadius: '6px', padding: 0,
                              transition: 'color 0.12s',
                            }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

          </div>

          {/* Bottom spacer so FAB never covers last row */}
          <div style={{ height: '88px' }} />
        </div>
      </div>

      {/* ── Scroll-to-top FAB ── */}
      {showScrollTop && (
        <button onClick={scrollToTop} style={{
          position: 'fixed', bottom: '28px', right: '20px',
          width: '50px', height: '50px', borderRadius: '50%',
          background: accentHex, border: 'none', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', boxShadow: `0 4px 24px ${accentHex}66`,
          zIndex: 50, transition: 'transform 0.18s ease',
        }}>
          <ArrowUp size={21} />
        </button>
      )}
    </>
  );
}
