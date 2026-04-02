/**
 * ExtensionTab.jsx
 *
 * The extensions panel shown inside the Sidebar when the user switches to
 * the Extensions tab. Only rendered when hasExtensions is true.
 *
 * Shows every installed extension as a card with:
 *   - Icon + name + version badge
 *   - Description (if present)
 *   - A row of tappable contribution chips (homescreen, book tabs, settings, etc.)
 *   - A "Refresh" button at the bottom
 *
 * Props:
 *   accentHex    string   theme accent colour
 *   onClose      fn       close the drawer (Android) — called after navigation
 *   session      object   current book session or null
 */

import React from 'react';
import { useExtensions } from '../utils/ExtensionContext';

// ─── Chip: a single tappable contribution ─────────────────────────────────────

function ContribChip({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '4px 10px',
        background: 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '99px',
        color: 'rgba(255,255,255,0.75)',
        fontSize: '11px', fontWeight: 500,
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.13)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
      }}
    >
      <span style={{ fontSize: '13px', lineHeight: 1 }}>{icon}</span>
      {label}
    </button>
  );
}

// ─── Single extension card ────────────────────────────────────────────────────

function ExtensionCard({ ext, accentHex, session, onClose }) {
  const { navigate } = useExtensions();

  const homeTiles = ext.contributes?.homescreen ?? [];
  const bdTabs    = ext.contributes?.bookDashboard?.tabs    ?? [];
  const bdActions = ext.contributes?.bookDashboard?.actions ?? [];
  const settItems = ext.contributes?.settings ?? [];

  const allContribs = [
    ...homeTiles.map(c  => ({ ...c, _group: 'Home' })),
    ...bdTabs.map(c    => ({ ...c, _group: 'Book' })),
    ...bdActions.map(c => ({ ...c, _group: 'Book' })),
    ...settItems.map(c => ({ ...c, _group: 'Settings' })),
  ];

  // Also include a "main" page chip if declared
  const hasMain = !!ext.contributes?.pages?.main;
  if (hasMain && !allContribs.find(c => c.page === 'main')) {
    allContribs.push({ id: '_main', label: 'Open', icon: '↗', page: 'main', _group: 'Page' });
  }

  const handleNav = (pageId) => {
    navigate(ext, pageId, session);
    onClose?.();
  };

  const iconIsEmoji = typeof ext.icon === 'string' && ext.icon.length <= 4;

  return (
    <div style={{
      padding: '14px 14px 12px',
      borderRadius: '12px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.09)',
      display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      {/* Top row: icon + name + version */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '38px', height: '38px', flexShrink: 0,
          borderRadius: '10px',
          background: accentHex + '22',
          border: `1px solid ${accentHex}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '20px', lineHeight: 1,
        }}>
          {iconIsEmoji ? ext.icon : '🧩'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: 'rgba(255,255,255,0.92)', fontWeight: 600, fontSize: '14px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {ext.name}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', marginTop: '1px' }}>
            {ext.id}
          </div>
        </div>
        <span style={{
          flexShrink: 0,
          fontSize: '10px',
          color: accentHex,
          background: accentHex + '22',
          padding: '2px 7px',
          borderRadius: '6px',
          fontWeight: 600,
        }}>
          v{ext.version}
        </span>
      </div>

      {/* Description */}
      {ext.description && (
        <div style={{
          fontSize: '12px', color: 'rgba(255,255,255,0.5)',
          lineHeight: '1.5',
        }}>
          {ext.description}
        </div>
      )}

      {/* Contribution chips */}
      {allContribs.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '6px',
        }}>
          {allContribs.map((c, i) => (
            <ContribChip
              key={i}
              icon={c.icon ?? '▸'}
              label={c.label}
              onClick={() => handleNav(c.page)}
            />
          ))}
        </div>
      )}

      {allContribs.length === 0 && (
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
          No contributions declared
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ExtensionTab({ accentHex, session, onClose }) {
  const { extensions, hasExtensions, loading, refresh } = useExtensions();

  if (loading || !hasExtensions) return null;

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Scrollable card list */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '10px 10px 4px',
        display: 'flex', flexDirection: 'column', gap: '8px',
      }}>
        {extensions.map(ext => (
          <ExtensionCard
            key={ext.id}
            ext={ext}
            accentHex={accentHex}
            session={session}
            onClose={onClose}
          />
        ))}
      </div>

      {/* Refresh button */}
      <div style={{
        padding: '8px 10px 10px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <button
          onClick={refresh}
          style={{
            width: '100%', padding: '7px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: 'rgba(255,255,255,0.35)',
            fontSize: '11px', cursor: 'pointer',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.35)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
          }}
        >
          ↻ Refresh extensions
        </button>
      </div>
    </div>
  );
}
