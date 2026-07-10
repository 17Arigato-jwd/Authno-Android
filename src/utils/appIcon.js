/**
 * appIcon.js — launcher icon switching (Android only).
 *
 * Thin JS face of AppIconPlugin. The enabled activity-alias is the single
 * source of truth (PackageManager persists it across reboots and updates),
 * so nothing is stored in app settings — read the current pick with
 * getAppIcon() whenever the UI needs it.
 */

import { registerPlugin } from '@capacitor/core';
import { isAndroid } from './platform';

const AppIcon = registerPlugin('AppIcon');

/** Picker metadata. Previews live in public/app-icons/. */
export const APP_ICONS = [
  { id: 'default', label: 'Default',    preview: 'app-icons/ic_launcher_default.png' },
  { id: 'light',   label: 'Light',      preview: 'app-icons/ic_launcher_light.png' },
  { id: 'retro',   label: 'Retro',      preview: 'app-icons/ic_launcher_retro.png' },
  { id: 'gold',    label: 'Space Gold', preview: 'app-icons/ic_launcher_gold.png' },
];

export function appIconSupported() {
  return isAndroid();
}

/** @returns {Promise<string>} one of 'default' | 'light' | 'retro' | 'gold' */
export async function getAppIcon() {
  if (!appIconSupported()) return 'default';
  try {
    const { icon } = await AppIcon.get();
    return icon || 'default';
  } catch {
    return 'default';
  }
}

/** @param {string} id one of the APP_ICONS ids */
export async function setAppIcon(id) {
  if (!appIconSupported()) return;
  await AppIcon.set({ icon: id });
}
