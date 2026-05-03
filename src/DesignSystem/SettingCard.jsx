/**
 * SettingCard.jsx — Universal settings row + group wrapper
 *
 * Exports: SettingCard, SettingGroup
 *
 * controlType:
 *   'option'  → OptionSelector (radio circle — use for mutually exclusive choices)
 *   'toggle'  → Toggle switch
 *   'button'  → MinimalButton (pass buttonLabel + buttonVariant + onButtonClick)
 *   'custom'  → render `control` prop as-is
 *
 * Usage:
 *   <SettingCard
 *     icon={<DSIcons.BookOpen />}  iconBg="rgba(139,92,246,0.25)"
 *     title="Show home screen"
 *     description="Browse and choose a book on launch"
 *     controlType="option"  selected={startup === 'home'}  onSelect={() => setStartup('home')}
 *   />
 *
 *   <SettingCard
 *     icon={<DSIcons.Refresh />}  iconBg="rgba(245,158,11,0.2)"  iconColor={COLORS.warning}
 *     title="Restore previously open books"
 *     controlType="toggle"  toggleOn={restoreBooks}  onToggleChange={setRestoreBooks}
 *   />
 *
 *   <SettingCard
 *     icon={<DSIcons.Trash />}  danger
 *     title="Clear All Sessions"
 *     controlType="button"  buttonLabel="Clear"  onButtonClick={handleClear}
 *   />
 */

import { COLORS, TYPOGRAPHY, RADIUS, SPACING } from './tokens';
import { Toggle } from './Toggle';
import { MinimalButton } from './Buttons';
import { OptionSelector } from './Controls';

export function SettingCard({
  // icon box
  icon, iconBg, iconColor,
  // text
  title, description,
  // theming
  accentHex, danger = false, warning = false,
  // control
  controlType = 'option',
  // option
  selected = false, onSelect,
  // toggle
  toggleOn = false, onToggleChange,
  // button
  buttonLabel, buttonVariant = 'smooth', onButtonClick,
  // custom slot
  control,
  // card
  onClick, style = {},
}) {
  const accent = danger  ? COLORS.danger
               : warning ? COLORS.warning
               : (accentHex ?? COLORS.violet);

  const isOptionSelected = controlType === 'option' && selected;
  const resolvedIconBg    = iconBg    ?? `${accent}28`;
  const resolvedIconColor = iconColor ?? accent;

  let rightControl = null;
  if (controlType === 'option') {
    rightControl = <OptionSelector selected={selected} onChange={() => onSelect?.()} accentHex={accent} size={26} />;
  } else if (controlType === 'toggle') {
    rightControl = <Toggle on={toggleOn} onChange={onToggleChange} accentHex={accent} size="md" />;
  } else if (controlType === 'button') {
    rightControl = (
      <MinimalButton variant={buttonVariant} color={accent} size="sm" onClick={e => { e.stopPropagation(); onButtonClick?.(); }}>
        {buttonLabel}
      </MinimalButton>
    );
  } else if (controlType === 'custom') {
    rightControl = control;
  }

  return (
    <div
      onClick={onClick ?? (controlType === 'option' ? onSelect : undefined)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 18px', borderRadius: RADIUS.lg,
        background: isOptionSelected ? `${accent}0f` : COLORS.surface2,
        border: `1px solid ${isOptionSelected ? `${accent}55` : COLORS.border}`,
        boxShadow: isOptionSelected ? `0 0 16px ${accent}18` : 'none',
        cursor: onClick || controlType === 'option' ? 'pointer' : 'default',
        transition: 'background 0.18s, border-color 0.18s, box-shadow 0.18s',
        userSelect: 'none', ...style,
      }}
      onMouseEnter={e => { if (!isOptionSelected) e.currentTarget.style.background = COLORS.surface3; }}
      onMouseLeave={e => { e.currentTarget.style.background = isOptionSelected ? `${accent}0f` : COLORS.surface2; }}
    >
      {/* Icon box */}
      {icon && (
        <div style={{
          width: 42, height: 42, borderRadius: 10, flexShrink: 0,
          background: resolvedIconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: resolvedIconColor,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08)`,
        }}>
          {icon}
        </div>
      )}

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.md,
          fontWeight: TYPOGRAPHY.weight.semibold, color: COLORS.textPrimary,
          marginBottom: 3, lineHeight: 1.3,
        }}>
          {title}
        </div>
        {description && (
          <div style={{ fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle, lineHeight: 1.5 }}>
            {description}
          </div>
        )}
      </div>

      {/* Right control */}
      {rightControl && (
        <div style={{ flexShrink: 0, marginLeft: 8 }} onClick={e => controlType !== 'option' && e.stopPropagation()}>
          {rightControl}
        </div>
      )}
    </div>
  );
}

/**
 * SettingGroup — wraps a section of SettingCards with a label above.
 *
 * Props: label string, gap number (default 8), style
 */
export function SettingGroup({ label, gap = 8, style = {}, children }) {
  return (
    <div style={style}>
      {label && (
        <div style={{
          fontFamily: TYPOGRAPHY.pixel, fontSize: TYPOGRAPHY.pixelSize.xs,
          letterSpacing: TYPOGRAPHY.tracking.pixel, textTransform: 'uppercase',
          color: COLORS.textDisabled, marginBottom: 12, paddingLeft: 4, lineHeight: 2,
        }}>
          {label}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap }}>
        {children}
      </div>
    </div>
  );
}
