/**
 * Backgrounds/BackgroundRouter.jsx
 *
 * Reads either the active theme's backgroundFx config OR the user-selected
 * `backgroundEffect` setting and renders the correct background component.
 *
 * Props:
 *   accentHex         string   current accent colour
 *   backgroundEffect  string   user setting: 'none' | 'gradient' | 'grain'
 *                              Takes priority over theme.backgroundFx.type
 *   gradientEnabled   bool     legacy fallback if backgroundEffect is undefined
 *   customization     object   GradientBackground config (blobs, opacity, etc.)
 *   theme             object   active theme — theme.backgroundFx.type overrides
 *                              gradientEnabled but is overridden by backgroundEffect
 *
 * Priority chain (highest → lowest):
 *   backgroundEffect  >  theme.backgroundFx.type  >  gradientEnabled
 */

import { GradientBackground } from './GradientBackground';
import { GrainGradientBackground } from './GrainGradientBackground';

export function BackgroundRouter({
  accentHex,
  backgroundEffect,     // 'none' | 'gradient' | 'grain'  — user setting
  gradientEnabled = false,  // legacy bool fallback
  customization = {},
  theme,
}) {
  const fx = theme?.backgroundFx ?? {};

  // Resolve the effective type
  let type;
  if (backgroundEffect && backgroundEffect !== 'none') {
    type = backgroundEffect;                    // user dropdown wins
  } else if (backgroundEffect === 'none') {
    type = 'none';                              // user explicitly chose none
  } else if (fx.type) {
    type = fx.type;                             // theme specifies a type
  } else {
    type = gradientEnabled ? 'gradient' : 'none'; // legacy bool fallback
  }

  if (type === 'grain') {
    return (
      <GrainGradientBackground
        baseColor={fx.baseColor ?? '#f5efe0'}
        colorFrom={fx.colorFrom ?? '#9a6b2a'}
        colorTo={fx.colorTo ?? '#c4922e'}
        grainOpacity={fx.grainOpacity ?? fx.opacity ?? 0.18}
        grainSize={fx.grainSize ?? 0.65}
        vignetteStrength={fx.vignetteStrength ?? 0.18}
        visible
      />
    );
  }

  if (type === 'gradient') {
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

  // 'none' — CSS vars handle background colour only
  return null;
}
