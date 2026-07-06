/**
 * Sidebar.jsx — Book/session list + extension panel
 *
 * Desktop  → resizable static left panel, drag-sort, right-click context menu.
 * Android  → fixed overlay drawer, slide-in from left, swipe-to-close.
 *
 * All shared UI (search input, buttons, tabs, dividers) now comes from DesignSystem.
 */

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Logo from "../logo.svg";
import { openBook } from "../utils/storage";
import { isAndroid } from "../utils/platform";
import ExtensionTab from "./ExtensionTab";
import { hapticDelete } from "../utils/haptics";

// ── DesignSystem ──────────────────────────────────────────────────────────────
import {
  TextInput,
  MinimalButton,
  GradientButton,
  Tabs,
  Divider,
  COLORS,
  TYPOGRAPHY,
  DSIcons,
  toast,
} from "../DesignSystem";
// ─────────────────────────────────────────────────────────────────────────────

export default function Sidebar({
  sessions,
  setSessions,
  onNewBook,
  search,
  setSearch,
  onSelect,
  currentId,
  onDelete,
  accentHex,
  setView,
  session,         // current book session (forwarded to ExtensionTab)
  // mobile
  isDrawerOpen,
  onDrawerClose,
}) {
  const [contextMenu,  setContextMenu]  = useState(null);
  const [editMode,     setEditMode]     = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeTab,    setActiveTab]    = useState("sessions");
  const sidebarRef       = useRef(null);
  const listRef          = useRef(null);   // the actual scrolling sessions list
  const contextRef       = useRef(null);
  const dragState        = useRef({});
  const longPressTimer   = useRef(null);
  const longPressCleanup = useRef(null);
  const android = isAndroid();

  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("sidebarWidth");
    return saved ? parseInt(saved, 10) : 288;
  });
  const resizing = useRef(false);

  // ── Close menus on outside click / touch ─────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (contextRef.current?.contains(e.target)) return;
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setContextMenu(null);
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  // ── Context menu (right-click on desktop) ────────────────────────────────
  const openContextMenu = (e, sessionId) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  // ── Long-press context menu (Android) ────────────────────────────────────
  const onTouchStart = (e, sessionId) => {
    const t = e.touches[0];
    const startX = t.clientX, startY = t.clientY;
    longPressTimer.current = setTimeout(() => {
      hapticDelete();
      const MENU_W = 160, MENU_H = 90;
      const vw = window.innerWidth, vh = window.innerHeight;
      const x = Math.min(t.clientX + 8, vw - MENU_W - 8);
      const y = Math.min(t.clientY - 8, vh - MENU_H - 8);
      setContextMenu({ x, y, sessionId });
    }, 480);
    const onMove = (me) => {
      const mt = me.touches[0];
      if (Math.abs(mt.clientX - startX) > 8 || Math.abs(mt.clientY - startY) > 8) {
        clearTimeout(longPressTimer.current);
        longPressCleanup.current?.();
      }
    };
    longPressCleanup.current = () => {
      document.removeEventListener("touchmove", onMove);
      longPressCleanup.current = null;
    };
    document.addEventListener("touchmove", onMove, { passive: true });
  };
  const onTouchEnd = () => {
    clearTimeout(longPressTimer.current);
    longPressCleanup.current?.();
  };

  // ── Delete with confirmation modal ───────────────────────────────────────
  // 4H: previously a raw document.createElement + innerHTML dialog injected
  // outside React — unthemed, unclosable via Escape/backdrop, and duplicated
  // styling. Now a normal React modal driven by state (rendered below).
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [skipCheck, setSkipCheck] = useState(false);

  const handleDelete = (directId) => {
    const sessionId = directId ?? contextMenu?.sessionId;
    if (!sessionId) return;
    if (localStorage.getItem("skipDeleteWarning") === "true") {
      onDelete?.(sessionId);
      setContextMenu(null);
      return;
    }
    setSkipCheck(false);
    setDeleteTarget(sessionId);
    setContextMenu(null);
  };

  const confirmDelete = () => {
    if (skipCheck) { try { localStorage.setItem("skipDeleteWarning", "true"); } catch { /* ignore */ } }
    onDelete?.(deleteTarget);
    setDeleteTarget(null);
  };

  // Escape closes the delete modal (previously impossible).
  useEffect(() => {
    if (!deleteTarget) return;
    const onKey = (e) => { if (e.key === 'Escape') setDeleteTarget(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTarget]);

  // ── Drag-drop (desktop only) ──────────────────────────────────────────────
  const onDragStart = (e, i) => { dragState.current.from = i; e.dataTransfer.effectAllowed = "move"; };
  const onDragOver  = (e, i) => {
    e.preventDefault();
    const from = dragState.current.from;
    if (from === i || from == null) return;
    // 2B: `sessions` here is the SEARCH-FILTERED list. Reordering it and calling
    // setSessions(reorderedFiltered) previously overwrote the full state with the
    // subset, permanently deleting every book that didn't match the search.
    // Instead, translate the visible move into an id-based move over the full list.
    const movedId  = sessions[from]?.id;
    const targetId = sessions[i]?.id;
    if (!movedId || !targetId) return;
    setSessions((prev) => {
      const full = [...prev];
      const fromFull = full.findIndex((s) => s.id === movedId);
      const toFull   = full.findIndex((s) => s.id === targetId);
      if (fromFull === -1 || toFull === -1) return prev;
      const [moved] = full.splice(fromFull, 1);
      full.splice(toFull, 0, moved);
      return full;
    });
    dragState.current.from = i;
  };

  useEffect(() => {
    if (!editMode || android) return;
    let iv = null;
    const drag = (e) => {
      // The scroll container is the sessions LIST, not the aside — scrolling
      // sidebarRef here did nothing, so drag-to-edge autoscroll was dead.
      const el = listRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + 80)       { if (!iv) iv = setInterval(() => { el.scrollTop -= 12; }, 16); }
      else if (e.clientY > r.bottom - 80){ if (!iv) iv = setInterval(() => { el.scrollTop += 12; }, 16); }
      else                               { clearInterval(iv); iv = null; }
    };
    const stop = () => { clearInterval(iv); iv = null; };
    document.addEventListener("dragover", drag);
    document.addEventListener("drop", stop);
    document.addEventListener("dragend", stop);
    return () => { stop(); document.removeEventListener("dragover", drag); document.removeEventListener("drop", stop); document.removeEventListener("dragend", stop); };
  }, [editMode, android]);

  // ── Swipe-left-to-close (Android drawer only) ────────────────────────────
  useEffect(() => {
    if (!android || !isDrawerOpen) return;
    const el = sidebarRef.current;
    if (!el) return;
    let startX = null, startY = null;
    const MIN_SWIPE_X = 60, MAX_DRIFT_Y = 50;
    const onStart = (e) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; };
    const onMove  = (e) => {
      if (startX === null) return;
      const dx = startX - e.touches[0].clientX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dy > MAX_DRIFT_Y) { startX = null; return; }
      if (dx > MIN_SWIPE_X) { onDrawerClose?.(); startX = null; }
    };
    const onEnd = () => { startX = null; };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove",  onMove,  { passive: true });
    el.addEventListener("touchend",   onEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
    };
  }, [android, isDrawerOpen, onDrawerClose]);

  // ── Desktop resize handle ────────────────────────────────────────────────
  useEffect(() => {
    if (android) return;
    const move = (e) => { if (!resizing.current) return; setWidth(Math.max(200, Math.min(480, e.clientX))); };
    const up   = () => { if (resizing.current) { resizing.current = false; localStorage.setItem("sidebarWidth", width); } };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup",   up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [width, android]);

  // ── File open ─────────────────────────────────────────────────────────────
  const handleOpenBook = async () => {
    try {
      const result = await openBook();
      if (!result) return;
      const book = { ...result, id: result.id || Date.now().toString(), preview: (result.content || "").replace(/<[^>]*>?/gm, "").slice(0, 60) + "..." };
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === book.id || (book.filePath && s.filePath === book.filePath));
        if (idx === -1) return [book, ...prev];
        const next = [...prev]; next[idx] = { ...next[idx], ...book }; return next;
      });
      onSelect?.(book.id);
      if (android) onDrawerClose?.();
    } catch (err) {
      console.error("Error opening book:", err);
      toast("Could not open that file", { variant: "danger", duration: 4000 });
    }
  };

  // ── Tab items for DesignSystem <Tabs> ────────────────────────────────────
  const TAB_ITEMS = [
    {
      key: "sessions",
      label: "Sessions",
      icon: <DSIcons.BookOpen size={14} />,
    },
    {
      key: "extensions",
      label: "Extensions",
      icon: <DSIcons.Extension size={14} />,
    },
  ];

  // ── Sidebar positioning ───────────────────────────────────────────────────
  const asideStyle = android
    ? {
        position: "fixed", top: 0, left: 0,
        height: "100dvh", width: "85vw", maxWidth: "340px",
        zIndex: 50,
        transform: isDrawerOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)",
        paddingTop:    "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft:   "env(safe-area-inset-left, 0px)",
        willChange: "transform",
      }
    : { width: `${width}px` };

  return (
    <aside
      ref={sidebarRef}
      style={{
        ...asideStyle,
        background: "var(--sidebar-bg)",
        color: "var(--text-1)",
        display: "flex",
        flexDirection: "column",
        position: android ? asideStyle.position : "relative",
        minWidth: android ? undefined : "12rem",
        maxWidth: android ? asideStyle.maxWidth : "30rem",
        userSelect: "none",
      }}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div style={{
        padding: "16px",
        borderBottom: "1px solid var(--border-sm)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <img src={Logo} alt="AuthNo" style={{ height: 56, width: 56, objectFit: "contain", filter: "drop-shadow(0 0 6px rgba(255,255,255,0.15))" }} />
        {android && (
          <button
            onClick={onDrawerClose}
            style={{
              width: 34, height: 34, borderRadius: "50%",
              border: "1px solid var(--border)",
              background: "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "var(--text-3)",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <DSIcons.X size={18} />
          </button>
        )}
      </div>

      {/* ── SEARCH — uses DesignSystem TextInput ────────────────────────── */}
      <div style={{ padding: "12px", borderBottom: "1px solid var(--border-sm)" }}>
        <TextInput
          value={search}
          onChange={setSearch}
          placeholder="Search sessions…"
          accentHex={accentHex}
        />
      </div>

      {/* ── NEW BOOK / STORYBOARD — DesignSystem MinimalButton ──────────── */}
      <div style={{
        padding: "12px", display: "flex", gap: 8,
        borderBottom: "1px solid var(--border-sm)",
        position: "relative",
      }}>
        {/* New Book dropdown */}
        <div style={{ flex: 1, position: "relative" }}>
          <MinimalButton
            variant="smooth"
            color={accentHex}
            size="sm"
            onClick={() => setDropdownOpen((v) => !v)}
            style={{ width: "100%", justifyContent: "center" }}
          >
            + New Book ▾
          </MinimalButton>
          {dropdownOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
              background: "var(--modal-bg)", border: "1px solid var(--border)",
              borderRadius: 10, overflow: "hidden", zIndex: 20,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}>
              {[
                { label: "New Blank Book",    action: () => { setDropdownOpen(false); onNewBook(); } },
                { label: "Open Existing Book", action: () => { setDropdownOpen(false); handleOpenBook(); } },
              ].map(({ label, action }) => (
                <button key={label} onClick={action} style={{
                  width: "100%", textAlign: "left", padding: "10px 14px",
                  background: "transparent", border: "none",
                  color: "var(--text-1)", fontSize: TYPOGRAPHY.size.sm, cursor: "pointer",
                  transition: "background 0.12s",
                }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* "+ Storyboard" removed: the storyboard editor is deferred, and the
            button created sessions that had no screen to open into (N14). */}
      </div>

      {/* ── Done Editing button (desktop drag-sort mode) ─────────────────── */}
      {editMode && !android && (
        <div style={{ padding: "12px", borderBottom: "1px solid var(--border-sm)" }}>
          <GradientButton
            variant="secondary"
            size="sm"
            onClick={() => setEditMode(false)}
            style={{ width: "100%", justifyContent: "center" }}
          >
            Done Editing
          </GradientButton>
        </div>
      )}

      {/* ── SESSIONS LIST ────────────────────────────────────────────────── */}
      {activeTab === "sessions" && (
        <div ref={listRef} style={{ padding: 12, flex: 1, overflowY: "auto" }}>
          <div style={{
            borderRadius: 10, padding: 8,
            background: "var(--surface)",
            border: "1px solid var(--border-sm)",
          }}>
            <div style={{
              fontSize: 10, color: "var(--text-4)", padding: "0 8px 8px",
              fontFamily: TYPOGRAPHY.mono, letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              Sessions
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sessions.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-4)", padding: "0 8px", fontStyle: "italic" }}>
                  No sessions yet — create one.
                </div>
              ) : sessions.map((s, i) => {
                const isActive = s.id === currentId && !editMode;
                return (
                  <div
                    key={s.id}
                    draggable={editMode && !android}
                    onDragStart={(e) => onDragStart(e, i)}
                    onDragOver={(e)  => onDragOver(e, i)}
                    onClick={() => !editMode && onSelect(s.id)}
                    onContextMenu={(e) => !editMode && !android && openContextMenu(e, s.id)}
                    onTouchStart={(e)  => !editMode && android && onTouchStart(e, s.id)}
                    onTouchEnd={onTouchEnd}
                    onTouchMove={onTouchEnd}
                    style={{
                      textAlign: "left", padding: "10px 12px", borderRadius: 8,
                      border: `2px solid ${isActive ? accentHex : editMode && !android ? `${accentHex}55` : "var(--border)"}`,
                      background: isActive ? "var(--surface)" : "transparent",
                      cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
                      animation: editMode && !android ? "dsWobble 0.3s ease infinite" : "none",
                    }}
                    onMouseEnter={e => !isActive && (e.currentTarget.style.borderColor = `${accentHex}55`)}
                    onMouseLeave={e => !isActive && (e.currentTarget.style.borderColor = editMode && !android ? `${accentHex}55` : "var(--border)")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      {/* Book cover thumbnail */}
                      <div style={{
                        width: 36, height: 50, flexShrink: 0, borderRadius: 6,
                        overflow: "hidden", background: "var(--surface-md)",
                        border: "1px solid var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {s.coverBase64 ? (
                          <img
                            src={`data:${s.coverMime || "image/jpeg"};base64,${s.coverBase64}`}
                            alt=""
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        ) : (
                          <img src={Logo} alt="" style={{ width: 22, height: 22, opacity: 0.5, objectFit: "contain" }} />
                        )}
                      </div>
                      {/* Title + preview */}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontWeight: 500, fontSize: 13, color: "var(--text-1)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {s.title}
                        </div>
                        <div style={{
                          fontSize: 11, color: "var(--text-4)", marginTop: 2,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {s.type === "book" ? "Book" : "Storyboard"} — {s.preview}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── EXTENSIONS PANEL ─────────────────────────────────────────────── */}
      {activeTab === "extensions" && android && (
        <ExtensionTab
          accentHex={accentHex}
          session={session}
          onClose={android ? onDrawerClose : undefined}
        />
      )}

      {/* ── BOTTOM TAB BAR — DesignSystem <Tabs> ───────────────────────────
          Android-only: extensions are not available on desktop yet (A4), and
          the tab now shows even with zero extensions so the empty state and
          "Install from file" button are reachable. */}
      {android && (
        <div style={{ borderTop: "1px solid var(--border-sm)", flexShrink: 0, background: "var(--sidebar-bg)" }}>
          <Tabs
            items={TAB_ITEMS}
            active={activeTab}
            onChange={setActiveTab}
            variant="underline"
            accentHex={accentHex}
            size="sm"
            fullWidth
          />
        </div>
      )}

      {/* ── CONTEXT MENU ────────────────────────────────────────────────── */}
      {contextMenu && createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9998 }}
            onClick={() => setContextMenu(null)}
            onTouchStart={() => setContextMenu(null)}
          />
          <div
            ref={contextRef}
            style={{
              position: "fixed", top: contextMenu.y, left: contextMenu.x,
              zIndex: 9999, padding: 4, borderRadius: 12,
              border: "1px solid var(--border)",
              backdropFilter: "blur(14px)",
              background: `linear-gradient(to bottom right, var(--accent-a08), transparent), var(--modal-bg)`,
              minWidth: 148, overflow: "hidden",
              boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
            }}
          >
            {[
              { label: "Delete", action: (e) => { e.stopPropagation(); handleDelete(); } },
              ...(!android ? [{ label: "Edit Layout", action: () => { setEditMode(true); setContextMenu(null); } }] : []),
            ].map(({ label, action }) => (
              <button
                key={label}
                onClick={action}
                onTouchStart={(e) => { e.preventDefault(); action(e); }}
                style={{
                  width: "100%", textAlign: "left", padding: "10px 14px",
                  background: "transparent", border: "none",
                  color: "var(--text-1)", fontSize: 13, cursor: "pointer", borderRadius: 8,
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                {label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}

      {/* ── RESIZE HANDLE (desktop only) ─────────────────────────────────── */}
      {!android && (
        <div
          onMouseDown={() => (resizing.current = true)}
          onMouseEnter={e => (e.currentTarget.style.background = `${accentHex}66`)}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          style={{
            position: "absolute", top: 0, right: 0,
            height: "100%", width: 6,
            cursor: "col-resize", background: "transparent",
            transition: "background 0.15s", zIndex: 100,
          }}
        />
      )}

      {/* Wobble keyframes for drag-sort edit mode */}
      <style>{`
        @keyframes dsWobble {
          0%,100% { transform: rotate(-0.8deg); }
          50%      { transform: rotate(0.8deg); }
        }
      `}</style>

      {/* ── DELETE CONFIRMATION (React, themed — replaces the old raw-DOM dialog, 4H) ── */}
      {deleteTarget && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, background: 'var(--scrim-strong)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--modal-bg)', color: 'var(--text-1)',
              border: '1px solid var(--border)', borderRadius: 16,
              padding: 24, width: 360, maxWidth: '90vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }}
          >
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 10px' }}>Delete from Workspace?</h2>
            <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, margin: '0 0 18px' }}>
              This removes the session from your workspace.<br />
              {android ? 'Your writing data will be deleted.' : <>The actual <b>.authbook</b> file will remain on your computer.</>}
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, cursor: 'pointer', fontSize: 13, color: 'var(--text-3)' }}>
              <input type="checkbox" checked={skipCheck} onChange={(e) => setSkipCheck(e.target.checked)} style={{ width: 15, height: 15, accentColor: accentHex }} />
              Don't show this again
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setDeleteTarget(null)}
                style={{ padding: '7px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--text-2)' }}>
                Cancel
              </button>
              <button onClick={confirmDelete}
                style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: 'var(--color-danger)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
}
