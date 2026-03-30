// HomeScreen.jsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { Menu } from 'lucide-react';
import { FlameButton } from './Streak';
import { useError } from '../utils/ErrorContext';
import { folderFromPath } from '../utils/storage';
import Logo from '../logo.svg';

// ─── Light-mode detector ──────────────────────────────────────────────────────
// Reads the .light-mode class from the app-root div — no prop needed from App.js.
function useLightMode() {
  const [light, setLight] = useState(
    () => document.querySelector('.light-mode') !== null
  );
  useEffect(() => {
    const obs = new MutationObserver(
      () => setLight(document.querySelector('.light-mode') !== null)
    );
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return light;
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const BurgerIcon = ({ className, style }) => (
  <svg className={className} style={style} width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date)) return '';
  const secs = Math.floor((Date.now() - date) / 1000);
  if (secs < 60)     return 'just now';
  if (secs < 3600)   return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)  return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFileSize(bytes) {
  if (bytes == null || bytes === 0) return null;
  if (bytes < 1024)               return `${bytes} B`;
  if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Theme helpers ────────────────────────────────────────────────────────────
// Returns mode-appropriate style values so every hardcoded color is one place.
function useTheme(accentHex, light) {
  return {
    // Outer glass panels (actions card, tab card)
    glassCard: {
      background: light ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.45)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: light
        ? '1px solid rgba(0,0,0,0.09)'
        : '1px solid rgba(255,255,255,0.08)',
      borderRadius: '20px',
    },
    // Tab divider line
    tabDivider: light ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.07)',
    // Active tab label
    tabActiveColor: light ? 'var(--text-1)' : '#fff',
    // Book card — frosted accent glass
    bookCard: (hovered) => ({
      display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px',
      background: light
        ? hovered ? `${accentHex}22` : `${accentHex}12`
        : hovered ? `${accentHex}28` : `${accentHex}18`,
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: light
        ? `1px solid ${hovered ? accentHex + '55' : accentHex + '30'}`
        : `1px solid ${hovered ? accentHex + '55' : accentHex + '28'}`,
      borderRadius: '16px', cursor: 'pointer',
      transition: 'background 0.15s ease, border-color 0.15s ease',
    }),
    // Thumbnail box inside book card
    bookThumb: {
      width: '52px', height: '52px', flexShrink: 0, borderRadius: '12px',
      background: light ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.35)',
      border: light
        ? `1px solid ${accentHex}25`
        : '1px solid rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    },
    // Action tile icon box
    actionTileBox: (hovered, comingSoon) => ({
      width: '72px', height: '72px', borderRadius: '18px',
      background: hovered && !comingSoon
        ? `${accentHex}22`
        : light ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      border: `1.5px solid ${
        hovered && !comingSoon
          ? accentHex + '55'
          : light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
      }`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s ease', fontSize: '28px',
    }),
    // Spinner
    spinnerDisc: light ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)',
    spinnerTrack: light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)',
    spinnerPending: light ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.3)',
  };
}

// ─── Pull-to-refresh constants ────────────────────────────────────────────────
const PULL_THRESHOLD = 64;
const PULL_MAX       = 90;
const SPINNER_SIZE   = 32;

