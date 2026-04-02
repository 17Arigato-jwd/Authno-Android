import React, { useState, useEffect, useRef, useCallback } from "react";
import Logo from "./logo.svg";
import { Background } from "./components/Background";
import { RotateCw, Menu } from "lucide-react";
import { Filesystem, Directory } from '@capacitor/filesystem';
import { App as CapApp } from '@capacitor/app';
import EditorToolbar from "./components/EditorToolbar";
import BurgerMenu from "./components/BurgerMenu";
import Sidebar from "./components/Sidebar";
import EditLayout from "./components/EditLayoutSidebar";
import { Settings, DEFAULT_SETTINGS } from "./components/Settings";
import { CustomizationSlider, DEFAULT_CUSTOMIZATION } from "./components/CustomizationSlider";
import { FlameButton } from "./components/Streak";
import { isAndroid } from "./utils/platform";
import { syncWidget, useWidgetDeepLink } from "./utils/widgetBridge";
import { saveBook, openBookFromBytes, initStoragePermissions, initBookIndex, checkFileIntegrity, saveAsBook } from "./utils/storage";
import FileIntegrityModal from "./components/FileIntegrityModal";

import { ErrorProvider, useError } from "./utils/ErrorContext";
import HomeScreen from "./components/HomeScreen";
import BookDashboard from "./components/BookDashboard";
import { Onboarding, hasSeenOnboarding } from "./components/Onboarding";
import { ExtensionProvider } from "./utils/ExtensionContext";
import ExtensionPage from "./components/ExtensionPage";

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
  chapterTitle, onEditChapterTitle,
  onBack, onPrevChapter, onNextChapter, chapterPosition,
}) {
  const [title, setTitle] = useState(chapterTitle ?? current?.title ?? "");
  const editorRef = useRef(null);
  const android = isAndroid();

  useEffect(() => { setTitle(chapterTitle ?? current?.title ?? ""); }, [current, chapterTitle]);
  useEffect(() => {
    if (editorRef.current && current?.content !== undefined)
      editorRef.current.innerHTML = current.content || "";
  }, [current?.id, current?._editingChap]);

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
          {/* Back to book dashboard */}
          {onBack && (
            <button onClick={onBack}
              className="p-2 border border-white/30 rounded-md hover:bg-white/5 transition shrink-0"
              aria-label="Back to book"
              style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-1)', background: 'none', cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          {android && !onBack && (
            <button onClick={onToggleSidebar}
              className="p-2 border border-white/30 rounded-md hover:bg-white/5 transition shrink-0"
              aria-label="Sessions">
              <Menu className="w-5 h-5 text-white" />
            </button>
          )}
          <input
            value={title}
            onChange={(e) => {
              const t = e.target.value;
              setTitle(t);
              if (onEditChapterTitle) onEditChapterTitle(t);
              else onEditTitle(t);
            }}
            onBlur={() => {
              if (onEditChapterTitle) onEditChapterTitle(title);
              else onEditTitle(title);
            }}
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

      {/* Chapter navigation bar — only shown when editing a specific chapter */}
      {chapterPosition && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 16px',
          background: 'var(--app-bg)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <button
            onClick={onPrevChapter}
            disabled={!onPrevChapter}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'none', border: 'none', cursor: onPrevChapter ? 'pointer' : 'default',
              color: onPrevChapter ? 'var(--text-3)' : 'var(--text-5)',
              fontSize: '13px', fontWeight: 600, padding: '4px 8px', borderRadius: '6px',
              opacity: onPrevChapter ? 1 : 0.35,
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Prev
          </button>
          <span style={{ fontSize: '12px', color: 'var(--text-5)', fontWeight: 500 }}>
            Ch {chapterPosition.pos} / {chapterPosition.total}
          </span>
          <button
            onClick={onNextChapter}
            disabled={!onNextChapter}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'none', border: 'none', cursor: onNextChapter ? 'pointer' : 'default',
              color: onNextChapter ? 'var(--text-3)' : 'var(--text-5)',
              fontSize: '13px', fontWeight: 600, padding: '4px 8px', borderRadius: '6px',
              opacity: onNextChapter ? 1 : 0.35,
            }}>
            Next
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}
      <main className="relative flex-1 overflow-auto" style={{ padding: android ? "0.75rem" : "1.5rem" }}>
        {current ? (
          <>
            <EditorToolbar execCommand={execCommand} accentHex={accentHex} session={current} />
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
function AppInner({ navigateRef }) {
  const { showError } = useError();
  const [sessions, setSessions]   = useState([]);
  const [search, setSearch]       = useState("");
  const [currentId, setCurrentId] = useState(null);
  const [menuOpen, setMenuOpen]   = useState(false);
  const [lastSaved]               = useState(null);
  const [inactive]                = useState(false);
  const [view, setView]           = useState("home");
  // Extension page state — set by the navigate() callback in ExtensionProvider
  const [extPageState, setExtPageState] = useState(null); // { extension, pageId, session }

  // Wire the navigate implementation into the ref so ExtensionProvider can call it
  // from anywhere in the tree without prop-drilling.
  useEffect(() => {
    if (!navigateRef) return;
    navigateRef.current = (extension, pageId, session) => {
      setExtPageState({ extension, pageId, session, _prevView: view });
      setView("extension-page");
    };
  }); // no dep array — always write the latest `view` closure
  const [currentChapterIdx, setCurrentChapterIdx] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [brokenFiles, setBrokenFiles] = useState([]);

  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(
    JSON.parse(localStorage.getItem("writerSettings")) || DEFAULT_SETTINGS
  );
  const [customization, setCustomization] = useState(
    JSON.parse(localStorage.getItem("writerCustomization")) || DEFAULT_CUSTOMIZATION
  );

  const burgerBtnRef  = useRef(null);
  const autoSaveTimer = useRef(null);
  const android = isAndroid();

  // ── Swipe-from-left-edge to open drawer (Android only) ──────────────────
  useEffect(() => {
    if (!android) return;
    const EDGE_ZONE   = 22;
    const MIN_SWIPE_X = 60;
    const MAX_DRIFT_Y = 50;
    let startX = null, startY = null, tracking = false;

    const onStart = (e) => {
      const t = e.touches[0];
      if (t.clientX <= EDGE_ZONE) {
        startX = t.clientX;
        startY = t.clientY;
        tracking = true;
      }
    };

    const onMove = (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (Math.abs(t.clientY - startY) > MAX_DRIFT_Y) {
        tracking = false;
        return;
      }
      if (t.clientX - startX > MIN_SWIPE_X) {
        tracking = false;
        setDrawerOpen(true);
      }
    };

    const onEnd = () => {
      tracking = false;
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [android]);

  // ── Android hardware back button ─────────────────────────────────────────
  useEffect(() => {
    if (!android) return;
    let listener;
    CapApp.addListener('backButton', () => {
      // 1. Close any overlay first
      if (menuOpen)      { setMenuOpen(false);    return; }
      if (drawerOpen)    { setDrawerOpen(false);  return; }
      if (settingsOpen)  { setSettingsOpen(false); return; }
      if (customizerOpen){ setCustomizerOpen(false); return; }
      // 2. Navigate back through screens
      if (view === 'extension-page') { setView(extPageState?._prevView ?? 'home'); setExtPageState(null); return; }
      if (view === 'editor')        { setView('book-dashboard'); return; }
      if (view === 'book-dashboard'){ setView('home');           return; }
      if (view === 'layout')        { setView('home');           return; }
      // 3. On home screen — minimize rather than kill the app
      CapApp.minimizeApp();
    }).then(h => { listener = h; });
    return () => { listener?.remove(); };
  }, [android, menuOpen, drawerOpen, settingsOpen, customizerOpen, view]);

  // ── Load sessions ────────────────────────────────────────────────────────
  useEffect(() => {
    hasSeenOnboarding().then((seen) => {
      if (!seen) setShowOnboarding(true);
    });

    const saved = localStorage.getItem("offlineWriterSessions");
    const savedId = localStorage.getItem("offlineWriterCurrentId");
    if (saved) {
      setSessions(JSON.parse(saved));
      if (savedId) setCurrentId(savedId);
    }

    if (window.electron) {
      const openBooks = localStorage.getItem("openBooks");
      if (openBooks) {
        try {
          const books = JSON.parse(openBooks);
          if (Array.isArray(books) && window.electron?.restoreBooks) {
            window.electron.restoreBooks(books);
          }
        } catch (e) {
          console.error(e);
        }
      }
    }

    if (android) {
      initStoragePermissions();
      // Restore the book index from the physical .authno-library file.
      // This brings back the On Device list after a fresh install (no scan needed).
      initBookIndex();

      // Scan file paths on startup and flag any that are no longer accessible.
      const saved = localStorage.getItem("offlineWriterSessions");
      if (saved) {
        const parsed = JSON.parse(saved);
        checkFileIntegrity(parsed).then(broken => {
          if (broken.length > 0) setBrokenFiles(broken);
        });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Startup behavior ─────────────────────────────────────────────────────
  const startupApplied = useRef(false);
  useEffect(() => {
    if (startupApplied.current) return;
    if (!sessions.length) return;
    startupApplied.current = true;

    const behavior = settings?.startupBehavior ?? "last";

    if (behavior === "last") {
      const savedId = localStorage.getItem("offlineWriterCurrentId");
      if (savedId && sessions.some((s) => s.id === savedId)) {
        setCurrentId(savedId);
      } else if (sessions.length > 0) {
        setCurrentId(sessions[0].id);
      }
    } else if (behavior === "blank") {
      const blank = {
        id: Date.now().toString(),
        title: "Untitled Book",
        content: "",
        createdAt: Date.now(),
      };
      setSessions((prev) => [blank, ...prev]);
      setCurrentId(blank.id);
    } else if (behavior === "none") {
      setCurrentId(null);
    } else if (behavior === "home") {
      setCurrentId(null);
      setView("home");
    }
  }, [sessions, settings]);

  // Persist sessions to localStorage whenever they change so they survive app restarts.
    useEffect(() => {
      if (sessions.length > 0) {
        localStorage.setItem("offlineWriterSessions", JSON.stringify(sessions));

        // Also write a native-readable file so the widget config activity can
        // show the book list without needing the app to be opened first.
        if (isAndroid()) {
          const slim = sessions
            .filter(s => s.type !== 'storyboard')
            .map(s => ({ id: s.id, title: s.title || 'Untitled Book', streak: s.streak ?? {} }));
          // Ensure the directory exists before writing (prevents FILE_NOTCREATED on first run)
          Filesystem.mkdir({ path: '', directory: Directory.Data, recursive: true })
            .catch(() => {})
            .then(() => Filesystem.writeFile({
              path: 'authno_books.json',
              data: JSON.stringify(slim),
              directory: Directory.Data,
              encoding: 'utf8',
            }))
            .catch(() => {});
        }
      }
    }, [sessions]);

  // Sync book data to the native widget layer whenever sessions or accent colour changes.
  useEffect(() => {
    syncWidget(sessions, customization.accentHex);
  }, [sessions, customization.accentHex]);

  // Open the correct book when the app is launched by tapping a home-screen widget.
  useWidgetDeepLink((bookId) => {
    handleSelect(bookId);
  });

  // Persist the current open book ID so startup-behavior 'last' can restore it.
  useEffect(() => {
    if (currentId) localStorage.setItem("offlineWriterCurrentId", currentId);
  }, [currentId]);

  useEffect(() => {
    if (window.electron) localStorage.setItem("openBooks", JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    const handler = (e) => {
      if (e.data.type === "restored-books") {
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

  useEffect(() => {
    if (!window.electron?.onOpenAuthBook) return;

    const listener = (book) => {
      if (sessions.some((s) => s.filePath === book.filePath)) return;
      const nb = {
        id: Date.now().toString(),
        title: book.title || "Untitled Book",
        content: book.content || "",
        preview: (book.content || "").replace(/<[^>]*>?/gm, "").slice(0, 60) + "...",
        filePath: book.filePath,
        type: "book",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      setSessions((p) => [nb, ...p]);
      setCurrentId(nb.id);
    };

    window.electron.onOpenAuthBook(listener);
    return () => window.removeEventListener("open-authbook", listener);
  }, [sessions]);

  useEffect(() => {
    const bytesHandler = async (e) => {
      const { base64, uri } = e.detail || {};
      if (!base64) return;
      try {
        const session = await openBookFromBytes(base64, uri);
        if (!session) return;
        setSessions((prev) => {
          const idx = prev.findIndex(
            (s) => s.id === session.id || (session.filePath && s.filePath === session.filePath)
          );

          setCurrentId(session.id);

          if (idx === -1) return [session, ...prev];

          const next = [...prev];
          next[idx] = { ...next[idx], ...session };
          return next;
        });
      } catch (err) {
        alert("⚠️ Could not open that .authbook file — it may be corrupt.\n" + err.message);
      }
    };

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

    const errHandler = () =>
      alert("⚠️ Could not open that .authbook file — it may be corrupt.");

    window.addEventListener("open-authbook-android-bytes", bytesHandler);
    window.addEventListener("open-authbook-android", legacyHandler);
    window.addEventListener("open-authbook-android-error", errHandler);

    // ── Cold-start file intent recovery ────────────────────────────────────
    // When the app is launched cold by tapping an .authbook file, the WebView
    // is not yet loaded when handleAuthBookIntent fires in MainActivity.  The
    // CustomEvent dispatched via evaluateJavascript lands before these listeners
    // are registered and is silently lost.
    //
    // Fix: MainActivity also stores the file data in FilePickerPlugin static
    // fields.  We call getPendingIntent() NOW — after the listeners above are
    // registered — to pick up any file that arrived in that cold-start window.
    // For warm starts the event already fired correctly; getPendingIntent() will
    // return hasPending=false and this is a no-op.
    if (android) {
      (async () => {
        try {
          const { registerPlugin } = await import('@capacitor/core');
          const plugin = registerPlugin('AuthnoFilePicker');
          const result = await plugin.getPendingIntent();
          if (result?.hasPending && result.base64) {
            // Re-use the same handler so the dedup / setCurrentId logic is shared
            window.dispatchEvent(new CustomEvent('open-authbook-android-bytes', {
              detail: { base64: result.base64, uri: result.uri || '' },
            }));
          }
        } catch (_) { /* plugin not available in dev/web builds — ignore */ }
      })();
    }

    return () => {
      window.removeEventListener("open-authbook-android-bytes", bytesHandler);
      window.removeEventListener("open-authbook-android", legacyHandler);
      window.removeEventListener("open-authbook-android-error", errHandler);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!android || sessions.length === 0) return;

    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      sessions.forEach((s) => {
        // Only auto-save books that already have a confirmed content:// URI.
        // Sessions without one need an explicit Save to pick a destination first.
        // Without this guard, saveBook() opens the SAF picker for every new/unsaved
        // book — unexpected dialogs appearing silently every 2 seconds.
        if (!s.filePath?.startsWith('content://')) return;

        saveBook(s)
          .then((result) => {
            if (result?.staleUri) {
              // Wipe the broken URI so the next explicit Save prompts for a new location
              setSessions((prev) =>
                prev.map((x) => (x.id === s.id ? { ...x, filePath: null } : x))
              );
              return;
            }
            if (result?.filePath && result.filePath !== s.filePath) {
              setSessions((prev) =>
                prev.map((x) => (x.id === s.id ? { ...x, filePath: result.filePath } : x))
              );
            }
          })
          .catch((err) => console.error("[AuthNo AutoSave]", err));
      });
    }, 2000);

    return () => clearTimeout(autoSaveTimer.current);
  }, [android, sessions]);

  const handleSaveSettings = (patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem("writerSettings", JSON.stringify(next));
      return next;
    });

    if (patch.accentHex !== undefined) {
      setCustomization((prev) => {
        const next = { ...prev, accentHex: patch.accentHex };
        localStorage.setItem("writerCustomization", JSON.stringify(next));
        return next;
      });
    }
  };

  const handleSessionChange = (id, patch) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

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
    const firstChap = { chap_idx: 1, title: "Chapter 1", order: 1, content: "", created: now, updated: now };
    setSessions((s) => [{
      id, title: "Untitled Book", preview: "", content: "",
      type: "book", created: now, updated: now,
      chapters: [firstChap],
      authors: [], devices: [], genre: "", description: "", language: "en", publisher: "", isbn: "",
    }, ...s]);
    setCurrentId(id);
    setCurrentChapterIdx(null);
    setView("book-dashboard");
    if (android) setDrawerOpen(false);
  };
  const newStoryboard = () => {
    const id = Date.now().toString(), now = new Date().toISOString();
    setSessions((s) => [{ id, title: "Untitled Storyboard", preview: "Visual outline...", content: "", type: "storyboard", created: now, updated: now }, ...s]);
    setCurrentId(id);
    if (android) setDrawerOpen(false);
  };
  const handleSelect = (id, sessionObj) => {
    if (sessionObj) {
      setSessions((prev) =>
        prev.some((s) => s.id === sessionObj.id) ? prev : [sessionObj, ...prev]
      );
    }
    setCurrentId(id);
    setCurrentChapterIdx(null);
    setView("book-dashboard");
    if (android) setDrawerOpen(false);
  };

  // Open a specific chapter in the editor
  const handleEditChapter = useCallback((chapIdx) => {
    setCurrentChapterIdx(chapIdx);
    setView("editor");
  }, []);

  // Create a new chapter and open it — compute idx synchronously to avoid race
  const handleNewChapter = useCallback(() => {
    const cur = sessions.find(s => s.id === currentId);
    if (!cur) return;
    const now      = new Date().toISOString();
    const maxIdx   = cur.chapters?.length
      ? Math.max(...cur.chapters.map(c => c.chap_idx))
      : 0;
    const maxOrder = cur.chapters?.length
      ? Math.max(...cur.chapters.map(c => c.order))
      : 0;
    const newIdx   = maxIdx + 1;
    const newChap  = {
      chap_idx: newIdx,
      title:    `Chapter ${newIdx}`,
      order:    maxOrder + 1,
      content:  '',
      created:  now,
      updated:  now,
    };
    setSessions(prev => prev.map(s =>
      s.id !== currentId ? s :
      { ...s, chapters: [...(s.chapters || []), newChap], updated: now }
    ));
    setCurrentChapterIdx(newIdx);
    setView('editor');
  }, [currentId, sessions]);

  // Merge metadata/cover/description updates back into session
  const handleUpdateSession = useCallback((updates) => {
    setSessions((prev) => prev.map((s) =>
      s.id === currentId
        ? { ...s, ...updates, updated: new Date().toISOString() }
        : s
    ));
  }, [currentId]);

  // Delete a chapter by chap_idx — guards against deleting the last chapter
  const handleDeleteChapter = useCallback((chapIdx) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== currentId) return s;
      if ((s.chapters || []).length <= 1) return s; // never delete the last one
      const chapters = (s.chapters || []).filter(c => c.chap_idx !== chapIdx);
      return { ...s, chapters, updated: new Date().toISOString() };
    }));
  }, [currentId]);

  // Move a chapter up (-1) or down (+1) in display order
  const handleMoveChapter = useCallback((chapIdx, direction) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== currentId) return s;
      const sorted = [...(s.chapters || [])].sort((a, b) => a.order - b.order);
      const pos = sorted.findIndex(c => c.chap_idx === chapIdx);
      const swapPos = pos + direction;
      if (swapPos < 0 || swapPos >= sorted.length) return s;
      // Swap order values
      const ordA = sorted[pos].order;
      const ordB = sorted[swapPos].order;
      const chapters = s.chapters.map(c => {
        if (c.chap_idx === sorted[pos].chap_idx)   return { ...c, order: ordB };
        if (c.chap_idx === sorted[swapPos].chap_idx) return { ...c, order: ordA };
        return c;
      });
      return { ...s, chapters, updated: new Date().toISOString() };
    }));
  }, [currentId]);

  const handleEditTitle = (t) => setSessions((s) => s.map((x) => x.id === currentId ? { ...x, title: t } : x));

  // Chapter-level content edit — updates the specific chapter and syncs session.content for chap 1
  const handleEditContent = (c) => setSessions((s) => s.map((x) => {
    if (x.id !== currentId) return x;
    const chapIdx = currentChapterIdx || 1;
    const now = new Date().toISOString();
    const chapters = (x.chapters || []).map((ch) =>
      ch.chap_idx === chapIdx
        ? { ...ch, content: c, updated: now }
        : ch
    );
    return {
      ...x,
      chapters,
      content: chapIdx === 1 ? c : x.content,
      preview: chapIdx === 1 ? c.replace(/<[^>]*>?/gm, "").slice(0, 60) + "..." : x.preview,
      updated: now,
    };
  }));

  // Chapter title edit
  const handleEditChapterTitle = useCallback((t) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== currentId) return s;
      const chapters = (s.chapters || []).map((ch) =>
        ch.chap_idx === currentChapterIdx ? { ...ch, title: t } : ch
      );
      return { ...s, chapters };
    }));
  }, [currentId, currentChapterIdx]);

  const filtered = sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()));
  const current  = sessions.find((s) => s.id === currentId) || null;

  // Build a virtual "current" for the Editor that has the right chapter's content
  const editorCurrent = React.useMemo(() => {
    if (!current || currentChapterIdx === null) return current;
    const chap = (current.chapters || []).find(c => c.chap_idx === currentChapterIdx);
    if (!chap) return current;
    return { ...current, content: chap.content, _editingChap: currentChapterIdx };
  }, [current, currentChapterIdx]);

  const currentChapter = React.useMemo(() => {
    if (!current || currentChapterIdx === null) return null;
    return (current.chapters || []).find(c => c.chap_idx === currentChapterIdx) || null;
  }, [current, currentChapterIdx]);

  // Sorted chapter list + adjacent indices for Editor prev/next navigation
  const sortedChapters = React.useMemo(() =>
    [...(current?.chapters || [])].sort((a, b) => a.order - b.order),
    [current?.chapters]
  );
  const currentChapterPos = React.useMemo(() =>
    sortedChapters.findIndex(c => c.chap_idx === currentChapterIdx),
    [sortedChapters, currentChapterIdx]
  );
  const prevChapIdx = currentChapterPos > 0
    ? sortedChapters[currentChapterPos - 1].chap_idx : null;
  const nextChapIdx = currentChapterPos < sortedChapters.length - 1
    ? sortedChapters[currentChapterPos + 1].chap_idx : null;

  // ── Export helpers ────────────────────────────────────────────────────────
  const handleExportTxt = useCallback(async () => {
    if (!current) return;
    const { exportAsTxt } = await import('./utils/storage');
    try { await exportAsTxt(current); } catch (e) { showError('exportTxt', e); }
  }, [current, showError]);

  const handleExportHtml = useCallback(async () => {
    if (!current) return;
    const { exportAsHtml } = await import('./utils/storage');
    try { await exportAsHtml(current); } catch (e) { showError('exportHtml', e); }
  }, [current, showError]);

  const handleExportEpub = useCallback(async () => {
    if (!current) return;
    const { exportAsEpub } = await import('./utils/storage');
    try { await exportAsEpub(current); } catch (e) { showError('exportEpub', e); }
  }, [current, showError]);

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

      {brokenFiles.length > 0 && (
        <FileIntegrityModal
          brokenSessions={brokenFiles}
          accentHex={customization.accentHex}
          onRemove={(id) => {
            setSessions(prev => prev.filter(s => s.id !== id));
            setBrokenFiles(prev => prev.filter(s => s.id !== id));
          }}
          onSaveAs={async (session) => {
            await saveAsBook(session);
            setBrokenFiles(prev => prev.filter(s => s.id !== session.id));
          }}
          onDismiss={() => setBrokenFiles([])}
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
        session={current}
        onDelete={(id) => {
          const updated = sessions.filter((s) => s.id !== id);
          setSessions(updated);
          if (id === currentId) {
            setCurrentId(null);
            setView("home");
          }
          localStorage.setItem("offlineWriterSessions", JSON.stringify(updated));
        }}
      />

      {view === "extension-page" && extPageState ? (
        <ExtensionPage
          extension={extPageState.extension}
          pageId={extPageState.pageId}
          session={extPageState.session ?? current}
          accentHex={customization.accentHex}
          onBack={() => { setView(extPageState._prevView ?? "home"); setExtPageState(null); }}
        />
      ) : view === "layout" ? (
        <EditLayout sessions={sessions} setSessions={setSessions} />
      ) : view === "home" ? (
        <HomeScreen
          sessions={sessions}
          accentHex={customization.accentHex}
          onNewBook={newBook}
          onSelect={handleSelect}
          onToggleSidebar={() => setDrawerOpen((v) => !v)}
          onToggleMenu={handleToggleMenu}
          burgerBtnRef={burgerBtnRef}
          current={current}
          goalWords={current?.streak?.goalWords ?? settings.dailyWordGoal ?? 300}
          onStreakUpdate={handleStreakUpdate}
          streakEnabled={current?.streak?.streakEnabled ?? settings.streakEnabled ?? true}
          onRefresh={async () => {
            try {
              const { listSavedBooks } = await import('./utils/storage');
              const books = await listSavedBooks();
              if (books.length) {
                setSessions(prev => {
                  const ids = new Set(prev.map(s => s.id));
                  return [...prev, ...books.filter(b => !ids.has(b.id))];
                });
              }
            } catch (e) { showError('refresh', e); }
          }}
        />
      ) : view === "book-dashboard" ? (
        <BookDashboard
          session={current}
          accentHex={customization.accentHex}
          onBack={() => setView("home")}
          onEditChapter={handleEditChapter}
          onNewChapter={handleNewChapter}
          onUpdateSession={handleUpdateSession}
          onDeleteChapter={handleDeleteChapter}
          onMoveChapter={handleMoveChapter}
          onExportTxt={handleExportTxt}
          onExportHtml={handleExportHtml}
          onExportEpub={handleExportEpub}
          onToggleMenu={handleToggleMenu}
          burgerBtnRef={burgerBtnRef}
          onToggleSidebar={() => setDrawerOpen((v) => !v)}
          goalWords={current?.streak?.goalWords ?? settings.dailyWordGoal ?? 300}
          onStreakUpdate={handleStreakUpdate}
          streakEnabled={current?.streak?.streakEnabled ?? settings.streakEnabled ?? true}
        />
      ) : (
        <Editor
          current={editorCurrent}
          onEditTitle={handleEditTitle}
          onEditContent={handleEditContent}
          onEditChapterTitle={currentChapterIdx ? handleEditChapterTitle : undefined}
          chapterTitle={currentChapter?.title ?? null}
          onBack={() => setView("book-dashboard")}
          onPrevChapter={prevChapIdx !== null ? () => handleEditChapter(prevChapIdx) : null}
          onNextChapter={nextChapIdx !== null ? () => handleEditChapter(nextChapIdx) : null}
          chapterPosition={currentChapterPos >= 0 ? { pos: currentChapterPos + 1, total: sortedChapters.length } : null}
          onToggleMenu={handleToggleMenu}
          accentHex={customization.accentHex}
          goalWords={current?.streak?.goalWords ?? settings.dailyWordGoal ?? 300}
          onStreakUpdate={handleStreakUpdate}
          onToggleSidebar={() => setDrawerOpen((v) => !v)}
          burgerBtnRef={burgerBtnRef}
          streakEnabled={current?.streak?.streakEnabled ?? settings.streakEnabled ?? true}
        />
      )}

      <BurgerMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        current={current}
        setSessions={setSessions}
        onOpenSettings={() => { setMenuOpen(false); setSettingsOpen(true); }}
        onOpen={(id) => { setCurrentId(id); setCurrentChapterIdx(null); setView("book-dashboard"); if (android) setDrawerOpen(false); }}
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
        sessions={sessions}
        onSessionChange={handleSessionChange}
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

/* ── Root export wrapped in ErrorProvider + ExtensionProvider ──────────────── */
export default function App() {
  const stored = JSON.parse(localStorage.getItem("writerCustomization") || "{}");
  const accentHex = stored.accentHex || "#5a00d9";

  return (
    <ErrorProvider accentHex={accentHex}>
      {/* ExtensionProvider wraps AppInner so every component in the tree can
          call useExtensions(). The onNavigate prop is wired inside AppInner
          via a ref so we don't need to lift state out of AppInner. */}
      <AppInnerWithExtensions />
    </ErrorProvider>
  );
}

/**
 * Thin wrapper that creates the navigate callback (which needs setView /
 * setExtPageState from AppInner's state) and passes it into ExtensionProvider.
 * We do this by keeping a stable ref that AppInner writes to on every render.
 */
function AppInnerWithExtensions() {
  const navigateRef = React.useRef(null);

  const onNavigate = React.useCallback((extension, pageId, session) => {
    navigateRef.current?.(extension, pageId, session);
  }, []);

  return (
    <ExtensionProvider onNavigate={onNavigate}>
      <AppInner navigateRef={navigateRef} />
    </ExtensionProvider>
  );
}
