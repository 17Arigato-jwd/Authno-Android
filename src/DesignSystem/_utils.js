/**
 * _utils.js — Internal DesignSystem Helpers
 * Not exported from index.js — imported by sibling files, and by the theme
 * engine for onAccent(), which both layers need and neither should own twice.
 */

/**
 * pixelClip(c) — builds the stepped-corner clip-path used by
 * PixelButton, PixelInput, and ProgressBar.
 * `c` = corner cut size in px.
 */
export function pixelClip(c = 12) {
  const h = c, q = c * 0.67, e = c * 0.33;
  return `polygon(
    0px ${h}px,
    ${e}px ${h}px, ${e}px ${q}px,
    ${q}px ${q}px, ${q}px ${e}px,
    ${h}px ${e}px, ${h}px 0px,
    calc(100% - ${h}px) 0px,
    calc(100% - ${h}px) ${e}px,
    calc(100% - ${q}px) ${e}px,
    calc(100% - ${q}px) ${q}px,
    calc(100% - ${e}px) ${q}px,
    calc(100% - ${e}px) ${h}px,
    100% ${h}px, 100% calc(100% - ${h}px),
    calc(100% - ${e}px) calc(100% - ${h}px),
    calc(100% - ${e}px) calc(100% - ${q}px),
    calc(100% - ${q}px) calc(100% - ${q}px),
    calc(100% - ${q}px) calc(100% - ${e}px),
    calc(100% - ${h}px) calc(100% - ${e}px),
    calc(100% - ${h}px) 100%,
    ${h}px 100%,
    ${h}px calc(100% - ${e}px),
    ${q}px calc(100% - ${e}px),
    ${q}px calc(100% - ${q}px),
    ${e}px calc(100% - ${q}px),
    ${e}px calc(100% - ${h}px),
    0px calc(100% - ${h}px)
  )`;
}

let _sliderStyleInjected = false;

/**
 * ensureSliderCSS() — injects native range-input thumb styles once.
 * Called lazily inside PillSlider and DualPillSlider.
 */
export function ensureSliderCSS() {
  if (_sliderStyleInjected) return;
  _sliderStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .ds-pill-slider { -webkit-appearance: none; appearance: none; outline: none; cursor: pointer; background: transparent; }
    .ds-pill-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 32px; height: 32px; border-radius: 50%;
      background: radial-gradient(circle at 38% 38%, #ffffff, #e0e0e8);
      box-shadow: 0 3px 10px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,255,255,0.22), 0 0 16px rgba(139,92,246,0.35);
      cursor: pointer;
      transition: transform 0.14s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.14s;
    }
    .ds-pill-slider::-webkit-slider-thumb:hover {
      transform: scale(1.18);
      box-shadow: 0 5px 18px rgba(0,0,0,0.55), 0 0 0 4px rgba(255,255,255,0.28), 0 0 22px rgba(139,92,246,0.5);
    }
    .ds-pill-slider::-webkit-slider-thumb:active {
      transform: scale(0.93);
      box-shadow: 0 2px 8px rgba(0,0,0,0.6), 0 0 0 2px rgba(255,255,255,0.18);
    }
    .ds-pill-slider::-moz-range-thumb {
      width: 32px; height: 32px; border-radius: 50%;
      background: #fff; border: none; cursor: pointer;
      box-shadow: 0 3px 10px rgba(0,0,0,0.55);
    }
    .ds-dual-slider { -webkit-appearance: none; appearance: none; outline: none; cursor: pointer; background: transparent; pointer-events: none; position: absolute; inset: 0; width: 100%; height: 100%; }
    .ds-dual-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 32px; height: 32px; border-radius: 50%;
      background: radial-gradient(circle at 38% 38%, #ffffff, #e0e0e8);
      box-shadow: 0 3px 10px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,255,255,0.22), 0 0 16px rgba(139,92,246,0.35);
      pointer-events: all; cursor: grab;
      transition: transform 0.14s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.14s;
    }
    .ds-dual-slider::-webkit-slider-thumb:hover {
      transform: scale(1.18);
      box-shadow: 0 5px 18px rgba(0,0,0,0.55), 0 0 0 4px rgba(255,255,255,0.28), 0 0 22px rgba(139,92,246,0.5);
    }
    .ds-dual-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(0.93); }
    .ds-dual-slider::-moz-range-thumb {
      width: 32px; height: 32px; border-radius: 50%;
      background: #fff; border: none; pointer-events: all; cursor: grab;
    }
  `;
  document.head.appendChild(style);
}

/**
 * onAccent(hex) → the text colour that can be read on an accent fill.
 *
 * Lives here rather than in the theme engine because both layers need it and
 * the DesignSystem is the lower one. `ThemeBase` re-exports it, so the theme
 * engine and the widget bridge are unaffected; what changes is that a button
 * primitive can now call it, which is the whole point — every one of them
 * hardcoded `color: '#fff'` while the app's own buttons had been asking
 * `var(--on-accent)` for a release and a half.
 *
 * The accent is the writer's own choice and the picker is a full HSV wheel, so
 * every hue and every lightness is reachable. A label hardcoded to white was
 * already failing on two of the six shipped presets — Gold #f59e0b and Sage
 * #22c55e sit near 2:1 against white — and disappears outright on anything
 * paler.
 *
 * Keeps white until it drops below 3:1, then switches. That is deliberately
 * not the threshold that maximises contrast: maximising would also flip Ember
 * and Ocean, which clear 3:1 and have read as white buttons since the app
 * shipped. Restyling half the buttons is a redesign; this is a bug fix, so it
 * only moves the ones that are actually unreadable. Past that point black is
 * the better choice by a wide margin anyway — 9:1 or more — so there is no
 * case where the rule picks the worse of the two.
 *
 * Mirrored natively in WidgetTheme.readableOn so the widgets and the app agree.
 */
export function onAccent(hex) {
  return relativeLuminance(hex) > 0.30 ? '#111113' : '#ffffff';
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#000000');
  const [r, g, b] = m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [0, 0, 0];
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
