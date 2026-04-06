// ChapterRow.jsx — Individual chapter list item for BookDashboard
// Extracted from BookDashboard.jsx (v1.1.12). Zero visible change to the user.
//
// Props:
//   chap            — chapter object
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
}) {
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
          display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0',
        }}>
          {/* Reorder buttons */}
          {!showSearch && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
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

          {/* Title + timestamp — tappable to open editor */}
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

          {/* Delete button */}
          {showDelete && (
            <button
              onClick={onDeleteRequest}
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
}
