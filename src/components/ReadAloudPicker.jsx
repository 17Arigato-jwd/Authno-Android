/**
 * ReadAloudPicker.jsx — pick a book, then a chapter, to read aloud (v1.1.18-beta.1).
 *
 * The home screens' "Read aloud" used to read whatever book happened to be
 * "current" (or just toast). Now it opens this two-step picker; picking a
 * chapter starts playback from there and continues to the end of the book.
 */

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { V, T } from "../utils/motion";
import { DSIcons } from "../DesignSystem";
import { hapticSelect } from "../utils/haptics";

export default function ReadAloudPicker({ open, sessions = [], accentHex, onPick, onClose }) {
  const [bookId, setBookId] = useState(null);
  useEffect(() => { if (open) setBookId(null); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (bookId) setBookId(null); else onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, bookId, onClose]);

  const book = sessions.find((s) => s.id === bookId) || null;
  const chapters = book ? [...(book.chapters || [])].sort((a, b) => a.order - b.order) : [];

  const rowStyle = {
    display: "flex", alignItems: "center", gap: 10, width: "100%",
    padding: "11px 12px", borderRadius: 9, border: "none", background: "transparent",
    textAlign: "left", color: "var(--text-1)", fontSize: 13.5, cursor: "pointer",
    transition: "background 0.12s",
  };
  const hover = (e, on) => { e.currentTarget.style.background = on ? "var(--surface)" : "transparent"; };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="ra-picker"
          variants={V.fade} initial="hidden" animate="show" exit="exit" transition={T.fast}
          style={{
            position: "fixed", inset: 0, zIndex: 11000,
            background: "var(--scrim-strong, rgba(0,0,0,0.6))", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
          onClick={onClose}
        >
          <motion.div
            variants={V.pop} initial="hidden" animate="show" exit="exit"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 400, maxWidth: "92vw", maxHeight: "70vh",
              display: "flex", flexDirection: "column",
              background: "var(--modal-bg)", border: "1px solid var(--border)",
              borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: "1px solid var(--border-sm)" }}>
              {book && (
                <button onClick={() => setBookId(null)} aria-label="Back to books"
                  style={{ border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer", padding: 4, display: "flex" }}>
                  <DSIcons.ChevronLeft size={16} color="currentColor" />
                </button>
              )}
              <DSIcons.Volume size={16} color="var(--text-2)" />
              <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-1)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {book ? `Read “${book.title || "Untitled Book"}” from…` : "What should I read?"}
              </span>
              <button onClick={onClose} aria-label="Close"
                style={{ border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer", padding: 4, display: "flex" }}>
                <DSIcons.X size={15} color="currentColor" />
              </button>
            </div>

            <div style={{ overflowY: "auto", padding: 8, minHeight: 120 }}>
              {!book ? (
                sessions.length === 0 ? (
                  <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-4)", fontSize: 13 }}>
                    No books yet — create or open one first.
                  </div>
                ) : sessions.map((s) => (
                  <button key={s.id} style={rowStyle}
                    onClick={() => { hapticSelect(); setBookId(s.id); }}
                    onMouseEnter={(e) => hover(e, true)} onMouseLeave={(e) => hover(e, false)}>
                    <DSIcons.Book size={15} color={accentHex} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.title || "Untitled Book"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-5)", flexShrink: 0 }}>
                      {(s.chapters || []).length} {(s.chapters || []).length === 1 ? "chapter" : "chapters"}
                    </span>
                    <DSIcons.ChevronRight size={13} color="var(--text-5)" />
                  </button>
                ))
              ) : (
                chapters.map((c, i) => (
                  <button key={c.chap_idx} style={rowStyle}
                    onClick={() => { hapticSelect(); onPick?.(book.id, c.chap_idx); onClose?.(); }}
                    onMouseEnter={(e) => hover(e, true)} onMouseLeave={(e) => hover(e, false)}>
                    <span style={{ width: 22, fontSize: 11.5, color: "var(--text-5)", flexShrink: 0, textAlign: "right" }}>{i + 1}.</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.title || `Chapter ${c.chap_idx}`}
                    </span>
                    <DSIcons.Volume size={13} color="var(--text-5)" />
                  </button>
                ))
              )}
            </div>

            {book && (
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border-sm)", fontSize: 11, color: "var(--text-5)" }}>
                Reading continues to the end of the book from the chapter you pick.
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
