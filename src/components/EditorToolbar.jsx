/**
 * EditorToolbar.jsx — Formatting toolbar for the rich-text editor
 *
 * Changes from original:
 *   - Tailwind class strings removed; all layout via inline styles
 *   - FontSelector / SizeSelector / FormatButton now use inline styles (see those files)
 *   - Extension button hover uses COLORS from DesignSystem tokens
 *   - Toolbar background gradient pulled from accentHex (unchanged)
 *   - Toolbar scroll container uses a real style rule for hidden scrollbar
 *
 * Props unchanged — drop-in replacement.
 */

import React, { useReducer, useEffect, useCallback, useState } from 'react';

import FontSelector from './FontSelector';
import SizeSelector from './SizeSelector';
import FormatButton from './FormatButton';
import { isAndroid } from '../utils/platform';
import { useEditorToolbarExtensions, useExtensions } from '../utils/ExtensionContext';
import { COLORS,
  DSIcons,
} from '../DesignSystem';

const initialState = { bold: false, italic: false, underline: false, highlight: false };
const reducer = (state, action) => action.type === 'SET_STATE' ? { ...state, ...action.payload } : state;

// ── Extension icon resolver ───────────────────────────────────────────────────

const ICON_NAME_MAP = {
  upload:    'Upload',   analytics: 'Star',     book:      'Book',
  view:      'Eye',      summary:   'FileText',  settings:  'Settings',
  home:      'Home',     open:      'Link',      publish:   'Upload',
  chapter:   'BookOpen', sparkles:  'Sparkle',   puzzle:    'Extension',
  play:      'Lightning',edit:      'Edit',
};

function ExtIconResolved({ iconName, size = 14 }) {
  const key = iconName && (ICON_NAME_MAP[iconName] ?? iconName);
  const Icon = key && DSIcons[key];
  if (Icon) return <Icon size={size} />;
  return <DSIcons.Extension size={size} />;
}

// ── Insert menu items (U3) ────────────────────────────────────────────────────
const INSERT_ITEMS = [
  { label: 'Scene break',   glyph: '﹡',  kind: 'html',  value: '<p style="text-align:center">*&nbsp;&nbsp;*&nbsp;&nbsp;*</p><p><br></p>' },
  { label: 'Divider line',  glyph: '—',  kind: 'hr' },
  { label: 'Em dash',       glyph: '—',  kind: 'text',  value: '—' },
  { label: 'Ellipsis',      glyph: '…',  kind: 'text',  value: '…' },
  { label: "Today's date",  glyph: '📅', kind: 'text',  value: () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) },
];

// ── EditorToolbar ─────────────────────────────────────────────────────────────

