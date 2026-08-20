# Known issues

A maintainer's list, not a user's. Swept 2026-08-20 across all three repos —
the app, the website (`claude/audit-followups`) and the Cloud Backup extension
(`cloud-backup-plus-revamp`) — and worked through in the same session.

Everything here was reproduced, not inferred, and every fix is verified the same
way it was found. All twenty-four are closed. Four of them — #16 to #19 — were
found while closing the others, which is the usual way.

#20 to #24 came in later, from one screenshot and the two lines sent with it.
Three of the five were invisible in the dark default, which is where everything
gets looked at, and two of the five could not happen on a desktop at all.

There is a section at the bottom of things that **look** like bugs and are not.
That is the half of a list like this that stops getting re-investigated every
few months.

| | issue | where | state |
|---|---|---|---|
| 1 | A `command` contribution navigated to `undefined` | app | **fixed** |
| 2 | `bookActions` / `chapterActions` validated, never rendered | app | **fixed** |
| 3 | `tier: "premium"` meant Cloud Backup would not run on a free build | extension | **fixed** — free for now |
| 4 | `suffix` and `collapsed` accepted and ignored | app | **fixed** |
| 5 | No `## 1.1.20-beta.0` in CHANGELOG.md; a release cannot be cut | app | **fixed** |
| 6 | `extensionInstall.js` was a second, unused installer | app | **fixed** |
| 7 | `validateWidgets` had no caller | app | **fixed** |
| 8 | `check:csp` could not run at all | website | **fixed** |
| 9 | A deploy without `VITE_GATE_API` silently narrowed the CSP | website | **fixed** |
| 10 | 624 kB single client chunk | website | **fixed** |
| 11 | (extension — no fix on that side; see 1–4) | extension | — |
| 12 | A host could pass validation and make the extension unstartable | app | **fixed** |
| 13 | No IPv6 origin could ever be granted | app | **fixed** |
| 14 | Worker flow tokens were not actually single-use | website | **fixed** |
| 15 | Two auth routes had no rate limit | website | **fixed** |
| 16 | An update replaced a running extension's files underneath it | app | **fixed** |
| 17 | Backgrounding the app could cost the last word typed | app | **fixed** |
| 18 | `save-book-bytes` wrote to any path over Electron IPC | app | **fixed** |
| 19 | `extbk check` could not read what `extbk build` writes | cli | **fixed** |
| 20 | Overlay panels never followed the theme | app | **fixed** |
| 21 | `${COLORS.warning}1e` is not a colour; 11 sites painted nothing | app | **fixed** |
| 22 | The install panel covered the question it was waiting on | app | **fixed** |
| 23 | Seven taps on the version could not be performed on a phone | app | **fixed** |
| 24 | A tapped `.extbk` did nothing | app | **fixed** |

---

## Resolved by decision

### 3. `tier: "premium"` meant Cloud Backup never activated on a free build

The loader honours the tier, so it installed, sat greyed in the list, and ran
nothing — indistinguishable from broken on any build without Pro.

**Free for now**, at the owner's decision. One word in the extension's
manifest.

### 5. `CHANGELOG.md` had no section for the current version

The release job builds its body from the matching `## <version>` section and
hard-fails without one, and ordinary CI never notices because the check is
gated on a tag or a release dispatch.

**Written**, from the commits, at the owner's request. Consequences rather than
mechanism, and deliberately silent about anything not shipping in it.

### 6. `extensionInstall.js` was a second, unused implementation

Rather than delete it and lose what it knew, the live path was checked against
all 27 of its assertions.

Most already held — verify-before-write, permission prompting, carried and
dropped grants, the unasked-vs-refused distinction. Onboarding is absent and
correctly so: the spec marks it **[later]**. The id-mismatch rule has nothing
to protect, because the live design has no "update this extension" verb; there
is one "install this file" door and the package's own manifest names what it
is.

One was real, and is #16 below. Then the module went, because 27 tests of code
nothing runs is worse than no tests — it reads as coverage of installing, and
installs do not go through it.

### 16. An update replaced a running extension's files underneath it

Found while doing the above. The directory was overwritten while the old
version was still live: its frame executing modules loaded from files that no
longer said what they had said, its hooks still registered. `refresh()`
converged afterwards, so the window was short rather than absent.

