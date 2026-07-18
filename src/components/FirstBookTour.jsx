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

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { T } from "../utils/motion";
import { hapticSelect } from "../utils/haptics";
import { DSIcons } from "../DesignSystem";
import { chapterWords } from "./BookDashboard";
import { getThreadsData } from "../utils/threads";
import {
  getTourState, setTourStep, endFirstBookTour, subscribeTourSignal,
} from "../utils/firstBookTour";

const Z = 10650; // above the normal guided tour and every sheet/menu

const firstChapterOf = (book) => {
  const chs = book?.chapters || [];
  return [...chs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0] || null;
};
const wordsInBook = (book) => (book?.chapters || []).reduce((n, c) => n + chapterWords(c), 0);

// ── Steps ────────────────────────────────────────────────────────────────────
// view:    'home' | 'book' | 'editor'  — screen the app must be showing.
// target:  data-tour anchor to spotlight (null = centred card).
// optional:true = Continue always enabled; false = gated on done(ctx).
// done:    (ctx) => bool — compulsory completion test.
// ensureBook: run onEnsureBook() when advancing INTO this step (first book step).
function buildSteps(android) {
  return [
    {
      key: "intro", view: "home", target: null, optional: true,
      title: "Let's make your first book",
      body: "I'll walk you through it, start to finish — importing, writing, threads, saving and more. Do each step yourself; I'll wait. You can leave any time and pick up where you stopped.",
      cta: "Let's go",
    },
    {
      key: "import", view: "home", target: "import-book", optional: true,
      title: "Start from a draft (optional)",
      body: android
        ? "Already have something written? Import turns TXT, Markdown, DOCX, ODT, EPUB or PDF into a book — chapters and all. Or just skip to start with a blank page."
        : "Already have something written? Import turns TXT, Markdown, DOCX, ODT, EPUB or PDF into a book. Or skip to start with a blank page.",
    },
    {
      key: "streak", view: "book", target: "streak-pill", optional: true, ensureBook: true,
      title: "Set a daily goal (optional)",
      body: "Tap the flame to set how many words you want to write a day. Hit it and your streak grows — each book tracks its own. You can always change it later.",
    },
    {
      key: "metadata", view: "book", target: "edit-metadata", optional: false,
      title: "Add your book's details",
      body: "Open Edit metadata and fill in a bit — author, genre, a one-line description. It travels inside the .authbook file and shows up in exports.",
      hint: "Fill in at least one detail to continue.",
      done: (b) => !!(b && ((b.authors && b.authors.some((a) => a && a.trim())) || (b.genre && b.genre.trim()) || (b.description && b.description.trim()))),
    },
    {
      key: "chapter", view: "book", target: "chapters", optional: false,
      title: "Name your first chapter",
      body: "Every book opens with Chapter 1. Give it a real title — tap the chapter to rename it (or add another with New chapter). A name makes it yours.",
      hint: "Rename the chapter (or add one) to continue.",
      done: (b, ctx) => {
        const chs = b?.chapters || [];
        if (chs.length > 1) return true;
        const first = firstChapterOf(b);
        const title = (first?.title || "").trim();
        return !!title && title.toLowerCase() !== "chapter 1" && title !== ctx.entryChapterTitle;
      },
    },
    {
      key: "write", view: "editor", target: "editor", optional: false, pause: true,
      title: "Write a few words",
      body: "Here's the page. Write whatever you like — even a sentence. This step waits for you: close the app, come back tomorrow, and pick up right here.",
      hint: "Write a few words to continue — no rush.",
      done: (b) => wordsInBook(b) >= 5,
    },
    {
      key: "cover", view: "book", target: "add-cover", optional: true,
      title: "Add a cover (optional)",
      body: "Give the book a face. Add cover lets you pick a colour or an image — it shows on your shelf and on the book screen. Skip it if you'd rather not.",
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
      key: "threads", view: "editor", target: "threads", optional: false,
      title: "Track it with Threads",
      body: "Threads follow the moving parts of your story. Open the panel and make one — anchor it to a line and it sticks to that text as your draft grows.",
      hint: "Create a thread to continue.",
      types: true,
      done: (b) => getThreadsData(b).threads.length >= 1,
    },
    {
      key: "history", view: "editor", target: android ? "menu" : "history", optional: false,
      title: "Nothing is ever lost",
      body: android
        ? "Change a word or two, then open the menu and tap History. Every edit is there as a before/after — revert just that change, or roll the chapter back to any point."
        : "Change a word or two, then open History. Every edit is there as a before/after — revert just that change, or roll the chapter back to any point. Try it now.",
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

export default function FirstBookTour({ active, android, accentHex, book, onNavigate, onEnsureBook, onFinish }) {
  const [stepIndex, setStepIndex] = useState(() => getTourState().step || 0);
  const [rect, setRect] = useState(null);
  const [searching, setSearching] = useState(false);
  const [allowSkip, setAllowSkip] = useState(false);
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
    setAllowSkip(false);
    const t = setTimeout(() => setAllowSkip(true), 6000); // nudge → escape hatch
    return () => clearTimeout(t);
  }, [active, stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = { signals: signalsRef.current, entryChapterTitle: entryRef.current.entryChapterTitle };
  const isDone = step?.optional || !step?.done || step.done(book, ctx);

  // Navigate + ensure the real book exists + locate the spotlight target.
  useEffect(() => {
    if (!active || !step) return undefined;
    if (step.ensureBook) onEnsureBook?.();
    onNavigate?.(step.view);
    elRef.current = null;
    setRect(null);
    if (!step.target) { setSearching(false); return undefined; }
    setSearching(true);
    let tries = 0, scrolled = false;
    const find = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
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

  const finish = useCallback(() => { endFirstBookTour(true); onFinish?.(); }, [onFinish]);
  const skipTour = useCallback(() => { endFirstBookTour(false); onFinish?.(); }, [onFinish]);

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

  if (!active || typeof document === "undefined" || !step) return null;

  const PAD = 6;
  const hole = rect && { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };

  const CARD_W = Math.min(340, window.innerWidth - 24);
  const CARD_H = 320;
  let cardStyle;
  if (hole) {
    const below = hole.top + hole.height + 14;
    const spaceBelow = window.innerHeight - below;
    let top = spaceBelow > CARD_H ? below : hole.top - 14 - CARD_H;
    top = Math.max(12, Math.min(top, window.innerHeight - CARD_H - 12));
    const left = Math.min(Math.max(12, hole.left + hole.width / 2 - CARD_W / 2), window.innerWidth - CARD_W - 12);
    cardStyle = { position: "fixed", top, left, width: CARD_W };
  } else {
    cardStyle = { position: "fixed", top: Math.max(12, (window.innerHeight - CARD_H) / 2), left: Math.max(12, (window.innerWidth - CARD_W) / 2), width: CARD_W };
  }

  const compulsory = !step.optional;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none" }}>
      {/* Dim + spotlight. pointerEvents:none on the wrapper so the user can
          actually USE the highlighted control — this tour needs real clicks. */}
      {hole ? (
        <div style={{
          position: "fixed", top: hole.top, left: hole.left, width: hole.width, height: hole.height,
          borderRadius: 12, boxShadow: "0 0 0 200vmax rgba(0,0,0,0.55)",
          border: `2px solid ${accentHex}`, pointerEvents: "none",
          transition: "all 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)",
        }} />
      ) : (
        !searching && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", pointerEvents: "none" }} />
      )}

      {/* Step card — this is the only interactive layer */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stepIndex}
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

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
            <div style={{ display: "flex", gap: 4, flex: 1 }}>
              {list.map((_, i) => (
                <span key={i} style={{ width: i === stepIndex ? 14 : 5, height: 5, borderRadius: 3, background: i <= stepIndex ? accentHex : "var(--border)", transition: "all 0.25s" }} />
              ))}
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
