/**
 * Backgrounds/GrainGradientBackground.jsx
 *
 * A static grainy gradient background — used by the Sepia and Paper themes.
 * Renders a soft lavender base with radial colour blooms (warm terracotta
 * bottom-left, muted violet top-right, periwinkle bottom-centre), overlaid
 * with a canvas-based noise grain for a tactile, analogue feel.
 *
 * This background is intentionally NON-animated. It is still and textured,
 * like aged paper or a darkroom print — contrasting with GradientBackground's
 * floaty blobs.
 *
 * Props:
 *   baseColor        string   CSS hex for the background base  (default '#dddaf0')
 *   bloomWarm        string   CSS color for the bottom-left bloom (default 'rgba(180,110,90,0.38)')
 *   bloomCool        string   CSS color for the top-right bloom  (default 'rgba(140,120,190,0.28)')
 *   bloomBottom      string   CSS color for the bottom-centre bloom (default 'rgba(100,95,180,0.22)')
 *   grainOpacity     number   0–1 opacity of canvas noise layer  (default 0.27)
 *   grainAmplitude   number   pixel spread of noise (default 47)
 *   vignetteStrength number   0–1 vignette darkness at edges     (default 0.18)
 *   visible          bool     fade layer in/out (default true)
 *   style, className          passthrough
 *
 * Usage:
 *   <GrainGradientBackground
 *     baseColor="#dddaf0"
 *     grainOpacity={0.27}
 *   />
 *
 * Theme integration:
 *   backgroundFx: {
 *     type: 'grain',
 *     grainOpacity: 0.27,
 *   }
 */

import { useEffect, useRef } from 'react';

export function GrainGradientBackground({
  baseColor        = '#dddaf0',
  bloomWarm        = 'rgba(180, 110, 90, 0.38)',
  bloomCool        = 'rgba(140, 120, 190, 0.28)',
  bloomBottom      = 'rgba(100, 95, 180, 0.22)',
  grainOpacity     = 0.27,
  grainAmplitude   = 47,
  vignetteStrength = 0.18,
  visible          = true,
  style,
  className        = '',
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const imageData = ctx.createImageData(W, H);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * grainAmplitude;
      data[i]     = noise;
      data[i + 1] = noise;
      data[i + 2] = noise;
      data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }, [grainAmplitude]);

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
        backgroundColor: baseColor,
        ...style,
      }}
    >
      {/* ── Layer 1: base colour ── */}
      <div style={{ position: 'absolute', inset: 0, background: baseColor }} />

      {/* ── Layer 2: bottom-left warm terracotta bloom ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 55% 70% at -5% 80%, ${bloomWarm} 0%, transparent 65%)`,
        }}
      />

      {/* ── Layer 3: top-right muted violet bloom ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 50% 55% at 105% 10%, ${bloomCool} 0%, transparent 65%)`,
        }}
      />

      {/* ── Layer 4: bottom-centre periwinkle bloom ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 60% 30% at 50% 100%, ${bloomBottom} 0%, transparent 70%)`,
        }}
      />

      {/* ── Layer 5: canvas grain (multiply — darkens on light base) ── */}
      <canvas
        ref={canvasRef}
        width={512}
        height={512}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: grainOpacity,
          mixBlendMode: 'multiply',
          pointerEvents: 'none',
        }}
      />

      {/* ── Layer 6: radial vignette ── */}
      <div style={{ position: 'absolute', inset: 0, background: vignette }} />
    </div>
  );
}
