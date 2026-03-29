// HomeScreen.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { Menu } from 'lucide-react';
import { FlameButton } from './Streak';
import { useError } from '../utils/ErrorContext';
import { folderFromPath } from '../utils/storage';
import Logo from '../logo.svg';

const BurgerIcon = ({ className, style }) => (
  <svg className={className} style={style} width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

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

const glassCard = {
  background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '20px',
};

const bookCardStyle = {
  display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px',
  background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(0,0,0,0.7)',
  borderRadius: '16px', cursor: 'pointer',
  transition: 'background 0.15s ease, border-color 0.15s ease',
};

function ActionTile({ icon, label, onClick, accentHex, comingSoon }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={comingSoon ? undefined : onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '10px', width: '90px', flexShrink: 0, background: 'none', border: 'none',
        cursor: comingSoon ? 'default' : 'pointer', padding: '4px', opacity: comingSoon ? 0.45 : 1 }}>
      <div style={{ width: '72px', height: '72px', borderRadius: '18px',
        background: hovered && !comingSoon ? `${accentHex}22` : 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        border: `1.5px solid ${hovered && !comingSoon ? accentHex + '55' : 'rgba(255,255,255,0.1)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s ease', fontSize: '28px' }}>
        {icon}
      </div>
      <span style={{ fontSize: '11px', fontWeight: 500,
        color: comingSoon ? 'var(--text-5)' : 'var(--text-3)',
        textAlign: 'center', lineHeight: 1.3, maxWidth: '80px' }}>
        {label}
      </span>
    </button>
  );
}

function BookCard({ title, meta, onClick, accentHex }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ ...bookCardStyle,
        borderColor: hovered ? `${accentHex}40` : 'rgba(0,0,0,0.7)',
        background: hovered ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.5)' }}>
      <div style={{ width: '52px', height: '52px', flexShrink: 0, borderRadius: '12px',
        background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <img src={Logo} alt="book" style={{ width: '36px', height: '36px', objectFit: 'contain', opacity: 0.9 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '17px', fontWeight: 700, color: '#fff',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px' }}>
          {title || 'Untitled Book'}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-5)',
          display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap', overflow: 'hidden' }}>
          {meta.filter(Boolean).map((item, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px',
              flexShrink: i === 0 ? 0 : 1, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {i > 0 && <span style={{ opacity: 0.4 }}>·</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HomeScreen({
  sessions, accentHex, onNewBook, onSelect,
  onToggleSidebar, onToggleMenu, burgerBtnRef,
  current, goalWords, onStreakUpdate, streakEnabled,
}) {
  const { showError } = useError();
  const [activeTab,   setActiveTab]  = useState('recent');
  const [indexBooks,  setIndexBooks]  = useState([]);
  const [pruning,     setPruning]     = useState(false);
  const pruneRan = useRef(false);

  // Load index from localStorage instantly (synchronous under the hood)
  const loadIndex = useCallback(() => {
    import('../utils/storage').then(({ listKnownBooks }) => setIndexBooks(listKnownBooks()));
  }, []);

  // Run background prune once per app session
  const runPrune = useCallback(async () => {
    if (pruneRan.current) return;
    pruneRan.current = true;
    setPruning(true);
    try {
      const { pruneBookIndex } = await import('../utils/storage');
      setIndexBooks(await pruneBookIndex());
    } catch { /* silent */ } finally { setPruning(false); }
  }, []);

  // On mount: load index immediately, then kick off background prune
  useEffect(() => {
    loadIndex();
    runPrune();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh index whenever user switches to On Device tab (picks up newly opened files)
  useEffect(() => {
    if (activeTab === 'device') loadIndex();
  }, [activeTab, loadIndex]);

  const handleOpenExisting = async () => {
    try {
      const { openBook: openBookFn } = await import('../utils/storage');
      const session = await openBookFn();
      if (session) { onSelect(session.id, session); loadIndex(); }
    } catch (err) { showError('openBook', err); }
  };

  const recentBooks = [...sessions]
    .filter(s => s.type !== 'storyboard')
    .sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));

  const actions = [
    { icon: '✏️', label: 'Create a New Book',        onClick: onNewBook },
    { icon: '📂', label: 'Edit an Existing Book',    onClick: handleOpenExisting },
    { icon: '🔊', label: 'Read Aloud (Coming Soon)', comingSoon: true },
    { icon: '?',  label: 'Coming Soon',              comingSoon: true },
    { icon: '?',  label: 'Coming Soon',              comingSoon: true },
  ];

  const recentBooks = [...sessions]
    .filter(s => s.type !== 'storyboard')
    .sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
      height: '100%', overflowY: 'auto', overflowX: 'hidden',
      position: 'relative', zIndex: 1 }}>

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

        {/* Actions */}
        <div style={{ ...glassCard, padding: '20px' }}>
          <h2 style={{ margin: '0 0 18px 0', fontSize: '20px', fontWeight: 800,
            color: '#fff', letterSpacing: '-0.3px' }}>
            What would you like to do?
          </h2>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto',
            paddingBottom: '4px', scrollbarWidth: 'none' }}>
            <style>{`.home-actions::-webkit-scrollbar{display:none}`}</style>
            <div className="home-actions" style={{ display: 'flex', gap: '8px',
              overflowX: 'auto', paddingBottom: '4px' }}>
              {actions.map((a, i) => (
                <ActionTile key={i} icon={a.icon} label={a.label} onClick={a.onClick}
                  accentHex={accentHex} comingSoon={a.comingSoon} />
              ))}
            </div>
          </div>
        </div>

        {/* Tabs — Recent is default, On Device reads from index (instant, no scan) */}
        <div style={{ ...glassCard, padding: '0', overflow: 'hidden', flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 20px' }}>
            {[{ id: 'recent', label: 'Recent' }, { id: 'device', label: 'On Device' }].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                background: 'none', border: 'none', padding: '14px 16px 12px', fontSize: '14px',
                fontWeight: activeTab === tab.id ? 700 : 400,
                color: activeTab === tab.id ? '#fff' : 'var(--text-4)', cursor: 'pointer',
                borderBottom: activeTab === tab.id ? `2px solid ${accentHex}` : '2px solid transparent',
                marginBottom: '-1px', transition: 'color 0.15s, border-color 0.15s' }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column',
            gap: '10px', overflowY: 'auto', maxHeight: 'calc(100vh - 420px)' }}>

            {/* Recent tab */}
            {activeTab === 'recent' && (
              recentBooks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px',
                  color: 'var(--text-5)', fontSize: '14px' }}>
                  No books yet — create one or open an existing file.
                </div>
              ) : recentBooks.map(book => (
                <BookCard key={book.id} title={book.title}
                  meta={['.authbook', timeAgo(book.updated || book.created)]}
                  onClick={() => onSelect(book.id)} accentHex={accentHex} />
              ))
            )}

            {/* On Device tab — reads the book index, no scan */}
            {activeTab === 'device' && (
              <>
                {pruning && (
                  <div style={{ textAlign: 'right', fontSize: '11px',
                    color: 'var(--text-5)', opacity: 0.5, paddingBottom: '2px' }}>
                    Verifying files…
                  </div>
                )}
                {indexBooks.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px',
                    color: 'var(--text-5)', fontSize: '14px', lineHeight: 1.7 }}>
                    No files tracked yet.
                    <span style={{ fontSize: '12px', display: 'block', marginTop: '6px' }}>
                      Open or save an .authbook file and it will appear here automatically.
                    </span>
                  </div>
                ) : indexBooks.map((book, i) => (
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
                  />
                ))}
              </>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
