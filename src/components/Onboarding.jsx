import React, { useState } from "react";
import { createPortal } from "react-dom";

const ONBOARDING_KEY = "authno_onboarding_v1";

export function hasSeenOnboarding() {
  return localStorage.getItem(ONBOARDING_KEY) === "done";
}

export function markOnboardingDone() {
  localStorage.setItem(ONBOARDING_KEY, "done");
}

// ─── Onboarding Screen ────────────────────────────────────────────────────────

export function Onboarding({ accentHex = "#5a00d9", onDone }) {
  const [step,    setStep]    = useState(0);
  const [loading, setLoading] = useState(false);

  const steps = [
    {
      icon: "📖",
      title: "Welcome to AuthNo",
      body:  "Your offline writing space. No cloud required. Your words stay on your device.",
      action: "Next",
      onAction: () => setStep(1),
    },
    {
      icon: "💾",
      title: "Saving your work",
      body:  "AuthNo saves your books automatically to your device.\n\nYou can also use Save As to send a copy to Google Drive, email, or anywhere else you like.",
      action: "Next",
      onAction: () => setStep(2),
    },
    {
      icon: "🔔",
      title: "Writing reminders",
      body:  "Would you like AuthNo to remind you to write each day? You can change this later in Settings.",
      action:  "Allow notifications",
      skip:    "Skip for now",
      onAction: async () => {
        setLoading(true);
        try {
          if ("Notification" in window) {
            await Notification.requestPermission();
          }
        } catch { /* ignore */ }
        setLoading(false);
        setStep(3);
      },
      onSkip: () => setStep(3),
    },
    {
      icon: "✨",
      title: "You're all set",
      body:  "Tap the + button in the sidebar to create your first book.\n\nHappy writing!",
      action: "Start writing",
      onAction: () => {
        markOnboardingDone();
        onDone?.();
      },
    },
  ];

  const current = steps[step];

  return createPortal(
    <div
      className="fixed inset-0 z-[20000] flex flex-col items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.92)", backdropFilter: "blur(8px)" }}
    >
      {/* Progress dots */}
      <div className="flex gap-2 mb-10">
        {steps.map((_, i) => (
          <div
            key={i}
            className="rounded-full transition-all duration-300"
            style={{
              width:  i === step ? 20 : 6,
              height: 6,
              background: i <= step ? accentHex : "rgba(255,255,255,0.2)",
            }}
          />
        ))}
      </div>

      {/* Card */}
      <div className="w-full max-w-sm text-center">
        <div className="text-5xl mb-6">{current.icon}</div>
        <h2 className="text-white text-2xl font-bold mb-4 leading-tight">
          {current.title}
        </h2>
        <p className="text-white/60 text-sm leading-relaxed mb-10 whitespace-pre-line">
          {current.body}
        </p>

        {/* Primary action */}
        <button
          disabled={loading}
          onClick={current.onAction}
          className="w-full py-3 rounded-xl font-semibold text-white text-sm mb-3 transition-opacity"
          style={{ background: accentHex, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "Requesting…" : current.action}
        </button>

        {/* Skip */}
        {current.skip && (
          <button
            onClick={current.onSkip}
            className="w-full py-2 text-sm text-white/30 hover:text-white/60 transition"
          >
            {current.skip}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
