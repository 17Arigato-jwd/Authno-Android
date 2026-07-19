/**
 * FirstBookTour.jsx — the interactive "Create My First Book" coach.
 *
 * Where GuidedTour is a passive spotlight walkthrough, this is hands-on: it
 * builds the user's REAL first book with them, one action at a time. Steps are
 * either optional (shown, but Continue is always live) or compulsory (Continue
 * stays locked until the user actually does the thing — with a quiet "Skip
 * this step" escape after a beat so nobody is trapped).
 *
 * Completion is read off the live book session for durable state (metadata
 * filled, chapter named, words written, a thread exists, a cover set) and off
 * one-shot signals for ephemeral actions (a save happened, History opened, an
 * export ran). The tour persists (utils/firstBookTour.js) so the writing step
 * can pause indefinitely and resume after a reload.
 *
 * App owns the real state and dialogs; this component drives navigation and
 * gates, and spotlights the real controls so the user learns by doing.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { T } from "../utils/motion";
import { hapticSelect } from "../utils/haptics";
import { DSIcons } from "../DesignSystem";
import { computeTourCard } from "../utils/tourPlacement";
import { chapterWords } from "./BookDashboard";
import { getThreadsData } from "../utils/threads";
import {
  getTourState, setTourStep, endFirstBookTour, subscribeTourSignal,
} from "../utils/firstBookTour";

const Z = 10650; // above the normal guided tour and every sheet/menu
const DEMO_GOAL = 15; // tiny streak goal set during onboarding so the flame lights fast

const firstChapterOf = (book) => {
  const chs = book?.chapters || [];
  return [...chs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0] || null;
};
const wordsInBook = (book) => (book?.chapters || []).reduce((n, c) => n + chapterWords(c), 0);

// ── Steps ────────────────────────────────────────────────────────────────────
// view:    'home' | 'book' | 'editor'  — screen the app must be showing.
// target:  data-tour anchor to spotlight (null = centred card). `targets`
//          lists fallbacks in priority order (e.g. the open metadata panel,
//          else the button that opens it).
// optional:true = Continue always enabled; false = gated on done(ctx).
// done:    (ctx) => bool — compulsory completion test (never trusted to throw).
// action:  opens a real surface via the shared 'authno-tour-action' event.
// ensureBook: run onEnsureBook() when advancing INTO this step (first book step).
//
// Order tells one continuous story: get your material in (import) → give the
// book its identity (details, chapter name) → set your pace (goal) → WRITE →
// dress it (cover) → protect it (save) → organise it (threads) → rewind it
// (history) → share it (export).
function buildSteps(android) {
  const hasAuthor = (a) => (typeof a === "string" ? a.trim() : (a && typeof a.name === "string" && a.name.trim()));
  return [
    {
      key: "intro", view: "home", target: null, optional: true,
      title: "Let's make your first book",
      body: "I'll walk you through it, start to finish — do each step yourself, and I'll wait. You can leave any time and pick up exactly where you stopped.",
      cta: "Let's go",
    },
    {
      key: "import", view: "home", target: "import-book", optional: true,
      title: "Got a draft already?",
      body: android
        ? "Import turns TXT, Markdown, DOCX, ODT, EPUB or PDF into a book — chapters and all. Nothing to import? Continue and we'll start you with a blank one."
        : "Import turns TXT, Markdown, DOCX, ODT, EPUB or PDF into a book — chapters and all. Nothing to import? Continue and we'll start you with a blank one.",
    },
    {
      key: "metadata", view: "book", targets: ["metadata-panel", "edit-metadata"], optional: false, ensureBook: true,
      title: "Here's your book — give it its details",
      body: "Open Edit metadata and fill in a bit: your author name, a genre, a one-line description. It travels inside the .authbook file and shows up in exports.",
      hint: "Fill in at least one detail, then Save.",
      done: (b) => !!(b && (
        (Array.isArray(b.authors) && b.authors.some(hasAuthor)) ||
        (typeof b.genre === "string" && b.genre.trim()) ||
        (typeof b.description === "string" && b.description.trim())
      )),
    },
    {
      key: "chapter", view: "book", targets: ["rename-chapter", "chapter-row", "chapters"], optional: false,
      title: "Details done — now name your first chapter",
      body: android
        ? "Every book opens with Chapter 1. Tap the ✎ pencil next to it, type a real title, and confirm. A name makes it yours."
        : "Every book opens with Chapter 1. Tap the ✎ pencil next to it (or right-click the chapter → Rename), type a real title, and confirm. A name makes it yours.",
      hint: "Rename the chapter to continue.",
      done: (b, ctx) => {
        const chs = b?.chapters || [];
        if (chs.length > 1) return true;
        const first = firstChapterOf(b);
        const title = (first?.title || "").trim();
        return !!title && title.toLowerCase() !== "chapter 1" && title !== ctx.entryChapterTitle;
      },
    },
    {
      key: "streak", view: "book", targets: ["streak-goal", "streak-panel", "streak-pill"], action: "streak", optional: true, setDemoGoal: true,
      title: "Your streak — let's make it light up",
      body: `This is your writing streak. For the walkthrough I've set a tiny goal of just ${DEMO_GOAL} words, so you'll see the flame come alive in a moment. You can change the goal right here — each book keeps its own.`,
    },
    {
      key: "write", view: "editor", target: "editor", optional: false, pause: true, float: true,
      title: `Write ${DEMO_GOAL} words — watch the flame`,
      body: `Here's your page. Type about ${DEMO_GOAL} words — the moment you reach the goal, the streak flame at the top lights up. No rush: close the app, come back tomorrow, and pick up right here.`,
      hint: `Write ${DEMO_GOAL} words to light your streak.`,
      done: (b) => wordsInBook(b) >= (b?.streak?.goalWords ?? DEMO_GOAL),
    },
    {
      key: "cover", view: "book", target: "add-cover", optional: true,
      title: "It reads like a book — make it look like one (optional)",
      body: "Add cover puts a face on what you just wrote — it shows on your shelf and the book screen. Skip it if you'd rather keep writing.",
    },
    {
      key: "save", view: "book", target: "menu", optional: false,
      title: "Save your book",
      body: android
        ? "Open the menu and tap Save to write your book to a .authbook file on your device — the durable, recoverable format that's yours to keep and move anywhere."
        : "Open the menu (or press Ctrl+S) and Save to write your book to a .authbook file — the durable, recoverable format that's yours to keep and move anywhere.",
      hint: "Save the book once to continue.",
      done: (b, ctx) => ctx.signals.save,
    },
    {
      key: "threads-intro", view: "editor", target: "threads", action: "threads", optional: true,
      title: "Meet Threads",
      body: "Threads track the moving parts of your story — plotlines, characters, anything you want to keep an eye on across chapters. Here's the panel. These are the built-in types (and you can invent your own):",
      types: true,
    },
    {
      key: "threads-make", view: "editor", targets: ["thread-new", "threads-panel"], action: "threads", optional: false,
      title: "Make your first thread",
      body: android
        ? "Tap ‘+ New thread’, pick a type (or make a custom one), give it a name, and save. That's it — you've started tracking a part of your story."
        : "Click ‘+ New thread’, pick a type (or create your own), give it a name, and save. That's it — you've started tracking a part of your story.",
      hint: "Create one thread to continue.",
      done: (b) => getThreadsData(b).threads.length >= 1,
    },
    {
      key: "history", view: "editor", target: android ? "menu" : "history", optional: false, injectEdit: true,
      title: "Nothing is ever lost",
      body: android
        ? "I just added an example line to the end of your chapter. Open the menu → History: you'll see that exact change as a before/after. Tap it to roll it back — every edit is recoverable."
        : "I just added an example line to the end of your chapter. Open History (top-right): you'll see that exact change as a before/after. Click it to roll it back — every edit is recoverable. Try it now.",
      hint: "Open History once to continue.",
      done: (b, ctx) => ctx.signals.history,
    },
    {
      key: "export", view: "book", target: "export-book", optional: true,
      title: "Share it anywhere (optional)",
      body: "When you're ready for readers, Export turns your book into TXT, HTML, EPUB or PDF. Your writing is never locked in here.",
    },
    {
      key: "done", view: "book", target: null, optional: true,
      title: "That's your first book",
      body: "You imported or started fresh, wrote, threaded, saved and more — the whole loop. It's all yours now. Keep going, and happy writing.",
      cta: "Finish",
    },
  ];
}

// The Threads step optionally lists the built-in types + the custom-type note.
function ThreadTypesInfo({ accentHex }) {
  const TYPES = [
    { icon: DSIcons.BookOpen, color: "#22c55e", name: "Plotline", desc: "A storyline you're tracking across chapters" },
    { icon: DSIcons.User, color: "#38bdf8", name: "Character Arc", desc: "How a character changes over the book" },
    { icon: DSIcons.Plus, color: accentHex, name: "Your own type", desc: "Make a custom type with its own fields & colour" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "10px 0 4px" }}>
      {TYPES.map((t) => (
        <div key={t.name} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, background: `${t.color}22`, border: `1px solid ${t.color}66`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <t.icon size={12} color={t.color} />
          </span>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-1)" }}>{t.name}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.4 }}>{t.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FirstBookTour({ active, android, accentHex, book, onNavigate, onEnsureBook, onSetGoal, onInjectEdit, onCleanup, onFinish }) {
  const [stepIndex, setStepIndex] = useState(() => getTourState().step || 0);
  // Remembers the book's real streak goal so we can restore it after temporarily
  // dropping it to DEMO_GOAL for the "watch the flame light" step.
  const originalGoalRef = useRef(null);
  const injectedRef = useRef(false);
  const [rect, setRect] = useState(null);
  const [searching, setSearching] = useState(false);
  const [allowSkip, setAllowSkip] = useState(false);
  const [cardH, setCardH] = useState(300);
  const cardRef = useRef(null);
  const steps = useRef(null);
  if (steps.current === null || steps.current.android !== android) {
    steps.current = { android, list: buildSteps(android) };
  }
  const list = steps.current.list;
  const step = list[Math.min(stepIndex, list.length - 1)];
  const pollRef = useRef(null);
  const elRef = useRef(null);

  // One-shot signals seen during this run (save / history / export).
  const signalsRef = useRef({ save: false, history: false, export: false });
  useEffect(() => subscribeTourSignal((name) => {
    if (name === "save") signalsRef.current.save = true;
    if (name === "history-open") signalsRef.current.history = true;
    if (name === "export") signalsRef.current.export = true;
    setTick((t) => t + 1); // re-evaluate gate
  }), []);

  // Snapshot captured when a step becomes active (for "changed from entry" gates).
  const entryRef = useRef({ entryChapterTitle: "" });
  const [tick, setTick] = useState(0); // forces gate re-eval on session/signal change

  // Persist step; capture entry snapshot; reset per-step signals sensibly.
  useEffect(() => {
    if (!active) return;
    setTourStep(stepIndex);
    entryRef.current = { entryChapterTitle: (firstChapterOf(book)?.title || "").trim() };
    // History/save gates are per-run flags — but the History step wants a
    // FRESH open (a change then a peek), so clear it on entering that step.
    if (step?.key === "history") signalsRef.current.history = false;
    if (step?.key === "save") signalsRef.current.save = false;
    // Live app actions the coach drives directly (see App coachSetGoal/coachInjectEdit):
    // set a tiny demo streak goal so the flame is reachable, and inject one
    // example edit so History has a real change to teach a rollback with.
    if (step?.setDemoGoal && onSetGoal) {
      if (originalGoalRef.current == null) originalGoalRef.current = book?.streak?.goalWords ?? 300;
      onSetGoal(DEMO_GOAL);
    }
    if (step?.injectEdit && onInjectEdit && !injectedRef.current) { injectedRef.current = true; onInjectEdit(); }
    setAllowSkip(false);
    const t = setTimeout(() => setAllowSkip(true), 6000); // nudge → escape hatch
    return () => clearTimeout(t);
  }, [active, stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = { signals: signalsRef.current, entryChapterTitle: entryRef.current.entryChapterTitle };
  // A gate must never be able to crash the app (beta.6: the metadata gate
  // assumed authors were strings, MetadataPanel saves {name} objects, and the
  // resulting TypeError took the whole tree down on Save). Broken gate = open.
  let isDone;
  try { isDone = step?.optional || !step?.done || step.done(book, ctx); }
  catch (e) { console.error('[FirstBookTour] gate error', e); isDone = true; }

  // Navigate + ensure the real book exists + open any tour-driven surface +
  // locate the spotlight target (first match wins across step.targets).
  useEffect(() => {
    if (!active || !step) return undefined;
    if (step.ensureBook) onEnsureBook?.();
    onNavigate?.(step.view);
    document.dispatchEvent(new CustomEvent("authno-tour-action", { detail: { action: step.action ?? null } }));
    const targetList = step.float ? [] : (step.targets ?? (step.target ? [step.target] : []));
    elRef.current = null;
    setRect(null);
    if (targetList.length === 0) { setSearching(false); return undefined; }
    setSearching(true);
    let tries = 0, scrolled = false;
    const find = () => {
      let el = null;
      for (const t of targetList) {
        el = document.querySelector(`[data-tour="${t}"]`);
        if (el) break;
      }
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          elRef.current = el;
          if (!scrolled) {
            scrolled = true;
            if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) {
              try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch { /* ignore */ }
            }
          }
          setRect((p) => (p && p.top === r.top && p.left === r.left && p.width === r.width && p.height === r.height)
            ? p : { top: r.top, left: r.left, width: r.width, height: r.height });
          setSearching(false);
          return; // keep polling: sheets animate in via transforms (no scroll events)
        }
      }
      if (!elRef.current && ++tries > 40) { setSearching(false); clearInterval(pollRef.current); }
    };
    find();
    pollRef.current = setInterval(find, 90);
    return () => clearInterval(pollRef.current);
  }, [active, stepIndex, step, onNavigate, onEnsureBook]);

  // Whatever the coach opened must not outlive it.
  useEffect(() => {
    if (!active) return undefined;
    return () => { document.dispatchEvent(new CustomEvent("authno-tour-action", { detail: { action: null } })); };
  }, [active]);

  // Keep the spotlight glued through resize/scroll.
  useEffect(() => {
    if (!active) return undefined;
    const sync = () => {
      const el = elRef.current;
      if (!el || !document.contains(el)) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener("resize", sync);
    document.addEventListener("scroll", sync, true);
    return () => { window.removeEventListener("resize", sync); document.removeEventListener("scroll", sync, true); };
  }, [active, stepIndex]);

  // Put the real streak goal back after the demo (we dropped it to DEMO_GOAL).
  const restoreGoal = useCallback(() => {
    if (originalGoalRef.current != null && onSetGoal) { onSetGoal(originalGoalRef.current); }
    originalGoalRef.current = null;
  }, [onSetGoal]);
  const finish = useCallback(() => { restoreGoal(); onCleanup?.(); endFirstBookTour(true); onFinish?.(); }, [onFinish, restoreGoal, onCleanup]);
  const skipTour = useCallback(() => { restoreGoal(); onCleanup?.(); endFirstBookTour(false); onFinish?.(); }, [onFinish, restoreGoal, onCleanup]);

  const advance = () => {
    hapticSelect();
    if (stepIndex < list.length - 1) setStepIndex((i) => i + 1);
    else finish();
  };
  const next = () => { if (isDone) advance(); };
  const back = () => { hapticSelect(); setStepIndex((i) => Math.max(0, i - 1)); };
  const skipStep = () => { hapticSelect(); advance(); };

  // Keyboard: → / Enter advance (only if unlocked), ← back. No Esc-to-kill —
  // this tour is deliberate; leaving is the explicit "Leave setup" link.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const typing = e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA" || e.target?.isContentEditable;
      if (typing) return;
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Measure the real card so placement uses true height (threads step adds the
  // type list, hints add rows) — guarded against sub-pixel loops.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h && Math.abs(h - cardH) > 4) setCardH(h);
  });

  if (!active || typeof document === "undefined" || !step) return null;

  const PAD = 6;
  const hole = !step.float && rect && { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };

  // Card sits in a gutter beside the spotlight (never over it); floats into a
  // corner without dimming for the writing step and when a target fills the
  // screen. See utils/tourPlacement.js.
  const CARD_W = Math.min(340, window.innerWidth - 24);
  const { style: cardStyle, dim } = computeTourCard({
    hole, cardW: CARD_W, cardH, vw: window.innerWidth, vh: window.innerHeight, float: step.float,
  });

  const compulsory = !step.optional;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none" }}>
      {/* Dim + spotlight. pointerEvents:none on the wrapper so the user can
          actually USE the highlighted control — this tour needs real clicks.
          Float steps (writing) render no dim so the page stays fully usable. */}
      {dim && (hole ? (
        <div style={{
          position: "fixed", top: hole.top, left: hole.left, width: hole.width, height: hole.height,
          borderRadius: 12, boxShadow: "0 0 0 200vmax rgba(0,0,0,0.55)",
          border: `2px solid ${accentHex}`, pointerEvents: "none",
          transition: "all 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)",
        }} />
      ) : (
        !searching && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", pointerEvents: "none" }} />
      ))}

      {/* Step card — this is the only interactive layer */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stepIndex}
          ref={cardRef}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.99 }}
          transition={T.base}
          style={{
            ...cardStyle, pointerEvents: "auto",
            background: "var(--modal-bg)", color: "var(--text-1)",
            border: "1px solid var(--border)", borderRadius: 18,
            padding: "16px 18px", boxShadow: "0 24px 70px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999,
              fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
              background: compulsory ? `${accentHex}1f` : "var(--surface)",
              border: `1px solid ${compulsory ? accentHex + "55" : "var(--border-sm)"}`,
              color: compulsory ? accentHex : "var(--text-4)",
            }}>
              {compulsory ? "Do this" : "Optional"}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)" }}>{stepIndex + 1} / {list.length}</span>
            <span style={{ flex: 1 }} />
            <button onClick={skipTour} style={{ border: "none", background: "transparent", color: "var(--text-4)", cursor: "pointer", fontSize: 11.5, padding: "2px 4px" }}>
              Leave setup
            </button>
          </div>

          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, letterSpacing: -0.2 }}>{step.title}</div>
          <div style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.6 }}>{step.body}</div>

          {step.types && <ThreadTypesInfo accentHex={accentHex} />}

          {/* Gate hint — shows what's needed while a compulsory step is locked */}
          {compulsory && !isDone && step.hint && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 12, padding: "8px 10px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border-sm)" }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${accentHex}`, borderTopColor: "transparent", animation: "fbt-spin 0.8s linear infinite", flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{step.hint}</span>
              <style>{"@keyframes fbt-spin{to{transform:rotate(360deg)}}"}</style>
            </div>
          )}
          {compulsory && isDone && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 12, padding: "8px 10px", borderRadius: 10, background: "var(--color-success-bg, rgba(34,197,94,0.1))", border: "1px solid var(--color-success, #22c55e)" }}>
              <DSIcons.Check size={13} color="var(--color-success, #22c55e)" />
              <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 600 }}>Nice — you're good to continue.</span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            {/* One slim bar, not a dot per step — 12 dots crowded the row and
                pushed the buttons out of the card. A bar can never overflow. */}
            <div style={{ flex: 1, minWidth: 0, height: 3, borderRadius: 2, background: "var(--border-sm)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${((stepIndex + 1) / list.length) * 100}%`, background: accentHex, borderRadius: 2, transition: "width 0.3s ease" }} />
            </div>
            {stepIndex > 0 && (
              <button onClick={back} style={{ padding: "8px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "transparent", color: "var(--text-2)", cursor: "pointer", fontSize: 12.5, display: "flex", alignItems: "center", gap: 4 }}>
                <DSIcons.ChevronLeft size={13} color="currentColor" /> Back
              </button>
            )}
            <button onClick={next} disabled={!isDone}
              style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: accentHex, color: "#fff", cursor: isDone ? "pointer" : "default", opacity: isDone ? 1 : 0.4, fontSize: 12.5, fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>
              {step.cta || (stepIndex === list.length - 1 ? "Finish" : "Continue")} <DSIcons.ChevronRight size={13} color="currentColor" />
            </button>
          </div>

          {/* Escape hatch — only for locked compulsory steps, after a beat */}
          {compulsory && !isDone && allowSkip && (
            <button onClick={skipStep} style={{ marginTop: 10, width: "100%", textAlign: "center", background: "transparent", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 11, padding: 2 }}>
              Skip this step
            </button>
          )}
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body
  );
}
