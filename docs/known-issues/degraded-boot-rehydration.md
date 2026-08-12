# A degraded boot shows your books as empty

**Status:** open. Deferred deliberately — the fix changes the boot path, which
is worth doing on its own rather than attached to unrelated work.

**Severity:** no data is lost, and none can be. It looks exactly like data
loss, which is its own problem for a writing app.

---

## What happens

1. A writer's books exceed the ~5 MB localStorage quota. This is not exotic;
   the mirror holds full chapter text for every book and is re-serialised on
   each edit, so a few hundred thousand words gets there.

2. `App.js` catches the failed mirror write and degrades the mirror to
   `{ id, title, filePath, type, updated }` stubs, so *something* survives.
   Deliberate, documented, and correct.

3. On the next launch that mirror is the **only** source of sessions.
   `initBookIndex()` is a no-op and nothing re-reads the `.authbook` files, so
   the app boots holding stubs.

4. The library lists every book, and each one opens with no chapters.

The files on disk are untouched and complete. Opening a book through the file
picker restores it in full. But between launching and doing that, the app is
showing a writer their whole shelf, apparently blank.

## Why it is not dangerous any more

It used to be catastrophic. Step 4 continued: autosave handed each stub to
`saveBook`, stubs still carry `filePath`, `sessionToBook()` turned a
chapter-less session into one empty chapter, and every manuscript was
overwritten with nothing.

That path is closed. `isContentless()` refuses to overwrite a saved book with
a copy that has no chapters or content, `hasUnhydratedChapters()` refuses a
partially loaded one, `isTextKnown()` stops "start blank" from reusing a
text-less book as if it were empty, and exports refuse rather than emitting
blank chapters. See `src/utils/storage.js` and `src/utils/largeBooks.js`.

So the remaining issue is honesty, not safety. The app cannot damage anything
in this state; it just cannot explain itself.

## The fix

Rehydrate at boot. A stub carries `filePath`, and `readSessionFromFile()` in
`src/utils/storage.js` already reads and decodes a book from one — it was
added for preview mode and does exactly this job.

The work is in sequencing rather than mechanism:

- The boot restore in `App.js` is synchronous today (`setSessions(parsed)` from
  localStorage). Rehydration is per-file async I/O, so the library has to be
  able to render before it finishes.
- Books should appear immediately from the stubs and fill in as they load,
  rather than the app holding a blank screen behind a spinner while a shelf of
  large books is unpacked.
- Unpacking is Reed-Solomon-verified and not cheap. Doing every book eagerly on
  every launch is the wrong trade; loading on demand — the same choice preview
  mode makes — is probably right, and stubs and preview-mode books are close to
  the same thing already.
- A book whose file cannot be read must stay a stub and say so, not silently
  become an empty book. `hydrateAll()` already fails closed this way.

There is a decent chance the honest fix is to converge the two: treat a
degraded stub AS a preview-mode book, since both mean "the chapter list is
real and the bodies are on disk". That would reuse the loading path, the save
guards, and the UI that already exists for it, instead of adding a second
mechanism that means the same thing.

## Also worth fixing at the same time

The only signal a writer gets when the mirror degrades is a `console.warn`,
which on a phone nobody will ever see. If books can boot in a reduced state,
that state should be visible in the UI — and per `CLAUDE.md` the copy needs
the owner's approval before it is written, since anything describing what is
stored and where is mechanism.

## Where to look

| File | What matters |
| --- | --- |
| `src/App.js` | the mirror write and its quota fallback; the boot restore; `_mirrorStub` |
| `src/utils/storage.js` | `readSessionFromFile()`, `isContentless()`, the save guards |
| `src/utils/largeBooks.js` | `toPreviewSession()`, `hydrateAll()`, `isTextKnown()` |
| `src/utils/storageGuard.test.js` | the destruction path this used to have, asserted directly |

## Related

The on-device read this depends on has never executed on hardware — see
`docs/known-issues/` siblings and the notes in `readSessionFromFile()`.
