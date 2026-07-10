/**
 * EditorToolbar.jsx — Formatting toolbar for the rich-text editor.
 *
 * Rebuilt per author field-test feedback (B1–B4):
 *   • Theme-aware surface: dark themes keep the tinted glass pill; light themes
 *     get a solid modal surface with strong contrast (the accent-over-cream
 *     wash was unreadable on Sepia/Light).
 *   • Google-Docs-level formatting: B/I/U/Strikethrough, text color + multi-
 *     color highlight, alignment, bullet/numbered lists, indent/outdent,
 *     clear formatting, Insert menu, extension buttons.
 *   • Fonts come from the Font Customizer library (+ uploads) with weight
 *     variants grouped per family; sizes are real px (8–96).
 *   • Mobile (Android): the toolbar is a floating bottom pill while the
 *     keyboard is closed and SLIDES DOWN to dock flush above the keyboard when
 *     it opens (smooth transition), like Google Docs. Desktop keeps the top pill.
 *
 * All formatting routes through execCommand / applyInlineStyle so it joins the
 * editor's native undo stack.
 */

import React, { useReducer, useEffect, useCallback, useState } from 'react';

import FontSelector from './FontSelector';
import SizeSelector from './SizeSelector';
import { isAndroid } from '../utils/platform';
import { useEditorToolbarExtensions, useExtensions } from '../utils/ExtensionContext';
import { useTheme } from '../theme';
import { applyInlineStyle } from '../utils/editorFormat';
import { DSIcons } from '../DesignSystem';

const initialState = {
  bold: false, italic: false, underline: false, strike: false, highlight: false,
  justifyLeft: false, justifyCenter: false, justifyRight: false, justifyFull: false,
  ul: false, ol: false,
};
const reducer = (state, action) => action.type === 'SET_STATE' ? { ...state, ...action.payload } : state;

// ── Extension icon resolver ───────────────────────────────────────────────────
const ICON_NAME_MAP = {
  upload: 'Upload', analytics: 'Star', book: 'Book', view: 'Eye',
  summary: 'FileText', settings: 'Settings', home: 'Home', open: 'Link',
  publish: 'Upload', chapter: 'BookOpen', sparkles: 'Sparkle',
  puzzle: 'Extension', play: 'Lightning', edit: 'Edit',
};
function ExtIconResolved({ iconName, size = 14 }) {
  const key = iconName && (ICON_NAME_MAP[iconName] ?? iconName);
  const Icon = key && DSIcons[key];
  if (Icon) return <Icon size={size} />;
  return <DSIcons.Extension size={size} />;
}

// ── Insert menu items ─────────────────────────────────────────────────────────
const INSERT_ITEMS = [
  { label: 'Scene break',  glyph: <DSIcons.More size={13} />,     kind: 'html', value: '<p style="text-align:center">*&nbsp;&nbsp;*&nbsp;&nbsp;*</p><p><br></p>' },
  { label: 'Divider line', glyph: <DSIcons.Minus size={13} />,    kind: 'hr' },
  { label: 'Em dash',      glyph: <span style={{ fontSize: 13 }}>—</span>, kind: 'text', value: '—' },
  { label: 'Ellipsis',     glyph: <span style={{ fontSize: 13 }}>…</span>, kind: 'text', value: '…' },
  { label: "Today's date", glyph: <DSIcons.Calendar size={13} />, kind: 'text', value: () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) },
];

// ── Color palettes ────────────────────────────────────────────────────────────
const TEXT_COLORS = ['#000000', '#434343', '#666666', '#999999', '#ffffff', '#e03131', '#e8590c', '#f08c00', '#2f9e44', '#1971c2', '#6741d9', '#c2255c'];
const HILITE_COLORS = ['rgba(255,255,0,0.4)', 'rgba(76,175,80,0.35)', 'rgba(33,150,243,0.30)', 'rgba(233,30,99,0.30)', 'rgba(255,152,0,0.35)', 'rgba(156,39,176,0.28)'];

// ── Toolbar button ────────────────────────────────────────────────────────────
function TBtn({ title, active, onClick, children, style: st }) {
  return (
    <button
      title={title}
      onMouseDown={(e) => e.preventDefault()}   // keep the editor selection
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 32, height: 32, padding: '0 6px', borderRadius: 7, flexShrink: 0,
        border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
        background: active ? 'var(--accent-a18)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--toolbar-item)',
        cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
        fontSize: 14,
        ...st,
      }}
    >
      {children}
    </button>
  );
}

