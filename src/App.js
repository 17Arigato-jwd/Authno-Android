import React, { useState, useEffect, useRef, useCallback } from "react";
import Logo from "./logo.svg";
import { Background } from "./components/Background";
import { RotateCw, Menu } from "lucide-react";
import EditorToolbar from "./components/EditorToolbar";
import BurgerMenu from "./components/BurgerMenu";
import Sidebar from "./components/Sidebar";
import EditLayout from "./components/EditLayoutSidebar";
import { Settings, DEFAULT_SETTINGS } from "./components/Settings";
import { CustomizationSlider, DEFAULT_CUSTOMIZATION } from "./components/CustomizationSlider";
import { FlameButton } from "./components/Streak";
import { isAndroid } from "./utils/platform";
import { listSavedBooks, saveBook, restoreSafBooks, openBookFromBytes, initStoragePermissions } from "./utils/storage";

import { ErrorProvider, useError } from "./utils/ErrorContext";
import { Onboarding, hasSeenOnboarding } from "./components/Onboarding";

const BurgerIcon = ({ className }) => (
  <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/* ── Editor ─────────────────────────────────────────────────────────────── */
function Editor({
  current, onEditTitle, onEditContent,
  onToggleMenu, accentHex, goalWords, onStreakUpdate,
  onToggleSidebar, burgerBtnRef,
}) {
  const [title, setTitle] = useState(current?.title || "");
  const editorRef = useRef(null);
  const android = isAndroid();

  useEffect(() => { setTitle(current?.title || ""); }, [current]);
  useEffect(() => {
    if (editorRef.current && current?.content !== undefined)
      editorRef.current.innerHTML = current.content || "";
  }, [current?.id]);

  const execCommand = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ background: 'var(--app-bg)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          {android && (
            <button onClick={onToggleSidebar}
              className="p-2 border border-white/30 rounded-md hover:bg-white/5 transition shrink-0"
              aria-label="Sessions">
              <Menu className="w-5 h-5 text-white" />
            </button>
          )}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => onEditTitle(title)}
            className="bg-transparent text-white text-lg font-semibold focus:outline-none border-b border-transparent focus:border-white/20 truncate min-w-0"
            style={{ maxWidth: android ? "40vw" : "60vw" }}
            placeholder="Untitled"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <FlameButton current={current} accentHex={accentHex} goalWords={goalWords} onStreakUpdate={onStreakUpdate} />
          <button
            ref={burgerBtnRef}
            onClick={onToggleMenu}
            className="p-2 border-2 border-white rounded-md hover:bg-white/5 transition"
          >
            <BurgerIcon className="text-white" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="relative flex-1 overflow-auto" style={{ padding: android ? "0.75rem" : "1.5rem" }}>
        {current ? (
          <>
            <EditorToolbar execCommand={execCommand} accentHex={accentHex} />
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="w-full min-h-[400px] p-4 rounded-lg shadow-inner focus:outline-none leading-relaxed"
              style={{
                background: 'var(--editor-bg)', color: 'var(--text-1)',
                marginTop: android ? "0.25rem" : "5rem",
                WebkitUserSelect: "text", userSelect: "text",
              }}
              onInput={(e) => onEditContent(e.currentTarget.innerHTML)}
            />
          </>
        ) : (
          <div className="text-white/40 text-center mt-20 px-4">
            {android ? "Tap ☰ above to open your sessions." : "Select or create a session to begin."}
          </div>
        )}
      </main>
    </div>
  );
}

