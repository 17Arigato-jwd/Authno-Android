# Changelog

All notable, user-facing changes. Dates are release dates; unreleased work sits
under the top-most version until it ships.

## 1.1.18-beta.8

_Tour cards that never cover what they point at, and a friendlier paywall._

### Onboarding

- **The tour card never overlaps the thing it's highlighting anymore.** Instead
  of always sitting below the target (and covering it whenever the target was
  tall or centred), the card now drops into the free band beside the spotlight —
  below, right, left or above, whichever fits. Filling in book details, the card
  tucks into the sidebar gutter with the whole metadata panel left clear.
- **Reading and writing steps are fully lit.** The "read The Good Knight" and
  "write a few words" steps no longer dim the page or spotlight it — the page
  stays at full brightness and the card floats compactly in a corner, out of the
  way of the prose.

### Pro / paywall

- **Payment is now hidden behind a single "Try now" button** with a gift icon —
  the upgrade screen leads with the free-trial invitation, and the card/UPI
  fields only appear once you choose to set them up.
- **UPI is offered alongside card** for India (collect-request flow).
- **"You're supporting a solo developer" is now a highlighted callout**, not just
  another bullet — AuthNo is one person's independent, offline-first app, and the
  screen says so plainly.

## 1.1.18-beta.7

_A fixes-and-flow pass on both onboarding tours, from first desktop testing._

### Onboarding fixes & restructure

- **Metadata save no longer crashes the app.** Saving book details during the
  first-book walkthrough could crash: the walkthrough checked authors as plain
  text while the editor saves them as structured entries. The check now
  understands both shapes, and every step-completion check is hardened so a
  faulty check can never take the app down with it.
- **Tour cards stay on screen.** The Next button could land out of bounds and
  the long row of step dots overflowed the card. Both tours now use a slim
  progress bar instead of dots, and cards are always clamped to the viewport.
- **Read while you tour.** The guided tour no longer blocks the app behind an
  invisible click shield — you can scroll and read *The Good Knight* (its
  first chapter now has a proper name: "Chapter 1: Good Night"), type, and
  click freely while a tour card is up. When a step highlights most of the
  screen, the card tucks into the bottom-left corner out of the way.
- **Both tours restructured so each step leads into the next.** The intro
  tour is now 8 compact steps (welcome → create → import → your shelf → 
  chapters → read the page → the menu → "Create My First Book" hand-off).
  The first-book walkthrough flows in writing order: import → details →
  name a chapter → streak goal → write → cover → save → threads → history →
  export.
- The first-book walkthrough now visibly **opens the streak calendar** during
  the streak step, and the metadata step highlights the actual details panel
  once it's open.

## 1.1.18-beta.6

_A hands-on first-book walkthrough, and a fix for a desktop startup hang._

### Create My First Book

- Brand-new users get a **"Create My First Book" banner** on the home screen
  that launches an interactive, hands-on walkthrough. It builds your real
  first book with you, one step at a time: import a draft (or start blank),
  set a streak goal, add details, name a chapter, write a few words, add a
  cover, save, track it with Threads, peek at History, and export.
- Steps you must do (add details, name a chapter, write, save, make a thread,
  open History) wait for you and unlock as you go; optional ones can be
  skipped. The writing step pauses for as long as you like — leave and come
  back, and it picks up right where you were.

### Fixes

- **Desktop startup hang.** On some (especially brand-new) Windows machines,
  the app could sit on a blank window for a long time or fail to load. A boot
  optimisation from beta.4 was the cause — reverted. The window now appears
  only once it's ready to draw, with a safeguard so it can never stay hidden.
  If a machine's graphics drivers are the problem, launching with
  `AUTHNO_DISABLE_GPU=1` forces software rendering.

## 1.1.18-beta.5

_A polish pass on the new onboarding: the funnel and paywall now match the
intended design, and the guided tour is richer and stays on screen._

### Onboarding & paywall design

- The welcome funnel and the Pro paywall were restyled to their intended
  look: a labelled chip above a bold headline, cleaner content blocks, and a
  bottom action bar. The paywall's 7-day trial timeline (Day 1 unlocked →
  Day 5 reminder → Day 7 first charge) is now a clear horizontal rail.

### Guided tour

- The tour now **opens the feature it's describing** — the Threads panel, the
  streak calendar and the menu all open with the spotlight on them, so you
  see the real thing rather than just its button.
- Added stops for the Threads panel, the streak calendar up close, and the
  full menu of Save / Rename / History / Export / Read aloud.
- Tour cards no longer run off the edge of the screen — off-screen targets
  scroll into view and every card is kept fully on screen.

## 1.1.18-beta.4

_The onboarding funnel rebuilt properly, Material You as a real theme, and a
serious boot-speed round._

### Onboarding, actually good this time

- beta.3's funnel rendered inline beside the live app with broken styling —
  rebuilt as a **full-screen experience** in the app's design language:
  blurred scrim, floating colour blobs, frosted-glass card, progress rail,
  smooth step transitions, full keyboard nav.
- The tour step now runs the **real guided tour over the real app** — "The
  Good Knight" sits in your actual library while the spotlight walks
  home → book → editor — then the funnel resumes for your name.
- **New tour steps for Import and Export**: bring existing drafts in (TXT,
  Markdown, DOCX, ODT, EPUB, PDF) and see that books export anywhere.
- **Settings → Guided tour now replays the entire welcome experience**, not
  just the spotlight walkthrough.

### Material You is a theme now

