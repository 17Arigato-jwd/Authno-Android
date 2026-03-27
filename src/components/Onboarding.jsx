import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Database,
  Flame,
  ShieldCheck,
  Sparkles,
  Target,
  ArrowRight,
  Check,
  ChevronRight,
} from "lucide-react";

const ONBOARDING_KEY = "authno_onboarding_v1";

/* ─── Storage helpers (Capacitor Preferences → localStorage fallback) ────────── */

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

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pick(arr, index) {
  return arr[index % arr.length];
}

function FloatingBlobLayer({ accentHex = "#5a00d9" }) {
  const blobs = useMemo(() => {
    const palette = [
      accentHex,
      "#06b6d4",
      "#f97316",
      "#22c55e",
      "#ec4899",
      "#8b5cf6",
      "#eab308",
    ];

    return Array.from({ length: 14 }, (_, i) => {
      const size = clamp(120 + Math.random() * 340, 120, 460);
      const left = Math.random() * 100;
      const top = Math.random() * 100;
      const driftX = (Math.random() * 260 - 130).toFixed(0);
      const driftY = (Math.random() * 260 - 130).toFixed(0);
      const duration = (16 + Math.random() * 22).toFixed(1);
      const delay = -(Math.random() * 18).toFixed(1);
      const opacity = (0.10 + Math.random() * 0.18).toFixed(2);
      const blur = (18 + Math.random() * 48).toFixed(0);

      return {
        id: i,
        size,
        left,
        top,
        driftX,
        driftY,
        duration,
        delay,
        opacity,
        blur,
        color: pick(palette, i),
      };
    });
  }, [accentHex]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <style>{`
        @keyframes blobDrift {
          0% {
            transform: translate(-50%, -50%) translate3d(0, 0, 0) scale(0.9);
            opacity: 0;
          }
          12% { opacity: var(--o); }
          50% {
            transform: translate(-50%, -50%) translate3d(calc(var(--dx) * 0.45), calc(var(--dy) * 0.45), 0) scale(1.08);
            opacity: calc(var(--o) + 0.08);
          }
          88% { opacity: var(--o); }
          100% {
            transform: translate(-50%, -50%) translate3d(var(--dx), var(--dy), 0) scale(0.92);
            opacity: 0;
          }
        }

        @keyframes blobGlow {
          0%, 100% { filter: saturate(130%) brightness(0.95); }
          50%      { filter: saturate(160%) brightness(1.1); }
        }

        @keyframes floatIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {blobs.map((b) => (
        <div
          key={b.id}
          className="absolute rounded-full"
          style={{
            left: `${b.left}%`,
            top: `${b.top}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            "--dx": `${b.driftX}px`,
            "--dy": `${b.driftY}px`,
            "--o": b.opacity,
            opacity: 0,
            background: `radial-gradient(circle at 30% 30%, ${b.color}cc 0%, ${b.color}55 35%, transparent 70%)`,
            filter: `blur(${b.blur}px)`,
            mixBlendMode: "screen",
            animation: `
              blobDrift ${b.duration}s ease-in-out ${b.delay}s infinite,
              blobGlow ${Math.max(10, Number(b.duration) - 2)}s ease-in-out ${b.delay}s infinite,
              floatIn 0.6s ease-out forwards
            `,
          }}
        />
      ))}
    </div>
  );
}

function StepPill({ current, total }) {
  return (
    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 backdrop-blur">
      <Sparkles size={13} />
      <span>
        Step {current} of {total}
      </span>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, text, accentHex }) {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left backdrop-blur-sm"
      style={{ boxShadow: "0 12px 40px rgba(0,0,0,0.18)" }}
    >
      <div className="mb-3 flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10"
          style={{ background: `${accentHex}18` }}
        >
          <Icon size={18} color={accentHex} />
        </div>
        <div className="text-sm font-semibold text-white">{title}</div>
      </div>
      <p className="text-sm leading-relaxed text-white/60">{text}</p>
    </div>
  );
}

