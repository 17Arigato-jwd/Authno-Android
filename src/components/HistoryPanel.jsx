/**
 * HistoryPanel.jsx — change history ("version history") for the open book.
 *
 * Reference: Google Docs' version-history side panel (the author's ask came
 * from GIMP's undo history, but Docs is the design language AuthNo already
 * borrows for its editor UI). Desktop: a right-hand side panel. Mobile: a
 * bottom sheet, like Threads.
 *
 * Opens with Ctrl+Shift+Z / Ctrl+Shift+Y, the editor's clock button, or the
 * burger menu's "History" item (which carries the faded shortcut hint).
 * Clicking an entry restores that state; restores are themselves recorded,
 * so browsing versions is never destructive.
 */

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { V, T, SPRING_SOFT } from "../utils/motion";
import { isAndroid } from "../utils/platform";
import { describeEntry, timeAgo, BOOK_HISTORY_LIMIT } from "../utils/history";
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

function EntryRow({ entry, isCurrent, accentHex, onRestore }) {
  const { title, detail } = describeEntry(entry);
  const Icon = DSIcons[KIND_ICON[entry.kind] || "Clock"];
  return (
    <button
      onClick={() => { if (!isCurrent) { hapticSelect(); onRestore(entry.id); } }}
      disabled={isCurrent}
      title={isCurrent ? "This is the current state" : "Click to restore this state"}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, width: "100%",
        padding: "10px 12px", borderRadius: 10, border: "1px solid transparent",
        background: isCurrent ? "var(--accent-a08, rgba(127,127,127,0.08))" : "transparent",
        cursor: isCurrent ? "default" : "pointer", textAlign: "left",
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = "var(--surface-2, rgba(127,127,127,0.08))"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = isCurrent ? "var(--accent-a08, rgba(127,127,127,0.08))" : "transparent"; }}
    >
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
          {isCurrent ? "Current version" : detail}{detail || isCurrent ? " · " : ""}{timeAgo(entry.ts)}
        </span>
      </span>
    </button>
  );
}

export default function HistoryPanel({ open, onClose, session, accentHex, onRestore }) {
  const android = isAndroid();
  const history = useMemo(() => session?.history || [], [session?.history]);

  // Ticks once a minute while open so the relative timestamps stay honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    const iv = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(iv);
  }, [open]);

  // Escape closes (desktop).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // "Current" = the newest entry whose snapshot matches the live chapter
  // content — clicking it would be a no-op, so it gets the badge instead.
  const currentEntryId = useMemo(() => {
    for (const e of history) {
      if (e.content == null || e.chapIdx == null) continue;
      const chap = (session?.chapters || []).find((c) => c.chap_idx === e.chapIdx);
      if (chap && chap.content === e.content) return e.id;
      break; // only the newest snapshot entry can be "current"
    }
    return null;
  }, [history, session?.chapters]);

  // Group rows under Today / Yesterday / date headers, Docs-style.
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
          Start writing and your recent changes will show up here.
        </div>
      ) : (
        groups.map((g, gi) => (
          <div key={`${g.label}-${gi}`}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-5)", padding: "12px 12px 6px" }}>
              {g.label}
            </div>
            {g.entries.map((e) => (
              <EntryRow key={e.id} entry={e} isCurrent={e.id === currentEntryId} accentHex={accentHex} onRestore={onRestore} />
            ))}
          </div>
        ))
      )}
    </div>
  );

  const footer = (
    <div style={{ padding: android ? "12px 4px 0" : "10px 16px 14px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
      <div style={{ fontSize: 11, color: "var(--text-5)", lineHeight: 1.5 }}>
        Click a change to go back to it — restores are recorded too, so nothing is lost.
        The last {BOOK_HISTORY_LIMIT} changes are saved inside your book.
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
                height: "62vh", display: "flex", flexDirection: "column",
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
          initial={{ x: 340, opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 340, opacity: 0 }}
          transition={SPRING_SOFT}
          style={{
            position: "fixed", top: "var(--titlebar-h, 0px)", right: 0, bottom: 0, width: 320,
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