**Fixed**: the running copy is stopped first, and one that will not stop is
logged rather than allowed to fail the update — the files still land and
`refresh()` re-activates either way. Tested through the real install path
against the filesystem harness `epkInstall.test.js` already had.

### 17. Backgrounding the app could cost the last word typed

Not from #6 — from checking CLAUDE.md's three "things that must stay true"
against the code. The other two hold. This one did not.

Typing is debounced 400 ms into the sessions array, and everything that flushed
it early was something happening inside the app: a blur, a chapter change, an
unmount. None of those fire when somebody presses home mid-sentence, and on
Android the WebView can be reclaimed after that without another line of JS
running.

**Fixed** in `utils/flushOnHide.js` — `visibilitychange` while the page is
still alive, `pagehide` as best effort for a hard close. In its own file
because App.js cannot be mounted in jsdom without standing up the whole
application, which is how a rule this small ends up with no test at all.

## Fixed

### 1. A contribution that targeted a `command` navigated to `undefined`

The validator has always accepted three targets:

```js
const TARGETS = ['page', 'command', 'panel'];
```

and every screen that drew a contribution called `navigate(ext, item.page)`. A
contribution declaring a command has no page, so it was navigated to
`undefined` — a blank page from a button whose whole purpose was to do
something. Cloud Backup's headline action, "Back up now", is exactly that
shape, and so is the example in the spec's own §4.

**Fixed** with one `runContribution(ext, item, session)` in `ExtensionContext`,
used by every surface. It runs a page, a command or a panel, tells the person
when the extension is not running instead of appearing to do nothing, and
passes the command's own error text through when one fails. It lives in the
context for the same reason the `when` filter does: four surfaces draw
contributions, and a rule each has to remember separately had been forgotten by
all four.

### 2. `contributes.bookActions` and `chapterActions` were validated and never rendered

Three names disagreed — the spec documents `bookActions` and `chapterActions`,
the validator accepts both, and the app read `bookDashboard`, a v1 name not in
the validator's list at all. So the slot that worked drew an "unknown
contribution slot" warning on its way to working, and the slot the spec
documents validated cleanly and rendered nothing.

**Fixed**: `useBookDashboardExtensions` reads all three. `bookDashboard` stays
because v1 extensions are installed and use it, and breaking them to tidy a
name is not a trade worth making.

### 4. `suffix` and `collapsed` were accepted by the schema and drawn by nothing

`"suffix": "minutes"` on a number control was dropped, so Cloud Backup's row
read "Check every [30]" — a number with no idea what it counts. A section's
`"collapsed": true` was ignored, so "Advanced" was always open.

**Fixed**: both render. A collapsed section is a real disclosure with
`aria-expanded`; an ordinary one stays open and is not a button.

### 7. `validateWidgets` had no caller

A widget declaring a one-minute refresh (there is a 30-minute floor), a typeface
no `RemoteViews` can name, or an update over the ~1 MB Binder cap installed
cleanly and failed silently on a device — which is the exact class of thing
`widgetTemplates.js` was written to catch at build time.

**Fixed**: `validateManifestV2` calls it. Still no live consequence, because the
`widgets` contribution is **[later]** and nothing renders one yet — but the day
they ship, this is already on.

### 8. `npm run check:csp` could not run

```js
executablePath: process.env.CHROMIUM_PATH || undefined
```

`undefined` sends playwright-core to its own download directory, which an image
setting `PLAYWRIGHT_BROWSERS_PATH` does not have. The app repo fixed this in
`scripts/chromium.mjs`, whose header says the part that matters: *that is not a
check failing, it is a check not running, and it exits the same way either way
if nobody is reading.*

**Fixed**: `chromium.mjs` ported across. The check runs — nine routes under the
shipped policy, no violations.

### 9. A deploy with `VITE_GATE_API` unset silently narrowed the CSP

Unset, the build writes `connect-src 'self'`, logs one line and exits 0. Right
for a local build; wrong for a deployed one, where the site comes up looking
perfect and every call to its own gate is blocked by its own policy.

**Fixed**: `npm run deploy` refuses without it, and refuses a wildcard or a
non-https value. `npm run build` still works with nothing set, because that is
how everyone builds. `ALLOW_NO_GATE=1` deploys a gateless site on purpose.

### 10. The client bundle was 624 kB in one chunk

