/**
 * motion.js — shared animation system (framer-motion) for AuthNo.
 *
 * Personality: "subtle & snappy" — fast (~130–240ms), gentle ease-out, present
 * but never in the way. Screens slide directionally; books/chapters use a
 * shared-element (layoutId) morph.
 *
 * Accessibility: animations auto-disable when the OS "reduce motion" setting is
 * on OR the in-app "Reduce animations" toggle is set. Use useMotionEnabled() to
 * branch, or the pre-built variants (which the MotionProvider neutralises when
 * disabled via framer's MotionConfig reducedMotion, plus our own guards).
 *
 * Mobile: MOBILE is true on Android; heavy effects (large staggers, shimmers)
 * check it and fall back to something GPU-cheap (transform/opacity only).
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { isAndroid } from './platform';

export const MOBILE = isAndroid();

// ── Tokens ────────────────────────────────────────────────────────────────────
// Durations in seconds (framer-motion). Kept short for the "snappy" feel.
export const DUR = { fast: 0.13, base: 0.18, slow: 0.24, page: MOBILE ? 0.2 : 0.24 };
// Gentle ease-out (fast start, soft landing) and a symmetric in-out.
export const EASE = [0.22, 0.61, 0.36, 1];
export const EASE_INOUT = [0.4, 0, 0.2, 1];
// Springs — snappy with minimal overshoot. Softer variant for sheets.
export const SPRING = { type: 'spring', stiffness: 520, damping: 36, mass: 0.9 };
export const SPRING_SOFT = { type: 'spring', stiffness: 340, damping: 32 };

export const T = {
  fast: { duration: DUR.fast, ease: EASE },
  base: { duration: DUR.base, ease: EASE },
  slow: { duration: DUR.slow, ease: EASE },
  inOut: { duration: DUR.base, ease: EASE_INOUT },
};

// ── Reusable variants ─────────────────────────────────────────────────────────
export const V = {
  fade: { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } },
  fadeRise: {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: T.base },
    exit: { opacity: 0, y: 6, transition: T.fast },
  },
  pop: {
    hidden: { opacity: 0, scale: 0.9 },
    show: { opacity: 1, scale: 1, transition: SPRING },
    exit: { opacity: 0, scale: 0.92, transition: T.fast },
  },
  scaleIn: {
    hidden: { opacity: 0, scale: 0.96, y: 4 },
    show: { opacity: 1, scale: 1, y: 0, transition: T.base },
    exit: { opacity: 0, scale: 0.98, transition: T.fast },
  },
  sheet: {
    hidden: { y: '100%' },
    show: { y: 0, transition: SPRING_SOFT },
    exit: { y: '100%', transition: { duration: DUR.base, ease: EASE_INOUT } },
  },
};

/** Directional screen slide. dir: 1 = forward (enters from right), -1 = back. */
export function slideVariants(dir = 1) {
  const d = MOBILE ? 22 : 40;
  return {
    initial: { x: dir * d, opacity: 0 },
    animate: { x: 0, opacity: 1, transition: { duration: DUR.page, ease: EASE } },
    exit: { x: dir * -d, opacity: 0, transition: { duration: DUR.fast, ease: EASE_INOUT } },
  };
}

// Custom-driven screen variants for AnimatePresence (custom = direction).
// Forward pushes the outgoing screen left and slides the new one in from the
// right; back reverses it. Opening a book/chapter (dir === 2) reads as an
// "expand" instead of a sideways slide — the hero feel for books & chapters.
const SLIDE_X = MOBILE ? 22 : 44;
export const screenVariants = {
  initial: (dir) => (Math.abs(dir) === 2
    ? { opacity: 0, scale: 0.965, y: 6 }
    : { opacity: 0, x: SLIDE_X * Math.sign(dir || 1) }),
  animate: { opacity: 1, x: 0, scale: 1, y: 0, transition: { duration: DUR.page, ease: EASE } },
  exit: (dir) => (Math.abs(dir) === 2
    ? { opacity: 0, scale: 1.015, transition: { duration: DUR.fast, ease: EASE_INOUT } }
    : { opacity: 0, x: -SLIDE_X * Math.sign(dir || 1), transition: { duration: DUR.fast, ease: EASE_INOUT } }),
};

/** Stagger container — children with variants "hidden"/"show" cascade in. */
export function staggerContainer(stagger = MOBILE ? 0.03 : 0.045, delayChildren = 0) {
  return { hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren } } };
}

// Press/hover feedback for interactive elements (used via whileTap/whileHover).
export const PRESS = { scale: 0.97 };
export const HOVER_LIFT = { y: -2 };

// ── Reduced-motion context ──────────────────────────────────────────────────
function prefersReducedMotionOS() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

const MotionCtx = createContext({ enabled: true, mobile: MOBILE });

export function useMotion() { return useContext(MotionCtx); }
export function useMotionEnabled() { return useContext(MotionCtx).enabled; }

/**
 * Wrap the app. `reduce` comes from the in-app "Reduce animations" setting;
 * combined with the OS preference it yields `enabled`. framer's MotionConfig
 * gets reducedMotion="always" when disabled so even un-guarded motion components
 * collapse to opacity-only / no transform.
 */
export function MotionProvider({ reduce = false, children }) {
  const [osReduce, setOsReduce] = useState(prefersReducedMotionOS);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setOsReduce(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange); };
  }, []);
  const enabled = !reduce && !osReduce;
  return (
    <MotionCtx.Provider value={{ enabled, mobile: MOBILE }}>
      <MotionConfig reducedMotion={enabled ? 'never' : 'always'} transition={T.base}>
        {children}
      </MotionConfig>
    </MotionCtx.Provider>
  );
}
