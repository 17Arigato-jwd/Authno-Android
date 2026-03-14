import React, { useState, useEffect, useRef, useCallback } from "react";
import Logo from "./logo.svg";
import { Background } from "./components/Background";
import { RotateCw, Menu } from "lucide-react";
import EditorToolbar from "./components/EditorToolbar";
import BurgerMenu from "./components/BurgerMenu";
import Sidebar from "./components/Sidebar";
import EditLayout from "./components/EditLayoutSidebar";
import { Settings, DEFAULT_SETTINGS } from './components/Settings';
import { CustomizationSlider, DEFAULT_CUSTOMIZATION } from './components/CustomizationSlider';
import { FlameButton } from './components/Streak';
import { isMobile } from './utils/platform';
import { listAndroidBooks } from './utils/storageAdapter';

/* ── Icons ─────────────────────────────────────────────────────────────────── */
const BurgerIcon = ({ className }) => (
  <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/* ── Editor ─────────────────────────────────────────────────────────────────── */
function Editor({
  current, onEditTitle, onEditContent,
  onToggleMenu, accentHex, goalWords, onStreakUpdate,
  onToggleSidebar, burgerBtnRef,
}) {
  const [title, setTitle] = useState(current?.title || "");
  const editorRef = useRef(null);
  const mobile = isMobile();

  useEffect(() => { setTitle(current?.title || ""); }, [current]);

  useEffect(() => {
    if (editorRef.current && current?.content !== undefined) {
      editorRef.current.innerHTML = current.content || "";
    }
  }, [current?.id]);

  const handleInput = (e) => onEditContent(e.currentTarget.innerHTML);

  const execCommand = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-[#060606] border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* Sidebar hamburger — mobile only */}
          {mobile && (
            <button
              onClick={onToggleSidebar}
              className="p-2 border border-white/30 rounded-md hover:bg-white/5 transition shrink-0"
              aria-label="Open sessions"
            >
              <Menu className="w-5 h-5 text-white" />
            </button>
          )}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => onEditTitle(title)}
            className="bg-transparent text-white text-lg font-semibold focus:outline-none border-b border-transparent focus:border-white/20 min-w-0 truncate"
            style={{ maxWidth: mobile ? "42vw" : "60vw" }}
            placeholder="Untitled"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <FlameButton
            current={current}
            accentHex={accentHex}
            goalWords={goalWords}
            onStreakUpdate={onStreakUpdate}
          />
          {/* Burger button — ref is forwarded to BurgerMenu for anchoring */}
          <button
            ref={burgerBtnRef}
            onClick={onToggleMenu}
            className="p-2 border-2 border-white rounded-md hover:bg-white/5 transition"
            aria-label="Menu"
          >
            <BurgerIcon className="text-white" />
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      <main
        className="relative flex-1 overflow-auto"
        style={{ padding: mobile ? "0.75rem" : "1.5rem" }}
      >
        {current ? (
          <>
            <EditorToolbar execCommand={execCommand} accentHex={accentHex} />
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="w-full min-h-[400px] bg-[#0f0f10] text-white p-4 rounded-lg shadow-inner focus:outline-none leading-relaxed text-base"
              style={{
                WebkitUserSelect: "text",
                userSelect: "text",
                marginTop: mobile ? "0.25rem" : "5rem",
              }}
              onInput={handleInput}
            />
          </>
        ) : (
          <div className="text-white/40 text-center mt-20 px-4">
            {mobile
              ? "Tap ☰ above to open your sessions."
              : "Select or create a session to begin."}
          </div>
        )}
      </main>
    </div>
  );
}

