/**
 * ErrorContext.js — Global error popup system for AuthNo
 *
 * Wrap your app in <ErrorProvider> and call useError() anywhere to fire
 * a user-visible error dialog with Copy, Show Log, and OK actions.
 *
 * Changes from original:
 *   - Lucide icons (Copy, AlertTriangle, X, List) → DSIcons from DesignSystem
 *   - All Tailwind className strings removed → pure inline styles
 *   - COLORS from DesignSystem tokens used for surface/border colours
 *
 * Usage:
 *   const { showError } = useError();
 *   try { ... } catch (e) { showError('saveBook', e, { sessionTitle }); }
 */

import React, { createContext, useContext, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { DSIcons, COLORS } from "../DesignSystem";
import { hapticError } from "./haptics";
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
      style={{
        position: "fixed", inset: 0, zIndex: 30001,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        background: "rgba(0,0,0,0.8)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%", borderRadius: "16px 16px 0 0",
        borderTop: `1px solid ${COLORS.border}`,
        background: "#0f0f1a",
        maxHeight: "82vh", display: "flex", flexDirection: "column",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "20px 20px 12px", borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DSIcons.List size={16} color={COLORS.textSubtle} />
            <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>Error Log</span>
            {history.length > 0 && (
              <span style={{
                fontSize: 12, padding: "2px 8px", borderRadius: 999, fontFamily: "monospace",
                background: accentHex + "33", color: accentHex,
              }}>
                {history.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: COLORS.textSubtle }}
          >
            <DSIcons.X size={16} />
          </button>
        </div>

        {/* Log entries */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          {history.length === 0 ? (
            <p style={{ color: COLORS.textDisabled, fontSize: 14, textAlign: "center", marginTop: 32 }}>
              {cleared ? "Log cleared." : "No errors recorded yet."}
            </p>
          ) : (
            history.map((entry) => (
              <div key={entry.id} style={{
                borderRadius: 12, border: `1px solid ${COLORS.border}`,
                padding: 12, background: "rgba(255,255,255,0.03)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>
                    {entry.icon} {entry.category}
                  </span>
                  <span style={{ color: COLORS.textDisabled, fontSize: 12, fontFamily: "monospace" }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                <p style={{ color: COLORS.textSubtle, fontSize: 12, lineHeight: 1.6, marginBottom: 4 }}>
                  {entry.message}
                </p>
                <p style={{ color: COLORS.textDisabled, fontSize: 12, fontStyle: "italic" }}>
                  {entry.suggestion}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        {history.length > 0 && (
          <div style={{
            flexShrink: 0, display: "flex", gap: 8,
            padding: "12px 20px 0", borderTop: `1px solid ${COLORS.border}`,
          }}>
            <button
              onClick={handleClear}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 12, fontWeight: 600,
                border: `1px solid ${COLORS.border}`, background: "transparent",
                color: COLORS.textSubtle, cursor: "pointer", transition: "color 0.15s, border-color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = COLORS.borderStrong; }}
              onMouseLeave={e => { e.currentTarget.style.color = COLORS.textSubtle; e.currentTarget.style.borderColor = COLORS.border; }}
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
              style={{
                flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 12, fontWeight: 600,
                background: accentHex + "40", border: `1px solid ${accentHex}80`,
                color: "#fff", cursor: "pointer",
              }}
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
      style={{
        position: "fixed", inset: 0, zIndex: 30000,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        background: "rgba(0,0,0,0.75)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%", borderRadius: "16px 16px 0 0",
        padding: "20px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)",
        borderTop: `1px solid ${COLORS.border}`,
        background: "#1a1a2e",
        maxHeight: "80vh", overflowY: "auto",
      }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DSIcons.Warning size={20} color={COLORS.danger} style={{ flexShrink: 0 }} />
            <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>
              {entry.icon} {entry.category} failed
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: COLORS.textSubtle, flexShrink: 0 }}
          >
            <DSIcons.X size={16} />
          </button>
        </div>

        {/* Error message */}
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <p style={{ color: "rgba(255,255,255,0.8)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            {entry.message}
          </p>
        </div>

        {/* Suggestion */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 20 }}>
          <span style={{ fontSize: 12, color: COLORS.textDisabled, marginTop: 2, flexShrink: 0 }}>Fix:</span>
          <p style={{ fontSize: 12, color: COLORS.textSubtle, lineHeight: 1.6, margin: 0 }}>
            {entry.suggestion}
          </p>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          {/* Copy error */}
          <button
            onClick={copyMessage}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "10px 12px", borderRadius: 12,
              border: `1px solid ${COLORS.border}`, background: "transparent",
              fontSize: 12, color: COLORS.textSubtle, cursor: "pointer",
              flexShrink: 0, transition: "color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = COLORS.borderStrong; }}
            onMouseLeave={e => { e.currentTarget.style.color = COLORS.textSubtle; e.currentTarget.style.borderColor = COLORS.border; }}
          >
            <DSIcons.Copy size={12} />
            {copied ? "Copied!" : "Copy error"}
          </button>

          {/* Show log */}
          <button
            onClick={onShowLog}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "10px 12px", borderRadius: 12, flexShrink: 0,
              border: `1px solid ${accentHex}66`, background: "transparent",
              fontSize: 12, fontWeight: 500, color: accentHex, cursor: "pointer",
            }}
          >
            <DSIcons.List size={12} />
            Show log
          </button>

          {/* OK */}
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 12,
              fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer",
              background: accentHex + "33", border: `1px solid ${accentHex}66`,
            }}
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
    hapticError();
    const entry = logError(operation, err, context);
    setErrorEntry(entry);
  }, []);

  const handleClose = () => {
    setErrorEntry(null);
    setShowLog(false);
  };

  const handleShowLog = () => {
    setErrorEntry(null);
    setShowLog(true);
  };

  return (
    <ErrorContext.Provider value={{ showError }}>
      {children}

      {errorEntry && (
        <ErrorPopup
          entry={errorEntry}
          onClose={handleClose}
          onShowLog={handleShowLog}
          accentHex={accentHex}
        />
      )}

      {showLog && (
        <ErrorLogModal
          onClose={() => setShowLog(false)}
          accentHex={accentHex}
        />
      )}
    </ErrorContext.Provider>
  );
}