function TDivider() {
  return <div style={{ width: 1, alignSelf: 'stretch', margin: '4px 2px', background: 'var(--toolbar-divider)', flexShrink: 0 }} />;
}

// One shared popover for colour palettes and the align picker.
function Popover({ open, onClose, children, up = false }) {
  if (!open) return null;
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onMouseDown={onClose} />
      <div
        onMouseDown={(e) => e.preventDefault()}
        style={{
          position: 'absolute', zIndex: 61, left: 0,
          ...(up ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }),
          background: 'var(--modal-bg)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
          display: 'flex', gap: 6, flexWrap: 'wrap', width: 168,
        }}
      >
        {children}
      </div>
    </>
  );
}

// ── EditorToolbar ─────────────────────────────────────────────────────────────

export default function EditorToolbar({ execCommand, accentHex, session, editorRef, customFonts = [] }) {
  const [active, dispatch] = useReducer(reducer, initialState);
  const [insertOpen, setInsertOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [hiliteOpen, setHiliteOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const extButtons = useEditorToolbarExtensions();
  const { navigate } = useExtensions();
  const { theme } = useTheme();
  const android = isAndroid();
  const isDark = theme?.meta?.isDark !== false;

  const closePopovers = () => { setInsertOpen(false); setColorOpen(false); setHiliteOpen(false); setAlignOpen(false); };

  const updateActive = useCallback(() => {
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    const bg = (() => { try { return (document.queryCommandValue('backColor') || '').toLowerCase(); } catch { return ''; } })();
    dispatch({
      type: 'SET_STATE',
      payload: {
        bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'),
        highlight: bg !== '' && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)',
        justifyLeft: q('justifyLeft'), justifyCenter: q('justifyCenter'),
        justifyRight: q('justifyRight'), justifyFull: q('justifyFull'),
        ul: q('insertUnorderedList'), ol: q('insertOrderedList'),
      },
    });
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', updateActive);
    return () => document.removeEventListener('selectionchange', updateActive);
  }, [updateActive]);

  // ── Keyboard docking (Android): pill ↔ docked bar ─────────────────────────
  useEffect(() => {
    if (!android) return;
    let subs = [];
    (async () => {
      try {
        const { Keyboard } = await import('@capacitor/keyboard');
        subs.push(await Keyboard.addListener('keyboardWillShow', () => setKbOpen(true)));
        subs.push(await Keyboard.addListener('keyboardWillHide', () => setKbOpen(false)));
      } catch { /* web build — no native keyboard events */ }
    })();
    return () => { subs.forEach(s => s?.remove?.()); };
  }, [android]);

  const toggle = (cmd, val = null) => { execCommand(cmd, val); updateActive(); };

  const setHighlight = (color) => {
    document.execCommand('backColor', false, color ?? 'transparent');
    setHiliteOpen(false);
    updateActive();
  };
  const setTextColor = (color) => {
    document.execCommand('foreColor', false, color);
    setColorOpen(false);
    updateActive();
  };

  useEffect(() => {
    const down = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); document.dispatchEvent(new CustomEvent('triggerSave')); return; }
      const editorEl = editorRef?.current;
      const inEditor = editorEl && (
        editorEl.contains(document.activeElement) ||
        (() => { const sel = window.getSelection(); return sel?.anchorNode ? editorEl.contains(sel.anchorNode) : false; })()
      );
      if (!inEditor) return;
      if (k === 'b') { e.preventDefault(); toggle('bold'); }
      else if (k === 'i') { e.preventDefault(); toggle('italic'); }
      else if (k === 'u') { e.preventDefault(); toggle('underline'); }
      else if (k === 'h') { e.preventDefault(); setHighlight(active.highlight ? null : HILITE_COLORS[0]); }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []); // eslint-disable-line

  const doInsert = (item) => {
    editorRef?.current?.focus();
    if (item.kind === 'hr') { document.execCommand('insertHorizontalRule'); return; }
    if (item.kind === 'html') { document.execCommand('insertHTML', false, item.value); return; }
    const text = typeof item.value === 'function' ? item.value() : item.value;
    document.execCommand('insertText', false, text);
  };

  const applyStyle = (styleObj) => { applyInlineStyle(editorRef?.current, styleObj); };

  // ── Theme-aware surface (B1) ──────────────────────────────────────────────
  // Dark: keep the tinted frosted pill. Light: accent wash over cream had ~no
  // contrast, so use the solid modal surface with a real border.
  const surface = isDark
    ? { background: `linear-gradient(to bottom right, ${accentHex}66, var(--toolbar-stop, rgba(0,0,0,0.45)))`, border: '1px solid var(--toolbar-border)' }
    : { background: 'var(--modal-bg)', border: '1px solid var(--border)' };

  const alignIcon = active.justifyCenter ? <DSIcons.AlignCenter size={15} />
    : active.justifyRight ? <DSIcons.AlignRight size={15} />
    : active.justifyFull ? <DSIcons.AlignJustify size={15} />
    : <DSIcons.AlignLeft size={15} />;

  // ── Shared control set ────────────────────────────────────────────────────
  const controls = (up) => (
    <>
      <FontSelector customFonts={customFonts} onApply={applyStyle} />
      <SizeSelector onApply={applyStyle} />

      <TDivider />

      <TBtn title="Bold (Ctrl+B)" active={active.bold} onClick={() => toggle('bold')}><b>B</b></TBtn>
      <TBtn title="Italic (Ctrl+I)" active={active.italic} onClick={() => toggle('italic')}><i>I</i></TBtn>
      <TBtn title="Underline (Ctrl+U)" active={active.underline} onClick={() => toggle('underline')}><u>U</u></TBtn>
      <TBtn title="Strikethrough" active={active.strike} onClick={() => toggle('strikeThrough')}><DSIcons.Strikethrough size={15} /></TBtn>

      {/* Text colour */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Text colour" active={colorOpen} onClick={() => { closePopovers(); setColorOpen(v => !v); }}><DSIcons.TextColor size={15} /></TBtn>
        <Popover open={colorOpen} onClose={() => setColorOpen(false)} up={up}>
          {TEXT_COLORS.map(c => (
            <button key={c} onClick={() => setTextColor(c)} title={c}
              style={{ width: 22, height: 22, borderRadius: 6, background: c, border: '1px solid var(--border)', cursor: 'pointer' }} />
          ))}
          <button onClick={() => setTextColor('inherit')}
            style={{ flexBasis: '100%', marginTop: 2, padding: '5px 0', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 11, cursor: 'pointer' }}>
            Default colour
          </button>
        </Popover>
      </div>

      {/* Highlight */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Highlight (Ctrl+H)" active={active.highlight || hiliteOpen} onClick={() => { closePopovers(); setHiliteOpen(v => !v); }}><DSIcons.Highlighter size={15} /></TBtn>
        <Popover open={hiliteOpen} onClose={() => setHiliteOpen(false)} up={up}>
          {HILITE_COLORS.map(c => (
            <button key={c} onClick={() => setHighlight(c)} title="Highlight"
              style={{ width: 22, height: 22, borderRadius: 6, background: c, border: '1px solid var(--border)', cursor: 'pointer' }} />
          ))}
          <button onClick={() => setHighlight(null)}
            style={{ flexBasis: '100%', marginTop: 2, padding: '5px 0', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 11, cursor: 'pointer' }}>
            No highlight
          </button>
        </Popover>
      </div>

      <TDivider />

      {/* Alignment */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Alignment" active={alignOpen} onClick={() => { closePopovers(); setAlignOpen(v => !v); }}>{alignIcon}<DSIcons.ChevronDown size={10} style={{ marginLeft: 2, opacity: 0.6 }} /></TBtn>
        <Popover open={alignOpen} onClose={() => setAlignOpen(false)} up={up}>
          {[
            ['justifyLeft', 'Align left', <DSIcons.AlignLeft size={15} key="l" />],
            ['justifyCenter', 'Align centre', <DSIcons.AlignCenter size={15} key="c" />],
            ['justifyRight', 'Align right', <DSIcons.AlignRight size={15} key="r" />],
            ['justifyFull', 'Justify', <DSIcons.AlignJustify size={15} key="j" />],
          ].map(([cmd, title, ic]) => (
            <TBtn key={cmd} title={title} active={active[cmd]} onClick={() => { toggle(cmd); setAlignOpen(false); }}>{ic}</TBtn>
          ))}
        </Popover>
      </div>

      {/* Lists / indent */}
      <TBtn title="Bulleted list" active={active.ul} onClick={() => toggle('insertUnorderedList')}><DSIcons.List size={15} /></TBtn>
      <TBtn title="Numbered list" active={active.ol} onClick={() => toggle('insertOrderedList')}><DSIcons.ListOrdered size={15} /></TBtn>
      <TBtn title="Increase indent" onClick={() => toggle('indent')}><DSIcons.Indent size={15} /></TBtn>
      <TBtn title="Decrease indent" onClick={() => toggle('outdent')}><DSIcons.Outdent size={15} /></TBtn>

      <TDivider />

      <TBtn title="Clear formatting" onClick={() => { toggle('removeFormat'); setHighlight(null); }}><DSIcons.ClearFormat size={15} /></TBtn>

      {/* Insert menu */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Insert…" active={insertOpen} onClick={() => { closePopovers(); setInsertOpen(v => !v); }}>
          <DSIcons.Plus size={14} /><span style={{ fontSize: 12.5, marginLeft: 3 }}>Insert</span>
        </TBtn>
        {insertOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onMouseDown={() => setInsertOpen(false)} />
            <div style={{
              position: 'absolute', ...(up ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }), left: 0, zIndex: 61,
              minWidth: 190, padding: 6, borderRadius: 12,
              background: 'var(--modal-bg)', border: '1px solid var(--border)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            }}>
              {INSERT_ITEMS.map((item) => (
                <button
                  key={item.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { doInsert(item); setInsertOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                    padding: '8px 10px', borderRadius: 8, border: 'none',
                    background: 'transparent', color: 'var(--text-2)',
                    fontSize: 13, cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-3)', flexShrink: 0 }}>{item.glyph}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Extension toolbar buttons */}
      {extButtons.length > 0 && (
        <>
          <TDivider />
          {extButtons.map((btn, i) => (
            <button
              key={`${btn._extId}-${btn.id ?? i}`}
              title={`${btn.label} — ${btn._extName}`}
              onClick={() => navigate(btn._ext, btn.page ?? btn.id, session)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 12px', borderRadius: 6, fontSize: 13,
                border: `1px solid ${accentHex}66`,
                background: 'transparent', color: accentHex,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <ExtIconResolved iconName={btn.icon} size={13} />
              {btn.label}
            </button>
          ))}
        </>
      )}
    </>
  );

  // ── Android: floating pill that docks above the keyboard (B4) ─────────────
  // With Capacitor Keyboard resize:'body' the webview shrinks when the
  // keyboard opens, so bottom:0 already sits on the keyboard's top edge — the
  // pill↔bar morph animates position, width and radius for the Docs feel.
  if (android) {
    return (
      <div style={{
        position: 'fixed', zIndex: 30,
        left: kbOpen ? 0 : 10,
        right: kbOpen ? 0 : 10,
        bottom: kbOpen ? 0 : 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        borderRadius: kbOpen ? '10px 10px 0 0' : 16,
        overflow: 'hidden',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        ...surface,
        boxShadow: kbOpen ? '0 -4px 20px rgba(0,0,0,0.25)' : '0 6px 24px rgba(0,0,0,0.3)',
        transition: 'left 0.22s ease, right 0.22s ease, bottom 0.22s ease, border-radius 0.22s ease',
      }}>
        <div className="toolbar-scroll" style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '6px 10px', overflowX: 'auto',
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }}>
          {controls(true)}
        </div>
      </div>
    );
  }

  // ── Desktop: floating frosted pill at the top ──────────────────────────────
  return (
    <div style={{
      position: 'sticky', top: 16, zIndex: 20,
      margin: '0 auto', maxWidth: '100%', width: 'fit-content',
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '6px 12px', borderRadius: 24,
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      ...surface,
      boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.3)' : '0 8px 24px rgba(0,0,0,0.12)',
    }}>
      {controls(false)}
    </div>
  );
}
