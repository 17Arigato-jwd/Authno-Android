/**
 * SandboxHost.jsx — AuthNo, cut down to the parts an extension can see.
 *
 * This is not the app with screens hidden. It is a separate host that imports
 * the eight extension surfaces and nothing else, and the distinction is the
 * whole point: what is not imported here is not in the bundle, so a sandbox
 * anybody may download does not carry the gate, the onboarding, the account
 * system, billing, the key handling or the rescue path. `check:sandbox-bundle`
 * asserts that by name, against the built bytes rather than against this list.
 *
 * What IS here is everything a contribution can land on, driven by the real
 * ExtensionProvider, the real runtime and the real permission model:
 *
 *   Home       homescreen tiles
 *   Book       bookActions and chapterActions, on a saved book and a draft
 *   Editor     editorToolbar, the writing meter, ExtensionPanel, ExtensionDots
 *   Settings   settings rows → ExtensionPage, and the permissions ledger
 *   Extensions install, remove, grants — ExtensionTab, as Settings renders it
 *   Slots      every declared contribution, whether it is showing, and why not
 *
 * The last one has no equivalent in the app and is the reason a sandbox is
 * worth building rather than just running the app: a contribution that renders
 * nowhere is silent, and silence is what shipped `bookDashboard` against a
 * validator that only knew `bookActions`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DSIcons, ToastContainer, toast, COLORS, Tabs, Badge, Divider,
} from '../DesignSystem';
import { useTheme, ALL_THEMES, applyAccent } from '../theme';
import {
  useExtensions, useExtensionContributions, useBookDashboardExtensions,
  useEditorToolbarExtensions,
} from '../utils/ExtensionContext';
import {
  setGetSessionsHandler, setCurrentBookHandler,
  setImportSessionHandler, setReplaceSessionHandler,
} from '../utils/extensionRuntime';
import { activityMeter } from '../utils/activityMeter';
import { whenAllows, whenContext } from '../utils/whenClause';
import { readGrants } from '../utils/extensionGrants';
import { getExtensionConfig } from '../utils/extensionLoader';
import ExtensionPage from '../components/ExtensionPage';
import ExtensionPanel from '../components/ExtensionPanel';
import ExtensionDots from '../components/ExtensionDots';
import ExtensionTab from '../components/ExtensionTab';
import ExtensionPermissions from '../components/ExtensionPermissions';
import ExtensionPromptDialog from '../components/ExtensionPromptDialog';
import PermissionRequestSheet from '../components/PermissionRequestSheet';
import InstallSheet from '../components/InstallSheet';
import { freshLibrary } from './library';

const ACCENT = '#6366f1';

const TABS = [
  { key: 'home',       label: 'Home',       icon: <DSIcons.Home size={14} /> },
  { key: 'book',       label: 'Book',       icon: <DSIcons.BookOpen size={14} /> },
  { key: 'editor',     label: 'Editor',     icon: <DSIcons.Edit size={14} /> },
  { key: 'settings',   label: 'Settings',   icon: <DSIcons.Settings size={14} /> },
  { key: 'extensions', label: 'Extensions', icon: <DSIcons.Extension size={14} /> },
  { key: 'slots',      label: 'Slots',      icon: <DSIcons.List size={14} /> },
];

/** Every slot the app reads, with the hook that reads it. */
const SLOTS = [
  ['homescreen',    'Home'],
  ['settings',      'Settings'],
  ['bookActions',   'Book'],
  ['chapterActions', 'Book'],
  ['editorToolbar', 'Editor'],
  ['bookDashboard', 'Book (v1)'],
];

// ── small shared bits ────────────────────────────────────────────────────────

const card = {
  background: 'var(--surface)', border: '1px solid var(--border-sm)',
  borderRadius: 12, padding: 14,
};

function SectionTitle({ children, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 2px 10px' }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{children}</span>
      {hint && <span style={{ fontSize: 11, color: 'var(--text-5)' }}>{hint}</span>}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ ...card, color: 'var(--text-4)', fontSize: 12.5, textAlign: 'center', padding: 22 }}>
      {children}
    </div>
  );
}

