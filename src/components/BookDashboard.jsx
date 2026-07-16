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

import { useState, useRef, useCallback, useMemo } from 'react';

import { FlameButton } from './Streak';
import { motion } from 'framer-motion';
import { ChapterRow } from './ChapterRow';
import { CountUp } from './Motion';
import { V, staggerContainer, MOBILE } from '../utils/motion';
import { isSpeechSupported } from '../utils/readAloud';
import { useBookDashboardExtensions, useExtensions } from '../utils/ExtensionContext';
import { DSIcons, CloseButton } from '../DesignSystem';

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

export function wordCount(html) {
  const t = stripHtml(html);
  return t ? t.split(' ').length : 0;
}

/**
 * Word count for a chapter, preferring the cached `word_count` (maintained on
 * every edit in App.handleEditContent and loaded from the .authbook manifest)
 * over re-parsing the HTML. The parse fallback covers chapters that predate
 * the cache (old mirrors, imports) until their first edit. (beta.2 perf —
 * stats used to re-strip every chapter's HTML on every render.)
 */
export function chapterWords(c) {
  return typeof c?.word_count === 'number' ? c.word_count : wordCount(c?.content);
}

export function formatWords(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/**
 * Analyse a streak log and return the longest ever continuous streak plus
 * whether that streak is still active (ends today or yesterday).
 *
 * The log is a flat object keyed by 'YYYY-MM-DD'.  Multiple chapters write
 * into the same shared log so duplicate dates are inherently deduplicated.
 *
 * Returns { days: number, active: boolean }
 *   days   — length of the longest continuous run of logged dates ever
 *   active — true if that longest run is still ongoing (ends today/yesterday)
 */
// ─── Cover downscale (2F) ─────────────────────────────────────────────────────
// Covers are embedded in the .authbook META (sharing its RS parity), so a raw
// 12 MP photo bloats the file and its parity. Downscale anything over 1200 px
// to a JPEG before storing.
function downscaleCover(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 500 * 1024) {
          // Small enough — keep original bytes/mime.
          resolve({ base64: String(ev.target.result).split(',')[1], mime: file.type || 'image/jpeg' });
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ base64: dataUrl.split(',')[1], mime: 'image/jpeg' });
      };
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function analyseStreak(streak) {
  if (!streak?.log) return { days: 0, active: false, best: 0 };

  // Collect every unique date string that has a truthy entry, sort ascending
  const dates = Object.keys(streak.log)
    .filter(k => streak.log[k])
    .sort(); // lexicographic sort works perfectly for ISO dates

  if (dates.length === 0) return { days: 0, active: false, best: 0 };

  // Longest ever run (for the "Best Streak" fallback)
  let maxRun = 1, curRun = 1;
  for (let i = 1; i < dates.length; i++) {
    const diffDays = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000);
    if (diffDays === 1) { curRun++; if (curRun > maxRun) maxRun = curRun; }
    else curRun = 1;
  }

  // N16: the CURRENT streak — count back from today (or yesterday, to allow
  // "haven't written yet today"). The old logic only surfaced the longest-ever
  // run, so a live 3-day streak was invisible behind a stale 10-day best.
  const met = new Set(dates);
  const dayKey = (d) => d.toISOString().slice(0, 10);
  const cursor = new Date();
  if (!met.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (met.has(dayKey(cursor))) { current++; cursor.setDate(cursor.getDate() - 1); }

  return current > 0
    ? { days: current, active: true, best: maxRun }
    : { days: maxRun, active: false, best: maxRun };
}

// ─── Light-mode detector ──────────────────────────────────────────────────────
/*
  useLightMode() removed (N3): this component previously branched on a binary
  light/dark flag with hardcoded hexes, so Sepia, Paper and OLED all rendered
  the wrong colours. Every surface now reads the theme variables directly.
*/

