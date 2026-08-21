# Changelog

All notable, user-facing changes. Dates are release dates; unreleased work sits
under the top-most version until it ships.

## 1.1.20-beta.1

_Things that were unreadable on a light theme, a question that arrived
underneath the panel that was waiting for it, and two things that could not be
opened at all._

### If you use a light theme

- **Dialogs, sheets and notifications follow your theme again.** Their
  backgrounds had stayed dark while the text on them followed the theme, so on
  Sepia, Paper and Light the words were near-black on a near-black panel.
- **Badges and pills have their colour back.** The small labels — "worth a
  look", "new", "beta" — and the red and green buttons had been painting no
  background at all, so a badge read as stray coloured text next to whatever
  was beside it.
- **Buttons choose a label colour that can be read on them.** A white label was
  used whatever the button was filled with, which on the Gold and Sage accents
  was close to invisible — including on the button that confirms something you
  cannot undo.
- Outline buttons, which have no fill at all, were drawn in white — on a pale
  page that is nothing at all.
- Extension settings pages use the app's own fields instead of their own, so
  they match everything around them.

### Extensions

- **The install panel gets out of the way of the question it is asking.** When
  an install stopped to ask what the extension may do, the progress panel sat
  on top of that question, still reading "Installing…" — and its progress bar
  ran backwards while you read it.
- **An extension that was never asked what it may do now says so.** One
  installed by opening a file, rather than from inside the app, could end up
  allowed to do nothing at all and with no way to tell — it ran, did nothing,
  and explained nothing. The Extensions tab now says the question was never put
  and lets you answer it.

### Opening things

- **Opening a `.extbk` from your file manager installs it.** Tapping one did
  nothing whatsoever — no error, nothing on screen, the app simply opened. It
  now works from Downloads, Files, Drive and anywhere else that hands a file
  over.
- **Developer options can be reached again**, from the version in About.

### For extension authors

- `extbk unpack` can read the packages `extbk build` writes. It refused them as
  invalid, which made looking inside somebody else's extension impossible.
- `extbk info` lists the files in a package, not only its code.

## 1.1.20-beta.0

_Extensions can finally do the things they said they could, the widgets fit
what is in them, and the app stops losing the last word you typed._

### Extensions

- **A new kind of extension, and a new package to put one in.** Bigger
  extensions than the old format could hold, and packages that survive being
  copied around — a damaged one is repaired where it can be and refused clearly
  where it cannot, instead of half-installing.
- **You are asked what an extension may do, in words, before it does it.**
  Every request comes with the author's own reason for wanting it, each one
  can be refused on its own, and saying no to all of them still installs the
  extension.
- **The Extensions tab shows what each one may do, and lets you change your
  mind.** It also says when an extension keeps asking for something you have
  not given it, so one that looks broken can explain itself.
- **Removing an extension now removes what you allowed it to do.** It used to
  leave that behind, so something installed later under the same name inherited
  every answer you had given the old one without asking again.
- **An extension's settings are drawn by AuthNo.** Authors declare the controls
  and the app renders them, so they match the rest of the app, follow your
  theme, and cannot pretend to be part of AuthNo while behaving like something
  else.
- **Extension buttons do what they say.** A button meant to run something ran
  nothing and opened a blank page instead. "Back up now" now backs up.
- **Extension actions appear where the author put them.** Three places a button
  could be added were accepted and then quietly never drawn.
- Extensions can ask you a question, and get an answer. Anything that asked one
  used to wait forever, with nothing on screen.
- Extensions can put a small panel beside your writing, and a coloured dot when
  something wants your attention. The text column keeps its width — the panel
  gets out of the way instead.
- An extension too large to open is refused with the size, rather than taking
  the app down with it.
- An extension can be told to use a server you name, and you are shown the
  address, on its own, before you agree to it.

### Widgets

- **The widgets fit what is in them.** Several asked the launcher for less room
  than their contents needed, so the bottom of a widget was simply cut off.
- **They resize when you resize them.** Dragging a widget bigger or smaller now
  changes what it shows, instead of drawing the same thing at the same size in
  a different-shaped box.
- Their proportions, spacing and type are on the same scale as the rest of the
  app, so they look like it.

### Writing

- **Pressing home mid-sentence no longer costs you the word.** Typing was
  written down a fraction of a second after you stopped, and backgrounding the
  app in that gap could lose it.

### Everywhere

- **The app opens with its own logo.** The splash was showing a stand-in.

## 1.1.19-beta.5

_Extensions work the same on a laptop as on a phone, saving tells you the
truth, and the icon you pick is the icon you get._

### Extensions

