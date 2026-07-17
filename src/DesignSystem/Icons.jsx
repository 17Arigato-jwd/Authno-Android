/**
 * Icons.jsx — Icon system, now backed by lucide-react.
 *
 * History: v1.1.16 used the @hackernoon pixel icon font with SVG fallbacks for
 * missing glyphs. The pixel look read as "retro website" next to the rest of
 * the UI (author feedback with screenshots), so every icon now maps to a
 * modern lucide-react stroke icon behind the SAME DSIcons API — callers keep
 * using <DSIcons.Name size color style /> untouched.
 *
 * Rules:
 *   • Keep the DSIcons key set stable — components all over the app import it.
 *   • color defaults to 'currentColor' so CSS-var theming keeps working.
 *   • Brand glyphs lucide doesn't guarantee long-term (Discord, Npm) are
 *     inline SVGs so a lucide upgrade can never silently break them.
 */

import {
  Home, ChevronRight, ChevronLeft, ChevronUp, ChevronDown, Menu,
  MoreHorizontal, MoreVertical, PanelLeft,
  Book, BookOpen, File, FilePlus, FileText, Folder, FolderOpen, Archive, Save, Target,
  Check, X, Plus, Minus, Search, Pencil, Eraser, Trash2, Copy, Link, Image as ImageIcon, Upload, Download, RotateCw,
  Info, AlertTriangle, CheckCircle2, XCircle, AlertCircle, Bell, BellRing,
  Lock, Unlock, Shield, Key,
  Eye, EyeOff, Camera, Palette, Type, SlidersHorizontal,
  MessagesSquare, Star, Rocket, Sparkles, Zap,
  Settings, Puzzle, Code, Terminal, Bug, Tag, Bookmark, Clock, Calendar,
  User, CircleUser, Infinity as InfinityIcon, List, Package, PackagePlus,
  Github, Figma, Heart,
  Volume2, FlaskConical, Flame, Globe, Pin, Cloud,
  Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  ListOrdered, Indent, Outdent, RemoveFormatting, Baseline, Highlighter,
  Undo2, Redo2, Scissors, ClipboardPaste, TextSelect,
  History as HistoryGlyph,
  Paintbrush, CaseUpper, Superscript as SuperscriptGlyph, Subscript as SubscriptGlyph,
  AlignVerticalSpaceAround,
} from 'lucide-react';

// Uniform wrapper: preserves the legacy {size, color, style} contract and the
// inline-flex baseline behaviour the old font glyphs had.
const icon = (Lucide, extraProps = {}) =>
  function DSIcon({ size = 16, color = 'currentColor', style = {} }) {
    return (
      <Lucide
        size={size}
        color={color}
        strokeWidth={2}
        style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
        {...extraProps}
      />
    );
  };

// ── Brand glyphs kept as inline SVG (lucide brand icons are deprecated) ──────
function DiscordIcon({ size = 16, color = 'currentColor', style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}>
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.8 13.8 0 0 0-.64 1.28 18.3 18.3 0 0 0-5.5 0 13.7 13.7 0 0 0-.64-1.28c-1.71.29-3.37.8-4.93 1.51A20.3 20.3 0 0 0 .1 18.06a19.9 19.9 0 0 0 6.07 3.03c.49-.66.93-1.37 1.3-2.1a12.9 12.9 0 0 1-2.06-.98c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.18 0c.16.13.33.26.5.38-.66.39-1.35.72-2.07.98.38.73.81 1.44 1.3 2.1a19.8 19.8 0 0 0 6.08-3.03 20.2 20.2 0 0 0-3.58-13.69ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42c1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42c1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z"/>
    </svg>
  );
}
function NpmIcon({ size = 16, color = 'currentColor', style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}>
      <path d="M2 2h20v20H2V2zm4 4v12h6V10h4v8h4V6H6z"/>
    </svg>
  );
}

