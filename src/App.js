import { BackgroundRouter, DSIcons, injectDesignSystemFonts, ToastContainer, toast } from "./DesignSystem";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { APP_VERSION } from "./version";

import { App as CapApp } from '@capacitor/app';
import EditorToolbar from "./components/EditorToolbar";
import BurgerMenu from "./components/BurgerMenu";
import Sidebar from "./components/Sidebar";
import { Settings, DEFAULT_SETTINGS } from "./components/Settings";
import { CustomizationSlider, DEFAULT_CUSTOMIZATION } from "./components/CustomizationSlider";
import { FlameButton } from "./components/Streak";
import { isAndroid, isElectron } from "./utils/platform";
import { syncWidget, useWidgetDeepLink } from "./utils/widgetBridge";
import { ThemeProvider, injectThemeFonts, themeById, useTheme, applyAccent, applyFonts } from "./theme";
import { FontCustomizer } from "./components/FontCustomizer";
import { DEFAULT_FONTS } from "./utils/fontManager";
import TitleBar from "./components/TitleBar";
import { saveBook, openBookFromBytes, initStoragePermissions, initBookIndex, checkFileIntegrity, saveAsBook } from "./utils/storage";
import { fireHook, hookCount } from "./utils/sessionHooks";
import FileIntegrityModal from "./components/FileIntegrityModal";
import { ErrorProvider, useError } from "./utils/ErrorContext";
import HomeScreen from "./components/HomeScreen";
import BookDashboard from "./components/BookDashboard";
import InstallSheet from "./components/InstallSheet";
import ReadAloudBar from "./components/ReadAloudBar";
import BillingPage from "./components/BillingPage";
import { subscribeBilling } from "./utils/billingBus";
import { Onboarding, hasSeenOnboarding, UpdateOnboarding, hasSeenUpdate } from "./components/Onboarding";
import { ExtensionProvider } from "./utils/ExtensionContext";
import { setImportSessionHandler, setGetSessionsHandler } from "./utils/extensionRuntime";
import ExtensionPage from "./components/ExtensionPage";

// ── DesignSystem ─────────────────────────────────────────────────────────────
// BackgroundRouter replaces the old <Background /> import.
// It reads the active theme's backgroundFx config and renders the right
// background component (GradientBackground or GrainGradientBackground).
// Also inject fonts once at startup.

injectDesignSystemFonts();
// ─────────────────────────────────────────────────────────────────────────────

// ── Corruption-proof localStorage read (2C) ──────────────────────────────────
// A malformed writerSettings / writerCustomization value used to throw during
// the very first render, leaving the user on a permanent white screen. Parse
// defensively and merge over defaults so a bad value degrades gracefully.
function _safeParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback;
  }
}

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
    // Only overwrite the DOM when the incoming content actually differs from
    // what's already rendered. Blindly assigning innerHTML on every dependency
    // change wiped the caret position and the native undo stack (4B).
    if (editorRef.current && current?.content !== undefined) {
      const next = current.content || "";
      if (editorRef.current.innerHTML !== next) editorRef.current.innerHTML = next;
    }
  }, [current?.id, current?._editingChap]);

  const execCommand = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative", overflow: "hidden" }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--app-bg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {onBack && (
            <button onClick={onBack}
              style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 6, background: "none", cursor: "pointer", flexShrink: 0, transition: "background 0.15s", display: "flex", alignItems: "center", gap: 4, color: "var(--text-1)" }}
              aria-label="Back to book">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          {android && !onBack && (
            <button onClick={onToggleSidebar}
              style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 6, background: "none", cursor: "pointer", flexShrink: 0, transition: "background 0.15s" }}
              aria-label="Sessions">
              <DSIcons.Menu size={20} color="var(--text-1)" />
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
            style={{
              background: "transparent", color: "var(--text-1)", fontSize: 18, fontWeight: 600,
              outline: "none", borderBottom: "1px solid transparent",
              maxWidth: android ? "40vw" : "60vw", minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
            placeholder="Untitled"
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <FlameButton current={current} accentHex={accentHex} goalWords={goalWords} onStreakUpdate={onStreakUpdate} />
          <button
            ref={burgerBtnRef}
            onClick={onToggleMenu}
            style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 6, background: "none", cursor: "pointer", transition: "background 0.15s", color: "var(--text-1)" }}
          >
            <BurgerIcon style={{ color: "var(--text-1)" }} />
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
      <main style={{ position: "relative", flex: 1, overflowY: "auto", padding: android ? "0.75rem" : "1.5rem" }}>
        {current ? (
          <>
            <EditorToolbar execCommand={execCommand} accentHex={accentHex} session={current} editorRef={editorRef} />
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              style={{
                width: "100%", minHeight: 400, padding: 16, borderRadius: 8,
                boxShadow: "inset 0 2px 8px rgba(0,0,0,0.3)", outline: "none", lineHeight: 1.7,
                background: 'var(--editor-bg)', color: 'var(--text-1)',
                fontFamily: 'var(--font-editor)',
                marginTop: android ? "0.25rem" : "5rem",
                WebkitUserSelect: "text", userSelect: "text",
              }}
              onInput={(e) => onEditContent(e.currentTarget.innerHTML)}
            />
          </>
        ) : (
          <div style={{ color: "var(--text-4)", textAlign: "center", marginTop: 80, padding: "0 16px" }}>
            {android ? "Tap the menu above to open your sessions." : "Select or create a session to begin."}
          </div>
        )}
      </main>
    </div>
  );
}

