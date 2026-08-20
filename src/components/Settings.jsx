/**
 * Settings.jsx — Authno Settings Modal
 *
 * All shared UI primitives (Toggle, buttons, inputs, etc.) are now imported
 * from the DesignSystem folder. This file only contains app-specific logic.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMotionEnabled, PRESS, SPRING } from '../utils/motion';


// ── DesignSystem imports (all shared UI comes from here now) ──────────────────
import {
  Toggle, ColorSwatchRow,
  AboutSection,
  DSIcons,
  buildPalette,
  CloseButton,
  APP_META,
} from '../DesignSystem';

import { useTheme, ALL_THEMES, getAllThemes, subscribeThemes, injectThemeFonts } from '../theme';
import { ColorPicker } from './ColorPicker';
import { useExtensionContributions, useExtensions } from '../utils/ExtensionContext';
import ExtensionPage from './ExtensionPage';
import { isAndroid } from '../utils/platform';
import { APP_ICON_FAMILIES, appIconSupported, getAppIcon, setAppIcon, setAppIconAndRelaunch, appIconRelaunches } from '../utils/appIcon';
import { getErrorHistory, clearErrorHistory, formatBugReport } from '../utils/ErrorLogger';
import MembershipCard from './MembershipCard';
import { useEntitlement } from '../utils/useEntitlement';
import { openBilling } from '../utils/billingBus';
import {
  streaksEnabledGlobally, bookStreakPreference, withBookStreakPreference,
  reminderConfig, formatReminderTime, parseReminderTime,
} from '../utils/streakSettings';
import { checkNotificationPermission, requestNotificationPermission,
  checkBackgroundAllowed, openBackgroundSettings } from '../utils/reminders';
import { notifyNow, notifyResultText } from '../utils/notify';
import { isDevModeUnlocked, setDevModeUnlocked, tapVersion, tapHint } from '../utils/devMode';
import { buildReminder } from '../utils/reminderCopy';
import { bookStreakStats } from './Streak';
import { DEFAULT_WORD_GOAL } from './constants';

function useIsPortrait() {
  const [isPortrait, setIsPortrait] = useState(() => window.innerWidth < window.innerHeight || window.innerWidth < 600);
  useEffect(() => {
    const check = () => setIsPortrait(window.innerWidth < window.innerHeight || window.innerWidth < 600);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isPortrait;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCENT_PRESETS = [
  { label: 'Ember',  hex: '#ff4500' },
  { label: 'Ocean',  hex: '#3b82f6' },
  { label: 'Sage',   hex: '#22c55e' },
  { label: 'Violet', hex: '#a855f7' },
  { label: 'Rose',   hex: '#ec4899' },
  { label: 'Gold',   hex: '#f59e0b' },
];

// v1.1.18-beta.2 (Raycast-style shell): Startup merged into General, sidebar
// gets search + an account row, nav items get icon tiles. Groups render as
// separated blocks (no text headers), like the reference.
const NAV_ITEMS = [
  { id: 'general',    label: 'General',          icon: (p) => <DSIcons.User {...p} />,      group: 'User' },
  { id: 'appearance', label: 'Appearance',       icon: (p) => <DSIcons.Palette {...p} />,   group: 'User' },
  { id: 'editor',     label: 'Editor',           icon: (p) => <DSIcons.Edit {...p} />,      group: 'User' },
  { id: 'writing',    label: 'Writing Goal',     icon: (p) => <DSIcons.Target {...p} />,    group: 'User' },
  { id: 'shortcuts',  label: 'Shortcuts',        icon: (p) => <DSIcons.Lightning {...p} />, group: 'App'  },
  { id: 'data',       label: 'Data & Storage',   icon: (p) => <DSIcons.Package {...p} />,   group: 'App'  },
  { id: 'developer',  label: 'Developer',        icon: (p) => <DSIcons.Terminal {...p} />,  group: 'App'  },
  { id: 'about',      label: 'About',            icon: (p) => <DSIcons.Info {...p} />,      group: 'App'  },
];

// ── Settings search (Raycast-style) ──────────────────────────────────────────
// A static registry of individual settings so the sidebar search can jump
// straight to the tab that owns them. Pure data — costs nothing at rest.
const SETTINGS_INDEX = [
  ['general', 'Display name'], ['general', 'Avatar'], ['general', 'Startup behaviour'],
  ['general', 'Restore previously open books'], ['general', 'Vibration feedback'],
  ['general', 'Interface scale'],
  ['appearance', 'Theme'], ['appearance', 'Accent colour'], ['appearance', 'Background effect'],
  ['appearance', 'Fonts'], ['appearance', 'App icon'], ['appearance', 'Reduce animations'],
  ['appearance', 'Material You theme'],
  ['editor', 'Spell check'], ['editor', 'Manuscript width'], ['editor', 'Editor text size'],
  ['editor', 'Line spacing'], ['editor', 'Auto-save delay'], ['editor', 'Default chapter sort'],
  ['appearance', 'Download fonts from the web'],
  ['writing', 'Daily word goal'], ['writing', 'Writing streaks'],
  ['writing', 'Count writing streaks'], ['writing', 'Daily reminder'],
  ['shortcuts', 'Keyboard shortcuts'],
  ['data', 'Clear all sessions'], ['data', 'Storage & recovery'],
  ['developer', 'Error log'], ['developer', 'Copy diagnostics'], ['developer', 'Replay welcome slides'],
  ['developer', 'Guided tour'], ['developer', 'Reset all settings'],
  ['about', 'Version'], ["about", "What's new"], ['about', 'Credits'],
];

// ── Raycast-style row primitives ─────────────────────────────────────────────
// Rounded cards of rows: label (+ small muted description) on the left,
// control on the right, hairline separators between rows. Rows wrap on narrow
// screens so mobile stacks the control under the label. Pure CSS, theme vars.

function RGroupLabel({ children }) {
  return (
    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-3)', margin: '18px 2px 8px' }}>
      {children}
    </div>
  );
}

function RCard({ children, style }) {
  return (
    <div className="rcard" style={{
      background: 'var(--surface)', border: '1px solid var(--border-sm)',
      borderRadius: 12, overflow: 'hidden', ...style,
    }}>
      {children}
    </div>
  );
}

function RRow({ label, description, children }) {
  return (
    <div className="rrow" style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 14px',
      padding: '12px 14px', minHeight: 30,
    }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)' }}>{label}</div>
        {description && (
          <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 2, lineHeight: 1.45 }}>{description}</div>
        )}
      </div>
      <div style={{ flexShrink: 0, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

/** Compact segmented control (interface scale, text size, line spacing…). */
function Segmented({ options, value, onChange, accentHex }) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--surface-md)', border: '1px solid var(--border-sm)', borderRadius: 8, padding: 2, gap: 2 }}>
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <button key={String(v)} onClick={() => onChange(v)}
            style={{
              padding: '5px 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: on ? 700 : 500,
              background: on ? `${accentHex}2e` : 'transparent',
              color: on ? 'var(--text-1)' : 'var(--text-4)',
              transition: 'background 0.12s, color 0.12s', whiteSpace: 'nowrap',
            }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

const RSELECT_STYLE = {
  padding: '6px 10px', borderRadius: 7, background: 'var(--input-bg)',
  border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none',
  maxWidth: 200,
};

// ─── Local-only primitives (settings-specific layout, not shared UI) ──────────

function SectionTitle({ children }) {
  return <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-1)', marginBottom: '4px', letterSpacing: '-0.3px' }}>{children}</h2>;
}
function SectionSubtitle({ children }) {
  return <p style={{ fontSize: '13px', color: 'var(--text-4)', marginBottom: '24px' }}>{children}</p>;
}
function SettingsDivider() {
  return <div style={{ height: '1px', background: 'var(--border-sm)', margin: '24px 0' }} />;
}
function Label({ children }) {
  return (
    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>
      {children}
    </div>
  );
}

function SettingRow({ icon: Icon, title, description, children, accentHex }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', borderRadius: '8px',
      background: 'var(--surface)', border: '1px solid var(--border-sm)', gap: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
        {Icon && (
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${accentHex}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={15} color={accentHex} />
          </div>
        )}
        <div>
          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-2)' }}>{title}</div>
          {description && <div style={{ fontSize: '12px', color: 'var(--text-4)', marginTop: '2px' }}>{description}</div>}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ── App icon picker ──────────────────────────────────────────────────────────
// Flat, uniform grid (redesigned — the grouped tiles read as inconsistent).
// Dark is free; the Light family (Classic/Retro/Space Gold) is a Pro perk.
// The enabled launcher alias / persisted desktop pref is the source of truth,
// so the current pick is read on mount rather than from settings.
const APP_ICON_OPTIONS = APP_ICON_FAMILIES.flatMap((f) =>
  f.variants.map((v) => ({
    id: v.id,
    label: f.id === 'default' ? 'Dark' : v.label,
    preview: v.preview,
    premium: f.id !== 'default',
  }))
);

