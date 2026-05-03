/**
 * Fonts.js — Google Fonts loader + App Metadata + Attribution
 *
 * Call injectDesignSystemFonts() once in your App entry point.
 * Update APP_META on every release.
 * Add / remove entries from ATTRIBUTION as dependencies change.
 */

// ── Font loader ───────────────────────────────────────────────────────────────

export function injectDesignSystemFonts() {
  if (document.getElementById('ds-fonts')) return;
  const link = document.createElement('link');
  link.id = 'ds-fonts';
  link.rel = 'stylesheet';
  // Silkscreen: clean retro pixel font · JetBrains Mono: UI mono
  link.href =
    'https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=JetBrains+Mono:wght@400;600;700&display=swap';
  document.head.appendChild(link);
}

// ── App Metadata — bump on every release ─────────────────────────────────────

export const APP_META = {
  name:         'Authno',
  version:      '1.0.0',
  buildDate:    '2026-04-29',
  platform:     'Android',
  author:       'Your Name / Studio',
  repository:   'https://github.com/your-org/authno-android',
  supportEmail: 'support@authno.app',
};

// ── Attribution — one entry per library / asset requiring credit ──────────────

export const ATTRIBUTION = [
  {
    name:    'Pixel Icon Library',
    author:  'HackerNoon',
    licence: 'CC BY 4.0',
    url:     'https://pixeliconlibrary.com',
    note:    'Retro pixel icons — attribution required. Use <i class="hn hn-{name}"> or npm: @hackernoon/pixel-icon-library',
  },
  {
    name:    'Silkscreen',
    author:  'Jason Kottke',
    licence: 'OFL-1.1',
    url:     'https://fonts.google.com/specimen/Silkscreen',
    note:    'Clean retro pixel font used for headings and labels',
  },
  {
    name:    'JetBrains Mono',
    author:  'JetBrains',
    licence: 'OFL-1.1',
    url:     'https://fonts.google.com/specimen/JetBrains+Mono',
    note:    'Monospace font used for UI text and code',
  },
  {
    name:    'React',
    author:  'Meta Platforms, Inc.',
    licence: 'MIT',
    url:     'https://react.dev',
  },
  {
    name:    'React Native / Expo',
    author:  'Expo, Inc.',
    licence: 'MIT',
    url:     'https://expo.dev',
  },
  // Add more entries here as dependencies grow:
  // { name: 'react-native-reanimated', author: 'Software Mansion', licence: 'MIT', url: '...' },
];
