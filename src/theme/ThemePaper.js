/**
 * ThemePaper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Crisp white with cool-grey tones and a blue accent.
 * Georgia serif editor — like a fresh sheet of quality paper.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createTheme } from './ThemeBase';
import { DARK_DEFAULT } from './ThemeDarkDefault';

export const PAPER = createTheme(DARK_DEFAULT, {

  meta: {
    name:        'Paper',
    id:          'paper',
    isDark:      false,
    description: 'Crisp white with a cool-grey tone — like a fresh sheet of paper.',
  },

  accent: {
    primary:   '#2563eb',
    secondary: '#3b82f6',
  },

  backgrounds: {
    app:           '#f9f9fb',
    sidebar:       '#f1f1f5',
    editor:        '#ffffff',
    modal:         '#ffffff',
    nav:           '#ebebef',
    customizer:    '#f9f9fb',
    customizerNav: '#ebebef',
    dropdown:      '#ffffff',
  },

  text: {
    t1: '#111113',
    t2: '#222228',
    t3: '#44444e',
    t4: '#6e6e7a',
    t5: '#9d9daa',
  },

  borders: {
    standard: 'rgba(0,0,0,0.11)',
    subtle:   'rgba(0,0,0,0.06)',
  },

  surfaces: {
    low:         'rgba(0,0,0,0.025)',
    mid:         'rgba(0,0,0,0.05)',
    cover:       'rgba(0,0,0,0.04)',
    coverBorder: 'rgba(0,0,0,0.09)',
  },

  inputs: {
    background:  '#ffffff',
    border:      'rgba(0,0,0,0.14)',
    focusBorder: null,
    placeholder: 'rgba(17,17,19,0.30)',
  },

  glass: {
    background:          'rgba(255,255,255,0.75)',
    backdropFilter:      'blur(16px) saturate(1.3)',
    border:              '1px solid rgba(0,0,0,0.08)',
    borderRadius:        20,
    bookCardBg:          null,
    bookCardBgHover:     null,
    bookCardBorder:      null,
    bookCardBorderHover: null,
    tileBg:              'rgba(241,241,245,0.80)',
    tileBgHover:         null,
    tileBorder:          'rgba(0,0,0,0.09)',
    tileBorderHover:     null,
    spinnerDisc:         'rgba(255,255,255,0.95)',
    spinnerTrack:        'rgba(0,0,0,0.08)',
    spinnerPending:      'rgba(0,0,0,0.18)',
    tabDivider:          'rgba(0,0,0,0.08)',
    tabActiveColor:      '#111113',
  },

  editor: {
    background:     '#ffffff',
    textColor:      '#111113',
    fontFamily:     "Georgia, 'Times New Roman', serif",
    fontSize:       17,
    lineHeight:     1.80,
    letterSpacing:  '0.002em',
    caretColor:     null,
    selectionBg:    'rgba(37,99,235,0.18)',
    highlightColor: 'rgba(250,204,21,0.45)',
  },

  toolbar: {
    background:   null,
    darkStop:     'rgba(255,255,255,0.65)',
    accentAlpha:  '44',
    border:       '1px solid rgba(0,0,0,0.09)',
    fadeEdge:     'linear-gradient(to right, transparent, rgba(249,249,251,0.90))',
    itemColor:    '#222228',
    itemHoverBg:  'rgba(0,0,0,0.05)',
    dividerColor: 'rgba(0,0,0,0.12)',
  },

  modals: {
    overlayBg:         'rgba(0,0,0,0.45)',
    overlayBlur:       'blur(4px)',
    panelBg:           '#ffffff',
    panelBorder:       'rgba(0,0,0,0.09)',
    panelRadius:       16,
    panelShadow:       '0 24px 60px rgba(0,0,0,0.18)',
    closeButtonBg:     'rgba(0,0,0,0.05)',
    closeButtonColor:  '#6e6e7a',
    closeButtonHoverBg:'rgba(0,0,0,0.10)',
  },

  sidebar: {
    background:          '#f1f1f5',
    headerBorder:        'rgba(0,0,0,0.09)',
    sessionCardBg:       'linear-gradient(135deg, #ebebef 0%, #e2e2e8 100%)',
    sessionCardBgLight:  'linear-gradient(135deg, #ebebef 0%, #e2e2e8 100%)',
    sessionCardBorder:   'rgba(0,0,0,0.06)',
    activeSessionBorder: null,
    resizeHandleHover:   null,
    bottomTabBg:         '#f1f1f5',
    bottomTabBorder:     'rgba(0,0,0,0.09)',
  },

  backgroundFx: {
    type: 'grain',
    grainOpacity:    0.12,
    grainSize:       0.55,
    enabled:         false,
    baseColor:       '#f9f9fb',
    colorFrom:       '#2563eb',
    colorTo:         '#7c3aed',
    minBlobs:        4,
    maxBlobs:        6,
    blobSizeRange:   { min: 80, max: 350 },
    speedMultiplier: 2.0,
    opacity:         0.18,
  },

  streakCalendar: {
    dayEmpty:        'rgba(0,0,0,0.04)',
    dayEmptyBorder:  'rgba(0,0,0,0.09)',
    dayMet:          '#16a34a',
    dayMetBorder:    '#15803d',
    dayMissed:       'rgba(220,38,38,0.18)',
    dayMissedBorder: 'rgba(220,38,38,0.32)',
    dayToday:        null,
    dayText:         'rgba(17,17,19,0.50)',
  },

  effects: {
    scanlines:          false,
    scanlinesOpacity:   0.02,
    noise:              false,
    noiseOpacity:       0.02,
    vignette:           false,
    vignetteOpacity:    0.10,
    tintOverlay:        null,
    cssFilter:          null,
    pixelatedScrollbar: false,
  },
});
