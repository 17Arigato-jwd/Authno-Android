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
import { hapticNodeConnect, hapticPin, hapticSelect } from '../utils/haptics';
import { isAndroid } from '../utils/platform';
import { selectAllIn, insertTextAtSelection } from '../utils/editorFormat';

// ── Shared CSS (anchor resets only — the flash uses the Web Animations API) ──
const STYLE_ID = 'authno-thread-layer-css';
function injectThreadCss() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    .authno-anchor { border-radius: 2px; }
    .authno-pin { display: inline; }
  `;
  document.head.appendChild(el);
}

/**
 * Scroll an anchor into view and flash it. Returns false if not in the DOM.
 * Uses element.animate() rather than a CSS class: the editor serializes
 * innerHTML on every input, so a temporary class would get captured into the
 * saved chapter HTML if the user typed mid-flash and replay forever after.
 */
export function flashAnchor(editorEl, anchorId) {
  if (!editorEl) return false;
  const el = editorEl.querySelector(`[data-authno-anchor="${anchorId}"],[data-authno-pin="${anchorId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-a33').trim() || 'rgba(128,128,128,0.4)';
    el.animate(
      [
        { backgroundColor: accent, boxShadow: `0 0 0 4px ${accent}` },
        { backgroundColor: 'transparent', boxShadow: 'none' },
      ],
      { duration: 1400, easing: 'ease-out' }
    );
  } catch { /* WAAPI unavailable — the scroll alone still locates the spot */ }
  return true;
}

// ── Name heuristic for "Start a Character Arc from …" ─────────────────────────
function looksLikeName(text) {
  const t = text.trim();
  return /^[A-Z][a-zA-Z'’-]{1,20}(?: [A-Z][a-zA-Z'’-]{1,20}){0,2}$/.test(t);
}

// ── Anchor creation on the live editor DOM ────────────────────────────────────
// Insert through document.execCommand('insertHTML') so the operation joins the
// contentEditable's native undo stack (the whole editor is execCommand-based) —
// raw DOM mutation here would sever Ctrl+Z history at the tag point. Falls back
// to direct DOM surgery only if insertHTML is unavailable.

function rangeToHtml(range) {
  const div = document.createElement('div');
  div.appendChild(range.cloneContents());
  return div.innerHTML;
}

function execInsertAtRange(range, html) {
  const s = window.getSelection();
  if (!s) return false;
  s.removeAllRanges();
  s.addRange(range);
  try { return document.execCommand('insertHTML', false, html); } catch { return false; }
}

