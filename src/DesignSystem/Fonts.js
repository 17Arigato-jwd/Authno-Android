/**
 * Fonts.js — Google Fonts loader + App Metadata + Attribution
 *
 * Call injectDesignSystemFonts() once in your App entry point.
 * APP_META is sourced from the build (src/version.js) — never hand-edited.
 * Add / remove entries from ATTRIBUTION as dependencies change.
 */

import {
  APP_VERSION, APP_NAME, APP_AUTHOR, APP_SUPPORT_EMAIL, APP_WEBSITE, APP_BUILD_DATE,
} from '../version';
import { webFontsEnabled } from '../utils/fontManager';

// ── Font loader ───────────────────────────────────────────────────────────────

/**
 * The third of three paths that reached fonts.googleapis.com, and the one
 * that actually fired for everybody: App.js calls it at module scope, so it
 * ran before React mounted, before any setting was read, on every launch.
 *
 * Gated on the same flag as the other two. Off by default — see
 * setWebFontsEnabled in utils/fontManager.js for why. TYPOGRAPHY.pixel and
 * TYPOGRAPHY.mono both end their stacks in system families, so the interface
 * renders in the device's own fonts instead of not rendering.
 *
 * Called again once the setting is read, hence the id check below: it is
 * idempotent, so switching the setting on loads the fonts without a reload.
 */
export function injectDesignSystemFonts() {
  if (!webFontsEnabled()) return;
  if (document.getElementById('ds-fonts')) return;
  const link = document.createElement('link');
  link.id = 'ds-fonts';
  link.rel = 'stylesheet';
  // Silkscreen: clean retro pixel font · JetBrains Mono: UI mono
  link.href =
    'https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=JetBrains+Mono:wght@400;600;700&display=swap';
  document.head.appendChild(link);
  // Silkscreen backs TYPOGRAPHY.pixel (headings / labels); JetBrains Mono backs
  // TYPOGRAPHY.mono. All UI glyphs are lucide-react vectors via DSIcons — there
  // is no icon web-font to load.
}

// ── App Metadata — sourced from the build, never hand-edited ──────────────────
// Version / name / author / repo / build date come from src/version.js (see the
// import at the top of this file), which scripts/sync-version.js regenerates
// from package.json on every start/build. The running platform is detected at
// runtime, so About shows "Windows", "Linux" or "Android", never a stale value.

function detectPlatform() {
  if (typeof window === 'undefined') return 'Desktop';
  try {
    if (window.electron) {
      const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '');
      if (/win/i.test(p))   return 'Windows';
      if (/linux/i.test(p) && !/android/i.test(p)) return 'Linux';
      if (/mac/i.test(p))   return 'macOS';
      return 'Desktop';
    }
    if (window.Capacitor?.getPlatform?.() === 'android' || /Android/i.test(navigator.userAgent)) return 'Android';
  } catch { /* ignore */ }
  return 'Web';
}

export const APP_META = {
  name:         APP_NAME,
  version:      APP_VERSION,
  buildDate:    APP_BUILD_DATE,
  platform:     detectPlatform(),
  author:       APP_AUTHOR,
  website:      APP_WEBSITE,
  supportEmail: APP_SUPPORT_EMAIL,
};

// ── Attribution — one entry per library / asset requiring credit ──────────────
// Reflects the ACTUAL stack (Electron desktop + Capacitor Android + React).
export const ATTRIBUTION = [
  {
    name:    'React',
    author:  'Meta Platforms, Inc.',
    licence: 'MIT',
    url:     'https://react.dev',
    note:    'UI framework',
  },
  {
    name:    'Electron',
    author:  'OpenJS Foundation',
    licence: 'MIT',
    url:     'https://www.electronjs.org',
    note:    'Windows / Linux desktop shell',
  },
  {
    name:    'Capacitor',
    author:  'Ionic',
    licence: 'MIT',
    url:     'https://capacitorjs.com',
    note:    'Android native runtime',
  },
  {
    name:    'Lucide',
    author:  'Lucide Contributors',
    licence: 'ISC',
    url:     'https://lucide.dev',
    note:    'The vector icon set used throughout the app',
  },
  {
    name:    'JSZip',
    author:  'Stuart Knightley',
    licence: 'MIT',
    url:     'https://www.npmjs.com/package/jszip',
    note:    'Reads DOCX / ODT / EPUB archives when importing books',
  },
  {
    name:    'PDF.js',
    author:  'Mozilla',
    licence: 'Apache-2.0',
    url:     'https://www.npmjs.com/package/pdfjs-dist',
    note:    'Extracts text from PDFs when importing books',
  },
  {
    name:    'Inter',
    author:  'Rasmus Andersson',
    licence: 'OFL-1.1',
    url:     'https://rsms.me/inter/',
    note:    'Default interface & editor typeface',
  },
  {
    name:    'JetBrains Mono',
    author:  'JetBrains',
    licence: 'OFL-1.1',
    url:     'https://fonts.google.com/specimen/JetBrains+Mono',
    note:    'Monospace font used for code and technical UI',
  },
];
