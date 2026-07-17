/**
 * Step4CreatorsNote.jsx — Personal message from creator.
 *
 * Shows photo, greeting, why-I-made-it story, and trial info.
 * Marks the final step before auto-opening the paywall.
 *
 * TODO: Replace placeholder content with real creator message and photo.
 */

import React from 'react';
import { GradientButton, COLORS } from '../../DesignSystem';

export function Step4CreatorsNote({ onComplete }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '40px 20px',
        gap: 28,
        maxWidth: 500,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: 'var(--text-1)' }}>
          A note from the creator
        </h2>
      </div>

      {/* Photo placeholder */}
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #5a00d9 0%, #c084fc 100%)',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 48,
        }}
      >
        👤
      </div>

      {/* Greeting */}
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 16, color: 'var(--text-1)', lineHeight: 1.6, marginBottom: 16 }}>
          Hi! I'm [Creator Name], and I built AuthNo to help writers like you.
        </p>

        <p style={{ fontSize: 14, color: COLORS.textSubtle, lineHeight: 1.6 }}>
          I started writing years ago, but I always felt frustrated with tools that either tracked my
          data in the cloud or required constant internet. I wanted something simple, fast, and truly
          mine. That's why AuthNo is 100% offline—your words, your device, your peace of mind.
        </p>
      </div>

      {/* Trial highlight */}
      <div
        style={{
          padding: '16px',
          background: 'linear-gradient(135deg, #5a00d933 0%, #c084fc22 100%)',
          border: '1px solid rgba(90, 0, 217, 0.3)',
          borderRadius: 12,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>
          Try Everything Free
        </div>
        <p style={{ fontSize: 12, color: COLORS.textSubtle, lineHeight: 1.5 }}>
          I've unlocked a full 7-day free trial of all Pro features. No credit card required.
          Try it out and see if AuthNo fits your writing style.
        </p>
      </div>

      {/* Signature */}
      <div style={{ textAlign: 'center', borderTop: '1px solid var(--divider)', paddingTop: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)', marginBottom: 4 }}>
          Happy writing,
        </p>
        <p style={{ fontSize: 13, color: COLORS.textSubtle }}>
          [Creator Name]
        </p>
      </div>

      {/* Action */}
      <GradientButton variant="primary" size="lg" onClick={onComplete} style={{ width: '100%' }}>
        Let's Get Started
      </GradientButton>
    </div>
  );
}
