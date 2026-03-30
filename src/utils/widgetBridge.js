/**
 * widgetBridge.js
 *
 * Two responsibilities:
 *
 *  1. syncWidget(sessions, accentHex)
 *     Call this whenever sessions or the accent colour changes.
 *     It serialises the streak data and pushes it to the native
 *     WidgetDataPlugin so every home-screen Streak Widget refreshes.
 *
 *  2. useWidgetDeepLink(onOpenBook)
 *     React hook — call once in App.js.  Fires onOpenBook(bookId) when
 *     the user taps a widget and the app opens (or resumes) with a
 *     deep-link from MainActivity's handleWidgetDeepLink().
 *
 * Usage in App.js:
 *
 *   import { syncWidget, useWidgetDeepLink } from './utils/widgetBridge';
 *
 *   // Inside AppInner, after sessions / customization state is declared:
 *   useEffect(() => {
 *     syncWidget(sessions, customization.accentHex);
 *   }, [sessions, customization.accentHex]);
 *
 *   useWidgetDeepLink((bookId) => {
 *     handleSelect(bookId);
 *   });
 */

import { useEffect } from 'react';

// ── Capacitor plugin bridge ───────────────────────────────────────────────────

let _pluginCache = null;

async function getPlugin() {
  if (_pluginCache) return _pluginCache;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    _pluginCache = registerPlugin('WidgetData');
    return _pluginCache;
  } catch {
    return null;
  }
}

// ── syncWidget ────────────────────────────────────────────────────────────────

/**
 * Serialises each session's streak data and sends it to the native plugin.
 * Safe to call on every render — the native side only writes to SharedPrefs
 * and triggers RemoteViews updates; it's lightweight.
 *
 * @param {Array}  sessions   Full sessions array from App state
 * @param {string} accentHex  e.g. "#5a00d9"
 */
export async function syncWidget(sessions, accentHex) {
  try {
    const plugin = await getPlugin();
    if (!plugin) return; // Not on Android, or Capacitor unavailable

    // Strip large fields (content, preview) — the widget only needs
    // id, title, and the streak object.
    const slim = sessions
      .filter(s => s.type !== 'storyboard')
      .map(s => ({
        id:     s.id,
        title:  s.title || 'Untitled Book',
        streak: s.streak ?? {},
      }));

    await plugin.syncBooks({
      booksJson: JSON.stringify(slim),
      accentHex: accentHex ?? '#5a00d9',
    });
  } catch (err) {
    // Silently ignore — widget sync is best-effort
    if (process.env.NODE_ENV === 'development') {
      console.debug('[widgetBridge] syncWidget failed:', err);
    }
  }
}

// ── useWidgetDeepLink ─────────────────────────────────────────────────────────

/**
 * Hook that listens for the 'open-book-from-widget' CustomEvent dispatched by
 * MainActivity when the app is launched (or resumed) via a widget tap.
 *
 * @param {function} onOpenBook  Called with (bookId: string)
 */
export function useWidgetDeepLink(onOpenBook) {
  useEffect(() => {
    const handler = (e) => {
      const bookId = e.detail?.bookId;
      if (bookId) onOpenBook(bookId);
    };
    window.addEventListener('open-book-from-widget', handler);
    return () => window.removeEventListener('open-book-from-widget', handler);
  }, [onOpenBook]); // eslint-disable-line react-hooks/exhaustive-deps
}
