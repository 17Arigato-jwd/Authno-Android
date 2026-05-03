/**
 * Backgrounds/GradientBackground.jsx — Animated ambient blob background
 *
 * The default Dark/Light mode background: floating radial blobs over a
 * solid base colour. Imported and used when theme.backgroundFx.enabled = true
 * or when the user enables "Gradient Background" in Settings.
 *
 * This is the same Background component that already existed in the project,
 * now living under DesignSystem/Backgrounds/ so it can be swapped out by
 * theme overrides.
 *
 * Props:
 *   accentHex           string              Accent colour → derives blob palette.
 *   palette             { accent,dark,base } Pre-built palette (overrides accentHex).
 *   colorRange          { from, to }        Blob colours interpolated between two hex values.
 *   visible             bool                Fade in/out. Default: true.
 *   backgroundOpacity   number 0-1          Max opacity when visible. Default: 1.
 *   baseColor           string              Container background. Default: '#0a0a0a'.
 *   minBlobs            number              Default: 7.
 *   maxBlobs            number              Default: 9.
 *   blobSizeRange       { min, max }        Flat size range px. Omit for 3-tier default.
 *   blobSpeedMultiplier number              >1 = slower. Default: 1.
 *   style, className    passthrough
 */

import { useEffect, useState, memo, useRef } from 'react';

