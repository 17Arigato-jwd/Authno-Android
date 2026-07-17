/**
 * OnboardingProgress.jsx — Progress rail with dots and progress bar.
 *
 * Displays persistent visual progress through the funnel steps.
 * Shows: current step (filled dot) + upcoming (empty dots) + linear progress bar.
 */

export function OnboardingProgress({ currentStep, totalSteps }) {
  const progress = ((currentStep + 1) / totalSteps) * 100;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '16px 20px',
        background: 'var(--surface-1)',
        borderBottom: '1px solid var(--divider)',
      }}
    >
      {/* Dots */}
      <div style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: i <= currentStep ? 'var(--accent)' : 'var(--divider)',
              transition: 'background 200ms ease',
            }}
          />
        ))}
      </div>

      {/* Progress bar */}
      <div
        style={{
          flex: 1,
          height: 3,
          background: 'var(--divider)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            background: 'var(--accent)',
            width: `${progress}%`,
            transition: 'width 300ms ease',
          }}
        />
      </div>

      {/* Step indicator */}
      <div style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
        {currentStep + 1} / {totalSteps}
      </div>
    </div>
  );
}
