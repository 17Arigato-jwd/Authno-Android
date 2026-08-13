# Device test plan

Everything in this app is verified except the parts that need an Android
runtime, and no CI runner or dev container has one. This is that list.

It is ordered by **what it would cost to be wrong**, not by convenience. Part 1
is the reason to hold a release; parts 2 and 3 are things that would be
embarrassing but not harmful.

**What you need:** one Android device (or emulator, API 22+ ideally two:
one old, one current), the APK from the latest CI run or release, and about
90 minutes for parts 1–3.

**Before you start:** put a real book in it. Several chapters, a few thousand
words, and — this matters — **at least one book with a Japanese, Chinese or
Thai title and body**, because several of the fixes only show up there.

---

## Part 1 — The parts that can cost somebody their work

Do these first. If any fails, stop and report it; the rest can wait.

### 1.1 The on-device file read has never executed

`readSessionFromFile` in `src/utils/storage.js` is called by preview mode, by
autosave before it writes a partially-loaded book, and by the degraded-boot
rehydration. **Every failure path around it is tested. The success path has
literally never run.**

1. Create a book and save it somewhere with the file picker (Save As).
2. Force-stop the app. Reopen it.
3. Open the book, open a chapter, confirm the text is there.
4. Edit a word. Wait five seconds. Force-stop, reopen, confirm the edit
   survived.

**Failing looks like:** a chapter that opens blank, or a toast reading "That
chapter could not be loaded from the file". Both mean the read returned
nothing, and everything downstream is built on the assumption that it works.

### 1.2 A book over 5 MB in preview mode

1. Make a book big enough to trip the threshold (~5 MB — paste a lot, or
   duplicate chapters).
2. Open it. You should be **asked** whether to open in preview mode.
3. Choose preview. The chapter list should appear immediately, with titles and
   word counts, and no bodies.
4. Open one chapter. Its text should load.
5. Edit it, wait, force-stop, reopen, confirm the edit is on disk.

**Failing looks like:** the chapter list is empty, chapters open blank, or —
the serious one — the book is saved back with only the chapter you opened.

### 1.3 The degraded boot (the one I shipped blind)

This is the feature added this cycle whose central operation is 1.1. Reaching
it deliberately is awkward; it is worth doing anyway.

1. Fill the localStorage mirror past its ~5 MB quota — several large books,
   all fully loaded, is the honest way. (Settings → Developer → scan will tell
   you what the app can see.)
2. Force-stop and reopen.
3. **Every book should still be listed, and should fill in with chapter counts
   over the first few seconds.** Opening one should show its real chapter list.

**Failing looks like:** books listed with no chapters and staying that way. That
is the old behaviour, and it means rehydration did not run or the read failed.

**The dangerous failure:** any book being *saved* while in this state. Nothing
should be written back at boot at all. If you see file-modified timestamps
change just from launching the app, stop and report it — that is the loop the
autosave fingerprint seeding is meant to prevent.

### 1.4 Export and rescue

The promise is that being locked out never costs manuscripts.

1. From the sign-in gate — **without signing in** — find "Export my books".
2. Confirm your books are listed with **correct word counts**. For the
   non-Latin book, the count must not be 1. (This was broken until this cycle;
   it is the fix I would most like confirmed on real text.)
3. Export one as TXT, one as EPUB. Open both. Confirm the words are there.
4. Confirm a book the app cannot read is reported as such rather than exported
   as an empty file.

### 1.5 Non-Latin filenames

1. Name a book in Japanese (日本語のタイトル) and one in Russian (Война и мир).
2. Save each with the picker. Confirm the suggested filenames are readable,
   not rows of underscores.
3. Save both. Confirm you end up with **two files**, not one overwriting the
   other.

---

## Part 2 — Native code that has compiled but never run

CI builds a signed APK, so all of this compiles and every resource resolves.
None of it has been inflated by a launcher or fired by an alarm.

### 2.1 The three widgets

For **each** of Streak, Resume and Notes:

1. Long-press the home screen → Widgets → AuthNo. Confirm it appears in the
   picker with a sensible preview.
2. Place it. Confirm it renders — not blank, not a grey box.
3. **Switch the app's theme to Sepia, then Paper, then OLED.** The widget must
   follow. All three used to render as plain Dark; that fix has never been seen
   on a device.
4. Confirm nothing on it is an emoji.
5. Resize it. Confirm the text does not clip or overlap.

Then the buttons:

| Widget | Tap | Should |
| --- | --- | --- |
| Streak | Start writing | open the linked book in the editor |
| Streak | Add chapter | add a chapter to the **linked** book, not the open one |
| Streak | Next book | change the shown book **without opening the app** |
| Streak | Refresh | update in place, without opening the app |
| Resume | Continue writing | open the last book and chapter you were in |
| Notes | New note | open the app **into an empty note with the keyboard up** |
| Notes | a row | open **that** note — check all four rows open four different notes |
| Notes | "+n more" | open the notes list |

**The row test is the one to actually do.** `PendingIntent`s are keyed by
`(requestCode, Intent)` and extras are not part of that key, so rows sharing a
code all open whichever note was registered last. The code gives each row its
own; nobody has watched it work.

Also: tap the **card** of the Resume and Notes widgets, away from any button.
Nothing should happen. Whole-surface tap targets get hit while swiping between
home screens.

### 2.2 The daily reminder

1. Settings → Writing Goal → turn the reminder on, set it a few minutes ahead.
2. Grant the notification permission when asked.
3. Wait. Confirm it arrives, and that tapping it opens the app.
4. Hit your writing goal, then wait for the next one — by default it should
   **stay quiet** on a day you have already met the goal.
5. Turn streaks off entirely. Confirm the reminder stops with them.

### 2.3 Surviving a reboot

`BootReceiver` re-arms the alarm after a restart and has never run.

1. With a reminder scheduled for tomorrow, **reboot the device**.
2. Confirm the reminder still arrives.

If it does not, the receiver is not firing, and every user gets exactly one
day of reminders after each restart.

### 2.4 Extensions

1. Install a `.extbk` from a file manager. Confirm the install sheet runs and
   the extension **appears in the list afterwards** (this was broken on desktop
   this cycle; Android used a different path, so confirm both).
2. Open its page. Confirm it renders rather than showing "Could not read".
3. Uninstall it. Confirm it goes, and stays gone after a restart.

---

## Part 3 — Worth checking, not worth blocking on

- **Old Android.** minSdk is 22. If you have anything on API 22–24, just launch
  it and open a book; `android:fillType` and `drawableTint` are API 24/23 and a
  widget layout is where that bites.
- **Share into AuthNo** from another app (select text → Share → AuthNo).
- **Deep links**: the launcher shortcuts, and opening a `.authbook` from a file
  manager.
- **Rotate the device** in the editor mid-sentence; confirm the caret and text
  survive.
- **Kill the app from the recents list** while typing; confirm the last words
  are there on reopen.
- **Screen reader pass** (TalkBack): the five buttons labelled this cycle are
  both overflow menus, the scroll-to-top button, and the two chapter reorder
  arrows.

---

## What to send back

For anything that fails: what you did, what happened, what you expected, and
the device + Android version. If it is a widget, a photo of the home screen is
worth more than a description.

If Part 1 passes in full, the data-integrity story is verified end to end for
the first time — that is the thing worth knowing.
