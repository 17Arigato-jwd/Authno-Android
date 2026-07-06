/**
 * ExtensionTab.jsx
 *
 * Changes from original:
 *   - No emojis — all icons use Lucide React
 *   - Contribution chips are collapsible (show 3 by default)
 *   - Slightly-hidden "Open Extensions Folder" button in footer
 */

import { DSIcons, toast } from "../DesignSystem";
import React, { useEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';
import { useExtensions } from '../utils/ExtensionContext';
import { isAndroid } from '../utils/platform';
import { hapticDelete } from '../utils/haptics';
import { openBilling } from '../utils/billingBus';

// ─── Emoji / string → Lucide icon resolver ────────────────────────────────────

const EMOJI_MAP = {
  '📚': DSIcons.BookOpen, '📖': DSIcons.BookOpen, '📝': DSIcons.Edit, '📊': DSIcons.Star,
  '🚀': DSIcons.Rocket,   '⚙️': DSIcons.Settings, '🏠': DSIcons.Home,  '📤': DSIcons.Upload,
  '👁️': DSIcons.Eye,     '⭐': DSIcons.Star,      '🔗': DSIcons.Link,  '💬': DSIcons.Chat,
  '🌐': DSIcons.Link,   '⚡': DSIcons.Lightning,       '▸': DSIcons.Lightning,    '↗': DSIcons.Link,
  '▶': DSIcons.Lightning,
};

// Lucide icon name → component (manifest.icon string like "Cloud", "Server", etc.)
const LUCIDE_ICON_MAP = {
  Cloud: DSIcons.Star, Server: DSIcons.Package, HardDrive: DSIcons.Package,
  Box: DSIcons.Package, Upload: DSIcons.Upload, BookOpen: DSIcons.BookOpen,
  Settings2: DSIcons.Settings, Puzzle: DSIcons.Extension, BarChart2: DSIcons.Star,
  Zap: DSIcons.Lightning, Globe: DSIcons.Link, Star: DSIcons.Star,
  Edit3: DSIcons.Edit, Eye: DSIcons.Eye, Home: DSIcons.Home,
};

function resolveLucideIcon(iconName) {
  return iconName && LUCIDE_ICON_MAP[iconName] ? LUCIDE_ICON_MAP[iconName] : null;
}

const LABEL_MAP = {
  'open': DSIcons.Link, 'open dashboard': DSIcons.List,
  'summary': DSIcons.FileText,  'publish': DSIcons.Upload, 'publish draft': DSIcons.Upload,
  'view': DSIcons.Eye,          'analytics': DSIcons.Star, 'settings': DSIcons.Settings,
  'home': DSIcons.Home,         'book': DSIcons.BookOpen,
};

function getContribIcon(contrib, size = 12) {
  const icon  = contrib.icon;
  const group = contrib._group?.toLowerCase() ?? '';
  const label = (contrib.label ?? '').toLowerCase();

  if (icon) {
    // A6: strip variation selectors + zero-width joiners so emoji variants
    // ('⚙️' vs '⚙') resolve to the same icon instead of falling through.
    const str = String(icon).trim().replace(/[\uFE00-\uFE0F\u200D]/g, '');
    if (EMOJI_MAP[str]) { const I = EMOJI_MAP[str]; return <I size={size} />; }
    if (LABEL_MAP[str.toLowerCase()]) { const I = LABEL_MAP[str.toLowerCase()]; return <I size={size} />; }
  }

  if (LABEL_MAP[label]) { const I = LABEL_MAP[label]; return <I size={size} />; }
  if (group === 'home')     return <DSIcons.Home size={size} />;
  if (group === 'settings') return <DSIcons.Settings size={size} />;
  if (group === 'book')     return <DSIcons.BookOpen size={size} />;
  if (group === 'page')     return <DSIcons.Link size={size} />;
  if (label.includes('publish')) return <DSIcons.Upload size={size} />;
  if (label.includes('analytic') || label.includes('stat')) return <DSIcons.Star size={size} />;
  if (label.includes('dashboard')) return <DSIcons.List size={size} />;
  if (label.includes('summary')) return <DSIcons.FileText size={size} />;
  if (label.includes('view')) return <DSIcons.Eye size={size} />;

  return <DSIcons.ChevronRight size={size} />;
}

// ─── Chip: a single tappable contribution ─────────────────────────────────────

function ContribChip({ contrib, onClick }) {
  return (
    <button
      data-ext-action="true"
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
  const { navigate, refresh, clearConfig, uninstall } = useExtensions();
  const [expanded, setExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const longPressTimer = useRef(null);
  const longPressCleanup = useRef(null);

  const homeTiles = ext.contributes?.homescreen ?? [];
  const bdTabs    = ext.contributes?.bookDashboard?.tabs    ?? [];
  const bdActions = ext.contributes?.bookDashboard?.actions ?? [];
  const settItems  = ext.contributes?.settings ?? [];

  const allContribs = [
    ...homeTiles.map(c  => ({ ...c, _group: 'ds_Home' })),
    ...bdTabs.map(c     => ({ ...c, _group: 'Book' })),
    ...bdActions.map(c  => ({ ...c, _group: 'Book' })),
    ...settItems.map(c  => ({ ...c, _group: 'Settings' })),
  ];

  const hasMain = !!ext.contributes?.pages?.main;
  if (hasMain && !allContribs.find(c => c.page === 'main')) {
    allContribs.push({ id: '_main', label: 'Open', icon: '↗', page: 'main', _group: 'Page' });
  }

  useEffect(() => {
    return () => {
      clearTimeout(longPressTimer.current);
      longPressCleanup.current?.();
    };
  }, []);

  const visibleContribs = expanded ? allContribs : allContribs.slice(0, CHIPS_VISIBLE_DEFAULT);
  const hiddenCount = allContribs.length - CHIPS_VISIBLE_DEFAULT;

  const handleNav = (pageId) => {
    navigate(ext, pageId, session);
    onClose?.();
  };

  const openMenuAt = (clientX, clientY) => {
    const MENU_W = 190;
    const MENU_H = 84;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.min(Math.max(8, clientX), Math.max(8, vw - MENU_W - 8));
    const y = Math.min(Math.max(8, clientY), Math.max(8, vh - MENU_H - 8));
    setContextMenu({ x, y });
  };

  const handleDelete = async () => {
    // A3: single uninstall path via the context — it deactivates the running
    // extension (cleans hooks/imports) then removes it from disk or the dev
    // store. The old duplicated rmdir here skipped deactivation entirely and
    // wrote to the wrong store on web.
    try {
      await uninstall?.(ext.id);
      clearConfig?.(ext.id);
      setDeleteConfirm(false);
      setContextMenu(null);
    } catch (err) {
      toast(`Could not remove "${ext.name || ext.id}": ${err?.message || err}`, { variant: 'danger', duration: 5000 });
    }
  };

  const onCardContextMenu = (e) => {
    if (e.target.closest('[data-ext-action="true"]')) return;
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY);
  };

  const onCardTouchStart = (e) => {
    if (e.target.closest('[data-ext-action="true"]')) return;
    const t = e.touches?.[0];
    if (!t) return;

    const startX = t.clientX;
    const startY = t.clientY;

    clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      hapticDelete();
      openMenuAt(t.clientX + 8, t.clientY - 8);
    }, 480);

    const onMove = (me) => {
      const mt = me.touches?.[0];
      if (!mt) return;
      if (Math.abs(mt.clientX - startX) > 8 || Math.abs(mt.clientY - startY) > 8) {
        clearTimeout(longPressTimer.current);
        longPressCleanup.current?.();
      }
    };

    longPressCleanup.current = () => {
      document.removeEventListener('touchmove', onMove);
      longPressCleanup.current = null;
    };

    document.addEventListener('touchmove', onMove, { passive: true });
  };

  const onCardTouchEnd = () => {
    clearTimeout(longPressTimer.current);
    longPressCleanup.current?.();
  };

  return (
    <>
      <div
        data-ext-card="true"
        onContextMenu={onCardContextMenu}
        onTouchStart={onCardTouchStart}
        onTouchEnd={onCardTouchEnd}
        onTouchCancel={onCardTouchEnd}
        style={{
          padding: '14px 14px 12px',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.09)',
          display: 'flex', flexDirection: 'column', gap: '10px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
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
            {(() => { const I = resolveLucideIcon(ext.icon); return I ? <I size={18} /> : <DSIcons.Extension size={18} />; })()}
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
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
            <span style={{
              fontSize: '10px', color: accentHex,
              background: accentHex + '22', padding: '2px 7px',
              borderRadius: '6px', fontWeight: 600,
            }}>
              v{ext.version}
            </span>
            {ext.tier && (
              <span style={ext.tier === 'premium'
                ? { fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '6px',
                    background: '#4f46e522', color: '#818cf8', letterSpacing: '0.04em', textTransform: 'uppercase' }
                : { fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '6px',
                    background: accentHex + '22', color: accentHex, letterSpacing: '0.04em', textTransform: 'uppercase' }
              }>
                {ext.tier === 'premium' ? 'Premium' : 'Free'}
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        {ext.description && (
          <div style={{
            fontSize: '12px', color: 'var(--text-3)',
            lineHeight: '1.5',
          }}>
            {ext.description}
          </div>
        )}

        {/* U10: premium extension locked on the free tier */}
        {ext._locked && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 11px', borderRadius: 10,
            background: 'var(--surface)', border: '1px dashed var(--border)',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)', flex: 1 }}>Requires Authno Pro to activate.</span>
            <button
              data-ext-action="true"
              onClick={(e) => { e.stopPropagation(); openBilling(); }}
              style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 8, border: 'none', background: accentHex, color: '#fff', cursor: 'pointer' }}
            >
              Upgrade
            </button>
          </div>
        )}

        {/* Contribution chips — collapsible */}
        {!ext._locked && allContribs.length > 0 && (
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
                data-ext-action="true"
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
                  ? <><DSIcons.ChevronUp size={12} style={{ marginRight: 2 }} /> Show less</>
                  : <><DSIcons.ChevronDown size={12} style={{ marginRight: 2 }} /> {hiddenCount} more action{hiddenCount !== 1 ? 's' : ''}</>
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

      {contextMenu && createPortal(
        <>
          <div
            onClick={() => setContextMenu(null)}
            onTouchStart={() => setContextMenu(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          />
          <div
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 9999,
              minWidth: 190,
              background: 'rgba(15,15,18,0.98)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
              overflow: 'hidden',
              backdropFilter: 'blur(10px)',
            }}
          >
            <button
              data-ext-action="true"
              onClick={() => {
                setContextMenu(null);
                setDeleteConfirm(true);
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 14px',
                background: 'transparent',
                color: '#fca5a5',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <DSIcons.Trash size={15} />
              Remove extension
            </button>
          </div>
        </>,
        document.body
      )}

      {deleteConfirm && createPortal(
        <>
          <div
            onClick={() => setDeleteConfirm(false)}
            onTouchStart={() => setDeleteConfirm(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(0,0,0,0.65)',
              backdropFilter: 'blur(3px)',
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10000,
              width: 'min(92vw, 360px)',
              background: 'rgba(18,18,22,0.98)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 16,
              padding: 18,
              boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: '#ef444422', color: '#fca5a5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <DSIcons.Trash size={16} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'rgba(255,255,255,0.95)', fontWeight: 700, fontSize: 15 }}>
                  Remove extension?
                </div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>
                  {ext.name} ({ext.id})
                </div>
              </div>
            </div>

            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              This will delete the extension from the app. Any saved extension config will also be cleared.
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm(false)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.16)',
                  color: 'rgba(255,255,255,0.72)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: '#dc2626',
                  border: '1px solid #dc2626',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
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
  const { extensions, loading, refresh, installExtbk } = useExtensions();
  const [installing, setInstalling] = useState(false);

  // Manual "Install from file" — previously the ONLY install path was tapping
  // a .extbk in a system file manager; the tab itself offered nothing, and
  // with zero extensions it rendered null (a blank panel).
  const handleInstallFromFile = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      if (isAndroid()) {
        const { registerPlugin } = await import('@capacitor/core');
        const plugin = registerPlugin('AuthnoFilePicker');
        const res = await plugin.pickFile?.({ mimeTypes: ['*/*'], extension: 'extbk' });
        if (res?.base64) await installExtbk(res.base64);
      } else {
        await new Promise((resolve, reject) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.extbk,application/octet-stream';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return resolve();
            try {
              const buf = new Uint8Array(await file.arrayBuffer());
              let bin = ''; const CH = 0x8000;
              for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
              await installExtbk(btoa(bin));
              resolve();
            } catch (e) { reject(e); }
          };
          input.click();
        });
      }
    } catch (e) {
      // installExtbkBytes already emitted an error event for the InstallSheet.
      console.error('[ExtensionTab] install from file failed', e);
    } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: 12 }}>
        Loading extensions…
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Scrollable card list */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '10px 10px 4px',
        display: 'flex', flexDirection: 'column', gap: '8px',
      }}>
        {extensions.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            textAlign: 'center', gap: 10, padding: '36px 18px', color: 'var(--text-4)',
          }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--surface)', border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DSIcons.Extension size={22} color="currentColor" />
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-2)' }}>No extensions yet</div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              Extensions (.extbk files) add pages, actions and integrations to Authno.
              Install one below, or open a .extbk from your file manager.
            </div>
          </div>
        )}
        {extensions.map(ext => (
          <ExtensionCard
            key={ext.id}
            ext={ext}
            accentHex={accentHex}
            session={session}
            onClose={onClose}
          />
        ))}

        {/* Install from file */}
        <button
          onClick={handleInstallFromFile}
          disabled={installing}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            padding: '10px 0', borderRadius: 10, marginTop: extensions.length ? 2 : 0,
            background: 'var(--surface)', border: '1px dashed var(--border)',
            color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600,
            cursor: installing ? 'default' : 'pointer', opacity: installing ? 0.6 : 1,
          }}
        >
          <DSIcons.Download size={14} color="currentColor" />
          {installing ? 'Choosing file…' : 'Install from file (.extbk)'}
        </button>
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
          <DSIcons.Refresh size={12} />
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
          <DSIcons.FolderOpen size={13} />
        </button>
      </div>
    </div>
  );
}
