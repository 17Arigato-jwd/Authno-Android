/**
 * Backgrounds/BackgroundRouter.jsx
 *
 * Reads the active theme's backgroundFx config and renders the correct
 * background component. This is the ONLY background import needed in App.js.
 *
 * Supported types (theme.backgroundFx.type):
 *   'gradient'  → GradientBackground  (animated blobs — default dark/light/OLED)
 *   'grain'     → GrainGradientBackground  (static grainy gradient — sepia/paper)
 *   'none'      → null  (pure CSS var background set by applyTheme)
 *
 * If backgroundFx.type is omitted:
 *   - Falls back to 'gradient' if backgroundFx.enabled is true
 *   - Falls back to 'none' if backgroundFx.enabled is false
 *
 * Usage in App.js:
 *   import { BackgroundRouter } from './DesignSystem/Backgrounds';
 *
 *   // Replace the old <Background ... /> usage:
 *   <BackgroundRouter
 *     accentHex={customization.accentHex}
 *     customization={customization}
 *     gradientEnabled={settings.enableGradient}
 *   />
 *
 * Props:
 *   accentHex         string   current accent colour from customization
 *   gradientEnabled   bool     user toggle for the gradient background
 *   customization     object   full CustomizationSlider state (for blob config)
 *                              { backgroundOpacity, gradient: { colorFrom, colorTo,
 *                                blobCountMin, blobCountMax, blobSizeMin, blobSizeMax,
 *                                speedMultiplier } }
 *   theme             object   active theme (from useTheme()). Optional — falls back
 *                              to gradient when omitted.
 */

import { GradientBackground } from './GradientBackground';
import { GrainGradientBackground } from './GrainGradientBackground';

export function BackgroundRouter({ accentHex, gradientEnabled = false, customization = {}, theme }) {
  const fx = theme?.backgroundFx ?? {};
  const type = fx.type ?? (gradientEnabled ? 'gradient' : 'none');

  if (type === 'grain') {
    return (
      <GrainGradientBackground
        colorFrom={fx.colorFrom ?? '#3d1a0a'}
        colorTo={fx.colorTo ?? '#0d0f2e'}
        angle={fx.angle ?? 135}
        grainOpacity={fx.grainOpacity ?? fx.opacity ?? 0.18}
        grainSize={fx.grainSize ?? 0.65}
        vignetteStrength={fx.vignetteStrength ?? 0.55}
        visible
      />
    );
  }

  if (type === 'gradient' || (type !== 'none' && gradientEnabled)) {
    const g = customization.gradient ?? {};
    return (
      <GradientBackground
        accentHex={accentHex}
        backgroundOpacity={customization.backgroundOpacity ?? 1}
        colorRange={g.colorFrom && g.colorTo ? { from: g.colorFrom, to: g.colorTo } : undefined}
        minBlobs={g.blobCountMin ?? fx.minBlobs ?? 7}
        maxBlobs={g.blobCountMax ?? fx.maxBlobs ?? 9}
        blobSizeRange={g.blobSizeMin != null ? { min: g.blobSizeMin, max: g.blobSizeMax } : (fx.blobSizeRange ?? undefined)}
        blobSpeedMultiplier={g.speedMultiplier ?? fx.speedMultiplier ?? 1}
        visible
      />
    );
  }

  // type === 'none' — background colour is handled purely by CSS vars (applyTheme)
  return null;
}
