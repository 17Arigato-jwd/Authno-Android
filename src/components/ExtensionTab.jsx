/**
 * ExtensionTab.jsx
 *
 * Changes from original:
 *   - No emojis — all icons use Lucide React
 *   - Contribution chips are collapsible (show 3 by default)
 *   - Slightly-hidden "Open Extensions Folder" button in footer
 */

import React, { useState } from 'react';
import {
  Puzzle, BookOpen, LayoutDashboard, Settings2, ExternalLink,
  Upload, Eye, FileText, BarChart2, Rocket, Star, Link,
  MessageCircle, Home, ChevronRight, ChevronDown, ChevronUp,
  RefreshCw, FolderOpen, Zap, Edit3, Globe, Play,
} from 'lucide-react';
import { useExtensions } from '../utils/ExtensionContext';
import { isAndroid } from '../utils/platform';

// ─── Emoji / string → Lucide icon resolver ────────────────────────────────────

const EMOJI_MAP = {
  '📚': BookOpen, '📖': BookOpen, '📝': Edit3, '📊': BarChart2,
  '🚀': Rocket,   '⚙️': Settings2, '🏠': Home,  '📤': Upload,
  '👁️': Eye,     '⭐': Star,      '🔗': Link,  '💬': MessageCircle,
  '🌐': Globe,   '⚡': Zap,       '▸': Play,    '↗': ExternalLink,
  '▶': Play,
};

const LABEL_MAP = {
  'open': ExternalLink, 'open dashboard': LayoutDashboard,
  'summary': FileText,  'publish': Upload, 'publish draft': Upload,
  'view': Eye,          'analytics': BarChart2, 'settings': Settings2,
  'home': Home,         'book': BookOpen,
};

function getContribIcon(contrib, size = 12) {
  const icon  = contrib.icon;
  const group = contrib._group?.toLowerCase() ?? '';
  const label = (contrib.label ?? '').toLowerCase();

  if (icon) {
    const str = String(icon).trim();
    if (EMOJI_MAP[str]) { const I = EMOJI_MAP[str]; return <I size={size} />; }
    if (LABEL_MAP[str.toLowerCase()]) { const I = LABEL_MAP[str.toLowerCase()]; return <I size={size} />; }
  }

  if (LABEL_MAP[label]) { const I = LABEL_MAP[label]; return <I size={size} />; }
  if (group === 'home')     return <Home size={size} />;
  if (group === 'settings') return <Settings2 size={size} />;
  if (group === 'book')     return <BookOpen size={size} />;
  if (group === 'page')     return <ExternalLink size={size} />;
  if (label.includes('publish')) return <Upload size={size} />;
  if (label.includes('analytic') || label.includes('stat')) return <BarChart2 size={size} />;
  if (label.includes('dashboard')) return <LayoutDashboard size={size} />;
  if (label.includes('summary')) return <FileText size={size} />;
  if (label.includes('view')) return <Eye size={size} />;

  return <ChevronRight size={size} />;
}

// ─── Chip: a single tappable contribution ─────────────────────────────────────

function ContribChip({ contrib, onClick }) {
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
      <span style={{ display: 'flex', alignItems: 'center', opacity: 0.7 }}>
        {getContribIcon(contrib, 11)}
      </span>
      {contrib.label}
    </button>
  );
}

// ─── Single extension card ────────────────────────────────────────────────────

const CHIPS_VISIBLE_DEFAULT = 3;

function ExtensionCard({ ext, accentHex, session, onClose }) {
  const { navigate } = useExtensions();
  const [expanded, setExpanded] = useState(false);

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

  const hasMain = !!ext.contributes?.pages?.main;
  if (hasMain && !allContribs.find(c => c.page === 'main')) {
    allContribs.push({ id: '_main', label: 'Open', icon: '↗', page: 'main', _group: 'Page' });
  }

  const visibleContribs = expanded ? allContribs : allContribs.slice(0, CHIPS_VISIBLE_DEFAULT);
  const hiddenCount = allContribs.length - CHIPS_VISIBLE_DEFAULT;

  const handleNav = (pageId) => {
    navigate(ext, pageId, session);
    onClose?.();
  };

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
          color: accentHex,
        }}>
          <Puzzle size={18} />
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

      {/* Contribution chips — collapsible */}
      {allContribs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {visibleContribs.map((c, i) => (
              <ContribChip
                key={i}
                contrib={c}
                onClick={() => handleNav(c.page)}
              />
            ))}
          </div>

          {allContribs.length > CHIPS_VISIBLE_DEFAULT && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                alignSelf: 'flex-start',
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.35)',
                fontSize: '11px', cursor: 'pointer',
                padding: '2px 0',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.65)'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}
            >
              {expanded
                ? <><ChevronUp size={12} style={{ marginRight: 2 }} /> Show less</>
                : <><ChevronDown size={12} style={{ marginRight: 2 }} /> {hiddenCount} more action{hiddenCount !== 1 ? 's' : ''}</>
              }
            </button>
          )}
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

// ─── Open extensions folder helper ───────────────────────────────────────────

async function openExtensionsFolder() {
  if (isAndroid()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { uri } = await Filesystem.getUri({
        path: 'AuthNo/extensions',
        directory: Directory.Data,
      });
      const cleaned = decodeURIComponent(uri.replace('file://', ''));
      try {
        await navigator.clipboard.writeText(cleaned);
        alert('Extensions folder path copied to clipboard:\n\n' + cleaned);
      } catch {
        alert('Extensions folder:\n\n' + cleaned);
      }
    } catch {
      alert('Extensions folder:\nInternal Storage / Android/data/[app]/files/AuthNo/extensions');
    }
  } else {
    alert(
      'Dev extensions are loaded from the localStorage key:\n' +
      '__authno_dev_extensions\n\n' +
      'Open DevTools → Application → Local Storage to manage them.'
    );
  }
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ExtensionTab({ accentHex, session, onClose }) {
  const { extensions, hasExtensions, loading, refresh } = useExtensions();

  if (loading || !hasExtensions) return null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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

      {/* Footer: refresh + slightly-hidden open-folder button */}
      <div style={{
        padding: '8px 10px 10px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
        display: 'flex', gap: '6px',
      }}>
        <button
          onClick={refresh}
          style={{
            flex: 1, padding: '7px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: 'rgba(255,255,255,0.35)',
            fontSize: '11px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
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
          <RefreshCw size={12} />
          Refresh extensions
        </button>

        {/* Slightly hidden: open extensions folder */}
        <button
          onClick={openExtensionsFolder}
          title="Open extensions folder"
          style={{
            width: '32px', flexShrink: 0,
            padding: '7px 6px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '8px',
            color: 'rgba(255,255,255,0.2)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.2)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
          }}
        >
          <FolderOpen size={13} />
        </button>
      </div>
    </div>
  );
}
