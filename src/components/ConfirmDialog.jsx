/**
 * ConfirmDialog.jsx — shared, themed confirmation dialogs (v1.1.18).
 *
 * Replaces the window.confirm() calls and the one-off delete modal that lived
 * inside Sidebar. Two exports:
 *
 *   <ConfirmDialog>     — generic confirm (used for chapter deletes)
 *   <DeleteBookDialog>  — book removal, with the "also permanently delete the
 *                         file from this device" checkbox the author asked for
 *
 * Both close on Escape and backdrop click, and animate through framer-motion.
 */

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { V, T } from "../utils/motion";
import { isAndroid } from "../utils/platform";
import { DSIcons } from "../DesignSystem";

function DialogShell({ open, onCancel, children, maxWidth = 380 }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="confirm-backdrop"
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
            style={{
              background: "var(--modal-bg)", color: "var(--text-1)",
              border: "1px solid var(--border)", borderRadius: 16,
              padding: 24, width: maxWidth, maxWidth: "92vw",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function DialogButtons({ onCancel, onConfirm, confirmLabel, danger, accentHex, confirmAutoFocus = true }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
      <button onClick={onCancel}
        style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--text-2)" }}>
        Cancel
      </button>
      <button onClick={onConfirm} autoFocus={confirmAutoFocus}
        style={{
          padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
          fontSize: 13, fontWeight: 700, color: "#fff",
          background: danger ? "var(--color-danger, #e5484d)" : (accentHex || "var(--accent)"),
        }}>
        {confirmLabel}
      </button>
    </div>
  );
}

/**
 * Generic confirmation.
 * Props: open, title, body (node), confirmLabel, danger, accentHex,
 *        onConfirm(), onCancel()
 */
export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", danger = false, accentHex, onConfirm, onCancel }) {
  return (
    <DialogShell open={open} onCancel={onCancel}>
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px" }}>{title}</h2>
      <div style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.6, margin: "0 0 18px" }}>{body}</div>
      <DialogButtons onCancel={onCancel} onConfirm={onConfirm} confirmLabel={confirmLabel} danger={danger} accentHex={accentHex} />
    </DialogShell>
  );
}

/**
 * Book removal dialog.
 * Confirms removing the book from AuthNo; a checkbox additionally deletes the
 * file(s) on disk. On confirm calls onConfirm({ deleteFile }).
 *
 * Props: open, book (session), accentHex, onConfirm({deleteFile}), onCancel()
 */
export function DeleteBookDialog({ open, book, accentHex, onConfirm, onCancel }) {
  const android = isAndroid();
  const [deleteFile, setDeleteFile] = useState(false);
  useEffect(() => { if (open) setDeleteFile(false); }, [open]);

  // What actually exists on disk decides the copy:
  //  - a saved file (SAF uri / desktop path) → removable from app, checkbox deletes it
  //  - Android unsaved draft → an app-folder autosave exists; checkbox deletes that
  //  - desktop unsaved draft → nothing on disk; removing IS permanent, say so
  const hasFile = !!book?.filePath || android;
  const title = book?.title || "Untitled Book";

  return (
    <DialogShell open={open} onCancel={onCancel}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 10px" }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(229,72,77,0.14)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-danger, #e5484d)", flexShrink: 0 }}>
          <DSIcons.Trash size={17} color="currentColor" />
        </span>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Remove “{title}”?
        </h2>
      </div>

      <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.6, margin: "0 0 14px" }}>
        {hasFile ? (
          <>The book will be removed from AuthNo.{book?.filePath && !android ? <> The <b>.authbook</b> file stays on your computer unless you tick the box below.</> : <> Its saved file stays on your device unless you tick the box below.</>}</>
        ) : (
          <>This draft has never been saved to a file — removing it from AuthNo <b>deletes it permanently</b>.</>
        )}
      </p>

      {hasFile && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginBottom: 18, cursor: "pointer", fontSize: 13, color: deleteFile ? "var(--color-danger, #e5484d)" : "var(--text-3)", lineHeight: 1.5 }}>
          <input
            type="checkbox" checked={deleteFile}
            onChange={(e) => setDeleteFile(e.target.checked)}
            style={{ width: 15, height: 15, marginTop: 2, accentColor: "var(--color-danger, #e5484d)", flexShrink: 0 }}
          />
          Also permanently delete the file from this device
        </label>
      )}

      <DialogButtons
        onCancel={onCancel}
        onConfirm={() => onConfirm?.({ deleteFile: hasFile && deleteFile })}
        confirmLabel={hasFile && deleteFile ? "Delete forever" : "Remove"}
        danger={!hasFile || deleteFile}
        accentHex={accentHex}
        confirmAutoFocus={false}
      />
    </DialogShell>
  );
}

export default ConfirmDialog;
