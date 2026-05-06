/**
 * ThemeLightDefault.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Clean white surfaces, cool grey tones, violet accent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createTheme } from './ThemeBase';
import { DARK_DEFAULT } from './ThemeDarkDefault';

export const LIGHT_DEFAULT = createTheme(DARK_DEFAULT, {

  meta: {
    name:        'Light',
    id:          'light-default',
    isDark:      false,
    description: 'Clean white surfaces with violet accents.',
  },

  backgrounds: {
    app:           '#f0f0f2',
    sidebar:       '#ffffff',
    editor:        '#f8f8fa',
    modal:         '#ffffff',
    nav:           '#eeeef0',
    customizer:    '#f8f8fa',
    customizerNav: '#eeeef0',
    dropdown:      '#ffffff',
  },

  text: {
    t1: '#1a1a1e',
    t2: '#2d2e33',
    t3: '#4a4b52',
    t4: '#6b6c73',
    t5: '#9a9ba2',
  },

  borders: {
    standard: 'rgba(0,0,0,0.12)',
    subtle:   'rgba(0,0,0,0.07)',
  },

  surfaces: {
    low:         'rgba(0,0,0,0.03)',
    mid:         'rgba(0,0,0,0.05)',
    cover:       'rgba(0,0,0,0.06)',
    coverBorder: 'rgba(0,0,0,0.10)',
  },

  inputs: {
    background:  'rgba(0,0,0,0.04)',
    border:      'rgba(0,0,0,0.12)',
    focusBorder: null,
    placeholder: 'rgba(26,26,30,0.35)',
  },

  glass: {
    background:          'rgba(255,255,255,0.62)',
    backdropFilter:      'blur(20px) saturate(1.4)',
    border:              '1px solid rgba(0,0,0,0.09)',
    borderRadius:        20,
    bookCardBg:          null,
    bookCardBgHover:     null,
    bookCardBorder:      null,
    bookCardBorderHover: null,
    tileBg:              'rgba(255,255,255,0.55)',
    tileBgHover:         null,
    tileBorder:          'rgba(0,0,0,0.10)',
    tileBorderHover:     null,
    spinnerDisc:         'rgba(255,255,255,0.80)',
    spinnerTrack:        'rgba(0,0,0,0.10)',
    spinnerPending:      'rgba(0,0,0,0.20)',
    tabDivider:          'rgba(0,0,0,0.09)',
    tabActiveColor:      '#1a1a1e',
  },

  editor: {
    background:     '#f8f8fa',
    textColor:      '#1a1a1e',
    fontFamily:     "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    fontSize:       16,
    lineHeight:     1.75,
    letterSpacing:  '0.002em',
    caretColor:     null,
    selectionBg:    'rgba(90,0,217,0.18)',
    highlightColor: 'rgba(255,220,0,0.45)',
  },

  toolbar: {
    background:   null,
    darkStop:     'rgba(255,255,255,0.55)',
    accentAlpha:  '44',
    border:       '1px solid rgba(0,0,0,0.10)',
    fadeEdge:     'linear-gradient(to right, transparent, rgba(240,240,242,0.85))',
    itemColor:    '#1a1a1e',
    itemHoverBg:  'rgba(0,0,0,0.06)',
    dividerColor: 'rgba(0,0,0,0.15)',
  },

  modals: {
    overlayBg:         'rgba(0,0,0,0.50)',
    overlayBlur:       'blur(4px)',
    panelBg:           '#ffffff',
    panelBorder:       'rgba(0,0,0,0.10)',
    panelRadius:       16,
    panelShadow:       '0 32px 80px rgba(0,0,0,0.25)',
    closeButtonBg:     'rgba(0,0,0,0.06)',
    closeButtonColor:  '#6b6c73',
    closeButtonHoverBg:'rgba(0,0,0,0.12)',
  },

  sidebar: {
    background:          '#ffffff',
    headerBorder:        'rgba(0,0,0,0.10)',
    sessionCardBg:       'linear-gradient(135deg, #f0f0f2 0%, #e8e8ec 100%)',
    sessionCardBgLight:  'linear-gradient(135deg, #f0f0f2 0%, #e8e8ec 100%)',
    sessionCardBorder:   'rgba(0,0,0,0.07)',
    activeSessionBorder: null,
    resizeHandleHover:   null,
    bottomTabBg:         '#ffffff',
    bottomTabBorder:     'rgba(0,0,0,0.10)',
  },

  backgroundFx: {
    type: 'gradient',
    enabled:         false,
    baseColor:       '#f0f0f2',
    colorFrom:       '#5a00d9',
    colorTo:         '#a78bfa',
    minBlobs:        5,
    maxBlobs:        7,
    blobSizeRange:   { min: 80, max: 380 },
    speedMultiplier: 1.5,
    opacity:         0.25,
  },

  streakCalendar: {
    dayEmpty:        'rgba(0,0,0,0.04)',
    dayEmptyBorder:  'rgba(0,0,0,0.10)',
    dayMet:          '#22c55e',
    dayMetBorder:    '#16a34a',
    dayMissed:       'rgba(239,68,68,0.20)',
    dayMissedBorder: 'rgba(239,68,68,0.35)',
    dayToday:        null,
    dayText:         'rgba(26,26,30,0.55)',
  },

  effects: {
    scanlines:          false,
    scanlinesOpacity:   0.02,
    noise:              false,
    noiseOpacity:       0.02,
    vignette:           false,
    vignetteOpacity:    0.15,
    tintOverlay:        null,
    cssFilter:          null,
    pixelatedScrollbar: false,
  },
});
