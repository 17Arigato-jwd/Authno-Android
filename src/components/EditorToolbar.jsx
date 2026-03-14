import React, { useReducer, useEffect, useCallback, useRef } from "react";
import { Upload } from "lucide-react";
import FontSelector from "./FontSelector";
import SizeSelector from "./SizeSelector";
import FormatButton from "./FormatButton";
import { isMobile } from "../utils/platform";

const initialState = { bold: false, italic: false, underline: false, highlight: false };

function reducer(state, action) {
  return action.type === "SET_STATE" ? { ...state, ...action.payload } : state;
}

/**
 * EditorToolbar
 *
 * Desktop  — pixel-perfect match to the PC version: a floating pill,
 *            sticky at the top of the editor scroll area.
 *
 * Mobile   — a slim horizontal scrollable strip pinned to the top of the
 *            editor content area.  All controls are accessible by swiping
 *            left/right; the strip never wraps or overflows the screen.
 *            A subtle right-fade gradient hints that it scrolls.
 */
export default function EditorToolbar({ execCommand, accentHex }) {
  const [activeButtons, dispatch] = useReducer(reducer, initialState);
  const fontRef = useRef("Arial");
  const sizeRef = useRef("3");
  const mobile = isMobile();

  // ── Detect active formatting ──────────────────────────────────────────────
  const updateActiveStates = useCallback(() => {
    const backColor = document.queryCommandValue("backColor")?.toLowerCase();
    dispatch({
      type: "SET_STATE",
      payload: {
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        highlight: backColor === "rgba(255, 255, 0, 0.3)" || backColor === "yellow",
      },
    });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", updateActiveStates);
    return () => document.removeEventListener("selectionchange", updateActiveStates);
  }, [updateActiveStates]);

  // ── Format toggles ────────────────────────────────────────────────────────
  const toggleFormat = (cmd, value = null) => {
    execCommand(cmd, value);
    updateActiveStates();
  };

  const toggleHighlight = () => {
    const highlightColor = "rgba(255, 255, 0, 0.3)";
    const current = document.queryCommandValue("backColor");
    document.execCommand(
      "backColor",
      false,
      current.toLowerCase() === highlightColor ? "transparent" : highlightColor
    );
    updateActiveStates();
  };

  // ── Keyboard shortcuts (desktop) ──────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!e.ctrlKey) return;
      switch (e.key.toLowerCase()) {
        case "b": e.preventDefault(); toggleFormat("bold");      break;
        case "i": e.preventDefault(); toggleFormat("italic");    break;
        case "u": e.preventDefault(); toggleFormat("underline"); break;
        case "h": e.preventDefault(); toggleHighlight();         break;
        case "s":
          e.preventDefault();
          document.dispatchEvent(new CustomEvent("triggerSave"));
          break;
        default: break;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Font / Size ───────────────────────────────────────────────────────────
  const handleFontChange = (e) => { fontRef.current = e.target.value; execCommand("fontName", e.target.value); };
  const handleSizeChange = (e) => { sizeRef.current = e.target.value; execCommand("fontSize", e.target.value); };

  // ── Controls (shared) ─────────────────────────────────────────────────────
  const controls = (
    <>
      <FontSelector defaultValue="Arial" onChange={handleFontChange} />
      <SizeSelector defaultValue="3"     onChange={handleSizeChange} />

      {/* Thin separator */}
      <div className="w-px self-stretch bg-white/20 mx-1 shrink-0" />

      <FormatButton format="bold"      label="B" title="Bold (Ctrl+B)"      style={{ fontWeight: "bold" }}          isActive={activeButtons.bold}      onClick={() => toggleFormat("bold")} />
      <FormatButton format="italic"    label="I" title="Italic (Ctrl+I)"    style={{ fontStyle: "italic" }}         isActive={activeButtons.italic}    onClick={() => toggleFormat("italic")} />
      <FormatButton format="underline" label="U" title="Underline (Ctrl+U)" style={{ textDecoration: "underline" }} isActive={activeButtons.underline} onClick={() => toggleFormat("underline")} />
      <FormatButton format="highlight" label="H" title="Highlight (Ctrl+H)"                                         isActive={activeButtons.highlight} onClick={toggleHighlight} />

      {/* Insert placeholder */}
      <button
        className="flex items-center gap-1.5 px-3 py-1 rounded-md border-2 border-white/60 text-sm hover:bg-white/10 hover:text-white transition-all duration-200 shrink-0"
        title="Insert (coming soon)"
      >
        Insert <Upload className="w-3.5 h-3.5 text-white/70" />
      </button>
    </>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // MOBILE — horizontal scrollable strip
  // ════════════════════════════════════════════════════════════════════════════
  if (mobile) {
    return (
      <div
        className="relative mb-3 rounded-xl overflow-hidden"
        style={{ background: `linear-gradient(to right, ${accentHex}CC, rgba(0,0,0,0.85))` }}
      >
        {/* Scrollable row */}
        <div
          className="flex items-center gap-2 px-3 py-2 overflow-x-auto"
          style={{
            scrollbarWidth: "none",          /* Firefox */
            msOverflowStyle: "none",         /* IE/Edge */
            WebkitOverflowScrolling: "touch",
          }}
        >
          {/* Hide webkit scrollbar via inline style trick */}
          <style>{`.toolbar-scroll::-webkit-scrollbar{display:none}`}</style>
          <div className="toolbar-scroll flex items-center gap-2 shrink-0">
            {controls}
          </div>
        </div>

        {/* Right-edge fade — hints that content scrolls */}
        <div
          className="pointer-events-none absolute top-0 right-0 h-full w-10"
          style={{
            background: `linear-gradient(to right, transparent, rgba(0,0,0,0.6))`,
          }}
        />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DESKTOP — floating pill, identical to PC version
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div
      className="sticky top-4 z-20 left-1/2 transform flex items-center gap-3 px-4 py-2
        rounded-2xl backdrop-blur-md ring-2 ring-white/70
        shadow-[0_0_20px_2px_rgba(255,255,255,0.1)] transition-all duration-300
        w-fit mx-auto"
      style={{
        background: `linear-gradient(to bottom right, ${accentHex}B3, rgba(0,0,0,0.7))`,
      }}
    >
      {controls}
    </div>
  );
}
