/**
 * QuickSwitcher.jsx — Ctrl+K command palette (desktop refinement, Q4-C).
 *
 * VS Code / Linear style: type to filter across books, chapters and actions;
 * ↑/↓ to move, Enter to run, Esc to close. Mounted once in App (desktop only);
 * App owns the open state and passes navigation callbacks.
 *
 * Search corpus:
 *   books    → open the book dashboard
 *   chapters → "Book › Chapter" → open that chapter in the editor
 *   actions  → New book, Settings, Home
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { DSIcons } from '../DesignSystem';
import { T } from '../utils/motion';

function score(hay, q) {
  // Cheap subsequence match: exact substring beats subsequence beats nothing.
  const h = hay.toLowerCase(), s = q.toLowerCase();
  if (!s) return 1;
  const idx = h.indexOf(s);
  if (idx >= 0) return 1000 - idx;
  let i = 0;
  for (const ch of h) { if (ch === s[i]) i++; if (i === s.length) return 10; }
  return 0;
}

export default function QuickSwitcher({ open, onClose, sessions = [], accentHex, onOpenBook, onOpenChapter, onNewBook, onOpenSettings, onGoHome }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const entries = useMemo(() => {
    const out = [];
    for (const s of sessions) {
      out.push({ kind: 'book', label: s.title || 'Untitled Book', sub: `${(s.chapters || []).length} chapters`, icon: <DSIcons.Book size={15} />, run: () => onOpenBook?.(s.id) });
      for (const c of s.chapters || []) {
        out.push({ kind: 'chapter', label: `${s.title || 'Untitled'} › ${c.title || 'Untitled'}`, sub: 'Chapter', icon: <DSIcons.FileText size={15} />, run: () => onOpenChapter?.(s.id, c.chap_idx) });
      }
    }
    out.push({ kind: 'action', label: 'New book', sub: 'Action', icon: <DSIcons.FilePlus size={15} />, run: () => onNewBook?.() });
    out.push({ kind: 'action', label: 'Open settings', sub: 'Action', icon: <DSIcons.Settings size={15} />, run: () => onOpenSettings?.() });
    out.push({ kind: 'action', label: 'Go home', sub: 'Action', icon: <DSIcons.Home size={15} />, run: () => onGoHome?.() });
    return out;
  }, [sessions, onOpenBook, onOpenChapter, onNewBook, onOpenSettings, onGoHome]);

  const results = useMemo(() => {
    const scored = entries.map((e) => ({ e, s: score(e.label, q) })).filter((x) => x.s > 0);
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 12).map((x) => x.e);
  }, [entries, q]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    // Keep the highlighted row in view while arrowing through results.
    listRef.current?.children?.[sel]?.scrollIntoView?.({ block: 'nearest' });
  }, [sel]);

  const run = (entry) => { onClose?.(); entry?.run?.(); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose?.(); }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="qs-overlay"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.fast}
          style={{ position: 'fixed', inset: 0, zIndex: 12000, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -4 }} transition={T.fast}
            style={{ width: 'min(560px, 92vw)', background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 32px 90px rgba(0,0,0,0.6)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border-sm)' }}>
              <DSIcons.Search size={16} style={{ color: 'var(--text-4)', flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Jump to a book or chapter, or run an action…"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-1)', fontSize: 14.5 }}
              />
              <span style={{ fontSize: 10.5, color: 'var(--text-5)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px', flexShrink: 0 }}>ESC</span>
            </div>
            <div ref={listRef} style={{ maxHeight: 330, overflowY: 'auto', padding: 6 }}>
              {results.length === 0 && (
                <div style={{ padding: '22px 0', textAlign: 'center', color: 'var(--text-5)', fontSize: 13 }}>No matches.</div>
              )}
              {results.map((r, i) => (
                <button
                  key={`${r.kind}-${r.label}-${i}`}
                  onClick={() => run(r)}
                  onMouseEnter={() => setSel(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '9px 10px', borderRadius: 9, border: 'none', textAlign: 'left', cursor: 'pointer',
                    background: i === sel ? 'var(--accent-a18)' : 'transparent',
                    color: i === sel ? 'var(--text-1)' : 'var(--text-2)',
                  }}
                >
                  <span style={{ display: 'inline-flex', width: 18, justifyContent: 'center', color: i === sel ? accentHex : 'var(--text-4)', flexShrink: 0 }}>{r.icon}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5 }}>{r.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-5)', flexShrink: 0 }}>{r.sub}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
