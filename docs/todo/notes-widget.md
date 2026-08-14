# Notes widget

**Status:** built, and never run on hardware. Option 1 of the three below is
what shipped; 2 and 3 remain open.

A home-screen widget for the thing the notes feature is actually for: an idea
arrives, and you want it written down before it goes — without unlocking into
the app, finding a book, and placing a cursor.

## What is there

| Piece | Where | State |
| --- | --- | --- |
| The store | `src/utils/notes.js` | done, 30 tests |
| The widget's row payload | `notes.js` › `buildNotesPayload()` | done, pure, tested |
| In-app capture and editing | `src/components/NotesPanel.jsx` | done |
| Ways in | Burger menu → Notes, `Ctrl+J` | done |
| The widget | `NotesWidgetProvider.java`, `notes_widget.xml`, `notes_widget_info.xml` | done, unrun |
| Its words | `NotesText.java` | done, 13 tests on the JVM |
| Data path | `syncWidget()` → `notesJson` + `notesTotal` → `WidgetDataPlugin` | done, 2 tests |
| Deep links | `new-note`, `open-note`, `notes` → `authno-launch-action` → `App.js` | done |

### How it behaves

A 4×2 card: a heading with the note count, a **New note** button, and up to four
rows from `buildNotesPayload(4)`. Pinned notes sort first, which the payload
already does. Tapping the button opens the app straight into a fresh note with
the caret in it; tapping a row opens that note; tapping "+n more" opens the
list, because that line refers to no single note.

### The decisions inside it

- **The count is sent separately from the rows.** `buildNotesPayload` trims to
  what a widget can show, so a native side that counted the array would tell a
  writer with thirty notes that they have four. `notesTotal` rides alongside.

- **Every row has its own request code.** `PendingIntent`s are keyed by
  `(requestCode, Intent)` and **extras are not part of that key**, so four rows
  sharing a code would all open whichever note was registered last. This
  project has paid for that lesson once already — see the streak widget's
  `widgetId * 10 + n`, which this follows.

- **A one-line note falls back to the time.** Quick capture produces one-line
  notes by definition, so `NotesText.secondary()` shows when it was written
  when there is no second line. Every row stays two lines tall and the list
  does not jump around as notes are added.

- **`NotesText` imports nothing from android**, so the parts that are ordinary
  logic run on the JVM rather than being eyeballed on a launcher. Same reason
  `ResumeText` exists, and it reuses `ResumeText.ago()` rather than growing a
  second relative-time formatter.

- **The theme comes from `WidgetTheme`**, tinted onto an `ImageView` card
  rather than set as a background drawable — `RemoteViews` cannot recolour a
  shape set with `setBackgroundResource`, which is why the older widgets
  rendered Sepia, Paper and OLED as plain Dark.

- **Read-only.** The temptation here is different from the other widgets: a
  notes widget looks like it ought to be able to write one. Two writers into
  one store is the problem the session mirror already taught this project, and
  it is not worth inheriting for a text field.

- **Nothing on it is an emoji.**

## Still open

**A widget cannot take text input.** `RemoteViews` has no `EditText` — the
permitted view set is fixed and does not include one. So "create and edit notes
on the go" is not literal: something has to open.

1. ~~**Capture button → app, straight into a new note.**~~ Shipped. One tap,
   keyboard up, nothing to navigate. Costs an app launch, which is the thing
   the widget was meant to avoid, but it is the only option certain to work on
   every launcher.
2. **A transparent capture activity** — a small dialog-themed `Activity` with a
   single `EditText`, launched from the widget. Feels like typing "into" the
   widget; avoids loading the whole WebView. Needs a native note writer that
   agrees with `notes.js` on the localStorage/JSON shape, which is the real
   work here and the reason it was not first. It also makes the widget a
   *writer* into notes storage — two writers, one store — and that needs the
   same care the session mirror gets.
3. **Voice capture via `RecognizerIntent`.** Genuinely hands-free, but a fourth
   path into the same store; it should wait until 2 is proven.

## What is verified, and what is not

**It compiles and ships in an APK.** The `Build Android` CI job runs
`./gradlew assembleRelease` and `bundleRelease` on a runner with a real Android
SDK, and it went green with the widget in place. That is worth more than it
sounds, because the toolchain fails closed on most of what could be wrong here:

- `NotesWidgetProvider.java` and `NotesText.java` compile against the platform.
- Every `R.id`, `R.layout`, `R.drawable` and `R.string` reference resolves —
  aapt2 fails the build on an unresolved resource, so a typo in an id or a
  missing string could not have got this far.
- `notes_widget.xml` and `notes_widget_info.xml` are valid resource XML, and
  the `<receiver>` merges into the manifest.

**It has never run.** No CI runner and no dev container has an Android
*runtime* — see `docs/known-issues/on-device-file-read.md`, which is the same
gap. So the widget has never been inflated by a launcher, and everything below
compiling is still unproven:

- `RemoteViews` accepting the layout at runtime. Low risk — FrameLayout,
  LinearLayout, TextView and ImageView are all in the supported set — but the
  supported set is a runtime check, not a compile-time one.
- The per-row `PendingIntent`s landing on the right notes.
- `setColorFilter` tinting the card as intended in each theme.
- Anything about tap targets, sizing or how it looks at 4×2.

`NotesText`'s 13 tests do run, on the JVM, because it imports nothing from
`android` — that is why it exists as a separate file.

The first device run should confirm, in this order: the widget appears in the
picker; it renders in a non-Dark theme; the New note button lands in an empty
note with the keyboard up; four rows open four different notes.
