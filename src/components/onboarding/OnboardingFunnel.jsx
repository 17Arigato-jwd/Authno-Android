/**
 * OnboardingFunnel.jsx — the five-step first-run funnel.
 *
 * Welcome → About you → Guided tour → Your name → Creator's note.
 *
 * Visual language follows the approved HTML prototype: a chip label above a
 * left-aligned title, content blocks, then a bottom action bar (circular back
 * button + big accent CTA) with "Skip for now" beneath. Rendered as a
 * full-screen portal over a blurred scrim with FloatingBlobs and the .onb
 * theme shim so light themes work.
 *
 * Step 3 (guided tour) hands off to the REAL GuidedTour over the REAL app —
 * "The Good Knight" sits in the library while the spotlight walks
 * home → book → editor (now including opened Threads / streak / menu steps),
 * then the funnel resumes for the name step.
 *
 * Lifecycle: demo book added on mount, removed on unmount/finish; profile
 * saved as the user advances; the 7-day trial starts on finish or skip
 * (startTrialMock never resets an existing clock or downgrades Pro); the
 * paywall opens from App just after completion.
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { T } from "../../utils/motion";
import { DSIcons } from "../../DesignSystem";
import { FloatingBlobs, ONB_THEME_CSS } from "../Onboarding";
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
      username: username.trim().replace(/^@+/, ""),
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
    if (step === 3 && !name.trim()) return;
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

  // ── Prototype design tokens ────────────────────────────────────────────────
  const chipStyle = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "6px 12px", borderRadius: 999,
    border: "1px solid var(--border-sm)", background: "var(--surface)",
    fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase",
    color: "var(--text-3)",
  };
  const titleStyle = { fontSize: 26, fontWeight: 800, lineHeight: 1.15, letterSpacing: -0.4, color: "var(--text-1)", margin: "14px 0 8px" };
  const subStyle = { fontSize: 14, color: "var(--text-3)", lineHeight: 1.6, margin: 0 };
  const sectionLabel = { fontSize: 12.5, fontWeight: 700, color: "var(--text-1)", margin: "0 0 8px" };
  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "13px 14px",
    borderRadius: 12, background: "var(--input-bg, var(--surface))",
    border: "1px solid var(--input-border, var(--border))",
    color: "var(--text-1)", fontSize: 14.5, outline: "none",
  };
  const optChip = (active) => ({
    display: "inline-flex", alignItems: "center", gap: 8,
    padding: "10px 14px", borderRadius: 999, cursor: "pointer",
    fontSize: 13, fontWeight: 600,
    border: `1.5px solid ${active ? accentHex : "var(--border)"}`,
    background: active ? `${accentHex}22` : "var(--surface)",
    color: active ? "var(--text-1)" : "var(--text-3)",
    transition: "all 0.15s",
  });
  const infoCard = {
    display: "flex", gap: 10, alignItems: "flex-start",
    padding: "13px 14px", borderRadius: 14,
    border: "1px solid var(--border-sm)", background: "var(--surface)",
    fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.55,
  };

  // ── Step content (chip · title · body · CTA label) ────────────────────────
  const pages = [
    // 0 — Welcome
    {
      key: "welcome",
      chip: { icon: DSIcons.Sparkle, label: "Welcome" },
      cta: "Get started",
      canContinue: true,
      render: () => (
        <>
          <h2 style={titleStyle}>Write your story.<br />Your way. Your device.</h2>
          <p style={{ ...subStyle, marginBottom: 22 }}>
            AuthNo is an offline-first home for books and long-form writing. No account, no cloud, no one watching over your shoulder.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { icon: DSIcons.Shield, text: "Works offline. Everything stays on your device." },
              { icon: DSIcons.Lock, text: "Your stories stay yours — no account wall." },
              { icon: DSIcons.Lightning, text: "Fast, focused, distraction-free writing." },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10" style={{ background: `${accentHex}18` }}>
                  <Icon size={16} color={accentHex} />
                </div>
                <div className="text-sm text-white/75">{text}</div>
              </div>
            ))}
          </div>
        </>
      ),
    },
    // 1 — About you
    {
      key: "about",
      chip: { icon: DSIcons.User, label: "About you" },
      cta: "Continue",
      canContinue: true,
      render: () => (
        <>
          <h2 style={titleStyle}>What brings you here?</h2>
          <p style={{ ...subStyle, marginBottom: 22 }}>
            We pre-picked the common answers — tap to change anything.
          </p>
          <div style={{ marginBottom: 18 }}>
            <div style={sectionLabel}>I want to write…</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {WRITING_TYPES.map((t) => (
                <button key={t.id} style={optChip(goalType === t.id)} onClick={() => setGoalType(t.id)}>
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
                <button key={t.id} style={optChip(experience === t.id)} onClick={() => setExperience(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={sectionLabel}>On a good day I write</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {WORD_GOALS.map((t) => (
                <button key={t.id} style={optChip(wordGoal === t.id)} onClick={() => setWordGoal(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>
        </>
      ),
    },
    // 2 — handled above (GuidedTour)
    { key: "tour", chip: null, cta: "", canContinue: true, render: () => null },
    // 3 — Your name
    {
      key: "name",
      chip: { icon: DSIcons.User, label: "Almost there" },
      cta: "Create profile",
      canContinue: !!name.trim(),
      render: () => (
        <>
          <h2 style={titleStyle}>What should we call you?</h2>
          <p style={{ ...subStyle, marginBottom: 22 }}>
            A name for your greeting, and a handle to save your spot. It all stays on this device.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={sectionLabel}>Your name</div>
              <input
                autoFocus value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Jane" style={inputStyle}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) next(); }}
              />
            </div>
            <div>
              <div style={sectionLabel}>Pick a username <span style={{ fontWeight: 500, color: "var(--text-4)" }}>(optional)</span></div>
              <input
                value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="@janewrites" style={inputStyle}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) next(); }}
              />
            </div>
            {/* Recap of the About-you picks */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span style={{ ...optChip(false), cursor: "default", padding: "7px 12px", fontSize: 12 }}>
                <DSIcons.BookOpen size={12} color="currentColor" />
                {WRITING_TYPES.find((t) => t.id === goalType)?.label ?? "A novel"}
              </span>
              <span style={{ ...optChip(false), cursor: "default", padding: "7px 12px", fontSize: 12 }}>
                <DSIcons.Target size={12} color="currentColor" />
                {WORD_GOALS.find((t) => t.id === wordGoal)?.label ?? "~300 words"}/day
              </span>
            </div>
            <div style={infoCard}>
              <DSIcons.Upload size={14} color="var(--text-4)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Saved on this device. Cloud accounts are coming — when they land, this profile
                carries over automatically. No email needed today.
              </span>
            </div>
          </div>
        </>
      ),
    },
    // 4 — Creator's note. Copy is final prototype text; [your name] and
    // [signature] are placeholders for the creator's real name + photo.
    {
      key: "note",
      chip: null,
      cta: "Start writing",
      canContinue: true,
      hideSkip: true,
      render: () => (
        <>
          {/* Photo — swap the icon circle for the real photo when provided */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <div style={{ position: "relative" }}>
              <div
                className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10"
                style={{ background: `linear-gradient(135deg, ${accentHex}, ${accentHex}55)` }}
              >
                <span style={{ fontSize: 30, fontWeight: 800, color: "#fff" }}>A</span>
              </div>
              <div
                className="absolute flex items-center justify-center rounded-full border border-white/10"
                style={{ right: -2, bottom: -2, width: 26, height: 26, background: "var(--modal-bg)" }}
              >
                <DSIcons.Camera size={13} color="var(--text-3)" />
              </div>
            </div>
          </div>
          <h2 style={{ ...titleStyle, textAlign: "center", fontSize: 22, margin: "0 0 16px" }}>
            Hey{name.trim() ? ` ${name.trim().split(" ")[0]}` : ""} — I'm [your name].
          </h2>
          <p className="text-white/75" style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 12px" }}>
            I built AuthNo because I wanted somewhere to write that felt calm and completely mine —
            no accounts, no distractions, no one watching over my shoulder. Just a page and the words.
          </p>
          <p className="text-white/75" style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 16px" }}>
            It's a one-person project. Every theme, every animation, every little detail is something
            I sweated over because I use this app every day too.
          </p>
          <div
            style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              padding: "13px 14px", borderRadius: 14, marginBottom: 16,
              background: "var(--color-success-bg, rgba(34,197,94,0.08))",
              border: "1px solid var(--color-success, #22c55e)",
            }}
          >
            <DSIcons.Star size={15} color="var(--color-success, #22c55e)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-1)", marginBottom: 2 }}>
                Everything's unlocked, free, for 7 days.
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
                Try the whole thing. If it's not for you, no charge — ever.
              </div>
            </div>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-3)", textAlign: "center", lineHeight: 1.6, margin: "0 0 6px" }}>
            Thanks for giving it a shot. I hope you write something you're proud of.
          </p>
          <p style={{ fontSize: 15, color: "var(--text-2)", textAlign: "right", fontStyle: "italic", fontFamily: "Georgia, serif", margin: 0 }}>
            — [signature]
          </p>
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
          {/* Progress rail */}
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
          </div>

          {/* Card */}
          <div
            className="rounded-[28px] border border-white/10 bg-black/35 shadow-2xl backdrop-blur-xl"
            style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.58)", maxHeight: "min(86dvh, 780px)", overflow: "hidden", display: "flex", flexDirection: "column" }}
          >
            <div
              className="overflow-y-auto px-5 pt-6 sm:px-6 sm:pt-7"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y", flex: 1, minHeight: 0 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={current.key}
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0, transition: T.base }}
                  exit={{ opacity: 0, x: -14, transition: { duration: 0.1 } }}
                >
                  {current.chip && (
                    <span style={chipStyle}>
                      <current.chip.icon size={11} color="currentColor" />
                      {current.chip.label}
                    </span>
                  )}
                  {current.render()}
                  <div style={{ height: 20 }} />
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Bottom action bar — circular back + big CTA, skip beneath */}
            <div className="px-5 pb-5 sm:px-6 sm:pb-6" style={{ flexShrink: 0, paddingTop: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {step > 0 && (
                  <button
                    onClick={back}
                    aria-label="Back"
                    className="flex items-center justify-center rounded-full border border-white/10 bg-white/5"
                    style={{ width: 48, height: 48, flexShrink: 0, cursor: "pointer", color: "var(--text-2)" }}
                  >
                    <DSIcons.ChevronLeft size={18} color="currentColor" />
                  </button>
                )}
                <button
                  onClick={next}
                  disabled={!current.canContinue}
                  style={{
                    flex: 1, height: 48, borderRadius: 14, border: "none",
                    background: accentHex, color: "#fff", fontSize: 14.5, fontWeight: 800,
                    cursor: current.canContinue ? "pointer" : "default",
                    opacity: current.canContinue ? 1 : 0.45,
                    boxShadow: current.canContinue ? `0 6px 18px ${accentHex}55` : "none",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  {current.cta} <DSIcons.ChevronRight size={15} color="currentColor" />
                </button>
              </div>
              {!current.hideSkip && (
                <button
                  onClick={() => finish(true)}
                  className="mt-3 w-full text-center text-xs text-white/45 transition hover:text-white/70"
                  style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}
                >
                  Skip for now
                </button>
              )}
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