export const DSIcons = {
  // Navigation
  Home:          icon(Home),
  ChevronRight:  icon(ChevronRight),
  ChevronLeft:   icon(ChevronLeft),
  ChevronUp:     icon(ChevronUp),
  ChevronDown:   icon(ChevronDown),
  Menu:          icon(Menu),
  PanelLeft:     icon(PanelLeft),
  More:          icon(MoreHorizontal),
  MoreVertical:  icon(MoreVertical),
  // Content & files
  Book:          icon(Book),
  BookOpen:      icon(BookOpen),
  File:          icon(File),
  FilePlus:      icon(FilePlus),
  FileText:      icon(FileText),
  Folder:        icon(Folder),
  FolderOpen:    icon(FolderOpen),
  Archive:       icon(Archive),
  Save:          icon(Save),
  Target:        icon(Target),
  // Actions
  Check:         icon(Check),
  X:             icon(X),
  Plus:          icon(Plus),
  Minus:         icon(Minus),
  Search:        icon(Search),
  Edit:          icon(Pencil),
  Eraser:        icon(Eraser),
  Trash:         icon(Trash2),
  Copy:          icon(Copy),
  Link:          icon(Link),
  Image:         icon(ImageIcon),
  Upload:        icon(Upload),
  Download:      icon(Download),
  Refresh:       icon(RotateCw),
  Cut:           icon(Scissors),
  Paste:         icon(ClipboardPaste),
  SelectAll:     icon(TextSelect),
  Undo:          icon(Undo2),
  Redo:          icon(Redo2),
  History:       icon(HistoryGlyph),
  // Status
  Info:          icon(Info),
  Warning:       icon(AlertTriangle),
  CheckCircle:   icon(CheckCircle2),
  XCircle:       icon(XCircle),
  WarningCircle: icon(AlertCircle),
  Bell:          icon(Bell),
  BellRinging:   icon(BellRing),
  // Security
  Lock:          icon(Lock),
  Unlock:        icon(Unlock),
  Shield:        icon(Shield),
  Key:           icon(Key),
  // Visual / settings
  Eye:           icon(Eye),
  EyeOff:        icon(EyeOff),
  Camera:        icon(Camera),
  Palette:       icon(Palette),
  Text:          icon(Type),
  Sliders:       icon(SlidersHorizontal),
  // Formatting (editor toolbar)
  Strikethrough: icon(Strikethrough),
  AlignLeft:     icon(AlignLeft),
  AlignCenter:   icon(AlignCenter),
  AlignRight:    icon(AlignRight),
  AlignJustify:  icon(AlignJustify),
  ListOrdered:   icon(ListOrdered),
  Indent:        icon(Indent),
  Outdent:       icon(Outdent),
  ClearFormat:   icon(RemoveFormatting),
  TextColor:     icon(Baseline),
  Highlighter:   icon(Highlighter),
  Painter:       icon(Paintbrush),
  CaseChange:    icon(CaseUpper),
  Superscript:   icon(SuperscriptGlyph),
  Subscript:     icon(SubscriptGlyph),
  LineSpacing:   icon(AlignVerticalSpaceAround),
  // Social / app
  Discord:       DiscordIcon,
  Chat:          icon(MessagesSquare),
  Star:          icon(Star),
  StarFill:      icon(Star, { fill: 'currentColor' }),
  Rocket:        icon(Rocket),
  Sparkle:       icon(Sparkles),
  Lightning:     icon(Zap),
  Cloud:         icon(Cloud),
  // System
  Settings:      icon(Settings),
  Extension:     icon(Puzzle),
  Code:          icon(Code),
  Terminal:      icon(Terminal),
  Bug:           icon(Bug),
  Tag:           icon(Tag),
  Bookmark:      icon(Bookmark),
  Clock:         icon(Clock),
  Calendar:      icon(Calendar),
  User:          icon(User),
  UserCircle:    icon(CircleUser),
  Infinity:      icon(InfinityIcon),
  List:          icon(List),
  Package:       icon(Package),
  PackagePlus:   icon(PackagePlus),
  Npm:           NpmIcon,
  Github:        icon(Github),
  Figma:         icon(Figma),
  Heart:         icon(Heart),
  Volume:        icon(Volume2),
  Flask:         icon(FlaskConical),
  Flame:         icon(Flame),
  Globe:         icon(Globe),
  Pin:           icon(Pin),
};
