/**
 * contributionIcon.jsx — one place that turns a manifest's `icon` into an icon.
 *
 * There were four of these. ExtensionTab had `EMOJI_MAP` + `LUCIDE_ICON_MAP` +
 * `LABEL_MAP`; HomeScreen had `TILE_ICON_MAP`; Settings had an inline `DS_MAP`;
 * and BookDashboard had none at all — it rendered `action.icon` as text.
 *
 * That last one is what a person actually saw. A v2 manifest names icons the
 * way the spec's example does — `"icon": "Cloud"` — so the book screen drew
 *
 *     Cloud  Cloud files
 *
 * with the icon's own name sitting in front of the label as a word. It looked
 * like a typo in the extension. It was the app printing a lookup key.
 *
 * The maps also disagreed. `Upload` resolved on the home screen and in the
 * drawer and nowhere else, so the same contribution had an icon in one place
 * and a fallback puzzle piece in another, which reads as two different things.
 *
 * So: one map, one resolver, one fallback. An unknown name yields the generic
 * extension mark rather than the string, because a name this does not know is
 * an icon this app does not have — never something to print.
 */

import { DSIcons } from '../DesignSystem';

/**
 * Lucide names a manifest may use → the DesignSystem icon that stands for it.
 *
 * Deliberately a mapping rather than a passthrough: the app ships its own set,
 * and an extension naming something outside it should land on the nearest
 * thing rather than on nothing. Names are Lucide's because that is what the
 * spec's examples use and what every author will copy.
 */
const NAMED = {
  Cloud: 'Cloud', CloudUpload: 'Upload', CloudDownload: 'Download',
  Server: 'Package', HardDrive: 'Package', Database: 'Package', Box: 'Package',
  Package: 'Package', Archive: 'Archive',
  Upload: 'Upload', Download: 'Download', Share: 'Upload', Share2: 'Upload',
  BookOpen: 'BookOpen', Book: 'Book', Library: 'BookOpen', FileText: 'FileText',
  File: 'File', Files: 'File', Folder: 'Folder', FolderOpen: 'FolderOpen',
  Settings: 'Settings', Settings2: 'Settings', Sliders: 'Sliders', Cog: 'Settings',
  Puzzle: 'Extension', Plug: 'Extension', Blocks: 'Extension',
  BarChart: 'Star', BarChart2: 'Star', PieChart: 'Star', TrendingUp: 'Star',
  Star: 'Star', Sparkles: 'Sparkle', Award: 'Star',
  Zap: 'Lightning', Bolt: 'Lightning', Activity: 'Lightning',
  Globe: 'Globe', Link: 'Link', Link2: 'Link', ExternalLink: 'Link',
  Eye: 'Eye', EyeOff: 'EyeOff', Search: 'Search',
  Home: 'Home', House: 'Home',
  Edit: 'Edit', Edit3: 'Edit', Pencil: 'Edit', PenTool: 'Edit', Type: 'Text',
  Clock: 'Clock', Timer: 'Clock', Calendar: 'Calendar', History: 'History',
  Bell: 'Bell', BellRing: 'BellRinging',
  Lock: 'Lock', Unlock: 'Unlock', Shield: 'Shield', Key: 'Key',
  User: 'User', Users: 'User', UserCircle: 'UserCircle',
  RefreshCw: 'Refresh', RotateCw: 'Refresh', RefreshCcw: 'Refresh',
  Trash: 'Trash', Trash2: 'Trash', Copy: 'Copy',
  Terminal: 'Terminal', Code: 'Code', Bug: 'Bug', Flask: 'Flask',
  Target: 'Target', Flame: 'Flame', Heart: 'Heart', Gift: 'Gift',
  Tag: 'Tag', Bookmark: 'Bookmark', Pin: 'Pin', List: 'List',
  Image: 'Image', Camera: 'Camera', Palette: 'Palette', Volume2: 'Volume',
  Info: 'Info', AlertTriangle: 'Warning', CheckCircle: 'CheckCircle',
  MessageSquare: 'Chat', Rocket: 'Rocket',
};

/**
 * Emoji an older manifest may carry, and the icon each stands for.
 *
 * v1 manifests use emoji directly and are still installed. Variation selectors
 * and zero-width joiners are stripped before lookup so '⚙️' and '⚙' are the
 * same key rather than two.
 */
const EMOJI = {
  '📚': 'BookOpen', '📖': 'BookOpen', '📝': 'Edit', '✏': 'Edit', '🖊': 'Edit',
  '📊': 'Star', '📈': 'Star', '⭐': 'Star', '🌟': 'Star',
  '🚀': 'Rocket', '⚙': 'Settings', '🔧': 'Settings', '🛠': 'Settings',
  '🏠': 'Home', '📤': 'Upload', '📥': 'Download', '💾': 'Package',
  '☁': 'Cloud', '🌐': 'Globe', '🔗': 'Link', '👁': 'Eye', '💬': 'Chat',
  '⚡': 'Lightning', '🧩': 'Extension', '🔒': 'Lock', '🔑': 'Key',
  '⏱': 'Clock', '⏲': 'Clock', '🔔': 'Bell', '🔥': 'Flame', '🎯': 'Target',
};

/** What a label suggests, when the manifest named no icon at all. */
const BY_LABEL = [
  [/back ?up|sync/i, 'Refresh'],
  [/upload|publish|send/i, 'Upload'],
  [/download|import|restore/i, 'Download'],
  [/setting|config|preference/i, 'Settings'],
  [/file|folder|browse/i, 'Folder'],
  [/stat|analytic|count|word/i, 'Star'],
  [/conflict|warn|problem/i, 'Warning'],
  [/chapter|book|manuscript/i, 'BookOpen'],
  [/open|view|show/i, 'Eye'],
];

/** What a contribution slot suggests, when nothing else does. */
const BY_SLOT = {
  settings: 'Settings',
  homescreen: 'Home',
  bookActions: 'BookOpen',
  chapterActions: 'FileText',
  editorToolbar: 'Edit',
};

const clean = (s) => String(s ?? '').trim().replace(/[︀-️‍]/g, '');

/**
 * The DesignSystem icon name for a contribution, or null.
 *
 * Exported separately from the element so a caller that wants to style the
 * icon itself — a tile, a sidebar square — can reach the component directly.
 */
export function contributionIconName(item = {}, slot = null) {
  const named = clean(item.icon ?? item._extIcon);
  if (named) {
    if (NAMED[named]) return NAMED[named];
    if (EMOJI[named]) return EMOJI[named];
    // A name the app happens to share with its own set, e.g. "Warning".
    if (DSIcons[named]) return named;
  }
  const label = String(item.label ?? '');
  for (const [re, name] of BY_LABEL) if (re.test(label)) return name;
  if (slot && BY_SLOT[slot]) return BY_SLOT[slot];
  return null;
}

/**
 * A contribution's icon as an element. Never text.
 *
 * @param {object} item   the contribution, or anything with `icon`/`label`
 * @param {object} [o]    { size, color, slot, fallback }
 */
export function ContributionIcon({ item = {}, size = 16, color, slot = null, fallback = true }) {
  const name = contributionIconName(item, slot);
  const Icon = (name && DSIcons[name]) || (fallback ? DSIcons.Extension : null);
  if (!Icon) return null;
  return <Icon size={size} color={color} />;
}

export default ContributionIcon;
