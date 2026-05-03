/**
 * DataDisplay.jsx — ListItem, EmptyState, AboutSection
 *
 * Exports: ListItem, EmptyState, AboutSection
 */

import { COLORS, TYPOGRAPHY, RADIUS, SPACING, SHADOWS } from './tokens';
import { APP_META, ATTRIBUTION } from './Fonts';
import { SettingGroup } from './SettingCard';

// ══════════════════════════════════════════════════════════════════════════════
// ListItem — generic list row
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ListItem
 *
 * Props:
 *   leading       ReactNode   icon or avatar on left
 *   leadingBg     string      background of leading box
 *   leadingSize   number      size of leading box px (default 40)
 *   title         string | ReactNode
 *   subtitle      string | ReactNode
 *   trailing      ReactNode   element on right
 *   accentHex     string
 *   active        bool
 *   divider       bool
 *   onClick       fn
 */
export function ListItem({ leading, leadingBg, leadingSize = 40, title, subtitle, trailing, accentHex, active = false, divider = false, onClick, style = {} }) {
  const accent = accentHex ?? COLORS.violet;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderRadius: RADIUS.md,
        background: active ? `${accent}12` : 'transparent',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s',
        borderBottom: divider ? `1px solid ${COLORS.border}` : 'none', ...style,
      }}
      onMouseEnter={e => onClick && !active && (e.currentTarget.style.background = COLORS.surface2)}
      onMouseLeave={e => onClick && !active && (e.currentTarget.style.background = 'transparent')}
    >
      {leading && (
        <div style={{
          width: leadingSize, height: leadingSize,
          borderRadius: leadingSize * 0.26, flexShrink: 0,
          background: leadingBg ?? COLORS.surface3,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: active ? accent : COLORS.textMuted, transition: 'color 0.15s',
        }}>
          {leading}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs,
          color: active ? COLORS.textPrimary : COLORS.textSecondary,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          lineHeight: 1.9, letterSpacing: TYPOGRAPHY.tracking.pixel,
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{
            fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle,
            marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {subtitle}
          </div>
        )}
      </div>
      {trailing && (
        <div style={{ flexShrink: 0, color: COLORS.textDisabled, display: 'flex', alignItems: 'center' }}>
          {trailing}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EmptyState — zero-content placeholder
// ══════════════════════════════════════════════════════════════════════════════

/**
 * EmptyState
 *
 * Props:
 *   icon, iconBg, accentHex, title, description, action (ReactNode CTA), compact bool
 */
export function EmptyState({ icon, iconBg, accentHex, title, description, action, compact = false, style = {} }) {
  const accent = accentHex ?? COLORS.violet;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: compact ? '32px 24px' : '64px 32px', gap: 0, ...style,
    }}>
      {icon && (
        <div style={{
          width: 72, height: 72, borderRadius: RADIUS.xl,
          background: iconBg ?? `${accent}18`, border: `1px solid ${accent}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent,
          marginBottom: 20, boxShadow: `0 0 32px ${accent}18`,
        }}>
          {icon}
        </div>
      )}
      {title && (
        <div style={{
          fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.sm,
          color: COLORS.textSecondary, letterSpacing: TYPOGRAPHY.tracking.pixel,
          marginBottom: 10, lineHeight: 1.8,
        }}>
          {title}
        </div>
      )}
      {description && (
        <div style={{
          fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.base,
          color: COLORS.textSubtle, lineHeight: 1.6, maxWidth: 280,
          marginBottom: action ? 24 : 0,
        }}>
          {description}
        </div>
      )}
      {action}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AboutSection — App identity + open-source credits
// ══════════════════════════════════════════════════════════════════════════════

/**
 * AboutSection — renders full About + Credits block.
 * Drop at the bottom of your Settings screen.
 *
 * Props:
 *   meta          APP_META-shaped object
 *   attribution   ATTRIBUTION-shaped array
 *   accentHex     string
 */
export function AboutSection({ meta = APP_META, attribution = ATTRIBUTION, accentHex, style = {} }) {
  const accent = accentHex ?? COLORS.violet;

  return (
    <div style={style}>
      {/* App identity */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 24px 24px', textAlign: 'center',
        borderBottom: `1px solid ${COLORS.border}`, marginBottom: 20,
      }}>
        <div style={{
          fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.lg,
          background: `linear-gradient(135deg, ${accent}, ${accent}99)`,
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          letterSpacing: TYPOGRAPHY.tracking.pixel, marginBottom: 12, lineHeight: 1.6,
        }}>
          {meta.name}
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px',
          background: `${accent}14`, border: `1px solid ${accent}33`, borderRadius: RADIUS.full, marginBottom: 10,
        }}>
          <span style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs, color: accent, letterSpacing: TYPOGRAPHY.tracking.pixel, lineHeight: 1.8 }}>
            v{meta.version}
          </span>
          <div style={{ width: 1, height: 10, background: `${accent}44` }} />
          <span style={{ fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle }}>
            {meta.buildDate}
          </span>
        </div>
        <span style={{ fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle }}>
          {meta.platform} · Built by {meta.author}
        </span>
      </div>

      {/* Attribution list */}
      <SettingGroup label="Open Source & Credits">
        {attribution.map((lib, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: '13px 16px', background: COLORS.surface2,
            border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.md,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs, color: COLORS.textSecondary, letterSpacing: TYPOGRAPHY.tracking.pixel, lineHeight: 1.9 }}>
                {lib.name}
              </span>
              <span style={{
                fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs, color: accent,
                background: `${accent}18`, border: `1px solid ${accent}33`,
                borderRadius: RADIUS.sm, padding: '2px 7px', letterSpacing: TYPOGRAPHY.tracking.pixel, lineHeight: 1.8, flexShrink: 0,
              }}>
                {lib.licence}
              </span>
            </div>
            <span style={{ fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle }}>{lib.author}</span>
            {lib.note && <span style={{ fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.xs, color: COLORS.textDisabled, fontStyle: 'italic' }}>{lib.note}</span>}
            {lib.url && (
              <a href={lib.url} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.xs, color: accent, textDecoration: 'none', marginTop: 1 }}>
                {lib.url}
              </a>
            )}
          </div>
        ))}
      </SettingGroup>

      {/* Footer */}
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
        {meta.repository && (
          <a href={meta.repository} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle, textDecoration: 'none' }}>
            {meta.repository}
          </a>
        )}
        {meta.supportEmail && (
          <a href={`mailto:${meta.supportEmail}`}
            style={{ fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle, textDecoration: 'none' }}>
            {meta.supportEmail}
          </a>
        )}
        <span style={{ fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs, color: COLORS.textDisabled, letterSpacing: TYPOGRAPHY.tracking.pixel, marginTop: 8, lineHeight: 2 }}>
          © {new Date().getFullYear()} {meta.author}
        </span>
      </div>
    </div>
  );
}