function AppIconPicker({ accentHex }) {
  const [selected, setSelected] = useState('default');
  const { isPro } = useEntitlement();
  const motionOK = useMotionEnabled();

  useEffect(() => {
    let alive = true;
    getAppIcon().then((id) => { if (alive) setSelected(id); });
    return () => { alive = false; };
  }, []);

  const pick = async (opt) => {
    if (opt.premium && !isPro) { openBilling(); return; }   // Pro-gated
    // Desktop: applying the icon relaunches the app so it updates everywhere
    // (window + taskbar). Confirm first since it restarts AuthNo.
    if (appIconRelaunches()) {
      if (opt.id === selected) return;
      const ok = window.confirm(`Apply the "${opt.label}" icon?\n\nAuthNo will restart so the new icon shows in the taskbar and window.`);
      if (!ok) return;
      setSelected(opt.id);
      try { await setAppIconAndRelaunch(opt.id); } catch { /* app is relaunching */ }
      return;
    }
    const prev = selected;
    setSelected(opt.id);
    try { await setAppIcon(opt.id); } catch { setSelected(prev); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Label>App icon</Label>
        {!isPro && <span style={{ fontSize: 10, fontWeight: 700, color: accentHex, background: `${accentHex}1e`, padding: '1px 7px', borderRadius: 999, position: 'relative', top: -4 }}>PRO</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 10 }}>
        {APP_ICON_OPTIONS.map((opt) => {
          const active = selected === opt.id;
          const locked = opt.premium && !isPro;
          return (
            <motion.button
              key={opt.id}
              onClick={() => pick(opt)}
              title={locked ? `${opt.label} — Pro` : opt.label}
              whileTap={motionOK ? PRESS : undefined}
              style={{
                position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                padding: '12px 8px', borderRadius: 14, cursor: 'pointer',
                background: active ? `${accentHex}14` : 'var(--surface)',
                border: `1.5px solid ${active ? accentHex : 'var(--border-sm)'}`,
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <span style={{
                width: 52, height: 52, borderRadius: 13, overflow: 'hidden',
                border: '1px solid var(--border-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)', opacity: locked ? 0.55 : 1,
              }}>
                <img src={opt.preview} alt={opt.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </span>
              <span style={{ fontSize: 11.5, fontWeight: active ? 700 : 500, color: active ? accentHex : 'var(--text-3)' }}>
                {opt.label}
              </span>
              {active && (
                <motion.span
                  initial={motionOK ? { scale: 0 } : false} animate={{ scale: 1 }} transition={SPRING}
                  style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: '50%', background: accentHex, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <DSIcons.Check size={11} color="var(--on-accent, #fff)" />
                </motion.span>
              )}
              {locked && !active && (
                <span style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: '50%', background: 'var(--surface-md)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <DSIcons.Lock size={10} color="var(--text-4)" />
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
      <p style={{ fontSize: '11px', color: 'var(--text-4)', marginTop: '10px' }}>
        {isAndroid()
          ? 'Changes the home-screen icon. On a few devices the launcher may briefly close the app to apply it.'
          : 'Changes the taskbar and window icon — AuthNo restarts to apply it everywhere. The installed desktop shortcut keeps its original icon.'}
      </p>
    </div>
  );
}

function ConfirmModal({ title, message, type, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--modal-overlay-bg, rgba(0,0,0,0.75))', backdropFilter: 'blur(4px)' }}>
      <div style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '28px', maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <DSIcons.Warning size={20} color={type === 'danger' ? 'var(--color-danger)' : 'var(--color-warning)'} />
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-1)' }}>{title}</span>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--text-4)', lineHeight: 1.5, marginBottom: '24px' }}>{message}</p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 20px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: type === 'danger' ? 'var(--color-danger)' : 'var(--color-warning)', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ─── Section Panels ───────────────────────────────────────────────────────────

// ── Background effect options ─────────────────────────────────────────────────
const BG_EFFECTS = [
  {
    id: 'none',
    label: 'None',
    description: 'Solid colour — no background effect',
    preview: (accent) => `linear-gradient(135deg, #111 60%, #1a1a1a)`,
  },
  {
    id: 'gradient',
    label: 'Gradient Blobs',
    description: 'Animated ambient blobs (default dark/light)',
    preview: (accent) => `radial-gradient(circle at 30% 40%, ${accent}55, transparent 50%), radial-gradient(circle at 70% 70%, ${accent}33, transparent 50%), #0a0a0a`,
  },
  {
    id: 'grain',
    label: 'Grainy Gradient',
    description: 'Static diagonal gradient with film grain texture',
    preview: () => `linear-gradient(135deg, #3d1a0a 0%, #0d0f2e 100%)`,
  },
];

function BackgroundEffectPicker({ value = 'none', onChange, accentHex, onOpenCustomizer }) {
  return (
    <div>
      <Label>Background Effect</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {BG_EFFECTS.map(effect => {
          const active = value === effect.id;
          return (
            <button
              key={effect.id}
              onClick={() => onChange(effect.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '11px 14px', borderRadius: 10,
                cursor: 'pointer', textAlign: 'left',
                background: active ? `${accentHex}18` : 'var(--surface)',
                border: `1px solid ${active ? accentHex + '55' : 'var(--border)'}`,
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: 40, height: 28, borderRadius: 6, flexShrink: 0,
                background: effect.preview(accentHex),
                border: '1px solid var(--border)',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: active ? accentHex : 'var(--text-2)', marginBottom: 2 }}>
                  {effect.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-5)', lineHeight: 1.4 }}>
                  {effect.description}
                </div>
              </div>
              {active && (
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: accentHex, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <DSIcons.Check size={10} color="var(--on-accent, #fff)" />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {value === 'gradient' && (
        <SettingRow icon={DSIcons.Sliders} title="Gradient Customizer" description="Fine-tune blob colours, count, and speed" accentHex={accentHex}>
          <button
            onClick={onOpenCustomizer}
            style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', background: `${accentHex}22`, color: accentHex, cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = `${accentHex}44`}
            onMouseLeave={e => e.currentTarget.style.background = `${accentHex}22`}
          >
            Open <DSIcons.ChevronRight size={14} />
          </button>
        </SettingRow>
      )}
    </div>
  );
}

function AppearancePanel({ settings, onChange, accentHex, onOpenCustomizer, onOpenFontCustomizer, switchTheme }) {
  // U4: subscribe to the registry so installed .thmbk themes appear live.
  const [themes, setThemes] = useState(() => ALL_THEMES.slice());
  useEffect(() => {
    setThemes(getAllThemes());
    return subscribeThemes((all) => setThemes(all.slice()));
  }, []);

  // Material You is a THEME now (see theme/ThemeMaterialYou.js). Prefetch the
  // system accent here so its picker card previews the real wallpaper colour
  // instead of the default violet.
  useEffect(() => {
    if (!isAndroid()) return undefined;
    let alive = true;
    (async () => {
      try {
        const [{ getMaterialYouAccent }, { setMaterialYouAccent }] = await Promise.all([
          import('../utils/materialYou'),
          import('../theme/ThemeMaterialYou'),
        ]);
        const hex = await getMaterialYouAccent();
        if (!alive) return;
        setMaterialYouAccent(hex);
        setThemes(getAllThemes()); // re-read: the Material You card is rebuilt with the real colour
      } catch { /* plugin missing — card keeps the base preview */ }
    })();
    return () => { alive = false; };
  }, []);

  const handleInstallTheme = useCallback(async () => {
    try {
      const { pickAndInstallThemeFile } = await import('../utils/themePicker');
      await pickAndInstallThemeFile();
    } catch (e) {
      console.error('[Settings] theme install failed', e);
    }
  }, []);

  const handleRemoveTheme = useCallback(async (themeId) => {
    try {
      const { uninstallTheme } = await import('../utils/themeLoader');
      await uninstallTheme(themeId);
      // If the removed theme was active, fall back to dark default.
      if ((settings.themeId ?? 'dark-default') === themeId) {
        const fallback = getAllThemes().find(t => t.meta.id === 'dark-default');
        if (fallback) { switchTheme(fallback); onChange({ themeId: 'dark-default' }); }
      }
    } catch (e) { console.error('[Settings] theme remove failed', e); }
  }, [settings.themeId, switchTheme, onChange]);

  return (
    <div>
      <SectionTitle>Appearance</SectionTitle>
      <SectionSubtitle>Personalise the look and feel of the editor.</SectionSubtitle>

      {/* Theme picker */}
      <Label>Theme</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
        {themes.map(t => {
          const active = (settings.themeId ?? 'dark-default') === t.meta.id;
          const installed = !!t.meta.installed;
          return (
            <button
              key={t.meta.id}
              onClick={() => { injectThemeFonts(t); switchTheme(t); onChange({ themeId: t.meta.id }); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '12px 14px', borderRadius: '10px',
                cursor: 'pointer', textAlign: 'left',
                background: active ? `${accentHex}18` : 'var(--surface)',
                border: `1px solid ${active ? accentHex + '55' : 'var(--border)'}`,
                transition: 'all 0.15s',
              }}
            >
              {/* Mini palette swatches */}
              <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                {[t.backgrounds.app, t.backgrounds.modal, t.accent.primary, t.text.t1].map((c, i) => (
                  <div key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(128,128,128,0.25)' }} />
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: active ? accentHex : 'var(--text-2)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t.meta.name}
                  {installed && <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 5, background: `${accentHex}22`, color: accentHex }}>INSTALLED</span>}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-5)', lineHeight: 1.4 }}>{t.meta.description || (installed ? `by ${t.meta.author || 'unknown'}` : '')}</div>
              </div>
              {installed && (
                <span
                  onClick={(e) => { e.stopPropagation(); handleRemoveTheme(t.meta.id); }}
                  title="Remove theme"
                  style={{ flexShrink: 0, color: 'var(--text-4)', padding: 4, cursor: 'pointer' }}
                >
                  <DSIcons.Trash size={15} color="currentColor" />
                </span>
              )}
              {active && (
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: accentHex, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Install downloadable theme (.thmbk) */}
      <button
        onClick={handleInstallTheme}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', padding: '11px 0', borderRadius: 10, marginBottom: 24,
          background: 'var(--surface)', border: '1px dashed var(--border)',
          color: 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <DSIcons.Download size={16} color="currentColor" /> Install a theme (.thmbk)
      </button>

      <SettingsDivider />

      {/* Accent Color — now uses DesignSystem ColorSwatchRow */}
      <Label>Accent Color</Label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
        <ColorSwatchRow
          colors={ACCENT_PRESETS.map(p => ({ label: p.label, value: p.hex }))}
          selected={settings.accentHex}
          onChange={hex => onChange({ accentHex: hex })}
          size={36}
        />
        <ColorPicker
          value={settings.accentHex || '#3b82f6'}
          onChange={hex => onChange({ accentHex: hex })}
        />
      </div>

      {/* Palette preview */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
        {Object.entries(buildPalette(settings.accentHex || accentHex)).map(([key, val]) => (
          <div key={key} style={{ flex: 1, borderRadius: '6px', height: '24px', background: val }} title={key} />
        ))}
      </div>

      <SettingsDivider />
      {/* Light Mode toggle removed (B2): light/dark is now chosen by picking a
          light or dark theme above. A separate toggle fought the theme engine. */}

      <SettingsDivider />

      {/* Typography — opens the Font Customizer (per-target fonts + upload) */}
      <Label>Typography</Label>
      <SettingRow icon={DSIcons.Text} title="Fonts" description="Choose fonts for the interface, editor and headings — or upload your own" accentHex={accentHex}>
        <button
          onClick={onOpenFontCustomizer}
          style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', background: `${accentHex}22`, color: accentHex, cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', transition: 'background 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background = `${accentHex}44`}
          onMouseLeave={e => e.currentTarget.style.background = `${accentHex}22`}
        >
          Customize <DSIcons.ChevronRight size={14} />
        </button>
      </SettingRow>

      {/* Vibration feedback moved to Settings → General (beta.1 regroup) —
          it's a device preference, not a look. */}

      <div style={{ height: 16 }} />

      {/* Reduce animations — also auto-on when the OS "reduce motion" setting is
          enabled (see MotionProvider). */}
      <SettingRow icon={DSIcons.Globe} title="Download fonts from the web" description="Off by default — AuthNo uses your device's own fonts and makes no network request. Turn on to fetch the font styles from Google." accentHex={accentHex}>
        <Toggle on={settings.webFonts ?? false} onChange={(v) => onChange({ webFonts: v })} accentHex={accentHex} ariaLabel="Download fonts from the web" />
      </SettingRow>

      <div style={{ height: 16 }} />

      <SettingRow icon={DSIcons.Lightning} title="Reduce animations" description="Minimise transitions and motion effects across the app" accentHex={accentHex}>
        <Toggle on={settings.reduceMotion ?? false} onChange={(v) => onChange({ reduceMotion: v })} accentHex={accentHex} />
      </SettingRow>

      {/* Material You lives in the theme grid above now — selecting the
          "Material You" theme follows the device light/dark and wallpaper
          accent. The old toggle here fought the custom accent and did
          nothing visible. */}

      <div style={{ height: 16 }} />

      {/* Background Effect dropdown */}
      <BackgroundEffectPicker
        value={settings.backgroundEffect ?? (settings.enableGradient ? 'gradient' : 'none')}
        onChange={(v) => onChange({ backgroundEffect: v, enableGradient: v === 'gradient' })}
        accentHex={accentHex}
        onOpenCustomizer={onOpenCustomizer}
      />

      {appIconSupported() && (
        <>
          <SettingsDivider />
          <AppIconPicker accentHex={accentHex} />
        </>
      )}
    </div>
  );
}

// ── General (Raycast-style, beta.2): profile · startup · device ─────────────
function GeneralPanel(props) {
  const { settings, onChange, accentHex, onSignOut } = props;
  const fileRef = useRef(null);
  const handleAvatarFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => onChange({ avatarDataUrl: reader.result });
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div>
      {/* Who you are on the account, above who you are on the page.
          This lived in Settings → About until now, filed with the version
          number and the open-source credits — so somebody looking for "my
          account" opened General, found a name field and an avatar, and had no
          reason to think their pen name, their invites or the way out were
          behind a tab labelled About.
          The two are different things and both belong here: the card is the
          identity the gate issued, the fields below are the byline that goes
          into a .authbook. About keeps what About means. */}
      <MembershipCard accentHex={accentHex} onSignOut={onSignOut} />

      <RGroupLabel>Profile</RGroupLabel>
      <RCard>
        <div className="rrow" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: `2px solid ${accentHex}`, background: 'var(--surface-md)' }}>
              {settings.avatarDataUrl
                ? <img src={settings.avatarDataUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><DSIcons.User size={20} color="var(--text-4)" /></div>}
            </div>
            <button onClick={() => fileRef.current?.click()} aria-label="Change avatar"
              style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: '50%', background: accentHex, border: '2px solid var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <DSIcons.Camera size={10} color="var(--on-accent, #fff)" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarFile} style={{ display: 'none' }} />
          </div>
          <input
            value={settings.displayName || ''}
            onChange={(e) => onChange({ displayName: e.target.value })}
            placeholder="Your name"
            style={{ flex: 1, minWidth: 120, padding: '9px 12px', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 13.5, outline: 'none' }}
            onFocus={(e) => { e.target.style.borderColor = accentHex; }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; }}
          />
          {settings.avatarDataUrl && (
            <button onClick={() => onChange({ avatarDataUrl: null })}
              style={{ padding: '7px 12px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', fontSize: 12 }}>
              Remove avatar
            </button>
          )}
        </div>
        <RRow label="Author stamp" description="Saved into your .authbook files as the author name">
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{(settings.displayName || '').trim() || 'Anonymous'}</span>
        </RRow>
      </RCard>

      <RGroupLabel>Startup</RGroupLabel>
      <RCard>
        <RRow label="When AuthNo opens" description="Resume drops you at your last caret position">
          <select value={settings.startupBehavior ?? 'last'} onChange={(e) => onChange({ startupBehavior: e.target.value })} style={RSELECT_STYLE}>
            <option value="resume">Resume writing</option>
            <option value="last">Reopen last book</option>
            <option value="blank">Open a blank book</option>
            <option value="home">Show home screen</option>
          </select>
        </RRow>
        {!isAndroid() && (
          <RRow label="Restore previously open books" description="Re-open every book that was open last session">
            <Toggle on={settings.restoreOpenBooks ?? true} onChange={(v) => onChange({ restoreOpenBooks: v })} accentHex={accentHex} />
          </RRow>
        )}
      </RCard>

      <RGroupLabel>Device</RGroupLabel>
      <RCard>
        <RRow label="Interface scale" description="Size of the whole interface on this device">
          <Segmented accentHex={accentHex}
            options={[[90, '90%'], [100, '100%'], [110, '110%']]}
            value={settings.uiScale ?? 100}
            onChange={(v) => onChange({ uiScale: v })} />
        </RRow>
        {isAndroid() && (
          <RRow label="Vibration feedback" description="Light tick on taps, stronger cues for saves, deletes and goals">
            <Toggle on={settings.hapticsEnabled ?? true} onChange={(v) => onChange({ hapticsEnabled: v })} accentHex={accentHex} />
          </RRow>
        )}
        <RRow label="Interface sounds" description="Quiet paper-and-brass cues for unlocking, saving and milestones">
          <Toggle on={settings.soundsEnabled ?? isAndroid()} onChange={(v) => onChange({ soundsEnabled: v })} accentHex={accentHex} />
        </RRow>
      </RCard>
    </div>
  );
}

// ── Editor settings (Raycast-style rows, beta.2) — all live-wired ───────────
function EditorPanel({ settings, onChange, accentHex }) {
  const android = isAndroid();
  return (
    <div>
      <RGroupLabel>Writing</RGroupLabel>
      <RCard>
        <RRow label="Spell check" description="Underline possible misspellings while you type (device dictionary)">
          <Toggle on={settings.spellcheck ?? true} onChange={(v) => onChange({ spellcheck: v })} accentHex={accentHex} />
        </RRow>
        <RRow label="Editor text size" description="Base size of your manuscript text">
          <Segmented accentHex={accentHex}
            options={[[14, 'S'], [16, 'M'], [18, 'L'], [20, 'XL']]}
            value={settings.editorFontSize ?? 16}
            onChange={(v) => onChange({ editorFontSize: v })} />
        </RRow>
        <RRow label="Line spacing" description="Breathing room between lines of prose">
          <Segmented accentHex={accentHex}
            options={[[1.5, 'Tight'], [1.7, 'Normal'], [2.0, 'Loose']]}
            value={settings.editorLineHeight ?? 1.7}
            onChange={(v) => onChange({ editorLineHeight: v })} />
        </RRow>
        {!android && (
          <RRow label="Manuscript width" description="Focused centres a ~72-character page-like column">
            <Segmented accentHex={accentHex}
              options={[['full', 'Full width'], ['focused', 'Focused']]}
              value={settings.editorWidth ?? 'full'}
              onChange={(v) => onChange({ editorWidth: v })} />
          </RRow>
        )}
      </RCard>

      <RGroupLabel>Book screen</RGroupLabel>
      <RCard>
        <RRow label="Default chapter sort" description="How the chapter list is ordered when you open a book">
          <Segmented accentHex={accentHex}
            options={[['story', 'Story order'], ['recent', 'Recently edited']]}
            value={settings.chapterSort ?? 'story'}
            onChange={(v) => onChange({ chapterSort: v })} />
        </RRow>
      </RCard>

      {android && (
        <>
          <RGroupLabel>Saving</RGroupLabel>
          <RCard>
            <RRow label="Auto-save delay" description="How long after you stop typing the silent auto-save runs">
              <select value={settings.autosaveDelaySec ?? 4} onChange={(e) => onChange({ autosaveDelaySec: Number(e.target.value) })} style={RSELECT_STYLE}>
                {[[2, '2 seconds'], [4, '4 seconds'], [10, '10 seconds'], [30, '30 seconds']].map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </RRow>
          </RCard>
        </>
      )}
    </div>
  );
}

// ── Shortcuts reference (v1.1.18-beta.1, "Standard set") ────────────────────
const SHORTCUTS = [
  ['App', [
    ['Search books, chapters & actions', 'Ctrl+K'],
    ['Settings', 'Ctrl+,'],
    ['New book', 'Ctrl+N'],
    ['Open a book file', 'Ctrl+O'],
    ['Notes', 'Ctrl+J'],
  ]],
  ['Book', [
    ['Save', 'Ctrl+S'],
    ['New chapter', 'Ctrl+Shift+N'],
    ['Export…', 'Ctrl+Shift+E'],
    ['Read aloud', 'Ctrl+Shift+R'],
    ['History panel', 'Ctrl+Shift+Z'],
  ]],
  ['Editor', [
    ['Chapter info', 'Ctrl+Alt+I'],
    ['Threads panel', 'Ctrl+Shift+T'],
    ['Find & replace', 'Ctrl+F'],
    ['Bold / Italic / Underline', 'Ctrl+B / I / U'],
    ['Undo / Redo typing', 'Ctrl+Z / Ctrl+Y'],
  ]],
];

function Kbd({ children }) {
  return (
    <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 7px', background: 'var(--surface)', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function ShortcutsPanel({ accentHex }) {
  return (
    <div>
      <SectionTitle>Keyboard shortcuts</SectionTitle>
      <SectionSubtitle>The same hints appear faded next to buttons and menu items around the app.</SectionSubtitle>
      {SHORTCUTS.map(([group, rows]) => (
        <div key={group} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: accentHex, textTransform: 'uppercase', letterSpacing: '0.7px', margin: '4px 0 6px' }}>{group}</div>
          {rows.map(([label, keys]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 2px', borderBottom: '1px solid var(--border-sm)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{label}</span>
              <Kbd>{keys}</Kbd>
            </div>
          ))}
        </div>
      ))}
      <div style={{ fontSize: 11.5, color: 'var(--text-5)', lineHeight: 1.6 }}>
        Shortcuts need a keyboard, so they apply on desktop (and tablets with one attached).
      </div>
    </div>
  );
}

// ── Developer options (v1.1.18-beta.1) ──────────────────────────────────────
// Outcome → colour. Deliberate skips are muted rather than warning-coloured:
// a book that was never saved to a file is not a fault to chase.
const OUTCOME_COLOR = {
  ok: 'var(--color-success, #3ba55d)',
  damaged: 'var(--color-danger, #ed4245)',
  unreadable: 'var(--color-danger, #ed4245)',
  missing: 'var(--color-warning, #f59e0b)',
  skipped: 'var(--text-5)',
};

function DeveloperPanel({ settings, accentHex, sessions = [], onSeeChanges, onStartTour, onReplayWelcome }) {
  const [showErrorLog, setShowErrorLog] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanCopied, setScanCopied] = useState(false);

  const runScan = async () => {
    setScanning(true);
    try {
      const { safeScanForBooks } = await import('../utils/bookScan');
      setScan(await safeScanForBooks(sessions));
    } finally {
      setScanning(false);
    }
  };

  const copyScan = async () => {
    if (!scan) return;
    const { formatScanReport } = await import('../utils/bookScan');
    const text = formatScanReport(scan);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      setScanCopied(true); setTimeout(() => setScanCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  };

  const copyDiagnostics = async () => {
    const { avatarDataUrl, ...safeSettings } = settings || {};
    const diag = {
      version: APP_META.version,
      platform: isAndroid() ? 'android' : (window.electron ? `electron-${window.electron.platform}` : 'web'),
      userAgent: navigator.userAgent,
      books: sessions.length,
      chapters: sessions.reduce((n, s) => n + (s.chapters || []).length, 0),
      settings: safeSettings,
      errors: getErrorHistory().length,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const resetSettings = () => {
    try { localStorage.removeItem('writerSettings'); localStorage.removeItem('writerCustomization'); } catch { /* ignore */ }
    window.location.reload();
  };

  const devBtn = (label, onClick, { danger = false, icon: Icon } = {}) => (
    <button onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 8, border: `1px solid ${danger ? 'rgba(237,66,69,0.4)' : 'var(--border)'}`, background: danger ? 'rgba(237,66,69,0.12)' : 'var(--surface-md)', color: danger ? '#ed4245' : 'var(--text-2)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
      {Icon && <Icon size={14} color="currentColor" />}{label}
    </button>
  );

  return (
    <div>
      <SectionTitle>Developer</SectionTitle>
      <SectionSubtitle>Diagnostics and under-the-hood tools. Nothing here touches your books.</SectionSubtitle>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {[['Version', `v${APP_META.version}`],
          ['Platform', isAndroid() ? 'Android' : (window.electron ? `Desktop (${window.electron.platform})` : 'Web')],
          ['Books in memory', String(sessions.length)]].map(([label, value]) => (
          <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border-sm)', borderRadius: 9, padding: '8px 12px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{value}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-5)', marginTop: 1 }}>{label}</div>
          </div>
        ))}
      </div>

      <SettingsDivider />
      <Label>Diagnostics</Label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {devBtn('View error log', () => setShowErrorLog(true), { icon: DSIcons.Bug })}
        {devBtn(scanning ? 'Scanning…' : 'Scan for books', runScan, { icon: DSIcons.Search })}
        {devBtn(copied ? 'Copied ✓' : 'Copy diagnostics', copyDiagnostics, { icon: DSIcons.Copy })}
      </div>

      {/* Scan results. Every file the scan touched, and what happened to it —
          including the ones that worked, because "it found nothing" and "it
          never looked" are different answers and used to be indistinguishable. */}
      {scan && (
        <div style={{ marginTop: 10, border: '1px solid var(--border-sm)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border-sm)' }}>
            {/* "0 of 2 opened" reads as a failure when in truth nothing needed
                opening — on desktop every entry is deliberately skipped. Count
                only what was actually examined, so a clean scan looks clean. */}
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>
              {(() => {
                const checked = scan.summary.examined - scan.summary.skipped;
                if (scan.summary.examined === 0) return 'Nothing found to examine';
                if (checked === 0) return `Nothing needed opening (${scan.summary.skipped} skipped)`;
                return `${scan.summary.ok} of ${checked} opened`;
              })()}
            </span>
            {scan.summary.problems > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-danger)', background: 'rgba(237,66,69,0.12)', borderRadius: 6, padding: '2px 7px' }}>
                {scan.summary.problems} problem{scan.summary.problems === 1 ? '' : 's'}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-5)' }}>{scan.durationMs} ms</span>
            <button onClick={copyScan}
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-md)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
              {scanCopied ? 'Copied ✓' : 'Copy report'}
            </button>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', padding: '8px 12px' }}>
            {scan.steps.map((st, i) => (
              <div key={`s${i}`} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '3px 0', color: 'var(--text-4)' }}>
                <span style={{ color: OUTCOME_COLOR[st.status] || 'var(--text-5)', fontWeight: 700, minWidth: 76 }}>{st.status}</span>
                <span style={{ color: 'var(--text-2)' }}>{st.name}</span>
                {st.detail && <span style={{ color: 'var(--text-5)' }}>— {st.detail}</span>}
              </div>
            ))}
            {scan.files.length > 0 && <div style={{ height: 1, background: 'var(--border-sm)', margin: '7px 0' }} />}
            {scan.files.map((f, i) => (
              <div key={`f${i}`} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '3px 0', alignItems: 'baseline' }}>
                <span style={{ color: OUTCOME_COLOR[f.outcome] || 'var(--text-5)', fontWeight: 700, minWidth: 76 }}>{f.outcome}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: 'var(--text-1)', wordBreak: 'break-word' }}>{f.name}</span>
                  {f.title && <span style={{ color: 'var(--text-4)' }}> — “{f.title}”, {f.chapters} chapter{f.chapters === 1 ? '' : 's'}</span>}
                  {f.detail && <div style={{ color: 'var(--text-5)' }}>{f.stage}: {f.detail}</div>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <SettingsDivider />
      <Label>Tours & guides</Label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {onReplayWelcome && devBtn('Replay welcome slides', onReplayWelcome, { icon: DSIcons.Rocket })}
        {onStartTour && devBtn('Guided tour', onStartTour, { icon: DSIcons.Sparkle })}
        {onSeeChanges && devBtn("What's new", onSeeChanges, { icon: DSIcons.Info })}
      </div>

      <SettingsDivider />
      <Label>Danger zone</Label>
      {!confirmReset ? (
        devBtn('Reset all settings…', () => setConfirmReset(true), { danger: true, icon: DSIcons.Warning })
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Settings and customisation reset to defaults (books are untouched). The app reloads.</span>
          {devBtn('Reset & reload', resetSettings, { danger: true })}
          {devBtn('Cancel', () => setConfirmReset(false))}
        </div>
      )}

      {showErrorLog && <ErrorLogModal onClose={() => setShowErrorLog(false)} accentHex={accentHex} />}
    </div>
  );
}

function WritingGoalPanel({ settings, onChange, accentHex, sessions = [], onSessionChange }) {
  const globalGoal = settings.dailyWordGoal ?? 500;
  const books = sessions.filter(s => s.type !== 'storyboard');
  const [selectedId, setSelectedId] = useState(() => {
    const saved = localStorage.getItem('streakSettings_selectedBookId');
    if (saved === '__global__') return '__global__';
    if (saved && books.some(b => b.id === saved)) return saved;
    return '__global__';
  });

  useEffect(() => {
    if (selectedId !== '__global__' && selectedId && !books.some(b => b.id === selectedId)) setSelectedId('__global__');
  }, [sessions]); // eslint-disable-line

  const handleSelectBook = (id) => { setSelectedId(id); localStorage.setItem('streakSettings_selectedBookId', id); };
  const selectedBook    = selectedId === '__global__' ? null : (books.find(b => b.id === selectedId) ?? null);
  const bookGoal        = selectedBook?.streak?.goalWords ?? null;
  const effectiveGoal   = bookGoal ?? globalGoal;
  const [inputVal, setInputVal] = useState(String(effectiveGoal));

  useEffect(() => { setInputVal(String(selectedBook?.streak?.goalWords ?? globalGoal)); }, [selectedId, globalGoal]); // eslint-disable-line

  const commit = () => {
    const n = parseInt(inputVal, 10);
    if (isNaN(n) || n <= 0) { setInputVal(String(effectiveGoal)); return; }
    if (selectedBook && onSessionChange) onSessionChange(selectedBook.id, { streak: { ...(selectedBook.streak ?? {}), goalWords: n } });
    else onChange({ dailyWordGoal: n });
  };

  const resetToGlobal = () => {
    if (!selectedBook || !onSessionChange) return;
    const updated = { ...(selectedBook.streak ?? {}) };
    delete updated.goalWords;
    onSessionChange(selectedBook.id, { streak: updated });
    setInputVal(String(globalGoal));
  };

  const presets = [100, 300, 500, 1000, 1500];
  const hasOverride = bookGoal !== null && bookGoal !== globalGoal;

  return (
    <div>
      <SectionTitle>Writing Goal</SectionTitle>
      <SectionSubtitle>Set a daily word goal per book. Each book can have its own target, or use the global default.</SectionSubtitle>

      {books.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <Label>Book</Label>
          <div style={{ position: 'relative' }}>
            <select
              value={selectedId ?? ''}
              onChange={e => handleSelectBook(e.target.value)}
              style={{ width: '100%', padding: '10px 36px 10px 14px', background: 'var(--input-bg)', border: `1px solid ${accentHex}55`, borderRadius: '10px', color: 'var(--text-1)', fontSize: '14px', fontWeight: 500, outline: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', transition: 'border-color 0.15s' }}
              onFocus={e => e.target.style.borderColor = accentHex}
              onBlur={e => e.target.style.borderColor = `${accentHex}55`}
            >
              <option value="__global__" style={{ background: 'var(--modal-bg)', color: 'var(--text-1)' }}>Global (default for all books)</option>
              {books.map(b => <option key={b.id} value={b.id} style={{ background: 'var(--modal-bg)', color: 'var(--text-1)' }}>{b.title || 'Untitled Book'}</option>)}
            </select>
            <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: accentHex, fontSize: '12px' }}>▾</div>
          </div>
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: hasOverride ? accentHex : 'var(--text-5)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {hasOverride ? (<><DSIcons.Pin size={11} color="currentColor" /> Custom goal for this book</>) : `Using global default (${globalGoal} words)`}
            </span>
            {hasOverride && <button onClick={resetToGlobal} style={{ fontSize: '11px', color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Reset to global</button>}
          </div>
        </div>
      )}

      {books.length === 0 && (
        <div style={{ marginBottom: '20px', padding: '12px 14px', background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border-sm)', fontSize: '13px', color: 'var(--text-4)' }}>
          No books yet. Create a book to set a per-book goal.
        </div>
      )}

      <Label>Daily Word Goal{selectedBook ? ` — ${selectedBook.title || 'Untitled'}` : ' (Global Default)'}</Label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <input
          type="number" min="1" value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()}
          style={{ width: '110px', padding: '10px 14px', background: 'var(--input-bg)', border: `1px solid ${hasOverride ? accentHex : 'var(--border)'}`, borderRadius: '8px', color: 'var(--text-2)', fontSize: '20px', fontWeight: 700, outline: 'none', transition: 'border-color 0.15s' }}
          onFocus={e => e.target.style.borderColor = accentHex}
        />
        <span style={{ fontSize: '14px', color: 'var(--text-4)' }}>words per day</span>
      </div>

      <Label>Quick Presets</Label>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '28px' }}>
        {presets.map(p => (
          <button
            key={p}
            onClick={() => {
              setInputVal(String(p));
              if (selectedBook && onSessionChange) onSessionChange(selectedBook.id, { streak: { ...(selectedBook.streak ?? {}), goalWords: p } });
              else onChange({ dailyWordGoal: p });
            }}
            style={{ padding: '6px 16px', borderRadius: '20px', border: `1.5px solid ${effectiveGoal === p ? accentHex : 'var(--border)'}`, background: effectiveGoal === p ? `${accentHex}20` : 'transparent', color: effectiveGoal === p ? accentHex : 'var(--text-4)', cursor: 'pointer', fontSize: '13px', fontWeight: effectiveGoal === p ? 600 : 400, transition: 'all 0.15s' }}
          >{p}</button>
        ))}
      </div>

      <SettingsDivider />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-sm)', borderRadius: '10px', padding: '14px 16px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { Icon: DSIcons.BookOpen, n: '150 words',  t: 'A short journal entry' },
            { Icon: DSIcons.Edit,     n: '500 words',  t: 'A focused session' },
            { Icon: DSIcons.Flame,    n: '1000 words', t: 'A strong daily output' },
            { Icon: DSIcons.Lightning,n: '1500 words', t: 'An average webnovel chapter' },
          ].map(({ Icon, n, t }) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={13} color={accentHex} />
              <span><strong style={{ color: 'var(--text-3)' }}>{n}</strong> — {t}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-5)' }}>
        Goals are saved inside each <code style={{ color: 'var(--text-4)' }}>.authbook</code> file and persist with your book.
      </div>

      <SettingsDivider />

      <StreakControls
        settings={settings}
        onChange={onChange}
        accentHex={accentHex}
        selectedBook={selectedBook}
        onSessionChange={onSessionChange}
      />
    </div>
  );
}

/**
 * Streaks: on or off, globally or for one book, plus the daily reminder.
 *
 * Lives under Writing Goal rather than in its own section because the goal
 * and the streak are the same idea seen twice — the streak is just the goal
 * counted across days — and separating them would mean two screens to visit
 * to turn one feature off.
 */
function StreakControls({ settings, onChange, accentHex, selectedBook, onSessionChange }) {
  const globalOn = streaksEnabledGlobally(settings);
  const bookPref = bookStreakPreference(selectedBook);
  const reminder = reminderConfig(settings);
  const [permission, setPermission] = useState(null);
  const [background, setBackground] = useState(null);
  const [testResult, setTestResult] = useState(null);

  // Only meaningful on Android, and only worth asking about once the reminder
  // is on — checking at mount would report "denied" for every desktop user.
  useEffect(() => {
    if (!isAndroid() || !reminder.enabled) { setPermission(null); return; }
    let alive = true;
    checkNotificationPermission().then((p) => { if (alive) setPermission(p); });
    // Asked at the same moment, because a granted permission and a dropped
    // alarm look identical from the writer's side — both are "it never went
    // off" — and only one of them is fixable from this screen.
    checkBackgroundAllowed().then((b) => { if (alive) setBackground(b); });
    return () => { alive = false; };
  }, [reminder.enabled]);

  /**
   * Send one now, through the same channel and permission a real reminder
   * uses. The words come from the same builder too, so what arrives is a
   * genuine sample rather than a placeholder that proves nothing.
   */
  const sendTest = async () => {
    setTestResult('sending');
    // The writer's real goal, resolved exactly the way every other row on this
    // screen resolves it: the book's own target if it has one, otherwise the
    // global default. This read settings.dailyGoal, which is not a key that
    // exists anywhere — so the test always announced a hardcoded 300 whatever
    // the writer had set. A test notification that shows the wrong number is
    // worth less than no test notification, because it certifies a lie.
    // Everything derived from the log, the way the flame derives it. Reading
    // `streak.current` and `streak.wordsToday` — which is what this did —
    // returns 0 forever: neither field exists on a session, so the test
    // notification announced a first day to writers on a fifty-day run.
    const stats = bookStreakStats(selectedBook, settings?.dailyWordGoal ?? DEFAULT_WORD_GOAL);
    const msg = buildReminder({
      streakDays: stats.streakDays,
      goalWords: stats.goalWords,
      wordsToday: stats.wordsToday,
      bookTitle: selectedBook?.title,
      hour: reminder.hour,
      // The writing day, and local. toISOString() is UTC, which puts half the
      // world on the wrong side of midnight — and this seeds which line the
      // copy picks, so a test would show a different sample than the reminder
      // it is meant to be previewing.
      dayKey: stats.dayKey,
    });
    const res = await notifyNow(msg);
    setTestResult(res);
    if (res === 'denied') setPermission('denied');
  };

  const setReminder = (patch) => onChange({ streakReminder: { ...reminder, ...patch } });

  const toggleReminder = async (on) => {
    if (!on) { setReminder({ enabled: false }); return; }
    // Ask at the moment it is switched on, not at launch. The system gives
    // one prompt; spending it before anyone has met the feature wastes it.
    const res = await requestNotificationPermission();
    setPermission(res);
    // Switched on either way. A refusal is the system's answer, not the
    // writer's, and silently flipping their toggle back would read as the
    // control being broken — the row below says what happened instead.
    setReminder({ enabled: true });
  };

  return (
    <div>
      <RGroupLabel>Streaks</RGroupLabel>
      <RCard>
        <RRow
          label="Count writing streaks"
          description="Track the days you hit your goal. Off means no counting, and no streak widget."
        >
          <Toggle on={globalOn} onChange={(v) => onChange({ streakEnabled: v })} accentHex={accentHex} ariaLabel="Count writing streaks" />
        </RRow>

        {selectedBook && (
          <>
            <div style={{ height: 1, background: 'var(--border-sm)' }} />
            <RRow
              label={`Count for “${selectedBook.title || 'Untitled'}”`}
              description={
                !globalOn
                  ? 'Streaks are off for every book while the switch above is off.'
                  : bookPref === null
                    ? 'Following the setting above.'
                    : bookPref
                      ? 'Always counted, even if you change your mind above.'
                      : 'This book is not counted. Others still are.'
              }
            >
              <Toggle
                ariaLabel={`Count streaks for ${selectedBook.title || 'this book'}`}
                on={bookPref === null ? globalOn : bookPref}
                disabled={!globalOn}
                onChange={(v) => onSessionChange?.(
                  selectedBook.id,
                  { streak: withBookStreakPreference(selectedBook, v) },
                )}
                accentHex={accentHex}
              />
            </RRow>
            {bookPref !== null && globalOn && (
              <div style={{ padding: '0 14px 12px', marginTop: -6 }}>
                <button
                  onClick={() => onSessionChange?.(
                    selectedBook.id,
                    { streak: withBookStreakPreference(selectedBook, null) },
                  )}
                  style={{ fontSize: 11, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >Follow the global setting</button>
              </div>
            )}
          </>
        )}
      </RCard>

      <RGroupLabel>Reminder</RGroupLabel>
      <RCard>
        <RRow
          label="Daily reminder"
          description={
            globalOn
              ? 'A quiet nudge if you have not written yet.'
              : 'Turn streaks on above to use a reminder.'
          }
        >
          <Toggle
            ariaLabel="Daily writing reminder"
            on={reminder.enabled && globalOn}
            disabled={!globalOn}
            onChange={toggleReminder}
            accentHex={accentHex}
          />
        </RRow>

        {reminder.enabled && globalOn && (
          <>
            <div style={{ height: 1, background: 'var(--border-sm)' }} />
            <RRow label="Time" description="On your device's clock.">
              <input
                type="time"
                value={formatReminderTime(reminder)}
                onChange={(e) => {
                  const parsed = parseReminderTime(e.target.value);
                  if (parsed) setReminder(parsed);
                }}
                style={{
                  padding: '7px 10px', background: 'var(--input-bg)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--text-1)', fontSize: 13.5, outline: 'none',
                  colorScheme: 'dark light',
                }}
              />
            </RRow>
            <div style={{ height: 1, background: 'var(--border-sm)' }} />
            <RRow
              label="Skip when the goal is met"
              description="Stay quiet on days you have already written enough."
            >
              <Toggle on={reminder.skipWhenMet} onChange={(v) => setReminder({ skipWhenMet: v })} accentHex={accentHex} ariaLabel="Skip the reminder when the goal is met" />
            </RRow>

            {/* The second slot. Off even when the first is on: two
                notifications a day is twice the intrusion and not the app's
                decision to make on somebody's lock screen. */}
            <div style={{ height: 1, background: 'var(--border-sm)' }} />
            <RRow
              label="A second reminder"
              description="Two a day — one earlier, one later. Each says something different."
            >
              <Toggle
                on={reminder.secondEnabled}
                onChange={(v) => setReminder({ secondEnabled: v })}
                accentHex={accentHex}
                ariaLabel="A second daily reminder"
              />
            </RRow>
            {reminder.secondEnabled && (
              <RRow label="Second time" description="On your device's clock.">
                <input
                  type="time"
                  aria-label="Second reminder time"
                  value={formatReminderTime({ hour: reminder.secondHour, minute: reminder.secondMinute })}
                  onChange={(e) => {
                    const parsed = parseReminderTime(e.target.value);
                    if (parsed) setReminder({ secondHour: parsed.hour, secondMinute: parsed.minute });
                  }}
                  style={{
                    padding: '7px 10px', background: 'var(--input-bg)',
                    border: '1px solid var(--border)', borderRadius: 8,
                    color: 'var(--text-1)', fontSize: 13.5, outline: 'none',
                    colorScheme: 'dark light',
                  }}
                />
              </RRow>
            )}

            {/* Prove the whole path, on this machine, now. */}
            <div style={{ height: 1, background: 'var(--border-sm)' }} />
            <RRow
              label="Send a test notification"
              description="Posts one right now, exactly the way a real reminder arrives."
            >
              <button
                onClick={sendTest}
                disabled={testResult === 'sending'}
                style={{
                  padding: '7px 13px', borderRadius: 8, cursor: testResult === 'sending' ? 'default' : 'pointer',
                  background: 'transparent', border: `1px solid ${accentHex}66`,
                  color: accentHex, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
                  opacity: testResult === 'sending' ? 0.5 : 1,
                }}
              >
                {testResult === 'sending' ? 'Sending…' : 'Send test'}
              </button>
            </RRow>
            {testResult && testResult !== 'sending' && (
              <div style={{ padding: '0 14px 12px', marginTop: -4, fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.5 }}>
                {notifyResultText(testResult)}
              </div>
            )}

            {/* The difference between a reminder that arrives and one that
                does not, on a great many devices — and invisible from
                everywhere else in the system. */}
            {background === 'restricted' && (
              <div style={{ padding: '0 14px 14px', fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.6 }}>
                Your device may stop AuthNo running in the background, which can
                delay a reminder or drop it entirely.{' '}
                <button
                  onClick={openBackgroundSettings}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: accentHex, fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
                    textDecoration: 'underline',
                  }}
                >
                  Allow it to run in the background
                </button>
              </div>
            )}
            {permission === 'denied' && (
              <div style={{ padding: '10px 14px 14px', fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.5 }}>
                Notifications are switched off for AuthNo in your system settings, so this
                reminder cannot appear. Everything else about streaks still works.
              </div>
            )}
          </>
        )}
      </RCard>
    </div>
  );
}


function AboutPanel({ accentHex, onSeeChanges, onStartTour }) {
  const { isPro } = useEntitlement();
  return (
    <div>
      <SectionTitle>About</SectionTitle>
      <SectionSubtitle>Version info, open-source credits and attribution.</SectionSubtitle>

      {/* Authno Pro (U10) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
        borderRadius: 14, marginBottom: 20,
        background: isPro ? `${accentHex}14` : 'var(--surface)',
        border: `1px solid ${isPro ? accentHex + '55' : 'var(--border)'}`,
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill={isPro ? accentHex : 'var(--text-4)'} style={{ flexShrink: 0 }}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
            {isPro ? 'Authno Pro — active' : 'Authno Pro'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 2 }}>
            {isPro ? 'Thanks for supporting independent development.' : 'Unlock premium extensions, themes and more.'}
          </div>
        </div>
        <button
          onClick={() => openBilling()}
          style={{
            flexShrink: 0, padding: '8px 14px', borderRadius: 10, border: 'none',
            background: isPro ? 'var(--surface-md)' : accentHex,
            color: isPro ? 'var(--text-2)' : '#fff',
            fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {isPro ? 'Manage' : 'Upgrade'}
        </button>
      </div>

      <AboutSection accentHex={accentHex} onSeeChanges={onSeeChanges} onStartTour={onStartTour} />
    </div>
  );
}

// ── Error log viewer ─────────────────────────────────────────────────────────
// The "View Log" button set showErrorLog=true but nothing ever rendered it —
// the modal simply didn't exist, so the log looked broken (reported on PC).
function ErrorLogModal({ onClose, accentHex }) {
  const entries = getErrorHistory();
  const [copied, setCopied] = useState(false);

  const copyReport = async () => {
    const text = formatBugReport(20);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--modal-overlay-bg, rgba(0,0,0,0.75))', backdropFilter: 'blur(4px)', padding: 16 }}
      onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: 16, width: 'min(560px, 96vw)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(0,0,0,0.55)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border-sm)' }}>
          <DSIcons.List size={18} color="var(--text-3)" />
          <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Error Log</span>
          <button onClick={copyReport} disabled={!entries.length}
            style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: entries.length ? `${accentHex}22` : 'var(--surface)', color: entries.length ? accentHex : 'var(--text-5)', cursor: entries.length ? 'pointer' : 'default', fontSize: 12.5, fontWeight: 600 }}>
            {copied ? 'Copied ✓' : 'Copy report'}
          </button>
          <button onClick={() => { clearErrorHistory(); onClose(); }} disabled={!entries.length}
            style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: entries.length ? 'var(--color-danger)' : 'var(--text-5)', cursor: entries.length ? 'pointer' : 'default', fontSize: 12.5, fontWeight: 600 }}>
            Clear
          </button>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {!entries.length ? (
            <div style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: 13, padding: '40px 0' }}>No errors recorded. 🎉</div>
          ) : entries.map((e) => (
            <div key={e.id} style={{ border: '1px solid var(--border-sm)', borderRadius: 10, padding: '10px 12px', marginBottom: 8, background: 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14 }}>{e.icon}</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)' }}>{e.category}</span>
                {/* Repeats are counted rather than duplicated, so the count is
                    the only thing showing that this is happening constantly. */}
                {e.count > 1 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', background: 'var(--surface-md)', borderRadius: 6, padding: '1px 6px' }}>
                    ×{e.count}
                  </span>
                )}
                {e.severity === 'data' && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--color-danger)', background: 'rgba(237,66,69,0.12)', borderRadius: 6, padding: '1px 6px' }}>
                    affects your work
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-5)' }}>{new Date(e.timestamp).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', wordBreak: 'break-word', fontFamily: 'var(--font-mono, monospace)' }}>{e.message}</div>
              {e.suggestion && <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 4 }}>{e.suggestion}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DataPanel({ settings, onChange, accentHex, onClearSessions, onOpenAbout }) {
  const { switchTheme } = useTheme();
  const [confirm, setConfirm]           = useState(null);
  const [importStatus, setImportStatus] = useState(null);
  const [showErrorLog, setShowErrorLog] = useState(false);
  const [errorCount, setErrorCount]     = useState(() => getErrorHistory().length);
  const { refresh } = useExtensions();
  const fileRef = useRef(null);

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportStatus('loading');
    try {
      const { installExtbkBytes } = await import('../utils/extbkInstaller');
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let bin = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const manifest = await installExtbkBytes(btoa(bin));
      await refresh();
      setImportStatus({ ok: true, message: `"${manifest.name}" installed successfully.` });
    } catch (err) {
      setImportStatus({ ok: false, message: err.message || 'Failed to import extension.' });
    }
    setTimeout(() => setImportStatus(null), 4000);
  };

  const actions = [
    {
      id: 'clearSessions', icon: DSIcons.Trash, label: 'Clear All Sessions', color: '#ed4245',
      description: 'Removes all writing sessions from local storage',
      modal: { title: 'Clear All Sessions?', message: 'This will permanently delete all your writing sessions. Your files on disk will not be affected.', type: 'danger', onConfirm: () => { onClearSessions(); setConfirm(null); } },
    },
    {
      id: 'resetSettings', icon: DSIcons.Refresh, label: 'Reset Settings to Default', color: '#faa61a',
      description: 'Resets appearance, startup, and profile to defaults',
      modal: { title: 'Reset All Settings?', message: 'Your profile, appearance, and startup preferences will be restored to their defaults. Sessions will not be affected.', type: 'warning',
        onConfirm: () => {
          // Complete reset — previously an incomplete hand-picked subset that
          // left themeId, backgroundEffect and dailyWordGoal untouched.
          onChange({ ...DEFAULT_SETTINGS });
          try {
            const dark = getAllThemes().find(t => t.meta.id === 'dark-default');
            if (dark) { injectThemeFonts(dark); switchTheme(dark); }
          } catch { /* theme reset best-effort */ }
          setConfirm(null);
        },
      },
    },
  ];

  return (
    <div>
      <SectionTitle>Data Management</SectionTitle>
      <SectionSubtitle>Manage stored data and reset the application state.</SectionSubtitle>

      <Label>Diagnostics</Label>
      <div style={{ padding: '14px 16px', borderRadius: '10px', marginBottom: '20px', border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--surface-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <DSIcons.List size={15} color="var(--text-4)" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-2)' }}>Error Log</div>
          <div style={{ fontSize: '12px', color: 'var(--text-4)', marginTop: '2px' }}>{errorCount > 0 ? `${errorCount} error${errorCount === 1 ? '' : 's'} recorded — tap to review` : 'No errors recorded'}</div>
        </div>
        <button onClick={() => { setErrorCount(getErrorHistory().length); setShowErrorLog(true); }} style={{ padding: '7px 16px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--surface-md)', color: 'var(--text-2)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {errorCount > 0 && <span style={{ fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>{errorCount}</span>}
          View Log
        </button>
      </div>

      
      {/* About button */}
      <div style={{ padding: '14px 16px', borderRadius: '10px', marginBottom: '20px', border: `1px solid ${accentHex}22`, background: `${accentHex}08`, display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${accentHex}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <DSIcons.Info size={15} color={accentHex} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-2)' }}>About Authno</div>
          <div style={{ fontSize: '12px', color: 'var(--text-4)', marginTop: '2px' }}>Version info, open-source credits and attribution</div>
        </div>
        <button
          onClick={onOpenAbout}
          style={{ padding: '7px 16px', borderRadius: '7px', border: `1px solid ${accentHex}44`, background: `${accentHex}18`, color: accentHex, cursor: 'pointer', fontSize: '13px', fontWeight: 600, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          Open <DSIcons.ChevronRight size={13} />
        </button>
      </div>

      <SettingsDivider />
      <Label>Extensions</Label>
      <div style={{ padding: '14px 16px', borderRadius: '10px', marginBottom: '20px', border: `1px solid ${accentHex}22`, background: `${accentHex}08`, display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${accentHex}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <DSIcons.PackagePlus size={15} color={accentHex} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-2)' }}>Import Extension</div>
          <div style={{ fontSize: '12px', color: 'var(--text-4)', marginTop: '2px' }}>Select a <code style={{ color: 'var(--text-3)' }}>.extbk</code> file to install an extension</div>
          {importStatus && importStatus !== 'loading' && (
            <div style={{ marginTop: '6px', fontSize: '12px', fontWeight: 500, color: importStatus.ok ? 'var(--color-success)' : 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              {importStatus.ok ? <DSIcons.Check size={12} /> : <DSIcons.Warning size={12} />}{importStatus.message}
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".extbk" onChange={handleImportFile} style={{ display: 'none' }} />
        <button onClick={() => fileRef.current?.click()} disabled={importStatus === 'loading'} style={{ padding: '7px 16px', borderRadius: '7px', border: `1px solid ${accentHex}44`, background: importStatus === 'loading' ? `${accentHex}10` : `${accentHex}18`, color: accentHex, cursor: importStatus === 'loading' ? 'wait' : 'pointer', fontSize: '13px', fontWeight: 600, flexShrink: 0, opacity: importStatus === 'loading' ? 0.6 : 1 }}>
          {importStatus === 'loading' ? 'Importing…' : 'Import'}
        </button>
      </div>

      <SettingsDivider />
      <Label>Danger Zone</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {actions.map(action => (
          <div key={action.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: '10px', border: `1px solid ${action.color}22`, background: `${action.color}0a`, gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${action.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <action.icon size={15} color={action.color} />
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-2)' }}>{action.label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-4)', marginTop: '2px' }}>{action.description}</div>
              </div>
            </div>
            <button onClick={() => setConfirm(action.modal)} style={{ padding: '7px 16px', borderRadius: '7px', border: `1px solid ${action.color}44`, background: `${action.color}18`, color: action.color, cursor: 'pointer', fontSize: '13px', fontWeight: 600, flexShrink: 0 }}>
              {action.label.split(' ')[0]}
            </button>
          </div>
        ))}
      </div>

      {confirm && <ConfirmModal title={confirm.title} message={confirm.message} type={confirm.type} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
      {showErrorLog && <ErrorLogModal onClose={() => { setShowErrorLog(false); setErrorCount(getErrorHistory().length); }} accentHex={accentHex} />}
    </div>
  );
}

// ─── Main Settings Component ──────────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  displayName: '',
  avatarDataUrl: null,
  accentHex: '#5a00d9',
  themeId: 'dark-default',
  backgroundEffect: 'none',   // 'none' | 'gradient' | 'grain'
  enableGradient: false,       // kept for backward compat
  lightMode: false,
  startupBehavior: 'last',
  restoreOpenBooks: true,
  dailyWordGoal: 500,
  hapticsEnabled: true,
  // Sound defaults on for phones (where it reads as polish) and off on
  // desktop, where an unexpected noise from a writing app is an intrusion.
  soundsEnabled: isAndroid(),
  reduceMotion: false,         // when true (or OS reduce-motion), animations are minimised
  // materialYou toggle removed in beta.4 — Material You is a theme now
  // (theme/ThemeMaterialYou.js); the old flag migrates to authno_theme_id.
  // Editor tab (v1.1.18-beta.1) — all live-wired:
  spellcheck: true,            // contentEditable spellCheck attribute
  editorWidth: 'full',         // 'full' | 'focused' (desktop manuscript column)
  autosaveDelaySec: 4,         // Android silent auto-save debounce
  // beta.2 (Raycast-style settings round) — all live-wired:
  uiScale: 100,                // whole-interface zoom (90/100/110)
  editorFontSize: 16,          // manuscript base font size
  editorLineHeight: 1.7,       // manuscript line spacing
  chapterSort: 'story',        // BookStudio default chapter ordering
  // Off by default: fetching one means a request to Google carrying an IP
  // and a User-Agent on every launch, which the offline promise does not
  // cover. Device fonts are used until this is switched on.
  webFonts: false,
};

export function Settings({ isOpen, onClose, settings = DEFAULT_SETTINGS, onSave, onClearSessions, onOpenCustomizer, onOpenFontCustomizer, sessions = [], onSessionChange, onSeeChanges, onStartTour, onReplayWelcome, onSignOut }) {
  const { switchTheme } = useTheme();
  const [activeSection, setActiveSection] = useState('general');
  const [query, setQuery] = useState('');           // sidebar settings search (beta.2)
  const isPortrait = useIsPortrait();

  const extSettingsItems = useExtensionContributions('settings');

  // Developer options are diagnostics — a book scanner, an error log — and a
  // "Developer" tab in a writing app invites poking that support then has to
  // explain. Seven taps on the version is the oldest gesture on Android:
  // nobody arrives by accident, and anybody who has been told can get there
  // in four seconds. See utils/devMode.js.
  const [devUnlocked, setDevUnlocked] = useState(isDevModeUnlocked);
  const [tapState, setTapState] = useState(null);
  const onVersionTap = () => {
    const next = tapVersion(tapState);
    setTapState(next);
    if (next.unlocked) { setDevModeUnlocked(true); setDevUnlocked(true); }
  };

  /**
   * The version line, and the only way in to developer options.
   *
   * It used to be rendered inside the desktop sidebar branch, which portrait
   * does not have — so on a phone, which is every Android install, there was
   * no version to tap and the gesture could not be performed at all. Rendered
   * from one place now, in both layouts, so the two cannot drift again.
   */
  const versionLine = (style = {}) => (
    <button
      type="button"
      onClick={onVersionTap}
      title={devUnlocked ? 'Developer options are on' : undefined}
      style={{
        padding: '8px 8px 2px', fontSize: 10.5,
        color: 'var(--text-5)', background: 'none', border: 'none',
        textAlign: 'left', cursor: 'default', fontFamily: 'inherit',
        ...style,
      }}
    >
      AuthNo v{APP_META.version}
      {/* Silent for the first four taps, so a stray double-tap never produces
          a mysterious countdown. */}
      {!devUnlocked && tapHint(tapState) && (
        <span style={{ marginLeft: 6, color: 'var(--text-4)' }}>· {tapHint(tapState)}</span>
      )}
    </button>
  );

  const isExtSection = extSettingsItems.some(item => activeSection === `ext::${item._extId}::${item.id}`);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleChange = useCallback((patch) => { onSave?.({ ...settings, ...patch }); }, [settings, onSave]);

  const accentHex = settings.accentHex || '#3b82f6';

  const allNavItems = [
    ...NAV_ITEMS.filter((i) => i.id !== 'developer' || devUnlocked),
    ...extSettingsItems.map(item => ({
      id:    `ext::${item._extId}::${item.id}`,
      label: item.label,
      icon:  (() => {
        const DS_MAP = { Cloud: 'Cloud', Puzzle: 'Extension', Upload: 'Upload', Settings2: 'Settings',
          HardDrive: 'Package', Server: 'Package', Box: 'Package', Database: 'Package',
          BookOpen: 'BookOpen', Zap: 'Lightning' };
        const dsKey = item.icon && DS_MAP[item.icon];
        if (dsKey && DSIcons[dsKey]) { const Mapped = DSIcons[dsKey]; return (props) => <Mapped {...props} />; }
        const fallback = item._extIcon ?? item.icon;
        if (!fallback) return (props) => <DSIcons.Extension {...props} />;
        return () => <span style={{ fontSize: '16px', lineHeight: 1 }}>{fallback}</span>;
      })(),
      group: 'Extensions',
      _extItem: item,
    })),
  ];

  const panelProps = { settings, onChange: handleChange, accentHex, sessions, onSessionChange };

  // ── Sidebar search (Raycast-style): match tabs and individual settings ────
  const q = query.trim().toLowerCase();
  const tabMatches = q ? allNavItems.filter((i) => i.label.toLowerCase().includes(q)) : [];
  const settingMatches = q
    ? SETTINGS_INDEX.filter(([, label]) => label.toLowerCase().includes(q)).slice(0, 10)
    : [];
  const jumpTo = (tab) => { setActiveSection(tab); setQuery(''); };

  // One panel switch for both orientations (they used to be duplicated).
  const renderPanel = () => (
    <>
      {activeSection === 'general'    && <GeneralPanel    {...panelProps} onSignOut={onSignOut} />}
      {activeSection === 'appearance' && <AppearancePanel {...panelProps} onOpenCustomizer={onOpenCustomizer} onOpenFontCustomizer={onOpenFontCustomizer} switchTheme={switchTheme} />}
      {activeSection === 'writing'    && <WritingGoalPanel {...panelProps} />}
      {activeSection === 'editor'     && <EditorPanel     {...panelProps} />}
      {activeSection === 'shortcuts'  && <ShortcutsPanel accentHex={accentHex} />}
      {activeSection === 'developer'  && <DeveloperPanel settings={settings} accentHex={accentHex} sessions={sessions} onSeeChanges={onSeeChanges} onStartTour={onStartTour} onReplayWelcome={onReplayWelcome} />}
      {activeSection === 'about'      && <AboutPanel accentHex={accentHex} onSeeChanges={onSeeChanges} onStartTour={onStartTour} />}
      {activeSection === 'data'       && <DataPanel       settings={settings} onChange={handleChange} accentHex={accentHex} onClearSessions={onClearSessions} onOpenAbout={() => setActiveSection('about')} />}
      {allNavItems.filter(i => i._extItem).map(item => (
        activeSection === item.id && <ExtensionPage key={item.id} extension={item._extItem._ext} pageId={item._extItem.page} session={null} accentHex={accentHex} onBack={() => setActiveSection('general')} inline />
      ))}
    </>
  );

  // Icon inside a small rounded tile — the Raycast sidebar look.
  const iconTile = (item, active) => (
    <span style={{
      width: 24, height: 24, borderRadius: 6, flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: active ? `${accentHex}2e` : 'var(--surface-md)',
      color: active ? accentHex : 'var(--text-3)',
    }}>
      {item._extItem ? <item.icon /> : <item.icon size={13} color="currentColor" />}
    </span>
  );

  const navButton = (item, { compact = false } = {}) => {
    const active = activeSection === item.id;
    return (
      <button key={item.id} className="settings-nav-item" onClick={() => jumpTo(item.id)}
        style={{
          width: compact ? undefined : '100%',
          display: 'flex', alignItems: 'center', gap: 9,
          padding: compact ? '7px 12px 7px 8px' : '6px 8px',
          borderRadius: 8, border: 'none',
          background: active ? 'var(--surface)' : 'transparent',
          color: active ? 'var(--text-1)' : 'var(--text-3)',
          cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500,
          textAlign: 'left', whiteSpace: 'nowrap', flexShrink: 0,
          transition: 'background 0.12s, color 0.12s',
        }}>
        {iconTile(item, active)}
        {item.label}
      </button>
    );
  };

  const searchInput = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface)', border: '1px solid var(--border-sm)', borderRadius: 8, padding: '0 9px' }}>
      <DSIcons.Search size={13} color="var(--text-5)" />
      <input
        value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Search settings…"
        style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: 'var(--text-1)', fontSize: 12.5, padding: '7px 0' }}
      />
      {query && (
        <button onClick={() => setQuery('')} aria-label="Clear search"
          style={{ border: 'none', background: 'transparent', color: 'var(--text-5)', cursor: 'pointer', padding: 2, display: 'flex' }}>
          <DSIcons.X size={12} color="currentColor" />
        </button>
      )}
    </div>
  );

  // Search results (replaces the nav while typing, like the reference).
  const searchResults = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {tabMatches.map((item) => navButton(item))}
      {settingMatches.length > 0 && (
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-5)', padding: '10px 8px 4px' }}>Settings</div>
      )}
      {settingMatches.map(([tab, label]) => {
        const owner = allNavItems.find((i) => i.id === tab);
        return (
          <button key={`${tab}-${label}`} className="settings-nav-item" onClick={() => jumpTo(tab)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 12.5, textAlign: 'left' }}>
            {owner ? iconTile(owner, false) : null}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          </button>
        );
      })}
      {tabMatches.length === 0 && settingMatches.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-5)', padding: '12px 8px' }}>No matches.</div>
      )}
    </div>
  );

  // Nav groups render as separated blocks (no text headers), Raycast-style.
  const navGroups = ['User', 'App', 'Extensions']
    .map((g) => allNavItems.filter((i) => i.group === g))
    .filter((items) => items.length > 0);

  const contentStyle = isExtSection
    ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }
    : { flex: 1, overflowY: 'auto', padding: isPortrait ? '14px 14px 32px' : '22px 28px 40px', position: 'relative' };

  const panelColumn = isExtSection ? renderPanel() : (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>{renderPanel()}</div>
  );

  return (
    <AnimatePresence>
    {isOpen && (
    <motion.div
      key="settings-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--modal-overlay-bg, rgba(0,0,0,0.75))', backdropFilter: 'blur(6px)', padding: isPortrait ? '0' : '16px' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`
        .settings-nav-item:hover { background: var(--surface) !important; color: var(--text-2) !important; }
        .settings-content::-webkit-scrollbar { width: 4px; }
        .settings-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        .settings-tabs::-webkit-scrollbar { display: none; }
        .rcard .rrow + .rrow { border-top: 1px solid var(--border-sm); }
      `}</style>

      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 6 }} transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
        style={{
        width: isPortrait ? '100vw' : '90vw', maxWidth: isPortrait ? '100vw' : '880px',
        height: isPortrait ? '100dvh' : '82vh', maxHeight: isPortrait ? '100dvh' : '700px',
        display: 'flex', flexDirection: isPortrait ? 'column' : 'row',
        borderRadius: isPortrait ? '0' : '16px', overflow: 'hidden',
        background: 'var(--modal-bg)',
        border: isPortrait ? 'none' : '1px solid var(--border)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
      }}>

        {isPortrait ? (
          <>
            {/* ── Mobile: header + search + icon-tile tab strip ── */}
            <div style={{ padding: '14px 14px 10px', background: 'var(--nav-bg)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.2px' }}>Settings</span>
                <CloseButton onClick={onClose} />
              </div>
              {searchInput}
            </div>
            {q ? (
              <div className="settings-content" style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                {searchResults}
              </div>
            ) : (
              <>
                <div className="settings-tabs" style={{ display: 'flex', overflowX: 'auto', gap: 4, padding: '0 12px 10px', background: 'var(--nav-bg)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  {allNavItems.map((item) => navButton(item, { compact: true }))}
                </div>
                <div className="settings-content" style={contentStyle}>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={activeSection}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                      style={isExtSection ? { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } : undefined}>
                      {panelColumn}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </>
            )}
            {versionLine({
              flexShrink: 0,
              borderTop: '1px solid var(--border-sm)',
              background: 'var(--nav-bg)',
              padding: '8px 14px calc(8px + env(safe-area-inset-bottom, 0px))',
            })}
          </>
        ) : (
          <>
            {/* ── Desktop: Raycast-style sidebar ── */}
            <div style={{ width: 230, flexShrink: 0, background: 'var(--nav-bg)', padding: '14px 10px 10px', display: 'flex', flexDirection: 'column', gap: 10, borderRight: '1px solid var(--border-sm)', overflowY: 'auto' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)', padding: '0 4px' }}>Settings</div>
              {searchInput}
              {q ? searchResults : (
                <>
                  {/* Account row → General (profile lives there) */}
                  <button className="settings-nav-item" onClick={() => jumpTo('general')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 9, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ width: 30, height: 30, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--surface-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {settings.avatarDataUrl
                        ? <img src={settings.avatarDataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <DSIcons.User size={14} color="var(--text-4)" />}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(settings.displayName || '').trim() || 'Anonymous'}
                      </span>
                      <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-5)' }}>Profile</span>
                    </span>
                  </button>

                  {navGroups.map((items, gi) => (
                    <div key={gi} style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: gi > 0 ? 10 : 0, borderTop: gi > 0 ? '1px solid var(--border-sm)' : 'none' }}>
                      {items.map((item) => navButton(item))}
                    </div>
                  ))}
                  {versionLine({ marginTop: 'auto' })}
                </>
              )}
            </div>
            {/* Content */}
            <div className="settings-content" style={contentStyle}>
              {!isExtSection && (
                <div style={{ position: 'sticky', top: 0, height: 0, zIndex: 5 }}>
                  <CloseButton onClick={onClose} style={{ position: 'absolute', top: '0px', right: '0px' }} />
                </div>
              )}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={activeSection}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                  style={isExtSection ? { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } : undefined}>
                  {panelColumn}
                </motion.div>
              </AnimatePresence>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
