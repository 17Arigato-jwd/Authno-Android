/**
 * LargeBookDialog.jsx — the warning shown before opening a very large book.
 *
 * Three ways out, and the wording matters because the safe one has to look
 * like the ordinary one rather than a penalty:
 *
 *   Open in preview mode  — chapter list now, each chapter opens on demand
 *   Open anyway           — load the lot, as before
 *   Cancel                — backdrop, Escape, or the button
 *
 * The choice can be remembered per book, so a writer who lives in one large
 * manuscript is asked once rather than every time they sit down.
 */

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { V, T } from "../utils/motion";
import { DSIcons } from "../DesignSystem";
import { formatSize, estimateBookBytes } from "../utils/largeBooks";

export default function LargeBookDialog({ open, book, accentHex, onPreview, onOpenAnyway, onCancel }) {
  const [remember, setRemember] = useState(false);

  // Reset between books — a checkbox left ticked from the last book would
  // silently apply the previous answer to this one.
  useEffect(() => { if (open) setRemember(false); }, [open, book?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!book) return null;
  const size = formatSize(estimateBookBytes(book));
  const chapterCount = (book.chapters || []).length;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="large-book-backdrop"
          variants={V.fade} initial="hidden" animate="show" exit="exit" transition={T.fast}
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "var(--scrim-strong, rgba(0,0,0,0.6))", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
          onClick={onCancel}
        >
          <motion.div
            variants={V.pop} initial="hidden" animate="show" exit="exit"
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-labelledby="large-book-title"
            style={{
              background: "var(--modal-bg)", color: "var(--text-1)",
              border: "1px solid var(--border)", borderRadius: 16,
              padding: 24, width: 420, maxWidth: "92vw",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span aria-hidden="true" style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, borderRadius: 9,
                background: "var(--color-warning-bg, rgba(245,158,11,0.15))",
                color: "var(--color-warning, #f59e0b)", flexShrink: 0,
              }}>
                <DSIcons.Warning size={17} />
              </span>
              <h2 id="large-book-title" style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
                This book is very large
              </h2>
            </div>

            <div style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.65, marginBottom: 18 }}>
              <p style={{ margin: "0 0 10px" }}>
                <strong style={{ color: "var(--text-1)" }}>{book.title || "This book"}</strong> is
                about {size} across {chapterCount} chapter{chapterCount === 1 ? "" : "s"}.
                Opening all of it at once can make AuthNo slow on this device.
              </p>
              <p style={{ margin: 0 }}>
                Preview mode lists every chapter straight away and opens each one as you
                go, so it stays quick. You can write in it exactly as normal.
              </p>
            </div>

            <label style={{
              display: "flex", alignItems: "center", gap: 9, marginBottom: 18,
              fontSize: 12.5, color: "var(--text-3)", cursor: "pointer", userSelect: "none",
            }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: accentHex || "var(--accent)", cursor: "pointer" }}
              />
              Remember my choice for this book
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button onClick={onCancel}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--text-2)",
                }}>
                Cancel
              </button>
              <button onClick={() => onOpenAnyway?.({ remember })}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--text-2)",
                }}>
                Open anyway
              </button>
              <button onClick={() => onPreview?.({ remember })} autoFocus
                style={{
                  padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 700, color: "#fff",
                  background: accentHex || "var(--accent)",
                }}>
                Open in preview mode
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