/** A contribution, drawn the way the app draws that kind of contribution. */
function ContribButton({ item, onRun, wide = false }) {
  return (
    <button
      onClick={() => onRun(item)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: wide ? '12px 14px' : '8px 11px',
        width: wide ? '100%' : undefined,
        borderRadius: 10, cursor: 'pointer', textAlign: 'left',
        background: 'var(--surface-md)', border: '1px solid var(--border-sm)',
        color: 'var(--text-1)', fontSize: 12.5, fontWeight: 600,
      }}
    >
      <DSIcons.Extension size={14} color={ACCENT} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
      <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-5)' }}>
        {item.command ? item.command : item.page ? `→ ${item.page}` : ''}
      </span>
    </button>
  );
}

// ── the host ─────────────────────────────────────────────────────────────────

export default function SandboxHost() {
  const [tab, setTab] = useState('home');
  const [library, setLibrary] = useState(freshLibrary);
  const [openId, setOpenId] = useState(null);
  const [extPage, setExtPage] = useState(null);
  const [draft, setDraft] = useState('');

  const { extensions, loading, refresh, runContribution } = useExtensions();
  const { theme, switchTheme } = useTheme();

  const open = useMemo(
    () => library.find((b) => b.id === openId) ?? null,
    [library, openId],
  );

  // The runtime reads the library through four registered functions, exactly
  // as App.js registers them. Refs rather than the state values: the handlers
  // are registered once and an extension may call them at any point after,
  // long after this render's closure is stale.
  const libraryRef = useRef(library);
  const openRef = useRef(openId);
  libraryRef.current = library;
  openRef.current = openId;

  useEffect(() => {
    setGetSessionsHandler(() => libraryRef.current);
    setCurrentBookHandler(() => openRef.current);
    setImportSessionHandler(async (base64) => {
      const { unpackSession, bookToSession, base64ToBytes } = await import('../utils/authbook');
      const session = bookToSession(await unpackSession(base64ToBytes(base64)));
      const withId = { ...session, id: session.id || `imported-${Date.now()}` };
      setLibrary((l) => [...l.filter((b) => b.id !== withId.id), withId]);
      toast(`Imported "${withId.title}"`, { variant: 'success' });
      return withId;
    });
    setReplaceSessionHandler(async (id, base64) => {
      const { unpackSession, bookToSession, base64ToBytes } = await import('../utils/authbook');
      const session = bookToSession(await unpackSession(base64ToBytes(base64)));
      setLibrary((l) => l.map((b) => (b.id === id ? { ...session, id } : b)));
      toast(`Replaced "${session.title}"`, { variant: 'success' });
    });
  }, []);

  const navigate = useCallback((extension, pageId, session) => {
    setExtPage({ extension, pageId, session: session ?? null });
  }, []);

  // The sandbox's navigate has to reach the provider's, which is given at the
  // root. index.jsx passes this down through a ref for the same reason App.js
  // does: the provider is above the component that knows where to go.
  useEffect(() => {
    window.__sandboxNavigate = navigate;
    return () => { delete window.__sandboxNavigate; };
  }, [navigate]);

  const run = useCallback((item) => {
    runContribution(item._ext, item, open);
  }, [runContribution, open]);

  const openBook = (id) => { setOpenId(id); setTab('book'); };

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--app-bg)', color: 'var(--text-1)',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    }}>
      <DevBar
        theme={theme} switchTheme={switchTheme}
        extensions={extensions} loading={loading} refresh={refresh}
        openId={openId} setOpenId={setOpenId} library={library}
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 14px 20px' }}>
        {tab === 'home' && <HomePane library={library} onOpen={openBook} onRun={run} />}
        {tab === 'book' && <BookPane book={open} onRun={run} onPick={openBook} library={library} />}
        {tab === 'editor' && (
          <EditorPane book={open} draft={draft} setDraft={setDraft} onRun={run} />
        )}
        {tab === 'settings' && <SettingsPane onOpenPage={navigate} />}
        {tab === 'extensions' && <ExtensionsPane />}
        {tab === 'slots' && <SlotsPane extensions={extensions} book={open} />}
      </div>

      <nav style={{
        flexShrink: 0, borderTop: '1px solid var(--border)',
        background: 'var(--nav-bg)', padding: '6px 8px',
      }}>
        <Tabs items={TABS} active={tab} onChange={setTab} />
      </nav>

      {/* The surfaces the app mounts once, at the root, in the same order. */}
      <ToastContainer position="bottom-center" />
      <InstallSheet accentHex={ACCENT} />
      <PermissionRequestSheet accentHex={ACCENT} />
      <ExtensionPromptDialog accentHex={ACCENT} />
      <ExtensionDots />

      {extPage && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'var(--app-bg)' }}>
          <ExtensionPage
            extension={extPage.extension}
            pageId={extPage.pageId}
            session={extPage.session ?? open}
            accentHex={ACCENT}
            onBack={() => setExtPage(null)}
          />
        </div>
      )}
    </div>
  );
}