function wrapSelectionAsAnchor(range, anchorId) {
  const inner = rangeToHtml(range);
  const html = `<span class="authno-anchor" data-authno-anchor="${anchorId}">${inner}</span>`;
  if (execInsertAtRange(range, html)) return;
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

const PIN_HTML = (anchorId) => `<span class="authno-pin" data-authno-pin="${anchorId}">​</span>`;

function insertPinAt(range, anchorId) {
  const r = range.cloneRange();
  r.collapse(false);
  if (execInsertAtRange(r, PIN_HTML(anchorId))) return;
  const pin = document.createElement('span');
  pin.className = 'authno-pin';
  pin.setAttribute('data-authno-pin', anchorId);
  pin.appendChild(document.createTextNode('​'));
  r.insertNode(pin);
}

// ── SelectionChip + menu ──────────────────────────────────────────────────────

export function ThreadSelectionLayer({
  editorRef, data, onChangeData, onEditContent, onOpenThread, accentHex,
}) {
  const [sel, setSel] = useState(null);          // { rect, text }
  const [menuOpen, setMenuOpen] = useState(false);
  const [caretOnly, setCaretOnly] = useState(false); // menu opened at a bare caret
  const [todoMode, setTodoMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTypeId, setNewTypeId] = useState(null); // typeId when creating inline
  const savedRange = useRef(null);

  useEffect(() => { injectThreadCss(); }, []);

  // Track selection inside the editor. Coalesced to one measurement per frame —
  // selectionchange fires per caret step (drag / shift+arrow), and reading
  // getBoundingClientRect on each event forces synchronous layout.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
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
    const onSel = () => { if (!raf) raf = requestAnimationFrame(measure); };
    document.addEventListener('selectionchange', onSel);
    return () => { document.removeEventListener('selectionchange', onSel); if (raf) cancelAnimationFrame(raf); };
  }, [editorRef, menuOpen]);

  // The chip/menu are fixed-positioned from a rect captured at selection time;
  // scrolling moves the text out from under them, so dismiss on any scroll.
  useEffect(() => {
    if (!sel && !menuOpen) return;
    const onScroll = () => { setMenuOpen(false); setSel(null); };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [sel, menuOpen]);

  // Right-click opens the menu (Electron has no native menu). With a selection
  // it's the full menu; at a bare caret it's the clipboard-only variant — the
  // native Android toolbar is suppressed (MainActivity), so Paste must live here.
  useEffect(() => {
    const editorEl = editorRef?.current;
    if (!editorEl) return;
    const openAtCaret = (x, y) => {
      const s = window.getSelection();
      if (s?.rangeCount) savedRange.current = s.getRangeAt(0).cloneRange();
      setSel({ rect: { top: y, left: x, width: 0 }, text: '' });
      setCaretOnly(true);
      setMenuOpen(true);
    };
    const onCtx = (e) => {
      e.preventDefault();
      if (sel?.text && savedRange.current) { setCaretOnly(false); setMenuOpen(true); }
      else openAtCaret(e.clientX, e.clientY);
    };
    // Android: long-press at a bare caret (selection long-press is handled by
    // the chip; this covers paste-at-caret since the native toolbar is gone).
    let timer = null, sx = 0, sy = 0;
    const onTouchStart = (e) => {
      const t = e.touches?.[0]; if (!t) return;
      sx = t.clientX; sy = t.clientY;
      timer = setTimeout(() => {
        const s = window.getSelection();
        if (s && s.isCollapsed) { hapticSelect(); openAtCaret(sx, sy); }
      }, 550);
    };
    const onTouchMove = (e) => {
      const t = e.touches?.[0]; if (!t) return;
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) clearTimeout(timer);
    };
    const onTouchEnd = () => clearTimeout(timer);
    editorEl.addEventListener('contextmenu', onCtx);
    editorEl.addEventListener('touchstart', onTouchStart, { passive: true });
    editorEl.addEventListener('touchmove', onTouchMove, { passive: true });
    editorEl.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      clearTimeout(timer);
      editorEl.removeEventListener('contextmenu', onCtx);
      editorEl.removeEventListener('touchstart', onTouchStart);
      editorEl.removeEventListener('touchmove', onTouchMove);
      editorEl.removeEventListener('touchend', onTouchEnd);
    };
  }, [editorRef, sel]);

  const closeAll = useCallback(() => {
    setMenuOpen(false); setSel(null); setTodoMode(false); setPinMode(false);
    setNewName(''); setNewTypeId(null); setCaretOnly(false);
  }, []);

  // PC: finishing a selection opens the full menu directly (Docs/Word style)
  // — the intermediate tag chip is a mobile affordance. Opens on mouse
  // release, never mid-drag.
  const desktop = !isAndroid();
  useEffect(() => {
    if (!desktop) return undefined;
    const editorEl = editorRef?.current;
    if (!editorEl) return undefined;
    const onMouseUp = () => {
      setTimeout(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) return;
        if (!editorEl.contains(s.getRangeAt(0).commonAncestorContainer)) return;
        if (!s.toString().trim()) return;
        setCaretOnly(false);
        setMenuOpen(true);
      }, 0);
    };
    editorEl.addEventListener('mouseup', onMouseUp);
    return () => editorEl.removeEventListener('mouseup', onMouseUp);
  }, [desktop, editorRef]);

  // ── Clipboard actions (replace the suppressed native menu) ────────────────
  const restoreRange = () => {
    const r = savedRange.current;
    if (!r) return false;
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    editorRef?.current?.focus();
    return true;
  };
  const doCut = () => { if (restoreRange()) { document.execCommand('cut'); onEditContent(editorRef.current.innerHTML); } closeAll(); };
  const doCopy = () => { if (restoreRange()) document.execCommand('copy'); closeAll(); };
  const doPaste = async () => {
    if (restoreRange()) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) { insertTextAtSelection(editorRef.current, text); onEditContent(editorRef.current.innerHTML); }
      } catch { /* clipboard permission denied — nothing to paste */ }
    }
    closeAll();
  };
  const doSelectAll = () => {
    selectAllIn(editorRef?.current);
    setMenuOpen(false); setCaretOnly(false); // keep chip flow alive with new selection
  };
  const doQuickFormat = (cmd) => {
    if (restoreRange()) {
      if (cmd === '__hilite') document.execCommand('backColor', false, 'rgba(255,255,0,0.4)');
      else document.execCommand(cmd);
      onEditContent(editorRef.current.innerHTML);
    }
    closeAll();
  };

  const commitToThread = useCallback((threadId, dataOverride) => {
    const editorEl = editorRef?.current;
    const range = savedRange.current;
    if (!editorEl || !range) { closeAll(); return; }
    const text = range.toString().trim();
    const anchorId = tid('an');
    if (pinMode) { insertPinAt(range, anchorId); hapticPin(); }
    else { wrapSelectionAsAnchor(range, anchorId); hapticNodeConnect(); }
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

  // Docs-style placement: above the selection when there's room, else below.
  const MENU_W = 260;
  const roomAbove = sel.rect.top - 16;
  const roomBelow = window.innerHeight - (sel.rect.bottom ?? sel.rect.top) - 16;
  const placeAbove = roomAbove >= 240 && roomAbove >= roomBelow;
  const menuMaxH = Math.min(360, Math.max(180, placeAbove ? roomAbove : roomBelow));
  const menuPos = placeAbove
    ? { bottom: window.innerHeight - sel.rect.top + 8 }
    : { top: (sel.rect.bottom ?? sel.rect.top) + 8 };
  const menuLeft = Math.min(Math.max(8, sel.rect.left + (sel.rect.width || 0) / 2 - MENU_W / 2), window.innerWidth - MENU_W - 8);

  return (
    <>
      {/* Floating chip (mobile only — PC opens the menu directly) */}
      {!menuOpen && !desktop && (
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
              ...menuPos,
              left: menuLeft,
              width: MENU_W, maxHeight: menuMaxH, overflowY: 'auto',
              background: 'var(--modal-bg)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 8,
              boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
            }}
          >
            {/* Clipboard row — replaces the suppressed native selection toolbar */}
            <div style={{ display: 'flex', gap: 2, paddingBottom: 6, borderBottom: '1px solid var(--border-sm)', marginBottom: 6 }}>
              {[
                { label: 'Cut',        Icon: DSIcons.Cut,       act: doCut,       disabled: caretOnly },
                { label: 'Copy',       Icon: DSIcons.Copy,      act: doCopy,      disabled: caretOnly },
                { label: 'Paste',      Icon: DSIcons.Paste,     act: doPaste,     disabled: false },
                { label: 'Select all', Icon: DSIcons.SelectAll, act: doSelectAll, disabled: false },
              ].map(({ label, Icon, act, disabled }) => (
                <button key={label} onClick={act} disabled={disabled} title={label}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                    padding: '7px 2px', borderRadius: 8, border: 'none', background: 'transparent',
                    color: disabled ? 'var(--text-5)' : 'var(--text-2)', fontSize: 9.5, fontWeight: 600,
                    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--surface)'; }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Icon size={15} color="currentColor" />
                  {label}
                </button>
              ))}
            </div>

            {/* Quick format row */}
            {!caretOnly && (
              <div style={{ display: 'flex', gap: 4, paddingBottom: 6, borderBottom: '1px solid var(--border-sm)', marginBottom: 6 }}>
                {[
                  ['bold', <b key="b">B</b>], ['italic', <i key="i">I</i>],
                  ['underline', <u key="u">U</u>], ['strikeThrough', <DSIcons.Strikethrough key="s" size={14} />],
                  ['__hilite', <DSIcons.Highlighter key="h" size={14} />],
                ].map(([cmd, glyph]) => (
                  <button key={cmd} onClick={() => doQuickFormat(cmd)}
                    style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {glyph}
                  </button>
                ))}
              </div>
            )}

            {/* Mode toggles */}
            {!caretOnly && (
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
            )}

            {/* Quick character-arc from a name-looking selection */}
            {!caretOnly && nameish && (
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
            {!caretOnly && data.threads.length > 0 && (
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
            {!caretOnly && (
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
            )}
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
    // Nothing to draw and nothing drawn — skip all DOM work (the common case
    // for books that don't use threads; this effect re-runs on every keystroke).
    if (anchorInfo.size === 0) { setMarks((m) => (m.length ? [] : m)); return; }

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

    // Debounced: this effect re-fires per keystroke (content dep), and compute
    // does querySelectorAll + per-anchor getBoundingClientRect (forced layout).
    // Waiting for a typing lull keeps the hot path free; markers land ~150ms
    // after the last change, which is imperceptible for a passive gutter.
    const t = setTimeout(compute, 150);
    window.addEventListener('resize', compute);
    return () => { clearTimeout(t); window.removeEventListener('resize', compute); };
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
