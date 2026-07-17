/**
 * OnboardingFunnel.jsx — Complete onboarding funnel orchestrator.
 *
 * Manages 5-step funnel:
 * 0. Welcome
 * 1. About You (personalization)
 * 2. Guided Tour (spotlight-based with demo book)
 * 3. Your Name (name + username capture)
 * 4. Creator's Note (final message + trial offer)
 *
 * Lifecycle:
 * - Demo book added to sessions on Step 0
 * - Profile updated at each step
 * - Trial activated on completion
 * - Paywall auto-opens 0.5s after completion
 * - Demo book filtered out when funnel complete or skipped
 */

import React, { useState, useEffect, useRef } from 'react';
import { Step0Welcome } from './steps/Step0Welcome';
import { Step1AboutYou } from './steps/Step1AboutYou';
import { Step2GuidedTour } from './steps/Step2GuidedTour';
import { Step3YourName } from './steps/Step3YourName';
import { Step4CreatorsNote } from './steps/Step4CreatorsNote';
import { OnboardingProgress } from './OnboardingProgress';
import { createDemoBook } from '../../data/demoBook';
import { getProfile, setProfile } from '../../utils/profile';
import { startTrialMock } from '../../utils/entitlements';

const TOTAL_STEPS = 5;

export function OnboardingFunnel({
  onComplete,
  onDemoBookAdd,
  onDemoBookRemove,
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [profile, setProfileState] = useState(getProfile());
  const [personalization, setPersonalization] = useState({});

  // Add demo book on mount, remove on unmount. Callbacks go through refs so
  // the effect runs exactly once even when App passes fresh inline closures
  // on every render (deps on the props would re-add the book each render).
  const addRef = useRef(onDemoBookAdd);
  const removeRef = useRef(onDemoBookRemove);
  addRef.current = onDemoBookAdd;
  removeRef.current = onDemoBookRemove;
  useEffect(() => {
    addRef.current?.(createDemoBook());
    return () => { removeRef.current?.(); };
  }, []);

  const handleStepUpdate = (updates) => {
    const updated = setProfile(updates);
    setProfileState(updated);
    setPersonalization((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleComplete = () => {
    // Mark onboarding complete
    setProfile({
      onboardingCompleted: true,
      onboardingCompletedAt: new Date().toISOString(),
    });

    // Start 7-day trial
    startTrialMock();

    // Remove demo book
    onDemoBookRemove?.();

    // Trigger paywall after short delay
    setTimeout(() => {
      onComplete?.();
    }, 480);
  };

  const handleSkip = () => {
    // Skipping still finishes onboarding — otherwise the funnel would
    // reappear on every launch. The trial starts either way so gating
    // stays consistent with the Day 1/5/7 timeline.
    setProfile({
      onboardingCompleted: true,
      onboardingCompletedAt: new Date().toISOString(),
    });
    startTrialMock();
    onDemoBookRemove?.();
    onComplete?.();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Progress bar at top */}
      <OnboardingProgress currentStep={currentStep} totalSteps={TOTAL_STEPS} />

      {/* Step content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {currentStep === 0 && <Step0Welcome onNext={handleNext} onSkip={handleSkip} />}

        {currentStep === 1 && (
          <Step1AboutYou
            onNext={handleNext}
            onSkip={handleSkip}
            onUpdate={handleStepUpdate}
          />
        )}

        {currentStep === 2 && <Step2GuidedTour onNext={handleNext} onSkip={handleSkip} />}

        {currentStep === 3 && (
          <Step3YourName
            onNext={handleNext}
            onSkip={handleSkip}
            onUpdate={handleStepUpdate}
            profile={profile}
            writingGoal={personalization.writingGoal}
          />
        )}

        {currentStep === 4 && <Step4CreatorsNote onComplete={handleComplete} />}
      </div>

      {/* Keyboard shortcuts */}
      <KeyboardNavigation
        onNext={handleNext}
        onSkip={handleSkip}
        canGoNext={currentStep < TOTAL_STEPS - 1}
      />
    </div>
  );
}

function KeyboardNavigation({ onNext, onSkip, canGoNext }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' && canGoNext) onNext();
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNext, onSkip, canGoNext]);

  return null;
}
