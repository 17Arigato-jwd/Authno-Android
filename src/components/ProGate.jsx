// ProGate.jsx — Wraps any Pro-only feature.
// Shows the feature normally for Pro users; shows an upgrade prompt for Free users.
//
// Usage:
//   <ProGate feature="Unlimited pinned books">
//     <MyProFeature />
//   </ProGate>
//
// Props:
//   children     — the Pro feature to render
//   feature      string   Short label shown in the upgrade prompt (e.g. "Unlimited pinned books")
//   accentHex    string   Theme accent colour (optional, falls back to #6366f1)
//   inline       bool     If true, renders a compact inline badge instead of a full card

import { useState, useEffect } from 'react';
import { isPro } from '../utils/entitlements';

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

// Compact inline badge — for use inside rows/buttons
function InlinePrompt({ feature, accentHex }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 8px', borderRadius: '99px',
      background: `${accentHex}22`,
      color: accentHex,
      fontSize: '11px', fontWeight: 700,
      letterSpacing: '0.3px',
    }}>
      <StarIcon />
      Pro
    </span>
  );
}

// Full card upgrade prompt
function UpgradePrompt({ feature, accentHex }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '12px',
      padding: '28px 20px', borderRadius: '16px',
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${accentHex}33`,
      textAlign: 'center',
    }}>
      <div style={{
        width: '44px', height: '44px', borderRadius: '50%',
        background: `${accentHex}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: accentHex,
      }}>
        <LockIcon />
      </div>

      <div>
        <div style={{
          fontSize: '15px', fontWeight: 700,
          color: 'var(--text-1)', marginBottom: '4px',
        }}>
          {feature || 'This feature'} is Pro
        </div>
        <div style={{
          fontSize: '13px', color: 'var(--text-4)', lineHeight: '1.4',
        }}>
          Upgrade to unlock this and all other Pro features.
        </div>
      </div>

      <button style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '10px 22px', borderRadius: '10px', border: 'none',
        background: accentHex, color: '#fff',
        fontSize: '14px', fontWeight: 700, cursor: 'pointer',
        boxShadow: `0 4px 14px ${accentHex}55`,
      }}>
        <StarIcon />
        Upgrade to Pro
      </button>
    </div>
  );
}

/**
 * ProGate
 *
 * Props:
 *   children    — Pro feature JSX
 *   feature     string   Label for the upgrade prompt
 *   accentHex   string   Theme accent colour
 *   inline      bool     Render compact inline badge instead of full card
 */
export function ProGate({ children, feature, accentHex = '#6366f1', inline = false }) {
  const [pro, setPro] = useState(() => isPro());

  // Re-check when storage changes (e.g. dev toggling tier in another tab)
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'authno_tier') setPro(isPro());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  if (pro) return children;

  if (inline) return <InlinePrompt feature={feature} accentHex={accentHex} />;

  return <UpgradePrompt feature={feature} accentHex={accentHex} />;
}
