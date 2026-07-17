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

import React, { useReducer, useEffect, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { T } from '../utils/motion';

import FontSelector from './FontSelector';
import SizeSelector from './SizeSelector';
import { isAndroid } from '../utils/platform';
import { useEditorToolbarExtensions, useExtensions } from '../utils/ExtensionContext';
import { useTheme } from '../theme';
import { applyInlineStyle } from '../utils/editorFormat';
import { wordCountOf } from '../utils/history';
import { DSIcons } from '../DesignSystem';

// ── Paragraph styles (Docs' "Normal text / Heading …" dropdown) ──────────────
const BLOCK_STYLES = [
  ['p',          'Normal text', {}],
  ['h1',         'Heading 1',   { fontSize: 16, fontWeight: 800 }],
  ['h2',         'Heading 2',   { fontSize: 14.5, fontWeight: 700 }],
  ['h3',         'Heading 3',   { fontSize: 13.5, fontWeight: 700 }],
  ['blockquote', 'Quote',       { fontStyle: 'italic', color: 'var(--text-3)' }],
];
const BLOCK_LABELS = Object.fromEntries(BLOCK_STYLES.map(([tag, label]) => [tag, label]));

const CASE_MODES = [
  ['upper',    'UPPERCASE'],
  ['lower',    'lowercase'],
  ['title',    'Capitalize Each Word'],
  ['sentence', 'Sentence case'],
];

const LINE_SPACINGS = [[1, 'Single'], [1.15, '1.15'], [1.5, '1.5'], [2, 'Double'], [null, 'Default']];

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
  { label: 'Image…',       glyph: <DSIcons.Image size={13} />,    kind: 'image' },
  { label: 'Link…',        glyph: <DSIcons.Link size={13} />,     kind: 'link' },
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

// One shared popover for colour palettes, align picker and the Insert menu.
// Rendered through a portal with fixed positioning (anchored to the trigger)
// so it survives the toolbar's horizontal scroll container — an absolutely
// positioned child would be clipped by overflow-x: auto.
function Popover({ open, onClose, children, up = false, anchorRef, width = 168 }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const r = anchorRef?.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos(up
        ? { left, bottom: window.innerHeight - r.top + 8 }
        : { left, top: r.bottom + 8 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, up, anchorRef, width]);
  if (!open || !pos) return null;
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onMouseDown={onClose} />
      <motion.div
        onMouseDown={(e) => e.preventDefault()}
        initial={{ opacity: 0, scale: 0.95, y: up ? 4 : -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={T.fast}
        style={{
          position: 'fixed', zIndex: 61, ...pos,
          background: 'var(--modal-bg)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
          display: 'flex', gap: 6, flexWrap: 'wrap', width,
          transformOrigin: up ? 'bottom left' : 'top left',
        }}
      >
        {children}
      </motion.div>
    </>,
    document.body
  );
}

// ── EditorToolbar ─────────────────────────────────────────────────────────────

export default function EditorToolbar({ execCommand, accentHex, session, editorRef, customFonts = [] }) {
  const [active, dispatch] = useReducer(reducer, initialState);
  const [insertOpen, setInsertOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [hiliteOpen, setHiliteOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);       // paragraph styles (beta.2)
  const [caseOpen, setCaseOpen] = useState(false);         // Aa change-case menu
  const [spacingOpen, setSpacingOpen] = useState(false);   // line spacing
  const [painter, setPainter] = useState(null);            // format painter (armed = captured styles)
  const [findOpen, setFindOpen] = useState(false);         // find & replace bar
  const [findQ, setFindQ] = useState('');
  const [replQ, setReplQ] = useState('');
  const [findMiss, setFindMiss] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const colorRef  = useRef(null);
  const hiliteRef = useRef(null);
  const alignRef  = useRef(null);
  const insertRef = useRef(null);
  const styleRef  = useRef(null);
  const caseRef   = useRef(null);
  const spacingRef = useRef(null);
  const findInputRef = useRef(null);
  const deskRowRef = useRef(null);
  const imageInputRef = useRef(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl]   = useState('');
  const [linkText, setLinkText] = useState('');
  const extButtons = useEditorToolbarExtensions();
  const { navigate } = useExtensions();
  const { theme } = useTheme();
  const android = isAndroid();
  const isDark = theme?.meta?.isDark !== false;

  const closePopovers = () => { setInsertOpen(false); setColorOpen(false); setHiliteOpen(false); setAlignOpen(false); setStyleOpen(false); setCaseOpen(false); setSpacingOpen(false); };

  const updateActive = useCallback(() => {
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    const bg = (() => { try { return (document.queryCommandValue('backColor') || '').toLowerCase(); } catch { return ''; } })();
    const block = (() => { try { return String(document.queryCommandValue('formatBlock') || 'p').toLowerCase(); } catch { return 'p'; } })();
    dispatch({
      type: 'SET_STATE',
      payload: {
        bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'),
        sub: q('subscript'), sup: q('superscript'),
        block,
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

  // Wheel-over-pill scrolls the toolbar horizontally when it overflows.
  useEffect(() => {
    const el = deskRowRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [android]);

  const toggle = (cmd, val = null) => { execCommand(cmd, val); updateActive(); };

  // Manual DOM edits (line spacing, case change) bypass execCommand, so React's
  // onInput never fires on its own — dispatch a real bubbling input event so
  // the editor's debounced flush (and History) sees the change.
  const fireInput = () => editorRef?.current?.dispatchEvent(new Event('input', { bubbles: true }));

  const selectionInEditor = () => {
    const s = window.getSelection();
    return !!(s?.anchorNode && editorRef?.current?.contains(s.anchorNode));
  };

  // ── Format painter (Word) — capture once, apply to the next selection ─────
  const armPainter = () => {
    if (painter) { setPainter(null); return; }
    if (!selectionInEditor()) return;
    const s = window.getSelection();
    const el = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
    const cs = getComputedStyle(el);
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    const back = (() => { try { return document.queryCommandValue('backColor') || ''; } catch { return ''; } })();
    setPainter({
      bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'),
      color: cs.color, fontFamily: cs.fontFamily, fontSize: cs.fontSize, back,
    });
  };

  useEffect(() => {
    if (!painter) return undefined;
    const editor = editorRef?.current;
    const onUp = () => {
      setTimeout(() => { // let the selection settle after mouse/touch up
        const s = window.getSelection();
        if (!s || s.isCollapsed || !editor?.contains(s.anchorNode)) return;
        const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
        [['bold', painter.bold], ['italic', painter.italic], ['underline', painter.underline], ['strikeThrough', painter.strike]]
          .forEach(([cmd, want]) => { if (q(cmd) !== want) document.execCommand(cmd); });
        document.execCommand('foreColor', false, painter.color);
        const b = (painter.back || '').toLowerCase();
        document.execCommand('backColor', false, (b && b !== 'transparent' && b !== 'rgba(0, 0, 0, 0)') ? painter.back : 'transparent');
        applyInlineStyle(editor, { fontFamily: painter.fontFamily, fontSize: painter.fontSize });
        setPainter(null);
        updateActive();
      }, 0);
    };
    const onKey = (e) => { if (e.key === 'Escape') setPainter(null); };
    editor?.addEventListener('mouseup', onUp);
    editor?.addEventListener('touchend', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      editor?.removeEventListener('mouseup', onUp);
      editor?.removeEventListener('touchend', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [painter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Change case (Word's Aa) — transform text nodes in place so bold/italic
  // runs inside the selection keep their formatting ─────────────────────────
  const transformCase = (mode) => {
    setCaseOpen(false);
    const editor = editorRef?.current;
    const sel = window.getSelection();
    if (!editor || !sel?.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const applyCase = (str) => {
      if (mode === 'upper') return str.toUpperCase();
      if (mode === 'lower') return str.toLowerCase();
      if (mode === 'title') return str.replace(/\p{L}[\p{L}\p{M}'’-]*/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      return str.toLowerCase().replace(/(^|[.!?…]\s+)(\p{L})/gu, (m, p, ch) => p + ch.toUpperCase());
    };
    const nodes = [];
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
      nodes.push(range.startContainer);
    } else {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) { const n = walker.currentNode; if (range.intersectsNode(n)) nodes.push(n); }
    }
    for (const n of nodes) {
      const start = n === range.startContainer ? range.startOffset : 0;
      const end = n === range.endContainer ? range.endOffset : n.data.length;
      if (end <= start) continue;
      n.data = n.data.slice(0, start) + applyCase(n.data.slice(start, end)) + n.data.slice(end);
    }
    if (nodes.length) fireInput();
  };

  // ── Line spacing (Docs) — per-paragraph line-height on selected blocks ────
  const setLineSpacing = (lh) => {
    setSpacingOpen(false);
    const editor = editorRef?.current;
    const sel = window.getSelection();
    if (!editor || !sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== editor) return;
    const blocks = [];
    for (const el of editor.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre')) {
      if (range.intersectsNode(el)) blocks.push(el);
    }
    if (!blocks.length) {
      let el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      while (el && el !== editor && !/^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE)$/.test(el.tagName)) el = el.parentElement;
      if (el && el !== editor) blocks.push(el);
    }
    blocks.forEach((el) => { el.style.lineHeight = lh == null ? '' : String(lh); });
    if (blocks.length) fireInput();
  };

  // ── Find & replace (Ctrl+F) — window.find keeps native match behaviour ────
  const doFind = (backwards = false) => {
    const editor = editorRef?.current;
    if (!editor || !findQ) return false;
    if (!selectionInEditor()) {
      const r = document.createRange();
      r.selectNodeContents(editor); r.collapse(!backwards);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    // window.find searches the whole page; skip hits that land outside the
    // manuscript (bounded so a pathological page can't loop forever).
    for (let i = 0; i < 200; i++) {
      const found = window.find(findQ, false, backwards, true, false, false, false);
      if (!found) { setFindMiss(true); return false; }
      if (selectionInEditor()) { setFindMiss(false); return true; }
    }
    setFindMiss(true);
    return false;
  };

  const doReplace = () => {
    const editor = editorRef?.current;
    const s = window.getSelection();
    if (editor && s && !s.isCollapsed && editor.contains(s.anchorNode) &&
        s.toString().toLowerCase() === findQ.toLowerCase()) {
      editor.focus();
      document.execCommand('insertText', false, replQ);
    }
    doFind();
  };

  const doReplaceAll = () => {
    const editor = editorRef?.current;
    if (!editor || !findQ) return;
    const r = document.createRange();
    r.selectNodeContents(editor); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    let n = 0;
    // Forward-only with wrap off = exactly one pass over the chapter.
    while (n < 2000 && window.find(findQ, false, false, false, false, false, false)) {
      if (!selectionInEditor()) break;
      editor.focus();
      document.execCommand('insertText', false, replQ);
      n++;
    }
    setFindMiss(n === 0);
  };

  const openFind = () => {
    const s = window.getSelection();
    if (s && !s.isCollapsed && selectionInEditor()) setFindQ(s.toString().slice(0, 200));
    setFindMiss(false);
    setFindOpen(true);
    setTimeout(() => findInputRef.current?.focus(), 30);
  };

  // Live word count for the open chapter (Word's status bar). One parse per
  // debounced flush of a single chapter — cheap.
  const words = React.useMemo(() => wordCountOf(session?.content), [session?.content]);

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
      else if (k === 'i' && !e.altKey) { e.preventDefault(); toggle('italic'); }
      else if (k === 'u') { e.preventDefault(); toggle('underline'); }
      else if (k === 'h') { e.preventDefault(); setHighlight(active.highlight ? null : HILITE_COLORS[0]); }
      else if (k === 'f' && !e.shiftKey) { e.preventDefault(); openFind(); }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []); // eslint-disable-line

  const savedInsertRange = useRef(null);
  const doInsert = (item) => {
    editorRef?.current?.focus();
    if (item.kind === 'image') {
      // Remember where the caret was — opening the file dialog blurs the editor.
      const s = window.getSelection();
      savedInsertRange.current = s?.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      imageInputRef.current?.click();
      return;
    }
    if (item.kind === 'link') {
      const s = window.getSelection();
      savedInsertRange.current = s?.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      setLinkText(s && !s.isCollapsed ? s.toString() : '');
      setLinkUrl('');
      setLinkOpen(true);
      return;
    }
    if (item.kind === 'hr') { document.execCommand('insertHorizontalRule'); return; }
    if (item.kind === 'html') { document.execCommand('insertHTML', false, item.value); return; }
    const text = typeof item.value === 'function' ? item.value() : item.value;
    document.execCommand('insertText', false, text);
  };

  const restoreInsertRange = () => {
    editorRef?.current?.focus();
    const r = savedInsertRange.current;
    if (r) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  };

  const onImageFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) { window.alert('Image is larger than 8 MB — please use a smaller one.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      restoreInsertRange();
      const src = String(reader.result || '');
      document.execCommand('insertHTML', false, `<img src="${src}" alt="${file.name.replace(/"/g, '')}" style="max-width:100%;height:auto;border-radius:6px;" />`);
    };
    reader.readAsDataURL(file);
  };

  const insertLink = () => {
    const url = linkUrl.trim();
    setLinkOpen(false);
    if (!url) return;
    const href = /^(https?:|mailto:|#|\/)/i.test(url) ? url : `https://${url}`;
    restoreInsertRange();
    const label = (linkText.trim() || href).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    document.execCommand('insertHTML', false, `<a href="${href.replace(/"/g, '%22')}" target="_blank" rel="noopener">${label}</a>`);
  };

  // ── Selection survival across toolbar taps ────────────────────────────────
  // Tapping a toolbar control (the size input, the font dropdown) pulls focus
  // out of the contentEditable, collapsing the selection applyInlineStyle needs.
  // On mobile this made font/size do nothing and the size field snap back to the
  // caret's original value. Capture the editor's range the instant the toolbar is
  // touched — pointerdown fires before focus moves — and restore it right before
  // applying, so the change actually lands on the selected text.
  const savedRange = useRef(null);
  const captureEditorRange = useCallback(() => {
    const editor = editorRef?.current;
    const sel = window.getSelection();
    if (!editor || !sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (editor.contains(r.commonAncestorContainer) && !r.collapsed) {
      savedRange.current = r.cloneRange();
    }
  }, [editorRef]);

  const applyStyle = (styleObj) => {
    const editor = editorRef?.current;
    if (!editor) return;
    const r = savedRange.current;
    if (r) {
      editor.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    applyInlineStyle(editor, styleObj);
  };

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
      {/* Undo / redo (Docs keeps them leftmost) */}
      <TBtn title="Undo (Ctrl+Z)" onClick={() => toggle('undo')}><DSIcons.Undo size={15} /></TBtn>
      <TBtn title="Redo (Ctrl+Y)" onClick={() => toggle('redo')}><DSIcons.Redo size={15} /></TBtn>

      <TDivider />

      {/* Paragraph styles — Normal text / Headings / Quote */}
      <div ref={styleRef} style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Paragraph style" active={styleOpen} onClick={() => { closePopovers(); setStyleOpen(v => !v); }}
          style={{ minWidth: 92, justifyContent: 'space-between', padding: '0 8px' }}>
          <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 96 }}>
            {BLOCK_LABELS[active.block] || 'Normal text'}
          </span>
          <DSIcons.ChevronDown size={10} style={{ marginLeft: 4, opacity: 0.6 }} />
        </TBtn>
        <Popover open={styleOpen} onClose={() => setStyleOpen(false)} up={up} anchorRef={styleRef} width={176}>
          <div style={{ width: '100%' }}>
            {BLOCK_STYLES.map(([tag, label, st]) => (
              <button key={tag}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { toggle('formatBlock', `<${tag}>`); setStyleOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent',
                  color: 'var(--text-2)', fontSize: 13, cursor: 'pointer', textAlign: 'left', ...st,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                {label}
                {active.block === tag && <DSIcons.Check size={12} color="var(--accent)" />}
              </button>
            ))}
          </div>
        </Popover>
      </div>

      <FontSelector customFonts={customFonts} onApply={applyStyle} editorRef={editorRef} />
      <SizeSelector onApply={applyStyle} editorRef={editorRef} />

      <TDivider />

      <TBtn title="Bold (Ctrl+B)" active={active.bold} onClick={() => toggle('bold')}><b>B</b></TBtn>
      <TBtn title="Italic (Ctrl+I)" active={active.italic} onClick={() => toggle('italic')}><i>I</i></TBtn>
      <TBtn title="Underline (Ctrl+U)" active={active.underline} onClick={() => toggle('underline')}><u>U</u></TBtn>
      <TBtn title="Strikethrough" active={active.strike} onClick={() => toggle('strikeThrough')}><DSIcons.Strikethrough size={15} /></TBtn>
      <TBtn title="Subscript" active={active.sub} onClick={() => toggle('subscript')}><DSIcons.Subscript size={15} /></TBtn>
      <TBtn title="Superscript" active={active.sup} onClick={() => toggle('superscript')}><DSIcons.Superscript size={15} /></TBtn>

      {/* Format painter (Word): copy formatting here, apply to next selection */}
      <TBtn title={painter ? 'Format painter armed — select text to apply (Esc cancels)' : 'Format painter — copies this text\'s formatting to your next selection'}
        active={!!painter} onClick={armPainter}><DSIcons.Painter size={15} /></TBtn>

      {/* Change case (Word's Aa) */}
      <div ref={caseRef} style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Change case" active={caseOpen} onClick={() => { closePopovers(); setCaseOpen(v => !v); }}><DSIcons.CaseChange size={15} /></TBtn>
        <Popover open={caseOpen} onClose={() => setCaseOpen(false)} up={up} anchorRef={caseRef} width={190}>
          <div style={{ width: '100%' }}>
            {CASE_MODES.map(([mode, label]) => (
              <button key={mode}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => transformCase(mode)}
                style={{ display: 'block', width: '100%', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                {label}
              </button>
            ))}
          </div>
        </Popover>
      </div>

      {/* Text colour */}
      <div ref={colorRef} style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Text colour" active={colorOpen} onClick={() => { closePopovers(); setColorOpen(v => !v); }}><DSIcons.TextColor size={15} /></TBtn>
        <Popover open={colorOpen} onClose={() => setColorOpen(false)} up={up} anchorRef={colorRef}>
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
      <div ref={hiliteRef} style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Highlight (Ctrl+H)" active={active.highlight || hiliteOpen} onClick={() => { closePopovers(); setHiliteOpen(v => !v); }}><DSIcons.Highlighter size={15} /></TBtn>
        <Popover open={hiliteOpen} onClose={() => setHiliteOpen(false)} up={up} anchorRef={hiliteRef}>
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
      <div ref={alignRef} style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Alignment" active={alignOpen} onClick={() => { closePopovers(); setAlignOpen(v => !v); }}>{alignIcon}<DSIcons.ChevronDown size={10} style={{ marginLeft: 2, opacity: 0.6 }} /></TBtn>
        <Popover open={alignOpen} onClose={() => setAlignOpen(false)} up={up} anchorRef={alignRef}>
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

      {/* Line spacing (Docs) */}
      <div ref={spacingRef} style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Line spacing" active={spacingOpen} onClick={() => { closePopovers(); setSpacingOpen(v => !v); }}><DSIcons.LineSpacing size={15} /></TBtn>
        <Popover open={spacingOpen} onClose={() => setSpacingOpen(false)} up={up} anchorRef={spacingRef} width={136}>
          <div style={{ width: '100%' }}>
            {LINE_SPACINGS.map(([v, label]) => (
              <button key={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setLineSpacing(v)}
                style={{ display: 'block', width: '100%', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                {label}
              </button>
            ))}
          </div>
        </Popover>
      </div>

      <TDivider />

      <TBtn title="Clear formatting" onClick={() => { toggle('removeFormat'); setHighlight(null); }}><DSIcons.ClearFormat size={15} /></TBtn>

      {/* Find & replace */}
      <TBtn title="Find & replace (Ctrl+F)" active={findOpen} onClick={() => (findOpen ? setFindOpen(false) : openFind())}><DSIcons.Search size={15} /></TBtn>

      {/* Insert menu */}
      <div ref={insertRef} style={{ position: 'relative', flexShrink: 0 }}>
        <TBtn title="Insert…" active={insertOpen} onClick={() => { closePopovers(); setInsertOpen(v => !v); }}>
          <DSIcons.Plus size={14} /><span style={{ fontSize: 12.5, marginLeft: 3 }}>Insert</span>
        </TBtn>
        {insertOpen && (
          <Popover open onClose={() => setInsertOpen(false)} up={up} anchorRef={insertRef} width={200}>
            <div style={{ width: '100%' }}>
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
          </Popover>
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

      {/* Live word count (Word's status bar) — desktop only; mobile pill space
          is too tight and the dashboard already shows per-chapter counts. */}
      {!android && (
        <>
          <TDivider />
          <span title="Words in this chapter" style={{
            flexShrink: 0, padding: '0 8px', fontSize: 12, fontWeight: 600,
            color: 'var(--toolbar-item)', opacity: 0.75, whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
          </span>
        </>
      )}
    </>
  );

  // Shared, position-independent extras (hidden file input + link dialog).
  // Rendered in both the Android and desktop return branches.
  const extras = (
    <>
      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onImageFile} />
      {linkOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 4100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--modal-overlay-bg, rgba(0,0,0,0.6))', backdropFilter: 'blur(4px)' }}
          onMouseDown={() => setLinkOpen(false)}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(380px, 92vw)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12 }}>Insert link</div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Text</label>
            <input autoFocus value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Link text"
              style={{ width: '100%', margin: '5px 0 12px', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 13, outline: 'none' }} />
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>URL</label>
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…"
              onKeyDown={(e) => { if (e.key === 'Enter') insertLink(); }}
              style={{ width: '100%', margin: '5px 0 16px', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 13, outline: 'none' }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setLinkOpen(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Cancel</button>
              <button onClick={insertLink} disabled={!linkUrl.trim()} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: linkUrl.trim() ? accentHex : 'var(--surface)', color: linkUrl.trim() ? '#fff' : 'var(--text-5)', cursor: linkUrl.trim() ? 'pointer' : 'default', fontSize: 13, fontWeight: 700 }}>Insert</button>
            </div>
          </div>
        </div>, document.body)}
    </>
  );

  // ── Find & replace bar (Ctrl+F) — second row under the toolbar controls ───
  const findFieldStyle = {
    flex: '1 1 90px', minWidth: 70, padding: '6px 9px', borderRadius: 7,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text-1)', fontSize: 12.5, outline: 'none',
  };
  const findActStyle = {
    padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12,
    fontWeight: 600, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
  };
  const findRow = findOpen && (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      padding: '6px 10px 8px', borderTop: '1px solid var(--toolbar-divider)',
    }}>
      <DSIcons.Search size={13} style={{ color: 'var(--text-4)', flexShrink: 0 }} />
      <input
        ref={findInputRef}
        value={findQ}
        onChange={(e) => { setFindQ(e.target.value); setFindMiss(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey); }
          else if (e.key === 'Escape') { setFindOpen(false); editorRef?.current?.focus(); }
        }}
        placeholder="Find"
        style={findFieldStyle}
      />
      <TBtn title="Previous match (Shift+Enter)" onClick={() => doFind(true)}><DSIcons.ChevronUp size={13} /></TBtn>
      <TBtn title="Next match (Enter)" onClick={() => doFind(false)}><DSIcons.ChevronDown size={13} /></TBtn>
      <input
        value={replQ}
        onChange={(e) => setReplQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doReplace(); } else if (e.key === 'Escape') { setFindOpen(false); editorRef?.current?.focus(); } }}
        placeholder="Replace with"
        style={findFieldStyle}
      />
      <button onClick={doReplace} style={findActStyle}>Replace</button>
      <button onClick={doReplaceAll} style={findActStyle}>All</button>
      {findMiss && <span style={{ fontSize: 11.5, color: 'var(--text-4)', flexShrink: 0 }}>No matches</span>}
      <TBtn title="Close (Esc)" onClick={() => { setFindOpen(false); editorRef?.current?.focus(); }}><DSIcons.X size={13} /></TBtn>
    </div>
  );

  // ── Android: floating pill that docks above the keyboard (B4) ─────────────
  // With Capacitor Keyboard resize:'body' the webview shrinks when the
  // keyboard opens, so bottom:0 already sits on the keyboard's top edge — the
  // pill↔bar morph animates position, width and radius for the Docs feel.
  if (android) {
    // Idle (keyboard closed): the pill sits at the TOP of the manuscript — it's
    // sticky in-flow so it stays put as you scroll and doesn't cover the text
    // you're reading. Editing (keyboard open): it slides down to dock flush
    // above the keyboard, Docs-style. (Reported: the bottom pill was in the way
    // when not actively typing.)
    const dockedSurface = {
      overflow: 'hidden',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      ...surface,
      zIndex: 30,
      transition: 'border-radius 0.22s ease, box-shadow 0.22s ease',
    };
    const posStyle = kbOpen
      ? { position: 'fixed', left: 0, right: 0, bottom: 0, borderRadius: '10px 10px 0 0', boxShadow: '0 -4px 20px rgba(0,0,0,0.25)' }
      : { position: 'sticky', top: 8, margin: '0 0 10px', borderRadius: 16, boxShadow: '0 6px 24px rgba(0,0,0,0.3)' };
    return (
      <>
      {extras}
      <div data-tour="toolbar" style={{ ...dockedSurface, ...posStyle }}>
        <div className="toolbar-scroll" onPointerDownCapture={captureEditorRange} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '6px 10px', overflowX: 'auto',
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }}>
          {controls(kbOpen)}
        </div>
        {findRow}
      </div>
      </>
    );
  }

  // ── Desktop: floating frosted pill at the top ──────────────────────────────
  // The row scrolls horizontally when the editor column is narrow (threads
  // panel open) — buttons used to paint straight off the pill's edge. The
  // wheel handler maps vertical scrolling to the row; it's attached natively
  // because React registers wheel listeners passively (preventDefault no-ops).
  return (
    <>
    {extras}
    {/* sticky top:8 keeps the pill docked right under the chapter switcher as
        the manuscript scrolls; z-index sits below the selection menu, which is
        positioned to never overlap the pill (see ThreadLayer PILL_ZONE). */}
    <div data-tour="toolbar" style={{
      position: 'sticky', top: 8, zIndex: 20,
      margin: '0 auto', maxWidth: '100%', width: 'fit-content',
      borderRadius: 24, overflow: 'hidden',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      ...surface,
      boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.3)' : '0 8px 24px rgba(0,0,0,0.12)',
    }}>
      <div ref={deskRowRef} className="toolbar-scroll" onPointerDownCapture={captureEditorRange} style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '6px 12px', maxWidth: '100%', overflowX: 'auto',
        msOverflowStyle: 'none', scrollbarWidth: 'none',
      }}>
        <style>{'.toolbar-scroll::-webkit-scrollbar{display:none}'}</style>
        {controls(false)}
      </div>
      {findRow}
    </div>
    </>
  );
}