/* ── App ────────────────────────────────────────────────────────────────── */
function AppInner() {
  const { showError } = useError();
  const [sessions, setSessions]   = useState([]);
  const [search, setSearch]       = useState("");
  const [currentId, setCurrentId] = useState(null);
  const [menuOpen, setMenuOpen]   = useState(false);
  const [lastSaved]               = useState(null);
  const [inactive]                = useState(false);
  const [view, setView]           = useState("editor");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const burgerBtnRef  = useRef(null);
  const autoSaveTimer = useRef(null);
  const android = isAndroid();

  // ── Swipe-from-left-edge to open drawer (Android only) ──────────────────
  useEffect(() => {
    if (!android) return;
    const EDGE_ZONE   = 22;   // px from left edge to start tracking
    const MIN_SWIPE_X = 60;   // px rightward to trigger open
    const MAX_DRIFT_Y = 50;   // px vertical drift allowed
    let startX = null, startY = null, tracking = false;

    const onStart = (e) => {
      const t = e.touches[0];
      if (t.clientX <= EDGE_ZONE) {
        startX = t.clientX; startY = t.clientY; tracking = true;
      }
    };
    const onMove = (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (Math.abs(t.clientY - startY) > MAX_DRIFT_Y) { tracking = false; return; }
      if (t.clientX - startX > MIN_SWIPE_X) {
        tracking = false;
        setDrawerOpen(true);
      }
    };
    const onEnd = () => { tracking = false; };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove",  onMove,  { passive: true });
    document.addEventListener("touchend",   onEnd,   { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove",  onMove);
      document.removeEventListener("touchend",   onEnd);
    };
  }, [android]);

  // ── Load sessions ────────────────────────────────────────────────────────
  useEffect(() => {
    // ── Check onboarding (async — Capacitor Preferences) ──────────────────
    hasSeenOnboarding().then((seen) => {
      if (!seen) setShowOnboarding(true);
    });

    const saved   = localStorage.getItem("offlineWriterSessions");
    const savedId = localStorage.getItem("offlineWriterCurrentId");
    if (saved) { setSessions(JSON.parse(saved)); if (savedId) setCurrentId(savedId); }

    // Electron: restore open books from file paths
    if (window.electron) {
      const openBooks = localStorage.getItem("openBooks");
      if (openBooks) {
        try {
          const books = JSON.parse(openBooks);
          if (Array.isArray(books) && window.electron?.restoreBooks)
            window.electron.restoreBooks(books);
        } catch (e) { console.error(e); }
      }
    }

// Android: request storage permissions immediately, then restore books
     if (android) {
       initStoragePermissions();
       const localRaw   = localStorage.getItem("offlineWriterSessions");
       const localSessions = localRaw ? JSON.parse(localRaw) : [];

       // Refresh any SAF-URI sessions from disk (catches edits made outside the app)
       restoreSafBooks(localSessions).then((refreshed) => {
         setSessions(refreshed);

         // Scan legacy directory for books saved before SAF was introduced
         return listSavedBooks();
       }).then((legacyBooks) => {
         if (!legacyBooks.length) return;
         setSessions((prev) => {
           const fresh = legacyBooks.filter((b) => !prev.some((s) => s.id === b.id));
           return fresh.length ? [...fresh, ...prev] : prev;
         });
       });
     }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Startup behavior ─────────────────────────────────────────────────────
  // Runs once after sessions are first loaded and settings are ready.
  const startupApplied = useRef(false);
  useEffect(() => {
    if (startupApplied.current) return;
    if (!sessions.length) return; // wait until sessions are loaded
    startupApplied.current = true;

    const behavior = settings?.startupBehavior ?? "last";

    if (behavior === "last") {
      // Reopen last-used book (already handled by offlineWriterCurrentId)
      const savedId = localStorage.getItem("offlineWriterCurrentId");
      if (savedId && sessions.some((s) => s.id === savedId)) {
        setCurrentId(savedId);
      } else if (sessions.length > 0) {
        setCurrentId(sessions[0].id);
      }
    } else if (behavior === "blank") {
      // Open a fresh untitled book
      const blank = {
        id: Date.now().toString(),
        title: "Untitled Book",
        content: "",
        createdAt: Date.now(),
      };
      setSessions((prev) => [blank, ...prev]);
      setCurrentId(blank.id);
    } else if (behavior === "none") {
      // Show empty editor — clear any remembered current book
      setCurrentId(null);
    }
  }, [sessions, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save open books for Electron restore
  useEffect(() => {
    if (window.electron) localStorage.setItem("openBooks", JSON.stringify(sessions));
  }, [sessions]);

  // Electron: receive restored/missing books from preload
  useEffect(() => {
    const handler = (e) => {
      if (e.data.type === "restored-books") {
        // e.data.books = [{ base64, filePath }] from the new fileManager.js
        // Decode each book via storage then merge into sessions
        Promise.all(
          e.data.books.map(({ base64, filePath }) =>
            openBookFromBytes(base64, filePath).catch(() => null)
          )
        ).then((decoded) => {
          const valid = decoded.filter(Boolean);
          if (!valid.length) return;
          setSessions((prev) => {
            const fresh = valid.filter((b) => !prev.some((s) => s.filePath === b.filePath));
            return [...fresh, ...prev];
          });
        });
      }
      if (e.data.type === "missing-books") e.data.messages.forEach(alert);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Electron: .authbook file opened via file association
  useEffect(() => {
    if (!window.electron?.onOpenAuthBook) return;
    const listener = (book) => {
      if (sessions.some((s) => s.filePath === book.filePath)) return;
      const nb = {
        id: Date.now().toString(), title: book.title || "Untitled Book",
        content: book.content || "",
        preview: (book.content || "").replace(/<[^>]*>?/gm, "").slice(0, 60) + "...",
        filePath: book.filePath, type: "book",
        created: new Date().toISOString(), updated: new Date().toISOString(),
      };
      setSessions((p) => [nb, ...p]);
      setCurrentId(nb.id);
    };
    window.electron.onOpenAuthBook(listener);
    return () => window.removeEventListener("open-authbook", listener);
  }, [sessions]);

  // Android: .authbook file opened via intent (tapped in file manager)
  // Handles both VCHS-ECS binary files and legacy JSON files.
  useEffect(() => {
    // New binary path fired by MainActivity (VCHS-ECS + legacy JSON both come through here)
    const bytesHandler = async (e) => {
      const { base64, uri } = e.detail || {};
      if (!base64) return;
      try {
        const session = await openBookFromBytes(base64, uri);
        if (!session) return;
        setSessions((prev) => {
          if (prev.some((s) => s.id === session.id)) return prev;
          setCurrentId(session.id);
          return [session, ...prev];
        });
      } catch (err) {
        alert("⚠️ Could not open that .authbook file — it may be corrupt.\n" + err.message);
      }
    };

    // Legacy path kept for any code that fires the old event directly
    const legacyHandler = (e) => {
      const book = e.detail;
      if (!book) return;
      setSessions((prev) => {
        if (prev.some((s) => s.id === book.id)) return prev;
        const nb = {
          ...book,
          id: book.id || Date.now().toString(),
          preview: (book.content || "").replace(/<[^>]*>?/gm, "").slice(0, 60) + "...",
        };
        setCurrentId(nb.id);
        return [nb, ...prev];
      });
    };

    const errHandler = () => alert("⚠️ Could not open that .authbook file — it may be corrupt.");

    window.addEventListener("open-authbook-android-bytes",  bytesHandler);
    window.addEventListener("open-authbook-android",        legacyHandler);
    window.addEventListener("open-authbook-android-error",  errHandler);
    return () => {
      window.removeEventListener("open-authbook-android-bytes",  bytesHandler);
      window.removeEventListener("open-authbook-android",        legacyHandler);
      window.removeEventListener("open-authbook-android-error",  errHandler);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Android: debounced auto-save — saves 2s after any content change
  useEffect(() => {
      if (!android || sessions.length === 0) return;

      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        sessions.forEach((s) => {
          saveBook(s).then((result) => {
            // FIX: Only trigger a state update if the path is actually NEW.
            // This prevents the infinite loop.
            if (result?.filePath && result.filePath !== s.filePath) {
              setSessions((prev) =>
                prev.map((x) => (x.id === s.id ? { ...x, filePath: result.filePath } : x))
              );
            }
          }).catch(err => console.error('[AuthNo AutoSave]', err));
        });
      }, 2000);

      return () => clearTimeout(autoSaveTimer.current);
      // REMOVED 'sessions' from dependencies to prevent the loop.
      // We only want this to run when the active session content changes,
      // but usually, it's better to trigger this from the 'onChange' event instead.
    }, [android]);

  // ── Settings / Customization ─────────────────────────────────────────────
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [settings, setSettings] = useState(
    JSON.parse(localStorage.getItem("writerSettings")) || DEFAULT_SETTINGS
  );
  const handleSaveSettings = (patch) => {
    setSettings(patch);
    localStorage.setItem("writerSettings", JSON.stringify(patch));
    if (patch.accentHex !== undefined) {
      const u = { ...customization, accentHex: patch.accentHex };
      setCustomization(u);
      localStorage.setItem("writerCustomization", JSON.stringify(u));
    }
  };
  const [customization, setCustomization] = useState(
    JSON.parse(localStorage.getItem("writerCustomization")) || DEFAULT_CUSTOMIZATION
  );
  const handleSaveCustomization = (patch) => {
    setCustomization(patch);
    localStorage.setItem("writerCustomization", JSON.stringify(patch));
  };

  // ── Streak ───────────────────────────────────────────────────────────────
  const handleStreakUpdate = useCallback((updatedStreak) => {
    setSessions((prev) => prev.map((s) =>
      s.id === currentId ? { ...s, streak: {
        ...(s.streak ?? {}), ...updatedStreak,
        log:          { ...(s.streak?.log ?? {}),           ...(updatedStreak.log ?? {}) },
        dailyBaseline:{ ...(s.streak?.dailyBaseline ?? {}), ...(updatedStreak.dailyBaseline ?? {}) },
      }} : s
    ));
  }, [currentId]);

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const newBook = () => {
    const id = Date.now().toString(), now = new Date().toISOString();
    setSessions((s) => [{ id, title: "Untitled Book", preview: "A new story...", content: "", type: "book", created: now, updated: now }, ...s]);
    setCurrentId(id);
    if (android) setDrawerOpen(false);
  };
  const newStoryboard = () => {
    const id = Date.now().toString(), now = new Date().toISOString();
    setSessions((s) => [{ id, title: "Untitled Storyboard", preview: "Visual outline...", content: "", type: "storyboard", created: now, updated: now }, ...s]);
    setCurrentId(id);
    if (android) setDrawerOpen(false);
  };
  const handleSelect = (id) => { setCurrentId(id); if (android) setDrawerOpen(false); };
  const handleEditTitle = (t) => setSessions((s) => s.map((x) => x.id === currentId ? { ...x, title: t } : x));
  const handleEditContent = (c) => setSessions((s) => s.map((x) =>
    x.id === currentId ? { ...x, content: c, preview: c.replace(/<[^>]*>?/gm, "").slice(0, 60) + "..." } : x
  ));

  const filtered = sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()));
  const current  = sessions.find((s) => s.id === currentId) || null;

  const handleToggleMenu = () => {
    // Update CSS vars so BurgerMenu knows exactly where to appear
    if (burgerBtnRef.current) {
      const r = burgerBtnRef.current.getBoundingClientRect();
      document.documentElement.style.setProperty("--bm-top",   `${r.bottom + 8}px`);
      document.documentElement.style.setProperty("--bm-right",  `${window.innerWidth - r.right}px`);
    }
    setMenuOpen((v) => !v);
  };

  return (
    <div className={`app-root flex text-white relative${settings.lightMode ? ' light-mode' : ''}`}>

      {showOnboarding && (
        <Onboarding
          accentHex={customization.accentHex}
          onDone={() => setShowOnboarding(false)}
        />
      )}

      <Background
        accentHex={customization.accentHex}
        backgroundOpacity={customization.backgroundOpacity}
        colorRange={{ from: customization.gradient.colorFrom, to: customization.gradient.colorTo }}
        minBlobs={customization.gradient.blobCountMin}
        maxBlobs={customization.gradient.blobCountMax}
        blobSizeRange={{ min: customization.gradient.blobSizeMin, max: customization.gradient.blobSizeMax }}
        blobSpeedMultiplier={customization.gradient.speedMultiplier}
        visible={settings.enableGradient}
      />

      {/* Android drawer backdrop — closes instantly on any touch or click */}
      {android && drawerOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40"
          onClick={() => setDrawerOpen(false)}
          onTouchStart={() => setDrawerOpen(false)}
        />
      )}

      <Sidebar
        sessions={filtered}
        onNewBook={newBook}
        onNewStoryboard={newStoryboard}
        search={search}
        setSessions={setSessions}
        setSearch={setSearch}
        onSelect={handleSelect}
        currentId={currentId}
        setView={setView}
        accentHex={customization.accentHex}
        lightMode={settings.lightMode}
        isDrawerOpen={drawerOpen}
        onDrawerClose={() => setDrawerOpen(false)}
        onDelete={(id) => {
          const updated = sessions.filter((s) => s.id !== id);
          setSessions(updated);
          if (id === currentId) setCurrentId(null);
          localStorage.setItem("offlineWriterSessions", JSON.stringify(updated));
        }}
      />

      {view === "layout" ? (
        <EditLayout sessions={sessions} setSessions={setSessions} />
      ) : (
        <Editor
          current={current}
          onEditTitle={handleEditTitle}
          onEditContent={handleEditContent}
          onToggleMenu={handleToggleMenu}
          accentHex={customization.accentHex}
          goalWords={settings.dailyWordGoal ?? 300}
          onStreakUpdate={handleStreakUpdate}
          onToggleSidebar={() => setDrawerOpen((v) => !v)}
          burgerBtnRef={burgerBtnRef}
        />
      )}

      <BurgerMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        current={current}
        setSessions={setSessions}
        onOpenSettings={() => { setMenuOpen(false); setSettingsOpen(true); }}
        onOpen={(id) => { setCurrentId(id); if (android) setDrawerOpen(false); }}
        accentHex={customization.accentHex}
        anchorRef={burgerBtnRef}
      />

      <Settings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
        onOpenCustomizer={() => setCustomizerOpen(true)}
        onClearSessions={() => { setSessions([]); localStorage.removeItem("offlineWriterSessions"); }}
      />

      <CustomizationSlider
        isOpen={customizerOpen}
        onClose={() => setCustomizerOpen(false)}
        customization={customization}
        onSave={handleSaveCustomization}
      />

      <div className="fixed bottom-4 right-4 flex items-center gap-3 text-white/40 text-sm select-none"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {lastSaved && <span className="opacity-80">Saved ✓ ({lastSaved})</span>}
        <button onClick={() => window.location.reload()}
          className={`p-2 rounded-full border border-white/20 hover:border-white/40 transition ${inactive ? "opacity-70" : "opacity-30"}`}
          title="Reload">
          <RotateCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* ── Root export wrapped in ErrorProvider ──────────────────────────────────── */
export default function App() {
  // We read accentHex from localStorage so ErrorProvider has the right colour
  // before customization state is initialised inside AppInner.
  const stored = JSON.parse(localStorage.getItem("writerCustomization") || "{}");
  const accentHex = stored.accentHex || "#5a00d9";

  return (
    <ErrorProvider accentHex={accentHex}>
      <AppInner />
    </ErrorProvider>
  );
}