// ─── Spinner ──────────────────────────────────────────────────────────────────
function RefreshSpinner({ pullY, refreshing, accentHex, theme }) {
  const progress  = Math.min(pullY / PULL_THRESHOLD, 1);
  const triggered = pullY >= PULL_THRESHOLD;
  const visible   = pullY > 4 || refreshing;

  const translateY = refreshing
    ? 0
    : Math.min(pullY * 0.55, PULL_MAX * 0.55) - SPINNER_SIZE;

  const arcDeg  = refreshing ? 270 : Math.max(30, progress * 270);
  const r       = (SPINNER_SIZE / 2) - 3;
  const circ    = 2 * Math.PI * r;
  const dashOff = circ * (1 - arcDeg / 360);

  return (
    <>
      <style>{`@keyframes ptr-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{
        position: 'absolute', top: 0, left: '50%',
        transform: `translateX(-50%) translateY(${translateY}px)`,
        width: SPINNER_SIZE, height: SPINNER_SIZE,
        opacity: visible ? 1 : 0,
        transition: refreshing
          ? 'transform 0.25s cubic-bezier(.34,1.56,.64,1), opacity 0.15s'
          : 'opacity 0.15s',
        pointerEvents: 'none', zIndex: 10,
      }}>
        <svg
          width={SPINNER_SIZE} height={SPINNER_SIZE}
          viewBox={`0 0 ${SPINNER_SIZE} ${SPINNER_SIZE}`}
          style={{
            animation: refreshing ? 'ptr-spin 0.7s linear infinite' : 'none',
            filter: triggered || refreshing ? `drop-shadow(0 0 6px ${accentHex}88)` : 'none',
            transition: 'filter 0.2s',
          }}
        >
          <circle cx={SPINNER_SIZE/2} cy={SPINNER_SIZE/2} r={r}
            fill={theme.spinnerDisc}
            stroke={theme.spinnerTrack} strokeWidth="1.5" />
          <circle cx={SPINNER_SIZE/2} cy={SPINNER_SIZE/2} r={r}
            fill="none"
            stroke={triggered || refreshing ? accentHex : theme.spinnerPending}
            strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={dashOff}
            transform={`rotate(-90 ${SPINNER_SIZE/2} ${SPINNER_SIZE/2})`}
            style={{ transition: refreshing ? 'none' : 'stroke 0.15s, stroke-dashoffset 0.05s' }}
          />
        </svg>
      </div>
    </>
  );
}

// ─── usePullToRefresh ─────────────────────────────────────────────────────────
function usePullToRefresh(onRefresh) {
  const scrollRef      = useRef(null);
  const touchStartY    = useRef(0);
  const pulling        = useRef(false);
  const didVibrate     = useRef(false);           // prevent re-firing threshold buzz
  const [pullY,        setPullY]      = useState(0);
  const [refreshing,   setRefreshing] = useState(false);

  const vibrate = useCallback((pattern) => {
    try { navigator.vibrate?.(pattern); } catch {}
  }, []);

  const onTouchStart = useCallback((e) => {
    if (scrollRef.current?.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
      pulling.current  = true;
      didVibrate.current = false;
    }
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!pulling.current || refreshing) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy <= 0) { setPullY(0); return; }
    const eased = Math.min(PULL_MAX, dy * (1 - dy / (PULL_MAX * 3.5)));
    setPullY(eased);
    // Single short buzz exactly when threshold is crossed
    if (eased >= PULL_THRESHOLD && !didVibrate.current) {
      didVibrate.current = true;
      vibrate(30);
    }
  }, [refreshing, vibrate]);

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullY >= PULL_THRESHOLD) {
      setPullY(0);
      setRefreshing(true);
      try { await onRefresh?.(); } catch {}
      await new Promise(r => setTimeout(r, 650));
      // Double-bump on completion — feels like a satisfying "done" tick
      vibrate([45, 30, 45]);
      setRefreshing(false);
    } else {
      setPullY(0);
    }
  }, [pullY, onRefresh, vibrate]);

  return { scrollRef, pullY, refreshing, onTouchStart, onTouchMove, onTouchEnd };
}

// ─── ActionTile ───────────────────────────────────────────────────────────────
function ActionTile({ icon, label, onClick, accentHex, comingSoon, theme }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={comingSoon ? undefined : onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '10px', width: '90px', flexShrink: 0, background: 'none', border: 'none',
        cursor: comingSoon ? 'default' : 'pointer', padding: '4px',
        opacity: comingSoon ? 0.45 : 1,
      }}>
      <div style={theme.actionTileBox(hovered, comingSoon)}>{icon}</div>
      <span style={{
        fontSize: '11px', fontWeight: 500,
        color: comingSoon ? 'var(--text-5)' : 'var(--text-3)',
        textAlign: 'center', lineHeight: 1.3, maxWidth: '80px',
      }}>
        {label}
      </span>
    </button>
  );
}

// ─── BookCard ─────────────────────────────────────────────────────────────────
function BookCard({ title, meta, onClick, accentHex, theme }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={theme.bookCard(hovered)}>
      <div style={theme.bookThumb}>
        <img src={Logo} alt="book"
          style={{ width: '36px', height: '36px', objectFit: 'contain', opacity: 0.9 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '17px', fontWeight: 700, color: 'var(--text-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px',
        }}>
          {title || 'Untitled Book'}
        </div>
        <div style={{
          fontSize: '12px', color: 'var(--text-5)',
          display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap', overflow: 'hidden',
        }}>
          {meta.filter(Boolean).map((item, i) => (
            <span key={i} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              flexShrink: i === 0 ? 0 : 1, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {i > 0 && <span style={{ opacity: 0.4 }}>·</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── HomeScreen ───────────────────────────────────────────────────────────────
export default function HomeScreen({
  sessions, accentHex, onNewBook, onSelect,
  onToggleSidebar, onToggleMenu, burgerBtnRef,
  current, goalWords, onStreakUpdate, streakEnabled,
  onRefresh,
}) {
  const { showError } = useError();
  const [activeTab, setActiveTab] = useState('recent');

  const light = useLightMode();
  const theme = useTheme(accentHex, light);

  const { scrollRef, pullY, refreshing, onTouchStart, onTouchMove, onTouchEnd } =
    usePullToRefresh(onRefresh);

  const recentBooks = [...sessions]
    .filter(s => s.type !== 'storyboard')
    .sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));

  const deviceBooks = [...sessions]
    .filter(s => s.type !== 'storyboard' && s.filePath)
    .sort((a, b) => new Date(b.lastOpened || b.updated || 0) - new Date(a.lastOpened || a.updated || 0));

  const handleOpenExisting = async () => {
    try {
      const { openBook: openBookFn } = await import('../utils/storage');
      const session = await openBookFn();
      if (session) onSelect(session.id, session);
    } catch (err) { showError('openBook', err); }
  };

  const actions = [
    { icon: '✏️', label: 'Create a New Book',        onClick: onNewBook },
    { icon: '📂', label: 'Edit an Existing Book',    onClick: handleOpenExisting },
    { icon: '🔊', label: 'Read Aloud (Coming Soon)', comingSoon: true },
    { icon: '?',  label: 'Coming Soon',              comingSoon: true },
    { icon: '?',  label: 'Coming Soon',              comingSoon: true },
  ];

  const listNudge = refreshing
    ? SPINNER_SIZE + 6
    : Math.min(pullY * 0.55, PULL_MAX * 0.55);

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
      height: '100%', overflowY: 'auto', overflowX: 'hidden',
      position: 'relative', zIndex: 1,
    }}>

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ background: 'var(--app-bg)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onToggleSidebar}
            className="p-2 border border-white/30 rounded-md hover:bg-white/5 transition shrink-0"
            aria-label="Sessions">
            <Menu className="w-5 h-5 text-white" />
          </button>
          <span className="text-white text-lg font-semibold truncate">Welcome Back</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {streakEnabled && (
            <FlameButton current={current} accentHex={accentHex}
              goalWords={goalWords} onStreakUpdate={onStreakUpdate} />
          )}
          <button ref={burgerBtnRef} onClick={onToggleMenu}
            className="p-2 border-2 border-white rounded-md hover:bg-white/5 transition">
            <BurgerIcon className="text-white" />
          </button>
        </div>
      </header>

      {/* Content */}
      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>

        {/* Actions card */}
        <div style={{ ...theme.glassCard, padding: '20px' }}>
          <h2 style={{
            margin: '0 0 18px 0', fontSize: '20px', fontWeight: 800,
            color: 'var(--text-1)', letterSpacing: '-0.3px',
          }}>
            What would you like to do?
          </h2>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' }}>
            <style>{`.home-actions::-webkit-scrollbar{display:none}`}</style>
            <div className="home-actions"
              style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
              {actions.map((a, i) => (
                <ActionTile key={i} icon={a.icon} label={a.label} onClick={a.onClick}
                  accentHex={accentHex} comingSoon={a.comingSoon} theme={theme} />
              ))}
            </div>
          </div>
        </div>

        {/* Tab card */}
        <div style={{ ...theme.glassCard, padding: '0', overflow: 'hidden', flex: 1, minHeight: 0 }}>

          {/* Tab bar */}
          <div style={{
            display: 'flex',
            borderBottom: `1px solid ${theme.tabDivider}`,
            padding: '0 20px',
          }}>
            {[{ id: 'recent', label: 'Recent' }, { id: 'device', label: 'On Device' }].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                background: 'none', border: 'none', padding: '14px 16px 12px', fontSize: '14px',
                fontWeight: activeTab === tab.id ? 700 : 400,
                color: activeTab === tab.id ? theme.tabActiveColor : 'var(--text-4)',
                cursor: 'pointer',
                borderBottom: activeTab === tab.id ? `2px solid ${accentHex}` : '2px solid transparent',
                marginBottom: '-1px', transition: 'color 0.15s, border-color 0.15s',
              }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Pull-to-refresh region */}
          <div style={{ position: 'relative', overflow: 'hidden' }}>
            <RefreshSpinner pullY={pullY} refreshing={refreshing} accentHex={accentHex} theme={theme} />

            <div
              ref={scrollRef}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              style={{
                padding: '16px',
                display: 'flex', flexDirection: 'column', gap: '10px',
                overflowY: 'auto',
                maxHeight: 'calc(100vh - 420px)',
                transform: `translateY(${listNudge}px)`,
                transition: (pullY === 0 && !refreshing)
                  ? 'transform 0.3s cubic-bezier(.22,1,.36,1)'
                  : 'none',
              }}
            >

              {/* Recent tab */}
              {activeTab === 'recent' && (
                recentBooks.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-5)', fontSize: '14px' }}>
                    No books yet — create one or open an existing file.
                  </div>
                ) : recentBooks.map(book => (
                  <BookCard key={book.id} title={book.title}
                    meta={['.authbook', timeAgo(book.updated || book.created)]}
                    onClick={() => onSelect(book.id)} accentHex={accentHex} theme={theme} />
                ))
              )}

              {/* On Device tab */}
              {activeTab === 'device' && (
                deviceBooks.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-5)', fontSize: '14px', lineHeight: 1.7 }}>
                    No saved files yet.
                    <span style={{ fontSize: '12px', display: 'block', marginTop: '6px' }}>
                      Save or open an .authbook file and it will appear here automatically.
                    </span>
                  </div>
                ) : deviceBooks.map((book, i) => (
                  <BookCard
                    key={book.id || book.filePath || i}
                    title={book.title}
                    meta={[
                      folderFromPath(book.filePath),
                      formatFileSize(book.fileSize),
                      timeAgo(book.lastOpened || book.updated),
                    ]}
                    onClick={() => onSelect(book.id, book)}
                    accentHex={accentHex}
                    theme={theme}
                  />
                ))
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
