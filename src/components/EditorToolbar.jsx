import React, { useReducer, useEffect, useCallback, useRef } from "react";
import {
  Upload, BarChart2, BookOpen, Eye, FileText, Settings2,
  Home, ExternalLink, Play, Zap, Edit3, ChevronRight,
  Puzzle,
} from "lucide-react";
import FontSelector from "./FontSelector";
import SizeSelector from "./SizeSelector";
import FormatButton from "./FormatButton";
import { isAndroid } from "../utils/platform";
import { useEditorToolbarExtensions } from "../utils/ExtensionContext";
import { useExtensions } from "../utils/ExtensionContext";

const initialState = { bold: false, italic: false, underline: false, highlight: false };

function reducer(state, action) {
  return action.type === "SET_STATE" ? { ...state, ...action.payload } : state;
}

// ─── Lucide icon resolver for extension-declared icon names ──────────────────

const ICON_NAME_MAP = {
  Upload, BarChart2, BookOpen, Eye, FileText, Settings2,
  Home, ExternalLink, Play, Zap, Edit3, ChevronRight, Puzzle,
  // Common aliases
  upload: Upload, analytics: BarChart2, book: BookOpen, view: Eye,
  summary: FileText, settings: Settings2, home: Home, open: ExternalLink,
  publish: Upload, chapter: BookOpen, sparkles: Zap,
};

function ExtIconResolved({ iconName, size = 14 }) {
  const Icon = (iconName && ICON_NAME_MAP[iconName]) || Puzzle;
  return <Icon size={size} />;
}

/**
 * EditorToolbar
 *
 * Now accepts a `session` prop so extension toolbar buttons can receive
 * the current book session when navigating.
 *
 * Desktop  → identical to the PC version: sticky floating pill, centered.
 * Android  → horizontally scrollable strip pinned to the top of the content
 *            area. Swipe left to reveal all controls. Never wraps or clips.
 */
export default function EditorToolbar({ execCommand, accentHex, session }) {
  const [active, dispatch] = useReducer(reducer, initialState);
  const fontRef = useRef("Arial");
  const sizeRef = useRef("3");
  const android = isAndroid();

  // Extension toolbar buttons
  const extButtons = useEditorToolbarExtensions();
  const { navigate } = useExtensions();

  // ── Detect active formatting state ──────────────────────────────────────
  const updateActive = useCallback(() => {
    const bg = document.queryCommandValue("backColor")?.toLowerCase();
    dispatch({
      type: "SET_STATE",
      payload: {
        bold:      document.queryCommandState("bold"),
        italic:    document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        highlight: bg === "rgba(255, 255, 0, 0.3)" || bg === "yellow",
      },
    });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", updateActive);
    return () => document.removeEventListener("selectionchange", updateActive);
  }, [updateActive]);

  // ── Format toggles ───────────────────────────────────────────────────────
  const toggle = (cmd, val = null) => { execCommand(cmd, val); updateActive(); };

  const toggleHighlight = () => {
    const color = "rgba(255, 255, 0, 0.3)";
    const cur = document.queryCommandValue("backColor");
    document.execCommand("backColor", false, cur.toLowerCase() === color ? "transparent" : color);
    updateActive();
  };

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const down = (e) => {
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); toggle("bold"); }
      else if (k === "i") { e.preventDefault(); toggle("italic"); }
      else if (k === "u") { e.preventDefault(); toggle("underline"); }
      else if (k === "h") { e.preventDefault(); toggleHighlight(); }
      else if (k === "s") { e.preventDefault(); document.dispatchEvent(new CustomEvent("triggerSave")); }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFontChange = (e) => { fontRef.current = e.target.value; execCommand("fontName", e.target.value); };
  const handleSizeChange = (e) => { sizeRef.current = e.target.value; execCommand("fontSize", e.target.value); };

  // ── Shared controls ──────────────────────────────────────────────────────
  const controls = (
    <>
      <FontSelector defaultValue="Arial" onChange={handleFontChange} />
      <SizeSelector defaultValue="3"     onChange={handleSizeChange} />
      <div className="w-px self-stretch bg-white/20 shrink-0" />
      <FormatButton format="bold"      label="B" title="Bold (Ctrl+B)"      style={{ fontWeight: "bold" }}          isActive={active.bold}      onClick={() => toggle("bold")} />
      <FormatButton format="italic"    label="I" title="Italic (Ctrl+I)"    style={{ fontStyle: "italic" }}         isActive={active.italic}    onClick={() => toggle("italic")} />
      <FormatButton format="underline" label="U" title="Underline (Ctrl+U)" style={{ textDecoration: "underline" }} isActive={active.underline} onClick={() => toggle("underline")} />
      <FormatButton format="highlight" label="H" title="Highlight (Ctrl+H)"                                         isActive={active.highlight} onClick={toggleHighlight} />
      <button
        className="flex items-center gap-1.5 px-3 py-1 rounded-md border-2 border-white/60 text-sm hover:bg-white/10 hover:text-white transition-all duration-200 shrink-0"
        title="Insert (coming soon)"
      >
        Insert <Upload className="w-3.5 h-3.5 text-white/70" />
      </button>

      {/* Extension-contributed toolbar buttons */}
      {extButtons.length > 0 && (
        <>
          <div className="w-px self-stretch bg-white/20 shrink-0" />
          {extButtons.map((btn, i) => (
            <button
              key={`${btn._extId}-${btn.id ?? i}`}
              title={`${btn.label} — ${btn._extName}`}
              onClick={() => navigate(btn._ext, btn.page ?? btn.id, session)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-white/30 text-sm hover:bg-white/10 hover:border-white/60 hover:text-white transition-all duration-200 shrink-0 text-white/70"
              style={{ borderColor: accentHex + '66', color: accentHex + 'cc' }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = accentHex;
                e.currentTarget.style.color = accentHex;
                e.currentTarget.style.background = accentHex + '1a';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = accentHex + '66';
                e.currentTarget.style.color = accentHex + 'cc';
                e.currentTarget.style.background = 'transparent';
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

  // Semi-transparent frosted-glass background
  const bg = `linear-gradient(to bottom right, ${accentHex}66, rgba(0,0,0,0.45))`;

  // ── Android: sticky scrollable strip with frosted glass ──────────────────
  if (android) {
    return (
      <div
        className="sticky top-0 z-20 mb-2 rounded-xl overflow-hidden backdrop-blur-md"
        style={{
          background: bg,
          boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        {/* Scrollable row — hidden scrollbar */}
        <div className="toolbar-scroll flex items-center gap-2 px-3 py-2 overflow-x-auto">
          {controls}
        </div>
        {/* Right-edge fade hints at scrollability */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-8"
          style={{ background: "linear-gradient(to right, transparent, rgba(0,0,0,0.4))" }}
        />
      </div>
    );
  }

  // ── Desktop: floating frosted-glass pill ─────────────────────────────────
  return (
    <div
      className="sticky top-4 z-20 mx-auto w-fit flex items-center gap-3 px-4 py-2
        rounded-2xl backdrop-blur-md ring-1 ring-white/20
        shadow-[0_8px_32px_rgba(0,0,0,0.3)] transition-all duration-300"
      style={{
        background: bg,
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {controls}
    </div>
  );
}
