/**
 * ProGate.jsx — Wraps any Pro-only feature.
 *
 * Changes from original:
 *   - InlinePrompt  → Badge from DesignSystem (same visual, consistent with all other badges)
 *   - "Upgrade to Pro" button → GradientButton from DesignSystem
 *   - COLORS from tokens replace hardcoded rgba strings
 *
 * Usage and Props unchanged — drop-in replacement.
 *   <ProGate feature="Unlimited pinned books">
 *     <MyProFeature />
 *   </ProGate>
 */

import { useState, useEffect } from 'react';
import { isPro } from '../utils/entitlements';
import { useEntitlement } from '../utils/useEntitlement';
import { openBilling } from '../utils/billingBus';
import { GradientButton, Badge, COLORS } from '../DesignSystem';

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

// Compact inline badge — uses DesignSystem Badge
function InlinePrompt({ accentHex }) {
  return (
    <Badge
      variant="pro"
      accentHex={accentHex}
      icon={<StarIcon />}
    >
      Pro
    </Badge>
  );
}

// Full card upgrade prompt
function UpgradePrompt({ feature, accentHex }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12,
      padding: '28px 20px', borderRadius: 16,
      background: `${accentHex}08`,
      border: `1px solid ${accentHex}33`,
      textAlign: 'center',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: `${accentHex}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: accentHex,
      }}>
        <LockIcon />
      </div>

      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
          {feature || 'This feature'} is Pro
        </div>
        <div style={{ fontSize: 13, color: COLORS.textSubtle, lineHeight: 1.4 }}>
          Upgrade to unlock this and all other Pro features.
        </div>
      </div>

      {/* Uses DesignSystem GradientButton */}
      <GradientButton
        variant="primary"
        size="md"
        icon={<StarIcon />}
        style={{ background: accentHex, boxShadow: `0 4px 14px ${accentHex}55` }}
        onClick={() => openBilling()}
      >
        Upgrade to Pro
      </GradientButton>
    </div>
  );
}

export function ProGate({ children, feature, accentHex = '#6366f1', inline = false }) {
  const { isPro: pro } = useEntitlement();
  if (pro) return children;
  if (inline) return <InlinePrompt accentHex={accentHex} />;
  return <UpgradePrompt feature={feature} accentHex={accentHex} />;
}
