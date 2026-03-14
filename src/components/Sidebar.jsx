import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Logo from "../logo.svg";
import { openBook } from "../utils/storage";
import { isAndroid } from "../utils/platform";

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
  setView,
  // mobile
  isDrawerOpen,
  onDrawerClose,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [editMode, setEditMode]       = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const sidebarRef    = useRef(null);
  const contextRef    = useRef(null);
  const dragState     = useRef({});
  const longPressRef  = useRef(null);
  const android = isAndroid();

  // Desktop resize width (ignored on Android)
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("sidebarWidth");
    return saved ? parseInt(saved, 10) : 288;
  });
  const resizing = useRef(false);

  // ── Close menus on outside click ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (contextRef.current?.contains(e.target)) return;
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setContextMenu(null);
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Context menu (right-click on desktop) ────────────────────────────────
  const openContextMenu = (e, sessionId) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  // ── Long-press context menu (Android) ────────────────────────────────────
  const onTouchStart = (e, sessionId) => {
    longPressRef.current = setTimeout(() => {
      const t = e.touches[0];
      setContextMenu({ x: t.clientX, y: t.clientY, sessionId });
    }, 500);
  };
  const onTouchEnd = () => { clearTimeout(longPressRef.current); };

  // ── Delete with confirmation modal ───────────────────────────────────────
  const handleDelete = () => {
    if (!contextMenu?.sessionId) return;
    if (localStorage.getItem("skipDeleteWarning") === "true") {
      onDelete?.(contextMenu.sessionId);
      setContextMenu(null);
      return;
    }
    const modal = document.createElement("div");
    modal.className = "fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999]";
    modal.innerHTML = `
      <div class="bg-[#0f0f10] border border-white/20 rounded-xl p-6 w-[360px] max-w-[90vw] text-white shadow-xl">
        <h2 class="text-lg font-semibold mb-2">Delete from Workspace?</h2>
        <p class="text-sm text-white/70 mb-4 leading-relaxed">
          This removes the session from your workspace.<br/>
          ${android ? "Your writing data will be deleted." : "The actual <b>.authbook</b> file will remain on your computer."}
        </p>
        <label class="flex items-center gap-2 mb-4 cursor-pointer select-none">
          <input type="checkbox" id="skipCheck" class="w-4 h-4 accent-[#00b4ff]" />
          <span class="text-sm text-white/70">Don't show this again</span>
        </label>
        <div class="flex justify-end gap-3">
          <button id="cancelBtn" class="px-3 py-1.5 rounded-md border border-white/30 hover:bg-white/10 transition text-sm">Cancel</button>
          <button id="confirmBtn" class="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector("#cancelBtn").onclick = () => modal.remove();
    modal.querySelector("#confirmBtn").onclick = () => {
      if (modal.querySelector("#skipCheck").checked)
        localStorage.setItem("skipDeleteWarning", "true");
      onDelete?.(contextMenu.sessionId);
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

  // ── Desktop resize handle ────────────────────────────────────────────────
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
      if (sessions.some((s) => s.filePath === result.filePath)) {
        alert("This book is already open!"); return;
      }
      const book = {
        id: Date.now().toString(),
        title: result.title || "Untitled Book",
        content: result.content || "",
        preview: (result.content || "").replace(/<[^>]*>?/gm, "").slice(0, 60) + "...",
        filePath: result.filePath,
        type: "book",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      setSessions((p) => [book, ...p]);
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
                📖 New Blank Book
              </button>
              <button onClick={() => { setDropdownOpen(false); handleOpenBook(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition">
                📂 Open Existing Book
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
            ✅ Done Editing
          </button>
        </div>
      )}

      {/* SESSIONS LIST */}
      <div className="p-3 flex-1 overflow-auto">
        <div className="rounded-lg p-2"
          style={{ background: "linear-gradient(135deg, #1f1f1f 0%, #050505 100%)", border: "1px solid rgba(255,255,255,0.04)" }}>
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
                <div className="font-medium">{s.title}</div>
                <div className="text-xs text-white/40">
                  {s.type === "book" ? "📖 Book" : "🎞️ Storyboard"} — {s.preview}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CONTEXT MENU */}
      {contextMenu && createPortal(
        <div ref={contextRef} style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
          className="p-2 rounded-lg shadow-xl border border-white/30 backdrop-blur-md">
          <div className="text-white rounded-lg overflow-hidden border border-white/20"
            style={{ background: `linear-gradient(to bottom right, ${accentHex}, black)`, minWidth: "120px" }}>
            <button onClick={handleDelete} className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition">
              🗑️ Delete
            </button>
            {!android && (
              <button onClick={() => { setEditMode(true); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition">
                ✏️ Edit Layout
              </button>
            )}
          </div>
        </div>,
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
