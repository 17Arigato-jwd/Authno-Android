# Changelog

All notable, user-facing changes. Dates are release dates; unreleased work sits
under the top-most version until it ships.

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
