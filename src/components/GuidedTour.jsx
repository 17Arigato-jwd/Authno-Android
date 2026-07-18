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

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { T } from "../utils/motion";
import { hapticSelect } from "../utils/haptics";
import { DSIcons } from "../DesignSystem";

// ── Step definitions ─────────────────────────────────────────────────────────
// view: which screen the app must show ('home' | 'book' | 'editor').
// target: data-tour attribute to spotlight (null = centered card).
export function buildTourSteps(android) {
  return [
    {
      view: "home", target: null,
      title: "Welcome to AuthNo",
      body: "A quick tour of how writing here works — from a blank page to a finished book. It takes about a minute, and you can skip out any time.",
    },
    {
      view: "home", target: "new-book",
      title: "Create a book",
      body: android
        ? "Every story starts here. “Create a New Book” makes a fresh book and drops you straight into it. You can also import TXT, DOCX, EPUB, PDF and more."
        : "Every story starts here — “New book” creates one and opens it. You can also open an existing .authbook or import TXT, DOCX, EPUB, PDF and more.",
    },
    {
      view: "home", target: "library",
      title: "Your library",
      body: android
        ? "Books you create or import are collected here. Tap one to open it; long-press rows in the drawer for more options."
        : "Books you create or import are collected here. Click a cover to open it, or right-click for options like removing a book.",
    },
    {
      view: "home", target: "import-book",
      title: "Bring your writing with you",
      body: "Already have a draft somewhere else? Import turns TXT, Markdown, DOCX, ODT, EPUB and even PDF into a proper AuthNo book — chapters and all.",
    },
    {
      view: "book", target: "chapters",
      title: "Chapters",
      body: android
        ? "Each book is organised into chapters. Tap a chapter to write in it, and use the synopsis line to remember what happens where."
        : "Each book is organised into chapters. Double-click one to write in it; Ctrl/Shift-click selects several at once. Every chapter can carry a short synopsis.",
    },
    {
      view: "book", target: "add-chapter",
      title: "Add chapters as you go",
      body: "New chapters land at the end and open ready to type. You can reorder or delete them later — deletions always ask first.",
    },
    {
      view: "book", target: "book-meta",
      title: "Cover & details",
      body: "Give the book a cover and fill in genre, description and the rest — it all exports with the book and lives inside the .authbook file.",
    },
    {
      view: "book", target: "export-book",
      title: "Export anywhere",
      body: "Your book is never locked in. Export to TXT, HTML, EPUB or PDF any time — ready for readers, editors, or publishing.",
    },
    {
      view: "editor", target: "editor",
      title: "Write",
      body: "This is where the words go. Just type — your work autosaves, and AuthNo remembers where you left off so you can resume in one tap.",
    },
    {
      view: "editor", target: "toolbar",
      title: "Format your prose",
      body: "Bold, italics, headings, lists, fonts and sizes. Select text to see the selection tools, too.",
    },
    {
      view: "editor", target: "threads",
      title: "Threads",
      body: "Track plotlines, character arcs and TODOs. Anchor a thread to a passage and it follows the text as your draft grows.",
    },
    {
      view: "editor", target: "streak",
      title: "Daily streak",
      body: "Set a word goal and keep the flame alive. Each book tracks its own progress and history.",
    },
    {
      view: "editor", target: "menu",
      title: "Save, export & more",
      body: "Save your book as an .authbook file, export to TXT / HTML / EPUB / PDF, rename it, or open the change History.",
    },
    {
      view: "editor", target: null,
      title: "You're all set",
      body: android
        ? "That's the whole loop: create, write, save. Tip — the menu's History entry shows your recent changes, and you can restore any of them."
        : "That's the whole loop: create, write, save. Pro tips — Ctrl+K jumps to any book or chapter, and Ctrl+Shift+Z opens the change History.",
    },
  ];
}

const Z = 10600; // above every sheet/menu in the app

export default function GuidedTour({ active, android, accentHex, onNavigate, onDone }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [searching, setSearching] = useState(false);
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

  // Navigate + locate the step's target.
  useEffect(() => {
    if (!active || !step) return undefined;
    onNavigate?.(step.view);
    elRef.current = null;
    setRect(null);
    if (!step.target) { setSearching(false); return undefined; }
    setSearching(true);

    let tries = 0;
    const find = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          elRef.current = el;
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
          setSearching(false);
          clearInterval(pollRef.current);
          return;
        }
      }
      // Screen transitions take ~400ms; give up after ~2.5s and center the card.
      if (++tries > 30) { setSearching(false); clearInterval(pollRef.current); }
    };
    find();
    pollRef.current = setInterval(find, 85);
    return () => clearInterval(pollRef.current);
  }, [active, stepIndex, step, onNavigate]);

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
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!active || typeof document === "undefined") return null;

  const PAD = 6;
  const hole = rect && {
    top: rect.top - PAD, left: rect.left - PAD,
    width: rect.width + PAD * 2, height: rect.height + PAD * 2,
  };

  // Card placement: under the target when there's room, else above; centered
  // when there's no target. Clamped to the viewport.
  const CARD_W = Math.min(330, window.innerWidth - 24);
  let cardStyle;
  if (hole) {
    const below = hole.top + hole.height + 14;
    const spaceBelow = window.innerHeight - below;
    const top = spaceBelow > 220 ? below : Math.max(12, hole.top - 14 - 210);
    const left = Math.min(Math.max(12, hole.left + hole.width / 2 - CARD_W / 2), window.innerWidth - CARD_W - 12);
    cardStyle = { position: "fixed", top, left, width: CARD_W };
  } else {
    cardStyle = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: CARD_W };
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: Z }}>
      {/* Click shield — the tour is Next-driven; stray taps shouldn't derail it. */}
      <div style={{ position: "absolute", inset: 0 }} onClick={next} />

      {/* Spotlight: the giant shadow dims everything except the cut-out. */}
      {hole ? (
        <div style={{
          position: "fixed", top: hole.top, left: hole.left, width: hole.width, height: hole.height,
          borderRadius: 12, boxShadow: "0 0 0 200vmax rgba(0,0,0,0.62)",
          border: `2px solid ${accentHex}`, pointerEvents: "none",
          transition: "all 0.32s cubic-bezier(0.22, 0.61, 0.36, 1)",
        }} />
      ) : (
        !searching && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.62)", pointerEvents: "none" }} />
      )}

      {/* Step card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stepIndex}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.99 }}
          transition={T.base}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...cardStyle,
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Progress dots */}
            <div style={{ display: "flex", gap: 4, flex: 1 }}>
              {list.map((_, i) => (
                <span key={i} style={{
                  width: i === stepIndex ? 14 : 5, height: 5, borderRadius: 3,
                  background: i <= stepIndex ? accentHex : "var(--border)",
                  transition: "all 0.25s",
                }} />
              ))}
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
