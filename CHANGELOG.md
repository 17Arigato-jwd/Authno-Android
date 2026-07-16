# Changelog

All notable, user-facing changes. Dates are release dates; unreleased work sits
under the top-most version until it ships.

## 1.1.18-beta.2

_Bug-hunt and optimization round on beta.1._

### Performance

- **Word counts stopped re-parsing HTML.** Every chapter now carries a cached
  `word_count` — maintained on each edit, loaded from the `.authbook`
  manifest, and refreshed by History restores/reverts. The streak flame
  (which recounted the whole book on every editor flush), the desktop home
  stats, the book studio's chapter rows and totals, and the dashboard totals
  all read the cache and only fall back to parsing for chapters that predate
  it.
- **The history engine parses each chapter state once, not four times.**
  Paragraph splitting is now memoized (small LRU) — during a typing burst the
  baseline and previous-state splits are cache hits, cutting the per-flush
  diff cost to roughly a quarter.

### Fixes

- **History: leftover invisible accumulators are cleaned up.** Sub-threshold
  edit accumulators for a chapter used to linger hidden in the history array
  forever once a new entry started; they're now purged (their content lives
  on as the new entry's baseline).
- **History: blank paragraphs no longer count as changes.** Empty `<p>`s from
  pressing Enter showed up as empty preview lines and padded "N paragraphs
  changed" summaries.
- **History: repeated reverts are safe.** Reverting the same change twice
  could operate on a shared cached block array; reverts now work on copies.
- **Word-count rules unified.** The manifest counter, the streak counter and
  the app counter each treated `&nbsp;` slightly differently, so totals could
  jump by a few words after a chapter's first edit once the cache kicked in.
  One rule everywhere now.
- **Book studio: "Position" is the chapter's place in the story**, not its
  place in whatever the search box happened to match ("1 of 12" while
  filtering).
- **Ctrl+Alt+I no longer fires on AltGr layouts.** On Windows, AltGr registers
  as Ctrl+Alt — typing í on Hungarian/Slovak keyboards popped the chapter-info
  modal mid-word. Real Ctrl+Alt is distinguished via the AltGraph modifier
  state.

## 1.1.18-beta.1

_The QA round on beta.0, shaped by the author's feedback — history that shows
real changes, shortcuts everywhere, a settings overhaul, and the missing
close animations._

### History v2 — real changes, not just states

- Entries are now **paragraph-level changes** — a rewritten paragraph, a
  deleted line, an added passage — each with a **before → after preview**
  (removed text struck through, added text highlighted). Tiny tweaks under
  ~10 words don't clutter the list; they accumulate silently until they
  amount to something. Typing in the same paragraph keeps extending one
  entry; moving elsewhere starts a new one.
- **Click to preview, then choose**: *Revert this change* surgically undoes
  just that edit while keeping everything written since (it politely refuses
  when the passage has drifted too far), or *Restore to here* jumps the
  chapter back. Restores and reverts are recorded too.
- The panel now **closes on outside click** (desktop), and the History button
  no longer overflows its row.

### Shortcuts (the "Standard set")

- **Ctrl+,** Settings · **Ctrl+N** New book · **Ctrl+O** Open ·
  **Ctrl+Shift+N** New chapter · **Ctrl+Alt+I** Chapter info ·
  **Ctrl+Shift+T** Threads · **Ctrl+Shift+R** Read aloud ·
  **Ctrl+Shift+E** Export — joining Ctrl+K, Ctrl+S and Ctrl+Shift+Z.
  Faded hints appear next to buttons and menu items, tooltips name their
  keys, and **Settings → Shortcuts** lists everything.
- The desktop home's passive "Ctrl K" chip is now a real **Search button**,
  and the quick switcher shows its shortcut while open.

### Menus & screens

