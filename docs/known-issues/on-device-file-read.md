# The on-device file read has never executed

**Status:** open. Blocks shipping preview mode; nothing else depends on it.

`readBytesFromUri` has existed in `FilePickerPlugin.java` since the plugin was
written, but until preview mode nothing in JavaScript called it. No CI runner
and no dev container has an Android runtime, so the happy path has literally
never run. Every failure path around it is tested; the success path is not.

## What has been verified, and how

Statically, by reading both sides — this rules out the mismatch that would make
it fail 100% of the time rather than intermittently:

| Check | Result |
| --- | --- |
| Argument name | JS sends `{ uri }`; Java reads `call.getString("uri")` — match |
| Return shape | Java resolves `{ base64 }` (`Base64.NO_WRAP`); JS reads `res.base64` — match |
| Rejection | Java `call.reject(...)` rejects the promise; JS catches and returns `null` — match |
| Persisted access | `createDocument` and `openDocument` both call `persistPermission()`, taking READ and WRITE persistable permission, so a saved book's URI survives a restart |
| Null stream | `readAllBytes` throws on a null `InputStream` rather than returning empty bytes, so an unreadable file cannot masquerade as an empty book |

That last row matters more than it looks: returning zero bytes instead of
throwing would decode as a book with no chapters, and the whole guard stack
exists to stop that shape reaching a file.

## What cannot be verified here

Whether it actually returns the bytes. Specifically:

- **Large files.** `drain()` accumulates into a `ByteArrayOutputStream` in 8 KB
  chunks, then base64-encodes the whole array. A 5 MB book therefore exists in
  memory at least three times over during the read — raw bytes, the stream's
  internal buffer, and the base64 string, which is 4/3 the size again. Preview
  mode exists *for* books that big, so this is the exact case it will meet, and
  an `OutOfMemoryError` on a low-end device would be caught by the JS
  `try/catch` and reported as an unreadable file.
- **Transient URIs.** A book opened from another app's share sheet carries a
  `content://` URI granted for that launch only; an incoming intent cannot take
  persistable permission. Mitigated (see below) but not observed.
- **Latency.** The read happens when a chapter is opened. If it takes long
  enough to be felt, the editor appears before the prose does.

## What was changed because of this

`openBookNow` now performs a probe read **before** converting a book to preview
mode, and falls back to opening it in full if the file cannot be read.

The reasoning: `canDeferLoad` only knows a `filePath` exists, and not every
`filePath` can be read back — the share-sheet case above looks identical to a
saved book. Dropping chapter bodies we have not just proven we can re-read is
the one way this feature loses work. The probe costs one file read on a path
the writer has already agreed to wait for, and the result is not wasted: it is
exactly what the chapters would have been rehydrated from.

Verified in Chromium with a bridge that reports the file as unreadable: the
book opens in full, the writer is told, and no bodies are dropped.

## Manual test plan

Needs a real device or emulator with a `.authbook` over 5 MB. Build with
`scripts/release-local.sh <version> --dry-run`, or `npx cap sync android &&
./gradlew installDebug`.

**1. The happy path — the thing that has never run.**
Save a >5 MB book to device storage. Reopen it from the library, choose
*Open in preview mode*, then open a chapter partway down the book.

- Expect: chapter list appears immediately with word counts; the chapter you
  open shows its real prose within a second or two.
- Failure: the toast *"That chapter could not be loaded from the file"* and a
  bounce back to the chapter list. That is the guard doing its job, and it
  means the read failed — check logcat for `readSessionFromFile`.

**2. Survives a restart.** Force-stop the app, reopen, open a different chapter
of the same book.

- Expect: same as above. This is the one that exercises persisted URI
  permission, which is the most likely thing to be wrong.

**3. Editing and saving from preview mode.** Open a chapter, type a sentence,
wait for autosave, force-stop, reopen and check the sentence is there — and
that the chapters you never opened still have their text.

- This is the merge path. `hydrateAll` fills only nulls, so the edit should
  survive and nothing else should be reverted to what was on disk.

**4. Export.** With chapters still unopened, export to PDF.

- Expect: either a complete PDF, or a visible error. Silent blank chapters
  would mean `withAllChapters` did not fire.

**5. The share-sheet case.** Send a large `.authbook` to AuthNo from a file
manager, then try to open it in preview mode.

- Expect: it opens in full with *"Could not read this book's file, so it opened
  in full instead"*, or preview mode works and keeps working after a restart.
- Failure: preview mode is offered, and after a restart the chapters cannot be
  opened. The text is still safe on disk and reachable through the file picker,
  but that is the case the probe is meant to prevent.

**6. A low-end device, if one is to hand.** Repeat 1 with the largest book
available and watch for the read failing where it succeeded on a better phone —
that would point at the memory profile in `drain()` rather than at permissions.

## If the read turns out to be too heavy

The obvious repair is streaming the base64 back in chunks, or writing to a
temp file and handing JS a path. Both are larger than this feature warrants;
the simpler retreat is to raise the preview-mode threshold so it only engages
where the alternative is worse.

## Where to look

| File | What matters |
| --- | --- |
| `android/.../FilePickerPlugin.java` | `readBytesFromUri`, `readAllBytes`, `drain`, `persistPermission` |
| `src/utils/storage.js` | `readSessionFromFile()` — the only caller |
| `src/App.js` | `openBookNow` probe, `handleEditChapter` hydration |
| `src/utils/largeBooks.js` | `hydrateChapter`, `hydrateAll`, `canDeferLoad` |
