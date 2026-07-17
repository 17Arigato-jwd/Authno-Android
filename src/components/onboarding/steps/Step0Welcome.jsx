/**
 * Step0Welcome.jsx — Welcome screen with hook + benefits.
 *
 * Displays opening message and core app value propositions.
 * No input, just navigation to next step.
 */

import { GradientButton, COLORS } from '../../DesignSystem';

export function Step0Welcome({ onNext, onSkip }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        gap: 32,
        minHeight: 'calc(100vh - 80px)',
        textAlign: 'center',
      }}
    >
      {/* Animated icon */}
      <div
        style={{
          fontSize: 64,
          animation: 'float 3s ease-in-out infinite',
        }}
      >
        ✍️
      </div>

      {/* Headline */}
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12, color: 'var(--text-1)' }}>
          Welcome to AuthNo
        </h1>
        <p style={{ fontSize: 16, color: COLORS.textSubtle, lineHeight: 1.5 }}>
          Write your story. Your way. Your device.
        </p>
      </div>

      {/* Benefits */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: '100%',
          maxWidth: 320,
        }}
      >
        <BenefitPill icon="📱" label="Works offline. Always." />
        <BenefitPill icon="🔒" label="Your stories stay yours." />
        <BenefitPill icon="⚡" label="Fast, focused writing." />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 280 }}>
        <GradientButton variant="primary" size="lg" onClick={onNext}>
          Get Started
        </GradientButton>
        <button
          onClick={onSkip}
          style={{
            padding: '12px 20px',
            background: 'transparent',
            border: '1px solid var(--divider)',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-2)',
            cursor: 'pointer',
            transition: 'all 200ms ease',
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'var(--surface-2)';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'transparent';
          }}
        >
          Skip Setup
        </button>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
      `}</style>
    </div>
  );
}

function BenefitPill({ icon, label }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: 'var(--surface-1)',
        border: '1px solid var(--divider)',
        borderRadius: 8,
        fontSize: 14,
        color: 'var(--text-1)',
      }}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      {label}
    </div>
  );
}
