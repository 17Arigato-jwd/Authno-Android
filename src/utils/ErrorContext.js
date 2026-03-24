/**
 * ErrorContext.js — Global error popup system for AuthNo
 *
 * Wrap your app in <ErrorProvider> and call useError() anywhere to fire
 * a user-visible error dialog with Copy, Show Log, and OK actions.
 *
 * Usage:
 *   const { showError } = useError();
 *   try { ... } catch (e) { showError('saveBook', e, { sessionTitle }); }
 */

import React, { createContext, useContext, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Copy, AlertTriangle, X, List } from "lucide-react";
import {
  logError,
  formatError,
  formatBugReport,
  getErrorHistory,
  clearErrorHistory,
} from "./ErrorLogger";

// ─── Context ──────────────────────────────────────────────────────────────────

const ErrorContext = createContext(null);

export function useError() {
  const ctx = useContext(ErrorContext);
  if (!ctx) throw new Error("useError must be used inside <ErrorProvider>");
  return ctx;
}

// ─── Error Log Modal ──────────────────────────────────────────────────────────

function ErrorLogModal({ onClose, accentHex }) {
  const [history, setHistory] = useState(() => getErrorHistory());
  const [cleared, setCleared] = useState(false);

  const handleClear = () => {
    clearErrorHistory();
    setHistory([]);
    setCleared(true);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[30001] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full rounded-t-2xl border-t border-white/10"
        style={{
          background: "#0f0f1a",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0 border-b border-white/10">
          <div className="flex items-center gap-2">
            <List className="w-4 h-4 text-white/60" />
            <span className="text-white font-semibold text-sm">Error Log</span>
            {history.length > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-mono"
                style={{ background: accentHex + "33", color: accentHex }}
              >
                {history.length}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Log entries */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {history.length === 0 ? (
            <p className="text-white/30 text-sm text-center mt-8">
              {cleared ? "Log cleared." : "No errors recorded yet."}
            </p>
          ) : (
            history.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-white/10 p-3"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white text-xs font-semibold">
                    {entry.icon} {entry.category}
                  </span>
                  <span className="text-white/30 text-xs font-mono">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-white/60 text-xs leading-relaxed mb-1">{entry.message}</p>
                <p className="text-white/30 text-xs italic">{entry.suggestion}</p>
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        {history.length > 0 && (
          <div className="shrink-0 flex gap-2 px-5 pt-3 border-t border-white/10">
            <button
              onClick={handleClear}
              className="flex-1 py-2 rounded-lg text-xs font-semibold border border-white/20 text-white/50 hover:text-white hover:border-white/40 transition"
            >
              Clear Log
            </button>
            <button
              onClick={() => {
                const report = formatBugReport(20);
                navigator.clipboard?.writeText(report).catch(() => {
                  const ta = document.createElement("textarea");
                  ta.value = report;
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand("copy");
                  document.body.removeChild(ta);
                });
              }}
              className="flex-1 py-2 rounded-lg text-xs font-semibold text-white transition"
              style={{ background: accentHex + "40", border: `1px solid ${accentHex}80` }}
            >
              Copy Full Report
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Error Popup ──────────────────────────────────────────────────────────────

function ErrorPopup({ entry, onClose, onShowLog, accentHex }) {
  const [copied, setCopied] = useState(false);

  const copyMessage = () => {
    const text = formatError(entry);
    navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!entry) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[30000] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full rounded-t-2xl p-5 border-t border-white/10"
        style={{
          background: "#1a1a2e",
          maxHeight: "80vh",
          overflowY: "auto",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
        }}
      >
        {/* Title row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-white font-semibold text-sm">
              {entry.icon} {entry.category} failed
            </span>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error message */}
        <div className="bg-white/5 rounded-lg p-3 mb-3">
          <p className="text-white/80 text-sm leading-relaxed">{entry.message}</p>
        </div>

        {/* Suggestion */}
        <div className="flex items-start gap-2 mb-5">
          <span className="text-xs text-white/40 mt-0.5 shrink-0">Fix:</span>
          <p className="text-xs text-white/60 leading-relaxed">{entry.suggestion}</p>
        </div>

        {/* Three action buttons */}
        <div className="flex gap-2">
          {/* Copy error message */}
          <button
            onClick={copyMessage}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-white/20 text-xs text-white/60 hover:text-white hover:border-white/40 transition shrink-0"
          >
            <Copy className="w-3 h-3" />
            {copied ? "Copied!" : "Copy error"}
          </button>

          {/* Show error log */}
          <button
            onClick={onShowLog}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-medium transition shrink-0"
            style={{ borderColor: accentHex + "66", color: accentHex }}
          >
            <List className="w-3 h-3" />
            Show log
          </button>

          {/* OK / dismiss */}
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white transition"
            style={{ background: accentHex + "33", border: `1px solid ${accentHex}66` }}
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ErrorProvider({ children, accentHex = "#5a00d9" }) {
  const [errorEntry, setErrorEntry] = useState(null);
  const [showLog,    setShowLog]    = useState(false);

  const showError = useCallback((operation, err, context = {}) => {
    const entry = logError(operation, err, context);
    setErrorEntry(entry);
  }, []);

  const handleClose = () => {
    setErrorEntry(null);
    setShowLog(false);
  };

  const handleShowLog = () => {
    setErrorEntry(null); // dismiss popup first so log modal sits on top cleanly
    setShowLog(true);
  };

  return (
    <ErrorContext.Provider value={{ showError }}>
      {children}

      {/* Global error popup */}
      {errorEntry && (
        <ErrorPopup
          entry={errorEntry}
          onClose={handleClose}
          onShowLog={handleShowLog}
          accentHex={accentHex}
        />
      )}

      {/* Error log modal */}
      {showLog && (
        <ErrorLogModal
          onClose={() => setShowLog(false)}
          accentHex={accentHex}
        />
      )}
    </ErrorContext.Provider>
  );
}
