/**
 * Background.jsx — Compatibility shim
 *
 * The implementation has moved to DesignSystem/Backgrounds/GradientBackground.jsx.
 * This file re-exports everything so any existing import path still works
 * while you migrate callers to the new DesignSystem import.
 *
 * ✅ OLD (still works):
 *   import { Background, buildPalette } from './Background';
 *
 * ✅ NEW (preferred):
 *   import { GradientBackground, buildPalette, BackgroundRouter } from '../DesignSystem';
 *
 * You can delete this file once all callers have been updated.
 */
export { GradientBackground as Background, buildPalette, BackgroundRouter } from '../DesignSystem';
