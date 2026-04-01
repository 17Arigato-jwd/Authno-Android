/**
 * ExtensionTab.jsx
 *
 * The "Extensions" section rendered at the bottom of the Sidebar.
 * Only mounts when at least one extension is installed.
 *
 * Shows a collapsible list of installed extensions.  Each extension entry
 * can be expanded to reveal its individual contributions (homescreen actions,
 * book-dashboard tabs, settings items, and any direct pages).  Tapping a
 * contribution navigates to the corresponding extension page via the
 * navigate() function from ExtensionContext.
 *
 * Props:
 *   accentHex    string   theme accent colour
 *   onClose      fn       close the drawer (Android only)
 *   session      object   current book session or null
 */

import React, { useState } from 'react';
import { useExtensions } from '../utils/ExtensionContext';

// ─── Small helpers ────────────────────────────────────────────────────────────

function ChevronIcon({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PuzzleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.7 }}>
      <path d="M12 2a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v3h1a2 2 0 0 1 0 4h-1v3a1 1 0 0 1-1 1h-3v1a2 2 0 0 1-4 0v-1H7a1 1 0 0 1-1-1v-3H5a2 2 0 0 1 0-4h1V6a1 1 0 0 1 1-1h3V4a2 2 0 0 1 2-2z"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

// ─── Contribution row ─────────────────────────────────────────────────────────

function ContribRow({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        width: '100%', textAlign: 'left',
        padding: '7px 10px 7px 28px',
        background: 'transparent', border: 'none',
        color: 'rgba(255,255,255,0.65)', fontSize: '12px',
        cursor: 'pointer', borderRadius: '6px',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ fontSize: '14px', lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

// ─── Single extension row ─────────────────────────────────────────────────────

function ExtensionRow({ ext, accentHex, session, onClose }) {
  const [open, setOpen]   = useState(false);
  const { navigate }      = useExtensions();

  // Gather all contributions for this extension
  const homeTiles = ext.contributes?.homescreen ?? [];
  const bdTabs    = ext.contributes?.bookDashboard?.tabs    ?? [];
  const bdActions = ext.contributes?.bookDashboard?.actions ?? [];
  const settItems = ext.contributes?.settings ?? [];
  const allContribs = [
    ...homeTiles.map(c  => ({ ...c, _label: c.label, _group: 'Home' })),
    ...bdTabs.map(c    => ({ ...c, _label: c.label, _group: 'Book' })),
    ...bdActions.map(c => ({ ...c, _label: c.label, _group: 'Book' })),
    ...settItems.map(c => ({ ...c, _label: c.label, _group: 'Settings' })),
  ];

  const handleContrib = (contrib) => {
    navigate(ext, contrib.page, session);
    onClose?.();
  };

  return (
    <div style={{ borderRadius: '8px', overflow: 'hidden' }}>
      {/* Header row — tap to expand */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          width: '100%', textAlign: 'left',
          padding: '8px 10px',
          background: open ? 'rgba(255,255,255,0.06)' : 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.85)', fontSize: '13px', fontWeight: 500,
          cursor: 'pointer', borderRadius: '8px',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Extension icon */}
        <span style={{ fontSize: '16px', lineHeight: 1, flexShrink: 0 }}>
          {typeof ext.icon === 'string' && ext.icon.length <= 4
            ? ext.icon   // emoji
            : '🧩'}
        </span>

        <span style={{
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {ext.name}
        </span>

        {/* Version badge */}
        <span style={{
          fontSize: '10px', color: 'rgba(255,255,255,0.35)',
          background: 'rgba(255,255,255,0.06)',
          padding: '2px 5px', borderRadius: '4px', flexShrink: 0,
        }}>
          v{ext.version}
        </span>

        <ChevronIcon open={open} />
      </button>

      {/* Contributions list */}
      {open && (
        <div style={{ paddingBottom: '4px' }}>
          {allContribs.length === 0 ? (
            <div style={{ padding: '6px 28px', fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
              No contributions declared
            </div>
          ) : allContribs.map((c, i) => (
            <ContribRow
              key={i}
              icon={c.icon ?? '▸'}
              label={`${c._label}`}
              onClick={() => handleContrib(c)}
            />
          ))}
          {/* Direct-open button if extension has a main page */}
          {ext.contributes?.pages?.main && (
            <ContribRow
              icon="↗"
              label="Open main page"
              onClick={() => { navigate(ext, 'main', session); onClose?.(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ExtensionTab component ──────────────────────────────────────────────

/**
 * Renders at the very bottom of the Sidebar — only when hasExtensions is true.
 */
export default function ExtensionTab({ accentHex, session, onClose }) {
  const { extensions, hasExtensions, loading, refresh } = useExtensions();
  const [sectionOpen, setSectionOpen] = useState(true);

  // Hidden while loading or when no extensions are installed
  if (loading || !hasExtensions) return null;

  return (
    <div style={{
      borderTop: '1px solid rgba(255,255,255,0.08)',
      padding: '10px 10px 12px',
      flexShrink: 0,
    }}>
      {/* Section header */}
      <button
        onClick={() => setSectionOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          width: '100%', textAlign: 'left',
          padding: '6px 4px',
          background: 'transparent', border: 'none',
          color: 'rgba(255,255,255,0.45)', fontSize: '11px',
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px',
          cursor: 'pointer',
        }}
      >
        <PuzzleIcon />
        <span style={{ flex: 1 }}>Extensions</span>
        <span style={{
          fontSize: '10px', background: accentHex + '33',
          color: accentHex, padding: '1px 6px',
          borderRadius: '8px', flexShrink: 0,
        }}>
          {extensions.length}
        </span>
        <ChevronIcon open={sectionOpen} />
      </button>

      {sectionOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
          {extensions.map(ext => (
            <ExtensionRow
              key={ext.id}
              ext={ext}
              accentHex={accentHex}
              session={session}
              onClose={onClose}
            />
          ))}

          {/* Refresh link — useful when user drops a new extension while the app is open */}
          <button
            onClick={refresh}
            style={{
              marginTop: '8px', padding: '0', background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.25)', fontSize: '11px', cursor: 'pointer',
              textAlign: 'center', width: '100%',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.25)'}
          >
            ↻ Refresh extensions
          </button>
        </div>
      )}
    </div>
  );
}