- **Sign in with Google, and reach Google Drive, from the desktop app.** Both
  were Android-only and told you so. They work on Windows and Linux now, using
  the browser you already have. Writing an extension for one platform no longer
  means writing it twice.
- **An extension's settings page can start a sign-in on its own** instead of
  handing the job to its background half first.
- **Extension pages run in a stricter sandbox.** Two of them shared a boundary
  that only one of them was actually enforcing.
- Pages loaded from the web must be served over https, and one that is not says
  so rather than loading quietly.
- Extension pages can no longer pop up a system dialog or submit a form
  straight to the web. If yours used `alert()`, it will need its own message
  instead.

### Saving

- **"Saved ✓" now means saved.** A save that AuthNo refused — because a book
  was still loading, or the file it came from had gone away — showed the same
  green tick as one that worked. If the file has gone, AuthNo now offers to put
  the book somewhere new instead of failing quietly.

### The desktop app

- **Links open in your browser again, not inside AuthNo.** A sign-in page could
  end up on the app's own window, with no address bar and no way back.
- **The app window stays the app.** Nothing can navigate it away.
- **Changing the app icon sticks on Linux.** The launcher entry stopped
  updating after the first time you picked one, which could also quietly break
  links from your browser.
- The default icon on desktop is the one the picker shows you. It was showing
  one design and applying another.

### Android

- Importing a book, an extension or a theme no longer leaves a file handle open
  when a file cannot be read to the end.

### Elsewhere

- The website explains every reason a pen name can be refused. Four of them
  produced "something went sideways on our end", which was neither true nor
  useful — the name had been refused for a reason it never mentioned.

## 1.1.19-beta.3

_A day that ends when you stop writing rather than when the clock says so, a
countdown on the home screen, and reminders worth reading._

### The writing day

- **Finish the sentence.** If you are still writing when midnight arrives, the
  day stays open — an hour at a time, up to 4am. Stop before midnight and
  midnight is the deadline, as it always was. Nothing is granted for waiting;
  it follows the writing.
- **What you write at 00:40 counts for the night you were in**, not for a day
  that is forty minutes old. The flame, the calendar, the widgets and the
  reminder all agree on which day that is.

### A countdown widget

- **How long is left of today, on your home screen.** Pick the book when you
  place it. It shows the clock, the words you have written, how many are left
  to your goal, and your streak.
- The clock is drawn by the system, so it ticks every second without AuthNo
  running and without costing battery.

### Reminders

- **Twice a day, if you want.** A morning nudge, an evening one, or both, each
  at a time you pick. Set them to the same minute and you get one.
- **They stopped repeating themselves.** The wording now varies by the time of
  day, how long your run is, how close you are to your goal, and which book you
  were last in — and it will not pretend a first day is a hundredth.
- **Send one now**, from Settings → Writing Goal, to see exactly what will
  arrive. It uses your real goal, your real streak and your real book.
- **AuthNo asks for permission when you switch reminders on**, not at launch,
  and tells you if the answer was no. If your phone is one of the ones that
  stops background alarms, there is a row that says so and a button that opens
  the right settings screen.
- **Reminders on Windows and Linux too**, not only Android.

### Fixed

- **The countdown and streak widgets showed 0 words and no streak.** They were
  reading numbers the app has never sent, on every device they were placed on.
- **The test notification announced a goal nobody had set** — it always said
  300 — and reported a first day to writers a month into a run.
- **Deleting the book you were last writing in blanked the resume widget**
  instead of falling back to the next one.
- **Word counts were wrong for Chinese, Japanese, Thai and Korean** in four
  more places, including the export screen you reach when you are locked out —
  the one that most needs to tell you the truth about what it is holding.
- **Installing a `.extbk` extension on Windows, macOS and Linux** put the files
  somewhere the app never looked, so nothing you installed appeared.
- **A blank new book no longer stacks up.** Opening the app repeatedly without
  writing produced a shelf of Untitled Books.

### Desktop

- **Sign in with Google works on Windows and Linux.** It leaves the app for
  your real browser, the same as it does on Android, and comes back when you
  are done. If your system cannot hand the app the address back, there is a box
  to paste it into rather than a button that waits forever.
- **Extensions run on desktop.** Installing one has worked for a while;
  activating it did not, on any desktop build. Extensions split across several
  files work too, both their background half and their pages.
- **No more AppImage.** Linux is `.deb` and `.rpm`. The AppImage could not
  register the app for the links Google sign-in comes back on, and shipping a
  build where a feature quietly does not work is worse than shipping one fewer
  build.

### Elsewhere

- **Your account details now look like the rest of the app** — the same card
  the About screen uses, in Settings where you would look for them.
