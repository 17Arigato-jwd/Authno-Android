# TODO — Notes widget

**Status:** app-side base built and shipped; the widget itself is not started.

A home-screen widget for the thing the notes feature is actually for: an idea
arrives, and you want it written down before it goes — without unlocking into
the app, finding a book, and placing a cursor.

## What already exists

Built alongside this note, so the widget has something to sit on rather than
arriving with its whole stack at once:

| Piece | Where | State |
| --- | --- | --- |
| The store | `src/utils/notes.js` | done, 28 tests |
| The widget's row payload | `notes.js` › `buildNotesPayload()` | done, pure, tested |
| In-app capture and editing | `src/components/NotesPanel.jsx` | done |
| Ways in | Burger menu → Notes, `Ctrl+J` | done |
| Deep-link action | `authnoAction: "new-note"` → opens capture | done, unused |

`buildNotesPayload()` is deliberately ahead of the widget. It is the part with
the edge cases — a note with no text, a note that is only whitespace, a body
long enough to blow a `RemoteViews` row — and it is the part that can be
pinned down here, without a device. The widget will consume it as-is.

`new-note` is wired through `MainActivity` → `authno-launch-action` → `App.js`
already, so the capture button has a working target the day the widget exists.

## What the widget needs

### Layout

Follow `resume_widget.xml`, which already solves the two hard parts:

- a tintable `ImageView` card background, because `RemoteViews` cannot recolour
  a shape set with `setBackgroundResource` — this is why the older widgets
  rendered four of six themes as plain Dark;
- `widget_btn_state_dark` / `_light` for the pressed state.

Rows: a **New note** button, then up to four note rows from
`buildNotesPayload(4)`. Pinned notes sort first, which the payload already
does.

### The part that needs deciding

**A widget cannot take text input.** `RemoteViews` has no `EditText` — the
permitted view set is fixed and does not include one. So "create and edit
notes on the go" cannot be literal: something has to open.

Three options, in order of preference:

1. **Capture button → app, straight into a new note.** One tap, keyboard up,
   nothing to navigate. `authnoAction: "new-note"` already does this. Costs an
   app launch, which is the thing the widget was meant to avoid, but it is the
   only option that is certain to work on every launcher.
2. **A transparent capture activity** — a small dialog-themed `Activity` with a
   single `EditText`, launched from the widget. Feels like typing "into" the
   widget; avoids loading the whole WebView. Needs a native note writer that
   agrees with `notes.js` on the localStorage/JSON shape, which is the real
   work here and the reason it is not option 1.
3. Voice capture via `RecognizerIntent`. Nice, and genuinely hands-free, but it
   is a fourth path into the same store and should wait until one of the above
   is proven.

Start with 1. It is a day's work and it makes the widget useful; 2 is the
version worth building once the store has been exercised on a device.

### Data path

`WidgetDataPlugin.syncBooks` already carries `resumeJson` and `themeJson`;
`notesJson` goes the same way rather than opening a second bridge. Note the
asymmetry: books and the resume card are **read-only** on the widget side,
whereas option 2 above would make the widget a *writer* into notes storage.
That is a different problem — two writers, one store — and needs the same
care the session mirror gets. Do not let it in by accident with option 1.

## Before it ships

- Rows must survive a note that is only whitespace (`buildNotesPayload`
  already returns `"Empty note"` for the title — check it renders).
- Tapping a row opens that note, not the list. Needs a per-row
  `PendingIntent` with its own request code: `PendingIntent`s are keyed by
  `(requestCode, Intent)` and **extras are not part of that key**, so four rows
  sharing a code all open whichever note was registered last. This has bitten
  this project once already — see the streak widget's `widgetId * 10 + n`.
- The theme must come from `WidgetTheme`, not a hardcoded palette. Both
  existing widgets got this wrong on the first pass in different ways.
- Nothing on the widget may be an emoji.
