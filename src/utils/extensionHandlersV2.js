/**
 * extensionHandlersV2.js — the app's sessions, seen as a library.
 *
 * The v2 `library.*` capabilities are written against a small interface —
 * list, get, currentId, create, update, exportAs — and the app has none of
 * those. It has an array of sessions and three functions App.js registered.
 *
 * This is the adapter, and it is a separate file because the two shapes should
 * be free to move apart. `extensionLibraryV2.js` decides who may see a book and
 * how much of it; this decides what a book *is* in this app. Mixing them means
 * a change to the session shape becomes a change to the permission model.
 */

/**
 * @param {object}   o
 * @param {Function} o.getSessions     () => session[]
 * @param {Function} [o.importSession] (base64) => session
 * @param {Function} [o.replaceSession](id, base64) => void
 * @param {Function} [o.currentId]     () => string | null
 * @param {Function} [o.exportSessionAs] (session, format) => any
 */
export function libraryHandlers({
  getSessions,
  importSession = null,
  replaceSession = null,
  currentId = null,
  exportSessionAs = null,
}) {
  const all = () => {
    try { return getSessions() ?? []; } catch { return []; }
  };

  return {
    list: async () => all(),

    get: async (id) => all().find((s) => String(s?.id) === String(id)) ?? null,

    /**
     * The open book, which is what `library:read:current` is scoped to.
     *
     * Null when nothing is open, and that is load-bearing rather than a
     * convenience: `read:current` grants nothing at all with no open book,
     * because there is no "current" for it to mean. Falling back to the first
     * session would quietly widen the permission to "some book".
     */
    currentId: () => {
      if (typeof currentId === 'function') {
        try { return currentId() ?? null; } catch { return null; }
      }
      return null;
    },

    create: importSession
      ? async (book) => importSession(book?.data ?? book)
      : null,

    update: replaceSession
      ? async (id, patch) => {
        replaceSession(id, patch?.data ?? patch);
        return all().find((s) => String(s?.id) === String(id)) ?? { id };
      }
      : null,

    exportAs: exportSessionAs
      ? async (book, format) => exportSessionAs(book, format)
      : null,
  };
}