- **Tap the version number seven times** for the developer tools, rather than
  hunting for the row.

## 1.1.19-beta.1

_Streaks become optional, the widgets get buttons that work, and there is
somewhere to put an idea before it goes._

### Streaks are optional now

- **Turn streaks off** — all of them, or one book while the rest keep counting.
  Settings → Writing Goal. Off means the days stop being counted, the flame and
  the day badge go, and the streak widget says so rather than showing a number
  that has stopped moving. Nothing already recorded is deleted; turn them back
  on and your history is where you left it.
- **A daily reminder, if you want one.** Off unless you switch it on, at a time
  you pick, and by default it stays quiet on days you have already hit your
  goal. Turning streaks off turns the reminder off with them.

### Widgets

- **The streak widget has buttons.** Start writing, add a chapter, show the next
  book, refresh. Next book and Refresh do their work on the home screen —
  they do not open the app to do it.
- **A second widget: the resume card.** The book and chapter you were last
  writing in, how many words, how long ago. Only the button opens it: brushing
  the widget while swiping between home screens no longer launches AuthNo.
- **Widgets follow your theme.** Sepia, Paper, OLED and Material You all
  rendered as plain Dark before; they render as themselves now, and follow along
  when you switch.
- **Fixed: the widgets had stopped updating.** They were not receiving anything
  from the app, so a widget showed whatever it had when it was placed.

### Notes

- **Somewhere to put an idea.** Notes are for the thought that arrives when you
  have not got time to pick a book, find the chapter and place a cursor: no
  title to invent, no folder to choose. In the menu, or Ctrl+J from anywhere.

### Very large books

- **A book over 5 MB asks before it opens**, and offers to open in preview mode
  instead: every chapter listed straight away, each one loaded when you open it.
  The choice is remembered per book.

### Fixes

- **Renaming a chapter in the editor now saves it.** The same rename from the
  book dashboard always worked, which is why this went unnoticed. Changing a
  synopsis, reordering chapters and editing a writing goal were affected the
  same way.
- **A book could be written back empty.** Under memory pressure AuthNo could
  come back believing your books had no text in them and save that over the
  real thing. It now refuses to write a book it cannot see the words for.
- **"Start blank" could open your real manuscript** instead of a blank book.
- **Reordering chapters could overwrite one chapter with another's text.**
- **Exports no longer emit blank chapters** for a book that is still loading.
- **Buttons on your accent colour are readable again.** On the paler accents —
  Gold and Sage especially — the label was white on light and effectively
  invisible.
- **Every switch in Settings can be reached from the keyboard**, and screen
  readers now announce whether one is on or off.
- **Fixed: a book or chapter with no title crashed the screen it appeared on.**
- **Fixed: the Android back button went to the wrong screen** when moving
  between two extension pages.
- **Settings → Developer can scan for books** and report what it found, what it
  could not open, and what it had to repair — useful when a book has gone
  missing. Error reports are more specific and no longer crowd each other out.

## 1.1.19-beta.0

_Signing in gets a second door, and the destructive buttons learn to ask._

### Access

- **Sign in with Google.** If your account has a Google account connected, the
  sign-in screen offers it. It opens your browser rather than a window inside
  AuthNo — that is Google's rule, and it is the right one: an app that hosts
  the login box can read what you type into it.
- **Sign up with Google**, once you have typed an invite code and picked a pen
  name. Google fills in the email and stands in for a password. The code is
  still what admits you; a Google account on its own is not an invitation.
- **Connect Google to an account you already have**, from Settings → About.
- **None of this makes AuthNo need a network.** Signing in with Google fetches
  a key once, exactly like a password does. Every start after that verifies it
  on your device, on a plane, in a tunnel, on the day the website is down.

### Everything that cannot be undone now asks first

- Signing out asks before it does it, wherever it is offered.

## 1.1.18-beta.12

_The closed beta gets a door — and, more importantly, a way out of it.
Extensions get a working toolchain, and two long-standing display bugs go._

### Access

- **AuthNo is invite-gated.** Redeem an invite on the website and it issues a
  key file; the app checks it on your device and never asks again. The check is
  a signature, so it works on a plane, in a tunnel, and on the day the website
  is down.
- **Your key file is a password.** It's encrypted with the pen name and email it
  was issued to, so a stray copy of the file is not enough to use your
  membership. Never send it to anyone — nobody at AuthNo will ask for it.
- **Wrong tries slow down and then stop.** Two mistakes cost nothing, then 30
  seconds, then five minutes, then AuthNo closes. The counter survives a
  restart, so quitting doesn't reset it.
- **Sign out, and sign in as someone else.** Settings → About now has a sign-out
  button, for handing a shared machine to another writer.
