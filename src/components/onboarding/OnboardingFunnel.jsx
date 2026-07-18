/**
 * OnboardingFunnel.jsx — the five-step first-run funnel (v1.1.18-beta.4 rebuild).
 *
 * Welcome → About you → Guided tour → Your name → Creator's note.
 *
 * Rendered as a full-screen portal in the old Onboarding's visual language:
 * scrim + blur backdrop, FloatingBlobs, a centered frosted-glass card, and the
 * .onb theme shim so the white/black utilities follow light themes. The first
 * version rendered inline in the app layout with CSS vars that don't exist in
 * this app — never again.
 *
 * Step 3 (guided tour) hands off to the REAL GuidedTour over the REAL app:
 * the funnel chrome unmounts, the spotlight walks home → book → editor with
 * "The Good Knight" demo book sitting in the library, then the funnel returns
 * for the name step. No mock screens.
 *
 * Lifecycle: demo book added on mount and removed on unmount/finish; profile
 * saved as the user advances; the 7-day trial starts on finish or skip
 * (startTrialMock never resets an existing clock or downgrades Pro); the
 * paywall is NOT part of the funnel — App opens it just after completion.
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { T } from "../../utils/motion";
import { DSIcons } from "../../DesignSystem";
import { FloatingBlobs, ONB_THEME_CSS, FeatureLine } from "../Onboarding";
import GuidedTour from "../GuidedTour";
import { createDemoBook } from "../../data/demoBook";
import { getProfile, setProfile } from "../../utils/profile";
import { startTrialMock } from "../../utils/entitlements";

const TOTAL = 5;

// ── About-you options (pre-selected to the common answers) ───────────────────
const WRITING_TYPES = [
  { id: "novel", label: "A novel", icon: (p) => <DSIcons.BookOpen {...p} /> },
  { id: "shortstory", label: "Short stories", icon: (p) => <DSIcons.FileText {...p} /> },
  { id: "poetry", label: "Poetry", icon: (p) => <DSIcons.Star {...p} /> },
  { id: "notes", label: "Notes & ideas", icon: (p) => <DSIcons.Edit {...p} /> },
];
const EXPERIENCE = [
  { id: "beginner", label: "Just starting out" },
  { id: "intermediate", label: "I've written before" },
  { id: "advanced", label: "Writing is my craft" },
];
const WORD_GOALS = [
  { id: "100", label: "~100 words" },
  { id: "300", label: "~300 words" },
  { id: "1000", label: "1,000+ words" },
];

export function OnboardingFunnel({
  accentHex = "#5a00d9",
  android = false,
  onTourNavigate,
  onComplete,
  onDemoBookAdd,
  onDemoBookRemove,
}) {
  const [step, setStep] = useState(0);
  const [goalType, setGoalType] = useState("novel");
  const [experience, setExperience] = useState("beginner");
  const [wordGoal, setWordGoal] = useState("300");
  const [name, setName] = useState(getProfile().name || "");
  const [username, setUsername] = useState(getProfile().username || "");

  // Demo book: add exactly once on mount, remove on unmount. Refs so App's
  // inline callbacks (fresh identity every render) can't re-run the effect.
  const addRef = useRef(onDemoBookAdd);
  const removeRef = useRef(onDemoBookRemove);
  addRef.current = onDemoBookAdd;
  removeRef.current = onDemoBookRemove;
  useEffect(() => {
    addRef.current?.(createDemoBook());
    return () => { removeRef.current?.(); };
  }, []);

  const saveProgress = () => {
    setProfile({
      name: name.trim(),
      username: username.trim(),
      writingGoal: { type: goalType, audience: experience, wordCount: wordGoal },
    });
  };

  const finish = (skipped = false) => {
    saveProgress();
    setProfile({
      onboardingCompleted: true,
      onboardingCompletedAt: new Date().toISOString(),
    });
    startTrialMock();
    removeRef.current?.();
    if (skipped) onComplete?.();
    else setTimeout(() => onComplete?.(), 480); // let the card animate out first
  };

  const next = () => {
    if (step === 1) saveProgress();
    if (step < TOTAL - 1) setStep(step + 1);
    else finish();
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Keyboard: → / Enter advance (not while typing), ← back, Esc skips.
  useEffect(() => {
    if (step === 2) return undefined; // the tour owns the keyboard
    const onKey = (e) => {
      const typing = e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA";
      if (e.key === "Escape") { e.preventDefault(); finish(true); }
      else if ((e.key === "ArrowRight" || (e.key === "Enter" && !typing))) { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft" && !typing) { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (typeof document === "undefined") return null;

  // ── Step 3: the real spotlight tour over the real app ─────────────────────
  if (step === 2) {
    return (
      <GuidedTour
        active
        android={android}
        accentHex={accentHex}
        onNavigate={onTourNavigate}
        onDone={() => { onTourNavigate?.("home"); setStep(3); }}
      />
    );
  }

  const chip = (active) => ({
    display: "inline-flex", alignItems: "center", gap: 8,
    padding: "10px 14px", borderRadius: 999, cursor: "pointer",
    fontSize: 13, fontWeight: 600,
    border: `1.5px solid ${active ? accentHex : "var(--border)"}`,
    background: active ? `${accentHex}22` : "var(--surface)",
    color: active ? "var(--text-1)" : "var(--text-3)",
    transition: "all 0.15s",
  });

  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "12px 14px",
    borderRadius: 12, background: "var(--input-bg, var(--surface))",
    border: "1px solid var(--input-border, var(--border))",
    color: "var(--text-1)", fontSize: 14.5, outline: "none",
  };

  const primaryBtn = {
    width: "100%", padding: "13px 0", borderRadius: 14, border: "none",
    background: accentHex, color: "#fff", fontSize: 14.5, fontWeight: 800,
    cursor: "pointer", boxShadow: `0 6px 18px ${accentHex}55`,
  };

  const sectionLabel = { fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-4)", marginBottom: 8 };

  // ── Step content ───────────────────────────────────────────────────────────
  const pages = [
    // 0 — Welcome
    {
      key: "welcome",
      render: () => (
        <>
          <IconTile accentHex={accentHex}><DSIcons.Sparkle size={28} color={accentHex} /></IconTile>
          <h2 className="mb-2 text-center text-2xl font-bold tracking-tight text-white">Welcome to AuthNo</h2>
          <p className="mb-6 text-center text-sm text-white/65" style={{ lineHeight: 1.6 }}>
            Write your story. Your way. Your device.
          </p>
          <div className="mb-7 flex flex-col gap-2.5">
            <FeatureLine icon={(p) => <DSIcons.Shield {...p} />} text="Works offline. Everything stays on your device." accentHex={accentHex} />
            <FeatureLine icon={(p) => <DSIcons.Lock {...p} />} text="Your stories stay yours — no account wall." accentHex={accentHex} />
            <FeatureLine icon={(p) => <DSIcons.Lightning {...p} />} text="Fast, focused, distraction-free writing." accentHex={accentHex} />
          </div>
          <button style={primaryBtn} onClick={next}>Get started</button>
        </>
      ),
    },
    // 1 — About you
    {
      key: "about",
      render: () => (
        <>
          <IconTile accentHex={accentHex}><DSIcons.User size={28} color={accentHex} /></IconTile>
          <h2 className="mb-2 text-center text-2xl font-bold tracking-tight text-white">What brings you here?</h2>
          <p className="mb-6 text-center text-sm text-white/65" style={{ lineHeight: 1.6 }}>
            We pre-picked the common answers — tap to change anything.
          </p>

          <div style={{ marginBottom: 18 }}>
            <div style={sectionLabel}>I want to write…</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {WRITING_TYPES.map((t) => (
                <button key={t.id} style={chip(goalType === t.id)} onClick={() => setGoalType(t.id)}>
                  {t.icon({ size: 14, color: goalType === t.id ? accentHex : "currentColor" })}
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={sectionLabel}>My experience</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {EXPERIENCE.map((t) => (
                <button key={t.id} style={chip(experience === t.id)} onClick={() => setExperience(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 26 }}>
            <div style={sectionLabel}>On a good day I write</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {WORD_GOALS.map((t) => (
                <button key={t.id} style={chip(wordGoal === t.id)} onClick={() => setWordGoal(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>

          <button style={primaryBtn} onClick={next}>Continue</button>
        </>
      ),
    },
    // 2 — handled above (GuidedTour)
    { key: "tour", render: () => null },
    // 3 — Your name
    {
      key: "name",
      render: () => (
        <>
          <IconTile accentHex={accentHex}><DSIcons.Edit size={28} color={accentHex} /></IconTile>
          <h2 className="mb-2 text-center text-2xl font-bold tracking-tight text-white">What should we call you?</h2>
          <p className="mb-6 text-center text-sm text-white/65" style={{ lineHeight: 1.6 }}>
            Shown on your home screen and your books' author line. Stored only on this device.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 26 }}>
            <div>
              <div style={sectionLabel}>Your name</div>
              <input
                autoFocus value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex Wong" style={inputStyle}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) next(); }}
              />
            </div>
            <div>
              <div style={sectionLabel}>Pen name <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></div>
              <input
                value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. midnightink" style={inputStyle}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) next(); }}
              />
            </div>
          </div>

          <button
            style={{ ...primaryBtn, opacity: name.trim() ? 1 : 0.45, cursor: name.trim() ? "pointer" : "default" }}
            disabled={!name.trim()} onClick={next}
          >
            Continue
          </button>
        </>
      ),
    },
    // 4 — Creator's note
    {
      key: "note",
      render: () => (
        <>
          {/* Photo placeholder — swap for the real creator photo when provided */}
          <div className="mb-5 flex items-center justify-center">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10"
              style={{ background: `linear-gradient(135deg, ${accentHex}55, ${accentHex}18)` }}
            >
              <DSIcons.User size={34} color={accentHex} />
            </div>
          </div>
          <h2 className="mb-4 text-center text-2xl font-bold tracking-tight text-white">
            {name.trim() ? `Hey ${name.trim().split(" ")[0]} —` : "One last thing —"}
          </h2>
          <p className="mb-3 text-sm text-white/75" style={{ lineHeight: 1.7 }}>
            I built AuthNo because I wanted a writing app that respects the writer: no cloud wall,
            no subscription treadmill, no distractions. Just you and the page.
          </p>
          <p className="mb-5 text-sm text-white/75" style={{ lineHeight: 1.7 }}>
            Everything you write here lives on your device, in a format built to survive. I hope it
            becomes the home of stories you're proud of.
          </p>

          <div
            className="mb-5 rounded-2xl border px-4 py-3.5"
            style={{ borderColor: `${accentHex}55`, background: `${accentHex}14` }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <DSIcons.Star size={14} color={accentHex} />
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text-1)" }}>Your 7-day trial starts now</span>
            </div>
            <div className="text-white/65" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Every Pro feature is unlocked, free, for a week — no card needed. If AuthNo earns its
              place, Pro is a single one-time purchase. Yours forever.
            </div>
          </div>

          <p className="mb-6 text-right text-sm italic text-white/55">— the creator of AuthNo</p>

          <button style={primaryBtn} onClick={next}>Start writing</button>
        </>
      ),
    },
  ];

  const current = pages[step];

  return createPortal(
    <div
      className="onb fixed inset-0 z-[20000] overflow-y-auto"
      style={{ background: "var(--scrim-strong)", backdropFilter: "blur(10px)", WebkitOverflowScrolling: "touch" }}
    >
      <style>{ONB_THEME_CSS}</style>
      <FloatingBlobs accentHex={accentHex} />

      <div className="min-h-full px-4 py-4 sm:px-6 sm:py-8 flex items-center justify-center">
        <div className="relative z-10 w-full max-w-md" style={{ animation: "panelPop 0.22s ease-out" }}>
          {/* Progress rail + skip */}
          <div className="mb-4 flex items-center gap-3">
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              {Array.from({ length: TOTAL }).map((_, i) => (
                <span key={i} style={{
                  width: i === step ? 16 : 6, height: 6, borderRadius: 3,
                  background: i <= step ? accentHex : "var(--border)",
                  transition: "all 0.25s",
                }} />
              ))}
            </div>
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: "var(--border-sm)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${((step + 1) / TOTAL) * 100}%`, background: accentHex, transition: "width 0.3s ease", borderRadius: 2 }} />
            </div>
            <span className="text-xs text-white/55" style={{ whiteSpace: "nowrap" }}>{step + 1} / {TOTAL}</span>
            <button
              onClick={() => finish(true)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/55 backdrop-blur-md transition hover:text-white/80"
            >
              Skip
            </button>
          </div>

          {/* Card */}
          <div
            className="rounded-[28px] border border-white/10 bg-black/35 shadow-2xl backdrop-blur-xl"
            style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.58)", maxHeight: "min(84dvh, 760px)", overflow: "hidden" }}
          >
            <div
              className="overflow-y-auto px-5 py-6 sm:px-6 sm:py-7"
              style={{ maxHeight: "min(84dvh, 760px)", WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={current.key}
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0, transition: T.base }}
                  exit={{ opacity: 0, x: -14, transition: { duration: 0.1 } }}
                >
                  {current.render()}

                  {/* Back link (not on the first step) */}
                  {step > 0 && (
                    <button
                      onClick={back}
                      className="mt-4 w-full text-center text-xs text-white/45 transition hover:text-white/70"
                      style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6 }}
                    >
                      ← Back
                    </button>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Keyboard hint (desktop) */}
          {!android && (
            <div className="mt-3 text-center text-[11px] text-white/40">
              → or Enter to continue · Esc to skip
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function IconTile({ children, accentHex }) {
  return (
    <div className="mb-5 flex items-center justify-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10"
        style={{ background: `${accentHex}18` }}
      >
        {children}
      </div>
    </div>
  );
}
