/**
 * HistoryPanel.jsx — change history for the open book (v2, 1.1.18-beta.1).
 *
 * Docs-style version history, now with paragraph-level entries: each row is
 * one change (a rewritten paragraph, a deleted line, an added passage…).
 * Clicking a row expands a before → after preview with two actions:
 *   · "Revert this change"  — surgically undoes just that change, keeping
 *     everything written since (disabled once the passage has drifted).
 *   · "Restore to here"     — puts the whole chapter back to that state.
 * Desktop: right-hand side panel (closes on outside click / Esc).
 * Mobile: bottom sheet with back-button support.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { V, T, SPRING_SOFT } from "../utils/motion";
import { isAndroid } from "../utils/platform";
import {
  describeEntry, timeAgo, visibleHistory, canRevertEntry, BOOK_HISTORY_LIMIT,
} from "../utils/history";
import { hapticSelect } from "../utils/haptics";
import { DSIcons } from "../DesignSystem";

const KIND_ICON = {
  edit: "Edit",
  checkpoint: "Clock",
  "add-chapter": "FilePlus",
  "delete-chapter": "Trash",
  "rename-chapter": "Text",
  "rename-book": "Book",
  "move-chapter": "List",
  restore: "History",
};

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clip(text, n = 140) {
  const t = String(text || "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Before → after preview for one diff op. */
function OpPreview({ op }) {
  if (op.formatting) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-4)", padding: "4px 0" }}>
        Formatting changed — same text, new style.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "4px 0" }}>
      {op.before?.text ? (
        <div style={{
          fontSize: 12, lineHeight: 1.5, color: "var(--color-danger, #e5484d)",
          textDecoration: "line-through", textDecorationThickness: 1, opacity: 0.85,
        }}>
          {clip(op.before.text)}
        </div>
      ) : null}
      {op.after?.text ? (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-success, #46a758)" }}>
          {clip(op.after.text)}
        </div>
      ) : null}
    </div>
  );
}

