/**
 * Settings.jsx — Authno Settings Modal
 *
 * All shared UI primitives (Toggle, buttons, inputs, etc.) are now imported
 * from the DesignSystem folder. This file only contains app-specific logic.
 */

import { useState, useEffect, useRef, useCallback } from 'react';


// ── DesignSystem imports (all shared UI comes from here now) ──────────────────
import {
  COLORS, TYPOGRAPHY,
  Toggle, ColorSwatchRow,
  AboutSection,
  DSIcons,
  buildPalette,
} from '../DesignSystem';

import { useTheme, ALL_THEMES, injectThemeFonts } from '../theme';
import { ColorPicker } from './ColorPicker';
import { useExtensionContributions, useExtensions } from '../utils/ExtensionContext';
import ExtensionPage from './ExtensionPage';
import { isAndroid } from '../utils/platform';
import { getErrorHistory, clearErrorHistory, formatBugReport } from '../utils/ErrorLogger';

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

const NAV_ITEMS = [
  { id: 'profile',    label: 'Profile',         icon: (p) => <DSIcons.User {...p} />,     group: 'User' },
  { id: 'appearance', label: 'Appearance',       icon: (p) => <DSIcons.Palette {...p} />,  group: 'User' },
  { id: 'writing',    label: 'Writing Goal',     icon: (p) => <DSIcons.Target {...p} />,   group: 'User' },
  { id: 'startup',    label: 'Startup Behavior', icon: (p) => <DSIcons.BookOpen {...p} />, group: 'App'  },
  { id: 'data',       label: 'Data Management',  icon: (p) => <DSIcons.Package {...p} />, group: 'App'  },
  { id: 'about',      label: 'About',            icon: (p) => <DSIcons.Info {...p} />,     group: 'App'  },
];

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

