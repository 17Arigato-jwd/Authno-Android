import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Save, SaveAll, Settings as SettingsIcon, FolderOpen } from "lucide-react";
import { saveBook, saveAsBook, openBook } from "../utils/storage";
import { isAndroid } from "../utils/platform";

/**
 * BurgerMenu
 *
 * Props
 *   open            boolean   whether the menu is visible
 *   onClose         fn        dismiss callback
 *   current         object    active session (may be null)
 *   setSessions     fn        session list updater
 *   onOpenSettings  fn        open the Settings panel
 *   onOpen          fn(id)    called after a file is opened — sets it as current
 *   accentHex       string    theme accent colour
 *   anchorRef       ref       burger button ref — used for desktop positioning
 */
export default function BurgerMenu({
  open,
  onClose,
  current,
  setSessions,
  onOpenSettings,
  onOpen,
  accentHex,
  anchorRef,
}) {
  const [status, setStatus]   = useState("idle");
  const [opening, setOpening] = useState(false);
  const menuRef  = useRef(null);
  const android  = isAndroid();

  // ── Anchor position (desktop only) ──────────────────────────────────────
  const [pos, setPos] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (open && !android && anchorRef?.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
  }, [open, android, anchorRef]);

  // ── Close on outside tap ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open, onClose, anchorRef]);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!current) return;
    setStatus("saving");
    try {
      const result = await saveBook(current);
      // Update filePath in state if this was the first save
      if (result?.filePath && result.filePath !== current.filePath) {
        setSessions((prev) =>
          prev.map((s) => (s.id === current.id ? { ...s, filePath: result.filePath } : s))
        );
      }
      setStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      alert("⚠️ Save failed. Check storage permissions.");
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 2000);
  };

  // ── Save As ───────────────────────────────────────────────────────────────
  const handleSaveAs = async () => {
    if (!current) return;
    try {
      const result = await saveAsBook(current);
      if (result?.cancelled) return;
      if (result?.filePath) {
        setSessions((prev) =>
          prev.map((s) => (s.id === current.id ? { ...s, filePath: result.filePath } : s))
        );
      }
    } catch (err) {
      console.error("Save As failed:", err);
      alert("⚠️ Save As failed.");
    }
  };

  // ── Open ──────────────────────────────────────────────────────────────────
  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    onClose?.(); // close menu before picker opens (important on Android)
    try {
      const session = await openBook();
      if (!session) return; // user cancelled
      setSessions((prev) => {
        // Don't duplicate if already open
        if (prev.some((s) => s.id === session.id)) {
          onOpen?.(session.id);
          return prev;
        }
        onOpen?.(session.id);
        return [session, ...prev];
      });
    } catch (err) {
      console.error("Open failed:", err);
      alert("⚠️ Could not open that file.\n" + err.message);
    } finally {
      setOpening(false);
    }
  };

  // ── Ctrl+S shortcut ───────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => handleSave();
    document.addEventListener("triggerSave", handler);
    return () => document.removeEventListener("triggerSave", handler);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const btn =
    "flex items-center gap-2 w-full px-3 py-2 rounded-md border-2 text-sm font-semibold transition-all duration-300 justify-center";

  const menuContent = (
    <>
      {/* SAVE */}
      <button
        disabled={status === "saving"}
        onClick={handleSave}
        className={`${btn} ${
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

      {/* SAVE AS — same label on all platforms */}
      <button onClick={handleSaveAs} className={`${btn} border-white text-white hover:bg-white/10`}>
        <SaveAll className="w-4 h-4" />
        Save As…
      </button>

      <div className="h-px my-1 bg-white/10" />

      {/* OPEN */}
      <button
        onClick={handleOpen}
        disabled={opening}
        className={`${btn} border-white text-white hover:bg-white/10 ${opening ? "opacity-50" : ""}`}
      >
        <FolderOpen className="w-4 h-4" />
        {opening ? "Opening…" : "Open…"}
      </button>

      <div className="h-px my-1 bg-white/10" />

      {/* SETTINGS */}
      <button onClick={onOpenSettings} className={`${btn} border-white text-white hover:bg-white/10`}>
        <SettingsIcon className="w-4 h-4" />
        Settings
      </button>
    </>
  );

  const gradient = `linear-gradient(to bottom right, ${accentHex}F2, rgba(0,0,0,0.95))`;

  // ── Android: bottom-sheet ─────────────────────────────────────────────────
  if (android) {
    return createPortal(
      <>
        <div className="fixed inset-0 z-[9998] bg-black/50" onClick={onClose} />
        <div
          ref={menuRef}
          className="fixed bottom-0 left-0 right-0 z-[9999] rounded-t-2xl p-5 border-t border-white/20 animate-slideUp"
          style={{
            background: gradient,
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
          }}
        >
          <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />
          {menuContent}
        </div>
      </>,
      document.body
    );
  }

  // ── Desktop: anchored dropdown ────────────────────────────────────────────
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] w-48 rounded-xl p-3 shadow-lg backdrop-blur-md border border-white/20 animate-fadeIn"
      style={{ top: pos.top, right: pos.right, background: gradient }}
    >
      {menuContent}
    </div>,
    document.body
  );
}
