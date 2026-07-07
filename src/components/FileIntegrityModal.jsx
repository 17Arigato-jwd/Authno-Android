import { useState } from 'react';

import { createPortal } from 'react-dom';
import { GradientButton, MinimalButton, COLORS, DSIcons } from '../DesignSystem';

/**
 * Shown on startup when one or more saved file paths are no longer accessible.
 *
 * Props:
 *   brokenSessions  — array of session objects that failed the URI check
 *   accentHex       — accent colour string
 *   onRemove(id)    — called when the user chooses to remove a book from the sidebar
 *   onSaveAs(id)    — called when the user chooses to re-save a book to a new location
 *   onDismiss()     — called when all items have been resolved or user closes
 */
export default function FileIntegrityModal({ brokenSessions, accentHex, onRemove, onSaveAs, onDismiss }) {
  const [resolved, setResolved] = useState(new Set());
  const [savingId, setSavingId] = useState(null);

  const remaining = brokenSessions.filter(s => !resolved.has(s.id));

  if (remaining.length === 0) return null;

  const handleRemove = (id) => {
    onRemove(id);
    setResolved(prev => new Set([...prev, id]));
    if (resolved.size + 1 >= brokenSessions.length) onDismiss();
  };

  const handleSaveAs = async (session) => {
    setSavingId(session.id);
    try {
      await onSaveAs(session);
      setResolved(prev => new Set([...prev, session.id]));
      if (resolved.size + 1 >= brokenSessions.length) onDismiss();
    } finally {
      setSavingId(null);
    }
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(6px)',
    }}>
      <div style={{
        background: 'var(--modal-bg)',
        border: '1px solid var(--border)',
        borderRadius: '20px', padding: '24px',
        maxWidth: '420px', width: '92%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <DSIcons.Warning size={20} color="var(--color-warning)" />
          <span style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-1)' }}>
            File{remaining.length > 1 ? 's' : ''} No Longer Accessible
          </span>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-4)', lineHeight: 1.6, marginBottom: '20px' }}>
          {remaining.length === 1
            ? 'This book was saved to a location that can no longer be accessed — it may have been moved or deleted.'
            : `${remaining.length} books were saved to locations that can no longer be accessed — they may have been moved or deleted.`
          }
        </p>

        {/* Book list */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
          {remaining.map(session => (
            <div key={session.id} style={{
              background: 'var(--surface)',
              border: '1px solid var(--border-sm)',
              borderRadius: '14px', padding: '14px 16px',
            }}>
              <div style={{
                fontSize: '14px', fontWeight: 700, color: 'var(--text-1)',
                marginBottom: '10px',
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                <DSIcons.BookOpen size={14} color="currentColor" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.title || 'Untitled Book'}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleSaveAs(session)}
                  disabled={savingId === session.id}
                  style={{
                    flex: 1, padding: '8px', borderRadius: '10px', border: 'none',
                    background: accentHex, color: '#fff',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                    opacity: savingId === session.id ? 0.6 : 1,
                  }}
                >
                  <DSIcons.Save size={13} />
                  {savingId === session.id ? 'Saving…' : 'Save to New Location'}
                </button>
                <button
                  onClick={() => handleRemove(session.id)}
                  disabled={savingId === session.id}
                  style={{
                    flex: 1, padding: '8px', borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)', color: 'var(--color-danger)',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                  }}
                >
                  <DSIcons.Trash size={13} />
                  Remove from Sidebar
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          style={{
            marginTop: '18px', width: '100%', padding: '10px',
            borderRadius: '10px', border: '1px solid var(--border-sm)',
            background: 'transparent', color: 'var(--text-4)',
            fontSize: '13px', cursor: 'pointer',
          }}
        >
          Remind me later
        </button>
      </div>
    </div>,
    document.body
  );
}