- Pick **"Material You" in the theme grid** (Android): the app follows your
  device's light/dark setting live and takes its accent from your wallpaper.
  Wallpaper changes land on the next app open; system dark/light flips apply
  instantly. Your own accent pick is kept underneath and returns when you
  switch back. (The beta.3 toggle fought the custom accent and visibly did
  nothing — removed.)

### Boot speed (desktop)

- **The splash window is gone.** It was a second browser process whose
  loading screen (blank box → white → gradient → late logo) regularly lost
  the race against the app itself. A new inline splash paints complete in
  the first frame — on desktop, Android and web.
- **The window appears instantly** on Windows, painted in the theme colour,
  and beta.3 already removed a hidden 1.5-second wait.
- Fewer processes (no splash renderer; GPU merged into main on Windows), no
  default menu, eager script caching, and ~100 KB less JavaScript parsed at
  startup (paywall, funnel, import sheet and recovery modal now load on
  first use).

### Fixes

- Desktop burger menu no longer clips its keyboard-shortcut hints.

## 1.1.18-beta.3

_Onboarding rebuilt as a five-step funnel, and Pro reframed from subscription
plans to a single one-time purchase with a 7-day free trial._

### New onboarding

- **Five-step funnel replaces the welcome deck**: Welcome → About you →
  guided tour → your name → a note from the creator, with a persistent
  progress rail (dots + bar) across every step. Keyboard: → / Enter advance,
  ← back, Esc skips.
- **"The Good Knight" demo book** — a real short story (Chapter 1 final) is
  placed in your library during the tour so there's something genuine to
  explore before you've created anything. It's removed automatically when
  setup finishes and never survives an app restart.
- **About you** pre-selects the common answers (a novel, just starting,
  300–5000 words) so most people just tap Continue — everything stays
  editable.
- **Your name** captures a display name and optional username into a new
  local profile store (`authno_profile`) — the future seam for cloud
  accounts; nothing leaves the device.
- **Replay** still lives in Settings; replaying never resets your trial or
  touches a purchased Pro.

### Pro: one-time purchase + 7-day trial

- **Plans are gone.** Monthly/yearly/lifetime is replaced by a single
  one-time purchase: **₹2,999.99** in India, converted per region and
  rounded to a .99 price elsewhere ($29.99 / £24.99 / €29.99, more in
  `src/utils/pricing.js`). Unknown regions fall back to USD. Still the mock
  checkout — Play Billing will supply store-localized prices later.
- **7-day free trial starts when setup finishes** (existing users: on first
  launch after this update). Every Pro feature is unlocked during the trial;
  gating everywhere is now trial-aware.
- **The billing page explains the timeline**: Day 1 everything unlocked,
  Day 5 a reminder, Day 7 the one-time charge — plus a days-left banner
  while a trial is running. The paywall slides up on its own about half a
  second after setup ends, not as a step inside it.
- **UPI is shown for the India region only**; other regions get card.

### Migration

- Existing installs are recognised by the old "seen onboarding" flag: they
  skip the new-user funnel, get the profile backfilled, start their trial,
  and see this what's-new notice instead.

## 1.1.18-beta.2

_Bug-hunt and optimization round on beta.1, a Raycast-style Settings redesign,
and a Word/Docs-class editor toolbar._

### Editor toolbar: Word & Docs features

- **Paragraph styles** — a Normal text / Heading 1–3 / Quote dropdown at the
  head of the toolbar (Docs' style selector), with each entry previewed in its
  own weight and the active style checked.
- **Find & replace (Ctrl+F)** — a bar under the toolbar with next/previous
  match (Enter / Shift+Enter), Replace and Replace All, scoped to the open
  chapter. Opening it pre-fills whatever text you had selected.
- **Format painter** — Word's paintbrush: click it with the caret in styled
  text, then select other text to copy the bold/italic/underline/strike,
  colour, highlight, font and size across. Esc cancels.
- **Change case** — UPPERCASE, lowercase, Capitalize Each Word and Sentence
  case, applied in place so bold/italic runs inside the selection keep their
  formatting.
- **Line spacing** — Single / 1.15 / 1.5 / Double per paragraph, like Docs'
  line-spacing menu, on top of the global setting in Settings → Editor.
- **Subscript & superscript** buttons next to strikethrough.
- **Undo / Redo buttons** leftmost on the toolbar (they were shortcut-only).
- **Live word count** for the open chapter at the toolbar's end (desktop).
- Everything routes through the editor's native undo stack and lands in
  History like normal typing.

### Settings, redesigned (Raycast-style)

- **New shell**: a sidebar with a **working settings search** (type to match
  tabs *and* individual settings — clicking a result jumps straight to its
  tab), a profile/account row, and icon-tile navigation grouped into
  separated blocks. Content renders as **rounded row-cards** — label and a
  small description on the left, the control on the right, hairline
  separators between rows — in a centred column.
- **Mobile**: the same cards full-width, a search field under the header, an
  icon-tile tab strip, and rows that wrap so controls drop below their labels
  on narrow screens. All of it plain CSS on theme variables — no new
  libraries, nothing running at rest.
- **Startup merged into General** (a select instead of a whole tab), profile
  editing lives in General too, and the tab count drops by one.
- **New settings, all live-wired** (no dead toggles): **Interface scale**
  (90 / 100 / 110% — scales the whole app), **Editor text size** (S–XL),
  **Line spacing** (tight / normal / loose), and **Default chapter sort**
  for the book screen (story order / recently edited).

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
