import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Save, SaveAll, Settings as SettingsIcon, FolderOpen, X, Copy, AlertCircle } from "lucide-react";
import { saveBook, saveAsBook, openBook } from "../utils/storage";
import { useError } from "../utils/ErrorContext";
import { isAndroid } from "../utils/platform";

// ─── BurgerMenu ────────────────────────────────────────────────────────────────

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
  const { showError } = useError();
  const [status,  setStatus]  = useState("idle");
  const [busy,    setBusy]    = useState(false);
  const menuRef = useRef(null);
  const android = isAndroid();

  // ── Anchor position (desktop only) ────────────────────────────────────────
  const [pos, setPos] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (open && !android && anchorRef?.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
  }, [open, android, anchorRef]);

  // ── Close on outside tap ──────────────────────────────────────────────────
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

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!current || busy) return;
    setBusy(true);
    setStatus("saving");
    try {
      const result = await saveBook(current);
      if (result?.filePath && result.filePath !== current.filePath) {
        setSessions((prev) =>
          prev.map((s) => (s.id === current.id ? { ...s, filePath: result.filePath } : s))
        );
      }
      setStatus("saved");
    } catch (err) {
      showError('saveBook', err, { sessionTitle: current?.title });
      setStatus("error");
    } finally {
      setBusy(false);
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  // ── Save As ───────────────────────────────────────────────────────────────
  // CRITICAL: close the menu first, wait for it to fully unmount, THEN open share sheet.
  // The share sheet launches behind any overlay that's still in the DOM.
  const handleSaveAs = async () => {
    if (!current || busy) return;
    setBusy(true);

    // Dismiss the menu and give Android time to remove it from the view hierarchy
    onClose?.();
    await _wait(350);

    try {
      await saveAsBook(current);
      // saveAsBook with Share doesn't return a filePath — auto-save handles persistence
    } catch (err) {
      showError('saveAsBook', err, { sessionTitle: current?.title });
    } finally {
      setBusy(false);
    }
  };

  // ── Open ──────────────────────────────────────────────────────────────────
  const handleOpen = async () => {
    if (busy) return;
    setBusy(true);
    onClose?.();
    await _wait(200);
    try {
      const session = await openBook();
      if (!session) return;
      setSessions((prev) => {
        if (prev.some((s) => s.id === session.id)) { onOpen?.(session.id); return prev; }
        onOpen?.(session.id);
        return [session, ...prev];
      });
    } catch (err) {
      showError('openBook', err);
    } finally {
      setBusy(false);
    }
  };

  // ── Ctrl+S ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => handleSave();
    document.addEventListener("triggerSave", handler);
    return () => document.removeEventListener("triggerSave", handler);
  }, [current, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const btn = "flex items-center gap-2 w-full px-3 py-2 rounded-md border-2 text-sm font-semibold transition-all duration-300 justify-center";

  const menuContent = (
    <>
      {/* SAVE */}
      <button
        disabled={busy || !current}
        onClick={handleSave}
        className={`${btn} ${
          status === "saving"
            ? "border-yellow-400 text-yellow-400 opacity-70 cursor-not-allowed"
            : status === "saved"
            ? "border-green-400 text-green-400"
            : status === "error"
            ? "border-red-400 text-red-400"
            : "border-white text-white hover:bg-white/10"
        }`}
      >
        <Save className="w-4 h-4" />
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? "Failed ✗" : "Save"}
      </button>

      <div className="h-px my-1 bg-white/10" />

      {/* SAVE AS */}
      <button
        disabled={busy || !current}
        onClick={handleSaveAs}
        className={`${btn} border-white text-white hover:bg-white/10 ${busy ? "opacity-50" : ""}`}
      >
        <SaveAll className="w-4 h-4" />
        Save As…
      </button>

      <div className="h-px my-1 bg-white/10" />

      {/* OPEN */}
      <button
        disabled={busy}
        onClick={handleOpen}
        className={`${btn} border-white text-white hover:bg-white/10 ${busy ? "opacity-50" : ""}`}
      >
        <FolderOpen className="w-4 h-4" />
        Open…
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

  return (
    <>
      {/* Menu — only when open */}
      {open && (android ? (
        createPortal(
          <>
            <div className="fixed inset-0 z-[9998] bg-black/50" onClick={onClose} />
            <div
              ref={menuRef}
              className="fixed bottom-0 left-0 right-0 z-[9999] rounded-t-2xl p-5 border-t border-white/20 animate-slideUp"
              style={{ background: gradient,
                       paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
            >
              <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5" />
              {menuContent}
            </div>
          </>,
          document.body
        )
      ) : (
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] w-48 rounded-xl p-3 shadow-lg backdrop-blur-md border border-white/20 animate-fadeIn"
            style={{ top: pos.top, right: pos.right, background: gradient }}
          >
            {menuContent}
          </div>,
          document.body
        )
      ))}
    </>
  );
}

function _wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}
