/**
 * Layout.jsx — Layout primitives
 *
 * Exports: Divider, Spacer, Row, SectionLabel
 */

import { COLORS, TYPOGRAPHY, SPACING } from './tokens';

/** Divider — horizontal separator. accent=true → gradient line. */
export function Divider({ accent = false, accentHex, style = {} }) {
  return (
    <div style={{
      height: 1,
      background: accent
        ? `linear-gradient(to right, transparent, ${accentHex ?? COLORS.violet}66, transparent)`
        : COLORS.border,
      margin: `${SPACING.xl}px 0`,
      ...style,
    }} />
  );
}

/** Spacer — vertical gap. size matches SPACING keys. */
export function Spacer({ size = 'md' }) {
  return <div style={{ height: SPACING[size] ?? SPACING.md }} />;
}

/** Row — horizontal flex row. */
export function Row({ align = 'center', gap = 'md', wrap = false, style = {}, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: align,
      gap: SPACING[gap] ?? SPACING.md,
      flexWrap: wrap ? 'wrap' : 'nowrap', ...style,
    }}>
      {children}
    </div>
  );
}

/** SectionLabel — small uppercase label with border below. */
export function SectionLabel({ style = {}, children }) {
  return (
    <div style={{
      fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs,
      letterSpacing: TYPOGRAPHY.tracking.pixel, textTransform: 'uppercase',
      color: COLORS.textDisabled,
      paddingBottom: 10, marginBottom: 14,
      borderBottom: `1px solid ${COLORS.border}`,
      lineHeight: 2, ...style,
    }}>
      {children}
    </div>
  );
}
