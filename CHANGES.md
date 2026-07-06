# Authno v1.1.16 — Changes

This release fixes every issue identified in the two-part bug audit
(`authno-bug-audit-v2.md` + `authno-bug-audit-v2-addendum.md`) and adds the
requested new features. Each entry is tagged with its audit ID.

Verified end-to-end: the React app builds cleanly (`react-scripts build`
succeeds), the Reed-Solomon test suite passes under Jest (5/5), and the CLI
builds `.extbk`/`.thmbk` files that the app decodes and repairs.

---

## 1. Data safety — file formats (the highest-stakes fixes)

- **Reed-Solomon codec, rewritten and proven** *(2A, A1, A2)* — The three
  divergent hand-rolled RS implementations (`src/utils/rs.js`,
  `extensions/extbk-cli/src/rs.js`, and the inline codec in `authbook.js`) all
  failed to recover even a single corrupted byte, and the `.authbook` one
  returned **wrong bytes while reporting success**. All RS math now lives in one
  verified codec, `src/utils/reedSolomon.js` (classic syndromes →
  Berlekamp–Massey → Chien → Forney), covered by `src/utils/rs.test.js`
  (round-trip + fail-closed suite, run in CI). Decode **fails closed**: it never
  returns data that doesn't re-verify. Parity output is byte-identical to the
  old encoder, so existing files gain working recovery with no format change.
- **`.extbk` parity math fixed** *(A1, 5B)* — `nParityBytes` is now the
  per-chunk parity count (capped at 127), matching the CLI exactly. The old
  per-section formula threw `RS block too large` on any section over ~160 bytes,
  so most real extensions couldn't be packed.
- **`.authbook` triple-redundancy now actually recovers** *(N2)* — the anchor
  and tail each carry full copies of META/STRK/MNFT **and** the section index;
  these are now parsed and used to reconstruct a primary section (or the whole
  index) that fails both CRC and RS. Previously only a 4-byte CRC was read from
  the copies and the elaborate redundancy provided almost no real recovery.
- **Section-index integrity added** *(new — found via byte-sweep testing)* —
  format bumped to **v2**; the header now stores a CRC-16 of the section index,
  and a corrupt index is rebuilt from the recovery copy. Before this, a single
  flipped byte in the index silently mis-sliced every payload with no warning.
  A 2,000-position single-byte-flip sweep now shows **zero silent corruption**.
- **Recovery-vote bug fixed** *(N9)* — `_majorityVote` returned a string vs a
  number, so the "front was corrupt" branch fired on every mismatch. Now
  compares numerically and labels status correctly.
- **`detectFormat` hardened** *(2E)* — skips a UTF-8 BOM and any leading
  whitespace before `{`, so hand-edited / cross-platform legacy JSON isn't
  misclassified.
- **EPUB export fixed** *(2G)* — the central-directory record was 2 bytes short
  (44 vs the mandatory 46), producing malformed EPUBs that strict readers
  rejected. Also: all interpolated fields are XML-escaped and void elements are
  self-closed, so titles containing `&`/`<` no longer break the file.
- **Web save no longer fakes success** — on plain web, `saveBook` returned
  `{success:true}` without writing anything; it now triggers a real `.authbook`
  download.
- **Cover images downscaled before embedding** *(2F)* — covers over 1200px are
  re-encoded to JPEG so they don't bloat the `.authbook` META and its RS parity.
- **base64 encoding de-quadraticised** — the per-byte `String.fromCharCode`
  loops in `authbook.js`/`storage.js` (run on every save) are now chunked,
  eliminating multi-second UI stalls on large books.

## 2. Data loss & crashes

- **Reorder-under-search no longer deletes books** *(2B)* — the sidebar reorders
  the full list by id instead of overwriting state with the search-filtered
  subset.
- **Corrupt settings no longer white-screen the app** *(2C)* — all
  `JSON.parse(localStorage…)` reads go through a safe-parse-with-defaults helper.
- **Cover images stripped from the localStorage mirror** *(N8)* — covers live in
  the `.authbook` on disk; keeping their base64 in the `offlineWriterSessions` /
  `openBooks` mirror could exceed the ~5 MB quota and silently kill all
  persistence. Persist is now quota-safe (fails soft).