export function Onboarding({ accentHex = "#5a00d9", onDone }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  const steps = [
    {
      icon: BookOpen,
      title: "Welcome to AuthNo",
      body:
        "A quiet writing space that stays on your device.\n\nNo cloud lock-in. No sign-in wall. Just your words, your books, and your focus.",
      action: "Next",
      onAction: () => setStep(1),
    },
    {
      icon: ShieldCheck,
      title: "Your books now use VCHS-ECS",
      body:
        ".authbook files are no longer plain JSON. They are binary VCHS-ECS containers built for resilience.\n\nThat means structured metadata, chapter indexing, per-section CRC checks, and recovery support when things go wrong.",
      action: "Next",
      onAction: () => setStep(2),
    },
    {
      icon: Flame,
      title: "Track progress with streaks",
      body:
        "Each book can keep its own streak data: daily logs, baselines, and goal history.\n\nSet a word goal, build momentum, and use the challenge system to keep yourself moving.",
      action: "Next",
      onAction: () => setStep(3),
    },
    {
      icon: Target,
      title: "Make it yours",
      body:
        "Choose a goal, open a book, and start writing.\n\nYou can also tune the look and feel later from Settings.",
      action: "Start writing",
      isLast: true,
      onAction: async () => {
        if (dontShowAgain) await markOnboardingDone();
        onDone?.();
      },
    },
  ];

  const current = steps[step];
  const CurrentIcon = current.icon;

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        if (dontShowAgain) markOnboardingDone().catch(() => {});
        onDone?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dontShowAgain, onDone]);

  return createPortal(
    <div
      className="fixed inset-0 z-[20000] flex items-center justify-center px-5 py-6"
      style={{
        background:
          "radial-gradient(circle at top, rgba(255,255,255,0.08), transparent 38%), rgba(0,0,0,0.92)",
        backdropFilter: "blur(10px)",
      }}
    >
      <FloatingBlobLayer accentHex={accentHex} />

      <div className="relative z-10 w-full max-w-md">
        <StepPill current={step + 1} total={steps.length} />

        <div
          className="rounded-[28px] border border-white/10 bg-black/35 p-6 text-center shadow-2xl backdrop-blur-xl"
          style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.55)" }}
        >
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <CurrentIcon size={28} color={accentHex} />
          </div>

          <h2 className="mb-3 text-2xl font-bold tracking-tight text-white">
            {current.title}
          </h2>

          <p className="whitespace-pre-line text-sm leading-relaxed text-white/65">
            {current.body}
          </p>

          <div className="mt-5 grid gap-3 text-left">
            {step === 0 && (
              <>
                <FeatureCard
                  icon={ShieldCheck}
                  title="Offline first"
                  text="Your writing stays local by default."
                  accentHex={accentHex}
                />
                <FeatureCard
                  icon={Database}
                  title="Structured storage"
                  text=".authbook files carry metadata, chapters, and recovery data together."
                  accentHex={accentHex}
                />
                <FeatureCard
                  icon={Flame}
                  title="Streak-driven focus"
                  text="Progress tracking is built into each book."
                  accentHex={accentHex}
                />
              </>
            )}

            {step === 1 && (
              <>
                <FeatureCard
                  icon={BookOpen}
                  title="Binary, not JSON"
                  text="The new format is built for integrity and recovery, not just simple text storage."
                  accentHex={accentHex}
                />
                <FeatureCard
                  icon={ShieldCheck}
                  title="Recovery-friendly"
                  text="VCHS-ECS uses redundant structure and checks to detect and repair corruption where possible."
                  accentHex={accentHex}
                />
              </>
            )}

            {step === 2 && (
              <>
                <FeatureCard
                  icon={Flame}
                  title="Daily logging"
                  text="Track what you write each day."
                  accentHex={accentHex}
                />
                <FeatureCard
                  icon={Target}
                  title="Goals and challenges"
                  text="Set targets per book and build your own momentum."
                  accentHex={accentHex}
                />
              </>
            )}

            {step === 3 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10"
                    style={{ background: `${accentHex}18` }}
                  >
                    <Check size={18} color={accentHex} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">
                      Ready when you are
                    </div>
                    <div className="text-sm text-white/55">
                      Open a book, set a goal, and start writing.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {current.isLast && (
            <label
              className="mt-5 flex items-center justify-center gap-2 select-none"
              style={{ WebkitTapHighlightColor: "transparent" }}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
              />
              <span
                className="flex h-4 w-4 items-center justify-center rounded border transition-colors"
                style={{
                  borderColor: dontShowAgain ? accentHex : "rgba(255,255,255,0.25)",
                  background: dontShowAgain ? accentHex : "transparent",
                }}
              >
                {dontShowAgain && <Check size={10} color="#fff" />}
              </span>
              <span className="text-xs text-white/45">Don’t show this again</span>
            </label>
          )}

          <button
            disabled={loading}
            onClick={current.onAction}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
            style={{
              background: `linear-gradient(135deg, ${accentHex}, ${accentHex}cc)`,
              boxShadow: `0 12px 30px ${accentHex}33`,
            }}
          >
            {loading ? (
              "Requesting…"
            ) : (
              <>
                {current.action}
                <ArrowRight size={16} />
              </>
            )}
          </button>

          {current.skip && (
            <button
              onClick={() => setStep((s) => Math.min(s + 1, steps.length - 1))}
              className="mt-3 w-full rounded-2xl px-4 py-2 text-sm text-white/35 transition hover:text-white/65"
            >
              {current.skip}
            </button>
          )}

          <div className="mt-5 flex items-center justify-center gap-2">
            {steps.map((_, i) => (
              <div
                key={i}
                className="h-2 rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 22 : 6,
                  background: i <= step ? accentHex : "rgba(255,255,255,0.18)",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
