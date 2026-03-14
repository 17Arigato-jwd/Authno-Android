import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Save, SaveAll, Settings as SettingsIcon, Share2 } from "lucide-react";
import { saveBook, saveAsBook, exportBook } from "../utils/storageAdapter";
import { isMobile } from "../utils/platform";

/**
 * BurgerMenu
 *
 * Desktop  — small dropdown anchored directly below the burger button,
 *            mirroring the PC version exactly.
 * Mobile   — a bottom-sheet that slides up from the bottom of the screen,
 *            ensuring it's always fully visible and thumb-reachable.
 *
 * In both cases the menu is rendered via createPortal so it escapes any
 * overflow:hidden ancestors and is never clipped.
 *
 * Props
 * ─────
 * open            boolean   Whether the menu is visible
 * onClose         fn        Called to dismiss the menu
 * current         object    Active session (can be null)
 * setSessions     fn        Session updater
 * onOpenSettings  fn        Opens the Settings panel
 * accentHex       string    Theme accent colour
 * anchorRef       ref       Ref attached to the burger icon button in the header
 */
export default function BurgerMenu({
  open,
  onClose,
  current,
  setSessions,
  onOpenSettings,
  accentHex,
  anchorRef,
}) {
  const [status, setStatus] = useState("idle");
  const menuRef = useRef(null);
  const mobile = isMobile();

  // ── Position state (desktop only) ────────────────────────────────────────
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    if (!mobile && anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [open, mobile, anchorRef]);

  // ── Close on outside tap/click ────────────────────────────────────────────
  useEffect(() => {
    const handleOutside = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (anchorRef?.current && anchorRef.current.contains(e.target)) return;
      onClose?.();
    };
    if (open) {
      document.addEventListener("mousedown", handleOutside);
      document.addEventListener("touchstart", handleOutside, { passive: true });
    }
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [open, onClose, anchorRef]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!current) return;
    setStatus("saving");
    try {
      const result = await saveBook(current);
      // Update filePath in session list if a new file was created
      if (result?.filePath && result.filePath !== current.filePath) {
        setSessions((prev) =>
          prev.map((s) => (s.id === current.id ? { ...s, filePath: result.filePath } : s))
        );
      }
      setStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      alert("⚠️ Save failed. Check storage permissions and try again.");
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 2000);
  };

  // ── Save As (desktop) / Export+Share (Android) ────────────────────────────
  const handleSaveAs = async () => {
    if (!current) return;
    try {
      const result = await saveAsBook(current);
      if (result?.filePath) {
        setSessions((prev) =>
          prev.map((s) => (s.id === current.id ? { ...s, filePath: result.filePath } : s))
        );
      }
    } catch (err) {
      console.error("Save As failed:", err);
      alert("⚠️ Export failed.");
    }
  };

  // ── Keyboard shortcut: Ctrl+S ─────────────────────────────────────────────
  useEffect(() => {
    const handler = () => handleSave();
    document.addEventListener("triggerSave", handler);
    return () => document.removeEventListener("triggerSave", handler);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // ── Shared button styles ──────────────────────────────────────────────────
  const btnBase =
    "flex items-center gap-2 w-full px-3 py-2 rounded-md border-2 text-sm font-semibold transition-all duration-300 justify-center";

  const menuContent = (
    <>
      {/* ── SAVE ── */}
      <button
        disabled={status === "saving"}
        onClick={handleSave}
        className={`${btnBase} ${
          status === "saving"
            ? "border-yellow-400 text-yellow-400 opacity-50 cursor-not-allowed"
            : status === "saved"
            ? "border-green-400 text-green-400"
            : "border-white text-white hover:bg-white/10"
        }`}
      >
        <Save className="w-4 h-4" />
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save"}
      </button>

      <div className="h-px my-1 bg-white/10" />

      {/* ── SAVE AS / EXPORT ── */}
      {mobile ? (
        <button
          onClick={handleSaveAs}
          className={`${btnBase} border-white text-white hover:bg-white/10`}
        >
          <Share2 className="w-4 h-4" />
          Export / Share
        </button>
      ) : (
        <button
          onClick={handleSaveAs}
          className={`${btnBase} border-white text-white hover:bg-white/10`}
        >
          <SaveAll className="w-4 h-4" />
          Save As…
        </button>
      )}

      <div className="h-px my-1 bg-white/10" />

      {/* ── SETTINGS ── */}
      <button
        onClick={onOpenSettings}
        className={`${btnBase} border-white text-white hover:bg-white/10`}
      >
        <SettingsIcon className="w-4 h-4" />
        Settings
      </button>
    </>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // MOBILE — Bottom sheet (slides up, thumb-friendly)
  // ════════════════════════════════════════════════════════════════════════════
  if (mobile) {
    return createPortal(
      <>
        {/* Scrim */}
        <div
          className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        {/* Sheet */}
        <div
          ref={menuRef}
          className="fixed left-0 right-0 bottom-0 z-[9999] rounded-t-2xl p-5 shadow-2xl border-t border-white/20 animate-slideUp"
          style={{
            background: `linear-gradient(to bottom right, ${accentHex}EE, rgba(0,0,0,0.97))`,
            paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 1.5rem)`,
          }}
        >
          {/* Drag handle */}
          <div className="w-10 h-1 bg-white/25 rounded-full mx-auto mb-5" />
          {menuContent}
        </div>
      </>,
      document.body
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DESKTOP — Dropdown anchored below the burger button
  // Matches the PC version style exactly
  // ════════════════════════════════════════════════════════════════════════════
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] w-48 rounded-xl p-3 shadow-lg backdrop-blur-md border border-white/20 animate-fadeIn"
      style={{
        top: pos.top,
        right: pos.right,
        background: `linear-gradient(to bottom right, ${accentHex}F2, rgba(0,0,0,0.95))`,
      }}
    >
      {menuContent}
    </div>,
    document.body
  );
}
