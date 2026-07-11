/**
 * appIcon.js — launcher / window icon switching.
 *
 * Android: thin face of AppIconPlugin; the enabled activity-alias is the
 *   single source of truth (persisted by PackageManager).
 * Desktop (Electron): main.js swaps the taskbar/window icon at runtime and
 *   persists the pick in userData.
 *
 * Either way, read the current pick with getAppIcon() when the UI needs it.
 */

import { registerPlugin } from '@capacitor/core';
import { isAndroid, isElectron } from './platform';

const AppIcon = registerPlugin('AppIcon');

/**
 * Picker metadata. Previews live in public/app-icons/.
 *
 * There are two icons: Dark (the default) and Light — Retro and Space Gold
 * are variants of the Light design, so the picker groups them under it the
 * same way font weights group under one family.
 */
export const APP_ICON_FAMILIES = [
  {
    id: 'default',
    label: 'Dark',
    preview: 'app-icons/ic_launcher_default.png',
    variants: [{ id: 'default', label: 'Default', preview: 'app-icons/ic_launcher_default.png' }],
  },
  {
    id: 'light',
    label: 'Light',
    preview: 'app-icons/ic_launcher_light.png',
    variants: [
      { id: 'light', label: 'Classic',    preview: 'app-icons/ic_launcher_light.png' },
      { id: 'retro', label: 'Retro',      preview: 'app-icons/ic_launcher_retro.png' },
      { id: 'gold',  label: 'Space Gold', preview: 'app-icons/ic_launcher_gold.png' },
    ],
  },
];

/** Which family a variant id belongs to. */
export function familyOf(id) {
  return id === 'default' ? 'default' : 'light';
}

export function appIconSupported() {
  return isAndroid() || (isElectron() && typeof window.electron?.setAppIcon === 'function');
}

/** @returns {Promise<string>} one of 'default' | 'light' | 'retro' | 'gold' */
export async function getAppIcon() {
  try {
    if (isAndroid()) { const { icon } = await AppIcon.get(); return icon || 'default'; }
    if (isElectron() && window.electron?.getAppIcon) return (await window.electron.getAppIcon()) || 'default';
  } catch { /* fall through */ }
  return 'default';
}

/** @param {string} id one of the APP_ICONS ids */
export async function setAppIcon(id) {
  if (isAndroid()) { await AppIcon.set({ icon: id }); return; }
  if (isElectron() && window.electron?.setAppIcon) { await window.electron.setAppIcon(id); }
}
