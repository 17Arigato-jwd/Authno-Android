/**
 * Step2GuidedTour.jsx — Interactive spotlight tour over a mock app.
 *
 * Mimics GuidedTour.jsx but with a mock app interface showing the Good Knight
 * demo book. User learns core workflows: viewing books, opening chapters, writing.
 *
 * 10 tour steps:
 * 0. Welcome to your library
 * 1. Your demo book "Good Knight"
 * 2. Tap to view chapters
 * 3. Each chapter can be read or edited
 * 4. Open a chapter to start writing
 * 5. Focus on your words
 * 6. Tools to format text
 * 7. Save happens automatically
 * 8. Back to your books
 * 9. You're ready to write!
 */

import React, { useState, useRef } from 'react';
import { GradientButton, COLORS } from '../../DesignSystem';

const TOUR_STEPS = [
  {
    target: 'home-screen',
    title: 'Your Library',
    body: 'This is where all your books live. The demo book "Good Knight" is ready for you to explore.',
  },
  {
    target: 'demo-book',
    title: 'Good Knight',
    body: 'A 3-chapter story to explore. Tap it to see the chapters inside.',
  },
  {
    target: 'chapters-list',
    title: 'Your Chapters',
    body: 'Each chapter is a separate section. You can write, edit, or just read through them.',
  },
  {
    target: 'chapter-item',
    title: 'Open a Chapter',
    body: 'Tap any chapter to open it in the editor.',
  },
  {
    target: 'editor-screen',
    title: 'The Editor',
    body: 'Here\'s where the magic happens. You can write, edit, and format your story.',
  },
  {
    target: 'text-area',
    title: 'Your Words',
    body: 'Write freely. No distractions, just you and your story.',
  },
  {
    target: 'formatting-toolbar',
    title: 'Formatting Tools',
    body: 'Bold, italic, and more. Format your text exactly how you want it.',
  },
  {
    target: 'auto-save-indicator',
    title: 'Auto-Saved',
    body: 'Your work is automatically saved as you type. No need to worry about losing anything.',
  },
  {
    target: 'back-button',
    title: 'Back to Books',
    body: 'Tap the back button to return to your library anytime.',
  },
  {
    target: 'library-complete',
    title: 'You\'re All Set!',
    body: 'You\'ve seen the basics. Now create your own book and start writing your story.',
  },
];

export function Step2GuidedTour({ onNext, onSkip }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [screen, setScreen] = useState('home'); // 'home', 'book-detail', 'editor'
  const [targetElement, setTargetElement] = useState(null);
  const elementRefs = useRef({});

  const step = TOUR_STEPS[currentStep];

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      // Navigate between screens based on step progression
      if (currentStep === 0) setScreen('home'); // Wait on home
      if (currentStep === 1) setScreen('book-detail'); // Transition to book detail
      if (currentStep === 4) setScreen('editor'); // Transition to editor
      if (currentStep === 8) setScreen('home'); // Back to home
      setCurrentStep(currentStep + 1);
    } else {
      onNext?.();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      {/* Mock App Screen */}
      {screen === 'home' && <HomeScreen elementRefs={elementRefs} />}
      {screen === 'book-detail' && <BookDetailScreen elementRefs={elementRefs} />}
      {screen === 'editor' && <EditorScreen elementRefs={elementRefs} />}

      {/* Spotlight Overlay */}
      <SpotlightOverlay step={step} elementRefs={elementRefs} />

      {/* Tour Card */}
      <TourCard
        step={step}
        stepIndex={currentStep}
        totalSteps={TOUR_STEPS.length}
        onNext={handleNext}
        onBack={handleBack}
        onSkip={onSkip}
      />

      {/* Keyboard shortcuts hint */}
      <div
        style={{
          position: 'fixed',
          bottom: 12,
          left: 12,
          fontSize: 11,
          color: COLORS.textSubtle,
          zIndex: 10500,
        }}
      >
        ← Back • → Next • Esc Skip
      </div>

      {/* Keyboard navigation */}
      <KeyboardNav onNext={handleNext} onBack={handleBack} onSkip={onSkip} />
    </div>
  );
}