/* ── App ────────────────────────────────────────────────────────────────── */
function AppInner({ navigateRef }) {
  const { showError } = useError();
  const { theme } = useTheme(); // ← active theme object; passed to BackgroundRouter
  const [sessions, setSessions]   = useState([]);
  // Flips true once the initial localStorage session load has settled, so the
  // startup-behavior effect fires exactly once with a known session set (even
  // when that set is empty) — the "startup does nothing" fix.
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    setGetSessionsHandler(() => sessions);
  }, [sessions]);

  const [search, setSearch]       = useState("");
  const [currentId, setCurrentId] = useState(null);
  const [menuOpen, setMenuOpen]   = useState(false);
  const [lastSaved]               = useState(null);
  const [view, setView]           = useState("home");
  const [extPageState, setExtPageState] = useState(null);

  useEffect(() => {
    setImportSessionHandler(async (base64) => {
      const { openBookFromBytes } = await import('./utils/storage');
      const session = await openBookFromBytes(base64, null);
      if (!session) throw new Error('Failed to decode imported .authbook');
      setSessions(prev => {
        const idx = prev.findIndex(s => s.id === session.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...prev[idx], ...session };
          return next;
        }
        return [session, ...prev];
      });
      return session;
    });
  }, []);

  useEffect(() => {
    if (!navigateRef) return;
    navigateRef.current = (extension, pageId, session) => {
      setExtPageState({ extension, pageId, session, _prevView: view });
      setView("extension-page");
    };
  });

  const [currentChapterIdx, setCurrentChapterIdx] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showUpdateOnboarding, setShowUpdateOnboarding] = useState(false);
  const [brokenFiles, setBrokenFiles] = useState([]);

  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [fontCustomizerOpen, setFontCustomizerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readAloudSession, setReadAloudSession] = useState(null);
  const [billingOpen, setBillingOpen] = useState(false);
  useEffect(() => subscribeBilling(() => setBillingOpen(true)), []);
  const [settings, setSettings] = useState(() => _safeParse("writerSettings", DEFAULT_SETTINGS));
  const [customization, setCustomization] = useState(() => _safeParse("writerCustomization", DEFAULT_CUSTOMIZATION));

  const burgerBtnRef  = useRef(null);
  const autoSaveTimer = useRef(null);
  const android = isAndroid();

  // Keep var(--accent) in sync with the user's chosen accent colour (see
  // ThemeBase.applyAccent). Without this, every var()-reading component showed
  // the theme's default accent while prop-reading ones showed the custom one.
  useEffect(() => { applyAccent(customization.accentHex); }, [customization.accentHex]);

  // Desktop shell: flag Electron so the custom title bar shows and the app-root
  // height accounts for it (see index.css .is-electron / TitleBar.jsx).
  useEffect(() => {
    if (!isElectron()) return;
    document.documentElement.classList.add('is-electron');
    document.documentElement.style.setProperty('--titlebar-h', '36px');
    return () => {
      document.documentElement.classList.remove('is-electron');
      document.documentElement.style.setProperty('--titlebar-h', '0px');
    };
  }, []);

  // Apply the user's chosen fonts (body / editor / headings + uploaded fonts).
  // Like applyAccent, this writes a CSS-var override that outranks the theme's
  // default fonts and is re-asserted after every theme switch.
  useEffect(() => { applyFonts(customization.fonts ?? DEFAULT_FONTS); }, [customization.fonts]);

  // ── Swipe-from-left-edge to open drawer (Android only) ──────────────────
  useEffect(() => {
    if (!android) return;
    const EDGE_ZONE = 22, MIN_SWIPE_X = 60, MAX_DRIFT_Y = 50;
    let startX = null, startY = null, tracking = false;
    const onStart = (e) => { const t = e.touches[0]; if (t.clientX <= EDGE_ZONE) { startX = t.clientX; startY = t.clientY; tracking = true; } };
    const onMove  = (e) => { if (!tracking) return; const t = e.touches[0]; if (Math.abs(t.clientY - startY) > MAX_DRIFT_Y) { tracking = false; return; } if (t.clientX - startX > MIN_SWIPE_X) { tracking = false; setDrawerOpen(true); } };
    const onEnd   = () => { tracking = false; };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove",  onMove,  { passive: true });
    document.addEventListener("touchend",   onEnd,   { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove",  onMove);
      document.removeEventListener("touchend",   onEnd);
    };
  }, [android]);

  // ── Android hardware back button ─────────────────────────────────────────
  useEffect(() => {
    if (!android) return;
    let listener;
    CapApp.addListener('backButton', () => {
      if (menuOpen)       { setMenuOpen(false);        return; }
      if (drawerOpen)     { setDrawerOpen(false);      return; }
      if (settingsOpen)   { setSettingsOpen(false);    return; }
      if (customizerOpen) { setCustomizerOpen(false);  return; }
      if (view === 'extension-page') { setView(extPageState?._prevView ?? 'home'); setExtPageState(null); return; }
      if (view === 'editor')         { setView('book-dashboard'); return; }
      if (view === 'book-dashboard') { setView('home');           return; }
      CapApp.minimizeApp();
    }).then(h => { listener = h; });
    return () => { listener?.remove(); };
  }, [android, menuOpen, drawerOpen, settingsOpen, customizerOpen, view]);

  // ── Load sessions ────────────────────────────────────────────────────────
  useEffect(() => {
    hasSeenOnboarding().then((seen) => {
      if (!seen) setShowOnboarding(true);
      else hasSeenUpdate().then((seenUpdate) => { if (!seenUpdate) setShowUpdateOnboarding(true); });
    });
    const saved = localStorage.getItem("offlineWriterSessions");
    const savedId = localStorage.getItem("offlineWriterCurrentId");
    if (saved) { try { const p = JSON.parse(saved); if (Array.isArray(p)) { setSessions(p); if (savedId) setCurrentId(savedId); } } catch { /* corrupt store — start clean */ } }
    if (window.electron) {
      const openBooks = localStorage.getItem("openBooks");
      if (openBooks) {
        try {
          const books = JSON.parse(openBooks);
          // Only ask the main process to restore books that actually live on
          // disk. Unsaved drafts have no filePath — they're restored from the
          // localStorage mirror above; sending them to restoreBooks used to
          // produce a scary "file not found" alert for every unsaved book.
          if (Array.isArray(books) && window.electron?.restoreBooks) {
            window.electron.restoreBooks(books.filter((b) => b && b.filePath));
          }
        }
        catch (e) { console.error(e); }
      }
    }
    if (android) {
      initStoragePermissions();
      initBookIndex();
      const saved2 = localStorage.getItem("offlineWriterSessions");
      if (saved2) { try { const parsed = JSON.parse(saved2); if (Array.isArray(parsed)) checkFileIntegrity(parsed).then(broken => { if (broken.length > 0) setBrokenFiles(broken); }); } catch { /* ignore */ } }
    }
    // The synchronous session load is done — let the startup-behavior effect run.
    setBootReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Startup behavior ─────────────────────────────────────────────────────
  // Runs once, after the initial session load settles (bootReady) — NOT gated
  // on there being sessions, so 'blank'/'home'/'none' work on a fresh install
  // too. Each mode also drives the view, so the chosen book actually opens
  // (previously 'last'/'blank' set the id but left you on the home screen).
  const startupApplied = useRef(false);
  useEffect(() => {
    if (startupApplied.current || !bootReady) return;
    startupApplied.current = true;
    const behavior = settings?.startupBehavior ?? "last";

    const openBook = (id) => { setCurrentId(id); setCurrentChapterIdx(null); setView("book-dashboard"); };

    if (behavior === "last") {
      const savedId = localStorage.getItem("offlineWriterCurrentId");
      if (savedId && sessions.some((s) => s.id === savedId)) openBook(savedId);
      else if (sessions.length > 0) openBook(sessions[0].id);
      else { setCurrentId(null); setView("home"); }
    } else if (behavior === "blank") {
      // Reuse an existing pristine (empty, untitled) book instead of stacking a
      // fresh Untitled Book on every launch — the "blank keeps piling up" fix.
      const isPristine = (s) =>
        s.type === "book" && (s.title === "Untitled Book" || !s.title) &&
        !(s.content && s.content.replace(/<[^>]*>/g, "").trim()) &&
        (s.chapters || []).every((c) => !(c.content && c.content.replace(/<[^>]*>/g, "").trim()));
      const existing = sessions.find(isPristine);
      if (existing) { openBook(existing.id); return; }
      const now = new Date().toISOString();
      const blank = {
        id: Date.now().toString(), title: "Untitled Book", content: "", type: "book",
        created: now, updated: now,
        chapters: [{ chap_idx: 1, title: "Chapter 1", order: 1, content: "", created: now, updated: now }],
        authors: [], devices: [], genre: "", description: "", language: "en", publisher: "", isbn: "",
      };
      setSessions((prev) => [blank, ...prev]);
      openBook(blank.id);
    } else { // 'home' (and legacy 'none') — land on the home screen
      setCurrentId(null);
      setView("home");
    }
  }, [bootReady, sessions, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist sessions. Cover images live in the .authbook files on disk; keeping
  // their base64 in the localStorage mirror (N8) bloated it and could exceed the
  // ~5 MB quota, throwing here and silently killing all persistence. Strip heavy
  // fields from the mirror and fail soft.
  useEffect(() => {
    if (sessions.length === 0) return;
    const slimForMirror = sessions.map(({ coverBase64, ...rest }) => rest);
    try {
      localStorage.setItem("offlineWriterSessions", JSON.stringify(slimForMirror));
    } catch (e) {
      // Quota exceeded even after stripping covers — drop content bodies too.
      try {
        const minimal = sessions.map(s => ({ id: s.id, title: s.title, filePath: s.filePath, type: s.type, updated: s.updated }));
        localStorage.setItem("offlineWriterSessions", JSON.stringify(minimal));
      } catch { /* give up on the mirror; disk files remain the source of truth */ }
      console.warn('[AuthNo] session mirror trimmed — localStorage quota reached');
    }
    // The native authno_books.json is written by WidgetDataPlugin on syncWidget;
    // no longer double-written here (was a redundant racing writer, N17).
  }, [sessions]);

  // Widget sync, debounced. This previously ran on EVERY sessions change —
  // i.e. every keystroke — hammering the native bridge and disk (3G).
  const widgetSyncTimer = useRef(null);
  useEffect(() => {
    clearTimeout(widgetSyncTimer.current);
    widgetSyncTimer.current = setTimeout(() => syncWidget(sessions, customization.accentHex), 1500);
    return () => clearTimeout(widgetSyncTimer.current);
  }, [sessions, customization.accentHex]);
  useWidgetDeepLink((bookId) => { handleSelect(bookId); });
  useEffect(() => { if (currentId) localStorage.setItem("offlineWriterCurrentId", currentId); }, [currentId]);
  useEffect(() => { if (window.electron) { try { localStorage.setItem("openBooks", JSON.stringify(sessions.map(({ coverBase64, ...r }) => r))); } catch { /* quota */ } } }, [sessions]);

  useEffect(() => {
    const handler = (e) => {
      if (e.data.type === "restored-books") {
        Promise.all(e.data.books.map(({ base64, filePath }) => openBookFromBytes(base64, filePath).catch(() => null))).then((decoded) => {
          const valid = decoded.filter(Boolean);
          if (!valid.length) return;
          setSessions((prev) => { const fresh = valid.filter((b) => !prev.some((s) => s.filePath === b.filePath)); return [...fresh, ...prev]; });
        });
      }
      if (e.data.type === "missing-books" && e.data.messages?.length) {
        // One calm toast instead of a modal alert() per missing file.
        toast(`${e.data.messages.length} book file${e.data.messages.length > 1 ? 's' : ''} could not be found on disk`, { variant: 'warning', duration: 5000 });
        e.data.messages.forEach((m) => console.warn('[AuthNo restore]', m));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // U9: extensions can associate a book with a remote/external id (e.g. a
  // published-post id). Persisted on the session → saved into the .authbook
  // META → available to templates as {externalId}.
  useEffect(() => {
    const onSetExternalId = (e) => {
      const { bookId, externalId } = e.detail ?? {};
      if (!bookId) return;
      setSessions((prev) => prev.map((s) => (s.id === bookId ? { ...s, externalId, updated: new Date().toISOString() } : s)));
    };
    window.addEventListener('authno-set-external-id', onSetExternalId);
    return () => window.removeEventListener('authno-set-external-id', onSetExternalId);
  }, []);

  // Electron: file opened via OS double-click, both cold start and while running.
  // Reads bytes and decodes through the shared path (binary format + RS repair),
  // matching Android. Registered once; earlier code re-registered per keystroke
  // and leaked listeners, producing duplicate books.
  useEffect(() => {
    if (!window.electron) return;
    let dispose;
    const onDesktopBytes = async (e) => {
      const { base64, uri } = e.detail || {};
      if (!base64) return;
      try {
        const { openBookFromBytes } = await import('./utils/storage');
        const session = await openBookFromBytes(base64, uri);
        if (!session) return;
        if (session._recovery) toast(`"${session.title || 'Book'}" had file damage and was repaired automatically`, { variant: 'warning', duration: 5000 });
        setSessions((prev) => {
          if (prev.some((s) => s.id === session.id || (session.filePath && s.filePath === session.filePath))) {
            return prev.map((s) => (s.id === session.id || s.filePath === session.filePath ? { ...s, ...session } : s));
          }
          return [session, ...prev];
        });
        setCurrentId(session.id);
      } catch (err) { toast('Could not open that .authbook file — it may be corrupt', { variant: 'danger', duration: 5000 }); console.error(err); }
    };
    const onDesktopErr = () => toast('That book file could not be opened', { variant: 'danger', duration: 4000 });
    window.addEventListener('open-authbook-desktop-bytes', onDesktopBytes);
    window.addEventListener('open-authbook-desktop-error', onDesktopErr);
    if (window.electron.onOpenAuthBook) dispose = window.electron.onOpenAuthBook(() => {});

    // Cold start: pick up a file the app was launched with.
    if (window.electron.getInitialFile) {
      window.electron.getInitialFile().then((f) => {
        if (f?.base64) window.dispatchEvent(new CustomEvent('open-authbook-desktop-bytes', { detail: { base64: f.base64, uri: f.filePath } }));
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener('open-authbook-desktop-bytes', onDesktopBytes);
      window.removeEventListener('open-authbook-desktop-error', onDesktopErr);
      if (typeof dispose === 'function') dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const bytesHandler = async (e) => {
      const { base64, uri } = e.detail || {};
      if (!base64) return;
      try {
        const session = await openBookFromBytes(base64, uri);
        if (!session) return;
        if (session._recovery) {
          toast(`"${session.title || 'Book'}" had file damage and was repaired automatically`, { variant: 'warning', duration: 5000 });
        }
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === session.id || (session.filePath && s.filePath === session.filePath));
          setCurrentId(session.id);
          if (idx === -1) return [session, ...prev];
          const next = [...prev]; next[idx] = { ...next[idx], ...session }; return next;
        });
      } catch (err) { toast('Could not open that .authbook file — it may be corrupt beyond repair', { variant: 'danger', duration: 5500 }); console.error(err); }
    };
    const legacyHandler = (e) => {
      const book = e.detail;
      if (!book) return;
      setSessions((prev) => {
        if (prev.some((s) => s.id === book.id)) return prev;
        const nb = { ...book, id: book.id || Date.now().toString(), preview: (book.content || "").replace(/<[^>]*>?/gm, "").slice(0, 60) + "..." };
        setCurrentId(nb.id); return [nb, ...prev];
      });
    };
    const errHandler = () => toast("Could not open that .authbook file — it may be corrupt", { variant: 'danger', duration: 5000 });
    window.addEventListener("open-authbook-android-bytes", bytesHandler);
    window.addEventListener("open-authbook-android",       legacyHandler);
    window.addEventListener("open-authbook-android-error", errHandler);
    if (android) {
      (async () => {
        try {
          const { registerPlugin } = await import('@capacitor/core');
          const plugin = registerPlugin('AuthnoFilePicker');
          const result = await plugin.getPendingIntent();
          if (result?.hasPending && result.base64) window.dispatchEvent(new CustomEvent('open-authbook-android-bytes', { detail: { base64: result.base64, uri: result.uri || '' } }));
        } catch (_) { /* web build — ignore */ }
      })();
    }
    return () => {
      window.removeEventListener("open-authbook-android-bytes", bytesHandler);
      window.removeEventListener("open-authbook-android",       legacyHandler);
      window.removeEventListener("open-authbook-android-error", errHandler);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Android autosave with dirty tracking. The old loop saved EVERY open book —
  // and fired every extension's onSave hook for every book — on each 2-second
  // debounce, even if only one keystroke happened in one chapter. That meant
  // constant SAF writes, wasted battery, and extensions spammed with change
  // events. Track a per-session fingerprint and only touch what changed.
  const savedFingerprints = useRef(new Map());
  useEffect(() => {
    if (!android || sessions.length === 0) return;
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      for (const s of sessions) {
        const fp = `${s.updated ?? ''}|${s.title ?? ''}|${(s.chapters || []).length}`;
        if (savedFingerprints.current.get(s.id) === fp) continue; // unchanged
        if (hookCount('onSave') > 0) await fireHook('onSave', { session: s, trigger: 'change' });
        if (!s.filePath?.startsWith('content://')) { savedFingerprints.current.set(s.id, fp); continue; }
        try {
          const result = await saveBook(s);
          if (result?.staleUri) { setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, filePath: null } : x))); continue; }
          if (result?.filePath && result.filePath !== s.filePath) setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, filePath: result.filePath } : x)));
          savedFingerprints.current.set(s.id, fp);
          if (hookCount('onSave') > 0) { const saved = result?.filePath ? { ...s, filePath: result.filePath } : s; await fireHook('onSave', { session: saved, trigger: 'autosave' }); }
        } catch (err) { console.error('[AuthNo AutoSave]', err); }
      }
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

  const handleSessionChange = (id, patch) => setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const handleSaveCustomization = (patch) => { setCustomization(patch); localStorage.setItem("writerCustomization", JSON.stringify(patch)); };

  const handleStreakUpdate = useCallback((updatedStreak) => {
    setSessions((prev) => prev.map((s) =>
      s.id === currentId ? { ...s, streak: { ...(s.streak ?? {}), ...updatedStreak, log: { ...(s.streak?.log ?? {}), ...(updatedStreak.log ?? {}) }, dailyBaseline: { ...(s.streak?.dailyBaseline ?? {}), ...(updatedStreak.dailyBaseline ?? {}) } }} : s
    ));
  }, [currentId]);

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const newBook = () => {
    const id = Date.now().toString(), now = new Date().toISOString();
    const firstChap = { chap_idx: 1, title: "Chapter 1", order: 1, content: "", created: now, updated: now };
    setSessions((s) => [{ id, title: "Untitled Book", preview: "", content: "", type: "book", created: now, updated: now, chapters: [firstChap], authors: [], devices: [], genre: "", description: "", language: "en", publisher: "", isbn: "" }, ...s]);
    setCurrentId(id); setCurrentChapterIdx(null); setView("book-dashboard");
    if (android) setDrawerOpen(false);
  };
  const newStoryboard = () => {
    // Storyboards are intentionally deferred: there is no storyboard editor yet,
    // so creating one previously produced an un-openable session. Route the
    // button to a normal new book until the storyboard workflow ships.
    newBook();
  };
  const handleSelect = (id, sessionObj) => {
    if (sessionObj) setSessions((prev) => prev.some((s) => s.id === sessionObj.id) ? prev : [sessionObj, ...prev]);
    setCurrentId(id); setCurrentChapterIdx(null); setView("book-dashboard");
    if (android) setDrawerOpen(false);
  };
  const handleEditChapter = useCallback((chapIdx) => { setCurrentChapterIdx(chapIdx); setView("editor"); }, []);
  const handleNewChapter = useCallback(() => {
    const cur = sessions.find(s => s.id === currentId);
    if (!cur) return;
    const now = new Date().toISOString();
    const maxIdx   = cur.chapters?.length ? Math.max(...cur.chapters.map(c => c.chap_idx)) : 0;
    const maxOrder = cur.chapters?.length ? Math.max(...cur.chapters.map(c => c.order))    : 0;
    const newIdx   = maxIdx + 1;
    const newChap  = { chap_idx: newIdx, title: `Chapter ${newIdx}`, order: maxOrder + 1, content: '', created: now, updated: now };
    setSessions(prev => prev.map(s => s.id !== currentId ? s : { ...s, chapters: [...(s.chapters || []), newChap], updated: now }));
    setCurrentChapterIdx(newIdx); setView('editor');
  }, [currentId, sessions]);
  const handleUpdateSession = useCallback((updates) => {
    setSessions((prev) => prev.map((s) => s.id === currentId ? { ...s, ...updates, updated: new Date().toISOString() } : s));
  }, [currentId]);
  const handleDeleteChapter = useCallback((chapIdx) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== currentId) return s;
      if ((s.chapters || []).length <= 1) return s;
      const chapters = (s.chapters || []).filter(c => c.chap_idx !== chapIdx);
      return { ...s, chapters, updated: new Date().toISOString() };
    }));
  }, [currentId]);
  const handleMoveChapter = useCallback((chapIdx, direction) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== currentId) return s;
      const sorted = [...(s.chapters || [])].sort((a, b) => a.order - b.order);
      const pos = sorted.findIndex(c => c.chap_idx === chapIdx);
      const swapPos = pos + direction;
      if (swapPos < 0 || swapPos >= sorted.length) return s;
      const ordA = sorted[pos].order, ordB = sorted[swapPos].order;
      const chapters = s.chapters.map(c => {
        if (c.chap_idx === sorted[pos].chap_idx)    return { ...c, order: ordB };
        if (c.chap_idx === sorted[swapPos].chap_idx) return { ...c, order: ordA };
        return c;
      });
      return { ...s, chapters, updated: new Date().toISOString() };
    }));
  }, [currentId]);
  const handleEditTitle = (t) => setSessions((s) => s.map((x) => x.id === currentId ? { ...x, title: t } : x));
  const handleEditContent = (c) => setSessions((s) => s.map((x) => {
    if (x.id !== currentId) return x;
    const chapIdx = currentChapterIdx || 1;
    const now = new Date().toISOString();
    const chapters = (x.chapters || []).map((ch) => ch.chap_idx === chapIdx ? { ...ch, content: c, updated: now } : ch);
    return { ...x, chapters, content: chapIdx === 1 ? c : x.content, preview: chapIdx === 1 ? c.replace(/<[^>]*>?/gm, "").slice(0, 60) + "..." : x.preview, updated: now };
  }));
  const handleEditChapterTitle = useCallback((t) => {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== currentId) return s;
      const chapters = (s.chapters || []).map((ch) => ch.chap_idx === currentChapterIdx ? { ...ch, title: t } : ch);
      return { ...s, chapters };
    }));
  }, [currentId, currentChapterIdx]);

  const filtered = sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()));
  const current  = sessions.find((s) => s.id === currentId) || null;

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

  const sortedChapters = React.useMemo(() => [...(current?.chapters || [])].sort((a, b) => a.order - b.order), [current?.chapters]);
  const currentChapterPos = React.useMemo(() => sortedChapters.findIndex(c => c.chap_idx === currentChapterIdx), [sortedChapters, currentChapterIdx]);
  const prevChapIdx = currentChapterPos > 0 ? sortedChapters[currentChapterPos - 1].chap_idx : null;
  const nextChapIdx = currentChapterPos < sortedChapters.length - 1 ? sortedChapters[currentChapterPos + 1].chap_idx : null;

  // ── Export helpers ────────────────────────────────────────────────────────
  const handleExportTxt  = useCallback(async () => { if (!current) return; const { exportAsTxt }  = await import('./utils/storage'); try { await exportAsTxt(current);  } catch (e) { showError('exportTxt',  e); } }, [current, showError]);
  const handleExportHtml = useCallback(async () => { if (!current) return; const { exportAsHtml } = await import('./utils/storage'); try { await exportAsHtml(current); } catch (e) { showError('exportHtml', e); } }, [current, showError]);
  const handleExportEpub = useCallback(async () => { if (!current) return; const { exportAsEpub } = await import('./utils/storage'); try { await exportAsEpub(current); } catch (e) { showError('exportEpub', e); } }, [current, showError]);
  const handleExportPdf  = useCallback(async () => { if (!current) return; const { exportAsPdf }  = await import('./utils/storage'); try { await exportAsPdf(current); } catch (e) { showError('exportPdf', e); } }, [current, showError]);

  const handleToggleMenu = () => {
    if (burgerBtnRef.current) {
      const r = burgerBtnRef.current.getBoundingClientRect();
      document.documentElement.style.setProperty("--bm-top",   `${r.bottom + 8}px`);
      document.documentElement.style.setProperty("--bm-right",  `${window.innerWidth - r.right}px`);
    }
    setMenuOpen((v) => !v);
  };

  return (
    <>
    <TitleBar />
    <div className="app-root flex relative" style={{ color: "var(--text-1)" }}>
      {/* Light/dark is owned entirely by the active theme (applyTheme toggles
          .light-mode from theme.meta.isDark). The old per-render `settings.lightMode`
          class here fought the theme engine and produced half-applied light mode (B2). */}
      <ToastContainer position="bottom-center" />
      <InstallSheet accentHex={customization.accentHex} />
      {billingOpen && (
        <BillingPage accentHex={customization.accentHex} onClose={() => setBillingOpen(false)} />
      )}
      {readAloudSession && (
        <ReadAloudBar
          session={readAloudSession}
          accentHex={customization.accentHex}
          onClose={() => setReadAloudSession(null)}
        />
      )}
      {showOnboarding && <Onboarding accentHex={customization.accentHex} onDone={() => setShowOnboarding(false)} />}
      {!showOnboarding && showUpdateOnboarding && <UpdateOnboarding accentHex={customization.accentHex} onDone={() => setShowUpdateOnboarding(false)} />}

      {brokenFiles.length > 0 && (
        <FileIntegrityModal
          brokenSessions={brokenFiles} accentHex={customization.accentHex}
          onRemove={(id) => { setSessions(prev => prev.filter(s => s.id !== id)); setBrokenFiles(prev => prev.filter(s => s.id !== id)); }}
          onSaveAs={async (session) => { await saveAsBook(session); setBrokenFiles(prev => prev.filter(s => s.id !== session.id)); }}
          onDismiss={() => setBrokenFiles([])}
        />
      )}

      {/*
        ── BackgroundRouter ────────────────────────────────────────────────────
        Replaces the old <Background /> component.
        Reads theme.backgroundFx to decide which background type to render:
          - type: 'gradient'  → animated blob background (dark / light / OLED)
          - type: 'grain'     → grainy static diagonal gradient (sepia / paper)
          - type: 'none'      → no background (CSS vars handle colour only)
        When theme.backgroundFx.type is absent, falls back to gradientEnabled toggle.
        ───────────────────────────────────────────────────────────────────────
      */}
      <BackgroundRouter
        accentHex={customization.accentHex}
        backgroundEffect={settings.backgroundEffect}
        gradientEnabled={settings.enableGradient}
        customization={customization}
        theme={theme}
      />

      {/* Android drawer backdrop */}
      {android && drawerOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 40 }} onClick={() => setDrawerOpen(false)} onTouchStart={() => setDrawerOpen(false)} />
      )}

      <Sidebar
        sessions={filtered} onNewBook={newBook} onNewStoryboard={newStoryboard}
        search={search} setSessions={setSessions} setSearch={setSearch}
        onSelect={handleSelect} currentId={currentId} setView={setView}
        accentHex={customization.accentHex}
        isDrawerOpen={drawerOpen} onDrawerClose={() => setDrawerOpen(false)}
        session={current}
        onDelete={(id) => {
          const updated = sessions.filter((s) => s.id !== id);
          setSessions(updated);
          if (id === currentId) { setCurrentId(null); setView("home"); }
          localStorage.setItem("offlineWriterSessions", JSON.stringify(updated));
        }}
      />

      {view === "extension-page" && extPageState ? (
        <ExtensionPage extension={extPageState.extension} pageId={extPageState.pageId} session={extPageState.session ?? editorCurrent ?? current} accentHex={customization.accentHex} onBack={() => { setView(extPageState._prevView ?? "home"); setExtPageState(null); }} />
      ) : view === "home" ? (
        <HomeScreen
          sessions={sessions} accentHex={customization.accentHex}
          onNewBook={newBook} onSelect={handleSelect}
          onToggleSidebar={() => setDrawerOpen((v) => !v)}
          onToggleMenu={handleToggleMenu} burgerBtnRef={burgerBtnRef}
          current={current} goalWords={current?.streak?.goalWords ?? settings.dailyWordGoal ?? 300}
          onStreakUpdate={handleStreakUpdate} streakEnabled={current?.streak?.streakEnabled ?? settings.streakEnabled ?? true}
          onRefresh={async () => {
            try { const { listSavedBooks } = await import('./utils/storage'); const books = await listSavedBooks(); if (books.length) setSessions(prev => { const ids = new Set(prev.map(s => s.id)); return [...prev, ...books.filter(b => !ids.has(b.id))]; }); }
            catch (e) { showError('refresh', e); }
          }}
          onReadAloud={() => { if (current) setReadAloudSession(current); else toast('Open a book first to read it aloud', { variant: 'info' }); }}
          onOpenExtensions={() => { setDrawerOpen(true); }}
        />
      ) : view === "book-dashboard" ? (
        <BookDashboard
          session={current} accentHex={customization.accentHex}
          onBack={() => setView("home")} onEditChapter={handleEditChapter}
          onNewChapter={handleNewChapter} onUpdateSession={handleUpdateSession}
          onDeleteChapter={handleDeleteChapter} onMoveChapter={handleMoveChapter}
          onExportTxt={handleExportTxt} onExportHtml={handleExportHtml} onExportEpub={handleExportEpub} onExportPdf={handleExportPdf}
          onReadAloud={() => current && setReadAloudSession(current)}
          onToggleMenu={handleToggleMenu} burgerBtnRef={burgerBtnRef}
          onToggleSidebar={() => setDrawerOpen((v) => !v)}
          goalWords={current?.streak?.goalWords ?? settings.dailyWordGoal ?? 300}
          onStreakUpdate={handleStreakUpdate} streakEnabled={current?.streak?.streakEnabled ?? settings.streakEnabled ?? true}
        />
      ) : (
        <Editor
          current={editorCurrent} onEditTitle={handleEditTitle} onEditContent={handleEditContent}
          onEditChapterTitle={currentChapterIdx ? handleEditChapterTitle : undefined}
          chapterTitle={currentChapter?.title ?? null}
          onBack={() => setView("book-dashboard")}
          onPrevChapter={prevChapIdx !== null ? () => handleEditChapter(prevChapIdx) : null}
          onNextChapter={nextChapIdx !== null ? () => handleEditChapter(nextChapIdx) : null}
          chapterPosition={currentChapterPos >= 0 ? { pos: currentChapterPos + 1, total: sortedChapters.length } : null}
          onToggleMenu={handleToggleMenu} accentHex={customization.accentHex}
          goalWords={current?.streak?.goalWords ?? settings.dailyWordGoal ?? 300}
          onStreakUpdate={handleStreakUpdate}
          onToggleSidebar={() => setDrawerOpen((v) => !v)}
          burgerBtnRef={burgerBtnRef} streakEnabled={current?.streak?.streakEnabled ?? settings.streakEnabled ?? true}
        />
      )}

      <BurgerMenu
        open={menuOpen} onClose={() => setMenuOpen(false)} current={current}
        setSessions={setSessions}
        onOpenSettings={() => { setMenuOpen(false); setSettingsOpen(true); }}
        onOpen={(id) => { setCurrentId(id); setCurrentChapterIdx(null); setView("book-dashboard"); if (android) setDrawerOpen(false); }}
        accentHex={customization.accentHex} anchorRef={burgerBtnRef}
      />

      <Settings
        isOpen={settingsOpen} onClose={() => setSettingsOpen(false)}
        settings={settings} onSave={handleSaveSettings}
        onOpenCustomizer={() => setCustomizerOpen(true)}
        onOpenFontCustomizer={() => setFontCustomizerOpen(true)}
        onClearSessions={() => { setSessions([]); localStorage.removeItem("offlineWriterSessions"); }}
        sessions={sessions} onSessionChange={handleSessionChange}
      />

      <CustomizationSlider
        isOpen={customizerOpen} onClose={() => setCustomizerOpen(false)}
        customization={customization} onSave={handleSaveCustomization}
      />

      <FontCustomizer
        isOpen={fontCustomizerOpen} onClose={() => setFontCustomizerOpen(false)}
        fonts={customization.fonts ?? DEFAULT_FONTS} accentHex={customization.accentHex}
        onSave={(nextFonts) => handleSaveCustomization({ ...customization, fonts: nextFonts })}
      />

      <div style={{ position: "fixed", bottom: 16, right: 16, display: "flex", alignItems: "center", gap: 12, color: "var(--text-4)", fontSize: 14, userSelect: "none", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {lastSaved && <span style={{ opacity: 0.8 }}>Saved ✓ ({lastSaved})</span>}
      </div>
    </div>
    </>
  );
}

