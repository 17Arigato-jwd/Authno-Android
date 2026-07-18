/**
 * GuidedTour.jsx — interactive walkthrough of the real app (v1.1.18).
 *
 * The welcome slides explain the philosophy; this shows the actual process:
 * create a book → chapters → write → format → threads → streak → save/export.
 * A spotlight cut-out highlights the real control for each step (elements are
 * found via data-tour attributes) while a small card explains it. The tour
 * navigates between Home / book / editor itself through onNavigate, works on
 * both layouts (mobile and desktop targets share the same data-tour names),
 * is skippable at every step, and can be replayed from Settings.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { T } from "../utils/motion";
import { hapticSelect } from "../utils/haptics";
import { DSIcons } from "../DesignSystem";
import { computeTourCard } from "../utils/tourPlacement";

// ── Step definitions ─────────────────────────────────────────────────────────
// view: which screen the app must show ('home' | 'book' | 'editor').
// target: data-tour attribute to spotlight (null = centered card).
//
// Deliberately COMPACT (8 stops). This is the welcome tour: a look around and
// an invitation to read "The Good Knight". The deep features — threads,
// streaks, history, metadata, export — are taught hands-on by the
// "Create My First Book" coach, where the user actually uses them. Teaching
// them twice made the welcome a 17-step marathon.
export function buildTourSteps(android) {
  return [
    {
      view: "home", target: null,
      title: "Welcome to AuthNo",
      body: "A quick look around — it takes under a minute, and there's a story waiting for you at the end. Skip out any time.",
    },
    {
      view: "home", target: "new-book",
      title: "Books start here",
      body: android
        ? "“Create a New Book” makes a fresh book and drops you straight into it."
        : "“New book” creates a fresh book and opens it. Ctrl+N does the same from anywhere.",
    },
    {
      view: "home", target: "import-book",
      title: "…or bring a draft with you",
      body: "Import turns TXT, Markdown, DOCX, ODT, EPUB and even PDF into a proper AuthNo book — chapters and all.",
    },
    {
      view: "home", target: "library",
      title: "Your library",
      body: "Everything you create or import lives here — including “The Good Knight”, a short story we've put on your shelf to explore.",
    },
    {
      view: "book", target: "chapters",
      title: "A book is chapters",
      body: android
        ? "Tap a chapter to read or write in it. Each one can carry a short synopsis so you remember what happens where."
        : "Double-click a chapter to read or write in it. Each one can carry a short synopsis so you remember what happens where.",
    },
    {
      view: "editor", target: "editor", float: true,
      title: "The page — go ahead, read a little",
      body: "This is The Good Knight, open for real. Scroll and read as much as you like — the tour waits, and this card stays out of the way. When you write, everything autosaves.",
    },
    {
      view: "editor", target: "menu",
      title: "Save, export & more",
      body: "Saving, exporting to EPUB/PDF, renaming and change History all live in this menu. You'll use them for real when you make your own book.",
    },
    {
      view: "editor", target: null,
      title: "That's the lay of the land",
      body: "When setup ends, look for “Create My First Book” on the home screen — it walks you through making yours, hands-on: details, chapters, writing, threads, saving and more.",
    },
  ];
}

const Z = 10600; // above every sheet/menu in the app

export default function GuidedTour({ active, android, accentHex, onNavigate, onDone }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [searching, setSearching] = useState(false);
  const [cardH, setCardH] = useState(240);
  const cardRef = useRef(null);
  const steps = useRef(null);
  if (steps.current === null || steps.current.android !== android) {
    steps.current = { android, list: buildTourSteps(android) };
  }
  const list = steps.current.list;
  const step = list[Math.min(stepIndex, list.length - 1)];
  const pollRef = useRef(null);
  const elRef = useRef(null);

  // Reset when a tour starts.
  useEffect(() => { if (active) setStepIndex(0); }, [active]);

  // Navigate + open/close tour-driven surfaces + locate the step's target.
  useEffect(() => {
    if (!active || !step) return undefined;
    onNavigate?.(step.view);
    // Steps can open a real surface (threads panel, streak calendar, burger
    // menu) so the tour explains the thing itself, not just its button. The
    // owners of that state are scattered (editor chrome, FlameButton, App),
    // so a document event is the seam; action: null closes everything.
    document.dispatchEvent(new CustomEvent("authno-tour-action", { detail: { action: step.action ?? null } }));
    elRef.current = null;
    setRect(null);
    // Float steps (reading) show no spotlight at all — nothing to locate.
    if (!step.target || step.float) { setSearching(false); return undefined; }
    setSearching(true);

    let tries = 0;
    let scrolled = false;
    const find = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          elRef.current = el;
          // Off-screen targets (long chapter lists, buttons below the fold)
          // get scrolled into view once, so the spotlight is always visible.
          if (!scrolled) {
            scrolled = true;
            if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) {
              try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch { /* ignore */ }
            }
          }
          setRect((prev) => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height)
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height });
          setSearching(false);
          // Deliberately keep polling: sheets and menus animate into place
          // with transforms, which fire no scroll events — the interval keeps
          // the spotlight glued to them for the whole step (85ms is cheap).
          return;
        }
      }
      // Screen transitions take ~400ms; give up after ~2.5s and center the card.
      if (!elRef.current && ++tries > 30) { setSearching(false); clearInterval(pollRef.current); }
    };
    find();
    pollRef.current = setInterval(find, 85);
    return () => clearInterval(pollRef.current);
  }, [active, stepIndex, step, onNavigate]);

  // Whatever the tour opened must not outlive it.
  useEffect(() => {
    if (!active) return undefined;
    return () => { document.dispatchEvent(new CustomEvent("authno-tour-action", { detail: { action: null } })); };
  }, [active]);

  // Keep the spotlight glued to the element through resize/scroll.
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
    return () => {
      window.removeEventListener("resize", sync);
      document.removeEventListener("scroll", sync, true);
    };
  }, [active, stepIndex]);

  const finish = useCallback(() => { onDone?.(); }, [onDone]);
  const next = () => { hapticSelect(); if (stepIndex < list.length - 1) setStepIndex((i) => i + 1); else finish(); };
  const back = () => { hapticSelect(); setStepIndex((i) => Math.max(0, i - 1)); };

  // Keyboard: → / Enter advance, ← back, Esc skips.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      // The app is interactive during the tour now — never steal keys from
      // someone typing in an input or the editor itself.
      const typing = e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA" || e.target?.isContentEditable;
      if (typing) return;
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Measure the real card so placement uses true height (content varies per
  // step) — guarded so it never loops on sub-pixel jitter.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h && Math.abs(h - cardH) > 4) setCardH(h);
  });

  if (!active || typeof document === "undefined") return null;

  const PAD = 6;
  const hole = !step.float && rect && {
    top: rect.top - PAD, left: rect.left - PAD,
    width: rect.width + PAD * 2, height: rect.height + PAD * 2,
  };

  // Card placement: sits in a gutter beside the spotlight, never on top of it;
  // floats into a corner (no dim) for reading steps or when the target fills
  // the screen. See utils/tourPlacement.js.
  const CARD_W = Math.min(330, window.innerWidth - 24);
  const { style: cardStyle, dim } = computeTourCard({
    hole, cardW: CARD_W, cardH, vw: window.innerWidth, vh: window.innerHeight, float: step.float,
  });

  return createPortal(
    // pointerEvents:none on the wrapper (the card re-enables its own): the
    // app stays fully usable during the tour, so the user can scroll and
    // READ The Good Knight mid-step. The old full-screen click shield made
    // every stray tap advance the tour and blocked reading entirely.
    <div style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none" }}>

      {/* Spotlight: the giant shadow dims everything except the cut-out. Float
          steps (reading) render no dim at all so the page stays fully visible. */}
      {dim && (hole ? (
        <div style={{
          position: "fixed", top: hole.top, left: hole.left, width: hole.width, height: hole.height,
          borderRadius: 12, boxShadow: "0 0 0 200vmax rgba(0,0,0,0.62)",
          border: `2px solid ${accentHex}`, pointerEvents: "none",
          transition: "all 0.32s cubic-bezier(0.22, 0.61, 0.36, 1)",
        }} />
      ) : (
        !searching && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.62)", pointerEvents: "none" }} />
      ))}

      {/* Step card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stepIndex}
          ref={cardRef}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.99 }}
          transition={T.base}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...cardStyle, pointerEvents: "auto",
            background: "var(--modal-bg)", color: "var(--text-1)",
            border: "1px solid var(--border)", borderRadius: 16,
            padding: "16px 18px", boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: accentHex, letterSpacing: 0.6 }}>
              {stepIndex + 1} / {list.length}
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={finish}
              style={{ border: "none", background: "transparent", color: "var(--text-4)", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}>
              Skip tour
            </button>
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6 }}>{step.title}</div>
          <div style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.6, marginBottom: 14 }}>{step.body}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* One slim bar, not a dot per step — the dot row overflowed the
                card once the tour grew, pushing Next out of bounds. */}
            <div style={{ flex: 1, minWidth: 0, height: 3, borderRadius: 2, background: "var(--border-sm)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${((stepIndex + 1) / list.length) * 100}%`, background: accentHex, borderRadius: 2, transition: "width 0.3s ease" }} />
            </div>
            {stepIndex > 0 && (
              <button onClick={back}
                style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-2)", cursor: "pointer", fontSize: 12.5, display: "flex", alignItems: "center", gap: 4 }}>
                <DSIcons.ChevronLeft size={13} color="currentColor" /> Back
              </button>
            )}
            <button onClick={next} autoFocus
              style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: accentHex, color: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
              {stepIndex === list.length - 1 ? "Finish" : "Next"} <DSIcons.ChevronRight size={13} color="currentColor" />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body
  );
}