// ─── ExportPanel (inline sub-panel) ──────────────────────────────────────────
export function ExportPanel({ session, accentHex, onClose, onExportTxt, onExportHtml, onExportEpub, onExportPdf }) {
  const glass = {
    background: 'var(--modal-bg)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: `1px solid var(--border)`,
    borderRadius: '20px',
  };

  const formats = [
    { icon: <DSIcons.FileText size={24} color={accentHex} />, label: 'Plain Text (.txt)', sub: 'Raw text, no formatting', action: onExportTxt, ready: true },
    { icon: <DSIcons.Globe size={24} color={accentHex} />, label: 'HTML (.html)',       sub: 'Styled web document',     action: onExportHtml, ready: true },
    { icon: <DSIcons.BookOpen size={24} color={accentHex} />, label: 'ePub (.epub)',        sub: 'Standard e-book format',  action: onExportEpub, ready: true },
    { icon: <DSIcons.FileText size={24} color={accentHex} />, label: 'PDF (.pdf)',          sub: 'Paginated print document', action: onExportPdf,  ready: true },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.13 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'var(--modal-overlay-bg, rgba(0,0,0,0.55))', display: 'flex',
        alignItems: 'flex-end', justifyContent: 'center',
      }} onClick={onClose}>
      <motion.div
        initial={{ y: '30%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
        style={{ ...glass, width: '100%', maxWidth: '480px', padding: '24px', marginBottom: '0', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-1)' }}>Export Options</h2>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {formats.map((f, i) => (
            <button key={i} onClick={f.ready ? f.action : undefined}
              disabled={!f.ready}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '14px 16px', borderRadius: '14px', cursor: f.ready ? 'pointer' : 'default',
                background: 'var(--surface)',
                border: `1px solid var(--border-sm)`,
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
      </motion.div>
    </motion.div>
  );
}

// ─── MetadataPanel (inline sub-panel) ────────────────────────────────────────
export function MetadataPanel({ session, accentHex, onClose, onSave }) {
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
      isbn:        form.isbn.trim(),
      authors:     form.authors
        ? form.authors
            .split(form.authors.includes(';') ? ';' : ',')
            .map(s => ({ name: s.trim() })).filter(a => a.name)
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
            background: 'var(--surface)',
            border: `1px solid var(--border)`,
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
            background: 'var(--surface)',
            border: `1px solid var(--border)`,
            borderRadius: '10px', padding: '10px 12px',
            color: 'var(--text-1)', fontSize: '14px',
            outline: 'none',
          }}
        />
      )}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.13 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'var(--modal-overlay-bg, rgba(0,0,0,0.55))',
        overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '24px',
      }} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
        style={{
          width: '100%', maxWidth: '480px',
          background: 'var(--modal-bg)',
          borderRadius: '20px', padding: '24px',
          margin: '0 0 40px',
          border: `1px solid var(--border)`,
        }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-1)' }}>Book Metadata</h2>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {field('Title',       'title',       { placeholder: 'Untitled Book' })}
          {field('Author(s)',   'authors',     { placeholder: 'Separate with commas — or semicolons if a name contains a comma' })}
          {field('Description', 'description', { multiline: true, placeholder: 'A short blurb about the book…' })}
          {field('Genre',       'genre',       { placeholder: 'e.g. Fantasy, Romance, Sci-Fi' })}
          {field('Language',    'language',    { placeholder: 'en' })}
          {field('Publisher',   'publisher',   { placeholder: 'Self-published' })}
          {field('ISBN',        'isbn',        { placeholder: 'Optional (10 or 13 digits)' })}
          {form.isbn.trim() && !/^(97[89][- ]?)?\d{1,5}[- ]?\d{1,7}[- ]?\d{1,7}[- ]?[\dXx]$/.test(form.isbn.trim()) && (
            <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: -8, marginBottom: 10 }}>
              This doesn't look like a valid ISBN-10/13 — it will still be saved.
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '13px', borderRadius: '12px', cursor: 'pointer',
            background: 'none',
            border: `1px solid var(--border)`,
            color: 'var(--text-3)', fontSize: '14px', fontWeight: 600,
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            flex: 2, padding: '13px', borderRadius: '12px', cursor: 'pointer',
            background: accentHex, border: 'none',
            color: '#fff', fontSize: '14px', fontWeight: 700,
          }}>Save</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── CoverPicker ──────────────────────────────────────────────────────────────