/* ── Root export wrapped in ErrorProvider + ExtensionProvider ──────────────── */
const _savedThemeId = (() => { try { return localStorage.getItem('authno_theme_id') ?? 'dark-default'; } catch { return 'dark-default'; } })();
const _initialTheme = themeById(_savedThemeId);
injectThemeFonts(_initialTheme);

// N12: stamp the real running version so ErrorLogger bug reports stop claiming
// a hardcoded stale build. src/version.js is regenerated from package.json by
// scripts/sync-version.js on every `npm start` / `npm run build` (prestart/prebuild).
try { localStorage.setItem('authno_version', APP_VERSION); } catch { /* ignore */ }

export default function App() {
  const stored = JSON.parse(localStorage.getItem("writerCustomization") || "{}");
  const accentHex = stored.accentHex || "#5a00d9";
  return (
    <ThemeProvider initialTheme={_initialTheme}>
      <ErrorProvider accentHex={accentHex}>
        <AppInnerWithExtensions />
      </ErrorProvider>
    </ThemeProvider>
  );
}

function AppInnerWithExtensions() {
  const navigateRef = React.useRef(null);
  const onNavigate = React.useCallback((extension, pageId, session) => { navigateRef.current?.(extension, pageId, session); }, []);
  return (
    <ExtensionProvider onNavigate={onNavigate}>
      <AppInner navigateRef={navigateRef} />
    </ExtensionProvider>
  );
}
