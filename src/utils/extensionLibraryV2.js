/**
 * extensionLibraryV2.js — the `library.*` capabilities.
 *
 * Spec: docs/extension-system-v2-spec.md §3.
 *
 * This is where the permission model stops being a table and starts costing
 * something, because two of its rules cannot be expressed as "which method may
 * you call":
 *
 * 1. **`library:read:current` is a scope, not a method.** `library.get` is one
 *    function, and whether a given call is allowed depends on its *argument* —
 *    the open book, yes; any other book, only with `library:read:all`. A static
 *    method check cannot see that, so the check lives here, at the point where
 *    the id is known. Getting this wrong makes `read:current` a synonym for
 *    `read:all`, which is the whole distinction gone.
 *
 * 2. **`library.list` returns metadata, never text.** An extension that can
 *    enumerate the library still cannot read a manuscript through the listing.
 *    The projection below is an allowlist rather than a delete-list: a new
 *    field added to a book somewhere else in the app does not silently start
 *    crossing the bridge because nobody remembered to strip it.
 *
 * `store` is injected — the app owns what a book is; this module owns who may
 * see one and how much of it.
 */

/** Fields `library.list` may return. Anything not named here does not cross. */
const LIST_FIELDS = [
  'id', 'title', 'author', 'isbn', 'created', 'updated',
  'chapterCount', 'wordCount',
];

/** Extras a caller may ask for, and what each costs. */
const LIST_EXTRAS = {
  chapterTitles: 'chapter.titles',
  chapterPreview: 'chapter.preview',
  synopsis: 'chapter.synopsis',
};

/**
 * How much of a chapter a preview may show.
 *
 * Enough to identify a chapter, not to read one — with an honest caveat: a
 * chapter SHORTER than this is fully visible, because for such a chapter the
 * whole text is the identification and no preview scheme avoids that. So a book
 * of very short chapters can be reconstructed through previews alone, which
 * makes `chapter.preview` a grant over content rather than merely over shape.
 * That is precisely why it is opt-in rather than part of the default listing.
 */
const PREVIEW_CHARS = 160;

export class LibraryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LibraryError';
    this.code = code;
  }
}

const str = (v) => (v === null || v === undefined ? '' : String(v));