function HomeScreen({ elementRefs }) {
  return (
    <div
      ref={(el) => { if (el) elementRefs.current['home-screen'] = el; }}
      style={{
        height: '100vh',
        background: 'var(--background)',
        padding: '16px',
        overflow: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ paddingTop: 20, marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-1)' }}>Your Library</h1>
      </div>

      {/* Demo Book */}
      <div
        ref={(el) => { if (el) elementRefs.current['demo-book'] = el; }}
        style={{
          background: 'linear-gradient(135deg, #5a00d9 0%, #9d4edd 100%)',
          borderRadius: 12,
          padding: '20px',
          marginBottom: 20,
          color: 'white',
          cursor: 'pointer',
          transition: 'transform 200ms ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Good Knight</h2>
        <p style={{ fontSize: 13, opacity: 0.9 }}>A tale of courage and honor</p>
      </div>

      {/* New Book Tile */}
      <div
        style={{
          background: 'var(--surface-1)',
          border: '2px dashed var(--divider)',
          borderRadius: 12,
          padding: '40px 20px',
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>+</div>
        <div style={{ fontSize: 14, color: 'var(--text-2)' }}>Create New Book</div>
      </div>
    </div>
  );
}

function BookDetailScreen({ elementRefs }) {
  return (
    <div
      style={{
        height: '100vh',
        background: 'var(--background)',
        padding: '16px',
        overflow: 'auto',
      }}
    >
      {/* Header with back button */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, paddingTop: 20 }}>
        <button
          style={{
            background: 'var(--surface-1)',
            border: 'none',
            borderRadius: 6,
            padding: '8px 12px',
            color: 'var(--text-1)',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
      </div>

      {/* Book info */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            background: 'linear-gradient(135deg, #5a00d9 0%, #9d4edd 100%)',
            borderRadius: 12,
            padding: '40px 20px',
            textAlign: 'center',
            color: 'white',
            marginBottom: 20,
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Good Knight</h1>
          <p style={{ fontSize: 13, opacity: 0.9 }}>A tale of courage and honor</p>
        </div>
      </div>

      {/* Chapters */}
      <div ref={(el) => { if (el) elementRefs.current['chapters-list'] = el; }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 12 }}>
          Chapters
        </h2>
        {['Chapter 1: The Call to Adventure', 'Chapter 2: Into the Wilderness', 'Chapter 3: The First Trial'].map(
          (title, i) => (
            <div
              key={i}
              ref={(el) => {
                if (i === 0 && el) elementRefs.current['chapter-item'] = el;
              }}
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--divider)',
                borderRadius: 8,
                padding: '16px',
                marginBottom: 8,
                cursor: 'pointer',
                transition: 'all 200ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--surface-2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--surface-1)';
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)' }}>{title}</div>
              <div style={{ fontSize: 12, color: COLORS.textSubtle, marginTop: 4 }}>
                1,200 words
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function EditorScreen({ elementRefs }) {
  return (
    <div
      style={{
        height: '100vh',
        background: 'var(--background)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          ref={(el) => { if (el) elementRefs.current['back-button'] = el; }}
          style={{
            background: 'var(--surface-1)',
            border: 'none',
            borderRadius: 6,
            padding: '8px 12px',
            color: 'var(--text-1)',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
          Chapter 1: The Call to Adventure
        </div>
        <div
          ref={(el) => { if (el) elementRefs.current['auto-save-indicator'] = el; }}
          style={{ fontSize: 11, color: 'var(--success)', fontWeight: 500 }}
        >
          ✓ Saved
        </div>
      </div>

      {/* Formatting toolbar */}
      <div
        ref={(el) => { if (el) elementRefs.current['formatting-toolbar'] = el; }}
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          gap: 8,
        }}
      >
        <button style={toolButtonStyle()}>B</button>
        <button style={toolButtonStyle()}>I</button>
        <button style={toolButtonStyle()}>U</button>
        <div style={{ width: 1, background: 'var(--divider)' }} />
        <button style={toolButtonStyle()}>•</button>
        <button style={toolButtonStyle()}>1.</button>
      </div>

      {/* Text area */}
      <div
        ref={(el) => { if (el) elementRefs.current['text-area'] = el; }}
        style={{
          flex: 1,
          padding: '20px 16px',
          fontSize: 15,
          lineHeight: 1.7,
          color: 'var(--text-1)',
          background: 'var(--background)',
          overflow: 'auto',
          fontFamily: 'Georgia, serif',
        }}
      >
        The morning sun cast long shadows across the stone courtyard as Sir Aldric received the
        summons. The scroll bore the royal seal—urgent and unmistakable. He had spent years
        training for this moment, though he never imagined it would come like this.
      </div>
    </div>
  );
}

function SpotlightOverlay({ step, elementRefs }) {
  const element = elementRefs.current[step.target];
  const rect = element?.getBoundingClientRect() || null;

  if (!rect) return null;

  const spotlightRadius = Math.max(rect.width, rect.height) / 2 + 12;

  return (
    <svg
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10550,
      }}
      viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
    >
      <defs>
        <radialGradient id="spotlight" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="white" stopOpacity={0} />
          <stop offset="100%" stopColor="black" stopOpacity={0.7} />
        </radialGradient>
      </defs>

      <circle
        cx={rect.left + rect.width / 2}
        cy={rect.top + rect.height / 2}
        r={spotlightRadius}
        fill="url(#spotlight)"
      />

      {/* Border around spotlight */}
      <circle
        cx={rect.left + rect.width / 2}
        cy={rect.top + rect.height / 2}
        r={spotlightRadius}
        fill="none"
        stroke="rgba(255, 255, 255, 0.5)"
        strokeWidth={2}
      />
    </svg>
  );
}

function TourCard({ step, stepIndex, totalSteps, onNext, onBack, onSkip }) {
  const cardStyle = {
    position: 'fixed',
    bottom: 60,
    left: 20,
    right: 20,
    maxWidth: 400,
    background: 'var(--surface-1)',
    border: '1px solid var(--divider)',
    borderRadius: 12,
    padding: '20px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    zIndex: 10600,
  };

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>
          {step.title}
        </h3>
        <p style={{ fontSize: 14, color: COLORS.textSubtle, lineHeight: 1.5 }}>{step.body}</p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <button
          onClick={onBack}
          disabled={stepIndex === 0}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: '1px solid var(--divider)',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-2)',
            cursor: stepIndex === 0 ? 'default' : 'pointer',
            opacity: stepIndex === 0 ? 0.5 : 1,
          }}
        >
          ← Back
        </button>

        <button
          onClick={onNext}
          style={{
            flex: 1,
            padding: '8px 16px',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            color: 'white',
            cursor: 'pointer',
          }}
        >
          {stepIndex === totalSteps - 1 ? 'Finish' : 'Next →'}
        </button>

        <button
          onClick={onSkip}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: '1px solid var(--divider)',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-2)',
            cursor: 'pointer',
          }}
        >
          Skip
        </button>
      </div>

      <div style={{ fontSize: 11, color: COLORS.textSubtle, textAlign: 'center' }}>
        {stepIndex + 1} of {totalSteps}
      </div>
    </div>
  );
}

function KeyboardNav({ onNext, onBack, onSkip }) {
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') onNext();
      if (e.key === 'ArrowLeft') onBack();
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNext, onBack, onSkip]);

  return null;
}

function toolButtonStyle() {
  return {
    background: 'var(--surface-2)',
    border: '1px solid var(--divider)',
    borderRadius: 4,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-1)',
    cursor: 'pointer',
  };
}
