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
import { booksWithStreaks, streaksEnabledGlobally, streaksEnabledFor } from './streakSettings';
import { countWords } from './wordCount';
import { countdownState } from './streakWindow';

// ── Capacitor plugin bridge ───────────────────────────────────────────────────

let _pluginCache = null;

/**
 * The plugin, in a box.
 *
 * The box is not decoration. Capacitor's plugin object is a Proxy whose `get`
 * trap answers EVERY property with a callable — including `then`. That makes it
 * a thenable, so returning it from an `async` function hands it to the
 * runtime's promise-resolution machinery, which calls `proxy.then(resolve,
 * reject)` expecting a promise. Capacitor treats that as a call to a plugin
 * method named "then", finds no such method, and throws — inside a promise
 * nobody owns. `resolve` and `reject` are never invoked.
 *
 * The result is not an error the caller can see. `await getPlugin()` simply
 * never settles: the awaiting function stops, forever, one line before it does
 * its work, and the only outward sign is an unhandled rejection reading
 * `"WidgetData" plugin is not implemented on web`. On device the message reads
 * `"WidgetData.then()" is not implemented on android` and the hang is
 * identical, so the widgets stopped receiving data on every platform at once.
 *
 * Wrapping keeps the proxy out of the resolution path. Do not "simplify" this
 * back to returning the plugin directly.
 *
 * @returns {Promise<null | { plugin: object }>}
 */
async function getPlugin() {
  if (_pluginCache) return { plugin: _pluginCache };
  try {
    const { registerPlugin } = await import('@capacitor/core');
    _pluginCache = registerPlugin('WidgetData');
    return { plugin: _pluginCache };
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
  return countWords(chap.content);
}

// ── syncWidget ────────────────────────────────────────────────────────────────

/**
 * Serialises each session's streak data and sends it to the native plugin.
 * Safe to call on every render — the native side only writes to SharedPrefs
 * and triggers RemoteViews updates; it's lightweight.
 *
 * @param {Array}  sessions   Full sessions array from App state
 * @param {string} accentHex  e.g. "#5a00d9"
 * @param {object} theme      the active theme object (see buildWidgetTheme)
 * @param {object} settings   writerSettings — read for the streak switches
 */
export async function syncWidget(sessions, accentHex, theme, settings) {
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
    const box = await getPlugin();
    if (!box) return; // Not on Android, or Capacitor unavailable

    // Strip large fields (content, preview) — the widget only needs
    // id, title, and the streak object.
    //
    // Books with streaks switched off are dropped rather than sent with a
    // flag. The streak widget IS a streak, so a book that is not counting has
    // nothing to show there; leaving it in the list would keep it selectable
    // in the widget's config screen and cycleable with the Next-book button,
    // both of which would land on a card showing a frozen number.
    const slim = booksWithStreaks(sessions, settings)
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

    // Ids of books that exist but are not counting. Without this the widget
    // cannot tell "the book you linked was deleted" from "you switched its
    // streak off" — they look identical once the book is out of booksJson —
    // and it would report a live book as missing.
    const offIds = (sessions || [])
      .filter((s) => s && s.type !== 'storyboard' && !streaksEnabledFor(s, settings))
      .map((s) => s.id);

    // The notes widget's rows. Imported lazily for the same reason resumeState
    // is: the store reads localStorage, which this module must not require in
    // order to be usable off-device.
    //
    // The count is sent alongside the rows rather than inferred from them.
    // buildNotesPayload trims to what a widget can show, so counting the array
    // on the native side would tell a writer with thirty notes they have four.
    let notesJson = '[]';
    let notesTotal = 0;
    try {
      const { buildNotesPayload, noteCount } = await import('./notes');
      notesJson = JSON.stringify(buildNotesPayload(4));
      notesTotal = noteCount();
    } catch { /* no notes store on this platform — the widget shows its empty state */ }

    // The countdown widget's deadline. Computed here rather than natively so
    // the widget, the app and any future surface cannot disagree about when a
    // writing day ends — two surfaces disagreeing about a deadline is worse
    // than neither having one. The widget is handed an absolute timestamp and
    // lets the system tick it, so nothing has to wake up to keep it honest.
    //
    // The deadline moves past midnight only when there is a recent write to
    // move it, which is why the last resume timestamp has to reach this call:
    // without it every night ends at midnight regardless of who is still
    // typing, and the extension would exist in streakWindow and nowhere else.
    let countdownJson = '';
    try {
      let lastWriteAt = null;
      try {
        const { getLastResume } = await import('./resumeState');
        lastWriteAt = getLastResume()?.ts ?? null;
      } catch { /* nothing recorded yet — the day ends at midnight */ }

      const cd = countdownState({ lastWriteAt });
      countdownJson = JSON.stringify({
        deadline: cd.deadline,
        dayKey: cd.dayKey,
        extended: cd.extended,
        inExtension: cd.inExtension,
      });
    } catch { /* the widget falls back to its own midnight */ }

    await box.plugin.syncBooks({
      booksJson: JSON.stringify(slim),
      accentHex: accentHex ?? '#5a00d9',
      isDark: themeIsDark,
      resumeJson,
      themeJson: widgetTheme ? JSON.stringify(widgetTheme) : '',
      streaksEnabled: streaksEnabledGlobally(settings),
      streaksOffJson: JSON.stringify(offIds),
      notesJson,
      notesTotal,
      countdownJson,
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
