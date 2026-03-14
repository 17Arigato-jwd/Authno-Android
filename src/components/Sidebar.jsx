import React, { useState, useRef, useEffect } from "react";
import Logo from "../logo.svg";
import { X } from "lucide-react";
import { isMobile } from "../utils/platform";
import { openBook } from "../utils/storageAdapter";

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
  // Mobile drawer props
  isDrawerOpen,
  onDrawerClose,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [bookDropdownOpen, setBookDropdownOpen] = useState(false);
  const sidebarRef = useRef(null);
  const contextMenuRef = useRef(null);
  const dragState = useRef({});
  const mobile = isMobile();

  // Desktop resize state (disabled on mobile)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("sidebarWidth");
    return saved ? parseInt(saved, 10) : 288;
  });
  const isResizing = useRef(false);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target)) return;
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setContextMenu(null);
        setBookDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // === Context Menu ===
  const handleContextMenu = (e, sessionId) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, sessionId });
  };

  // Long-press for context menu on mobile (300ms hold)
  const longPressTimer = useRef(null);
  const handleTouchStart = (e, sessionId) => {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      setContextMenu({ visible: true, x: touch.clientX, y: touch.clientY, sessionId });
    }, 300);
  };
  const handleTouchEnd = () => clearTimeout(longPressTimer.current);

  const handleDelete = () => {
    if (!contextMenu?.sessionId) return;
    const skipWarning = localStorage.getItem("skipDeleteWarning") === "true";
    if (skipWarning) {
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
          ${!mobile ? 'The actual <b>.authbook</b> file will remain on your computer.' : 'Your writing data will be permanently deleted.'}
        </p>
        <label class="flex items-center gap-2 mb-4 cursor-pointer select-none">
          <input type="checkbox" id="skipWarningCheck" class="w-4 h-4 accent-[#00b4ff]" />
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
      if (modal.querySelector("#skipWarningCheck").checked)
        localStorage.setItem("skipDeleteWarning", "true");
      onDelete?.(contextMenu.sessionId);
      setContextMenu(null);
      modal.remove();
    };
  };

  // === Drag-Drop (desktop only) ===
  const handleDragStart = (e, index) => {
    dragState.current.draggedIndex = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/html", e.target);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    const draggedIndex = dragState.current.draggedIndex;
    if (draggedIndex === index) return;
    const updated = [...sessions];
    const [moved] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, moved);
    setSessions(updated);
    dragState.current.draggedIndex = index;
  };

  useEffect(() => {
    if (!editMode || mobile) return;
    let scrollInterval = null;
    const handleDrag = (e) => {
      const sidebar = sidebarRef.current;
      if (!sidebar) return;
      const rect = sidebar.getBoundingClientRect();
      const offset = 250, scrollSpeed = 12;
      if (e.clientY < rect.top + offset) {
        if (!scrollInterval) scrollInterval = setInterval(() => { sidebar.scrollTop -= scrollSpeed; }, 16);
      } else if (e.clientY > rect.bottom - offset) {
        if (!scrollInterval) scrollInterval = setInterval(() => { sidebar.scrollTop += scrollSpeed; }, 16);
      } else { clearInterval(scrollInterval); scrollInterval = null; }
    };
    const stopScroll = () => { clearInterval(scrollInterval); scrollInterval = null; };
    document.addEventListener("dragover", handleDrag);
    document.addEventListener("drop", stopScroll);
    document.addEventListener("dragend", stopScroll);
    return () => {
      stopScroll();
      document.removeEventListener("dragover", handleDrag);
      document.removeEventListener("drop", stopScroll);
      document.removeEventListener("dragend", stopScroll);
    };
  }, [editMode, mobile]);

  // Desktop resize
  useEffect(() => {
    if (mobile) return;
    const handleMouseMove = (e) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(200, Math.min(480, e.clientX));
      setSidebarWidth(newWidth);
    };
    const stopResizing = () => {
      if (isResizing.current) {
        isResizing.current = false;
        localStorage.setItem("sidebarWidth", sidebarWidth);
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [sidebarWidth, mobile]);

  // File open (Electron or Android via storageAdapter)
  const handleOpenBook = async () => {
    try {
      const result = await openBook();
      if (!result) {
        if (mobile) alert("📂 File picker coming soon. Use 'New Book' to start a session.");
        return;
      }
      if (sessions.some((s) => s.filePath === result.filePath)) {
        alert("This book is already open!");
        return;
      }
      const newBook = {
        id: Date.now().toString(),
        title: result.title || "Untitled Book",
        content: result.content || "",
        preview: (result.content || "").replace(/<[^>]*>?/gm, "").slice(0, 60) + "...",
        filePath: result.filePath,
        type: "book",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      setSessions((prev) => [newBook, ...prev]);
    } catch (err) {
      console.error("Error opening book:", err);
    }
  };

  // ── Positioning ──────────────────────────────────────────────────────────
  // Desktop: static left panel with resizable width
  // Mobile:  fixed full-height drawer, slides in from left
  const sidebarStyle = mobile
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100dvh',
        width: '85vw',
        maxWidth: '340px',
        zIndex: 50,
        transform: isDrawerOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
      }
    : { width: `${sidebarWidth}px` };

  return (
    <aside
      ref={sidebarRef}
      style={sidebarStyle}
      className={`bg-[#0b0b0c] text-white flex flex-col relative select-none ${mobile ? '' : 'min-w-[12rem] max-w-[30rem]'}`}
    >
      {/* HEADER */}
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between gap-2">
        <img src={Logo} alt="AuthNo" className="h-14 w-14 object-contain drop-shadow-[0_0_6px_rgba(255,255,255,0.15)]" />
        {/* Close button — mobile drawer only */}
        {mobile && (
          <button
            onClick={onDrawerClose}
            className="p-2 rounded-full border border-white/20 hover:bg-white/10 transition"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        )}
      </div>

      {/* SEARCH BAR */}
      <div className="p-3 border-b border-white/10">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent border border-white/20 rounded px-3 py-2 text-sm placeholder-white/40 focus:outline-none"
          placeholder="Search sessions..."
        />
      </div>

      {/* ACTION BUTTONS */}
      <div className="p-3 flex gap-2 border-b border-white/10 relative">
        {/* New Book dropdown */}
        <div className="relative flex-1">
          <button
            onClick={() => setBookDropdownOpen((v) => !v)}
            style={{ borderColor: accentHex, color: accentHex }}
            className="w-full border-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-white/5 transition"
          >
            + New Book ▾
          </button>
          {bookDropdownOpen && (
            <div className="absolute mt-2 w-full bg-[#0f0f10] border border-white/10 rounded-lg shadow-lg overflow-hidden z-20">
              <button
                onClick={() => { setBookDropdownOpen(false); onNewBook(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition"
              >
                📖 New Blank Book
              </button>
              <button
                onClick={() => { setBookDropdownOpen(false); handleOpenBook(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition"
              >
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

      {/* Edit-mode done button (desktop drag-sort) */}
      {editMode && !mobile && (
        <div className="p-3 border-b border-white/10">
          <button
            onClick={() => setEditMode(false)}
            style={{ borderColor: accentHex, color: accentHex }}
            className="w-full border-2 rounded-lg px-3 py-2 text-sm font-semibold bg-white/5 hover:bg-white/10 transition"
          >
            ✅ Done Editing
          </button>
        </div>
      )}

      {/* SESSIONS LIST */}
      <div className="p-3 flex-1 overflow-auto">
        <div
          className="rounded-lg p-2"
          style={{
            background: "linear-gradient(135deg, #1f1f1f 0%, #050505 100%)",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <h3 className="text-xs text-white/70 px-2 mb-2">Sessions</h3>
          <div className="flex flex-col gap-2">
            {sessions.length === 0 ? (
              <div className="text-sm text-white/40 px-2 italic">No sessions yet — create one.</div>
            ) : (
              sessions.map((s, i) => (
                <div
                  key={s.id}
                  draggable={editMode && !mobile}
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onClick={() => !editMode && onSelect(s.id)}
                  onContextMenu={(e) => !editMode && !mobile && handleContextMenu(e, s.id)}
                  onTouchStart={(e) => !editMode && mobile && handleTouchStart(e, s.id)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd}
                  className={`text-left px-3 py-3 rounded-md border-2 transition cursor-pointer select-none ${
                    s.id === currentId && !editMode
                      ? "bg-white/5"
                      : editMode && !mobile
                      ? "border-white/10"
                      : "border-white/10 hover:border-white/30"
                  } ${editMode && !mobile ? "animate-wobble cursor-grab" : ""}`}
                  style={
                    s.id === currentId && !editMode
                      ? { borderColor: accentHex }
                      : editMode && !mobile
                      ? { borderColor: `${accentHex}55` }
                      : {}
                  }
                >
                  <div className="font-medium text-sm leading-snug">{s.title}</div>
                  <div className="text-xs text-white/40 mt-0.5">
                    {s.type === "book" ? "📖 Book" : "🎞️ Storyboard"} — {s.preview}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* FLOATING CONTEXT MENU */}
      {contextMenu?.visible && (
        <div
          ref={contextMenuRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 p-2 rounded-lg shadow-xl border border-white/30 backdrop-blur-md"
        >
          <div
            className="text-white rounded-lg overflow-hidden border border-white/20"
            style={{
              background: `linear-gradient(to bottom right, ${accentHex}, black)`,
              boxShadow: "0 0 10px rgba(255,255,255,0.1)",
              minWidth: "120px",
            }}
          >
            <button
              onClick={handleDelete}
              className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition"
            >
              🗑️ Delete
            </button>
            {!mobile && (
              <button
                onClick={() => { setEditMode(true); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition"
              >
                ✏️ Edit Layout
              </button>
            )}
          </div>
        </div>
      )}

      {/* RESIZE HANDLE — desktop only */}
      {!mobile && (
        <div
          onMouseDown={() => (isResizing.current = true)}
          onMouseEnter={e => e.currentTarget.style.background = `${accentHex}66`}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent transition"
          style={{ zIndex: 100 }}
        />
      )}
    </aside>
  );
}