function ConfirmModal({ title, message, type, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div style={{ background: 'var(--modal-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '28px', maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <DSIcons.Warning size={20} color={type === 'danger' ? '#ed4245' : '#faa61a'} />
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-1)' }}>{title}</span>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--text-4)', lineHeight: 1.5, marginBottom: '24px' }}>{message}</p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 20px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: type === 'danger' ? '#ed4245' : '#faa61a', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ─── Section Panels ───────────────────────────────────────────────────────────

function ProfilePanel({ settings, onChange, accentHex }) {
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
      <SectionTitle>Profile</SectionTitle>
      <SectionSubtitle>Manage how you appear in the app.</SectionSubtitle>

      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '24px' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden', border: `3px solid ${accentHex}`, background: 'var(--surface-md)' }}>
            {settings.avatarDataUrl
              ? <img src={settings.avatarDataUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><DSIcons.User size={32} color="var(--text-4)" /></div>
            }
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            style={{ position: 'absolute', bottom: 0, right: 0, width: '26px', height: '26px', borderRadius: '50%', background: accentHex, border: '2px solid var(--modal-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <DSIcons.Camera size={12} color="#fff" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarFile} style={{ display: 'none' }} />
        </div>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-1)' }}>{settings.displayName || 'Anonymous'}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-4)', marginTop: '2px' }}>Click the camera to update your avatar</div>
        </div>
      </div>

      <Label>Display Name</Label>
      <input
        value={settings.displayName || ''}
        onChange={(e) => onChange({ displayName: e.target.value })}
        placeholder="Your name"
        style={{ width: '100%', padding: '10px 14px', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-2)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
        onFocus={e => e.target.style.borderColor = accentHex}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />

      {settings.avatarDataUrl && (
        <>
          <SettingsDivider />
          <button onClick={() => onChange({ avatarDataUrl: null })} style={{ padding: '8px 16px', borderRadius: '8px', background: 'rgba(237,66,69,0.15)', border: '1px solid rgba(237,66,69,0.3)', color: '#ed4245', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
            Remove Avatar
          </button>
        </>
      )}
    </div>
  );
}


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
                padding: '11px 14px', borderRadius: 10, border: 'none',
                cursor: 'pointer', textAlign: 'left',
                background: active ? `${accentHex}18` : 'var(--surface)',
                border: `1px solid ${active ? accentHex + '55' : 'var(--border)'}`,
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: 40, height: 28, borderRadius: 6, flexShrink: 0,
                background: effect.preview(accentHex),
                border: '1px solid rgba(255,255,255,0.1)',
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
                  <DSIcons.Check size={10} color="#fff" />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {value === 'gradient' && (
        <SettingRow icon={Sliders} title="Gradient Customizer" description="Fine-tune blob colours, count, and speed" accentHex={accentHex}>
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

function AppearancePanel({ settings, onChange, accentHex, onOpenCustomizer, switchTheme }) {
  return (
    <div>
      <SectionTitle>Appearance</SectionTitle>
      <SectionSubtitle>Personalise the look and feel of the editor.</SectionSubtitle>

      {/* Theme picker */}
      <Label>Theme</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
        {ALL_THEMES.map(t => {
          const active = (settings.themeId ?? 'dark-default') === t.meta.id;
          return (
            <button
              key={t.meta.id}
              onClick={() => { injectThemeFonts(t); switchTheme(t); onChange({ themeId: t.meta.id, lightMode: !t.meta.isDark }); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '12px 14px', borderRadius: '10px', border: 'none',
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
                <div style={{ fontSize: '13px', fontWeight: 600, color: active ? accentHex : 'var(--text-2)', marginBottom: '2px' }}>{t.meta.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-5)', lineHeight: 1.4 }}>{t.meta.description}</div>
              </div>
              {active && (
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: accentHex, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              )}
            </button>
          );
        })}
      </div>

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

      {/* Light Mode toggle */}
      <div style={{ marginBottom: 20 }}>
        <SettingRow icon={Sun} title="Light Mode" description="Switch to a light colour scheme" accentHex={accentHex}>
          <Toggle
            on={settings.lightMode ?? false}
            onChange={(v) => onChange({ lightMode: v })}
            accentHex={accentHex}
          />
        </SettingRow>
      </div>

      <SettingsDivider />

      {/* Background Effect dropdown */}
      <BackgroundEffectPicker
        value={settings.backgroundEffect ?? (settings.enableGradient ? 'gradient' : 'none')}
        onChange={(v) => onChange({ backgroundEffect: v, enableGradient: v === 'gradient' })}
        accentHex={accentHex}
        onOpenCustomizer={onOpenCustomizer}
      />
    </div>
  );
}

function StartupPanel({ settings, onChange, accentHex }) {
  const options = [
    { id: 'last',  icon: BookMarked, title: 'Reopen last book',  description: 'Pick up exactly where you left off'   },
    { id: 'blank', icon: FilePlus,   title: 'Open a blank book', description: 'Start fresh every time you launch'    },
    { id: 'home',  icon: (p) => <DSIcons.BookOpen {...p} />,   title: 'Show home screen',  description: 'Browse and choose a book on launch'   },
  ];

  return (
    <div>
      <SectionTitle>Startup Behavior</SectionTitle>
      <SectionSubtitle>Choose what happens when the app launches.</SectionSubtitle>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {options.map(opt => {
          const selected = (settings.startupBehavior ?? 'last') === opt.id;
          return (
            <div
              key={opt.id}
              onClick={() => onChange({ startupBehavior: opt.id })}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '14px 16px', borderRadius: '10px',
                border: `1px solid ${selected ? accentHex + '80' : 'rgba(255,255,255,0.06)'}`,
                background: selected ? `${accentHex}14` : 'rgba(255,255,255,0.02)',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: selected ? `${accentHex}30` : 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <opt.icon size={17} color={selected ? accentHex : 'var(--text-4)'} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: selected ? 'var(--text-1)' : 'var(--text-2)' }}>{opt.title}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-4)', marginTop: '2px' }}>{opt.description}</div>
              </div>
              <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${selected ? accentHex : 'var(--text-5)'}`, background: selected ? accentHex : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                {selected && <DSIcons.Check size={10} color="#fff" />}
              </div>
            </div>
          );
        })}
      </div>

      <SettingsDivider />

      <Label>Session Persistence</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SettingRow icon={BookOpen} title="Restore previously open books" description="Re-open all books that were open last session" accentHex={accentHex}>
          <Toggle on={settings.restoreOpenBooks ?? true} onChange={(v) => onChange({ restoreOpenBooks: v })} accentHex={accentHex} />
        </SettingRow>
      </div>
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
              <option value="__global__" style={{ background: '#1a1b1e', color: '#fff' }}>🌐 Global (default for all books)</option>
              {books.map(b => <option key={b.id} value={b.id} style={{ background: '#1a1b1e', color: '#fff' }}>{b.title || 'Untitled Book'}</option>)}
            </select>
            <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: accentHex, fontSize: '12px' }}>▾</div>
          </div>
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: hasOverride ? accentHex : 'var(--text-5)' }}>
              {hasOverride ? `📌 Custom goal for this book` : `Using global default (${globalGoal} words)`}
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
            style={{ padding: '6px 16px', borderRadius: '20px', border: `1.5px solid ${effectiveGoal === p ? accentHex : 'rgba(255,255,255,0.12)'}`, background: effectiveGoal === p ? `${accentHex}20` : 'transparent', color: effectiveGoal === p ? accentHex : 'var(--text-4)', cursor: 'pointer', fontSize: '13px', fontWeight: effectiveGoal === p ? 600 : 400, transition: 'all 0.15s' }}
          >{p}</button>
        ))}
      </div>

      <SettingsDivider />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border-sm)', borderRadius: '10px', padding: '14px 16px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-4)', lineHeight: 1.7 }}>
          <div>📖 <strong style={{ color: 'var(--text-3)' }}>150 words</strong> — A short journal entry</div>
          <div>✍️ <strong style={{ color: 'var(--text-3)' }}>500 words</strong> — A focused session</div>
          <div>🔥 <strong style={{ color: 'var(--text-3)' }}>1000 words</strong> — A strong daily output</div>
          <div>⚡ <strong style={{ color: 'var(--text-3)' }}>1500 words</strong> — An average webnovel chapter</div>
        </div>
      </div>

      <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-5)' }}>
        Goals are saved inside each <code style={{ color: 'var(--text-4)' }}>.authbook</code> file and persist with your book.
      </div>
    </div>
  );
}


function AboutPanel({ accentHex }) {
  return (
    <div>
      <SectionTitle>About</SectionTitle>
      <SectionSubtitle>Version info, open-source credits and attribution.</SectionSubtitle>
      <AboutSection accentHex={accentHex} />
    </div>
  );
}

function DataPanel({ settings, onChange, accentHex, onClearSessions }) {
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
      id: 'clearSessions', icon: Trash2, label: 'Clear All Sessions', color: '#ed4245',
      description: 'Removes all writing sessions from local storage',
      modal: { title: 'Clear All Sessions?', message: 'This will permanently delete all your writing sessions. Your files on disk will not be affected.', type: 'danger', onConfirm: () => { onClearSessions(); setConfirm(null); } },
    },
    {
      id: 'resetSettings', icon: RefreshCw, label: 'Reset Settings to Default', color: '#faa61a',
      description: 'Resets appearance, startup, and profile to defaults',
      modal: { title: 'Reset All Settings?', message: 'Your profile, appearance, and startup preferences will be restored to their defaults. Sessions will not be affected.', type: 'warning',
        onConfirm: () => { onChange({ displayName: '', avatarDataUrl: null, accentHex: '#3b82f6', enableGradient: false, lightMode: false, startupBehavior: 'home', restoreOpenBooks: true }); setConfirm(null); },
      },
    },
  ];

  return (
    <div>
      <SectionTitle>Data Management</SectionTitle>
      <SectionSubtitle>Manage stored data and reset the application state.</SectionSubtitle>

      <Label>Diagnostics</Label>
      <div style={{ padding: '14px 16px', borderRadius: '10px', marginBottom: '20px', border: 'rgba(255,255,255,0.07) 1px solid', background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <DSIcons.List size={15} color="rgba(255,255,255,0.5)" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-2)' }}>Error Log</div>
          <div style={{ fontSize: '12px', color: 'var(--text-4)', marginTop: '2px' }}>{errorCount > 0 ? `${errorCount} error${errorCount === 1 ? '' : 's'} recorded — tap to review` : 'No errors recorded'}</div>
        </div>
        <button onClick={() => { setErrorCount(getErrorHistory().length); setShowErrorLog(true); }} style={{ padding: '7px 16px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {errorCount > 0 && <span style={{ fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', background: '#ed424533', color: '#f87171' }}>{errorCount}</span>}
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
            <div style={{ marginTop: '6px', fontSize: '12px', fontWeight: 500, color: importStatus.ok ? '#22c55e' : '#f87171', display: 'flex', alignItems: 'center', gap: '5px' }}>
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
  startupBehavior: 'home',
  restoreOpenBooks: true,
  dailyWordGoal: 500,
};

export function Settings({ isOpen, onClose, settings = DEFAULT_SETTINGS, onSave, onClearSessions, onOpenCustomizer, sessions = [], onSessionChange }) {
  const { theme, switchTheme } = useTheme();
  const [activeSection, setActiveSection] = useState('profile');
  const isPortrait = useIsPortrait();

  const extSettingsItems = useExtensionContributions('settings');
  const { navigate }     = useExtensions();

  const isExtSection = extSettingsItems.some(item => activeSection === `ext::${item._extId}::${item.id}`);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleChange = useCallback((patch) => { onSave?.({ ...settings, ...patch }); }, [settings, onSave]);

  if (!isOpen) return null;

  const accentHex = settings.accentHex || '#3b82f6';

  const allNavItems = [
    ...NAV_ITEMS,
    ...extSettingsItems.map(item => ({
      id:    `ext::${item._extId}::${item.id}`,
      label: item.label,
      icon:  (() => {
        const DS_MAP = { Cloud: 'Star', Puzzle: 'Extension', Upload: 'Upload', Settings2: 'Settings',
          HardDrive: 'Package', Server: 'Package', Box: 'Package', Database: 'Package',
          BookOpen: 'BookOpen', Zap: 'Lightning' };
        const dsKey = item.icon && DS_MAP[item.icon];
        if (dsKey && DSIcons[dsKey]) return (props) => <DSIcons[dsKey] {...props} />;
        const fallback = item._extIcon ?? item.icon ?? '🧩';
        return (props) => <span style={{ fontSize: '16px', lineHeight: 1 }}>{fallback}</span>;
      })(),
      group: 'Extensions',
      _extItem: item,
    })),
  ];

  const groups    = [...new Set(allNavItems.map(i => i.group))];
  const panelProps = { settings, onChange: handleChange, accentHex, sessions, onSessionChange };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', animation: 'settingsFadeIn 0.15s ease', padding: isPortrait ? '0' : '16px' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`
        @keyframes settingsFadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes settingsPanelIn { from { opacity: 0; transform: scale(0.97) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        .settings-nav-item:hover { background: rgba(255,255,255,0.05) !important; color: var(--text-2) !important; }
        .settings-tab:hover { background: rgba(255,255,255,0.05) !important; }
        .settings-content::-webkit-scrollbar { width: 4px; }
        .settings-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .settings-tabs::-webkit-scrollbar { display: none; }
      `}</style>

      <div style={{
        width: isPortrait ? '100vw' : '90vw', maxWidth: isPortrait ? '100vw' : '860px',
        height: isPortrait ? '100dvh' : '80vh', maxHeight: isPortrait ? '100dvh' : '680px',
        display: 'flex', flexDirection: isPortrait ? 'column' : 'row',
        borderRadius: isPortrait ? '0' : '16px', overflow: 'hidden',
        background: 'var(--modal-bg)',
        border: isPortrait ? 'none' : '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7)', animation: 'settingsPanelIn 0.2s ease',
      }}>

        {isPortrait ? (
          <>
            {/* Portrait header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 0', background: 'var(--nav-bg)', flexShrink: 0 }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.2px' }}>Settings</span>
              <button onClick={onClose} style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-4)' }}>
                <DSIcons.X size={16} />
              </button>
            </div>
            {/* Scrollable tab bar */}
            <div className="settings-tabs" style={{ display: 'flex', overflowX: 'auto', gap: '4px', padding: '10px 12px', background: 'var(--nav-bg)', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
              {allNavItems.map(item => {
                const active = activeSection === item.id;
                return (
                  <button key={item.id} className="settings-tab" onClick={() => setActiveSection(item.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '8px', border: 'none', background: active ? `${accentHex}22` : 'transparent', color: active ? 'var(--text-1)' : 'var(--text-4)', cursor: 'pointer', fontSize: '13px', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0, borderBottom: active ? `2px solid ${accentHex}` : '2px solid transparent', transition: 'all 0.1s ease' }}
                  >
                    {item._extItem ? <item.icon /> : <item.icon size={14} color={active ? accentHex : 'var(--text-4)'} />}
                    {item.label}
                  </button>
                );
              })}
            </div>
            {/* Content */}
            <div className="settings-content" style={isExtSection ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 } : { flex: 1, overflowY: 'auto', padding: '20px 16px 32px' }}>
              {activeSection === 'profile'    && <ProfilePanel    {...panelProps} />}
              {activeSection === 'appearance' && <AppearancePanel {...panelProps} onOpenCustomizer={onOpenCustomizer} switchTheme={switchTheme} />}
              {activeSection === 'writing'    && <WritingGoalPanel {...panelProps} />}
              {activeSection === 'startup'    && <StartupPanel    {...panelProps} />}
              {activeSection === 'about'      && <AboutPanel accentHex={accentHex} />}
              {activeSection === 'data'       && <DataPanel       settings={settings} onChange={handleChange} accentHex={accentHex} onClearSessions={onClearSessions} onOpenAbout={() => setActiveSection('about')} />}
              {allNavItems.filter(i => i._extItem).map(item => (
                activeSection === item.id && <ExtensionPage key={item.id} extension={item._extItem._ext} pageId={item._extItem.page} session={null} accentHex={accentHex} onBack={() => setActiveSection('profile')} inline />
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Landscape sidebar nav */}
            <div style={{ width: '220px', flexShrink: 0, background: 'var(--nav-bg)', padding: '16px 8px', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.05)', overflowY: 'auto' }}>
              {groups.map(group => (
                <div key={group} style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '4px 10px', marginBottom: '4px' }}>{group}</div>
                  {allNavItems.filter(i => i.group === group).map(item => {
                    const active = activeSection === item.id;
                    return (
                      <button key={item.id} className="settings-nav-item" onClick={() => setActiveSection(item.id)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '6px', border: 'none', background: active ? `${accentHex}22` : 'transparent', color: active ? 'var(--text-1)' : 'var(--text-4)', cursor: 'pointer', fontSize: '14px', fontWeight: active ? 600 : 400, textAlign: 'left', transition: 'all 0.1s ease' }}
                      >
                        {item._extItem ? <item.icon /> : <item.icon size={16} color={active ? accentHex : 'var(--text-4)'} />}
                        {item.label}
                        {active && <div style={{ marginLeft: 'auto', width: '3px', height: '16px', borderRadius: '2px', background: accentHex }} />}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div style={{ marginTop: 'auto', padding: '8px 10px', fontSize: '11px', color: 'var(--text-5)' }}>Settings v1.0</div>
            </div>
            {/* Content */}
            <div className="settings-content" style={isExtSection ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 } : { flex: 1, overflowY: 'auto', padding: '32px 36px', position: 'relative' }}>
              <button onClick={onClose}
                style={{ position: 'absolute', top: '16px', right: '16px', width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-4)', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'var(--text-1)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--text-4)'; }}
              >
                <DSIcons.X size={16} />
              </button>
              {activeSection === 'profile'    && <ProfilePanel    {...panelProps} />}
              {activeSection === 'appearance' && <AppearancePanel {...panelProps} onOpenCustomizer={onOpenCustomizer} switchTheme={switchTheme} />}
              {activeSection === 'writing'    && <WritingGoalPanel {...panelProps} />}
              {activeSection === 'startup'    && <StartupPanel    {...panelProps} />}
              {activeSection === 'about'      && <AboutPanel accentHex={accentHex} />}
              {activeSection === 'data'       && <DataPanel       settings={settings} onChange={handleChange} accentHex={accentHex} onClearSessions={onClearSessions} onOpenAbout={() => setActiveSection('about')} />}
              {allNavItems.filter(i => i._extItem).map(item => (
                activeSection === item.id && <ExtensionPage key={item.id} extension={item._extItem._ext} pageId={item._extItem.page} session={null} accentHex={accentHex} onBack={() => setActiveSection('profile')} inline />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
