import { BackgroundRouter, DSIcons, injectDesignSystemFonts, ToastContainer, toast } from "./DesignSystem";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { APP_VERSION } from "./version";

import { App as CapApp } from '@capacitor/app';
import EditorToolbar from "./components/EditorToolbar";
import BurgerMenu from "./components/BurgerMenu";
import Sidebar from "./components/Sidebar";
import { Settings, DEFAULT_SETTINGS } from "./components/Settings";
import { CustomizationSlider, DEFAULT_CUSTOMIZATION } from "./components/CustomizationSlider";
import { FlameButton } from "./components/Streak";
import { isAndroid, isElectron } from "./utils/platform";
import { DEFAULT_WORD_GOAL } from "./components/constants";
import { syncWidget, useWidgetDeepLink } from "./utils/widgetBridge";
import { ThemeProvider, injectThemeFonts, themeById, useTheme, applyAccent, applyFonts } from "./theme";
import { FontCustomizer } from "./components/FontCustomizer";
import { DEFAULT_FONTS } from "./utils/fontManager";
import TitleBar from "./components/TitleBar";
import ChapterInfoModal from "./components/ChapterInfoModal";
import ShareImportSheet from "./components/ShareImportSheet";
import { saveResumePoint, getResumePoint, getLastResume, caretOffsetIn, restoreCaretIn } from "./utils/resumeState";
import { updateAppShortcuts } from "./utils/appShortcuts";
import ThreadsPanel, { ThreadsTilesDesktop } from "./components/ThreadsPanel";
import { ThreadSelectionLayer, ThreadGutter, flashAnchor } from "./components/ThreadLayer";
import { getThreadsData, stripAnchorsFromChapters, stripAnchorEls, locateAnchors } from "./utils/threads";
import { hapticSelect, setHapticsEnabled } from "./utils/haptics";
import { previewOf, sanitizePastedHtml } from "./utils/editorFormat";
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

