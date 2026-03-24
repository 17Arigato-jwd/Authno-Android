import React, { useReducer, useEffect, useCallback, useRef } from "react";
import { Upload } from "lucide-react";
import FontSelector from "./FontSelector";
import SizeSelector from "./SizeSelector";
import FormatButton from "./FormatButton";
import { isAndroid } from "../utils/platform";

const initialState = { bold: false, italic: false, underline: false, highlight: false };

function reducer(state, action) {
  return action.type === "SET_STATE" ? { ...state, ...action.payload } : state;
}

/**
 * EditorToolbar
 *
 * Desktop  → identical to the PC version: sticky floating pill, centered.
 * Android  → horizontally scrollable strip pinned to the top of the content
 *            area. Swipe left to reveal all controls. Never wraps or clips.
 */
export default function EditorToolbar({ execCommand, accentHex }) {
  const [active, dispatch] = useReducer(reducer, initialState);
  const fontRef = useRef("Arial");
  const sizeRef = useRef("3");
  const android = isAndroid();

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
    </>
  );

  // Semi-transparent frosted-glass background (40% opacity accent + dark tint)
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