// ── the bar across the top, which the app does not have ──────────────────────

/**
 * Everything here is a development control and none of it exists in AuthNo.
 *
 * The theme switcher is first because it is the one that catches the most:
 * every panel an extension draws inherits the app's variables, and a
 * contribution that is legible on Dark and invisible on Paper is a bug an
 * author cannot see without switching. That exact class shipped in 1.1.19.
 */
function DevBar({ theme, switchTheme, extensions, loading, refresh, openId, setOpenId, library }) {
  const themes = ALL_THEMES;
  return (
    <header style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '8px 12px', background: 'var(--nav-bg)',
      borderBottom: '1px solid var(--border)', fontSize: 12,
    }}>
      <span style={{ fontWeight: 700, letterSpacing: '-0.2px' }}>Sandbox host</span>
      <Badge variant={extensions.length ? 'success' : 'beta'}>
        {loading ? 'loading…' : `${extensions.length} installed`}
      </Badge>

      <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-4)' }}>
        Theme
        <select
          value={theme?.id ?? ''}
          onChange={(e) => {
            const next = themes.find((t) => t.id === e.target.value);
            if (next) switchTheme(next);
          }}
          style={selectStyle}
        >
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.id}</option>)}
        </select>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-4)' }}>
        Accent
        <input
          type="color" defaultValue={ACCENT}
          onChange={(e) => applyAccent(e.target.value)}
          style={{ width: 26, height: 20, padding: 0, border: '1px solid var(--border)', background: 'none', borderRadius: 4 }}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-4)' }}>
        Open book
        <select value={openId ?? ''} onChange={(e) => setOpenId(e.target.value || null)} style={selectStyle}>
          <option value="">— nothing open —</option>
          {library.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}{b.filePath ? '' : ' (unsaved)'}
            </option>
          ))}
        </select>
      </label>

      <button onClick={refresh} style={devBtn}>
        <DSIcons.Refresh size={12} /> Reload extensions
      </button>
    </header>
  );
}

const selectStyle = {
  background: 'var(--surface-md)', color: 'var(--text-1)',
  border: '1px solid var(--border-sm)', borderRadius: 6,
  padding: '3px 6px', fontSize: 11.5,
};

const devBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  marginLeft: 'auto', padding: '4px 9px', borderRadius: 7,
  background: 'var(--surface-md)', border: '1px solid var(--border-sm)',
  color: 'var(--text-2)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
};

// ── panes ────────────────────────────────────────────────────────────────────