**Fixed**: the docs are lazy-loaded behind their own route. 624 → 477 kB
(182 → 139 kB gzipped), with 148 kB of docs fetched only on `/docs`.

### 12. A host could pass validation and then make the extension unstartable

`hostProblem` validated a **parsed** URL and every caller kept the **raw**
string. The WHATWG parser is lenient exactly where the CSP charset is not:

| host | old `hostProblem` | `new URL(h).origin` | building the policy |
|---|---|---|---|
| `https://a\nb` | accepted | `https://ab` | **threw** |
| `https://a"` | accepted | `https://a"` | **threw** |
| `https://[::1]` | accepted | `https://[::1]` | **threw** |

The newline case is the clearest: the parser *strips* it, so the string was
validated as `https://ab` and then stored and written into the policy with the
newline still in it. The throw happened inside frame construction, so
`activateExtension` caught it and logged "did not activate" — a silently dead
extension with a manifest that passed every check.

**Fixed** in two parts. A host must now equal its own origin, which closes the
whole family of inputs the parser silently repairs. And `hostProblem` and
`assertPolicySafe` share one character list (`POLICY_UNSAFE`) rather than
keeping two that have to agree — two charsets written down twice is a bug
waiting for the input that tells them apart, and `"` was that input.

### 13. No IPv6 origin could ever be granted

`assertPolicySafe`'s allowlist had no brackets, and an IPv6 origin cannot be
written without them. Somebody serving WebDAV at `https://[::1]` could type it
into the host-grant prompt, be told yes, see it listed as approved, and watch
the extension stop starting.

**Fixed**: `[` and `]` are in the shared list. A CSP source expression allows
them; only this did not.

### 14. The worker's single-use flow tokens were not single-use

`takeFlow` did SELECT then DELETE in two statements, so concurrent requests
with the same token could both read the row before either removed it — against
the comment directly above it.

**Fixed**: one `DELETE … WHERE id = ?1 AND kind = ?2 RETURNING payload,
expires_at`. The row is its own lock. Same shape `throttle.js` already used.

### 15. Two auth routes had no rate limit

`GET /v1/auth/google/callback` and `POST /v1/auth/google/finish` were the only
routes both unauthenticated and unthrottled, and `finish` exchanges a handoff
for a session token. Not exploitable — 32 random bytes, hashed at rest, single
use, dead in 60 seconds — but every other auth route is throttled and
`throttle.js` opens by saying a limiter only some handlers call is not a
limiter.

**Fixed**: both throttled, generously, since the callback is a browser landing
from Google and a shared address is normal.

### 18. `save-book-bytes` wrote to whatever path it was handed

`delete-book-file` checks the extension before it unlinks; the comment above
it says the renderer never needs to remove anything else, so anything else is
refused outright. The write handler beside it had no such check.

That asymmetry is the finding. Overwriting an arbitrary file is at least as
destructive as removing a book, and the door was wider.

**Fixed**: the same one-line guard. It costs nothing — the handler has exactly
one caller and it passes `session.filePath`, which `storage.js` builds with an
`.authbook` extension — so anything that trips it was a bug on its way to
overwriting something somebody cared about.

The rest of the Electron main process holds up: `nodeIntegration` off, context
isolation on, navigation guarded, and `openExternal` refusing anything that is
not https on both the IPC handler and the window-open path.

### 19. The CLI could not validate its own output

`extbk build` writes VCHS-EPK for an `apiVersion: 2` extension and VCHS-ECS
for everything else — it has branched on that since v2 shipped. `extbk check`
and `extbk info` read every file as ECS:

```
$ extbk build ./cloud-backup
✔ Built cloud-backup-2.0.0.extbk — 51.3 KB  (VCHS-EPK)

$ extbk check cloud-backup-2.0.0.extbk
  x Invalid magic bytes — not an .extbk file
```

An author's loop is build, check, ship. The middle step told them their own
package was broken — and it was not: the app reads it, the manifest is intact,
`index.js` is there.

**Fixed**: both commands detect the format and route to the matching reader.
The ECS path is untouched and still verified against a freshly built v1
package.

Found while packaging Cloud Backup 2.0.0 for release — which is the only way
it could have been found, because nothing else in the toolchain runs `check`
on a v2 build.


### 20. Frosted panels were the last thing in the app not following the theme

