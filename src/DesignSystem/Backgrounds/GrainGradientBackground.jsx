/**
 * Backgrounds/GrainGradientBackground.jsx
 *
 * A static grainy gradient background — used by the Sepia and Paper themes.
 * Renders the theme's base colour with two soft radial blooms derived from the
 * theme's colorFrom / colorTo, overlaid with canvas noise for a tactile,
 * analogue paper feel. Intentionally NON-animated.
 *
 * v1.1.16 fixes (B3 + "bad texture backgrounds"):
 *   • Prop contract now matches what themes actually define (baseColor,
 *     colorFrom, colorTo, grainOpacity, grainSize). The router previously
 *     passed props this component didn't accept, so every grain theme
 *     silently rendered the hardcoded lavender defaults.
 *   • Noise baseline fixed: pixels were written as raw signed noise, which
 *     Uint8ClampedArray clamped to near-black — under multiply blending the
 *     whole screen got peppered with harsh dark specks. Multiply grain must
 *     sit near white (255) and dip down: `255 - random * amplitude`.
 *   • The 512×512 canvas was CSS-stretched to full screen (blurry smear).
 *     It now renders at device resolution, regenerates on resize, and uses
 *     imageRendering: pixelated so the grain stays crisp.
 *
 * Props:
 *   baseColor     string   theme background base            (default '#f5efe0')
 *   colorFrom     string   bloom colour A (hex)             (default '#9a6b2a')
 *   colorTo       string   bloom colour B (hex)             (default '#c4922e')
 *   grainOpacity  number   0–1 opacity of the noise layer   (default 0.18)
 *   grainSize     number   0–1 grain strength → amplitude   (default 0.65)
 *   vignetteStrength number 0–1 vignette darkness           (default 0.18)
 *   visible       bool     fade layer in/out                (default true)
 */

import { useEffect, useRef } from 'react';

function hexToRgba(hex, alpha) {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(128,128,128,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function GrainGradientBackground({
  baseColor        = '#f5efe0',
  colorFrom        = '#9a6b2a',
  colorTo          = '#c4922e',
  grainOpacity     = 0.18,
  grainSize        = 0.65,
  vignetteStrength = 0.18,
  visible          = true,
  style,
  className        = '',
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // grainSize 0–1 → noise amplitude in luminance units (subtle → strong)
    const amplitude = 18 + Math.max(0, Math.min(1, grainSize)) * 60;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, Math.floor(window.innerWidth * dpr));
      const H = Math.max(1, Math.floor(window.innerHeight * dpr));
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(W, H);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        // Multiply-blend grain: near-white baseline with random darker dips.
        const v = 255 - Math.random() * amplitude;
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
    };

    draw();
    let t;
    const onResize = () => { clearTimeout(t); t = setTimeout(draw, 200); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); };
  }, [grainSize]);

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
      {/* Layer 1: base colour */}
      <div style={{ position: 'absolute', inset: 0, background: baseColor }} />

      {/* Layer 2: bottom-left bloom (theme colorFrom) */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 55% 70% at -5% 80%, ${hexToRgba(colorFrom, 0.30)} 0%, transparent 65%)` }} />

      {/* Layer 3: top-right bloom (theme colorTo) */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 50% 55% at 105% 10%, ${hexToRgba(colorTo, 0.24)} 0%, transparent 65%)` }} />

      {/* Layer 4: bottom-centre blend of both */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 60% 30% at 50% 100%, ${hexToRgba(colorTo, 0.16)} 0%, transparent 70%)` }} />

      {/* Layer 5: canvas grain (multiply — darkens on light base) */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: grainOpacity,
          mixBlendMode: 'multiply',
          imageRendering: 'pixelated',
          pointerEvents: 'none',
        }}
      />

      {/* Layer 6: radial vignette */}
      <div style={{ position: 'absolute', inset: 0, background: vignette }} />
    </div>
  );
}