- **Lossy reload button removed** *(2D)*; the Electron restore path only asks to
  restore books that actually exist on disk, and unsaved drafts are no longer
  reported as "missing" *(2B)*.
- **Duplicate `style` props merged** *(4A)* — three elements in `App.js` (editor
  div, title input, `<main>`, bottom bar) silently dropped their first style
  object, breaking editor min-height/padding/scroll and the fixed bar. Merged.
- **Electron file-open listener leak fixed** — the `onOpenAuthBook` effect
  re-registered on every keystroke with a no-op cleanup, producing duplicate
  books on open. Now registered once with a proper unsubscribe.

## 3. Themes (finishing the migration → enabling `.thmbk`)

- **Theme selection now persists** *(N1)* — the picker writes `authno_theme_id`
  (the key the boot path reads); previously nothing wrote it, so every restart
  reverted to Dark.
- **Light/dark owned solely by the theme engine** *(B2)* — the competing
  `settings.lightMode` class and the legacy `.light-mode` `!important` override
  block in `index.css` (~51 lines) were removed. `applyTheme` toggles
  `.light-mode` from `theme.meta.isDark`, and the body background is themed.
- **BookDashboard, HomeScreen, Sidebar, Onboarding, CustomizationSlider,
  BurgerMenu, FormatButton migrated to CSS variables** *(B1, N3, 4F, 4G)* — the
  binary `useLightMode()` + hardcoded-hex approach meant Sepia/Paper/OLED
  rendered with the wrong colours; every surface now reads `var(--…)`, so all
  five themes (and `.thmbk`) apply correctly. Onboarding uses a scoped
  variable-shim stylesheet.
- **Accent override applied globally** — `applyAccent()` writes a variable
  override so the custom accent reaches every `var(--accent)` consumer, not just
  prop-drilled components.
- **Grain background fixed** *(B3, "bad texture backgrounds")* — prop contract
  reconciled with the themes; the noise baseline bug (which peppered the screen
  with dark specks under multiply blending) fixed; canvas renders at device
  resolution instead of being stretched.
- **Idle gradient blobs stop when hidden** *(B4)*.
- **`.thmbk` downloadable themes shipped** *(B5, U4)* — new
  `src/utils/thmbkFormat.js` (same VCHS-ECS container as `.extbk`),
  `themeLoader.js` (install/discover/remove, Android + web dev store),
  `theme/registry.js` (built-ins + installed themes, reactive). Themes install
  via file-open intent or the Settings "Install a theme (.thmbk)" button and
  appear live in the picker. Partial themes merge over `DARK_DEFAULT`.

## 4. Extensions

- **Install/update animation** *(C1, C2, U5)* — new `installEvents.js` bus +
  `InstallSheet.jsx`: an animated bottom sheet that walks Validating → Reading →
  Installing files (with progress) → Activating → success/❌, distinguishes
  install vs **update** ("v1.2 → v1.3"), and surfaces failures. First real
  consumer of the DesignSystem ProgressBar.
