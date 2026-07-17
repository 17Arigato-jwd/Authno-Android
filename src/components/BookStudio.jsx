/**
 * BookStudio.jsx — the desktop three-pane book screen (v1.1.17-beta.3 PC layout).
 *
 * Direction (author MCQ): Ulysses / Scrivener-style studio —
 *   ┌──────────────┬───────────────────┬─────────────────────────────┐
 *   │ book info    │ chapter list      │ selected-chapter detail     │
 *   │ cover, meta, │ dense rows,       │ title, stats, editable      │
 *   │ stats,       │ search/sort,      │ synopsis, prose preview,    │
 *   │ actions      │ multi-select,     │ "Open in editor"            │
 *   │              │ right-click menu  │                             │
 *   └──────────────┴───────────────────┴─────────────────────────────┘
 *
 * Desktop refinements wired here: dense type, hover states, right-click
 * context menu on chapters, Ctrl/Shift-click multi-select with bulk delete.
 * Mobile keeps BookDashboard.jsx untouched — App.js picks per platform.
 * Reuses BookDashboard's ExportPanel / MetadataPanel / CoverPicker.
 */

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DSIcons } from '../DesignSystem';
import { FlameButton } from './Streak';
import { ExportPanel, MetadataPanel, CoverPicker, chapterWords, formatWords } from './BookDashboard';
import { CountUp } from './Motion';
import ContextMenu from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { htmlToText } from '../utils/editorFormat';
import { isSpeechSupported } from '../utils/readAloud';
import { V, T, staggerContainer, PRESS, useMotionEnabled } from '../utils/motion';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const secs = Math.floor((Date.now() - d) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const paneBorder = '1px solid var(--border)';

export default function BookStudio({
  session, accentHex, onBack, onEditChapter, onNewChapter, onUpdateSession,
  onDeleteChapter, onMoveChapter,
  onExportTxt, onExportHtml, onExportEpub, onExportPdf,
  onReadAloud, onToggleMenu, burgerBtnRef,
  goalWords, onStreakUpdate, streakEnabled,
  onChapterInfo,   // (chapIdx) → chapter info modal (beta.1)
  defaultSort = 'story', // Settings → Editor → Default chapter sort (beta.2)
}) {
  const motionOK = useMotionEnabled();
  const [showExport, setShowExport] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState(defaultSort === 'recent' ? 'newest' : 'oldest');
  const [selectedIdx, setSelectedIdx] = useState(null);      // detail-pane chapter
  const [multiSel, setMultiSel] = useState(() => new Set()); // bulk-selection set
  const [lastClickIdx, setLastClickIdx] = useState(null);    // shift-range anchor
  const [ctx, setCtx] = useState(null);                      // context menu
  const [synopsisDraft, setSynopsisDraft] = useState(null);  // right-pane editor

  const chapters = useMemo(() => {
    const list = [...(session?.chapters || [])].sort((a, b) => a.order - b.order);
    return sortOrder === 'newest' ? list.reverse() : list;
  }, [session?.chapters, sortOrder]);

  const visible = useMemo(() => {
    if (!search.trim()) return chapters;
    const q = search.toLowerCase();
    return chapters.filter((c) => (c.title || '').toLowerCase().includes(q));
  }, [chapters, search]);

  const totalWords = useMemo(
    () => (session?.chapters || []).reduce((n, c) => n + chapterWords(c), 0),
    [session?.chapters]
  );

  const selected = useMemo(
    () => (session?.chapters || []).find((c) => c.chap_idx === selectedIdx) ?? null,
    [session?.chapters, selectedIdx]
  );

  // ── Selection handling (Q4-D): click = focus, Ctrl = toggle, Shift = range ──
  const clickRow = (e, chap, pos) => {
    if (e.ctrlKey || e.metaKey) {
      setMultiSel((prev) => {
        const next = new Set(prev);
        next.has(chap.chap_idx) ? next.delete(chap.chap_idx) : next.add(chap.chap_idx);
        return next;
      });
      setLastClickIdx(pos);
      return;
    }
    if (e.shiftKey && lastClickIdx != null) {
      const [a, b] = [Math.min(lastClickIdx, pos), Math.max(lastClickIdx, pos)];
      setMultiSel(new Set(visible.slice(a, b + 1).map((c) => c.chap_idx)));
      return;
    }
    setMultiSel(new Set());
    setLastClickIdx(pos);
    setSelectedIdx(chap.chap_idx);
    setSynopsisDraft(null);
  };

  // v1.1.18: chapter deletes confirm through the shared styled dialog instead
  // of window.confirm. `confirmDel` = { idxs: [chap_idx…], label } or null.
  const [confirmDel, setConfirmDel] = useState(null);

  const bulkDelete = () => {
    const count = multiSel.size;
    if (!count) return;
    setConfirmDel({
      idxs: [...multiSel],
      label: count === 1
        ? `"${(session?.chapters || []).find((c) => c.chap_idx === [...multiSel][0])?.title ?? 'this chapter'}"`
        : `${count} chapters`,
    });
  };

  const runConfirmedDelete = () => {
    if (!confirmDel) return;
    for (const idx of confirmDel.idxs) onDeleteChapter?.(idx);
    setMultiSel(new Set());
    if (confirmDel.idxs.includes(selectedIdx)) setSelectedIdx(null);
    setConfirmDel(null);
  };

  const commitSynopsis = () => {
    if (synopsisDraft == null || !selected) { setSynopsisDraft(null); return; }
    const next = synopsisDraft.trim();
    const chaps = (session?.chapters || []).map((c) => {
      if (c.chap_idx !== selected.chap_idx) return c;
      if (!next) { const { synopsis, ...rest } = c; return rest; }
      return { ...c, synopsis: next };
    });
    onUpdateSession({ chapters: chaps });
    setSynopsisDraft(null);
  };

  const smallBtn = (label, icon, onClick, primary = false, { disabled = false, title } = {}) => (
    <motion.button key={label} onClick={disabled ? undefined : onClick} whileTap={motionOK && !disabled ? PRESS : undefined}
      disabled={disabled} title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%',
        padding: '9px 12px', borderRadius: 9, cursor: disabled ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600,
        background: primary ? accentHex : 'var(--surface)',
        border: primary ? 'none' : '1px solid var(--border)',
        color: primary ? '#fff' : 'var(--text-2)',
        opacity: disabled ? 0.45 : 1,
      }}>
      {icon}{label}
    </motion.button>
  );

  const previewText = useMemo(() => {
    if (!selected) return '';
    const t = htmlToText(selected.content || '').trim();
    return t.length > 1400 ? `${t.slice(0, 1400)}…` : t;
  }, [selected]);

  return (
    <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {showExport && (
        <ExportPanel session={session} accentHex={accentHex} onClose={() => setShowExport(false)}
          onExportTxt={onExportTxt} onExportHtml={onExportHtml} onExportEpub={onExportEpub} onExportPdf={onExportPdf} />
      )}
      {showMetadata && (
        <MetadataPanel session={session} accentHex={accentHex} onClose={() => setShowMetadata(false)} onSave={(u) => onUpdateSession(u)} />
      )}

      {/* Slim header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: paneBorder, background: 'var(--nav-bg)', backdropFilter: 'blur(12px)', flexShrink: 0 }}>
        <button onClick={onBack} title="Back to home"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600 }}>
          <DSIcons.ChevronLeft size={14} /> Library
        </button>
        <span style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session?.title || 'Untitled Book'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {streakEnabled && <FlameButton current={session} accentHex={accentHex} goalWords={goalWords} onStreakUpdate={onStreakUpdate} />}
          <button ref={burgerBtnRef} onClick={onToggleMenu} aria-label="Menu"
            style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'var(--text-1)', display: 'flex' }}>
            <DSIcons.MoreVertical size={20} color="var(--text-1)" />
          </button>
        </div>
      </header>

      {/* Three panes */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>

        {/* ── Pane 1: book info ─────────────────────────────────────────── */}
        <div data-tour="book-meta" style={{ width: 248, flexShrink: 0, borderRight: paneBorder, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {session?.coverBase64 ? (
            <img src={`data:${session.coverMime || 'image/jpeg'};base64,${session.coverBase64}`} alt="cover"
              style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border-sm)' }} />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
              <CoverPicker accentHex={accentHex} onPick={(b64, mime) => onUpdateSession({ coverBase64: b64, coverMime: mime })} />
            </div>
          )}

          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.3 }}>{session?.title || 'Untitled Book'}</div>
            {session?.description
              ? <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 5, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{session.description}</div>
              : <button onClick={() => setShowMetadata(true)} style={{ background: 'none', border: 'none', padding: 0, color: accentHex, fontSize: 12, cursor: 'pointer', marginTop: 5 }}>Add a description…</button>}
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              [DSIcons.BookOpen, (session?.chapters || []).length, 'Chapters', undefined],
              [DSIcons.Text, totalWords, 'Words', formatWords],
            ].map(([Icon, value, label, fmt]) => (
              <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border-sm)', borderRadius: 10, padding: '9px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon size={13} color={accentHex} />
                  <CountUp value={value} format={fmt} style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)' }} />
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-5)', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          <div data-tour="add-chapter" style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 'auto' }}>
            {smallBtn('New chapter', <DSIcons.Plus size={13} color="#fff" />, onNewChapter, true)}
            {smallBtn('Edit metadata', <DSIcons.Edit size={13} />, () => setShowMetadata(true))}
            {smallBtn('Export…', <DSIcons.Upload size={13} />, () => setShowExport(true))}
            {/* Greyed until a chapter is picked — it reads from that chapter on. */}
            {isSpeechSupported() && smallBtn('Read aloud', <DSIcons.Volume size={13} />, () => onReadAloud?.(selectedIdx), false, {
              disabled: selectedIdx == null,
              title: selectedIdx == null ? 'Select a chapter first — reading starts there' : 'Read aloud from the selected chapter (Ctrl+Shift+R)',
            })}
          </div>
        </div>

        {/* ── Pane 2: chapter list ──────────────────────────────────────── */}
        <div data-tour="chapters" style={{ width: 292, flexShrink: 0, borderRight: paneBorder, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid var(--border-sm)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 9px' }}>
              <DSIcons.Search size={13} style={{ color: 'var(--text-5)', flexShrink: 0 }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chapters…"
                style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: 'var(--text-1)', fontSize: 12.5, padding: '7px 0' }} />
            </div>
            <button onClick={() => setSortOrder((v) => (v === 'newest' ? 'oldest' : 'newest'))}
              title={sortOrder === 'oldest' ? 'Story order' : 'Recently edited first'}
              style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
              {sortOrder === 'oldest' ? 'Story' : 'Recent'}
            </button>
          </div>

          {/* Bulk-action bar */}
          <AnimatePresence>
            {multiSel.size > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.fast}
                style={{ overflow: 'hidden', borderBottom: '1px solid var(--border-sm)', background: 'var(--accent-a08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600, flex: 1 }}>{multiSel.size} selected</span>
                  <button onClick={bulkDelete}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, border: 'none', background: 'rgba(224,60,60,0.15)', color: '#e5484d', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                    <DSIcons.Trash size={12} /> Delete
                  </button>
                  <button onClick={() => setMultiSel(new Set())}
                    style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', color: 'var(--text-4)', fontSize: 11.5, cursor: 'pointer' }}>
                    Clear
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div variants={staggerContainer(visible.length)} initial="hidden" animate="show" style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
            {visible.length === 0 && (
              <div style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--text-5)', fontSize: 12.5 }}>
                {search ? 'No chapters match.' : 'No chapters yet.'}
              </div>
            )}
            {visible.map((chap, pos) => {
              const focused = selectedIdx === chap.chap_idx;
              const inMulti = multiSel.has(chap.chap_idx);
              return (
                <motion.div
                  key={chap.chap_idx}
                  layout variants={V.fadeRise}
                  onClick={(e) => clickRow(e, chap, pos)}
                  onDoubleClick={() => onEditChapter(chap.chap_idx)}
                  onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, chap, pos }); }}
                  className="studio-row"
                  style={{
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer', userSelect: 'none',
                    background: inMulti ? 'var(--accent-a18)' : focused ? 'var(--surface-md)' : 'transparent',
                    border: `1px solid ${inMulti ? 'var(--accent-a33)' : focused ? 'var(--border)' : 'transparent'}`,
                    marginBottom: 2,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: focused ? 700 : 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {chap.title || 'Untitled'}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-5)', flexShrink: 0 }}>{timeAgo(chap.updated || chap.created)}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-5)', marginTop: 2 }}>
                    {formatWords(chapterWords(chap))} words{chap.synopsis ? ' · synopsis' : ''}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        {/* ── Pane 3: chapter detail ────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {!selected ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-5)' }}>
              <DSIcons.BookOpen size={34} color="var(--text-5)" />
              <div style={{ fontSize: 13 }}>Select a chapter to preview it — double-click to write.</div>
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={selected.chap_idx}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.fast}
                style={{ maxWidth: 640, margin: '0 auto', padding: '26px 30px 40px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.25 }}>{selected.title || 'Untitled'}</h1>
                    <div style={{ fontSize: 12, color: 'var(--text-5)', marginTop: 6 }}>
                      {formatWords(chapterWords(selected))} words · updated {timeAgo(selected.updated || selected.created)}
                    </div>
                  </div>
                  {onChapterInfo && (
                    <motion.button whileTap={motionOK ? PRESS : undefined} onClick={() => onChapterInfo(selected.chap_idx)}
                      title="Chapter info (Ctrl+Alt+I)" aria-label="Chapter info"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 9, borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', flexShrink: 0 }}>
                      <DSIcons.Info size={15} color="currentColor" />
                    </motion.button>
                  )}
                  <motion.button whileTap={motionOK ? PRESS : undefined} onClick={() => onEditChapter(selected.chap_idx)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: accentHex, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                    <DSIcons.Edit size={14} color="#fff" /> Open in editor
                  </motion.button>
                </div>

                {/* Synopsis */}
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 7 }}>Synopsis</div>
                  {synopsisDraft != null ? (
                    <textarea
                      autoFocus rows={3} value={synopsisDraft}
                      onChange={(e) => setSynopsisDraft(e.target.value)}
                      onBlur={commitSynopsis}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
                        else if (e.key === 'Escape') setSynopsisDraft(null);
                      }}
                      placeholder="What happens in this chapter…"
                      style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', color: 'var(--text-1)', fontSize: 13, lineHeight: 1.55, outline: 'none', fontFamily: 'inherit' }}
                    />
                  ) : (
                    <div onClick={() => setSynopsisDraft(selected.synopsis || '')} title="Click to edit"
                      style={{ fontSize: 13, lineHeight: 1.6, color: selected.synopsis ? 'var(--text-2)' : 'var(--text-5)', cursor: 'text', fontStyle: selected.synopsis ? 'normal' : 'italic', padding: '2px 0' }}>
                      {selected.synopsis || 'Click to add a synopsis…'}
                    </div>
                  )}
                </div>

                {/* Prose preview */}
                <div style={{ marginTop: 22 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 7 }}>Preview</div>
                  {previewText ? (
                    <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-2)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-editor)' }}>{previewText}</div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-5)', fontStyle: 'italic' }}>This chapter is empty — open it in the editor to start writing.</div>
                  )}
                </div>

                {/* Basic details (author request: quick facts under the preview) */}
                <div style={{ marginTop: 26 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 8 }}>Details</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                    {[
                      ['Words', formatWords(chapterWords(selected))],
                      // Position = place in the STORY, not in the filtered/sorted
                      // list — searching used to make this read "1 of 12" for
                      // whatever happened to match first.
                      ['Position', `${[...(session?.chapters || [])].sort((a, b) => a.order - b.order).findIndex((c) => c.chap_idx === selected.chap_idx) + 1} of ${(session?.chapters || []).length}`],
                      ['Created', selected.created ? new Date(selected.created).toLocaleDateString() : '—'],
                      ['Updated', selected.updated ? new Date(selected.updated).toLocaleDateString() : '—'],
                    ].map(([label, value]) => (
                      <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border-sm)', borderRadius: 9, padding: '8px 11px' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{value}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-5)', marginTop: 1 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Right-click menu on chapter rows */}
      <ContextMenu
        pos={ctx}
        onClose={() => setCtx(null)}
        items={ctx && [
          { label: 'Open in editor', icon: <DSIcons.Edit size={14} />, onClick: () => onEditChapter(ctx.chap.chap_idx) },
          { label: 'Move up', icon: <DSIcons.ChevronUp size={14} />, disabled: ctx.pos === 0, onClick: () => onMoveChapter?.(ctx.chap.chap_idx, sortOrder === 'newest' ? 1 : -1) },
          { label: 'Move down', icon: <DSIcons.ChevronDown size={14} />, disabled: ctx.pos === visible.length - 1, onClick: () => onMoveChapter?.(ctx.chap.chap_idx, sortOrder === 'newest' ? -1 : 1) },
          (session?.chapters || []).length > 1 && { label: 'Delete chapter', icon: <DSIcons.Trash size={14} />, danger: true, onClick: () => setConfirmDel({ idxs: [ctx.chap.chap_idx], label: `"${ctx.chap.title}"` }) },
        ]}
      />

      {/* Chapter delete confirmation (v1.1.18 — replaces window.confirm) */}
      <ConfirmDialog
        open={!!confirmDel}
        title={`Delete ${confirmDel?.label ?? ''}?`}
        body={<>Deleted chapters are kept in the History panel <span style={{ opacity: 0.55, fontSize: 11.5, letterSpacing: 0.4 }}>Ctrl+Shift+Z</span> — you can bring the text back from there if you change your mind.</>}
        confirmLabel="Delete"
        danger
        accentHex={accentHex}
        onCancel={() => setConfirmDel(null)}
        onConfirm={runConfirmedDelete}
      />
    </div>
  );
}