function HomePane({ library, onOpen, onRun }) {
  const tiles = useExtensionContributions('homescreen');
  return (
    <>
      <SectionTitle hint="two books, one saved and one not">Library</SectionTitle>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}>
        {library.map((b) => (
          <button key={b.id} onClick={() => onOpen(b.id)}
            style={{ ...card, textAlign: 'left', cursor: 'pointer', color: 'var(--text-1)' }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{b.title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
              {b.chapters.length} chapter{b.chapters.length === 1 ? '' : 's'}
              {b.filePath ? ' · saved' : ' · unsaved'}
            </div>
          </button>
        ))}
      </div>

      <Divider style={{ margin: '18px 0 12px' }} />
      <SectionTitle hint="contributes.homescreen">Home tiles</SectionTitle>
      {tiles.length === 0
        ? <Empty>Nothing contributed to the home screen.</Empty>
        : (
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>
            {tiles.map((t) => <ContribButton key={`${t._extId}-${t.id ?? t.label}`} item={t} onRun={onRun} wide />)}
          </div>
        )}
    </>
  );
}

function BookPane({ book, onRun, onPick, library }) {
  const { actions, tabs } = useBookDashboardExtensions(book);

  if (!book) {
    return (
      <>
        <SectionTitle>No book is open</SectionTitle>
        <Empty>
          A `when` clause reading `book.isOpen` is false right now, which is a
          state worth seeing. Open one from the bar above, or here:
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            {library.map((b) => (
              <button key={b.id} onClick={() => onPick(b.id)} style={devBtn}>{b.title}</button>
            ))}
          </div>
        </Empty>
      </>
    );
  }

  return (
    <>
      <SectionTitle hint={book.filePath ? 'book.isSaved = true' : 'book.isSaved = false'}>
        {book.title}
      </SectionTitle>
      <div style={card}>
        {book.chapters.map((c) => (
          <div key={c.chap_idx} style={{ padding: '7px 0', borderBottom: '1px solid var(--border-sm)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.title || `Chapter ${c.chap_idx}`}</div>
            <div style={{ fontSize: 11, color: 'var(--text-5)' }}>{c.word_count} words</div>
          </div>
        ))}
      </div>

      <Divider style={{ margin: '18px 0 12px' }} />
      <SectionTitle hint="contributes.bookActions + chapterActions">Book actions</SectionTitle>
      {actions.length === 0
        ? <Empty>Nothing contributed to the book screen.</Empty>
        : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {actions.map((a) => (
              <ContribButton key={`${a._extId}-${a.id ?? a.label}`} item={a} onRun={onRun} />
            ))}
          </div>
        )}

      {tabs.length > 0 && (
        <>
          <Divider style={{ margin: '18px 0 12px' }} />
          <SectionTitle hint="contributes.bookDashboard.tabs — v1">Dashboard tabs</SectionTitle>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tabs.map((t) => (
              <ContribButton key={`${t._extId}-${t.id ?? t.label}`} item={t} onRun={onRun} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/**
 * The editor, reduced to the one thing an extension can observe about it.
 *
 * `activity.onWriting` is a real capability and the meter behind it is fed by
 * keystrokes. Without somewhere to type, an extension that throttles on
 * writing rate cannot be exercised at all — so the textarea is not decoration,
 * it is the input to the meter.
 */
function EditorPane({ book, draft, setDraft, onRun }) {
  const buttons = useEditorToolbarExtensions(book);
  const [rate, setRate] = useState(null);

  // Polled rather than subscribed: subscribing starts the meter's timer, and
  // the point of the readout is to show what an extension would see, not to
  // become the reason the meter is running.
  useEffect(() => {
    const id = setInterval(() => {
      try { setRate(activityMeter().getRate()); } catch { setRate(null); }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // `record(count)` is what the real editor calls, with the number of
  // characters that changed. Sending 1 per keystroke would understate a paste,
  // and the meter's own cap handles the upper end.
  const type = (e) => {
    const delta = Math.abs(e.target.value.length - draft.length) || 1;
    setDraft(e.target.value);
    try { activityMeter().record(delta); } catch { /* nothing is listening */ }
  };

  return (
    <>
      <SectionTitle hint="contributes.editorToolbar">Toolbar</SectionTitle>
      {buttons.length === 0
        ? <Empty>Nothing contributed to the editor toolbar.</Empty>
        : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {buttons.map((b) => (
              <ContribButton key={`${b._extId}-${b.id ?? b.label}`} item={b} onRun={onRun} />
            ))}
          </div>
        )}

      <Divider style={{ margin: '18px 0 12px' }} />
      <SectionTitle hint={rate
        ? `${rate.charsPerSecond} chars/s · ${rate.sessionChars} this session · idle ${rate.idleSeconds ?? '—'}s`
        : 'activity.getRate()'}>
        {book ? book.title : 'Scratch'}
      </SectionTitle>
      <textarea
        value={draft} onChange={type}
        placeholder="Type here — activity.onWriting fires from these keystrokes."
        style={{
          ...card, width: '100%', minHeight: 180, resize: 'vertical',
          color: 'var(--text-1)', fontSize: 13.5, lineHeight: 1.6,
          fontFamily: 'inherit',
        }}
      />

      <Divider style={{ margin: '18px 0 12px' }} />
      <SectionTitle hint="ExtensionPanel — the app's own">Panel</SectionTitle>
      <ExtensionPanel accentHex={ACCENT} session={book} />
    </>
  );
}

function SettingsPane({ onOpenPage }) {
  const rows = useExtensionContributions('settings');
  return (
    <>
      <SectionTitle hint="contributes.settings">Settings rows</SectionTitle>
      {rows.length === 0
        ? <Empty>Nothing contributed to Settings.</Empty>
        : (
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map((r) => (
              <ContribButton
                key={`${r._extId}-${r.id ?? r.label}`} item={r} wide
                onRun={() => onOpenPage(r._ext, r.page, null)}
              />
            ))}
          </div>
        )}

      <Divider style={{ margin: '18px 0 12px' }} />
      <SectionTitle hint="what each one has been refused">Permissions</SectionTitle>
      <ExtensionPermissions accentHex={ACCENT} />
    </>
  );
}

function ExtensionsPane() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 380 }}>
      <ExtensionTab accentHex={ACCENT} session={null} />
    </div>
  );
}

/**
 * Every slot declared, and whether it is on screen.
 *
 * There is nothing like this in the app because the app has no reason to
 * explain itself. Here it is the main event: a contribution can fail to appear
 * for three unrelated reasons — the slot name is not one the app reads, the
 * `when` clause is false, or the permission the clause tests was refused — and
 * all three look identical from the author's side, which is to say blank.
 */
function SlotsPane({ extensions, book }) {
  const facts = {
    isOpen: !!book,
    isSaved: !!book?.filePath,
    chapterCount: book?.chapters?.length ?? 0,
  };

  const rows = [];
  for (const ext of extensions) {
    const c = ext.contributes ?? {};
    const grants = readGrants(ext.id).granted ?? [];
    const ctx = whenContext({
      app: { platform: 'web', version: 'sandbox' },
      book: facts,
      settings: getExtensionConfig(ext.id),
    });

    for (const [slot, where] of SLOTS) {
      const raw = c[slot];
      const items = Array.isArray(raw)
        ? raw
        : (slot === 'bookDashboard' && raw
          ? [...(raw.tabs ?? []), ...(raw.actions ?? [])]
          : []);
      for (const item of items) {
        let shown = true;
        let why = null;
        if (item.when) {
          shown = whenAllows(item.when, ctx, grants, (e) => { why = e.message; });
          if (!shown && !why) why = 'the clause is false right now';
        }
        rows.push({ ext, slot, where, item, shown, why });
      }
    }

    // A slot name the app does not read at all — the failure that is hardest
    // to see, because the manifest looks right and nothing warns.
    for (const name of Object.keys(c)) {
      if (!SLOTS.some(([s]) => s === name)) {
        rows.push({
          ext, slot: name, where: '—', item: { label: `${name} (not a slot this app reads)` },
          shown: false, why: `nothing renders "${name}" — the slots are ${SLOTS.map(([s]) => s).join(', ')}`,
        });
      }
    }
  }

  if (!extensions.length) return <Empty>Install an extension to see its slots.</Empty>;
  if (!rows.length) return <Empty>This extension declares no contributions.</Empty>;

  return (
    <>
      <SectionTitle hint={`book.isOpen=${facts.isOpen} · book.isSaved=${facts.isSaved} · chapters=${facts.chapterCount}`}>
        Contributions
      </SectionTitle>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map((r, i) => (
          <div key={`${r.ext.id}-${r.slot}-${i}`} style={{
            ...card, padding: '9px 12px', display: 'flex', alignItems: 'flex-start', gap: 10,
            borderColor: r.shown ? 'var(--border-sm)' : COLORS.warningLine,
          }}>
            <span style={{
              marginTop: 3, width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: r.shown ? COLORS.success : COLORS.warning,
            }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.item.label ?? r.item.id}</div>
              <div style={{ fontSize: 11, color: 'var(--text-5)', fontFamily: 'ui-monospace, monospace' }}>
                {r.ext.id} · {r.slot} · {r.where}
              </div>
              {r.item.when && (
                <div style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>
                  when: {r.item.when}
                </div>
              )}
              {!r.shown && r.why && (
                <div style={{ fontSize: 11, color: COLORS.warning, marginTop: 3 }}>{r.why}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
