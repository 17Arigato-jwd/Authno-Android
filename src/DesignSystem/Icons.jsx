/**
 * Icons.jsx — Pixel icon library wrapper
 *
 * Uses @hackernoon/pixel-icon-library (CC BY 4.0 — attribution required).
 *
 * Install:  npm install @hackernoon/pixel-icon-library
 * Import once in App entry:
 *   
 *   <DSIcons.Home size={20} color={COLORS.violet} />
 *   <DSIcons.Trash size={16} color={COLORS.danger} />
 */

function HNIcon({ name, size = 16, color = 'currentColor', style = {} }) {
  return (
    <i
      className={`hn hn-${name}`}
      style={{ fontSize: size, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, ...style }}
    />
  );
}

const icon = (name) => ({ size, color, style }) =>
  <HNIcon name={name} size={size} color={color} style={style} />;

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
  PackagePlus:   icon('box'),      // pixel lib doesn't have box-plus; box is closest
  Npm:           icon('npm'),
  Github:        icon('github'),
  Figma:         icon('figma'),
  Heart:         icon('heart'),
};