export default function EditorToolbar({ execCommand, accentHex, session, editorRef }) {
  const [active, dispatch] = useReducer(reducer, initialState);
  const [insertOpen, setInsertOpen] = useState(false);
  const extButtons = useEditorToolbarExtensions();
  const { navigate } = useExtensions();
  const android = isAndroid();

  const updateActive = useCallback(() => {
    const bg = document.queryCommandValue('backColor')?.toLowerCase();
    dispatch({
      type: 'SET_STATE',
      payload: {
        bold:      document.queryCommandState('bold'),
        italic:    document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        highlight: bg === 'rgba(255, 255, 0, 0.3)' || bg === 'yellow',
      },
    });
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', updateActive);
    return () => document.removeEventListener('selectionchange', updateActive);
  }, [updateActive]);

  const toggle = (cmd, val = null) => { execCommand(cmd, val); updateActive(); };

  const toggleHighlight = () => {
    const color = 'rgba(255, 255, 0, 0.3)';
    const cur = document.queryCommandValue('backColor');
    document.execCommand('backColor', false, cur.toLowerCase() === color ? 'transparent' : color);
    updateActive();
  };

  useEffect(() => {
    const down = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      // Ctrl+S saves from anywhere — that's app-wide by design.
      if (k === 's') { e.preventDefault(); document.dispatchEvent(new CustomEvent('triggerSave')); return; }
      // 4C: formatting shortcuts only apply when focus is actually inside the
      // editor. The old global listener hijacked Ctrl+B in the title input and
      // the sidebar search box, yanked focus into the editor, and formatted
      // text the user wasn't touching.
      const editorEl = editorRef?.current;
      const inEditor = editorEl && (
        editorEl.contains(document.activeElement) ||
        (() => { const sel = window.getSelection(); return sel?.anchorNode ? editorEl.contains(sel.anchorNode) : false; })()
      );
      if (!inEditor) return;
      if (k === 'b') { e.preventDefault(); toggle('bold'); }
      else if (k === 'i') { e.preventDefault(); toggle('italic'); }
      else if (k === 'u') { e.preventDefault(); toggle('underline'); }
      else if (k === 'h') { e.preventDefault(); toggleHighlight(); }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []); // eslint-disable-line

  const handleFontChange = (e) => execCommand('fontName', e.target.value);
  const handleSizeChange = (e) => execCommand('fontSize', e.target.value);

  const doInsert = (item) => {
    editorRef?.current?.focus();
    if (item.kind === 'hr') { document.execCommand('insertHorizontalRule'); return; }
    if (item.kind === 'html') { document.execCommand('insertHTML', false, item.value); return; }
    const text = typeof item.value === 'function' ? item.value() : item.value;
    document.execCommand('insertText', false, text);
  };

  // Shared frosted glass background
  const bg = `linear-gradient(to bottom right, ${accentHex}66, rgba(0,0,0,0.45))`;

  // ── Shared control set ────────────────────────────────────────────────────
  const controls = (
    <>
      <FontSelector defaultValue="Arial" onChange={handleFontChange} />
      <SizeSelector defaultValue="3"     onChange={handleSizeChange} />

      {/* Divider */}
      <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />

      <FormatButton format="bold"      label="B" title="Bold (Ctrl+B)"      style={{ fontWeight: 'bold' }}          isActive={active.bold}      onClick={() => toggle('bold')} />
      <FormatButton format="italic"    label="I" title="Italic (Ctrl+I)"    style={{ fontStyle: 'italic' }}         isActive={active.italic}    onClick={() => toggle('italic')} />
      <FormatButton format="underline" label="U" title="Underline (Ctrl+U)" style={{ textDecoration: 'underline' }} isActive={active.underline} onClick={() => toggle('underline')} />
      <FormatButton format="highlight" label="H" title="Highlight (Ctrl+H)"                                         isActive={active.highlight} onClick={toggleHighlight} />

      {/* Insert menu (U3) — real actions, replacing the old "coming soon" no-op */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          title="Insert…"
          onClick={() => setInsertOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px',
            borderRadius: 6, border: `2px solid rgba(255,255,255,0.6)`,
            background: insertOpen ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: '#fff', fontSize: 13, cursor: 'pointer',
            transition: 'background 0.15s', flexShrink: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseLeave={e => { if (!insertOpen) e.currentTarget.style.background = 'transparent'; }}
        >
          Insert <DSIcons.ChevronDown size={13} style={{ opacity: 0.7, transform: insertOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>

        {insertOpen && (
          <>
            {/* click-away */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setInsertOpen(false)} />
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 41,
              minWidth: 190, padding: 6, borderRadius: 12,
              background: 'var(--modal-bg)', border: '1px solid var(--border)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            }}>
              {INSERT_ITEMS.map((item) => (
                <button
                  key={item.label}
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
                  <span style={{ width: 22, textAlign: 'center', color: 'var(--text-3)', fontSize: 13, flexShrink: 0 }}>{item.glyph}</span>
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
          <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
          {extButtons.map((btn, i) => (
            <button
              key={`${btn._extId}-${btn.id ?? i}`}
              title={`${btn.label} — ${btn._extName}`}
              onClick={() => navigate(btn._ext, btn.page ?? btn.id, session)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 12px', borderRadius: 6, fontSize: 13,
                border: `1px solid ${accentHex}66`,
                background: 'transparent', color: `${accentHex}cc`,
                cursor: 'pointer', flexShrink: 0,
                transition: 'background 0.15s, border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = accentHex;
                e.currentTarget.style.color       = accentHex;
                e.currentTarget.style.background  = `${accentHex}1a`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = `${accentHex}66`;
                e.currentTarget.style.color       = `${accentHex}cc`;
                e.currentTarget.style.background  = 'transparent';
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

  // ── Android: sticky scrollable strip ─────────────────────────────────────
  if (android) {
    return (
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, marginBottom: 8,
        borderRadius: 12, overflow: 'hidden',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        background: bg,
        boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.12)',
      }}>
        <style>{`.toolbar-scroll::-webkit-scrollbar{display:none}`}</style>
        <div className="toolbar-scroll" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', overflowX: 'auto',
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }}>
          {controls}
        </div>
        {/* Right-edge fade hint */}
        <div style={{
          pointerEvents: 'none', position: 'absolute',
          insetBlock: 0, right: 0, width: 32,
          background: 'linear-gradient(to right, transparent, rgba(0,0,0,0.4))',
        }} />
      </div>
    );
  }

  // ── Desktop: floating frosted-glass pill ─────────────────────────────────
  return (
    <div style={{
      position: 'sticky', top: 16, zIndex: 20,
      margin: '0 auto', width: 'fit-content',
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 16px', borderRadius: 24,
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      background: bg,
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.12)',
      outline: '1px solid rgba(255,255,255,0.2)',
      transition: 'all 0.3s',
    }}>
      {controls}
    </div>
  );
}
