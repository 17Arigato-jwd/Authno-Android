/**
 * Step3YourName.jsx — Name and username capture.
 *
 * Asks for: Full name (required) and optional username.
 * Shows recap of personalization choices made so far.
 */

import React, { useState } from 'react';
import { GradientButton, COLORS } from '../../../DesignSystem';

export function Step3YourName({ onNext, onSkip, onUpdate, profile, writingGoal }) {
  const [name, setName] = useState(profile?.name || '');
  const [username, setUsername] = useState(profile?.username || '');

  const handleNext = () => {
    if (!name.trim()) return;
    onUpdate?.({
      name: name.trim(),
      username: username.trim(),
    });
    onNext?.();
  };

  const getGoalSummary = () => {
    if (!writingGoal) return '';
    const typeLabel = {
      novel: 'a novel',
      shortstory: 'short stories',
      poetry: 'poetry',
      blog: 'blog posts',
    }[writingGoal.type] || 'your writing';

    const audienceLabel = {
      beginner: 'just starting',
      intermediate: 'experienced',
      advanced: 'expert',
    }[writingGoal.audience] || '';

    return `You're writing ${typeLabel} and you're ${audienceLabel}.`;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '40px 20px',
        gap: 32,
        maxWidth: 500,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: 'var(--text-1)' }}>
          What should we call you?
        </h2>
        <p style={{ fontSize: 14, color: COLORS.textSubtle, lineHeight: 1.5 }}>
          This helps personalize your experience in AuthNo.
        </p>
      </div>

      {/* Recap of choices */}
      {writingGoal && (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--surface-1)',
            border: '1px solid var(--divider)',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--text-2)',
            lineHeight: 1.5,
          }}
        >
          ✓ {getGoalSummary()}
        </div>
      )}

      {/* Name input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
          Your full name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Sarah Chen"
          style={{
            padding: '12px 16px',
            background: 'var(--surface-1)',
            border: '1px solid var(--divider)',
            borderRadius: 8,
            fontSize: 14,
            color: 'var(--text-1)',
            fontFamily: 'inherit',
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleNext()}
        />
      </div>

      {/* Username input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
          Username (optional)
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g., sarahwrites"
          style={{
            padding: '12px 16px',
            background: 'var(--surface-1)',
            border: '1px solid var(--divider)',
            borderRadius: 8,
            fontSize: 14,
            color: 'var(--text-1)',
            fontFamily: 'inherit',
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleNext()}
        />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <GradientButton
          variant="primary"
          size="lg"
          onClick={handleNext}
          disabled={!name.trim()}
          style={{ flex: 1, opacity: name.trim() ? 1 : 0.5 }}
        >
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
