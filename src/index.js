/**
 * DesignSystem/index.js — Authno Design System Barrel
 * ─────────────────────────────────────────────────────────────────────────────
 * The ONLY file other parts of the app need to import from.
 * Every primitive, component, and token is re-exported here.
 *
 * Usage:
 *   import {
 *     // Tokens
 *     COLORS, GRADIENTS, TYPOGRAPHY, SPACING, RADIUS, SHADOWS,
 *
 *     // Buttons
 *     PixelButton, GradientButton, GhostButton, DangerButton, MinimalButton,
 *
 *     // Sliders
 *     PillSlider, DualPillSlider,
 *
 *     // Toggle
 *     Toggle,
 *
 *     // Inputs
 *     PixelInput, TextInput,
 *
 *     // Cards & Glass
 *     FrostedCard,
 *
 *     // Overlays
 *     FrostedModal, BottomSheet, Tooltip,
 *
 *     // Controls
 *     Chip, Badge, ProBadge, OptionSelector, ColorSwatchRow,
 *
 *     // Settings rows
 *     SettingCard, SettingGroup,
 *
 *     // Typography
 *     PixelText, Heading, Body, Caption, MonoText, GradientText,
 *
 *     // Layout
 *     Divider, Spacer, Row, SectionLabel,
 *
 *     // Progress & Tabs
 *     ProgressBar, CircularProgress, Tabs,
 *
 *     // Notifications
 *     useToast, ToastContainer,
 *
 *     // Data display
 *     ListItem, EmptyState, AboutSection,
 *
 *     // Icons
 *     DSIcons,
 *
 *     // Fonts & metadata
 *     injectDesignSystemFonts, APP_META, ATTRIBUTION,
 *
 *     // Backgrounds (also available from DesignSystem/Backgrounds directly)
 *     BackgroundRouter, GradientBackground, GrainGradientBackground, buildPalette,
 *   } from './DesignSystem';
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Folder structure
 * ─────────────────────────────────────────────────────────────────────────────
 *   DesignSystem/
 *     index.js                  ← this file
 *     tokens.js                 ← COLORS, GRADIENTS, TYPOGRAPHY, SPACING, RADIUS, SHADOWS
 *     _utils.js                 ← pixelClip(), ensureSliderCSS()  (internal only)
 *     Fonts.js                  ← injectDesignSystemFonts, APP_META, ATTRIBUTION
 *     Buttons.jsx               ← PixelButton, GradientButton, GhostButton, DangerButton, MinimalButton
 *     Sliders.jsx               ← PillSlider, DualPillSlider
 *     Toggle.jsx                ← Toggle
 *     Inputs.jsx                ← PixelInput, TextInput
 *     Cards.jsx                 ← FrostedCard
 *     Overlays.jsx              ← FrostedModal, BottomSheet, Tooltip
 *     Controls.jsx              ← Chip, Badge, ProBadge, OptionSelector, ColorSwatchRow
 *     SettingCard.jsx           ← SettingCard, SettingGroup
 *     Typography.jsx            ← PixelText, Heading, Body, Caption, MonoText, GradientText
 *     Layout.jsx                ← Divider, Spacer, Row, SectionLabel
 *     Progress.jsx              ← ProgressBar, CircularProgress, Tabs
 *     Toast.jsx                 ← useToast, ToastContainer, _emitToast
 *     DataDisplay.jsx           ← ListItem, EmptyState, AboutSection
 *     Icons.jsx                 ← DSIcons
 *     Backgrounds/
 *       GradientBackground.jsx  ← GradientBackground, buildPalette (animated blobs)
 *       GrainGradientBackground.jsx ← GrainGradientBackground (grainy static gradient)
 *       BackgroundRouter.jsx    ← BackgroundRouter  (picks the right background)
 *       index.js                ← Backgrounds barrel
 */

// ── Tokens ─────────────────────────────────────────────────────────────────────
export { COLORS, GRADIENTS, TYPOGRAPHY, SPACING, RADIUS, SHADOWS } from './tokens';

// ── Fonts & Metadata ──────────────────────────────────────────────────────────
export { injectDesignSystemFonts, APP_META, ATTRIBUTION } from './Fonts';

// ── Buttons ───────────────────────────────────────────────────────────────────
export { PixelButton, GradientButton, GhostButton, DangerButton, MinimalButton } from './Buttons';

// ── Sliders ───────────────────────────────────────────────────────────────────
export { PillSlider, DualPillSlider } from './Sliders';

// ── Toggle ────────────────────────────────────────────────────────────────────
export { Toggle } from './Toggle';

// ── Inputs ────────────────────────────────────────────────────────────────────
export { PixelInput, TextInput } from './Inputs';

// ── Cards ─────────────────────────────────────────────────────────────────────
export { FrostedCard } from './Cards';

// ── Overlays ──────────────────────────────────────────────────────────────────
export { FrostedModal, BottomSheet, Tooltip } from './Overlays';

// ── Controls ──────────────────────────────────────────────────────────────────
export { Chip, Badge, ProBadge, OptionSelector, ColorSwatchRow } from './Controls';

// ── Setting Rows ──────────────────────────────────────────────────────────────
export { SettingCard, SettingGroup } from './SettingCard';

// ── Typography ────────────────────────────────────────────────────────────────
export { PixelText, Heading, Body, Caption, MonoText, GradientText } from './Typography';

// ── Layout ────────────────────────────────────────────────────────────────────
export { Divider, Spacer, Row, SectionLabel } from './Layout';

// ── Progress & Tabs ───────────────────────────────────────────────────────────
export { ProgressBar, CircularProgress, Tabs } from './Progress';

// ── Notifications ─────────────────────────────────────────────────────────────
export { useToast, ToastContainer, toast, _emitToast } from './Toast';

// ── Data Display ──────────────────────────────────────────────────────────────
export { ListItem, EmptyState, AboutSection } from './DataDisplay';

// ── Icons ─────────────────────────────────────────────────────────────────────
export { DSIcons } from './Icons';

// ── Backgrounds ───────────────────────────────────────────────────────────────
export { GradientBackground, buildPalette } from './Backgrounds/GradientBackground';
export { GrainGradientBackground }           from './Backgrounds/GrainGradientBackground';
export { BackgroundRouter }                  from './Backgrounds/BackgroundRouter';
