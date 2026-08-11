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

// ── Resume card ───────────────────────────────────────────────────────────────

/**
 * What the resume widget shows: the book and chapter you were last writing in.
 *
 * Pure, and exported, because the widget itself cannot be tested from here —
 * this is the part where the interesting mistakes live (a deleted book, a
 * deleted chapter, a book whose text is not loaded) and the part that can be
 * pinned down without a device.
 *
 * @returns {null | { bookId, bookTitle, chapIdx, chapTitle, words, ts }}
 */
export function buildResumePayload(sessions, last) {
  if (!last?.bookId) return null;
  const book = (sessions || []).find((s) => s?.id === last.bookId);
  // The recorded book may have been deleted since. Showing a card for a book
  // that no longer exists gives a button that cannot work.
  if (!book) return null;

  // Sorted by `order`, matching everywhere else that means "the first chapter".
  // Array position is not that chapter after a reorder — the lesson from
  // sessionToBook, where taking the wrong one cost a chapter of prose.
  const chapters = [...(book.chapters || [])]
    .sort((a, b) => (a?.order ?? a?.chap_idx ?? 0) - (b?.order ?? b?.chap_idx ?? 0));

  // The recorded chapter can be gone while the book survives. Falling back to
  // the first chapter keeps the card useful; the alternative is hiding the
  // whole thing because one chapter was deleted.
  const chap = chapters.find((c) => c?.chap_idx === last.chapIdx) ?? chapters[0] ?? null;

  return {
    bookId:    book.id,
    bookTitle: book.title || 'Untitled Book',
    chapIdx:   chap?.chap_idx ?? null,
    chapTitle: chap?.title || 'Untitled chapter',
    words:     chapterWordCount(chap),
    ts:        last.ts ?? null,
  };
}

/**
 * Words in one chapter, preferring the count the app maintains per edit.
 *
 * The cached count is also the only answer available for a chapter whose text
 * has not been read from the file yet (deferred loading leaves `content: null`
 * but keeps `word_count`), so counting from the text alone would report zero
 * on exactly the large books that most need the card.
 */
function chapterWordCount(chap) {
  if (!chap) return 0;
  if (typeof chap.word_count === 'number') return chap.word_count;
  const text = String(chap.content ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
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
export async function syncWidget(sessions, accentHex, theme) {
  // The widget used to get one bit — "is the app dark?" — inferred from a DOM
  // class, which is why Sepia, Paper and OLED all rendered as plain Dark. It
  // now gets the actual theme's colours, so all six render as themselves.
  //
  // The DOM sniff stays as the fallback for callers that have no theme to hand.
  let widgetTheme = null;
  try {
    if (theme) {
      const { buildWidgetTheme } = await import('../theme/ThemeBase');
      widgetTheme = buildWidgetTheme(theme);
    }
  } catch { /* fall through to the inferred bit below */ }

  let themeIsDark = widgetTheme ? widgetTheme.isDark : true;
  if (!widgetTheme) {
    try { themeIsDark = !document.documentElement.classList.contains('light-mode'); } catch { /* default dark */ }
  }
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

    // The resume card needs where you stopped, which lives in localStorage
    // rather than in the sessions array. Imported lazily so this module stays
    // usable off-device, where resumeState has nothing to read.
    let resumeJson = '';
    try {
      const { getLastResume } = await import('./resumeState');
      const payload = buildResumePayload(sessions, getLastResume());
      if (payload) resumeJson = JSON.stringify(payload);
    } catch { /* no resume recorded yet — the card shows its empty state */ }

    await plugin.syncBooks({
      booksJson: JSON.stringify(slim),
      accentHex: accentHex ?? '#5a00d9',
      isDark: themeIsDark,
      resumeJson,
      themeJson: widgetTheme ? JSON.stringify(widgetTheme) : '',
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