- **“Export my books” on the sign-in screen.** Locked out for any reason — key
  lost, signed out, invite revoked — and your manuscripts still come out, as
  TXT, HTML, EPUB or PDF. No key, no account, no network, and no cooldown: the
  sign-in rate limit does not apply to getting your own work back. Books that
  aren't listed can be opened straight off disk. Nothing on this path writes or
  deletes anything.

### Extensions

- **`minAppVersion` is now enforced.** It was accepted by the manifest and then
  ignored, so an extension built against a newer AuthNo installed cleanly and
  failed later at some arbitrary point. Extensions that need a newer build now
  say so in the list instead of half-working.
- **The extension API no longer requires impersonating Cloud Backup.** Any
  extension page can now reach the library, exports, its own config and toasts
  through the documented host bridge.
- **Extensions can react to more than saving.** Opening and closing a book,
  opening a chapter, creating or deleting a book, and finishing an export all
  notify extensions now.
- **Fixed: reinstalling an extension made it do its work twice.** Handlers from
  the previous install were never removed, so each reinstall stacked another
  copy.

### Fixes

- **The book dashboard and the flame no longer disagree about your streak.** The
  dashboard counted every day you'd written anything, while the flame counted
  only days you hit your goal — a book with fifteen partial days showed
  "Streak 15 Days" beside a flame reading 7.
- **Chapter previews no longer run paragraphs together.** Paragraph counts in
  chapter statistics were wrong for the same reason and always reported 1.

### Developer tooling

- **extbk-sandbox 2.0** now actually runs your extension. It previously
  displayed the source file as text without ever calling `activate()`.
- **extbk-cli 1.1** stops packing `node_modules` and previous builds into your
  archive, audits the manifest before writing bytes, and adds `extbk watch` and
  `extbk init`.

## 1.1.18-beta.11

_The creator's note, a friendlier welcome, and premium put on hold._

### Onboarding

- **A proper hello.** The creator's note is now written by Varchas, with a
  photo and a real hand-drawn signature — no more placeholder text.
- **Rewritten welcome screen** copy.
- **Fixed: the welcome feature cards were unreadable on light themes.** They
  used hard-coded white-on-white styling, so on Light, Paper and Sepia they
  were effectively invisible.
- The walkthrough no longer opens the upgrade screen the moment you finish
  signing up — you've just been given a 7-day trial.

### Pro

- **Purchasing is switched off for now.** Premium features show a friendly
  "this is a Premium feature — coming soon" note instead of a checkout you
  can't complete yet. Everything stays unlocked during your trial.
- Removed the "Reset to Free (testing)" button that was shipping to real users
  on the Pro screen.

## 1.1.18-beta.10

_A much more hands-on first-book walkthrough, and the features it teaches._

### New

- **Rename a chapter straight from the book screen** — a ✎ pencil on each
  chapter (and right-click → Rename on desktop). No need to open the editor
  first.
- **Set your daily writing goal right from the streak flame** — open the streak
  calendar and tap the goal to change it, per book. It's no longer buried in
  Settings.

### The "Create My First Book" walkthrough is now interactive

- **Watch your streak light up.** During the walkthrough your goal is set to a
  tiny 15 words, and the write step asks you to reach it — the moment you do,
  the flame comes alive. Your real goal is restored when you finish.
- **Threads are taught, not just mentioned.** The walkthrough opens the panel,
  shows the built-in types (and that you can make your own), then guides you to
  create your first thread step by step.
- **History is shown by doing.** The walkthrough adds an example line to your
  chapter, then walks you through opening History to see exactly what changed
  and roll it back — the example line is cleaned up automatically at the end.
- The chapter-naming step now points at the real rename control, and the whole
  flow reads as one continuous story from details → name → pace → write →
  cover → save → threads → history → export.

## 1.1.18-beta.9

_Branding, Linux packaging, and app-icon polish._

### App icons

- **Changing your app icon now updates the Linux launcher too.** Previously the
  pick only changed the window/taskbar icon; the applications menu / dash kept
  the default. AuthNo now writes a per-user launcher entry so the chosen icon
  shows everywhere, and switching back to Default restores the original.
- **The alternate app icons no longer get over-cropped on phones.** The light,
  gold and retro icons were drawn edge-to-edge, so Android's icon mask cut a
  large part of the α on some launchers. They're re-sized so the whole letter
  stays visible while keeping the "just off the edge" look.

### Branding & Linux packages

- Consistent **VCHS Studios** name across the app, copyright and package
  metadata, with a real maintainer/vendor, homepage and license on the Linux
  `.deb`/`.rpm`, and an enriched software-center (AppStream) listing.

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