export function CoverPicker({ onPick, accentHex = 'var(--accent)' }) {
  const inputRef = useRef(null);

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { base64, mime } = await downscaleCover(file);
      onPick(base64, mime);
    } catch (err) { console.error('[cover]', err); }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleChange} />
      <button onClick={() => inputRef.current?.click()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '9px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          border: `1.5px dashed ${accentHex}66`, background: `${accentHex}0d`, color: accentHex,
        }}>
        <DSIcons.Image size={16} />
        Add cover
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
  onExportPdf,
  onReadAloud,
  onToggleMenu,
  burgerBtnRef,
  onToggleSidebar,
  goalWords,
  onStreakUpdate,
  streakEnabled,
}) {

  // ── Extension contributions ─────────────────────────────────────────────
  const { navigate } = useExtensions();
  const { tabs: extTabs, actions: extActions } = useBookDashboardExtensions();

  // Sub-panel state
  const [showExport,   setShowExport]   = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  // Which extension tab is active in the chapter list area (null = default chapters view)
  const [activeExtTab, setActiveExtTab] = useState(null);

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
    chapters.reduce((n, c) => n + chapterWords(c), 0),
    [chapters]
  );

  const streak         = useMemo(() => analyseStreak(session?.streak), [session?.streak]);
  const streakDays     = streak.days;
  const streakActive   = streak.active;

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

  // ── Chapter synopsis (inline tap-to-edit) ─────────────────────────────────────
  // Persists chap.synopsis into the .authbook chapter model via onUpdateSession.
  // Trims and drops the field entirely when cleared so empty synopses don't
  // bloat the file.
  const handleSynopsisChange = (chapIdx, text) => {
    const next = (text ?? '').trim();
    const chaps = (session?.chapters || []).map((c) => {
      if (c.chap_idx !== chapIdx) return c;
      if (!next) { const { synopsis, ...rest } = c; return rest; }
      if (c.synopsis === next) return c;
      return { ...c, synopsis: next };
    });
    onUpdateSession({ chapters: chaps });
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const card = {
    background: 'var(--sidebar-card-bg)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: '18px',
    border: `1px solid var(--border)`,
    padding: '20px',
  };

  const ghostBtn = {
    background: 'var(--surface-md)',
    border: `1px solid var(--border)`,
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
    borderRight: `1px solid var(--border)`,
  };

  return (
    <>
      {/* ── Sub-panels (rendered as overlays) ─── */}
      {showExport && (
        <ExportPanel
          session={session}
          accentHex={accentHex}
          onClose={() => setShowExport(false)}
          onExportTxt={onExportTxt}
          onExportHtml={onExportHtml}
          onExportEpub={onExportEpub}
          onExportPdf={onExportPdf}
        />
      )}
      {showMetadata && (
        <MetadataPanel
          session={session}
          accentHex={accentHex}
          onClose={() => setShowMetadata(false)}
          onSave={handleMetadataSave}
        />
      )}

      {/* ── Main scroll container ──────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          // Transparent (not --app-bg) so the fixed gradient/grain background
          // shows through here too, matching the Home screen. position:relative
          // keeps this content painting above the fixed z-index:0 background.
          flex: 1, height: '100%', overflowY: 'auto', overflowX: 'hidden',
          background: 'transparent', position: 'relative', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* ── Sticky header ── */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', position: 'sticky', top: 0, zIndex: 20,
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-sm)',
        }}>
          <button onClick={onBack} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', color: 'var(--text-1)',
            cursor: 'pointer', fontSize: '15px', fontWeight: 700, padding: '4px',
          }}>
            <DSIcons.ChevronLeft size={18} />
            Library
          </button>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {streakEnabled && (
              <FlameButton current={session} accentHex={accentHex}
                goalWords={goalWords} onStreakUpdate={onStreakUpdate} />
            )}
            <button ref={burgerBtnRef} onClick={onToggleMenu}
              style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'var(--text-1)', transition: 'background 0.15s' }}>
              <DSIcons.MoreVertical size={20} color="var(--text-1)" style={{ display: 'block' }} />
            </button>
          </div>
        </header>

        <div style={{ padding: '24px 16px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── Cover ──
              Only reserve the full 168×240 thumbnail when a cover EXISTS.
              With no cover the big dashed placeholder was dead vertical space
              (author feedback), so the empty state is a compact add button. */}
          {hasCover ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{
                width: '150px', height: '214px', borderRadius: '14px',
                overflow: 'hidden', position: 'relative',
                boxShadow: `0 12px 40px ${accentHex}44, 0 4px 16px rgba(0,0,0,0.35)`,
                background: 'var(--surface)', cursor: 'pointer', flexShrink: 0,
              }}>
                <img
                  src={`data:${coverMime};base64,${session.coverBase64}`}
                  alt="Book cover"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <label style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const { base64, mime } = await downscaleCover(file);
                        onUpdateSession({ coverBase64: base64, coverMime: mime });
                      } catch (err) { console.error('[cover]', err); }
                    }} />
                </label>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <CoverPicker onPick={handleCoverPick} accentHex={accentHex} />
            </div>
          )}

          {/* ── Info card ── */}
          <div data-tour="book-meta" style={card}>

            {/* Title */}
            <h1 style={{ margin: '0 0 12px', fontSize: '22px', fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
              {session?.title || 'Untitled Book'}
            </h1>

            {/* Streak badge (N16) — shows the CURRENT streak when one is live
                (flame + accent gradient), otherwise falls back to the longest
                ever run as a greyed "Best Streak". */}
            {streakDays > 0 && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                background: streakActive
                  ? 'linear-gradient(135deg, #FF6B2B, #FF8C00)'
                  : ('var(--border)'),
                borderRadius: '20px', padding: '5px 13px',
                fontSize: '13px', fontWeight: 700,
                color: streakActive ? '#fff' : 'var(--text-4)',
                marginBottom: '12px',
                boxShadow: streakActive ? '0 2px 10px rgba(255,107,43,0.4)' : 'none',
                border: streakActive
                  ? 'none'
                  : `1px solid var(--border)`,
              }}>
                {streakActive && <DSIcons.Flame size={14} color="#fff" />}
                {streakActive ? 'Streak' : 'Best Streak'} {streakDays} Day{streakDays !== 1 ? 's' : ''}
              </div>
            )}

            {/* Metadata quick-edit link */}
            <button onClick={() => setShowMetadata(true)} style={{
              display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '14px',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: accentHex, fontSize: '13px', fontWeight: 600,
            }}>
              <DSIcons.Settings size={13} /> Edit Metadata
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
                      ? <><span>Show less</span><DSIcons.ChevronUp size={14} /></>
                      : <><span>Show more</span><DSIcons.ChevronDown size={14} /></>}
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
              border: `1px solid var(--border)`,
              marginBottom: '16px',
            }}>
              <div style={{ flex: 1, padding: '14px 16px', ...statDivider }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                  <DSIcons.BookOpen size={18} color={accentHex} />
                  <CountUp value={chapters.length} style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-1)' }} />
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-5)', fontWeight: 500 }}>Chapters</span>
              </div>
              <div style={{ flex: 1, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                  <DSIcons.Text size={18} color={accentHex} />
                  <CountUp value={totalWords} format={formatWords} style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-1)' }} />
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
              <DSIcons.Upload size={17} />
              Export Options
            </button>

            {/* Read Aloud (U2) — only where the device actually has TTS. */}
            {isSpeechSupported() && (
            <button onClick={onReadAloud} style={{
              width: '100%', padding: '13px', borderRadius: '14px',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-2)', fontSize: '14px', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '9px', marginBottom: '12px', transition: 'background 0.12s',
            }}>
              <DSIcons.Volume size={16} color="currentColor" />
              Read Aloud
            </button>
            )}

            {/* Extension action buttons — rendered only when extensions are installed */}
            {extActions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                {extActions.map((action, i) => (
                  <button
                    key={`${action._extId}-${action.id}-${i}`}
                    onClick={() => navigate(action._ext, action.page, session)}
                    style={{
                      width: '100%', padding: '13px 15px', borderRadius: '12px',
                      border: `1.5px solid ${accentHex}55`,
                      background: `${accentHex}18`,
                      color: 'var(--text-1)', fontSize: '14px', fontWeight: 600,
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: '8px',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${accentHex}30`; e.currentTarget.style.borderColor = accentHex; }}
                    onMouseLeave={e => { e.currentTarget.style.background = `${accentHex}18`; e.currentTarget.style.borderColor = `${accentHex}55`; }}
                  >
                    <span style={{ fontSize: '16px', lineHeight: 1 }}>{action.icon ?? action._extIcon}</span>
                    {action.label}
                    <span style={{
                      marginLeft: 'auto', fontSize: '10px', opacity: 0.45,
                      background: 'rgba(255,255,255,0.07)', padding: '2px 6px',
                      borderRadius: '6px',
                    }}>
                      {action._extName}
                    </span>
                  </button>
                ))}
              </div>
            )}

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
                <DSIcons.Edit size={15} />
                First Chapter
              </button>
              <button data-tour="add-chapter" onClick={onNewChapter} style={{ ...ghostBtn, flex: 1 }}>
                <DSIcons.Edit size={15} />
                New Chapter [{nextChapNum}]
              </button>
            </div>
          </div>

          {/* ── Chapter List ── */}
          <div data-tour="chapters" style={{ paddingBottom: '0' }}>

            {/* Extension tab bar — only shown when extensions contribute tabs */}
            {extTabs.length > 0 && (
              <div style={{
                display: 'flex', gap: '4px', marginBottom: '14px',
                borderBottom: `1px solid var(--border-sm)`,
                overflowX: 'auto', paddingBottom: '0',
              }}>
                {/* Built-in Chapters tab */}
                <button
                  onClick={() => setActiveExtTab(null)}
                  style={{
                    padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '13px', fontWeight: activeExtTab === null ? 700 : 400,
                    color: activeExtTab === null ? 'var(--text-1)' : 'var(--text-4)',
                    borderBottom: activeExtTab === null ? `2px solid ${accentHex}` : '2px solid transparent',
                    whiteSpace: 'nowrap', transition: 'color 0.15s',
                  }}
                >
                  Chapters
                </button>
                {/* Extension-contributed tabs */}
                {extTabs.map((tab, i) => {
                  const tabKey = `${tab._extId}::${tab.id}`;
                  const isActive = activeExtTab === tabKey;
                  return (
                    <button
                      key={tabKey}
                      onClick={() => setActiveExtTab(tabKey)}
                      style={{
                        padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: '13px', fontWeight: isActive ? 700 : 400,
                        color: isActive ? 'var(--text-1)' : 'var(--text-4)',
                        borderBottom: isActive ? `2px solid ${accentHex}` : '2px solid transparent',
                        whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px',
                        transition: 'color 0.15s',
                      }}
                    >
                      <span style={{ fontSize: '14px', lineHeight: 1 }}>{tab.icon ?? tab._extIcon}</span>
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Active extension tab content — replaces chapter list */}
            {activeExtTab !== null ? (() => {
              const tabKey = activeExtTab;
              const tab = extTabs.find(t => `${t._extId}::${t.id}` === tabKey);
              if (!tab) return null;
              // Lazy-load ExtensionPage inline within the dashboard
              const ExtensionPage = require('./ExtensionPage').default;
              return (
                <div style={{ minHeight: '200px' }}>
                  <ExtensionPage
                    extension={tab._ext}
                    pageId={tab.page}
                    session={session}
                    accentHex={accentHex}
                    onBack={() => setActiveExtTab(null)}
                    inline
                  />
                </div>
              );
            })() : (
              <>

            {/* List header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-1)' }}>
                {chapters.length} Chapter{chapters.length !== 1 ? 's' : ''}
              </h2>
              <button onClick={() => setSortOrder(v => v === 'newest' ? 'oldest' : 'newest')} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                background: 'var(--surface-md)',
                border: `1px solid var(--border)`,
                borderRadius: '8px', padding: '7px 12px',
                color: 'var(--text-3)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              }}>
                <DSIcons.Sliders size={13} />
                {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
              </button>
            </div>

            {/* Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              background: 'var(--surface)',
              borderRadius: '12px',
              border: `1px solid var(--border)`,
              padding: '0 14px', marginBottom: '8px',
            }}>
              <DSIcons.Search size={15} style={{ color: 'var(--text-5)', flexShrink: 0 }} />
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
                  <DSIcons.X size={14} />
                </button>
              )}
            </div>

            {/* Rows */}
            <motion.div style={{ display: 'flex', flexDirection: 'column' }}
              variants={staggerContainer(visibleChapters.length)} initial="hidden" animate="show">
              {visibleChapters.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-5)', fontSize: '14px' }}>
                  {chapterSearch ? 'No chapters match your search.' : 'No chapters yet — create your first one!'}
                </div>
              ) : visibleChapters.map((chap, i) => {
                const isLast      = i === visibleChapters.length - 1;
                const canMoveUp   = i > 0;
                const canMoveDown = i < visibleChapters.length - 1;
                const upDir   = sortOrder === 'newest' ? 1  : -1;
                const downDir = sortOrder === 'newest' ? -1 : 1;

                return (
                  <motion.div key={chap.chap_idx} layout={!MOBILE} variants={V.fadeRise}>
                  <ChapterRow
                    chap={chap}
                    isLast={isLast}
                    isPendingDel={deleteConfirm === chap.chap_idx}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    showSearch={!!chapterSearch}
                    showDelete={chapters.length > 1}
                    onSynopsisChange={(text) => handleSynopsisChange(chap.chap_idx, text)}
                              onEdit={() => onEditChapter(chap.chap_idx)}
                    onMoveUp={() => onMoveChapter?.(chap.chap_idx, upDir)}
                    onMoveDown={() => onMoveChapter?.(chap.chap_idx, downDir)}
                    onDeleteRequest={() => setDeleteConfirm(chap.chap_idx)}
                    onDeleteConfirm={() => { onDeleteChapter?.(chap.chap_idx); setDeleteConfirm(null); }}
                    onDeleteCancel={() => setDeleteConfirm(null)}
                  />
                  </motion.div>
                );
              })}
            </motion.div>

            </>
            )}{/* end activeExtTab conditional */}

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
          <DSIcons.ChevronUp size={21} />
        </button>
      )}
    </>
  );
}