// ── Keyframes (injected once) ─────────────────────────────────────────────────
const STYLE_ID = 'ds-blob-keyframes';
function injectKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes float-1 { 0% { transform: translate(0px, 0px) scale(1); } 100% { transform: translate(40px, -30px) scale(1.08); } }
    @keyframes float-2 { 0% { transform: translate(0px, 0px) scale(1); } 100% { transform: translate(-35px, 45px) scale(0.95); } }
    @keyframes float-3 { 0% { transform: translate(0px, 0px) scale(1); } 100% { transform: translate(50px, 30px) scale(1.05); } }
    @keyframes float-4 { 0% { transform: translate(0px, 0px) scale(1); } 100% { transform: translate(-25px, -50px) scale(1.1); } }
    @keyframes float-5 { 0% { transform: translate(0px, 0px) scale(1); } 100% { transform: translate(30px, 55px) scale(0.92); } }
  `;
  document.head.appendChild(style);
}

// ── BlobItem ──────────────────────────────────────────────────────────────────
const BlobItem = memo(({ data, fadeTime, fadeInTime }) => (
  <div
    style={{
      position: 'absolute', borderRadius: '50%',
      left: `${data.x}%`, top: `${data.y}%`,
      width: `${data.size}px`, height: `${data.size}px`,
      background: `radial-gradient(closest-side, ${data.color}, transparent)`,
      filter: 'blur(60px)',
      opacity: data.isDying ? 0 : data.opacity,
      willChange: 'transform, opacity',
      transform: 'translate3d(0,0,0)',
      animationName: data.animationName,
      animationDuration: `${data.duration}s`,
      animationTimingFunction: 'ease-in-out',
      animationIterationCount: 'infinite',
      animationDirection: 'alternate',
      transition: `opacity ${data.isDying ? fadeTime : fadeInTime}ms ease-in-out`,
    }}
  />
));

// ── Colour helpers ────────────────────────────────────────────────────────────
function hexToRgbValues(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) };
}
function interpolateColor(hex1, hex2, t) {
  const c1 = hexToRgbValues(hex1), c2 = hexToRgbValues(hex2);
  return `rgb(${Math.round(c1.r + (c2.r - c1.r) * t)}, ${Math.round(c1.g + (c2.g - c1.g) * t)}, ${Math.round(c1.b + (c2.b - c1.b) * t)})`;
}
function mixWithBlack(hex, percent) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return hex;
  return `rgb(${Math.round(parseInt(r[1], 16) * percent)}, ${Math.round(parseInt(r[2], 16) * percent)}, ${Math.round(parseInt(r[3], 16) * percent)})`;
}

/** buildPalette(accentHex) → { accent, light, dark, base } */
export function buildPalette(accentHex) {
  return {
    accent: accentHex,
    light:  interpolateColor(accentHex, '#ffffff', 0.35),
    dark:   mixWithBlack(accentHex, 0.25),
    base:   mixWithBlack(accentHex, 0.08),
  };
}

// ── GradientBackground ────────────────────────────────────────────────────────
export function GradientBackground({
  accentHex = '#ff0000',
  palette: paletteProp,
  colorRange,
  visible = true,
  backgroundOpacity = 1,
  baseColor = '#0a0a0a',
  minBlobs = 7,
  maxBlobs = 9,
  blobSizeRange,
  blobSpeedMultiplier = 1,
  style,
  className = '',
}) {
  const [blobs, setBlobs] = useState([]);
  const configRef = useRef(null);
  const palette = paletteProp ?? buildPalette(accentHex);
  configRef.current = { palette, colorRange, blobSizeRange, blobSpeedMultiplier };

  const ABSOLUTE_MAX = maxBlobs + 1;
  const FADE_TIME    = 2000;
  const FADE_IN_TIME = 2000;

  function generateBlob() {
    const { palette: c, colorRange: cr, blobSizeRange: bsr, blobSpeedMultiplier: bsm } = configRef.current;
    const isLight = Math.random() > 0.7;
    let color;
    if (isLight)     color = Math.random() > 0.5 ? '#ffffff' : c.light;
    else if (cr)     color = interpolateColor(cr.from, cr.to, Math.random());
    else {
      const r = Math.random();
      if (r < 0.33)      color = c.accent;
      else if (r < 0.66) color = c.dark;
      else               color = '#000000';
    }
    let size;
    if (bsr) {
      size = bsr.min + Math.random() * (bsr.max - bsr.min);
    } else {
      const sr = Math.random();
      if (sr < 0.3)      size = 20  + Math.random() * 60;
      else if (sr < 0.7) size = 80  + Math.random() * 170;
      else               size = 250 + Math.random() * 200;
    }
    const opacity      = isLight ? 0.05 + Math.random() * 0.1 : 0.1 + Math.random() * 0.3;
    const lifetime     = 5000 + Math.random() * 15000;
    const baseDuration = 10 + Math.random() * 20;
    const duration     = baseDuration * (bsm ?? 1);
    return {
      id: Math.random().toString(36).slice(2, 11),
      x: Math.random() * 100, y: Math.random() * 100,
      size, color, opacity,
      animationName: `float-${Math.floor(Math.random() * 5) + 1}`,
      duration, createdAt: Date.now(), lifetime, isDying: false,
    };
  }

  useEffect(() => { injectKeyframes(); }, []);

  useEffect(() => {
    setBlobs(Array.from({ length: minBlobs }, generateBlob));
    const interval = setInterval(() => {
      if (document.hidden) return;
      const now = Date.now();
      setBlobs(current => {
        let next = [...current], changed = false;
        next = next.map(b => {
          if (!b.isDying && now - b.createdAt > b.lifetime - FADE_TIME) { changed = true; return { ...b, isDying: true }; }
          return b;
        });
        const before = next.length;
        next = next.filter(b => now - b.createdAt < b.lifetime);
        if (next.length !== before) changed = true;
        const target = minBlobs + Math.floor(Math.random() * (maxBlobs - minBlobs + 1));
        if (next.length < target && next.length < ABSOLUTE_MAX && Math.random() > 0.2) { next.push(generateBlob()); changed = true; }
        return changed ? next : current;
      });
    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette.accent, minBlobs, maxBlobs]);

  return (
    <div
      className={className}
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden', backgroundColor: baseColor, ...style }}
    >
      {/* Static accent gradient — shown when blobs are disabled */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(to bottom left, ${accentHex}55 0%, ${accentHex}22 45%, ${accentHex}0a 70%, transparent 100%)`,
        opacity: visible ? 0 : 1,
        transition: 'opacity 2000ms ease-in-out',
      }} />
      {/* Animated blobs */}
      <div style={{ position: 'absolute', inset: 0, opacity: visible ? backgroundOpacity : 0, transition: 'opacity 2000ms ease-in-out' }}>
        {blobs.map(blob => <BlobItem key={blob.id} data={blob} fadeTime={FADE_TIME} fadeInTime={FADE_IN_TIME} />)}
      </div>
    </div>
  );
}
