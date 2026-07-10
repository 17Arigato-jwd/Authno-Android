/**
 * fontManager.js — Authno font library + loader
 * ─────────────────────────────────────────────────────────────────────────────
 * A single source of truth for the fonts the app can use. Powers:
 *   • the default global UI font (--font-body)
 *   • the Font Customizer (per-target font selection: body / editor / headings)
 *   • user-uploaded custom fonts (@font-face from a data URL, fully offline)
 *
 * Named web fonts are loaded on demand from Google Fonts (matching how the app
 * already loads Silkscreen / JetBrains Mono) and gracefully fall back to a
 * bundled system stack when offline — so nothing ever renders in the browser's
 * Times New Roman default.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SYSTEM_SANS =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SYSTEM_SERIF = "Georgia, 'Times New Roman', Times, serif";
const SYSTEM_MONO  = "ui-monospace, 'Cascadia Code', 'Courier New', monospace";

/**
 * Curated font library. Each entry:
 *   id       stable key stored in settings
 *   label    shown in the picker
 *   stack    the CSS font-family value applied
 *   google   optional Google Fonts family spec to lazy-load
 *   category 'sans' | 'serif' | 'mono' | 'display'
 */
export const FONT_LIBRARY = [
  // ── Sans ──
  { id: 'system',       label: 'System UI',        stack: SYSTEM_SANS,                                   category: 'sans' },
  { id: 'inter',        label: 'Inter',            stack: `'Inter', ${SYSTEM_SANS}`,       google: 'Inter:wght@400;500;600;700',        category: 'sans' },
  { id: 'roboto',       label: 'Roboto',           stack: `'Roboto', ${SYSTEM_SANS}`,      google: 'Roboto:wght@400;500;700',           category: 'sans' },
  { id: 'nunito',       label: 'Nunito Sans',      stack: `'Nunito Sans', ${SYSTEM_SANS}`, google: 'Nunito+Sans:wght@400;600;700',      category: 'sans' },
  { id: 'work',         label: 'Work Sans',        stack: `'Work Sans', ${SYSTEM_SANS}`,   google: 'Work+Sans:wght@400;500;600;700',    category: 'sans' },
  // ── Serif (nice for the editor) ──
  { id: 'georgia',      label: 'Georgia',          stack: SYSTEM_SERIF,                                  category: 'serif' },
  { id: 'lora',         label: 'Lora',             stack: `'Lora', ${SYSTEM_SERIF}`,       google: 'Lora:wght@400;500;600;700',         category: 'serif' },
  { id: 'merriweather', label: 'Merriweather',     stack: `'Merriweather', ${SYSTEM_SERIF}`, google: 'Merriweather:wght@400;700',       category: 'serif' },
  { id: 'source-serif', label: 'Source Serif',     stack: `'Source Serif 4', ${SYSTEM_SERIF}`, google: 'Source+Serif+4:wght@400;500;600', category: 'serif' },
  // ── Mono ──
  { id: 'jetbrains',    label: 'JetBrains Mono',   stack: `'JetBrains Mono', ${SYSTEM_MONO}`, google: 'JetBrains+Mono:wght@400;600;700', category: 'mono' },
  { id: 'courier',      label: 'Courier',          stack: SYSTEM_MONO,                                   category: 'mono' },
  // ── Display / fun ──
  { id: 'silkscreen',   label: 'Silkscreen (pixel)', stack: `'Silkscreen', ${SYSTEM_MONO}`, google: 'Silkscreen:wght@400;700',          category: 'display' },
];

// The app's default global font. Chosen for the best-looking cross-platform
// baseline with a graceful native fallback when Inter is not yet loaded.
export const DEFAULT_FONTS = {
  body:    'inter',
  editor:  'inter',
  heading: 'inter',
  custom:  [],   // [{ id, name, dataUrl }]
};

export function findFont(fontId) {
  return FONT_LIBRARY.find(f => f.id === fontId) || null;
}

// ── Weight variants ───────────────────────────────────────────────────────────

export const WEIGHT_NAMES = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};

/**
 * Variants (weights) a library font ships. Parsed from the Google Fonts spec
 * (e.g. 'Inter:wght@400;500;600;700' → [400,500,600,700]); system stacks get
 * the universal Regular/Bold pair. Used by the editor's font picker to group
 * variants under one family (author-requested sub-menu behaviour).
 */
export function fontVariants(font) {
  const m = font?.google?.match(/:wght@([\d;]+)/);
  const weights = m ? m[1].split(';').map(Number) : [400, 700];
  return weights.map(w => ({ weight: w, label: WEIGHT_NAMES[w] || String(w) }));
}

/** Resolve a font id → CSS font-family stack, honouring uploaded custom fonts. */
export function resolveFontStack(fontId, customFonts = []) {
  if (!fontId) return `'Inter', ${SYSTEM_SANS}`;
  const custom = (customFonts || []).find(f => f.id === fontId || f.name === fontId);
  if (custom) return `'${custom.name.replace(/'/g, '')}', ${SYSTEM_SANS}`;
  const lib = findFont(fontId);
  return lib ? lib.stack : `'Inter', ${SYSTEM_SANS}`;
}

// ── Google Fonts lazy loader (deduped) ────────────────────────────────────────
const _loadedGoogle = new Set();

export function loadGoogleFont(fontId) {
  if (typeof document === 'undefined') return;
  const lib = findFont(fontId);
  if (!lib || !lib.google || _loadedGoogle.has(lib.google)) return;
  _loadedGoogle.add(lib.google);
  const id = `authno-gf-${fontId}`;
  if (document.getElementById(id)) return;
  const link = Object.assign(document.createElement('link'), {
    id, rel: 'stylesheet',
    href: `https://fonts.googleapis.com/css2?family=${lib.google}&display=swap`,
  });
  document.head.appendChild(link);
}

/**
 * Ensure every named web font referenced by a fonts config is loaded. Custom
 * uploaded fonts are handled separately via @font-face injection.
 */
export function ensureFontsLoaded(fonts = {}) {
  ['body', 'editor', 'heading'].forEach(target => {
    const id = fonts[target];
    if (id) loadGoogleFont(id);
  });
}

// ── Custom (uploaded) @font-face injection ────────────────────────────────────
const CUSTOM_STYLE_ID = 'authno-custom-fontfaces';

export function injectCustomFontFaces(customFonts = []) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(CUSTOM_STYLE_ID);
  if (!customFonts.length) { el?.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = CUSTOM_STYLE_ID; document.head.appendChild(el); }
  el.textContent = customFonts
    .filter(f => f && f.name && f.dataUrl)
    .map(f => `@font-face{font-family:'${f.name.replace(/'/g, '')}';src:url(${JSON.stringify(f.dataUrl)});font-display:swap;}`)
    .join('\n');
}

/** Read an uploaded font File → { id, name, dataUrl } for the custom list. */
export function readCustomFontFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file'));
    const name = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/i, '').replace(/[^\w\s-]/g, '').trim() || 'Custom Font';
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Failed to read font'));
    reader.onloadend = () => resolve({
      id: `custom:${name}:${Date.now()}`,
      name,
      dataUrl: reader.result,
    });
    reader.readAsDataURL(file);
  });
}