function wordsIn(text) {
  const t = str(text).trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/**
 * Metadata for one book, built by allowlist.
 *
 * `extras` is what the caller asked for; each entry is opt-in because a table
 * of contents is useful and chapter titles carry plot. An author who wants a
 * word-count widget should not be handing it the shape of the story.
 */
export function projectBook(book, extras = []) {
  const chapters = Array.isArray(book?.chapters) ? book.chapters : [];
  const out = {
    id: str(book?.id),
    title: str(book?.title),
    author: str(book?.author),
    isbn: str(book?.isbn),
    created: book?.created ?? null,
    updated: book?.updated ?? null,
    chapterCount: chapters.length,
    wordCount: chapters.reduce((n, c) => n + wordsIn(c?.content), 0),
  };

  const want = new Set(Array.isArray(extras) ? extras : []);
  if (want.has(LIST_EXTRAS.chapterTitles)) {
    out.chapterTitles = chapters.map((c) => str(c?.title));
  }
  if (want.has(LIST_EXTRAS.synopsis)) {
    out.synopsis = chapters.map((c) => str(c?.synopsis));
  }
  if (want.has(LIST_EXTRAS.chapterPreview)) {
    out.chapterPreview = chapters.map((c) => str(c?.content).slice(0, PREVIEW_CHARS));
  }
  return out;
}

/** The fields a projection can ever contain — used by the tests as a fence. */
export const PROJECTION_FIELDS = LIST_FIELDS;
export const PROJECTION_EXTRAS = LIST_EXTRAS;

/**
 * Build the `library.*` capabilities.
 *
 * @param {object}   o
 * @param {Function} o.list          () => book[]           every book
 * @param {Function} o.get           (id) => book | null
 * @param {Function} o.currentId     () => string | null    the open book
 * @param {Function} [o.create]      (book) => book
 * @param {Function} [o.update]      (id, patch) => book
 * @param {Function} [o.exportAs]    (book, format) => any
 */
export function libraryCapabilities({
  list, get, currentId,
  create = null, update = null, exportAs = null,
}) {
  /**
   * The scope check. `permissions` comes from the dispatch context, so this
   * reads the grants in force right now rather than a copy taken at load.
   */
  function assertMayRead(id, permissions) {
    if (permissions.has('library:read:all')) return;
    const open = currentId();
    // No open book means read:current grants nothing at all — there is no
    // "current" for it to refer to, and defaulting to the first book would
    // quietly widen the permission.
    if (open === null || open === undefined || str(open) === '') {
      throw new LibraryError('no-open-book', 'no book is open, so there is nothing this permission covers');
    }
    if (str(id) !== str(open)) {
      throw new LibraryError(
        'outside-scope',
        'this extension may only read the book you have open',
      );
    }
  }

  return {
    'library.list': async ([options]) => {
      const extras = Array.isArray(options?.include) ? options.include : [];
      const books = (await list()) ?? [];
      return books.map((b) => projectBook(b, extras));
    },

    'library.get': async ([id, options], ctx) => {
      const wanted = str(id);
      if (!wanted) throw new LibraryError('no-id', 'library.get needs a book id');
      assertMayRead(wanted, ctx.permissions);

      const book = await get(wanted);
      if (!book) throw new LibraryError('no-such-book', `no book with id ${wanted}`);

      // Metadata unless the caller explicitly asks for chapter text. A backup
      // extension wants the text; a word counter does not, and the default
      // should be the smaller of the two.
      if (options?.chapters === false || options?.chapters === undefined) {
        return projectBook(book, Array.isArray(options?.include) ? options.include : []);
      }
      return book;
    },

    /**
     * Reading any book at all, for an extension that holds read:all. Split from
     * `library.get` so the permission table has one method per permission and
     * the reverse index stays unambiguous.
     */
    'library.getAny': async ([id, options]) => {
      const wanted = str(id);
      if (!wanted) throw new LibraryError('no-id', 'library.getAny needs a book id');
      const book = await get(wanted);
      if (!book) throw new LibraryError('no-such-book', `no book with id ${wanted}`);
      if (options?.chapters === false || options?.chapters === undefined) {
        return projectBook(book, Array.isArray(options?.include) ? options.include : []);
      }
      return book;
    },

    'library.create': async ([book]) => {
      if (!create) throw new LibraryError('unsupported', 'this build cannot create books');
      if (!book || typeof book !== 'object') {
        throw new LibraryError('bad-book', 'library.create needs a book object');
      }
      return projectBook(await create(book));
    },

    'library.update': async ([id, patch]) => {
      if (!update) throw new LibraryError('unsupported', 'this build cannot update books');
      const wanted = str(id);
      if (!wanted) throw new LibraryError('no-id', 'library.update needs a book id');
      if (!patch || typeof patch !== 'object') {
        throw new LibraryError('bad-patch', 'library.update needs an object to apply');
      }
      const existing = await get(wanted);
      if (!existing) throw new LibraryError('no-such-book', `no book with id ${wanted}`);
      return projectBook(await update(wanted, patch));
    },

    'library.export': async ([id, format]) => {
      if (!exportAs) throw new LibraryError('unsupported', 'this build cannot export books');
      const wanted = str(id);
      const fmt = str(format || 'authbook').toLowerCase();
      if (!ALLOWED_FORMATS.has(fmt)) {
        throw new LibraryError('bad-format', `${fmt} is not an export format`);
      }
      const book = await get(wanted);
      if (!book) throw new LibraryError('no-such-book', `no book with id ${wanted}`);
      return exportAs(book, fmt);
    },
  };
}

/**
 * The formats an extension may ask for.
 *
 * These are the ones the app can actually produce. `md` and `docx` were on
 * this list and are not among them — the app imports both and exports
 * neither — so an extension asking for one passed the permission check and
 * then failed deeper in, with a message about an unknown format rather than
 * about a format that does not exist here. A gate that admits a call the
 * layer behind it will refuse is worse than no gate: it moves the error away
 * from the reason.
 */
const ALLOWED_FORMATS = new Set([
  'authbook', 'txt', 'html', 'epub', 'pdf',
]);

export { ALLOWED_FORMATS };