function EntryRow({ entry, session, isCurrent, expanded, accentHex, onToggle, onRestore, onRevert }) {
  const { title, detail } = describeEntry(entry);
  const Icon = DSIcons[KIND_ICON[entry.kind] || "Clock"];
  const ops = (entry.blocks || []).slice(0, 3);
  const more = (entry.blocks || []).length - ops.length;
  const revertable = expanded && entry.kind === "edit" && canRevertEntry(session, entry);
  const restorable = entry.content != null || entry.kind === "rename-book" || entry.kind === "rename-chapter";

  const actionBtn = (label, onClick, { primary = false, disabled = false, title: tip } = {}) => (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) { hapticSelect(); onClick(); } }}
      disabled={disabled} title={tip}
      style={{
        padding: "6px 11px", borderRadius: 7, fontSize: 11.5, fontWeight: 700,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
        border: primary ? "none" : "1px solid var(--border)",
        background: primary ? accentHex : "transparent",
        color: primary ? "#fff" : "var(--text-2)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      onClick={() => { if (!isCurrent) onToggle(entry.id); }}
      style={{
        borderRadius: 10, border: `1px solid ${expanded ? "var(--border)" : "transparent"}`,
        background: isCurrent ? "var(--accent-a08, rgba(127,127,127,0.08))" : expanded ? "var(--surface, rgba(127,127,127,0.06))" : "transparent",
        cursor: isCurrent ? "default" : "pointer",
        transition: "background 0.15s, border-color 0.15s",
        marginBottom: 2,
      }}
      onMouseEnter={(e) => { if (!isCurrent && !expanded) e.currentTarget.style.background = "var(--surface-2, rgba(127,127,127,0.08))"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = isCurrent ? "var(--accent-a08, rgba(127,127,127,0.08))" : expanded ? "var(--surface, rgba(127,127,127,0.06))" : "transparent"; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px" }}>
        <span style={{
          marginTop: 1, width: 26, height: 26, borderRadius: 8, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: isCurrent ? accentHex : "var(--surface, rgba(127,127,127,0.12))",
          color: isCurrent ? "#fff" : "var(--text-3)",
        }}>
          <Icon size={14} color="currentColor" />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>
          <span style={{ display: "block", fontSize: 11.5, color: "var(--text-4)", marginTop: 1 }}>
            {isCurrent ? "Current version" : detail}{(detail || isCurrent) ? " · " : ""}{timeAgo(entry.ts)}
          </span>
        </span>
        {!isCurrent && (
          <DSIcons.ChevronDown size={13} color="var(--text-5)" style={{ marginTop: 4, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && !isCurrent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={T.fast}
            style={{ overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "0 12px 11px 48px" }}>
              {ops.length > 0 && (
                <div style={{ borderLeft: "2px solid var(--border)", paddingLeft: 10, marginBottom: 8 }}>
                  {ops.map((op, i) => <OpPreview key={i} op={op} />)}
                  {more > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-5)", paddingTop: 2 }}>…and {more} more paragraph{more > 1 ? "s" : ""}</div>
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {entry.kind === "edit" && (entry.blocks || []).length > 0 &&
                  actionBtn("Revert this change", () => onRevert(entry.id), {
                    primary: true, disabled: !revertable,
                    tip: revertable ? "Undo just this change, keep everything since" : "This passage has changed too much since — use Restore instead",
                  })}
                {restorable && actionBtn(
                  entry.kind === "delete-chapter" ? "Bring chapter back" : "Restore to here",
                  () => onRestore(entry.id),
                  { primary: !(entry.kind === "edit" && (entry.blocks || []).length > 0) },
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function HistoryPanel({ open, onClose, session, accentHex, onRestore, onRevert }) {
  const android = isAndroid();
  const history = useMemo(() => visibleHistory(session?.history), [session?.history]);
  const [expandedId, setExpandedId] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => { if (!open) setExpandedId(null); }, [open]);

  // Ticks once a minute while open so the relative timestamps stay honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    const iv = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(iv);
  }, [open]);

  // Escape closes; on desktop, clicking anywhere outside the panel closes too.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    const onDown = (e) => {
      if (android) return; // the sheet's backdrop handles it on mobile
      if (e.target?.closest?.("[data-history-opener]")) return; // the toggle button handles itself
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose, android]);

  // "Current" = the newest snapshot entry matching the live chapter content.
  const currentEntryId = useMemo(() => {
    for (const e of history) {
      if (e.content == null || e.chapIdx == null) continue;
      const chap = (session?.chapters || []).find((c) => c.chap_idx === e.chapIdx);
      if (chap && chap.content === e.content) return e.id;
      break; // only the newest snapshot entry can be "current"
    }
    return null;
  }, [history, session?.chapters]);

  const groups = useMemo(() => {
    const out = [];
    for (const e of history) {
      const label = dayLabel(e.ts);
      const last = out[out.length - 1];
      if (last && last.label === label) last.entries.push(e);
      else out.push({ label, entries: [e] });
    }
    return out;
  }, [history]);

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: android ? "0 4px 12px" : "16px 16px 12px", flexShrink: 0 }}>
      <DSIcons.History size={18} color="var(--text-2)" />
      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", flex: 1 }}>
        History
        {!android && (
          <span style={{ opacity: 0.4, fontSize: 11, fontWeight: 500, marginLeft: 8, letterSpacing: 0.4 }}>
            Ctrl+Shift+Z
          </span>
        )}
      </span>
      <button onClick={onClose} aria-label="Close history"
        style={{ border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer", padding: 6, borderRadius: 6, display: "flex" }}>
        <DSIcons.X size={16} color="currentColor" />
      </button>
    </div>
  );

  const body = (
    <div style={{ flex: 1, overflowY: "auto", padding: android ? "0 4px" : "0 10px", minHeight: 0 }}>
      {history.length === 0 ? (
        <div style={{ color: "var(--text-4)", fontSize: 13, textAlign: "center", padding: "48px 24px", lineHeight: 1.6 }}>
          No changes recorded yet.<br />
          Rewrite a paragraph, delete a line, add a passage — meaningful changes land here.
        </div>
      ) : (
        groups.map((g, gi) => (
          <div key={`${g.label}-${gi}`}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-5)", padding: "12px 12px 6px" }}>
              {g.label}
            </div>
            {g.entries.map((e) => (
              <EntryRow
                key={e.id} entry={e} session={session}
                isCurrent={e.id === currentEntryId}
                expanded={expandedId === e.id}
                accentHex={accentHex}
                onToggle={(id) => { hapticSelect(); setExpandedId((v) => (v === id ? null : id)); }}
                onRestore={onRestore} onRevert={onRevert}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );

  const footer = (
    <div style={{ padding: android ? "12px 4px 0" : "10px 16px 14px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
      <div style={{ fontSize: 11, color: "var(--text-5)", lineHeight: 1.5 }}>
        Click a change to preview it, then revert just that change or restore the
        chapter to that point. The last {BOOK_HISTORY_LIMIT} changes are saved inside your book.
      </div>
    </div>
  );

  if (android) {
    return createPortal(
      <AnimatePresence>
        {open && (
          <React.Fragment key="history-sheet">
            <motion.div
              variants={V.fade} initial="hidden" animate="show" exit="exit" transition={T.fast}
              style={{ position: "fixed", inset: 0, zIndex: 9998, background: "var(--scrim, rgba(0,0,0,0.5))" }}
              onClick={onClose}
            />
            <motion.div
              variants={V.sheet} initial="hidden" animate="show" exit="exit"
              style={{
                position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
                height: "68vh", display: "flex", flexDirection: "column",
                borderRadius: "20px 20px 0 0", padding: "16px 16px",
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
                background: "linear-gradient(to bottom right, var(--accent-a08), transparent), var(--modal-bg)",
                border: "1px solid var(--border)", borderBottom: "none",
              }}
            >
              <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border)", margin: "0 auto 14px", flexShrink: 0 }} />
              {header}
              {body}
              {footer}
            </motion.div>
          </React.Fragment>
        )}
      </AnimatePresence>,
      document.body
    );
  }

  // Desktop: right-hand side panel (Docs version-history placement).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.aside
          key="history-panel"
          ref={panelRef}
          initial={{ x: 340, opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 340, opacity: 0 }}
          transition={SPRING_SOFT}
          style={{
            position: "fixed", top: "var(--titlebar-h, 0px)", right: 0, bottom: 0, width: 330,
            zIndex: 60, display: "flex", flexDirection: "column",
            background: "var(--modal-bg, var(--app-bg))",
            borderLeft: "1px solid var(--border)",
            boxShadow: "-12px 0 32px rgba(0,0,0,0.18)",
          }}
        >
          {header}
          {body}
          {footer}
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body
  );
}
