import React, { useState } from "react";
import { createPortal } from "react-dom";

const ONBOARDING_KEY = "authno_onboarding_v1";

// ─── Storage helpers (Capacitor Preferences → localStorage fallback) ──────────

async function getPreference(key) {
  try {
    if (window.Capacitor?.isPluginAvailable?.("Preferences")) {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key });
      return value;
    }
  } catch {}
  return localStorage.getItem(key);
}

async function setPreference(key, value) {
  try {
    if (window.Capacitor?.isPluginAvailable?.("Preferences")) {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key, value });
      return;
    }
  } catch {}
  localStorage.setItem(key, value);
}

async function removePreference(key) {
  try {
    if (window.Capacitor?.isPluginAvailable?.("Preferences")) {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.remove({ key });
      return;
    }
  } catch {}
  localStorage.removeItem(key);
}

export async function hasSeenOnboarding() {
  const val = await getPreference(ONBOARDING_KEY);
  return val === "done";
}

export async function markOnboardingDone() {
  await setPreference(ONBOARDING_KEY, "done");
}

export async function resetOnboarding() {
  await removePreference(ONBOARDING_KEY);
}

// ─── Onboarding Screen ────────────────────────────────────────────────────────

export function Onboarding({ accentHex = "#5a00d9", onDone }) {
  const [step,        setStep]        = useState(0);
  const [loading,     setLoading]     = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

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
          // Android 13+: use Capacitor PushNotifications for POST_NOTIFICATIONS
          if (window.Capacitor?.getPlatform() === "android") {
            try {
              const { PushNotifications } = await import("@capacitor/push-notifications");
              await PushNotifications.requestPermissions();
            } catch {
              // Fallback: Web Notifications API (works on older Android / web)
              if ("Notification" in window) await Notification.requestPermission();
            }
          } else {
            if ("Notification" in window) await Notification.requestPermission();
          }
        } catch { /* user denied or API unavailable — carry on */ }
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
      isLast: true,
      onAction: async () => {
        if (dontShowAgain) await markOnboardingDone();
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
        <p className="text-white/60 text-sm leading-relaxed mb-8 whitespace-pre-line">
          {current.body}
        </p>

        {/* "Don't show again" checkbox — only on last step */}
        {current.isLast && (
          <label
            className="flex items-center justify-center gap-2 mb-6 cursor-pointer select-none group"
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <span
              className="w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0"
              style={{
                borderColor: dontShowAgain ? accentHex : "rgba(255,255,255,0.3)",
                background:  dontShowAgain ? accentHex : "transparent",
              }}
            >
              {dontShowAgain && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <span className="text-white/40 text-xs group-hover:text-white/60 transition-colors">
              Don't show this again
            </span>
          </label>
        )}

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
