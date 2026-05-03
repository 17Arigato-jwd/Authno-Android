/**
 * _utils.js — Internal DesignSystem Helpers
 * Not exported from index.js — only imported by sibling files.
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