/* ── Main App ─────────────────────────────────────────────────────────────── */
export default function App() {
  const [sessions, setSessions]             = useState([]);
  const [search, setSearch]                 = useState("");
  const [currentId, setCurrentId]           = useState(null);
  const [menuOpen, setMenuOpen]             = useState(false);
  const [lastSaved, setLastSaved]           = useState(null);
  const [inactive]                          = useState(false);
  const [view, setView]                     = useState("editor");
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);

  // Ref forwarded to the burger button so BurgerMenu knows where to anchor
  const burgerBtnRef = useRef(null);
  const mobile = isMobile();

  // ── Load sessions on mount ─────────────────────────────────────────────────
  useEffect(() => {
    const saved   = localStorage.getItem("offlineWriterSessions");
    const savedId = localStorage.getItem("offlineWriterCurrentId");
    if (saved) {
      setSessions(JSON.parse(saved));
      if (savedId) setCurrentId(savedId);
    }

    // Electron: restore previously open book files
    if (window.electron) {
      const savedBooks = localStorage.getItem("openBooks");
      if (savedBooks) {
        try {
          const books = JSON.parse(savedBooks);
          if (Array.isArray(books) && window.electron?.restoreBooks) {
            window.electron.restoreBooks(books);
          }
        } catch (err) { console.error("Failed to restore books:", err); }
      }
    }

    // Android: surface any .authbook files saved to Documents/AuthNo/
    if (!window.electron) {
      listAndroidBooks().then((books) => {
        if (books.length === 0) return;
        setSessions((prev) => {
          const incoming = books.filter(
            (b) => !prev.some((s) => s.id === b.id)
          );
          return incoming.length ? [...incoming, ...prev] : prev;
        });
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist sessions for Electron book-restore
  useEffect(() => {
    if (window.electron) localStorage.setItem("openBooks", JSON.stringify(sessions));
  }, [sessions]);

  // Receive restored/missing book messages from Electron preload
  useEffect(() => {
    const handleRestore = (event) => {
      if (event.data.type === "restored-books") {
        setSessions((prev) => {
          const newOnes = event.data.books.filter(
            (b) => !prev.some((s) => s.filePath === b.filePath)
          );
          return [...newOnes, ...prev];
        });
      }
      if (event.data.type === "missing-books") {
        event.data.messages.forEach((msg) => alert(msg));
      }
    };
    window.addEventListener("message", handleRestore);
    return () => window.removeEventListener("message", handleRestore);
  }, []);

  // Handle .authbook files opened via file association (Electron)
  useEffect(() => {
    if (window.electron?.onOpenAuthBook) {
      const listener = (book) => {
        if (sessions.some((s) => s.filePath === book.filePath)) return;
        const newBook = {
          id: Date.now().toString(),
          title: book.title || "Untitled Book",
          content: book.content || "",
          preview: (book.content || "").replace(/<[^>]*>?/gm, "").slice(0, 60) + "...",
          filePath: book.filePath,
          type: "book",
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        };
        setSessions((prev) => [newBook, ...prev]);
        setCurrentId(newBook.id);
      };
      window.electron.onOpenAuthBook(listener);
      return () => window.removeEventListener("open-authbook", listener);
    }
  }, [sessions]);

  // ── Settings / Customization state ────────────────────────────────────────
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [settings, setSettings] = useState(
    JSON.parse(localStorage.getItem("writerSettings")) || DEFAULT_SETTINGS
  );

  const handleSaveSettings = (patch) => {
    setSettings(patch);
    localStorage.setItem("writerSettings", JSON.stringify(patch));
    if (patch.accentHex !== undefined) {
      const updated = { ...customization, accentHex: patch.accentHex };
      setCustomization(updated);
      localStorage.setItem("writerCustomization", JSON.stringify(updated));
    }
  };

  const [customization, setCustomization] = useState(
    JSON.parse(localStorage.getItem("writerCustomization")) || DEFAULT_CUSTOMIZATION
  );
  const handleSaveCustomization = (patch) => {
    setCustomization(patch);
    localStorage.setItem("writerCustomization", JSON.stringify(patch));
  };

  // ── Streak ────────────────────────────────────────────────────────────────
  const handleStreakUpdate = useCallback((updatedStreak) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentId
          ? {
              ...s,
              streak: {
                ...(s.streak ?? {}),
                ...updatedStreak,
                log:          { ...(s.streak?.log ?? {}),           ...(updatedStreak.log ?? {}) },
                dailyBaseline:{ ...(s.streak?.dailyBaseline ?? {}), ...(updatedStreak.dailyBaseline ?? {}) },
              },
            }
          : s
      )
    );
  }, [currentId]);

  // ── Session CRUD ──────────────────────────────────────────────────────────
  const newBook = () => {
    const id = Date.now().toString(), now = new Date().toISOString();
    setSessions((s) => [
      { id, title: "Untitled Book", preview: "A new story...", content: "", type: "book", created: now, updated: now },
      ...s,
    ]);
    setCurrentId(id);
    if (mobile) setSidebarDrawerOpen(false);
  };

  const newStoryboard = () => {
    const id = Date.now().toString(), now = new Date().toISOString();
    setSessions((s) => [
      { id, title: "Untitled Storyboard", preview: "Visual outline...", content: "", type: "storyboard", created: now, updated: now },
      ...s,
    ]);
    setCurrentId(id);
    if (mobile) setSidebarDrawerOpen(false);
  };

  const handleSelect      = (id) => { setCurrentId(id); if (mobile) setSidebarDrawerOpen(false); };
  const handleEditTitle   = (t)  => setSessions((s) => s.map((x) => x.id === currentId ? { ...x, title: t } : x));
  const handleEditContent = (c)  => setSessions((s) => s.map((x) =>
    x.id === currentId
      ? { ...x, content: c, preview: c.replace(/<[^>]*>?/gm, "").slice(0, 60) + "..." }
      : x
  ));

  const filtered = sessions.filter((s) =>
    s.title.toLowerCase().includes(search.toLowerCase())
  );
  const current = sessions.find((s) => s.id === currentId) || null;

  return (
    <div
      className="authno-root flex text-white relative"
      style={{ height: "100dvh", overscrollBehavior: "none" }}
    >
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

      {/* Mobile sidebar backdrop */}
      {mobile && sidebarDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={() => setSidebarDrawerOpen(false)}
          aria-hidden="true"
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
        isDrawerOpen={sidebarDrawerOpen}
        onDrawerClose={() => setSidebarDrawerOpen(false)}
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
          onToggleMenu={() => setMenuOpen((v) => !v)}
          accentHex={customization.accentHex}
          goalWords={settings.dailyWordGoal ?? 300}
          onStreakUpdate={handleStreakUpdate}
          onToggleSidebar={() => setSidebarDrawerOpen((v) => !v)}
          burgerBtnRef={burgerBtnRef}
        />
      )}

      <BurgerMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        current={current}
        setSessions={setSessions}
        onOpenSettings={() => { setMenuOpen(false); setSettingsOpen(true); }}
        accentHex={customization.accentHex}
        anchorRef={burgerBtnRef}
      />

      <Settings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
        onOpenCustomizer={() => setCustomizerOpen(true)}
        onClearSessions={() => {
          setSessions([]);
          localStorage.removeItem("offlineWriterSessions");
        }}
      />

      <CustomizationSlider
        isOpen={customizerOpen}
        onClose={() => setCustomizerOpen(false)}
        customization={customization}
        onSave={handleSaveCustomization}
      />

      {/* Autosave indicator */}
      <div
        className="fixed bottom-4 right-4 flex items-center gap-3 text-white/40 text-sm select-none"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {lastSaved && (
          <span className="transition-opacity duration-500 opacity-80">
            Saved ✓ ({lastSaved})
          </span>
        )}
        <button
          onClick={() => window.location.reload()}
          className={`p-2 rounded-full border border-white/20 hover:border-white/40 transition ${
            inactive ? "opacity-70 hover:opacity-100" : "opacity-30"
          }`}
          title="Reload"
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
