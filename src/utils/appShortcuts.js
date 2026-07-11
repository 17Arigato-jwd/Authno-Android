/**
 * appShortcuts.js — dynamic launcher shortcuts (Android only).
 *
 * Keeps the long-press app-icon menu current: "Continue: <last book>" plus
 * "New book". Called from App on the same debounce as the widget sync so
 * the label always names the book the user last wrote in.
 */

import { registerPlugin } from '@capacitor/core';
import { isAndroid } from './platform';

const AppShortcuts = registerPlugin('AppShortcuts');

export async function updateAppShortcuts(lastBook) {
  if (!isAndroid()) return;
  try {
    await AppShortcuts.update({
      lastBookId: lastBook?.id ?? '',
      lastBookTitle: lastBook?.title ?? '',
    });
  } catch { /* older build without the plugin — best-effort */ }
}
