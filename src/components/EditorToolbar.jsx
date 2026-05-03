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

import React, { useReducer, useEffect, useCallback } from 'react';
import { Upload, BarChart2, BookOpen, Eye, FileText, Settings2, Home, ExternalLink, Play, Zap, Edit3, ChevronRight, Puzzle } from 'lucide-react';
import FontSelector from './FontSelector';
import SizeSelector from './SizeSelector';
import FormatButton from './FormatButton';
import { isAndroid } from '../utils/platform';
import { useEditorToolbarExtensions, useExtensions } from '../utils/ExtensionContext';
import { COLORS } from './DesignSystem';

const initialState = { bold: false, italic: false, underline: false, highlight: false };
const reducer = (state, action) => action.type === 'SET_STATE' ? { ...state, ...action.payload } : state;

// ── Extension icon resolver ───────────────────────────────────────────────────

const ICON_NAME_MAP = {
  Upload, BarChart2, BookOpen, Eye, FileText, Settings2, Home,
  ExternalLink, Play, Zap, Edit3, ChevronRight, Puzzle,
  upload: Upload, analytics: BarChart2, book: BookOpen, view: Eye,
  summary: FileText, settings: Settings2, home: Home, open: ExternalLink,
  publish: Upload, chapter: BookOpen, sparkles: Zap,
};

function ExtIconResolved({ iconName, size = 14 }) {
  const Icon = (iconName && ICON_NAME_MAP[iconName]) || Puzzle;
  return <Icon size={size} />;
}

// ── EditorToolbar ─────────────────────────────────────────────────────────────

export default function EditorToolbar({ execCommand, accentHex, session }) {
  const [active, dispatch] = useReducer(reducer, initialState);
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
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); toggle('bold'); }
      else if (k === 'i') { e.preventDefault(); toggle('italic'); }
      else if (k === 'u') { e.preventDefault(); toggle('underline'); }
      else if (k === 'h') { e.preventDefault(); toggleHighlight(); }
      else if (k === 's') { e.preventDefault(); document.dispatchEvent(new CustomEvent('triggerSave')); }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []); // eslint-disable-line

  const handleFontChange = (e) => execCommand('fontName', e.target.value);
  const handleSizeChange = (e) => execCommand('fontSize', e.target.value);

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

      {/* Insert (placeholder) */}
      <button
        title="Insert (coming soon)"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px',
          borderRadius: 6, border: `2px solid rgba(255,255,255,0.6)`,
          background: 'transparent', color: '#fff', fontSize: 13, cursor: 'pointer',
          transition: 'background 0.15s', flexShrink: 0,
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        Insert <Upload size={14} style={{ opacity: 0.7 }} />
      </button>

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