- **Chapter tokens fixed** *(N4)* — `{chapterTitle}` / `{chapterContent}` now
  resolve the chapter object from `session.chapters` (they were reading
  `.title`/`.content` off a numeric index, so the flagship "publish this
  chapter" example always sent empty strings).
- **Unified uninstall** *(A3)* — deletes route through the context's
  `uninstall()` (deactivates hooks, one code path) instead of a duplicated
  `rmdir` that skipped deactivation and wrote to the wrong store on web.
- **Extension tab: loading + empty states + "Install from file"** — the tab
  rendered `null` with zero extensions; it now shows an empty state and lets you
  install a `.extbk` directly (Android and web).
- **Generic host API** *(N7)* — `window.AuthnoHostAPI` added alongside the
  existing (preserved) `CloudBackupAPI` so any `ui-file` extension has a clean
  surface. Cloud-backup names are kept verbatim for compatibility.
- **`{externalId}` implemented** *(U9)* — extensions can associate a book with a
  remote id (`setBookExternalId`), persisted in the `.authbook` META and exposed
  as `{externalId}`.
- **Emoji-icon matching normalised** *(A6)* — variation selectors / ZWJ stripped
  so `⚙️` and `⚙` resolve to the same icon.
- **In-app browser hardened** *(N5)* — the static `@capacitor/browser` import
  (which rejected on device because it was never synced) is replaced by the
  native `OAuthPlugin` with a lazy Browser / `window.open` fallback.
- **Dead `@keyframes spin` removed** *(N18)*.

## 5. Security

- **Path-traversal guard on the extension file server** *(3B)* —
  `MainActivity.shouldInterceptRequest` now canonicalises the resolved path and
  rejects anything outside the extensions root (`../` escapes could read
  app-private files over the WebView origin).
- **Committed release keystore removed** *(3C)* — `authno-release.jks` deleted
  from the tree and added to `.gitignore` (provide it via `KEYSTORE_PATH` / the
  CI secret). **Action for you:** rotate the key if it was ever pushed, and
  scrub it from git history (`git filter-repo`).
- **Safe JS injection** *(3E)* — every value passed to `evaluateJavascript`
  (OAuth URLs, book ids, file bytes, errors) uses `JSONObject.quote()` instead
  of single-quote-only escaping; large books signal via a pending-intent path
  rather than a multi-MB string.
- **Extension credentials obfuscated at rest** *(N6)* — configs are XOR-
  obfuscated with a per-install key (reads fall back to legacy plaintext). This
  is obfuscation, not encryption — the misleading "stored securely" doc wording
  was corrected.
- **Auth secrets never interpolated into URLs** *(A7)* — password/auth-typed
  config fields are excluded from URL/query substitution; they travel only via
  the configured auth header.
- **Debug signing** *(3D)* — kept intentionally (release-key signing + base
  applicationId) for the Google Drive OAuth testing environment, per your
  decision, but now guarded so a missing keystore falls back to debug signing
  instead of failing the build. Documented inline.

## 6. Desktop (Windows / Linux)

- **Desktop builds restored to CI** *(D1)* — added `build-desktop-windows`
  (`dist:win`) and `build-desktop-linux` (`dist:linux`) jobs; their artifacts
  are attached to releases. This is the direct cause of "can only compile
  Android" — there was no desktop job.
- **Electron reads the binary `.authbook` format** *(D2)* — `main.js` used
  `JSON.parse` on files that are binary VCHS-ECS, so desktop open was broken. It
  now reads bytes and hands the renderer base64, decoded through the same path
  as Android (binary + RS repair). Cold-start file open via `process.argv`
  implemented (double-clicking a book while the app is closed now works).
- **`public/` packaged** *(D2)* — added to `build.files` + `extraResources` and
  `main.js` resolves splash/icon from either location, fixing the broken
  packaged splash screen and window icon.
- **`.extbk`/`.thmbk` desktop file associations** added; output dir aligned to
  `dist-electron` to match CI.
- Real `react-scripts build` **succeeds** with these changes.

## 7. Android native

- **Missing plugins synced** *(N5)* — `@capacitor/app`, `browser`, `haptics`,
  `preferences`, `keyboard` are now declared in `package.json` and present in
  `capacitor.plugins.json` / `capacitor.settings.gradle` /
  `capacitor.build.gradle`. Previously they were imported but never synced, so
  haptics, preferences, hardware-back and the extension browser silently no-op'd
  on device.
- **`.thmbk` intent handling** *(U4)* — `handleThmbkIntent` + manifest filters;
  `pickFile` added to `FilePickerPlugin` for manual `.extbk`/`.thmbk` installs;
  pending-intent now carries a `kind` (extension vs theme). Manifest also gains
  dotted-filename `pathPattern` variants so `my.book.v2.authbook` opens.
- **Theme-aware widget** *(N15)* — the streak widget received the app theme's
  `isDark` flag and selects a light or dark palette instead of always dark.

## 8. Editor & UI

- **Insert menu is real** *(U3)* — the "coming soon" button is now a dropdown:
  scene break, divider, em dash, ellipsis, today's date.
- **Formatting shortcuts scoped to the editor** *(4C)* — Ctrl+B/I/U/H only fire
  when focus is inside the editor, so they no longer hijack the title/search
  fields. Ctrl+S still saves globally.
- **Editor caret/undo preserved** *(4B)* — `innerHTML` is only reassigned when
  it actually differs, instead of on every dependency change.
- **Delete modal is React + themed** *(4H)* — the raw `document.createElement` +
  `innerHTML` dialog was replaced with a themed React modal closable via
  Escape/backdrop.
- **Sidebar drag-autoscroll fixed** — it scrolled the non-scrolling `<aside>`;
  now targets the actual list container.
- **Streak badge shows the current streak** *(N16)* — a live short streak was
  hidden behind an expired longer "best"; current and best are tracked
  separately.
- **Author parsing + ISBN hint** *(N19)* — authors split on `;` when present so
  "Smith, Jr." survives; a light ISBN-format hint is shown.

## 9. New features

- **PDF export** *(U1)* — `exportAsPdf` (pdf-lib): title page + wrapped body with
  chapter headings and page numbers. The "PDF (coming soon)" tile is now live.
- **Read Aloud** *(U2)* — `readAloud.js` (Web Speech API, no dependency) +
  `ReadAloudBar.jsx`: play/pause, prev/next chapter, rate control, progress.
  Available from the home screen and the book dashboard. The three "Coming Soon"
  home tiles are now Read Aloud, Import a Book, and Extensions.
- **Billing / Pro (mock)** *(U10, per your instruction)* — `BillingPage.jsx`: a
  simulated checkout with **UPI** (with app-suffix helpers) and card options,
  plans, a clearly-labelled demo banner, and a success animation. Submitting
  runs a fake "processing" state then calls `unlockProMock()` to unlock Pro
  locally. **No backend or real payment gateway is wired.** Pro now actually
  gates something: premium-tier extensions require Pro to activate (they stay
  visible with an Upgrade prompt), and the entitlement is reactive.

## 10. Build hygiene & dead code

- `npm ci` (not `npm install`) across CI jobs; the stale CRA `App.test.js` was
  removed and the RS test runs in CI *(6A)*.
- Version drift fixed *(N12, 6D)* — `scripts/sync-version.js` regenerates
  `src/version.js` from `package.json` on `prestart`/`prebuild`; the app stamps
  the real version so bug reports stop claiming `1.1.10-beta.4`. `ErrorLogger`
  fallback corrected.
- `ToastContainer` mounted at root; `toast()` module-level API added *(N10)* —
  the toast system was built but never mounted, so it displayed nothing.
- Dead code removed: `EditLayoutSidebar` (unreachable "layout" view), `main0.js`,
  `extbk-cli/src/zip.js` (broken + misrepresented the format) *(N12, N13, 5A)*.
- Storyboards deferred *(N14, per your instruction)* — the "+ Storyboard" button
  and onboarding copy were removed rather than shipping a half-feature; the
  creation path routes to a normal new book.
- Package renamed to lowercase `authno`; branding/copyright updated from VCHS to
  AS Code Studios *(6B)*; `.gitignore` covers keystores, secrets, and build
  output *(6C)*.

## 11. CLI (`extbk`)

- Uses the shared verified RS codec; `thmbk-build` command added to pack themes
  into `.thmbk` (authors work in plain JSON) *(U4)*. Cross-compatibility proven:
  CLI-built `.extbk`/`.thmbk` decode in the app, and the app's RS recovers a
  corrupted CLI-built file.

---

### Follow-ups that need you (can't be done from the source tree)

1. **Rotate the release keystore** if it was ever pushed publicly, and remove it
   from git history (`git filter-repo --path authno-release.jks --invert-paths`).
2. **Register the debug SHA-1** in Google Cloud Console if you ever switch debug
   to standard debug signing (kept as-is for now per your note).
3. Run `npx cap sync android` once locally — the generated files are already
   updated to match, but a sync keeps them authoritative.
4. Consider replacing the `execCommand`-based editor with Lexical/TipTap in a
   future pass (deferred per your decision) — it's the last structural weakness.