- **Burger menu redesigned**: left-aligned rows with icons and right-aligned
  faded shortcut hints (no more overflow), grouped sections, and
  context-aware items — Chapter info only when a chapter is open in the
  editor, History in the menu only where the editor's own button isn't
  available, Settings only on Android (the desktop sidebar covers it — one
  entry point instead of three). Burger buttons now match the streak flame's
  size.
- **Book screen (desktop)**: an info button next to "Open in editor" opens the
  chapter's stats, and a Details block under the preview shows words,
  position, created and updated dates.
- **Read aloud** is greyed on the book screen until a chapter is selected —
  and then reads from that chapter on. On Home it opens a **book & chapter
  picker** instead of guessing.

### Settings overhaul

- Regrouped into **General** (profile + device preferences), Appearance,
  **Editor** (new), Writing Goal, Startup, **Shortcuts** (new), Data &
  Storage, **Developer** (new) and About.
- New wired settings: **spell check** toggle, **manuscript width**
  (full / focused column, desktop) and **auto-save delay** (Android).
- **Developer tab**: version/platform info, the error log, one-tap
  **copy diagnostics**, replay any tour (welcome slides / guided tour /
  what's-new), and a reset-all-settings escape hatch.

### The missing animations

- Close animations for Settings, the gradient customizer, the font
  customizer, chapter info, the streak calendar, and Threads (both the mobile
  sheet and the desktop pane, which now slides its width).
- The desktop sidebar's collapse/expand transitions instead of snapping;
  switching chapters crossfades the manuscript; and **changing theme or
  fonts soft-crossfades** the whole app instead of hard-cutting.

## 1.1.18-beta.0

_The safety-net release: change history, safer deletes, faster typing, and a
real guided tour._

### New — Change history (undo/redo panel)

- **Ctrl+Shift+Z / Ctrl+Shift+Y** opens a Docs-style history panel of the open
  book's recent changes — typing bursts (grouped like an editing session),
  chapter adds/deletes/renames/moves, and restores. **Click any entry to go
  back to that state**; restores are recorded too, so browsing versions is
  never destructive. Plain Ctrl+Z/Ctrl+Y still undo/redo inside the editor as
  before.
- **Persistence exactly as designed**: the last **10** changes are saved inside
  the `.authbook` (riding the same RS-parity-protected META as Threads) and
  load back with the book; a writing session keeps up to **50** in memory.
- **Other ways in**: a History button in the editor header (desktop), and a
  menu entry with the shortcut shown next to it, faded, Google-Docs style. On
  Android it's a bottom sheet with its own menu entry and back-button support.
- **Deleted chapters are recoverable** — deleting a chapter records its full
  text in history, and clicking that entry brings the chapter back (under a
  fresh number if the old one was reused — it will never overwrite a newer
  chapter).

### New — Delete confirmations

- **Deleting a chapter asks first** everywhere (the desktop studio's bulk
  delete and right-click delete now use a proper themed dialog instead of the
  browser popup; the mobile rows keep their inline confirm).
- **Removing a book got its own dialog**: it explains the file stays on disk,
  with a checkbox to **"Also permanently delete the file from this device"** —
  the button turns into *Delete forever* when ticked. Works on desktop
  (deletes the `.authbook`) and Android (deletes the SAF document and any
  app-folder autosave). Never-saved desktop drafts say clearly that removing
  them is permanent. The old "don't ask again" bypass is gone — book removal
  always asks now.

### Improved — Typing performance

- **Keystrokes no longer re-render the whole app.** The editor keeps input in
  the page and flushes to app state after a 400 ms pause (or instantly on
  blur/navigation), with the flush target captured at input time so a late
  flush can never land in the wrong chapter. Sidebar, previews, word counts
  and autosave all now update per pause instead of per key — long chapters on
  phones feel dramatically lighter.

### New — Guided tour

- **A real tutorial**, not just welcome slides: a spotlight walks through the
  actual app — creating a book, chapters, synopsis, cover & details, writing,
  formatting, Threads, streaks, and save/export — highlighting the real
  buttons on your screen, on both the phone and desktop layouts.
- Offered at the end of the welcome tour (**"Take the guided tour"**),
  replayable any time from **Settings → About → Guided tour**, skippable at
  every step, keyboard-navigable, and it creates your first book for you if
  the library is empty.

### Fixes

- Restoring an "Added chapter" history entry can no longer blank out a chapter
  that has been written into since.
- The Ctrl+K handler no longer assumes `e.key` exists (rare crash with IME /
  autofill synthetic key events).

## 1.1.17-beta.4

_QA round — this release also carries everything listed under 1.1.17-beta.3
below, which was never published on its own._

- **`.authbook` persistence is now covered by automated tests** — chapter
  synopses, threads, streak history, notes, covers and extended metadata are
  verified to round-trip byte-for-byte, including recovery from a corrupted
  byte via the Reed–Solomon parity and loading of old single-chapter files.
- **Material You reliability** — the wallpaper-colour refresh on app resume now
  uses the proper Capacitor lifecycle event (the old hook never fired on most
  devices; the colour only updated on a full restart).
- **Smoother animations on long lists** — the cascade of list items is capped
  at half a second total. Previously a 100-chapter book spent 3–4 seconds
  fading its rows in, one by one.
- **Lighter animations on Android** — chapter rows no longer run layout
  animations on phones (a per-frame measurement cost on exactly the list that
  gets long); entrances stay, using GPU-cheap transform/opacity only.

## 1.1.17-beta.3

_Desktop grows up: a PC-grade layout, plus Material You on Android._

### New — desktop layout

- **Writer's dashboard home** — a "Continue writing" hero, live stats
  (books / chapters / words), a compact action row, and your library as a
  cover grid with hover lift and right-click menus. No more phone list on a
  24" monitor.
- **Three-pane book studio** — Ulysses/Scrivener style: book info & actions on
  the left, a dense searchable chapter list in the middle (Ctrl/Shift-click
  multi-select with bulk delete, right-click menus, double-click to write),
  and the selected chapter's synopsis + prose preview on the right.
- **Full nav sidebar** — Home and Settings shortcuts at the top, and every book
  can expand to show its chapters — click one to jump straight into the editor.
- **Ctrl+K quick switcher** — jump to any book or chapter, or run actions
  (new book, settings, home) from one palette.

### New — Android

- **Material You** (Android 12+) — turn it on under Settings → Appearance and
  AuthNo's accent follows your wallpaper's system colour, updating when your
  wallpaper changes. Shown only on devices that support dynamic colour.

### Also in this release

- **More motion** — the animations pass now also covers: the burger menu
  (bottom-sheet spring + backdrop fade on mobile, scale-fade dropdown on
  desktop, with proper closing animations), editor-toolbar popovers, the
  selection tag chip (springs in) and selection menu, onboarding / what's-new
  page transitions, book cards (tap feedback), the drawer backdrop, and the
  Export / Metadata sheets.

## 1.1.17-beta.2

_Animations pass — subtle, snappy motion across the app._

### New

- **Motion everywhere.** Screens slide by navigation direction (forward/back);
  opening a book or a chapter uses an "expand" transition. Home action tiles
  cascade in with tap feedback; book stats count up; chapter rows animate their
  position when reordered; Settings sections cross-fade; the app-icon picker
  presses and pops. All tuned to be fast and understated — present, never in the
  way.
- **"Reduce animations" setting** (Appearance). AuthNo also automatically
  minimises motion when your device's system "reduce motion" accessibility
  setting is on. Animations are kept lighter on phones to protect frame rate.

## 1.1.17-beta.1

_Mobile-focused fixes on top of 1.1.17-beta.0._

### Editor (mobile)

- **Font and size actually apply now.** Picking a size (or typing one) and
  choosing a font previously did nothing on a selection and the size snapped
  back — the toolbar was losing the editor's selection when tapped. The
  selection is now captured and restored, so formatting lands on the selected
  text.
- **Toolbar sits at the top when you're not typing** and slides down to dock
  above the keyboard while editing, instead of floating over the page.
- **Text selection now shows the tag chip** (below the selection so it isn't
  hidden behind the system menu), and the selection menu has **working
  cut / copy / paste / select-all** — the built-ins were unreliable on some
  devices and there's no right-click on mobile.

### Fixes

- **App icon no longer looks cropped** — the Light / Retro / Space Gold glyphs
  are re-centred inside the adaptive safe zone so launchers don't clip them.
- **Chapter delete is easy to find** — a clear, finger-sized delete button on
  each chapter row.
- **Read Aloud** uses a proper vector icon and only appears on devices that
  actually support text-to-speech.
- **"See changes"** now opens this what's-new list instead of the first-run
  welcome tour.
- The home-screen title bar (menu button) **stays pinned** while the page
  scrolls.

## 1.1.17-beta.0

_Compared to **v1.1.16-beta-0**._

### New

- **Chapter synopsis** — each chapter row in the book dashboard now has an
  inline, tap-to-edit synopsis. Tap "Add synopsis", type a short summary, and it
  saves straight into the `.authbook` file (rides along with the chapter's RS
  parity, so it survives recovery too).
- **App-icon changes apply everywhere (desktop)** — picking an app icon now
  restarts AuthNo so the new icon shows in the window *and* the taskbar. The
  live in-place swap was unreliable on Windows; the app relaunches with the icon
  baked in from the first frame. Switching to a non-default icon is an Authno
  Pro perk.

### Look & feel

- The gradient / grainy background is **more prominent** (larger, stronger
  blooms) instead of a barely-there tint.
- The background now shows on the **book screen** too, not just Home.
- The animated gradient uses noticeably **less GPU on desktop** — lighter blur,
  and it pauses while the window is hidden or minimised.
- Home no longer shows a duplicate sidebar-toggle button; the sidebar now has a
  proper "AuthNo" wordmark instead of a black logo box.
- The book cover shrank to a compact "Add cover" pill so it stops dominating the
  page; stat icons are unified to the lucide set.
- Redesigned the app-icon picker — a flat, uniform grid with clear selected /
  locked states.

### Desktop fixes (PC round)

- Fixed the repeated **"ExtbkAssets plugin is not implemented on web"** error
  logged on every desktop launch.
- Installing an extension no longer **hangs at "Activating…"** — extensions are
  mobile-only for now, so desktop skips activation fast (with an 8s safety
  timeout as a backstop).
- Fixed the app icon **failing to switch** in packaged desktop builds (it
  couldn't read the icon assets out of `app.asar`).

### About

- Attribution updated to the real stack: React, Electron, Capacitor, Lucide,
  JSZip, PDF.js, Inter and JetBrains Mono.
- The welcome tour now lives behind a subtle **"See changes"** info button next
  to the version number.

### Windows installer

- Detects an already-installed version and **confirms the update** (naming the
  old version) before replacing it; stays silent for auto-update runs.
- **Uninstalling keeps your books and settings**, and the Add/Remove Programs
  entry now shows the version so it's identifiable.

### Since 1.1.16-beta-0 (shipped across the 1.1.16 betas)

For completeness, the notable work that landed in the 1.1.16 line between
`v1.1.16-beta-0` and this release:

- **Threads** — track plotlines, character arcs and TODOs anchored to your
  prose, following along as you scroll.
- **Import a book** — TXT, Markdown, HTML, RTF, DOCX, ODT, EPUB and PDF.
- **Desktop editor round** — Docs-style selection menu, thread tiling across two
  windows with drag-between tabs, and a collapsible sidebar.
- **Zero-resistance writing** — first-class Resume path, share-to-AuthNo import,
  home-screen shortcuts, streak-widget fixes and autosave.
- **Linux packaging** — AppImage / deb / rpm with AppStream metadata and rounded
  desktop windows.
- **App icon switcher** — Dark, plus Light with Retro and Space Gold variants;
  opaque, corner-cropped light icon art.
