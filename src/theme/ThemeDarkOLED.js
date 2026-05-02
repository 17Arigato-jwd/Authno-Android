/**
 * ThemeDarkOLED.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure black — every pixel off. Maximum battery saving on OLED screens.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createTheme } from './ThemeBase';
import { DARK_DEFAULT } from './ThemeDarkDefault';

export const DARK_OLED = createTheme(DARK_DEFAULT, {

  meta: {
    name:        'OLED Dark',
    id:          'dark-oled',
    isDark:      true,
    description: 'Pure black for OLED displays — every unused pixel is off.',
  },

  backgrounds: {
    app:           '#000000',
    sidebar:       '#000000',
    editor:        '#000000',
    modal:         '#080808',
    nav:           '#030303',
    customizer:    '#080808',
    customizerNav: '#030303',
    dropdown:      '#050505',
  },

  borders: {
    standard: 'rgba(255,255,255,0.08)',
    subtle:   'rgba(255,255,255,0.04)',
  },

  surfaces: {
    low:         'rgba(255,255,255,0.02)',
    mid:         'rgba(255,255,255,0.04)',
    cover:       'rgba(255,255,255,0.04)',
    coverBorder: 'rgba(255,255,255,0.08)',
  },

  glass: {
    background:      'rgba(0,0,0,0.70)',
    tileBg:          'rgba(0,0,0,0.75)',
    spinnerDisc:     'rgba(0,0,0,0.80)',
    spinnerTrack:    'rgba(255,255,255,0.06)',
    spinnerPending:  'rgba(255,255,255,0.20)',
    tabDivider:      'rgba(255,255,255,0.05)',
    tabActiveColor:  '#ffffff',
  },

  editor: {
    background: '#000000',
    textColor:  '#e8e8e8',
  },

  backgroundFx: {
    enabled:   false,
    baseColor: '#000000',
    opacity:   0.0,
  },

  effects: {
    scanlines:          false,
    vignette:           false,
    tintOverlay:        null,
    cssFilter:          null,
    pixelatedScrollbar: true,
  },
});
