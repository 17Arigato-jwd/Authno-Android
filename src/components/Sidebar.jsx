import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Logo from "../logo.svg";
import { openBook } from "../utils/storage";
import { isAndroid } from "../utils/platform";
import ExtensionTab from "./ExtensionTab";
import { useExtensions } from "../utils/ExtensionContext";
import { hapticDelete } from "../utils/haptics";

/**
 * Sidebar
 *
 * Desktop  → identical to PC version: resizable static left panel, drag-sort,
 *            right-click context menu, resize handle.
 *
 * Android  → fixed overlay drawer that slides in from the left.
 *            - Backdrop tap closes it.
 *            - Long-press (500 ms) on a session card opens the context menu
 *              instead of right-click.
 *            - No resize handle (fixed 85vw width).
 *            - "Open Existing Book" uses the Capacitor file picker.
 *
 * Extra props for mobile:
 *   isDrawerOpen   boolean   whether the drawer is visible
 *   onDrawerClose  fn        close the drawer
 */
export default function Sidebar({
  sessions,
  setSessions,
  onNewBook,
  onNewStoryboard,
  search,
  setSearch,
  onSelect,
  currentId,
  onDelete,
  accentHex,
  lightMode,
  setView,
  session,        // ← current book session (forwarded to ExtensionTab)
  // mobile
  isDrawerOpen,
  onDrawerClose,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [editMode, setEditMode]       = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeTab, setActiveTab]     = useState('sessions'); // 'sessions' | 'extensions'
  const { hasExtensions } = useExtensions();
  const sidebarRef       = useRef(null);
  const contextRef       = useRef(null);
  const dragState        = useRef({});
  const longPressTimer   = useRef(null);   // setTimeout id (number)
  const longPressCleanup = useRef(null);   // touchmove cancel fn — stored separately because timer ids are primitives
  const android = isAndroid();

  // Desktop resize width (ignored on Android)
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("sidebarWidth");
    return saved ? parseInt(saved, 10) : 288;
  });
  const resizing = useRef(false);

  // ── Close menus on outside click / touch ────────────────────────────────
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
  // Cancels if the finger moves > 8px (scroll intent) so it never fights
  // with natural scrolling. Vibrates on trigger for tactile confirmation.
  const onTouchStart = (e, sessionId) => {
    const t = e.touches[0];
    const startX = t.clientX, startY = t.clientY;

    longPressTimer.current = setTimeout(() => {
      // Haptic feedback — Strong Thud (ImpactStyle.Heavy)
      hapticDelete();

      // Position the menu near the finger but always fully on-screen
      const MENU_W = 160, MENU_H = 90;
      const vw = window.innerWidth, vh = window.innerHeight;
      const x = Math.min(t.clientX + 8, vw - MENU_W - 8);
      const y = Math.min(t.clientY - 8, vh - MENU_H - 8);
      setContextMenu({ x, y, sessionId });
    }, 480);

    // Cancel if finger drifts — stored in its own ref so it's always reachable
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
  const handleDelete = (directId) => {
    const sessionId = directId ?? contextMenu?.sessionId;
    if (!sessionId) return;
    if (localStorage.getItem("skipDeleteWarning") === "true") {
      onDelete?.(sessionId);
      setContextMenu(null);
      return;
    }
    const modal = document.createElement("div");
    modal.className = "fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999]";
    const isDark = !lightMode;
    modal.innerHTML = `
      <div style="background:${isDark ? '#0f0f10' : '#ffffff'};color:${isDark ? '#fff' : '#1a1a1e'}" class="border rounded-xl p-6 w-[360px] max-w-[90vw] shadow-xl" style="border-color:rgba(${isDark?'255,255,255':'0,0,0'},0.2)">
        <h2 class="text-lg font-semibold mb-2">Delete from Workspace?</h2>
        <p class="text-sm mb-4 leading-relaxed" style="opacity:0.7">
          This removes the session from your workspace.<br/>
          ${android ? "Your writing data will be deleted." : "The actual <b>.authbook</b> file will remain on your computer."}
        </p>
        <label class="flex items-center gap-2 mb-4 cursor-pointer select-none">
          <input type="checkbox" id="skipCheck" class="w-4 h-4" style="accent-color:${accentHex}" />
          <span class="text-sm" style="opacity:0.7">Don't show this again</span>
        </label>
        <div class="flex justify-end gap-3">
          <button id="cancelBtn" class="px-3 py-1.5 rounded-md text-sm transition" style="border:1px solid rgba(${isDark?'255,255,255':'0,0,0'},0.3);background:transparent">Cancel</button>
          <button id="confirmBtn" class="px-3 py-1.5 rounded-md font-semibold text-sm transition" style="background:#dc2626;color:#fff">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector("#cancelBtn").onclick = () => modal.remove();
    modal.querySelector("#confirmBtn").onclick = () => {
      if (modal.querySelector("#skipCheck").checked)
        localStorage.setItem("skipDeleteWarning", "true");
      onDelete?.(sessionId);
      setContextMenu(null);
      modal.remove();
    };
  };

  // ── Drag-drop (desktop only) ──────────────────────────────────────────────
  const onDragStart = (e, i) => {
    dragState.current.from = i;
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e, i) => {
    e.preventDefault();
    const from = dragState.current.from;
    if (from === i) return;
    const updated = [...sessions];
    const [moved] = updated.splice(from, 1);
    updated.splice(i, 0, moved);
    setSessions(updated);
    dragState.current.from = i;
  };

  useEffect(() => {
    if (!editMode || android) return;
    let iv = null;
    const drag = (e) => {
      const el = sidebarRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + 80) {
        if (!iv) iv = setInterval(() => { el.scrollTop -= 12; }, 16);
      } else if (e.clientY > r.bottom - 80) {
        if (!iv) iv = setInterval(() => { el.scrollTop += 12; }, 16);
      } else { clearInterval(iv); iv = null; }
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
    const MIN_SWIPE_X  = 60;   // px leftward to dismiss
    const MAX_DRIFT_Y  = 50;   // px vertical drift allowed

    const onStart = (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onMove = (e) => {
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
  useEffect(() => {
    if (android) return;
    const move = (e) => {
      if (!resizing.current) return;
      setWidth(Math.max(200, Math.min(480, e.clientX)));
    };
    const up = () => {
      if (resizing.current) { resizing.current = false; localStorage.setItem("sidebarWidth", width); }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [width, android]);

  // ── File open ────────────────────────────────────────────────────────────
  const handleOpenBook = async () => {
    try {
      const result = await openBook();
      if (!result) return;
      const book = {
        ...result,
        id: result.id || Date.now().toString(),
        preview: (result.content || "").replace(/<[^>]*>?/gm, "").slice(0, 60) + "...",
      };

      setSessions((prev) => {
        const idx = prev.findIndex(
          (s) => s.id === book.id || (book.filePath && s.filePath === book.filePath)
        );

        if (idx === -1) return [book, ...prev];

        const next = [...prev];
        next[idx] = { ...next[idx], ...book };
        return next;
      });
      onSelect?.(book.id);                           // actually select the opened book
      if (android) onDrawerClose?.();
    } catch (err) {
      console.error("Error opening book:", err);
      alert("Could not open that file.");
    }
  };

  // ── Sidebar positioning ──────────────────────────────────────────────────
  const asideStyle = android
    ? {
        position: "fixed",
        top: 0, left: 0,
        height: "100dvh",
        width: "85vw",
        maxWidth: "340px",
        zIndex: 50,
        transform: isDrawerOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        willChange: "transform",
      }
    : { width: `${width}px` };

  const inner = (
    <aside
      ref={sidebarRef}
      style={asideStyle}
      className={`bg-[#0b0b0c] text-white flex flex-col relative select-none ${
        android ? "" : "min-w-[12rem] max-w-[30rem]"
      }`}
    >
      {/* HEADER */}
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between">
        <img src={Logo} alt="AuthNo" className="h-14 w-14 object-contain drop-shadow-[0_0_6px_rgba(255,255,255,0.15)]" />
        {android && (
          <button onClick={onDrawerClose} className="p-2 rounded-full border border-white/20 hover:bg-white/10 transition">
            <X className="w-5 h-5 text-white/60" />
          </button>
        )}
      </div>

      {/* SEARCH */}
      <div className="p-3 border-b border-white/10">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent border border-white/20 rounded px-3 py-2 text-sm placeholder-white/40 focus:outline-none"
          placeholder="Search sessions…"
        />
      </div>

      {/* BUTTONS */}
      <div className="p-3 flex gap-2 border-b border-white/10 relative">
        {/* New Book dropdown */}
        <div className="relative flex-1">
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            style={{ borderColor: accentHex, color: accentHex }}
            className="w-full border-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-white/5 transition"
          >
            + New Book ▾
          </button>
          {dropdownOpen && (
            <div className="absolute mt-2 w-full bg-[#0f0f10] border border-white/10 rounded-lg shadow-lg overflow-hidden z-20">
              <button onClick={() => { setDropdownOpen(false); onNewBook(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition">
                New Blank Book
              </button>
              <button onClick={() => { setDropdownOpen(false); handleOpenBook(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition">
                Open Existing Book
              </button>
            </div>
          )}
        </div>

        {/* New Storyboard */}
        <button
          onClick={onNewStoryboard}
          style={{ borderColor: accentHex, color: accentHex }}
          className="flex-1 border-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-white/5 transition"
        >
          + Storyboard
        </button>
      </div>

      {/* Done editing button (desktop drag-sort) */}
      {editMode && !android && (
        <div className="p-3 border-b border-white/10">
          <button onClick={() => setEditMode(false)} style={{ borderColor: accentHex, color: accentHex }}
            className="w-full border-2 rounded-lg px-3 py-2 text-sm font-semibold bg-white/5 hover:bg-white/10 transition">
            Done Editing
          </button>
        </div>
      )}

      {/* SESSIONS LIST (shown when activeTab === 'sessions') */}
      {activeTab === 'sessions' && (
        <div className="p-3 flex-1 overflow-auto">
          <div className="rounded-lg p-2"
            style={{
              background: lightMode
                ? 'linear-gradient(135deg, #f0f0f2 0%, #e8e8ec 100%)'
                : 'linear-gradient(135deg, #1f1f1f 0%, #050505 100%)',
              border: lightMode
                ? '1px solid rgba(0,0,0,0.07)'
                : '1px solid rgba(255,255,255,0.04)',
            }}>
            <h3 className="text-xs text-white/70 px-2 mb-2">Sessions</h3>
            <div className="flex flex-col gap-2">
              {sessions.length === 0 ? (
                <div className="text-sm text-white/40 px-2 italic">No sessions yet — create one.</div>
              ) : sessions.map((s, i) => (
                <div
                  key={s.id}
                  draggable={editMode && !android}
                  onDragStart={(e) => onDragStart(e, i)}
                  onDragOver={(e) => onDragOver(e, i)}
                  onClick={() => !editMode && onSelect(s.id)}
                  onContextMenu={(e) => !editMode && !android && openContextMenu(e, s.id)}
                  onTouchStart={(e) => !editMode && android && onTouchStart(e, s.id)}
                  onTouchEnd={onTouchEnd}
                  onTouchMove={onTouchEnd}
                  className={`text-left px-3 py-2 rounded-md border-2 transition cursor-pointer select-none ${
                    s.id === currentId && !editMode ? "bg-white/5"
                    : editMode && !android ? "border-white/10 animate-wobble cursor-grab"
                    : "border-white/10 hover:border-white/30"
                  }`}
                  style={
                    s.id === currentId && !editMode ? { borderColor: accentHex }
                    : editMode && !android ? { borderColor: `${accentHex}55` }
                    : {}
                  }
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div style={{
                      width: '36px', height: '50px', flexShrink: 0, borderRadius: '6px',
                      overflow: 'hidden', background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {s.coverBase64 ? (
                        <img
                          src={`data:${s.coverMime || 'image/jpeg'};base64,${s.coverBase64}`}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <img src={Logo} alt="" style={{ width: '22px', height: '22px', opacity: 0.5, objectFit: 'contain' }} />
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="font-medium" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                      <div className="text-xs text-white/40" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.type === "book" ? "Book" : "Storyboard"} — {s.preview}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* EXTENSIONS PANEL (shown when activeTab === 'extensions') */}
      {activeTab === 'extensions' && hasExtensions && (
        <ExtensionTab
          accentHex={accentHex}
          session={session}
          onClose={android ? onDrawerClose : undefined}
        />
      )}

      {/* BOTTOM TAB BAR — only shown when extensions are installed */}
      {hasExtensions && (
        <div style={{
          display: 'flex',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          background: '#0b0b0c',
        }}>
          {/* Sessions tab */}
          <button
            onClick={() => setActiveTab('sessions')}
            style={{
              flex: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '3px', padding: '10px 6px 8px',
              background: 'transparent', border: 'none',
              cursor: 'pointer',
              borderTop: activeTab === 'sessions'
                ? `2px solid ${accentHex}`
                : '2px solid transparent',
              transition: 'border-color 0.15s',
            }}
          >
            {/* Book icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              style={{ opacity: activeTab === 'sessions' ? 1 : 0.4 }}>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke={activeTab === 'sessions' ? accentHex : 'currentColor'}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
                stroke={activeTab === 'sessions' ? accentHex : 'currentColor'}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{
              fontSize: '10px', fontWeight: 600,
              color: activeTab === 'sessions' ? accentHex : 'rgba(255,255,255,0.4)',
              transition: 'color 0.15s',
            }}>
              Sessions
            </span>
          </button>

          {/* Extensions tab */}
          <button
            onClick={() => setActiveTab('extensions')}
            style={{
              flex: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '3px', padding: '10px 6px 8px',
              background: 'transparent', border: 'none',
              cursor: 'pointer',
              borderTop: activeTab === 'extensions'
                ? `2px solid ${accentHex}`
                : '2px solid transparent',
              transition: 'border-color 0.15s',
            }}
          >
            {/* Puzzle icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              style={{ opacity: activeTab === 'extensions' ? 1 : 0.4 }}>
              <path d="M12 2a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v3h1a2 2 0 0 1 0 4h-1v3a1 1 0 0 1-1 1h-3v1a2 2 0 0 1-4 0v-1H7a1 1 0 0 1-1-1v-3H5a2 2 0 0 1 0-4h1V6a1 1 0 0 1 1-1h3V4a2 2 0 0 1 2-2z"
                stroke={activeTab === 'extensions' ? accentHex : 'currentColor'}
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <span style={{
              fontSize: '10px', fontWeight: 600,
              color: activeTab === 'extensions' ? accentHex : 'rgba(255,255,255,0.4)',
              transition: 'color 0.15s',
            }}>
              Extensions
            </span>
          </button>
        </div>
      )}

      {/* CONTEXT MENU */}
      {contextMenu && createPortal(
        <>
          {/* Invisible full-screen backdrop — closes on any tap outside */}
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setContextMenu(null)}
            onTouchStart={() => setContextMenu(null)}
          />
          <div
            ref={contextRef}
            style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
            className="p-2 rounded-lg shadow-xl border border-white/30 backdrop-blur-md"
          >
            <div className="text-white rounded-lg overflow-hidden border border-white/20"
              style={{ background: `linear-gradient(to bottom right, ${accentHex}, black)`, minWidth: "140px" }}>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(); }}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-white/10 transition"
              >
                Delete
              </button>
              {!android && (
                <button
                  onClick={() => { setEditMode(true); setContextMenu(null); }}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-white/10 transition"
                >
                  Edit Layout
                </button>
              )}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* RESIZE HANDLE (desktop only) */}
      {!android && (
        <div
          onMouseDown={() => (resizing.current = true)}
          onMouseEnter={(e) => (e.currentTarget.style.background = `${accentHex}66`)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent transition"
          style={{ zIndex: 100 }}
        />
      )}
    </aside>
  );

  return inner;
}
