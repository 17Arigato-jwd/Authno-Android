/**
 * NotesPanel.jsx — quick capture, in the app.
 *
 * A sheet that opens over whatever you were doing, lists what you have jotted
 * down, and gets out of the way. Two states only: the list, and one note open.
 * There is no title field, no folder, no tag — inventing a name for an idea is
 * the friction this exists to remove.
 *
 * The store is src/utils/notes.js and it is deliberately not the per-book
 * `notes` array in the .authbook format: capture must not depend on a book
 * being open, loaded, or existing.
 *
 * The home-screen widget that would make this genuinely "on the go" is not
 * built yet — see docs/todo/notes-widget.md. buildNotesPayload() in the store
 * is the part of it that can be written and tested without a device, and it
 * is already there.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { DSIcons, CloseButton } from '../DesignSystem';
import { useMotionEnabled, T } from '../utils/motion';
import {
  listNotes, createNote, updateNote, deleteNote,
  togglePinned, discardIfEmpty, noteTitle, notePreview,
} from '../utils/notes';

/** Same debounce idea as the editor: save as you type, without a save button. */
const SAVE_DEBOUNCE_MS = 600;

export default function NotesPanel({ isOpen, onClose, accentHex = '#5a00d9' }) {
  const motionOK = useMotionEnabled();
  const [notes, setNotes] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState('');
  const saveTimer = useRef(null);
  const areaRef = useRef(null);

  const refresh = useCallback(() => setNotes(listNotes()), []);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    setOpenId(null);
  }, [isOpen, refresh]);

  // Flush the pending edit before the sheet goes away. Without this, closing
  // within the debounce window loses whatever was typed last — the exact
  // moment a quick note is most likely to be closed.
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (openId) updateNote(openId, { body: draft });
  }, [openId, draft]);

  useEffect(() => {
    if (!openId) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => updateNote(openId, { body: draft }), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(saveTimer.current);
  }, [draft, openId]);

  const openNote = (id) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    setOpenId(id);
    setDraft(n.body);
    // After the sheet has painted, or the caret lands nowhere.
    requestAnimationFrame(() => areaRef.current?.focus());
  };

  const startNew = () => {
    const n = createNote('');
    setOpenId(n.id);
    setDraft('');
    refresh();
    requestAnimationFrame(() => areaRef.current?.focus());
  };

  /** Back to the list, dropping the note if nothing was typed into it. */
  const closeNote = useCallback(() => {
    flush();
    if (openId) discardIfEmpty(openId);
    setOpenId(null);
    setDraft('');
    refresh();
  }, [flush, openId, refresh]);

  const closeAll = useCallback(() => {
    flush();
    if (openId) discardIfEmpty(openId);
    setOpenId(null);
    setDraft('');
    onClose?.();
  }, [flush, openId, onClose]);

  // Escape steps back one level rather than closing outright — losing the
  // list because you wanted to leave a note is a surprise.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (openId) closeNote(); else closeAll();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, openId, closeNote, closeAll]);

  if (!isOpen) return null;

  const openNoteRecord = openId ? notes.find((n) => n.id === openId) : null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="notes-backdrop"
        initial={motionOK ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={T.fast}
        onClick={closeAll}
        style={{
          position: 'fixed', inset: 0, zIndex: 1400,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}
      >
        <motion.div
          key="notes-sheet"
          initial={motionOK ? { y: 24, opacity: 0 } : false}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={T.base}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(560px, 100%)', maxHeight: '88vh',
            display: 'flex', flexDirection: 'column',
            background: 'var(--modal-bg)',
            border: '1px solid var(--border)',
            borderBottom: 'none',
            borderRadius: '20px 20px 0 0',
            overflow: 'hidden',
          }}
        >
          {/* ── Header ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 16px', borderBottom: '1px solid var(--border-sm)',
          }}>
            {openId ? (
              <button
                onClick={closeNote}
                aria-label="Back to notes"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'inline-flex', color: 'var(--text-3)' }}
              >
                <DSIcons.ChevronLeft size={18} color="currentColor" />
              </button>
            ) : (
              <DSIcons.Edit size={17} color={accentHex} />
            )}
            <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
              {openId ? (noteTitle(openNoteRecord ?? { body: draft }, 32)) : 'Notes'}
            </span>

            {openId && (
              <>
                <button
                  onClick={() => { togglePinned(openId); refresh(); }}
                  aria-label={openNoteRecord?.pinned ? 'Unpin note' : 'Pin note'}
                  title={openNoteRecord?.pinned ? 'Unpin' : 'Pin to the top'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'inline-flex' }}
                >
                  <DSIcons.Pin size={16} color={openNoteRecord?.pinned ? accentHex : 'var(--text-4)'} />
                </button>
                <button
                  onClick={() => { const id = openId; setOpenId(null); setDraft(''); deleteNote(id); refresh(); }}
                  aria-label="Delete note"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'inline-flex' }}
                >
                  <DSIcons.Trash size={16} color="var(--text-4)" />
                </button>
              </>
            )}
            <CloseButton onClick={closeAll} />
          </div>

          {/* ── Body ── */}
          {openId ? (
            <textarea
              ref={areaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type the idea. It saves itself."
              spellCheck
              style={{
                flex: 1, minHeight: 260, resize: 'none',
                padding: '16px', border: 'none', outline: 'none',
                background: 'transparent', color: 'var(--text-1)',
                fontSize: 15, lineHeight: 1.6, fontFamily: 'inherit',
              }}
            />
          ) : (
            <div style={{ overflowY: 'auto', padding: notes.length ? '8px' : '0' }}>
              {notes.length === 0 ? (
                <div style={{ padding: '38px 24px', textAlign: 'center', color: 'var(--text-4)', fontSize: 13.5, lineHeight: 1.6 }}>
                  Nothing here yet.<br />
                  Notes are for the idea you get before you know where it goes.
                </div>
              ) : notes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNote(n.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '11px 12px', marginBottom: 4,
                    background: 'transparent', border: '1px solid transparent',
                    borderRadius: 10, cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {n.pinned && <DSIcons.Pin size={11} color={accentHex} />}
                    <span style={{
                      flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-1)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{noteTitle(n)}</span>
                  </span>
                  {notePreview(n) && (
                    <span style={{
                      display: 'block', marginTop: 2, fontSize: 12, color: 'var(--text-4)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{notePreview(n)}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ── New note ── */}
          {!openId && (
            <div style={{ padding: '10px 14px 16px', borderTop: '1px solid var(--border-sm)' }}>
              <button
                onClick={startNew}
                style={{
                  width: '100%', padding: '11px', borderRadius: 12, border: 'none',
                  background: accentHex, color: 'var(--on-accent, #fff)',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                }}
              >
                <DSIcons.FilePlus size={15} color="var(--on-accent, #fff)" />
                New note
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
