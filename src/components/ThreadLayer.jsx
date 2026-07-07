/**
 * ThreadLayer.jsx — the in-editor half of the Threads feature.
 *
 * Three pieces (see docs/threads-spec.md):
 *   • SelectionChip + action menu — select prose → a small floating chip appears
 *     (Google-Docs style); it opens a menu to add the selection to a thread,
 *     mark it TODO, drop a point pin, or start a Character Arc when the
 *     selection looks like a name. Right-click with a selection opens it too.
 *   • ThreadGutter — subtle colored bars/diamonds in the editor margin marking
 *     anchored lines. The prose itself stays unstyled (spec: no colored text).
 *   • flashAnchor() — sync-scroll + flash used for panel→prose jumps.
 *
 * Anchors are embedded in the chapter HTML:
 *   span  anchor: <span class="authno-anchor" data-authno-anchor="id">…</span>
 *   point pin:    <span class="authno-pin" data-authno-pin="id">​</span>
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { DSIcons } from '../DesignSystem';
import {
  getAllTypes, typeById, threadColor, addThread, addEntry, tid,
} from '../utils/threads';

// ── Shared CSS (flash animation, anchor resets) ───────────────────────────────
const STYLE_ID = 'authno-thread-layer-css';
function injectThreadCss() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    .authno-anchor { border-radius: 2px; }
    .authno-pin { display: inline; }
    @keyframes authnoAnchorFlash {
      0%   { background: var(--accent-a33); box-shadow: 0 0 0 4px var(--accent-a33); }
      100% { background: transparent; box-shadow: none; }
    }
    .authno-anchor-flash { animation: authnoAnchorFlash 1.4s ease-out; }
  `;
  document.head.appendChild(el);
}

/** Scroll an anchor into view and flash it. Returns false if not in the DOM. */
export function flashAnchor(editorEl, anchorId) {
  if (!editorEl) return false;
  const el = editorEl.querySelector(`[data-authno-anchor="${anchorId}"],[data-authno-pin="${anchorId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('authno-anchor-flash');
  // restart the animation
  void el.offsetWidth; // eslint-disable-line no-unused-expressions
  el.classList.add('authno-anchor-flash');
  setTimeout(() => el.classList.remove('authno-anchor-flash'), 1500);
  return true;
}

// ── Name heuristic for "Start a Character Arc from …" ─────────────────────────
function looksLikeName(text) {
  const t = text.trim();
  return /^[A-Z][a-zA-Z'’-]{1,20}(?: [A-Z][a-zA-Z'’-]{1,20}){0,2}$/.test(t);
}

// ── Anchor creation on the live editor DOM ────────────────────────────────────
function wrapSelectionAsAnchor(range, anchorId) {
  const span = document.createElement('span');
  span.className = 'authno-anchor';
  span.setAttribute('data-authno-anchor', anchorId);
  try {
    range.surroundContents(span);
  } catch {
    // Selection crosses element boundaries — extract and rewrap.
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
}

function insertPinAt(range, anchorId) {
  const pin = document.createElement('span');
  pin.className = 'authno-pin';
  pin.setAttribute('data-authno-pin', anchorId);
  pin.appendChild(document.createTextNode('​')); // keeps the node editable-safe
  const r = range.cloneRange();
  r.collapse(false);
  r.insertNode(pin);
}

// ── SelectionChip + menu ──────────────────────────────────────────────────────

export function ThreadSelectionLayer({
  editorRef, data, onChangeData, onEditContent, onOpenThread, accentHex,
}) {
  const [sel, setSel] = useState(null);          // { rect, text }
  const [menuOpen, setMenuOpen] = useState(false);
  const [todoMode, setTodoMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTypeId, setNewTypeId] = useState(null); // typeId when creating inline
  const savedRange = useRef(null);

  useEffect(() => { injectThreadCss(); }, []);

  // Track selection inside the editor.
  useEffect(() => {
    const onSel = () => {
      if (menuOpen) return; // freeze while the menu is open
      const s = window.getSelection();
      const editorEl = editorRef?.current;
      if (!s || s.isCollapsed || !s.rangeCount || !editorEl) { setSel(null); return; }
      const range = s.getRangeAt(0);
      if (!editorEl.contains(range.commonAncestorContainer)) { setSel(null); return; }
      const text = s.toString();
      if (!text.trim()) { setSel(null); return; }
      const rect = range.getBoundingClientRect();
      savedRange.current = range.cloneRange();
      setSel({ rect, text });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [editorRef, menuOpen]);

  // Right-click with a selection also opens the menu (Electron has no native menu).
  useEffect(() => {
    const editorEl = editorRef?.current;
    if (!editorEl) return;
    const onCtx = (e) => {
      if (sel && savedRange.current) { e.preventDefault(); setMenuOpen(true); }
    };
    editorEl.addEventListener('contextmenu', onCtx);
    return () => editorEl.removeEventListener('contextmenu', onCtx);
  }, [editorRef, sel]);

  const closeAll = useCallback(() => {
    setMenuOpen(false); setSel(null); setTodoMode(false); setPinMode(false);
    setNewName(''); setNewTypeId(null);
  }, []);

  const commitToThread = useCallback((threadId, dataOverride) => {
    const editorEl = editorRef?.current;
    const range = savedRange.current;
    if (!editorEl || !range) { closeAll(); return; }
    const text = range.toString().trim();
    const anchorId = tid('an');
    if (pinMode) insertPinAt(range, anchorId);
    else wrapSelectionAsAnchor(range, anchorId);
    // Persist the mutated HTML through the normal edit path (caret-safe).
    onEditContent(editorEl.innerHTML);
    const base = dataOverride ?? data;
    const { data: next } = addEntry(base, threadId, {
      text: text.length > 120 ? `${text.slice(0, 117)}…` : (text || 'Pinned spot'),
      anchorIds: [anchorId],
      todo: todoMode,
    });
    onChangeData(next);
    window.getSelection()?.removeAllRanges();
    closeAll();
    onOpenThread?.(threadId);
  }, [editorRef, data, onChangeData, onEditContent, onOpenThread, pinMode, todoMode, closeAll]);

  const createThreadAndCommit = useCallback((typeId, name, meta = {}) => {
    const { data: withThread, thread } = addThread(data, { typeId, name, meta });
    commitToThread(thread.id, withThread);
  }, [data, commitToThread]);

  if (!sel) return null;

  const chipTop = Math.max(8, sel.rect.top - 38);
  const chipLeft = Math.min(Math.max(8, sel.rect.left + sel.rect.width / 2 - 16), window.innerWidth - 48);
  const types = getAllTypes(data);
  const nameish = looksLikeName(sel.text);

  return (
    <>
      {/* Floating chip */}
      {!menuOpen && (
        <button
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); setMenuOpen(true); }}
          title="Add to a thread…"
          style={{
            position: 'fixed', top: chipTop, left: chipLeft, zIndex: 3000,
            width: 32, height: 32, borderRadius: 16,
            background: 'var(--modal-bg)', border: `1.5px solid ${accentHex}66`,
            color: accentHex, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          }}
        >
          <DSIcons.Tag size={15} color="currentColor" />
        </button>
      )}

      {/* Action menu */}
      {menuOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 3001 }} onMouseDown={closeAll} />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', zIndex: 3002,
              top: Math.min(chipTop, window.innerHeight - 380),
              left: Math.min(Math.max(8, chipLeft - 110), window.innerWidth - 268),
              width: 260, maxHeight: 360, overflowY: 'auto',
              background: 'var(--modal-bg)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 8,
              boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
            }}
          >
            {/* Mode toggles */}
            <div style={{ display: 'flex', gap: 6, padding: '2px 4px 8px' }}>
              {[
                { on: todoMode, set: setTodoMode, label: 'TODO', Icon: DSIcons.Check },
                { on: pinMode,  set: setPinMode,  label: 'Pin',  Icon: DSIcons.Pin },
              ].map(({ on, set, label, Icon }) => (
                <button key={label} onClick={() => set(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                    border: `1px solid ${on ? accentHex : 'var(--border)'}`,
                    background: on ? `${accentHex}18` : 'transparent',
                    color: on ? accentHex : 'var(--text-4)', cursor: 'pointer',
                  }}>
                  <Icon size={11} color="currentColor" /> {label}
                </button>
              ))}
            </div>

            {/* Quick character-arc from a name-looking selection */}
            {nameish && (
              <button
                onClick={() => createThreadAndCommit('character-arc', `${sel.text.trim()}'s arc`, { character: sel.text.trim() })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '9px 10px', borderRadius: 8, border: `1px dashed ${accentHex}66`,
                  background: `${accentHex}0d`, color: accentHex, fontSize: 12.5, fontWeight: 600,
                  cursor: 'pointer', textAlign: 'left', marginBottom: 6,
                }}>
                <DSIcons.User size={13} color="currentColor" />
                Start a Character Arc for “{sel.text.trim()}”
              </button>
            )}

            {/* Existing threads */}
            {data.threads.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
                {data.threads.map(t => (
                  <button key={t.id} onClick={() => commitToThread(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '8px 10px', borderRadius: 8, border: 'none',
                      background: 'transparent', color: 'var(--text-2)', fontSize: 13,
                      cursor: 'pointer', textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: threadColor(data, t), flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-5)' }}>{typeById(data, t.typeId).name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* New thread inline (per type) */}
            <div style={{ borderTop: '1px solid var(--border-sm)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {types.map(ty => (
                newTypeId === ty.id ? (
                  <div key={ty.id} style={{ display: 'flex', gap: 6, padding: '4px 4px' }}>
                    <input
                      autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                      placeholder={`New ${ty.name} name…`}
                      onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createThreadAndCommit(ty.id, newName); if (e.key === 'Escape') setNewTypeId(null); }}
                      style={{ flex: 1, minWidth: 0, padding: '7px 9px', borderRadius: 8, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none' }}
                    />
                    <button onClick={() => newName.trim() && createThreadAndCommit(ty.id, newName)}
                      style={{ padding: '0 12px', borderRadius: 8, border: 'none', background: accentHex, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      Add
                    </button>
                  </div>
                ) : (
                  <button key={ty.id} onClick={() => { setNewTypeId(ty.id); setNewName(''); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '7px 10px', borderRadius: 8, border: 'none',
                      background: 'transparent', color: 'var(--text-4)', fontSize: 12.5,
                      cursor: 'pointer', textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <DSIcons.Plus size={12} color="currentColor" /> New {ty.name}…
                  </button>
                )
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Gutter markers ────────────────────────────────────────────────────────────

export function ThreadGutter({ editorRef, containerRef, session, data, onMarkerClick, contentVersion }) {
  const [marks, setMarks] = useState([]);

  useEffect(() => {
    const editorEl = editorRef?.current;
    const containerEl = containerRef?.current;
    if (!editorEl || !containerEl) { setMarks([]); return; }

    // anchorId → { color, threadId, entryId, pin }
    const anchorInfo = new Map();
    for (const t of data.threads) {
      for (const e of t.entries) {
        for (const id of e.anchorIds || []) {
          if (!anchorInfo.has(id)) anchorInfo.set(id, { color: threadColor(data, t), threadId: t.id, entryId: e.id });
        }
      }
    }

    const compute = () => {
      const contRect = containerEl.getBoundingClientRect();
      const next = [];
      editorEl.querySelectorAll('[data-authno-anchor],[data-authno-pin]').forEach(el => {
        const id = el.getAttribute('data-authno-anchor') || el.getAttribute('data-authno-pin');
        const info = anchorInfo.get(id);
        if (!info) return; // orphaned markup — no owning entry
        const r = el.getBoundingClientRect();
        next.push({
          id,
          top: r.top - contRect.top + containerEl.scrollTop,
          height: Math.max(14, Math.min(r.height, 120)),
          pin: el.hasAttribute('data-authno-pin'),
          ...info,
        });
      });
      setMarks(next);
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [editorRef, containerRef, session?.id, session?._editingChap, data, contentVersion]);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: 12, bottom: 0, pointerEvents: 'none', zIndex: 5 }}>
      {marks.map(m => (
        <div
          key={m.id}
          onClick={() => onMarkerClick?.(m.threadId, m.entryId, m.id)}
          title="Open thread"
          style={m.pin ? {
            position: 'absolute', top: m.top + 2, left: 2,
            width: 8, height: 8, background: m.color,
            transform: 'rotate(45deg)', borderRadius: 2,
            cursor: 'pointer', pointerEvents: 'auto', opacity: 0.9,
          } : {
            position: 'absolute', top: m.top, left: 3,
            width: 4, height: m.height, background: m.color,
            borderRadius: 2, cursor: 'pointer', pointerEvents: 'auto', opacity: 0.8,
          }}
        />
      ))}
    </div>
  );
}
