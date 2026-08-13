# A degraded boot showed your books as empty

**Status:** fixed. `largeBooks.js` › `isMirrorStub` / `rehydrateStub`, plus the
rehydration pass and the on-open path in `App.js`.

**Severity while it was open:** no data was lost, and none could be. It looked
exactly like data loss, which for a writing app is its own harm.

---

## What used to happen

1. A writer's books exceed the ~5 MB localStorage quota. Not exotic: the mirror
   holds full chapter text for every book and is re-serialised on each edit, so
   a few hundred thousand words gets there.

2. `App.js` catches the failed mirror write and degrades the mirror to
   `{ id, title, filePath, type, updated, _mirrorStub }` stubs, so *something*
   survives. Deliberate, documented, and correct.

3. On the next launch that mirror was the **only** source of sessions.
   `initBookIndex()` is a no-op and nothing re-read the `.authbook` files, so
   the app booted holding stubs.

4. The library listed every book, and each one opened with no chapters.

The files on disk were untouched and complete. Opening a book through the file
picker restored it in full. But between launching and doing that, the app was
showing a writer their whole shelf, apparently blank.

It was never dangerous, only dishonest: `isContentless()` refuses to overwrite
a saved book with a copy that has no chapters, `hasUnhydratedChapters()`
refuses a partially loaded one, `isTextKnown()` stops "start blank" reusing a
text-less book as if it were empty, and exports refuse rather than emitting
blank chapters. See `src/utils/storage.js` and `src/utils/largeBooks.js`.

## What fixes it

A stub and a preview-mode book already meant nearly the same thing — the file
on disk is the real copy and the bodies are not in memory. The only difference
was that a preview book knows its chapter list and a stub does not.

So there is no second mechanism and no new screen. One read per stub turns it
into a preview book, which is a shape the app already renders, opens, hydrates
a chapter at a time, and refuses to clobber.

| Piece | Where |
| --- | --- |
| `isMirrorStub(session)` | `largeBooks.js` — the flag, plus "has a file but no chapters" for stubs written before the flag existed |
| `rehydrateStub(stub, fresh)` | `largeBooks.js` — pure; stub + file → preview book |
| Background pass | `App.js`, keyed on `bootReady` — sequential, one book at a time |
| On-open path | `App.js` › `openBookNow` — pulls one book forward rather than waiting its turn |

### The decisions inside it

- **Background, not awaited.** Books appear immediately from the stubs and fill
  in behind that. Holding a blank screen behind a spinner while a shelf of
  large manuscripts is Reed-Solomon-verified one at a time is a worse launch
  than the bug was.

- **Fails closed.** An unreadable file, a revoked SAF grant, or a decode that
  yields no chapters leaves the stub exactly as it was, flag intact. Clearing
  the flag on a failed read would tell every downstream guard the book is
  genuinely empty, and those guards are what stand between a bad read and an
  overwritten manuscript.

- **The stub's `id` wins.** The file carries an id of its own, but resume
  state, widget deep links, the remembered large-book choice and `currentId`
  all point at the in-app one. Adopting the file's would orphan every one.

- **The stub wins on fields it carries** (title, `updated`, type); the file
  fills in only what the stub dropped (chapters, authors, genre, cover).

- **Autosave is told the book is already saved.** This one is load-bearing.
  Without it the autosave pass sees a book it has no fingerprint for, decides
  it is unsaved, reads every file back, hydrates every chapter into memory and
  rewrites every manuscript at launch — and a fully hydrated shelf is what
  overflowed the mirror in the first place, so it would degrade to stubs again
  on the next write and rehydrate again on the next launch, forever. The
  fingerprint is seeded at the moment of rehydration, where the in-memory copy
  is known to match the file because it was just read out of it.

## Deliberately not done

**No new user-facing copy.** Once stubs become preview books the shelf is
simply correct, so there is nothing to explain. A book whose file will not read
stays a stub, and Android already runs `checkFileIntegrity` at launch, which
owns that message. Adding a second one would mean two different explanations
for one broken path — and per `CLAUDE.md`, text describing what is stored and
where is mechanism, which needs the owner's approval before it is written.

## Still true

The on-device read this depends on has never executed on hardware — see
`docs/known-issues/on-device-file-read.md`. The conversion itself is pure and
covered by tests in `src/utils/largeBooks.test.js`; the file read under it is
not, and cannot be from here.
