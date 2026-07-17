/**
 * Step1AboutYou.jsx — Writing goal personalization.
 *
 * Pre-selects common options for: what you're writing (A novel),
 * target audience (Beginner), and word count goal.
 * User can edit if needed.
 */

import React from 'react';
import { GradientButton, COLORS } from '../../DesignSystem';

const WRITING_TYPES = [
  { id: 'novel', label: 'A novel', icon: '📖' },
  { id: 'shortstory', label: 'Short story', icon: '📝' },
  { id: 'poetry', label: 'Poetry', icon: '✨' },
  { id: 'blog', label: 'Blog posts', icon: '💬' },
];

const AUDIENCES = [
  { id: 'beginner', label: 'I\'m just starting', icon: '🌱' },
  { id: 'intermediate', label: 'I have some experience', icon: '🚀' },
  { id: 'advanced', label: 'I\'m an experienced writer', icon: '⭐' },
];

const WORD_COUNTS = [
  { id: 'few', label: 'A few words', icon: '💭' },
  { id: 'some', label: '300-5000 words', icon: '📄' },
  { id: 'lots', label: '5000+ words', icon: '📚' },
];

export function Step1AboutYou({ onNext, onSkip, onUpdate }) {
  // Default selections for Demo
  const [type, setType] = React.useState('novel');
  const [audience, setAudience] = React.useState('beginner');
  const [wordCount, setWordCount] = React.useState('some');

  const handleNext = () => {
    onUpdate?.({
      writingGoal: { type, audience, wordCount },
    });
    onNext?.();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '40px 20px',
        gap: 32,
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: 'var(--text-1)' }}>
          Tell us about your writing
        </h2>
        <p style={{ fontSize: 14, color: COLORS.textSubtle }}>
          We'll personalize your experience. You can edit if needed.
        </p>
      </div>

      {/* What are you writing? */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
          What are you writing?
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {WRITING_TYPES.map((t) => (
            <OptionButton
              key={t.id}
              icon={t.icon}
              label={t.label}
              selected={type === t.id}
              onClick={() => setType(t.id)}
            />
          ))}
        </div>
      </div>

      {/* Your experience */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
          Your experience
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {AUDIENCES.map((a) => (
            <OptionButton
              key={a.id}
              icon={a.icon}
              label={a.label}
              selected={audience === a.id}
              onClick={() => setAudience(a.id)}
              fullWidth
            />
          ))}
        </div>
      </div>

      {/* Word count target */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
          Word count target
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {WORD_COUNTS.map((w) => (
            <OptionButton
              key={w.id}
              icon={w.icon}
              label={w.label}
              selected={wordCount === w.id}
              onClick={() => setWordCount(w.id)}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <GradientButton variant="primary" size="lg" onClick={handleNext} style={{ flex: 1 }}>
          Continue
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
          }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function OptionButton({ icon, label, selected, onClick, fullWidth = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '16px 12px',
        background: selected ? 'var(--accent)' : 'var(--surface-1)',
        border: `2px solid ${selected ? 'var(--accent)' : 'var(--divider)'}`,
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'all 200ms ease',
        fontSize: 12,
        fontWeight: 500,
        color: selected ? 'white' : 'var(--text-1)',
        width: fullWidth ? '100%' : 'auto',
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.target.style.borderColor = 'var(--accent)';
          e.target.style.background = 'var(--surface-2)';
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.target.style.borderColor = 'var(--divider)';
          e.target.style.background = 'var(--surface-1)';
        }
      }}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      {label}
    </button>
  );
}
