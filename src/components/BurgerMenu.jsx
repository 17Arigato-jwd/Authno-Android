import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Save, SaveAll, Settings as SettingsIcon, FolderOpen, X, Copy, AlertCircle } from "lucide-react";
import { saveBook, saveAsBook, openBook } from "../utils/storage";
import { logError, formatError, formatBugReport, getErrorHistory, clearErrorHistory } from "../utils/ErrorLogger";
import { isAndroid } from "../utils/platform";

// ─── Error Dialog ──────────────────────────────────────────────────────────────

function ErrorDialog({ entry, onClose, accentHex }) {
  const [copied, setCopied] = useState(false);

  const copyReport = () => {
    const report = formatBugReport(10);
    navigator.clipboard?.writeText(report).catch(() => {
      // Fallback for WebView
      const ta = document.createElement('textarea');
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!entry) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full rounded-t-2xl p-5 border-t border-white/10"
        style={{ background: '#1a1a2e', maxHeight: '80vh', overflowY: 'auto',
                 paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-white font-semibold text-sm">
              {entry.icon} {entry.category} failed
            </span>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* What went wrong */}
        <div className="bg-white/5 rounded-lg p-3 mb-3">
          <p className="text-white/80 text-sm leading-relaxed">{entry.message}</p>
        </div>

        {/* Suggestion */}
        <div className="flex items-start gap-2 mb-4">
          <span className="text-xs text-white/40 mt-0.5 shrink-0">Fix:</span>
          <p className="text-xs text-white/60 leading-relaxed">{entry.suggestion}</p>
        </div>

        {/* Technical details (collapsed) */}
        <details className="mb-4">
          <summary className="text-xs text-white/30 cursor-pointer select-none hover:text-white/50">
            Technical details
          </summary>
          <pre className="mt-2 text-xs text-white/40 font-mono whitespace-pre-wrap break-all bg-black/30 rounded p-2 leading-relaxed">
            {formatError(entry)}
          </pre>
        </details>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={copyReport}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/20 text-xs text-white/60 hover:text-white hover:border-white/40 transition"
          >
            <Copy className="w-3 h-3" />
            {copied ? 'Copied!' : 'Copy bug report'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-xs font-semibold text-white"
            style={{ background: accentHex + '33', border: `1px solid ${accentHex}66` }}
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

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
  const [status,  setStatus]  = useState("idle");
  const [busy,    setBusy]    = useState(false);
  const [errorEntry, setErrorEntry] = useState(null);
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

  // ── Show error dialog ─────────────────────────────────────────────────────
  const showError = (operation, err, context = {}) => {
    const entry = logError(operation, err, context);
    setErrorEntry(entry);
  };

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

  if (!open && !errorEntry) return null;

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
      {/* Error dialog — shown regardless of menu open state */}
      {errorEntry && (
        <ErrorDialog
          entry={errorEntry}
          onClose={() => setErrorEntry(null)}
          accentHex={accentHex}
        />
      )}

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
