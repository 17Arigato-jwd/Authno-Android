/**
 * Backgrounds/GrainGradientBackground.jsx
 *
 * A static grainy gradient background — used by the Sepia and Paper themes.
 * Inspired by the uploaded reference image: a dark diagonal gradient from
 * warm brown-red (top-left) to deep navy-indigo (bottom-right), overlaid
 * with a SVG noise/grain texture for a tactile, analogue feel.
 *
 * This background is intentionally NON-animated. It is still and textured,
 * like aged paper or a darkroom print — contrasting with GradientBackground's
 * floaty blobs.
 *
 * Props:
 *   colorFrom     string   CSS color at top-left   (default warm brown '#3d1a0a')
 *   colorTo       string   CSS color at bottom-right (default deep navy '#0d0f2e')
 *   angle         number   gradient angle in degrees (default 135)
 *   grainOpacity  number   0–1 opacity of noise layer (default 0.18)
 *   grainSize     number   SVG feTurbulence baseFrequency (default 0.65)
 *                          Higher = finer grain, Lower = coarser grain
 *   vignetteStrength number 0–1 vignette darkness at edges (default 0.55)
 *   visible       bool     fade layer in/out (default true)
 *   style, className       passthrough
 *
 * Usage — inside a theme file or settings panel:
 *   <GrainGradientBackground
 *     colorFrom="#3d1a0a"
 *     colorTo="#0d0f2e"
 *     grainOpacity={0.18}
 *   />
 *
 * Theme integration — themes that want this background should set:
 *   backgroundFx: {
 *     type: 'grain',
 *     colorFrom: '#3d1a0a',
 *     colorTo:   '#0d0f2e',
 *     grainOpacity: 0.18,
 *   }
 * Then BackgroundRouter (see index.js) will pick this component automatically.
 */

import { useMemo, useRef } from 'react';

// Generate a unique SVG filter ID per instance so multiple instances
// on the same page don't share the same filter element.
let _grainIdCounter = 0;

export function GrainGradientBackground({
  colorFrom       = '#3d1a0a',
  colorTo         = '#0d0f2e',
  angle           = 135,
  grainOpacity    = 0.18,
  grainSize       = 0.65,
  vignetteStrength = 0.55,
  visible         = true,
  style,
  className       = '',
}) {
  const filterId = useRef(`ds-grain-${++_grainIdCounter}`).current;

  // Build the SVG noise filter as a data URI so we don't need an external file.
  // feTurbulence generates Perlin noise; feColorMatrix converts it to a
  // luminance-only layer that blends as a grain overlay.
  const svgGrain = useMemo(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
        <filter id="${filterId}">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="${grainSize}"
            numOctaves="4"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="200" height="200" filter="url(#${filterId})" opacity="1" />
      </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, [filterId, grainSize]);

  // Radial vignette: darkens the four corners for depth and framing.
  const vignette = `radial-gradient(
    ellipse 110% 110% at 50% 50%,
    transparent 40%,
    rgba(0,0,0,${vignetteStrength * 0.5}) 70%,
    rgba(0,0,0,${vignetteStrength}) 100%
  )`;

  return (
    <div
      className={className}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transition: 'opacity 600ms ease',
        ...style,
      }}
    >
      {/* ── Layer 1: diagonal gradient base ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(${angle}deg, ${colorFrom} 0%, ${colorTo} 100%)`,
        }}
      />

      {/* ── Layer 2: grain texture overlay ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url("${svgGrain}")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '200px 200px',
          opacity: grainOpacity,
          mixBlendMode: 'overlay',
        }}
      />

      {/* ── Layer 3: subtle radial vignette ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: vignette,
        }}
      />

      {/* ── Layer 4: micro-horizontal scanlines (very subtle, optional) ──
          Adds a faint CRT/print texture at very low opacity.
          Set to 0 to disable. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