v1.1.16 repointed the DesignSystem's text, surface and border tokens at the
`--ds-*` variables `applyTheme` writes, so the whole system would follow the
active theme. The grounds those tokens are read *on* were left as literals:

```
FrostedModal   background: 'rgba(20,20,26,0.82)'
BottomSheet    background: 'rgba(22,22,28,0.96)'
Toast          background: 'rgba(26,27,30,0.92)'
```

On Sepia or Paper that is `--ds-text-primary` — near-black — on a near-black
sheet. `tokens.js` still carries the comment *"Text — follow the active theme
(THIS is the white-on-light fix)"* directly above the line that fixed the text
half. The panels were simply not part of that pass.

Invisible in the dark default, which is where everything gets looked at.

**Fixed**: `ThemeBase` derives `--ds-panel`, `--ds-sheet` and `--ds-toast` from
the theme's own modal ground, and the white-alpha tints painted on them
(`--ds-tint*`) flip to black on a light theme — "lighter than what is
underneath" is the intent, and white-over-cream is not lighter, it is gone.

### 21. Appending a hex alpha to a token stopped working in the same release

`${COLORS.danger}1a` is fine while `COLORS.danger` is `'#ed4245'`. Once it is
`'var(--ds-danger, #ed4245)'` the result is `var(--ds-danger, #ed4245)1a`,
which is not a colour, so the declaration is dropped and the element paints
nothing.

Eleven sites: every `Badge` and `Pill` variant, the danger and success
`Button` fills, and the "worth a look" chip on the permission sheet — which is
why that chip read as stray orange text beside the title rather than as a
badge. It had been transparent since v1.1.16 and nothing errored.

**Fixed**: the alpha is applied in `ThemeBase`, where the value is still a hex,
and arrives as a finished token (`dangerSoft` / `dangerLine` / `dangerFill`).
`COLORS.indigo` and `COLORS.sky` are still literals and their concatenations
are still valid, so those are left alone.

### 22. The install panel sat on top of the question it was waiting for

The installer stops mid-install to ask about permissions and awaits the answer.
The sheet that asks is bottom-anchored; so is `InstallSheet`, at z-index 3000
against the sheet's 300. So the question arrived underneath a progress panel.

The panel also had no entry for the `permissions` stage in either of its
tables — the stage is emitted by the installer and is not in `installEvents`'
documented list either — so its title stayed "Installing…" while the sheet
underneath said the extension was already installed, and its progress bar fell
to the 0.1 default and ran backwards from 90% to 10% while somebody read the
question.

**Fixed**: the panel steps aside for that stage. Nothing is lost — the event is
kept and the panel returns with the next stage — and the contradiction goes
with it.

### 23. The seven taps could not be performed on a phone

`devMode.js` is correct: a counter, a three-second window, a countdown that
stays quiet for the first four taps. It had never run.

The version line that receives the taps was rendered inside the desktop sidebar
branch of `Settings`, and the portrait branch has no sidebar. On a phone — every
Android install — there was no version to tap, and developer options were
unreachable by the only route to them.

**Fixed**: the line is built once and rendered in both layouts, so the two
cannot drift again. The new tests fail against the old layout, 4 of 5.

### 24. A tapped `.extbk` did nothing at all

Two halves, and either alone is fatal.

The manifest matched on names: a `mimeType` only we would have registered, or a
`pathPattern` ending in `.extbk`. A file handed over by Downloads, Files or
Drive has neither — the URI is an opaque row id and the type is
`application/octet-stream`, because Android has no mapping for our extensions.
So AuthNo was never offered in the chooser.

And `MainActivity` asked the same question three times, once per handler:
`uriStr.endsWith(".extbk")`. A content URI does not end in anything. Every
test failed, every handler returned early, and the app opened on the home
screen as if nothing had been tapped. No error, nowhere to look.

**Fixed**: the name is in the provider under `OpenableColumns.DISPLAY_NAME`,
and failing that the bytes say it themselves — both containers open with a
magic number. That decision is now one pure function, `OpenedFile.kindOf`,
with no Android imports, so it can be compiled and exercised without the SDK.

The manifest accepts `application/octet-stream`. One filter, not three: that is
every unnamed binary on the device, and appearing three times in that chooser
would be three times the noise for the same file. Routing happens where the
name and the bytes are both available, and anything that is not ours is
recognised as not ours before it reaches the WebView.

