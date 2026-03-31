/**
 * GradientIcons.jsx
 * Minimalist gradient SVG icons to replace all emoji throughout the app.
 * Every gradient runs top-left → bottom-right (x1=0,y1=0 → x2=1,y2=1).
 *
 * Exports:
 *   FlameIcon   – light orange → orange     (streak / fire)
 *   BookIcon    – lime → green              (chapters / ePub / PDF)
 *   WordsIcon   – deep indigo → periwinkle  (word count / plain-text export)
 *   PencilIcon  – white → accentHex         (create / edit actions)
 *   FolderIcon  – pale yellow → amber       (open existing book)
 *   GlobeIcon   – sky blue → blue           (HTML export)
 */

import { useId } from 'react';

// Sanitise React's ":r0:" style IDs so they are valid SVG id attributes.
function useGradId(prefix) {
  const raw = useId();
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
}

// ── FlameIcon ─────────────────────────────────────────────────────────────────
// Light orange → deep orange, classic flame silhouette.
export function FlameIcon({ size = 24 }) {
  const gid = useGradId('flame');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFD97D" />
          <stop offset="100%" stopColor="#FF5C00" />
        </linearGradient>
      </defs>
      {/* Outer flame body */}
      <path fill={`url(#${gid})`}
        d="M12 2.25c-.38 0-.7.21-.88.54C9.27 6.27 6 10.5 6 14.5a6 6 0 0 0 12 0c0-4-3.27-8.23-5.12-11.71A1 1 0 0 0 12 2.25Z" />
      {/* Inner lighter highlight */}
      <path fill="rgba(255,255,255,0.28)"
        d="M12 7.5c-.25 0-.47.14-.59.36C10.52 9.7 9.5 12 9.5 14a2.5 2.5 0 0 0 5 0c0-2-.99-4.22-1.9-6.13A.67.67 0 0 0 12 7.5Z" />
    </svg>
  );
}

// ── BookIcon ──────────────────────────────────────────────────────────────────
// Lime → green, open-book silhouette with spine and page lines.
export function BookIcon({ size = 24 }) {
  const gid = useGradId('book');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C8F59E" />
          <stop offset="100%" stopColor="#16A34A" />
        </linearGradient>
      </defs>
      {/* Left page */}
      <path fill={`url(#${gid})`}
        d="M2 6a2 2 0 0 1 2-2h6.5v14H4a2 2 0 0 1-2-2V6Z" />
      {/* Right page — slightly darker via overlay */}
      <path fill={`url(#${gid})`}
        d="M13.5 4H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5.5V4Z" />
      {/* Spine */}
      <rect fill="rgba(0,0,0,0.18)" x="10.5" y="4" width="3" height="14" />
      {/* Page lines — left */}
      <line x1="4.5" y1="8"  x2="9"  y2="8"  stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="4.5" y1="11" x2="9"  y2="11" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="4.5" y1="14" x2="9"  y2="14" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeLinecap="round" />
      {/* Page lines — right */}
      <line x1="15" y1="8"  x2="19.5" y2="8"  stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="15" y1="11" x2="19.5" y2="11" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="15" y1="14" x2="19.5" y2="14" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ── WordsIcon ─────────────────────────────────────────────────────────────────
// Deep indigo → periwinkle, rounded-square badge with italic "a".
// Faithfully reproduces the uploaded a.svg with a TL→BR gradient.
export function WordsIcon({ size = 24 }) {
  const gid = useGradId('words');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#100B74" />
          <stop offset="100%" stopColor="#7165F5" />
        </linearGradient>
      </defs>
      {/* Rounded square background */}
      <rect fill={`url(#${gid})`} x="1" y="1" width="22" height="22" rx="6" ry="6" />
      {/* Italic serif "a" glyph — matches the uploaded icon's letterform */}
      <text
        x="12.5" y="17"
        textAnchor="middle"
        fill="white"
        fontSize="14.5"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontWeight="bold"
      >
        a
      </text>
    </svg>
  );
}

// ── PencilIcon ────────────────────────────────────────────────────────────────
// White → accentHex, classic angled pencil/edit shape.
export function PencilIcon({ size = 24, accentHex = '#7C3AED' }) {
  const gid = useGradId('pencil');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor={accentHex} />
        </linearGradient>
      </defs>
      {/* Pencil body */}
      <path fill={`url(#${gid})`}
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z" />
      {/* Eraser tip highlight */}
      <path fill="rgba(255,255,255,0.35)"
        d="M17.81 9.94 14.06 6.19l1.41-1.41 3.75 3.75-1.41 1.41Z" />
    </svg>
  );
}

// ── FolderIcon ────────────────────────────────────────────────────────────────
// Pale yellow → amber, classic folder shape with tab.
export function FolderIcon({ size = 24 }) {
  const gid = useGradId('folder');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FEF08A" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      {/* Folder back / body */}
      <path fill={`url(#${gid})`}
        d="M20 8H11L9 6H4C2.9 6 2 6.9 2 8v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2Z" />
      {/* Tab highlight */}
      <path fill="rgba(255,255,255,0.3)"
        d="M4 6h5l2 2h9c1.1 0 2 .9 2 2H4V8c0-1.1.9-2 2-2H4Z" />
    </svg>
  );
}

// ── GlobeIcon ─────────────────────────────────────────────────────────────────
// Sky blue → royal blue, simplified globe for HTML export.
export function GlobeIcon({ size = 24 }) {
  const gid = useGradId('globe');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#BAE6FD" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill={`url(#${gid})`} />
      {/* Longitude arc */}
      <ellipse cx="12" cy="12" rx="4" ry="10" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
      {/* Equator */}
      <line x1="2" y1="12" x2="22" y2="12" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
      {/* Tropic lines */}
      <path d="M4.5 7.5 Q12 9 19.5 7.5"  fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      <path d="M4.5 16.5 Q12 15 19.5 16.5" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
    </svg>
  );
}
