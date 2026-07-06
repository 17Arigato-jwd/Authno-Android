/**
 * Icons.jsx — Icon system with guaranteed rendering.
 *
 * v1.1.16 fix: the app used @hackernoon/pixel-icon-library font glyphs by name,
 * but ~1/3 of the requested names (chevron-left/right, file, list, calendar,
 * key, palette, sliders-h, terminal, ellipsis, bullseye, eraser…) DON'T EXIST
 * in that font, so those icons rendered blank everywhere. Fixes:
 *   1. Names that exist in the font under a different spelling are remapped
 *      (e.g. calendar → calendar-alt, user-circle → user).
 *   2. Names the font lacks entirely render as inline SVG (SVGS below), so an
 *      icon is ALWAYS drawn regardless of the font's coverage.
 *
 * Font glyphs still use `currentColor` and the `size` prop like before; SVG
 * fallbacks honour the same size/color/style contract.
 */

// ── Inline SVG fallbacks for glyphs the pixel font doesn't provide ────────────
// Simple, stroke-based, 24x24 viewBox, inherit color via stroke="currentColor".
const P = (d) => ({ d });
const SVGS = {
  'chevron-left':  ['<polyline points="15 18 9 12 15 6"/>'],
  'chevron-right': ['<polyline points="9 18 15 12 9 6"/>'],
  'ellipsis-h':    ['<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'],
  'ellipsis-v':    ['<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>'],
  'file':          ['<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'],
  'file-alt':      ['<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>'],
  'file-plus':     ['<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/>'],
  'book-open':     ['<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'],
  'list':          ['<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'],
  'calendar':      ['<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'],
  'bullseye':      ['<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'],
  'eraser':        ['<path d="M20 20H7L3 16a2 2 0 0 1 0-3L13 3a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-9 9"/><line x1="18" y1="12.5" x2="9.5" y2="4"/>'],
  'key':           ['<circle cx="7.5" cy="15.5" r="4.5"/><line x1="10.7" y1="12.3" x2="21" y2="2"/><line x1="17" y1="6" x2="20" y2="9"/><line x1="15" y1="8" x2="18" y2="11"/>'],
  'palette':       ['<circle cx="13.5" cy="6.5" r="1.3"/><circle cx="17.5" cy="10.5" r="1.3"/><circle cx="8.5" cy="7.5" r="1.3"/><circle cx="6.5" cy="12.5" r="1.3"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.5A4.5 4.5 0 0 0 22 11 10 10 0 0 0 12 2z"/>'],
  'sliders-h':     ['<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.2"/><circle cx="15" cy="16" r="2.2"/>'],
  'terminal':      ['<polyline points="4 7 9 12 4 17"/><line x1="12" y1="17" x2="20" y2="17"/>'],
  'font':          ['<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>'],
  'infinity':      ['<path d="M18.2 8.4c-2 0-3.2 1.6-4.2 3.6-1 2-2.2 3.6-4.2 3.6a3.6 3.6 0 0 1 0-7.2c2 0 3.2 1.6 4.2 3.6 1 2 2.2 3.6 4.2 3.6a3.6 3.6 0 0 0 0-7.2z"/>'],
  'redo':          ['<polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>'],
  'rocket':        ['<path d="M5 13l-2 6 6-2m-4-4a10 10 0 0 1 8-8c3 0 4 1 4 1s1 1 1 4a10 10 0 0 1-8 8m-6-6l6 6"/><circle cx="14.5" cy="9.5" r="1.5"/>'],
  'shield-alt':    ['<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>'],
  'puzzle-piece':  ['<path d="M10 3v2.5a1.5 1.5 0 0 0 3 0V3h4v4h2.5a1.5 1.5 0 0 1 0 3H17v4h-2.5a1.5 1.5 0 0 0 0 3H17v-3m-7 3H6v-4H3.5a1.5 1.5 0 0 1 0-3H6V6"/>'],
  'magic':         ['<path d="M15 4V2m0 20v-2M4 15H2m20 0h-2M6 6L4.5 4.5M19.5 19.5L18 18m0-12l1.5-1.5M4.5 19.5L6 18"/><line x1="9" y1="9" x2="20" y2="20"/>'],
  'exclamation-circle': ['<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/>'],
  'eye-slash':     ['<path d="M17.9 17.9A10.5 10.5 0 0 1 12 20C5 20 1 12 1 12a19 19 0 0 1 5.1-6M9.9 4.2A10.5 10.5 0 0 1 12 4c7 0 11 8 11 8a19 19 0 0 1-2.2 3.2M14.1 14.1a3 3 0 0 1-4.2-4.2"/><line x1="1" y1="1" x2="23" y2="23"/>'],
  'user-circle':   ['<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18a5.5 5.5 0 0 1 11 0"/>'],
  'box':           ['<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/>'],
};

