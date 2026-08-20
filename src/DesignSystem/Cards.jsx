/**
 * Cards.jsx — Frosted glass card
 *
 * Exports: FrostedCard
 */

import { COLORS, SHADOWS } from './tokens';

/**
 * FrostedCard — inline frosted glass panel.
 *
 * Props:
 *   accentHex   string   optional accent tint on border
 *   blur        number   blur strength in px  (default 18)
 *   padding     string   CSS padding           (default '24px')
 *   radius      number   border-radius px      (default 20)
 *   style       object
 */
export function FrostedCard({ accentHex, blur = 18, padding = '24px', radius = 20, style = {}, children }) {
  return (
    <div style={{
      backdropFilter: `blur(${blur}px) saturate(1.4)`,
      WebkitBackdropFilter: `blur(${blur}px) saturate(1.4)`,
      background: COLORS.tint,
      border: `1px solid ${accentHex ? `${accentHex}33` : COLORS.border}`,
      borderRadius: radius, padding,
      boxShadow: `inset 0 1px 0 ${COLORS.sheen}, ${SHADOWS.card}`,
      ...style,
    }}>
      {children}
    </div>
  );
}
