/**
 * Motion.jsx — small reusable animated primitives built on the motion.js system.
 *   <Pressable>  a button/element with tap-press (and optional desktop hover-lift)
 *   <Reveal>     fade+rise its children in on mount
 *   <CountUp>    animate a number up to its value (easeOutCubic, rAF)
 * All respect the reduce-motion setting via useMotionEnabled().
 */

import { forwardRef, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useMotionEnabled, PRESS, HOVER_LIFT, MOBILE, DUR, EASE } from '../utils/motion';

export const Pressable = forwardRef(function Pressable(
  { as = 'button', lift = false, children, ...rest }, ref
) {
  const enabled = useMotionEnabled();
  const Comp = motion[as] || motion.button;
  return (
    <Comp
      ref={ref}
      whileTap={enabled ? PRESS : undefined}
      whileHover={enabled && !MOBILE && lift ? HOVER_LIFT : undefined}
      transition={{ duration: DUR.fast, ease: EASE }}
      {...rest}
    >
      {children}
    </Comp>
  );
});

export function Reveal({ children, delay = 0, y = 8, style, ...rest }) {
  const enabled = useMotionEnabled();
  if (!enabled) return <div style={style} {...rest}>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE, delay }}
      style={style}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function CountUp({ value = 0, duration = 650, format = (n) => n, style }) {
  const enabled = useMotionEnabled();
  const [display, setDisplay] = useState(enabled ? 0 : value);
  const rafRef = useRef(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (!enabled) { setDisplay(value); fromRef.current = value; return undefined; }
    const from = fromRef.current;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration, enabled]);
  return <span style={style}>{format(display)}</span>;
}