Not verified on a device — Gradle needs `dl.google.com`. It has the javac
syntax pass and the fourteen-case `OpenedFile` check, and nothing more.

---


## Checked, and NOT bugs

Recording these because each cost real time to rule out.

- **`entry` is absent from the extension manifest.** It defaults to `index.js`
  (`extensionRunnerV2.js:52`), which the extension has.
- **`authno.library.exportAs` is not in the app's method table.** The frame API
  maps it to the `library.export` wire method (`sandboxProtocol.js:326`).
- **`chapter.titles` / `chapter.preview` / `chapter.synopsis` have no frame API
  method.** They are not methods — they are permission names for opt-in extras
  on `library.list` (`LIST_EXTRAS` in `extensionLibraryV2.js`).
- **`auth.disconnect` is declared and never invoked from the manifest.** It is
  registered at runtime (`index.js:398`) and reached from the extension's own
  settings page.
- **Four components look unmounted** to a naive grep for `from './Component'`.
  `ExtensionPanel`, `ExtensionDots`, `ExtensionPromptDialog` and
  `PermissionRequestSheet` are all rendered by `src/App.js`.
- **An uncaught `SecurityError` reading `localStorage` inside the sandboxed
  frame.** That is Playwright — `addInitScript` runs in *every* frame.
- **`TODO` appears eleven times in `src/`.** All of them are the app's own TODO
  *feature*, not code markers.
- **`bookImport`, `bookScan`, `materialYou`, `themePicker`, `pkce`,
  `epkCorpus` look orphaned.** They are reached through dynamic `import()` or
  from scripts, which a `from|require` grep misses.
- **The rescue path.** `rescue.js` detects the quota-degraded
  `{id,title,filePath}` mirror and refuses to hand over a blank export.
  `AccessGate` renders "Export my books" with no `disabled`, and the cooldown
  branch renders a status line rather than returning early — the hatch is open
  precisely when it is needed.
- **Every `PendingIntent` sets `FLAG_IMMUTABLE`**, and the request-code scheme
  is bounded and does not overlap.
- **All four widgets declare `updatePeriodMillis="1800000"`** — exactly the
  30-minute floor.
- **The extension's OAuth uses PKCE (S256) and checks `state`.**
- **`verifyPassword`** compares with an XOR loop, stores a per-user iteration
  count, and throws on a corrupt record rather than reporting it as a wrong
  password.
- **The sign-in throttle limits per address AND per account**, counts only
  failures, and keys on the attempted username whether or not it exists — so it
  is not an enumeration oracle.
- **The extension's upload queue honours its own backoff.**
- **20,000 fuzzed inputs** against `parseWhen`, `whenAllows`, `coerceValue` and
  `validateSchema` produced no wrong-typed throw, no non-boolean, no bad return
  shape and nothing slower than a millisecond — including 10,000-deep paren
  nesting, a self-referential schema, and a 5,000-control schema.

---

## The tools this produced

- `npm run fuzz:parsers` — the contract fuzzer. Found #12 and #13. Now green,
  so it can go into `check:all` whenever you like.
- `node scripts/check-extension-manifest.mjs <manifest.json>` — runs the app's
  real validators against a real extension manifest. Found #1, #2 and #4. Both
  repos were checked in isolation before this existed, so "the manifest is
  valid" and "the app renders it" had never been the same statement.
- `npm run check:boot` — boots the built app in a browser and fails on anything
  uncaught. Already in `check:all`.
- `node scripts/shot-components.mjs <dir>` — draws the real components in a real
  browser, in the dark default and again under the shipped Sepia theme. The
  light pass is built from the theme through the same `themeVars()` the app
  calls, not a transcribed palette. Found #20 and #21, which no dark-only
  screenshot can show.
- `npm run check:theme-tokens` — both shapes of the token bug: alpha appended to
  a `var()`, and a hardcoded neutral panel ground under themed text. Checked
  against the pre-fix source, where it reports all three sites. In `check:all`.
- `npm run check:opened-file` — compiles `OpenedFile.java` on its own and runs
  fourteen cases through it. It is the one piece of the Android source that can
  be exercised in an environment with no SDK, which is why the decision was
  moved there. In `check:all`.
