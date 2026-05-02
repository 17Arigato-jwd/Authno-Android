/**
 * ThemeSepia.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Warm vintage paper tone. Georgia serif in the editor. Soft sepia filter.
 * Great for long evening writing sessions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createTheme } from './ThemeBase';
import { DARK_DEFAULT } from './ThemeDarkDefault';

export const SEPIA = createTheme(DARK_DEFAULT, {

  meta: {
    name:        'Sepia',
    id:          'sepia',
    isDark:      false,
    description: 'Warm vintage paper — easy on the eyes for long sessions.',
  },

  accent: {
    primary:   '#9a6b2a',
    secondary: '#c4922e',
  },

  backgrounds: {
    app:           '#f5efe0',
    sidebar:       '#ede5d0',
    editor:        '#faf6ed',
    modal:         '#f5efe0',
    nav:           '#e8dfca',
    customizer:    '#f5efe0',
    customizerNav: '#e8dfca',
    dropdown:      '#ede5d0',
  },

  text: {
    t1: '#2c1f0e',
    t2: '#3d2d14',
    t3: '#5a4220',
    t4: '#7a5c30',
    t5: '#a07840',
  },

  borders: {
    standard: 'rgba(120,80,30,0.20)',
    subtle:   'rgba(120,80,30,0.10)',
  },

  surfaces: {
    low:         'rgba(100,65,20,0.05)',
    mid:         'rgba(100,65,20,0.09)',
    cover:       'rgba(100,65,20,0.07)',
    coverBorder: 'rgba(100,65,20,0.15)',
  },

  inputs: {
    background:  'rgba(100,65,20,0.06)',
    border:      'rgba(120,80,30,0.20)',
    focusBorder: null,
    placeholder: 'rgba(44,31,14,0.35)',
  },

  glass: {
    background:          'rgba(245,239,224,0.70)',
    backdropFilter:      'blur(18px) saturate(1.2)',
    border:              '1px solid rgba(120,80,30,0.15)',
    borderRadius:        20,
    bookCardBg:          null,
    bookCardBgHover:     null,
    bookCardBorder:      null,
    bookCardBorderHover: null,
    tileBg:              'rgba(237,229,208,0.75)',
    tileBgHover:         null,
    tileBorder:          'rgba(120,80,30,0.15)',
    tileBorderHover:     null,
    spinnerDisc:         'rgba(245,239,224,0.90)',
    spinnerTrack:        'rgba(120,80,30,0.12)',
    spinnerPending:      'rgba(120,80,30,0.30)',
    tabDivider:          'rgba(120,80,30,0.12)',
    tabActiveColor:      '#2c1f0e',
  },

  editor: {
    background:     '#faf6ed',
    textColor:      '#2c1f0e',
    fontFamily:     "Georgia, 'Times New Roman', serif",
    fontSize:       17,
    lineHeight:     1.85,
    letterSpacing:  '0.003em',
    caretColor:     null,
    selectionBg:    'rgba(154,107,42,0.22)',
    highlightColor: 'rgba(255,200,50,0.40)',
  },

  toolbar: {
    background:   null,
    darkStop:     'rgba(237,229,208,0.70)',
    accentAlpha:  '55',
    border:       '1px solid rgba(120,80,30,0.15)',
    fadeEdge:     'linear-gradient(to right, transparent, rgba(245,239,224,0.85))',
    itemColor:    '#3d2d14',
    itemHoverBg:  'rgba(100,65,20,0.08)',
    dividerColor: 'rgba(120,80,30,0.20)',
  },

  modals: {
    overlayBg:         'rgba(44,31,14,0.55)',
    overlayBlur:       'blur(4px)',
    panelBg:           '#f5efe0',
    panelBorder:       'rgba(120,80,30,0.15)',
    panelRadius:       16,
    panelShadow:       '0 24px 60px rgba(44,31,14,0.30)',
    closeButtonBg:     'rgba(100,65,20,0.08)',
    closeButtonColor:  '#7a5c30',
    closeButtonHoverBg:'rgba(100,65,20,0.15)',
  },

  sidebar: {
    background:          '#ede5d0',
    headerBorder:        'rgba(120,80,30,0.15)',
    sessionCardBg:       'linear-gradient(135deg, #e8dfca 0%, #ddd4b8 100%)',
    sessionCardBgLight:  'linear-gradient(135deg, #e8dfca 0%, #ddd4b8 100%)',
    sessionCardBorder:   'rgba(120,80,30,0.10)',
    activeSessionBorder: null,
    resizeHandleHover:   null,
    bottomTabBg:         '#ede5d0',
    bottomTabBorder:     'rgba(120,80,30,0.15)',
  },

  backgroundFx: {
    enabled:         false,
    baseColor:       '#f5efe0',
    colorFrom:       '#9a6b2a',
    colorTo:         '#c4922e',
    minBlobs:        4,
    maxBlobs:        6,
    blobSizeRange:   { min: 60, max: 320 },
    speedMultiplier: 2.0,
    opacity:         0.20,
  },

  streakCalendar: {
    dayEmpty:        'rgba(120,80,30,0.07)',
    dayEmptyBorder:  'rgba(120,80,30,0.15)',
    dayMet:          '#6a9a3a',
    dayMetBorder:    '#4a7a20',
    dayMissed:       'rgba(180,60,40,0.25)',
    dayMissedBorder: 'rgba(180,60,40,0.40)',
    dayToday:        null,
    dayText:         'rgba(44,31,14,0.55)',
  },

  effects: {
    scanlines:          false,
    scanlinesOpacity:   0.03,
    noise:              false,
    noiseOpacity:       0.04,
    vignette:           true,
    vignetteOpacity:    0.12,
    tintOverlay:        'rgba(112,66,20,0.04)',
    cssFilter:          'sepia(0.18) contrast(0.97) brightness(1.01)',
    pixelatedScrollbar: false,
  },
});