function SvgIcon({ paths, size = 16, color = 'currentColor', style = {} }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: paths.join('') }}
    />
  );
}

function HNIcon({ name, size = 16, color = 'currentColor', style = {} }) {
  return (
    <i
      className={`hn hn-${name}`}
      style={{ fontSize: size, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, ...style }}
    />
  );
}

// Names that exist in the pixel font under a DIFFERENT spelling.
const FONT_ALIAS = {
  'calendar':    'calendar-alt',
};

// Build an icon component. If we have an SVG fallback for this name, use it;
// otherwise use the font glyph (applying any alias).
const icon = (name) => {
  if (SVGS[name]) {
    const paths = SVGS[name];
    return ({ size, color, style }) => <SvgIcon paths={paths} size={size} color={color} style={style} />;
  }
  const fontName = FONT_ALIAS[name] || name;
  return ({ size, color, style }) => <HNIcon name={fontName} size={size} color={color} style={style} />;
};

export const DSIcons = {
  // Navigation
  Home:          icon('home'),
  ChevronRight:  icon('chevron-right'),
  ChevronLeft:   icon('chevron-left'),
  ChevronUp:     icon('chevron-up'),
  ChevronDown:   icon('chevron-down'),
  Menu:          icon('bars'),
  More:          icon('ellipsis-h'),
  MoreVertical:  icon('ellipsis-v'),
  // Content & files
  Book:          icon('book'),
  BookOpen:      icon('book-open'),
  File:          icon('file'),
  FilePlus:      icon('file-plus'),
  FileText:      icon('file-alt'),
  Folder:        icon('folder'),
  FolderOpen:    icon('folder-open'),
  Archive:       icon('archive'),
  Save:          icon('save'),
  Target:        icon('bullseye'),
  // Actions
  Check:         icon('check'),
  X:             icon('times'),
  Plus:          icon('plus'),
  Minus:         icon('minus'),
  Search:        icon('search'),
  Edit:          icon('pen'),
  Eraser:        icon('eraser'),
  Trash:         icon('trash'),
  Copy:          icon('copy'),
  Link:          icon('link'),
  Upload:        icon('upload'),
  Download:      icon('download'),
  Refresh:       icon('redo'),
  // Status
  Info:          icon('info-circle'),
  Warning:       icon('exclamation-triangle'),
  CheckCircle:   icon('check-circle'),
  XCircle:       icon('times-circle'),
  WarningCircle: icon('exclamation-circle'),
  Bell:          icon('bell'),
  BellRinging:   icon('bell-solid'),
  // Security
  Lock:          icon('lock'),
  Unlock:        icon('lock-open'),
  Shield:        icon('shield-alt'),
  Key:           icon('key'),
  // Visual / settings
  Eye:           icon('eye'),
  EyeOff:        icon('eye-slash'),
  Camera:        icon('camera'),
  Palette:       icon('palette'),
  Text:          icon('font'),
  Sliders:       icon('sliders-h'),
  // Social / app
  Discord:       icon('discord'),
  Chat:          icon('comments'),
  Star:          icon('star'),
  StarFill:      icon('star-solid'),
  Rocket:        icon('rocket'),
  Sparkle:       icon('magic'),
  Lightning:     icon('bolt'),
  // System
  Settings:      icon('cog'),
  Extension:     icon('puzzle-piece'),
  Code:          icon('code'),
  Terminal:      icon('terminal'),
  Bug:           icon('bug'),
  Tag:           icon('tag'),
  Bookmark:      icon('bookmark'),
  Clock:         icon('clock'),
  Calendar:      icon('calendar'),
  User:          icon('user'),
  UserCircle:    icon('user-circle'),
  Infinity:      icon('infinity'),
  List:          icon('list'),
  Package:       icon('box'),
  PackagePlus:   icon('box'),
  Npm:           icon('npm'),
  Github:        icon('github'),
  Figma:         icon('figma'),
  Heart:         icon('heart'),
};