/* ── Editor ─────────────────────────────────────────────────────────────── */
function Editor({
  current, onEditTitle, onEditContent,
  onToggleMenu, accentHex, goalWords, onStreakUpdate,
  onToggleSidebar, burgerBtnRef,
  chapterTitle, onEditChapterTitle,
  onBack, onPrevChapter, onNextChapter, chapterPosition,
  fullSession, onUpdateSession, onOpenChapter,
  customFonts,
  resumePoint, onResumeConsumed,
}) {
  const [title, setTitle] = useState(chapterTitle ?? current?.title ?? "");
  const editorRef = useRef(null);
  const mainRef = useRef(null);
  const android = isAndroid();

  // ── Threads (plotlines / character arcs — docs/threads-spec.md) ──────────
  const [threadsOpen, setThreadsOpen] = useState(false);
  // Hyprland-style tiling (desktop): open threads are an ordered list — the
  // first gets the top window, the rest live as browser-style tabs in the
  // second window. Mobile keeps the single-thread sheet.
  const [openThreadIds, setOpenThreadIds] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [focusEntryId, setFocusEntryId] = useState(null);

  const openThread = useCallback((id, entryId = null) => {
    setFocusEntryId(entryId);
    if (id == null) { setOpenThreadIds([]); setActiveTabId(null); return; }
    setThreadsOpen(true);
    setOpenThreadIds((prev) => {
      if (android) return [id];
      return prev.includes(id) ? prev : [...prev, id];
    });
    setActiveTabId(id);
  }, [android]);

  const closeThread = useCallback((id) => {
    setOpenThreadIds((prev) => prev.filter((x) => x !== id));
    setActiveTabId((tab) => (tab === id ? null : tab));
  }, []);
  const pendingFlash = useRef(null);
  // Memoized on the threads slice only — the session object gets a new identity
  // every keystroke, and an unstable threads object would re-fire the gutter
  // and panel effects on a hot path where nothing thread-related changed.
  const threadsData = useMemo(() => getThreadsData(fullSession), [fullSession?.threads]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChangeThreads = useCallback((next) => {
    onUpdateSession?.({ threads: next });
  }, [onUpdateSession]);

  // Remove anchor markup everywhere: state (all chapters) + the live editor DOM
  // (the contentEditable doesn't re-sync innerHTML on content changes, so the
  // open chapter must be patched in place).
  const handleStripAnchors = useCallback((anchorIds) => {
    if (!anchorIds?.length) return;
    const { chapters, changed } = stripAnchorsFromChapters(fullSession?.chapters || [], anchorIds);
    if (changed) onUpdateSession?.({ chapters });
    const editorEl = editorRef.current;
    if (editorEl) stripAnchorEls(editorEl, anchorIds);
  }, [fullSession, onUpdateSession]);

  // Panel→prose jump: switch chapter if needed, then sync-scroll + flash.
  const handleJumpToAnchor = useCallback((anchorId) => {
    const loc = locateAnchors(fullSession).get(anchorId);
    if (!loc) return;
    const editingChap = current?._editingChap ?? 1;
    if (loc.chapIdx !== editingChap && onOpenChapter) {
      pendingFlash.current = anchorId;
      onOpenChapter(loc.chapIdx);
    } else {
      flashAnchor(editorRef.current, anchorId);
    }
  }, [fullSession, current?._editingChap, onOpenChapter]);

  // Complete a cross-chapter jump once the new chapter's content is mounted.
  useEffect(() => {
    if (!pendingFlash.current) return;
    const id = pendingFlash.current;
    const t = setTimeout(() => { flashAnchor(editorRef.current, id); pendingFlash.current = null; }, 80);
    return () => clearTimeout(t);
  }, [current?._editingChap]);

  const openThreadFromMarker = useCallback((threadId, entryId) => {
    hapticSelect();
    openThread(threadId, entryId ?? null);
  }, [openThread]);

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

  // ── Resume Writing: record where the user is ─────────────────────────────
  // Caret + scroll are saved (debounced) so the widget button, launcher
  // shortcut, home Continue card and 'resume' startup mode can reopen the
  // exact spot. current.id is the BOOK id (editorCurrent preserves it).
  useEffect(() => {
    if (!current?.id) return undefined;
    const el = editorRef.current;
    const main = mainRef.current;
    let t;
    const save = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        saveResumePoint(current.id, {
          chapIdx: current?._editingChap ?? 1,
          caret: caretOffsetIn(el) ?? undefined,
          scroll: main?.scrollTop ?? 0,
        });
      }, 600);
    };
    document.addEventListener('selectionchange', save);
    main?.addEventListener('scroll', save, { passive: true });
    save();
    return () => {
      clearTimeout(t);
      document.removeEventListener('selectionchange', save);
      main?.removeEventListener('scroll', save);
    };
  }, [current?.id, current?._editingChap]);

  // ── Resume Writing: land back at the recorded spot ───────────────────────
  // Runs once per resume request, after the innerHTML sync above has put the
  // chapter content in the DOM.
  useEffect(() => {
    if (!resumePoint || resumePoint.bookId !== current?.id) return;
    const el = editorRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      if (resumePoint.caret != null) restoreCaretIn(el, resumePoint.caret);
      if (mainRef.current && resumePoint.scroll != null) mainRef.current.scrollTop = resumePoint.scroll;
      if (android) {
        import('@capacitor/keyboard')
          .then(({ Keyboard }) => Keyboard.show().catch(() => {}))
          .catch(() => {});
      }
      onResumeConsumed?.();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumePoint, current?.id, current?._editingChap]);

  return (
    <div style={{ flex: 1, display: "flex", minWidth: 0, position: "relative", overflow: "hidden" }}>
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
              <DSIcons.PanelLeft size={20} color="var(--text-1)" />
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
          {current && (
            <button
              onClick={() => setThreadsOpen((v) => !v)}
              title="Threads — plotlines & character arcs"
              aria-label="Threads"
              style={{ padding: 8, border: `1px solid ${threadsOpen ? accentHex : "var(--border)"}`, borderRadius: 6, background: threadsOpen ? `${accentHex}15` : "none", cursor: "pointer", transition: "all 0.15s", color: threadsOpen ? accentHex : "var(--text-1)", display: "flex", alignItems: "center" }}
            >
              <DSIcons.Tag size={20} color="currentColor" />
            </button>
          )}
          <button
            ref={burgerBtnRef}
            onClick={onToggleMenu}
            style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 6, background: "none", cursor: "pointer", transition: "background 0.15s", color: "var(--text-1)" }}
          >
            <DSIcons.MoreVertical size={20} color="var(--text-1)" style={{ display: "block" }} />
          </button>
        </div>
      </header>

      {/* Chapter navigation bar — only when editing a chapter of a MULTI-chapter
          book. A one-chapter book has nothing to page between, so the "Ch 1 / 1"
          bar was pure noise. */}
      {chapterPosition && chapterPosition.total > 1 && (
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
      {/* Android: extra bottom padding clears the floating/docked toolbar */}
      <main ref={mainRef} style={{ position: "relative", flex: 1, overflowY: "auto", padding: android ? "0.75rem 0.75rem 96px" : "1.5rem" }}>
        {current ? (
          <>
            {/* Colored gutter markers for thread anchors (prose stays unstyled) */}
            <ThreadGutter
              editorRef={editorRef} containerRef={mainRef}
              session={current} data={threadsData}
              contentVersion={current?.content}
              onMarkerClick={openThreadFromMarker}
            />
            <EditorToolbar execCommand={execCommand} accentHex={accentHex} session={current} editorRef={editorRef} customFonts={customFonts} />
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
              onPaste={(e) => {
                // F4: strip foreign fonts/colors/scripts from web pastes while
                // keeping bold/italic/lists/paragraph structure. Routed through
                // insertHTML so the paste stays undoable.
                const html = e.clipboardData?.getData("text/html");
                const text = e.clipboardData?.getData("text/plain");
                if (!html && !text) return;
                e.preventDefault();
                if (html) document.execCommand("insertHTML", false, sanitizePastedHtml(html));
                else document.execCommand("insertText", false, text);
                onEditContent(e.currentTarget.innerHTML);
              }}
            />
          </>
        ) : (
          <div style={{ color: "var(--text-4)", textAlign: "center", marginTop: 80, padding: "0 16px" }}>
            {android ? "Tap the menu above to open your sessions." : "Select or create a session to begin."}
          </div>
        )}
      </main>
    </div>

    {/* Selection chip + action menu (fixed-positioned; renders only with a selection) */}
    {current && (
      <ThreadSelectionLayer
        editorRef={editorRef}
        data={threadsData}
        onChangeData={handleChangeThreads}
        onEditContent={onEditContent}
        onOpenThread={(id) => openThread(id)}
        accentHex={accentHex}
      />
    )}

    {/* Threads — Android 5⁄8 bottom sheet / desktop tiling (2 windows + tabs) */}
    {threadsOpen && current && (android ? (
      <ThreadsPanel
        session={fullSession ?? current}
        data={threadsData}
        onChangeData={handleChangeThreads}
        onStripAnchors={handleStripAnchors}
        onJump={handleJumpToAnchor}
        openThreadId={openThreadIds[0] ?? null}
        focusEntryId={focusEntryId}
        onOpenThread={(id, entryId = null) => openThread(id, entryId)}
        accentHex={accentHex}
        android
        onClose={() => { setThreadsOpen(false); openThread(null); }}
      />
    ) : (
      <ThreadsTilesDesktop
        session={fullSession ?? current}
        data={threadsData}
        onChangeData={handleChangeThreads}
        onStripAnchors={handleStripAnchors}
        onJump={handleJumpToAnchor}
        openThreadIds={openThreadIds}
        activeTabId={activeTabId}
        focusEntryId={focusEntryId}
        onOpenThread={openThread}
        onCloseThread={closeThread}
        onActivateTab={setActiveTabId}
        accentHex={accentHex}
        onClose={() => { setThreadsOpen(false); openThread(null); }}
      />
    ))}
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
  const [resumePointState, setResumePointState] = useState(null); // pending Resume Writing target
  const [sharedImport, setSharedImport] = useState(null);         // text shared from another app
  const [showUpdateOnboarding, setShowUpdateOnboarding] = useState(false);
  const [brokenFiles, setBrokenFiles] = useState([]);

  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [fontCustomizerOpen, setFontCustomizerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readAloudSession, setReadAloudSession] = useState(null);
  const [chapterInfoOpen, setChapterInfoOpen] = useState(false);
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

    // Linux: the window is transparent (main.js), so round its corners in CSS.
    // Corners go square while maximised (a maximised window fills the screen,
    // so rounding would just leak desktop through the gaps).
    const linux = window.electron?.platform === 'linux';
    let disposeMax;
    if (linux) {
      document.documentElement.classList.add('linux-window');
      const controls = window.electron?.windowControls;
      const setMax = (m) => document.documentElement.classList.toggle('linux-window--max', !!m);
      controls?.isMaximized?.().then(setMax).catch(() => {});
      if (controls?.onMaximizeChange) disposeMax = controls.onMaximizeChange(setMax);
    }
    return () => {
      document.documentElement.classList.remove('is-electron');
      document.documentElement.classList.remove('linux-window', 'linux-window--max');
      document.documentElement.style.setProperty('--titlebar-h', '0px');
      if (typeof disposeMax === 'function') disposeMax();
    };
  }, []);

  // Apply the user's chosen fonts (body / editor / headings + uploaded fonts).
  // Like applyAccent, this writes a CSS-var override that outranks the theme's
  // default fonts and is re-asserted after every theme switch.
  useEffect(() => { applyFonts(customization.fonts ?? DEFAULT_FONTS); }, [customization.fonts]);

  // ── Global tap haptics (B7) ───────────────────────────────────────────────
  // Every button/menu tap gives a light tick (author: "vibrations don't really
  // work when clicking buttons"). Delegated + throttled; heavier semantic
  // haptics (delete/save/goal) still fire from their own call sites on top.
  useEffect(() => { setHapticsEnabled(settings.hapticsEnabled ?? true); }, [settings.hapticsEnabled]);
  const _lastTapHaptic = useRef(0);
  useEffect(() => {
    const onTap = (e) => {
      if (!e.target?.closest?.('button, [role="button"], select')) return;
      const now = Date.now();
      if (now - _lastTapHaptic.current < 90) return;
      _lastTapHaptic.current = now;
      hapticSelect();
    };
    document.addEventListener('click', onTap, true);
    return () => document.removeEventListener('click', onTap, true);
  }, []);

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
    // Honour the "Restore previously open books" setting (Settings → Startup).
    // Previously this ran unconditionally, so turning the toggle off did nothing.
    if (window.electron && (settings.restoreOpenBooks ?? true)) {
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

    if (behavior === "resume") {
      // Straight into the editor at the recorded chapter/caret — the
      // zero-resistance launch. Falls back to 'last' when nothing is recorded.
      const last = getLastResume();
      if (last?.bookId && sessions.some((s) => s.id === last.bookId)) { resumeWriting(last.bookId); return; }
    }
    if (behavior === "last" || behavior === "resume") {
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
    widgetSyncTimer.current = setTimeout(() => {
      // isDark is read inside syncWidget; listing the theme here is what makes
      // a theme switch actually reach the widget (it used to keep the old
      // palette until the next keystroke — the "widget ignores theme" report).
      syncWidget(sessions, customization.accentHex);
      // Launcher shortcut label follows the last-written book.
      const last = getLastResume();
      const lastBook = sessions.find((s) => s.id === last?.bookId)
        ?? [...sessions].sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0))[0];
      updateAppShortcuts(lastBook);
    }, 1500);
    return () => clearTimeout(widgetSyncTimer.current);
  }, [sessions, customization.accentHex, theme?.meta?.isDark]); // eslint-disable-line react-hooks/exhaustive-deps
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
        const nb = { ...book, id: book.id || Date.now().toString(), preview: previewOf(book.content || "") };
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
    hapticSelect();
    if (sessionObj) setSessions((prev) => prev.some((s) => s.id === sessionObj.id) ? prev : [sessionObj, ...prev]);
    setCurrentId(id); setCurrentChapterIdx(null); setView("book-dashboard");
    if (android) setDrawerOpen(false);
  };
  const handleEditChapter = useCallback((chapIdx) => { hapticSelect(); setCurrentChapterIdx(chapIdx); setView("editor"); }, []);

  // ── Resume Writing: one call drops the user back into the editor at the
  // recorded book/chapter/caret. Used by the 'resume' startup mode, the home
  // Continue card, the widget's Start-writing button and launcher shortcuts.
  const resumeWriting = useCallback((bookId) => {
    const targetId = bookId ?? getLastResume()?.bookId;
    const book = sessions.find((s) => s.id === targetId) ?? sessions[0];
    if (!book) { setView("home"); return; }
    const point = getResumePoint(book.id) ?? {};
    const sorted = [...(book.chapters || [])].sort((a, b) => a.order - b.order);
    const chapIdx = sorted.some((c) => c.chap_idx === point.chapIdx) ? point.chapIdx : (sorted[0]?.chap_idx ?? 1);
    setResumePointState({ bookId: book.id, ...point, chapIdx });
    setCurrentId(book.id);
    setCurrentChapterIdx(chapIdx);
    setView("editor");
    if (android) setDrawerOpen(false);
  }, [sessions, android]);

  // Widget Start-writing button and launcher shortcuts land here (forwarded
  // by MainActivity as authno-launch-action).
  useEffect(() => {
    const onLaunch = (e) => {
      const { action, bookId } = e.detail || {};
      if (action === "resume") resumeWriting(bookId || undefined);
      else if (action === "new-book") newBook();
    };
    window.addEventListener("authno-launch-action", onLaunch);
    return () => window.removeEventListener("authno-launch-action", onLaunch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeWriting]);

  // Text shared from another app (ACTION_SEND) opens the import sheet.
  useEffect(() => {
    const onShared = (e) => {
      const { text, subject } = e.detail || {};
      if (text) setSharedImport({ text, subject: subject || "" });
    };
    window.addEventListener("authno-shared-text", onShared);
    return () => window.removeEventListener("authno-shared-text", onShared);
  }, []);

  const handleSharedImport = ({ mode, bookId, chapIdx }) => {
    const { text, subject } = sharedImport || {};
    setSharedImport(null);
    if (!text) return;
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = text.split(/\r?\n/).map((l) => (l.trim() ? `<p>${esc(l)}</p>` : "<p><br></p>")).join("");
    const now = new Date().toISOString();

    if (mode === "new-book") {
      const id = Date.now().toString();
      const title = (subject || text.trim().split(/\r?\n/)[0] || "Imported note").slice(0, 80);
      const firstChap = { chap_idx: 1, title: "Chapter 1", order: 1, content: html, created: now, updated: now };
      setSessions((s) => [{ id, title, preview: previewOf(html), content: html, type: "book", created: now, updated: now, chapters: [firstChap], authors: [], devices: [], genre: "", description: "", language: "en", publisher: "", isbn: "" }, ...s]);
      setCurrentId(id); setCurrentChapterIdx(1); setView("editor");
    } else if (mode === "new-chapter") {
      const cur = sessions.find((s) => s.id === bookId);
      if (!cur) return;
      const maxIdx   = cur.chapters?.length ? Math.max(...cur.chapters.map((c) => c.chap_idx)) : 0;
      const maxOrder = cur.chapters?.length ? Math.max(...cur.chapters.map((c) => c.order))    : 0;
      const newIdx = maxIdx + 1;
      const chap = { chap_idx: newIdx, title: (subject || `Chapter ${newIdx}`).slice(0, 80), order: maxOrder + 1, content: html, created: now, updated: now };
      setSessions((prev) => prev.map((s) => s.id !== bookId ? s : { ...s, chapters: [...(s.chapters || []), chap], updated: now }));
      setCurrentId(bookId); setCurrentChapterIdx(newIdx); setView("editor");
    } else { // append to an existing chapter
      setSessions((prev) => prev.map((s) => {
        if (s.id !== bookId) return s;
        const chapters = (s.chapters || []).map((c) => c.chap_idx === chapIdx ? { ...c, content: (c.content || "") + html, updated: now } : c);
        const firstIdx = [...chapters].sort((a, b) => a.order - b.order)[0]?.chap_idx ?? 1;
        if (chapIdx !== firstIdx) return { ...s, chapters, updated: now };
        const merged = chapters.find((c) => c.chap_idx === chapIdx)?.content ?? "";
        return { ...s, chapters, content: merged, preview: previewOf(merged), updated: now };
      }));
      setCurrentId(bookId); setCurrentChapterIdx(chapIdx); setView("editor");
    }
    toast("Added to your book", { variant: "success" });
  };
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
      // Keep the content/preview mirror honest: it tracks the first chapter,
      // so deleting that chapter must re-mirror from the new first one —
      // otherwise the home screen kept previewing deleted text.
      const first = [...chapters].sort((a, b) => a.order - b.order)[0];
      return { ...s, chapters, content: first?.content ?? '', preview: previewOf(first?.content ?? ''), updated: new Date().toISOString() };
    }));
    // Deleting the chapter that's open left currentChapterIdx dangling — the
    // editor then silently fell back to the chapter-1 mirror while the header
    // still claimed the deleted chapter. Point it at the first surviving one.
    setCurrentChapterIdx((idx) => {
      if (idx !== chapIdx) return idx;
      const cur = sessions.find((s) => s.id === currentId);
      const rest = (cur?.chapters || []).filter(c => c.chap_idx !== chapIdx).sort((a, b) => a.order - b.order);
      return rest[0]?.chap_idx ?? null;
    });
  }, [currentId, sessions]);
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
    // Mirror the FIRST chapter by order, not chap_idx 1 — after chapter 1 is
    // deleted, no chap_idx 1 exists and the home-screen preview froze forever.
    const firstIdx = [...chapters].sort((a, b) => a.order - b.order)[0]?.chap_idx ?? 1;
    const isFirst = chapIdx === firstIdx;
    return { ...x, chapters, content: isFirst ? c : x.content, preview: isFirst ? previewOf(c) : x.preview, updated: now };
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

  // ── Auto-save (Android, Arduino-IDE style) ────────────────────────────────
  // Books without a user-chosen location are silently written to the AuthNo
  // app folder a few seconds after the last edit. Explicit Save opens the SAF
  // picker and deletes this copy (storage.js saveBook/deleteAutosave).
  const autosaveTimer = useRef(null);
  useEffect(() => {
    if (!android || !current?.id) return undefined;
    if (current.filePath?.startsWith("content://")) return undefined;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      import("./utils/storage").then(({ autoSaveBook }) => autoSaveBook(current)).catch(() => {});
    }, 4000);
    return () => clearTimeout(autosaveTimer.current);
  }, [current, android]);

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
        <div style={{ position: "fixed", inset: 0, background: "var(--scrim, rgba(0,0,0,0.6))", zIndex: 40 }} onClick={() => setDrawerOpen(false)} onTouchStart={() => setDrawerOpen(false)} />
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
          current={current} goalWords={current?.streak?.goalWords ?? settings.dailyWordGoal ?? DEFAULT_WORD_GOAL}
          onStreakUpdate={handleStreakUpdate} streakEnabled={current?.streak?.streakEnabled ?? settings.streakEnabled ?? true}
          onRefresh={async () => {
            try { const { listSavedBooks } = await import('./utils/storage'); const books = await listSavedBooks(); if (books.length) setSessions(prev => { const ids = new Set(prev.map(s => s.id)); return [...prev, ...books.filter(b => !ids.has(b.id))]; }); }
            catch (e) { showError('refresh', e); }
          }}
          onReadAloud={() => { if (current) setReadAloudSession(current); else toast('Open a book first to read it aloud', { variant: 'info' }); }}
          onOpenExtensions={() => { setDrawerOpen(true); }}
          resumeInfo={(() => {
            const last = getLastResume();
            const b = last && sessions.find((s) => s.id === last.bookId);
            if (!b) return null;
            const ch = (b.chapters || []).find((c) => c.chap_idx === last.chapIdx);
            return { title: b.title || 'Untitled Book', chapter: ch?.title || null };
          })()}
          onResume={() => resumeWriting()}
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
          goalWords={current?.streak?.goalWords ?? settings.dailyWordGoal ?? DEFAULT_WORD_GOAL}
          onStreakUpdate={handleStreakUpdate} streakEnabled={current?.streak?.streakEnabled ?? settings.streakEnabled ?? true}
        />
      ) : (
        <Editor
          current={editorCurrent} onEditTitle={handleEditTitle} onEditContent={handleEditContent}
          customFonts={customization.fonts?.custom ?? []}
          fullSession={current} onUpdateSession={handleUpdateSession} onOpenChapter={handleEditChapter}
          onEditChapterTitle={currentChapterIdx ? handleEditChapterTitle : undefined}
          chapterTitle={currentChapter?.title ?? null}
          onBack={() => setView("book-dashboard")}
          onPrevChapter={prevChapIdx !== null ? () => handleEditChapter(prevChapIdx) : null}
          onNextChapter={nextChapIdx !== null ? () => handleEditChapter(nextChapIdx) : null}
          chapterPosition={currentChapterPos >= 0 ? { pos: currentChapterPos + 1, total: sortedChapters.length } : null}
          onToggleMenu={handleToggleMenu} accentHex={customization.accentHex}
          goalWords={current?.streak?.goalWords ?? settings.dailyWordGoal ?? DEFAULT_WORD_GOAL}
          onStreakUpdate={handleStreakUpdate}
          onToggleSidebar={() => setDrawerOpen((v) => !v)}
          burgerBtnRef={burgerBtnRef} streakEnabled={current?.streak?.streakEnabled ?? settings.streakEnabled ?? true}
          resumePoint={resumePointState} onResumeConsumed={() => setResumePointState(null)}
        />
      )}

      <BurgerMenu
        open={menuOpen} onClose={() => setMenuOpen(false)} current={current}
        setSessions={setSessions}
        onOpenSettings={() => { setMenuOpen(false); setSettingsOpen(true); }}
        onOpen={(id) => { setCurrentId(id); setCurrentChapterIdx(null); setView("book-dashboard"); if (android) setDrawerOpen(false); }}
        accentHex={customization.accentHex} anchorRef={burgerBtnRef}
        context={view === "home" ? "home" : "book"}
        onRename={(t) => handleUpdateSession({ title: t })}
        onChapterInfo={current ? () => setChapterInfoOpen(true) : null}
        onExport={{ txt: handleExportTxt, html: handleExportHtml, epub: handleExportEpub, pdf: handleExportPdf }}
        onReadAloud={() => current && setReadAloudSession(current)}
      />

      {sharedImport && (
        <ShareImportSheet
          text={sharedImport.text} subject={sharedImport.subject}
          sessions={sessions} accentHex={customization.accentHex}
          onClose={() => setSharedImport(null)}
          onImport={handleSharedImport}
        />
      )}

      {chapterInfoOpen && current && (
        <ChapterInfoModal
          session={current}
          chapterIdx={currentChapterIdx ?? 1}
          accentHex={customization.accentHex}
          onClose={() => setChapterInfoOpen(false)}
        />
      )}

      <Settings
        isOpen={settingsOpen} onClose={() => setSettingsOpen(false)}
        settings={settings} onSave={handleSaveSettings}
        onOpenCustomizer={() => setCustomizerOpen(true)}
        onOpenFontCustomizer={() => setFontCustomizerOpen(true)}
        onClearSessions={() => { setSessions([]); localStorage.removeItem("offlineWriterSessions"); }}
        sessions={sessions} onSessionChange={handleSessionChange}
        onReplayTour={() => { setSettingsOpen(false); setShowOnboarding(true); }}
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
  // A corrupt writerCustomization entry threw here — at the very root of the
  // tree — and white-screened the whole app before anything could render.
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem("writerCustomization") || "{}") ?? {}; } catch { /* corrupt — use defaults */ }
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
