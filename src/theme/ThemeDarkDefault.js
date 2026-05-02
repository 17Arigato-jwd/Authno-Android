/**
 * ThemeDarkDefault.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The original Authno dark theme. Deep black surfaces, violet accent,
 * animated blob background support, pixel scrollbars.
 *
 * This is the base all other themes extend via createTheme(DARK_DEFAULT, {}).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const DARK_DEFAULT = {

  meta: {
    name:        'Dark',
    id:          'dark-default',
    isDark:      true,
    description: 'The original dark mode with deep violet accents.',
  },

  accent: {
    primary:   '#5a00d9',
    secondary: '#6300d4',
  },

  backgrounds: {
    app:           '#060606',
    sidebar:       '#0b0b0c',
    editor:        '#0f0f10',
    modal:         '#1a1b1e',
    nav:           '#111214',
    customizer:    '#2b2d31',
    customizerNav: '#1e1f22',
    dropdown:      '#0f0f10',
  },

  text: {
    t1: '#ffffff',
    t2: '#dcddde',
    t3: '#b9bbbe',
    t4: '#72767d',
    t5: '#4f545c',
  },

  borders: {
    standard: 'rgba(255,255,255,0.10)',
    subtle:   'rgba(255,255,255,0.06)',
  },

  surfaces: {
    low:         'rgba(255,255,255,0.03)',
    mid:         'rgba(255,255,255,0.05)',
    cover:       'rgba(255,255,255,0.06)',
    coverBorder: 'rgba(255,255,255,0.10)',
  },

  inputs: {
    background:  'rgba(0,0,0,0.40)',
    border:      'rgba(255,255,255,0.10)',
    focusBorder: null,
    placeholder: 'rgba(255,255,255,0.25)',
  },

  glass: {
    background:          'rgba(0,0,0,0.45)',
    backdropFilter:      'blur(20px) saturate(1.2)',
    border:              '1px solid rgba(255,255,255,0.08)',
    borderRadius:        20,
    bookCardBg:          null,
    bookCardBgHover:     null,
    bookCardBorder:      null,
    bookCardBorderHover: null,
    tileBg:              'rgba(0,0,0,0.55)',
    tileBgHover:         null,
    tileBorder:          'rgba(255,255,255,0.10)',
    tileBorderHover:     null,
    spinnerDisc:         'rgba(0,0,0,0.60)',
    spinnerTrack:        'rgba(255,255,255,0.08)',
    spinnerPending:      'rgba(255,255,255,0.30)',
    tabDivider:          'rgba(255,255,255,0.07)',
    tabActiveColor:      '#ffffff',
  },

  editor: {
    background:     '#0f0f10',
    textColor:      '#ffffff',
    fontFamily:     "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    fontSize:       16,
    lineHeight:     1.75,
    letterSpacing:  '0.002em',
    caretColor:     null,
    selectionBg:    'rgba(90,0,217,0.35)',
    highlightColor: 'rgba(255,255,0,0.3)',
  },

  toolbar: {
    background:   null,
    darkStop:     'rgba(0,0,0,0.45)',
    accentAlpha:  '66',
    border:       '1px solid rgba(255,255,255,0.12)',
    fadeEdge:     'linear-gradient(to right, transparent, rgba(0,0,0,0.40))',
    itemColor:    'rgba(255,255,255,0.85)',
    itemHoverBg:  'rgba(255,255,255,0.10)',
    dividerColor: 'rgba(255,255,255,0.20)',
  },

  modals: {
    overlayBg:         'rgba(0,0,0,0.75)',
    overlayBlur:       'blur(6px)',
    panelBg:           '#1a1b1e',
    panelBorder:       'rgba(255,255,255,0.07)',
    panelRadius:       16,
    panelShadow:       '0 32px 80px rgba(0,0,0,0.70)',
    closeButtonBg:     'rgba(255,255,255,0.06)',
    closeButtonColor:  '#72767d',
    closeButtonHoverBg:'rgba(255,255,255,0.14)',
  },

  sidebar: {
    background:          '#0b0b0c',
    headerBorder:        'rgba(255,255,255,0.10)',
    sessionCardBg:       'linear-gradient(135deg, #1f1f1f 0%, #050505 100%)',
    sessionCardBgLight:  'linear-gradient(135deg, #1f1f1f 0%, #050505 100%)',
    sessionCardBorder:   'rgba(255,255,255,0.04)',
    activeSessionBorder: null,
    resizeHandleHover:   null,
    bottomTabBg:         '#0b0b0c',
    bottomTabBorder:     'rgba(255,255,255,0.08)',
  },

  statusColors: {
    danger:    '#ed4245',
    warning:   '#faa61a',
    success:   '#22c55e',
    info:      '#38bdf8',
    dangerBg:  'rgba(237,66,69,0.15)',
    warningBg: 'rgba(250,166,26,0.15)',
    successBg: 'rgba(34,197,94,0.15)',
    infoBg:    'rgba(56,189,248,0.15)',
  },

  typography: {
    pixelFont:        "'Silkscreen', 'Courier New', monospace",
    monoFont:         "'JetBrains Mono', 'Fira Code', monospace",
    bodyFont:         "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
    editorFont:       "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    editorFontSize:   16,
    editorLineHeight: 1.75,
    googleFontsUrl:   'https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=JetBrains+Mono:wght@400;600;700&display=swap',
  },

  backgroundFx: {
    enabled:         false,
    baseColor:       '#060606',
    colorFrom:       '#5a00d9',
    colorTo:         '#6300d4',
    minBlobs:        7,
    maxBlobs:        9,
    blobSizeRange:   { min: 20, max: 450 },
    speedMultiplier: 1.0,
    opacity:         1.0,
  },

  streakCalendar: {
    dayEmpty:        'rgba(255,255,255,0.04)',
    dayEmptyBorder:  'rgba(255,255,255,0.08)',
    dayMet:          '#22c55e',
    dayMetBorder:    '#16a34a',
    dayMissed:       'rgba(239,68,68,0.25)',
    dayMissedBorder: 'rgba(239,68,68,0.40)',
    dayToday:        null,
    dayText:         'rgba(255,255,255,0.60)',
  },

  effects: {
    scanlines:          false,
    scanlinesOpacity:   0.04,
    noise:              false,
    noiseOpacity:       0.03,
    vignette:           false,
    vignetteOpacity:    0.35,
    tintOverlay:        null,
    cssFilter:          null,
    pixelatedScrollbar: true,
  },
};
