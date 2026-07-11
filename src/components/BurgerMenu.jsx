/**
 * BurgerMenu.jsx — File actions + Settings dropdown / bottom sheet
 *
 * Desktop: fixed dropdown anchored to the burger button.
 * Android: full-width bottom sheet with swipe-to-dismiss.
 *
 * All button and divider styling now comes from DesignSystem.
 */

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

import { saveBook, saveAsBook, openBook } from "../utils/storage";
import { useError } from "../utils/ErrorContext";
import { isAndroid } from "../utils/platform";
import { hapticSave } from "../utils/haptics";

// ── DesignSystem ──────────────────────────────────────────────────────────────
import { MinimalButton, Divider, COLORS, DSIcons } from "../DesignSystem";
// ─────────────────────────────────────────────────────────────────────────────

export default function BurgerMenu({
  open,
  onClose,
  current,
  setSessions,
  onOpenSettings,
  onOpen,
  accentHex,
  anchorRef,
  // ── Context-aware content (B6): 'home' hides book actions & shows Open;
  //    'book' shows Docs-style book options and hides Open.
  context = "book",
  onRename,
  onChapterInfo,          // present only when a chapter is open
  onExport,               // { txt, html, epub, pdf }
  onReadAloud,
}) {
  const { showError } = useError();
  const [status, setStatus] = useState("idle");
  const [busy,   setBusy]   = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => { if (!open) { setRenaming(false); setExportOpen(false); } }, [open]);
  const menuRef     = useRef(null);
  const swipeStartY = useRef(null);
  const android     = isAndroid();

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

  // ── Swipe-down-to-dismiss (Android bottom sheet only) ─────────────────────
  useEffect(() => {
    if (!android || !open) return;
    const el = menuRef.current;
    if (!el) return;
    const onStart = (e) => { swipeStartY.current = e.touches[0].clientY; };
    const onMove  = (e) => {
      if (swipeStartY.current === null) return;
      if (e.touches[0].clientY - swipeStartY.current > 72) {
        swipeStartY.current = null;
        onClose?.();
      }
    };
    const onEnd = () => { swipeStartY.current = null; };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove",  onMove,  { passive: true });
    el.addEventListener("touchend",   onEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
    };
  }, [android, open, onClose]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!current || busy) return;
    setBusy(true);
    setStatus("saving");
    try {
      const result = await saveBook(current);
      if (result?.cancelled) { setStatus("idle"); return; }
      if (result?.filePath && result.filePath !== current.filePath) {
        setSessions((prev) =>
          prev.map((s) => (s.id === current.id ? { ...s, filePath: result.filePath } : s))
        );
      }
      setStatus("saved");
      hapticSave();
    } catch (err) {
      showError("saveBook", err, { sessionTitle: current?.title });
      setStatus("error");
    } finally {
      setBusy(false);
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  // ── Save As ───────────────────────────────────────────────────────────────
  const handleSaveAs = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const result = await saveAsBook(current);
      if (result?.filePath && result.filePath !== current.filePath) {
        setSessions((prev) =>
          prev.map((s) => (s.id === current.id ? { ...s, filePath: result.filePath } : s))
        );
      }
    } catch (err) {
      showError("saveAsBook", err, { sessionTitle: current?.title });
    } finally {
      setBusy(false);
    }
  };

  // ── Open ──────────────────────────────────────────────────────────────────
  const handleOpen = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const session = await openBook();
      if (session) {
        setSessions((prev) => {
          const idx = prev.findIndex(
            (s) => s.id === session.id || (session.filePath && s.filePath === session.filePath)
          );
          if (idx === -1) return [session, ...prev];
          const next = [...prev];
          next[idx] = { ...next[idx], ...session };
          return next;
        });
        onOpen?.(session.id);
      }
    } catch (err) {
      showError("openBook", err);
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

  // ── Derive Save button state ───────────────────────────────────────────────
  const saveColor =
    status === "saving" ? COLORS.warning
    : status === "saved"  ? COLORS.success
    : status === "error"  ? COLORS.danger
    : 'var(--text-1)';

  const saveLabel =
    status === "saving" ? "Saving…"
    : status === "saved"  ? "Saved ✓"
    : status === "error"  ? "Failed ✗"
    : "Save";

  // ── Shared menu content — context-aware (B6) ──────────────────────────────
  const item = (props) => (
    <MinimalButton
      variant="smooth" size="md" color="var(--text-1)"
      style={{ width: "100%", justifyContent: "center" }}
      {...props}
    />
  );

  const bookItems = renaming ? (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        autoFocus value={renameVal}
        onChange={(e) => setRenameVal(e.target.value)}
        placeholder="Book title…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && renameVal.trim()) { onRename?.(renameVal.trim()); setRenaming(false); onClose?.(); }
          if (e.key === "Escape") setRenaming(false);
        }}
        style={{ flex: 1, minWidth: 0, padding: "9px 11px", borderRadius: 8, background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text-1)", fontSize: 13.5, outline: "none" }}
      />
      <button
        onClick={() => { if (renameVal.trim()) { onRename?.(renameVal.trim()); setRenaming(false); onClose?.(); } }}
        style={{ padding: "0 14px", borderRadius: 8, border: "none", background: accentHex, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
      >
        Rename
      </button>
    </div>
  ) : (
    <>
      {item({ color: saveColor, icon: <DSIcons.Save size={15} />, disabled: busy || !current, onClick: handleSave, children: saveLabel })}
      <Divider style={{ margin: "2px 0" }} />
      {item({ icon: <DSIcons.Archive size={15} />, disabled: busy || !current, onClick: handleSaveAs, children: "Save As…" })}
      <Divider style={{ margin: "2px 0" }} />
      {item({ icon: <DSIcons.Edit size={15} />, disabled: !current, onClick: () => { setRenameVal(current?.title ?? ""); setRenaming(true); }, children: "Rename…" })}
      {onChapterInfo && (
        <>
          <Divider style={{ margin: "2px 0" }} />
          {item({ icon: <DSIcons.Info size={15} />, onClick: () => { onClose?.(); onChapterInfo(); }, children: "Chapter info" })}
        </>
      )}
      <Divider style={{ margin: "2px 0" }} />
      {item({ icon: <DSIcons.Upload size={15} />, disabled: !current, onClick: () => setExportOpen(v => !v), children: (
        <>Export {exportOpen ? <DSIcons.ChevronUp size={12} style={{ marginLeft: 4 }} /> : <DSIcons.ChevronDown size={12} style={{ marginLeft: 4 }} />}</>
      ) })}
      {exportOpen && onExport && (
        <div style={{ display: "flex", gap: 6, padding: "2px 4px" }}>
          {[["TXT", onExport.txt], ["HTML", onExport.html], ["EPUB", onExport.epub], ["PDF", onExport.pdf]].map(([label, fn]) => (
            <button key={label} onClick={() => { onClose?.(); fn?.(); }}
              style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-2)", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {onReadAloud && (
        <>
          <Divider style={{ margin: "2px 0" }} />
          {item({ icon: <DSIcons.Volume size={15} />, disabled: !current, onClick: () => { onClose?.(); onReadAloud(); }, children: "Read aloud" })}
        </>
      )}
      <Divider style={{ margin: "2px 0" }} />
      {item({ icon: <DSIcons.Settings size={15} />, onClick: onOpenSettings, children: "Settings" })}
    </>
  );

  const homeItems = (
    <>
      {item({ icon: <DSIcons.FolderOpen size={15} />, disabled: busy, onClick: handleOpen, children: "Open…" })}
      <Divider style={{ margin: "2px 0" }} />
      {item({ icon: <DSIcons.Settings size={15} />, onClick: onOpenSettings, children: "Settings" })}
    </>
  );

  const menuContent = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {context === "home" ? homeItems : bookItems}
    </div>
  );

  // ── Background — themed panel with a faint accent wash ────────────────────
  // Previously hard-coded accent→near-black, which ignored the theme entirely
  // and put var(--text-1) (dark on light themes) on a forced-dark panel =
  // unreadable. Now it follows the active theme's modal surface.
  const bg = `linear-gradient(to bottom right, var(--accent-a08), transparent), var(--modal-bg)`;

  return android
    ? createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9998, background: "var(--scrim, rgba(0,0,0,0.5))" }}
            onClick={onClose}
            onTouchStart={onClose}
          />
          <div
            ref={menuRef}
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
              borderRadius: "20px 20px 0 0", padding: "20px 20px",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
              background: bg,
              border: "1px solid var(--border)",
              borderBottom: "none",
              animation: "dsBurgerSlideUp 0.22s cubic-bezier(0.32,0.72,0,1)",
            }}
          >
            <style>{`@keyframes dsBurgerSlideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
            {/* Drag handle */}
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border)", margin: "0 auto 20px" }} />
            {menuContent}
          </div>
        </>,
        document.body
      )
    : createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed", top: pos.top, right: pos.right,
            zIndex: 9999, width: 200,
            borderRadius: 14, padding: 12,
            background: bg,
            border: "1px solid var(--border)",
            backdropFilter: "blur(14px)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
            animation: "dsBurgerFadeIn 0.15s ease",
          }}
        >
          <style>{`@keyframes dsBurgerFadeIn{from{opacity:0;transform:scale(0.96) translateY(-4px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
          {menuContent}
        </div>,
        document.body
      );
}
