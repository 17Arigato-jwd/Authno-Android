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
import { Save, SaveAll, FolderOpen, Settings as SettingsIcon } from "lucide-react";
import { saveBook, saveAsBook, openBook } from "../utils/storage";
import { useError } from "../utils/ErrorContext";
import { isAndroid } from "../utils/platform";

// ── DesignSystem ──────────────────────────────────────────────────────────────
import { MinimalButton, Divider, COLORS } from "../DesignSystem";
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
}) {
  const { showError } = useError();
  const [status, setStatus] = useState("idle");
  const [busy,   setBusy]   = useState(false);
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
    : "#ffffff";

  const saveLabel =
    status === "saving" ? "Saving…"
    : status === "saved"  ? "Saved ✓"
    : status === "error"  ? "Failed ✗"
    : "Save";

  // ── Shared menu content ───────────────────────────────────────────────────
  const menuContent = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <MinimalButton
        variant="smooth"
        color={saveColor}
        size="md"
        icon={<Save size={15} />}
        disabled={busy || !current}
        onClick={handleSave}
        style={{ width: "100%", justifyContent: "center" }}
      >
        {saveLabel}
      </MinimalButton>

      <Divider style={{ margin: "2px 0" }} />

      <MinimalButton
        variant="smooth"
        color="#ffffff"
        size="md"
        icon={<SaveAll size={15} />}
        disabled={busy || !current}
        onClick={handleSaveAs}
        style={{ width: "100%", justifyContent: "center" }}
      >
        Save As…
      </MinimalButton>

      <Divider style={{ margin: "2px 0" }} />

      <MinimalButton
        variant="smooth"
        color="#ffffff"
        size="md"
        icon={<FolderOpen size={15} />}
        disabled={busy}
        onClick={handleOpen}
        style={{ width: "100%", justifyContent: "center" }}
      >
        Open…
      </MinimalButton>

      <Divider style={{ margin: "2px 0" }} />

      <MinimalButton
        variant="smooth"
        color="#ffffff"
        size="md"
        icon={<SettingsIcon size={15} />}
        onClick={onOpenSettings}
        style={{ width: "100%", justifyContent: "center" }}
      >
        Settings
      </MinimalButton>
    </div>
  );

  // ── Background — gradient from accent to near-black ───────────────────────
  const bg = `linear-gradient(to bottom right, ${accentHex}F2, rgba(0,0,0,0.95))`;

  return android
    ? createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.5)" }}
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
              border: "1px solid rgba(255,255,255,0.14)",
              borderBottom: "none",
              animation: "dsBurgerSlideUp 0.22s cubic-bezier(0.32,0.72,0,1)",
            }}
          >
            <style>{`@keyframes dsBurgerSlideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
            {/* Drag handle */}
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.3)", margin: "0 auto 20px" }} />
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
            border: "1px solid rgba(255,255,255,0.16)",
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
