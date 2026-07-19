// ChapterRow.jsx — Individual chapter list item for BookDashboard
// Extracted from BookDashboard.jsx (v1.1.12).
//
// Props:
//   chap            — chapter object (title, updated/created, synopsis?)
//   isLast          — bool, omits bottom border
//   isPendingDel    — bool, shows inline delete confirmation
//   canMoveUp       — bool
//   canMoveDown     — bool
//   showSearch      — bool, hides reorder buttons while searching
//   showDelete      — bool (chapters.length > 1)
//   light           — bool, light-mode flag
//   onEdit()        — open chapter in editor
//   onMoveUp()      — reorder up
//   onMoveDown()    — reorder down
//   onDeleteRequest()  — enter pending-delete state
//   onDeleteConfirm()  — confirm deletion
//   onDeleteCancel()   — cancel deletion
//   onSynopsisChange(text) — persist an edited chapter synopsis (optional)

import { useState } from 'react';

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

export function ChapterRow({
  chap,
  isLast,
  isPendingDel,
  canMoveUp,
  canMoveDown,
  showSearch,
  showDelete,
  light,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onSynopsisChange,
  onRename,
}) {
  const [editingSynopsis, setEditingSynopsis] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const synopsis = (chap.synopsis || '').trim();
  const canEditSynopsis = typeof onSynopsisChange === 'function';
  const canRename = typeof onRename === 'function';

  const startRename = () => { setTitleDraft(chap.title || ''); setEditingTitle(true); };
  const commitRename = () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next && next !== (chap.title || '')) onRename(next);
  };

  const startEdit = () => { setDraft(chap.synopsis || ''); setEditingSynopsis(true); };
  const commit = () => {
    setEditingSynopsis(false);
    if (draft.trim() !== synopsis) onSynopsisChange(draft);
  };
  const cancel = () => setEditingSynopsis(false);

  const subtleBorder = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)';

  return (
    <div style={{
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
            <button onClick={onDeleteCancel} style={{
              padding: '6px 14px', borderRadius: '8px',
              border: `1px solid ${light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)'}`,
              background: 'none', color: 'var(--text-3)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={onDeleteConfirm} style={{
              padding: '6px 14px', borderRadius: '8px', border: 'none',
              background: '#e03c3c', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            }}>Delete</button>
          </div>
        </div>
      ) : (
        /* ── Normal row ── */
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px 0',
        }}>
          {/* Reorder buttons */}
          {!showSearch && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0, marginTop: '1px' }}>
              <button
                onClick={onMoveUp}
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
                onClick={onMoveDown}
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

          {/* Title + synopsis column */}
          <div data-tour="chapter-row" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {/* Title + timestamp — tappable to open editor, with a rename pencil */}
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                  else if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); }
                }}
                placeholder="Chapter title"
                style={{
                  width: '100%', boxSizing: 'border-box', fontSize: '15px', fontWeight: 600,
                  color: 'var(--text-1)', background: light ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${subtleBorder}`, borderRadius: '8px', padding: '5px 8px', outline: 'none',
                }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                <button onClick={onEdit} style={{
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
                {canRename && (
                  <button
                    data-tour="rename-chapter"
                    onClick={startRename}
                    aria-label={`Rename ${chap.title}`}
                    title="Rename chapter"
                    style={{
                      width: '30px', height: '30px', flexShrink: 0, borderRadius: '8px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'none', border: `1px solid ${subtleBorder}`, cursor: 'pointer',
                      color: 'var(--text-4)', padding: 0,
                    }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Synopsis — inline tap-to-edit */}
            {canEditSynopsis && (
              editingSynopsis ? (
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                  }}
                  placeholder="Write a short synopsis…"
                  rows={2}
                  style={{
                    width: '100%', resize: 'none', boxSizing: 'border-box',
                    fontSize: '13px', lineHeight: 1.5, color: 'var(--text-2)',
                    background: light ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${subtleBorder}`, borderRadius: '8px',
                    padding: '6px 8px', outline: 'none', fontFamily: 'inherit',
                  }}
                />
              ) : synopsis ? (
                <div
                  onClick={startEdit}
                  title="Tap to edit synopsis"
                  style={{
                    fontSize: '13px', lineHeight: 1.5, color: 'var(--text-4)', cursor: 'text',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {synopsis}
                </div>
              ) : (
                <button
                  onClick={startEdit}
                  style={{
                    alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0,
                    cursor: 'pointer', fontSize: '12.5px', color: 'var(--text-5)', fontStyle: 'italic',
                  }}
                >
                  + Add synopsis
                </button>
              )
            )}
          </div>

          {/* Delete button — a tinted, finger-sized target so it's actually
              discoverable/tappable on mobile (the faint 28px icon was missed). */}
          {showDelete && (
            <button
              onClick={onDeleteRequest}
              aria-label={`Delete ${chap.title}`}
              title="Delete chapter"
              style={{
                width: '36px', height: '36px', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: light ? 'rgba(224,60,60,0.08)' : 'rgba(224,60,60,0.14)',
                border: `1px solid ${light ? 'rgba(224,60,60,0.20)' : 'rgba(224,60,60,0.28)'}`,
                cursor: 'pointer', color: '#e5484d', borderRadius: '9px', padding: 0,
                transition: 'background 0.12s',
              }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
