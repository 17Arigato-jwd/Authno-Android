# Extension system v2 — the spec, for review

Companion to `extension-system-v2.md`, which argues the design. This one just
**lists it**, so it can be checked item by item.

Written under the standing rule in `CLAUDE.md`: there are no users, so where v1
has the wrong shape it is replaced rather than kept alongside. Every break is
listed in §12.

Legend: **[1.1.20]** builds now · **[later]** specified, deferred. Nothing is
marked open any more — the three questions left are in §13, and every other
decision is recorded in §13a.

---

## 1. The manifest, complete

```jsonc
{
  "apiVersion": 2,                        // required; 1 is refused, not adapted
  "id": "cloud-backup",                   // [\w.-]+, no path separators, permanent
  "name": "Cloud Backup",
  "version": "2.0.0",                     // semver
  "description": "…",                     // one sentence, shown in the list
  "author": "Aurora Studios",
  "icon": "Cloud",                        // a DSIcons name, not a file
  "minAppVersion": "1.1.20-beta.0",
  "homepage": "https://…",                // optional, opened via browser perm

  "permissions": { … },                   // §2
  "contributes": { … },                   // §4
  "pages": { … },                         // §5
  "settings": { … },                      // §6
  "onboarding": { … },                    // §7   [later]
  "background": { … },                    // §8   [later]
  "commands": ["sync.now", "auth.connect"] // declared; registered at runtime
}
```

Rules:

| rule | why |
|---|---|
| `apiVersion` absent or ≠ 2 → refuse to load, name what to change | guessing a v1 extension's permissions means guessing "all", which is the thing being fixed |
| `id` is permanent and never reused | it keys storage, grants and the install directory |
| Unknown top-level keys → **warn, don't fail** | forward compatibility for v3 |
| Unknown keys *inside* `permissions` → **fail** | a typo'd permission must never silently mean "not requested" |

---

## 2. Permissions

### 2.1 Declaration

```jsonc
"permissions": {
  "library:read:all": { "reason": "To upload every book, not just the open one." },
  "library:write":    { "reason": "To restore a book you pick from the cloud." },
  "network":          { "reason": "To talk to Dropbox.",
                        "hosts": ["https://api.dropbox.com", "https://content.dropboxapi.com"] },
  "notifications":    { "reason": "To tell you when a sync fails." }
}
```

`reason` is **required**, ≤ 120 chars, shown verbatim. A build with a missing or
empty reason fails.

### 2.2 The complete set

| permission | gates | prompt line | status |
|---|---|---|---|
| `library:read:current` | `library.get` on the open book | "Read the book you have open" | **[1.1.20]** |
| `library:read:all` | `library.list`, `library.get` on any | "Read all your books" | **[1.1.20]** |
| `library:write` | `library.create`, `library.update` | "Add and change books" | **[1.1.20]** |
| `library:export` | `library.export` | "Turn your books into files" | **[1.1.20]** |
| `network` | outbound to `hosts` (CSP) | "Connect to dropbox.com, api.dropbox.com" | **[1.1.20]** |
| `browser` | `browser.open`, `auth.*` | "Open pages in your browser" | **[1.1.20]** |
| `activity` | `activity.onWriting`, `activity.getRate` | "See when you are writing" | **[1.1.20]** |
| `notifications` | `notify.post` | "Send you notifications" | **[later]** |
| `widgets` | contributes a widget | "Add widgets to your home screen" | **[later]** |
| `background` | `background` block honoured | "Run while AuthNo is closed" | **[later]** |

Not permissions, always available: `app.*`, `ui.toast`, `ui.navigate`,
`ui.prompt`, `ui.confirm`, `storage.*`, `hooks.register`, `commands.register`.
Each is either inert or already private to the extension; prompting for them
trains people to tap through prompts.

### 2.2a `activity` — and why the rate is quantised

`activity` reports writing cadence: an extension subscribes and receives
characters-per-second while the user types. It is what a writing-timer, a
pace-tracker or a streak widget needs, and none of them need anything else.

**The rate is bucketed to 1 Hz, and only the count crosses the bridge.**

Raw inter-keystroke timings are keystroke dynamics — a behavioural biometric,
identifying enough to be used for authentication, and the kind of thing that
should not leave the editor because an extension asked politely. An extension
holding `activity` **and** `network` with per-keystroke resolution could
fingerprint the person typing. One-second buckets give a timer everything it
needs and destroy the signal that makes fingerprinting work.

| what crosses | what does not |
|---|---|
| characters in the last whole second | when, within that second |
| an idle/active edge event | which keys, in what order |
| session totals, on request | backspaces distinguished from characters |

```js
authno.activity.onWriting(({ charsPerSecond, idle }) => { … })  // ~1 Hz
await authno.activity.getRate()   // { charsPerSecond, idleSeconds }
```

Delivery pauses when no extension is subscribed, so the editor pays nothing for
a permission nobody is using.

### 2.2b `ui.prompt` — host-drawn, never extension-drawn

```js
const name = await authno.ui.prompt({ title, message, placeholder, initial });
const ok   = await authno.ui.confirm({ title, message, danger: true });
```

Both resolve to `null`/`false` on dismissal, never throw on cancel, and are
**drawn by the host** in the app's own dialog style. That is the point: an
extension cannot draw a dialog that looks like it came from AuthNo, because the
only dialog that looks like AuthNo is the one AuthNo drew.

Constraints: one at a time per extension, dismissed automatically if the
extension is disabled mid-prompt, `title` ≤ 60 chars and `message` ≤ 240, and the
dialog is labelled with the extension's name and colour so its origin is never
ambiguous. No permission, because a prompt cannot read or send anything — the
user answers or does not.

### 2.3 Enforcement — where each is actually enforced

| permission | enforced by | can the extension get around it |
|---|---|---|
| every `library:*`, `browser`, `notifications` | `requirePermission()` in `dispatch` | no — it is the only door, and there is no other origin to reach |
| `activity` | `requirePermission()`, and the editor emits nothing when unsubscribed | no — and the 1 Hz bucketing is applied host-side, before the bridge |
| `network` | **the browser**, via a host-generated CSP in the frame document | no — measured: meta removal, policy injection, XHR and nested frames all blocked |
| `background` | the host scheduler; the extension has no timer of its own | no |

The CSP is built **`default-src 'none'` first, then grants** — never by naming
`connect-src`. Measured: with `connect-src 'none'` an `<img>` beacon still
reached the server; with `default-src 'none'` it did not.

Generated policy for the example above:

```
default-src 'none';
script-src 'unsafe-inline' blob:;
style-src 'unsafe-inline';
img-src data: blob:;
connect-src https://api.dropbox.com https://content.dropboxapi.com;
form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src blob:;
```

With no `network` permission, the `connect-src` and `img-src` host entries are
absent and there is **no channel out of the frame** except `postMessage`.

### 2.4 Grant lifecycle

- Asked once, after onboarding, all on one screen, each individually refusable.
- **Deny is never fatal.** The extension installs and runs inert.
- Revocable any time from the native settings page. **[1.1.20]** — revocation
  takes effect without a restart.
- An update requesting a *new* permission re-prompts for that one only.
- A revoked permission makes its capability throw `permission-denied`, which the
  extension can catch and explain.

---

## 3. The host API, complete

Renamed and namespaced. v1's flat 16 had a raw plugin path
(`native.GoogleDrive.requestDriveToken`) and three overlapping pairs.

| v2 call | permission | notes |
|---|---|---|
| `app.version()` | — | |
| `app.platform()` | — | `'android' \| 'desktop' \| 'web'` |
| `ui.toast(msg, opts)` | — | |
| `ui.navigate(pageId, ctx)` | — | within this extension only |
| `ui.close()` | — | |
| `storage.get/set/remove/keys` | — | namespaced per extension, already private |
| `storage.getJSON/setJSON` | — | the parse/stringify everyone rewrote with the same swallow-the-error bug |
| `library.list()` | `library:read:all` | metadata only — id, title, counts. **Not** chapter text |
| `library.get(id)` | `library:read:*` | full book; `:current` restricts to the open one |
| `library.create(book)` | `library:write` | |
| `library.update(id, book)` | `library:write` | |
| `library.export(id, format)` | `library:export` | `format`: `authbook \| txt \| md \| html \| docx \| epub \| pdf` |
| `browser.open(url)` | `browser` | https only |
| `browser.close()` | `browser` | Android only; a real tab is not ours to close |
| `auth.oauth({authUrl, redirect, …})` | `browser` | the portable round trip |
| `auth.google.signIn({clientId})` | `browser` | Play Services on Android, PKCE elsewhere |
| `auth.google.driveToken({clientId, scopes})` | `browser` | same split; defaults to `drive.file` |
| `notify.post({title, body})` | `notifications` | **[later]** |
| `hooks.register(name, fn)` | — | returns an unsubscribe |
| `commands.register(name, fn)` | — | targets of `command` contributions |

**`library.list()` returning metadata only is a deliberate change.** v1's
`getSessions` returned whole books, so a word-count extension had to be handed
every manuscript to count them. Splitting list from get means most extensions
never need `library:read:all` at all.

### 3.1 Removed from v1

| removed | replaced by |
|---|---|
| `getSessions` | `library.list` + `library.get` |
| `importSession` | `library.create` |
| `replaceSession` | `library.update` |
| `encodeSession` | `library.export(id, 'authbook')` |
| `exportSessionAs` | `library.export(id, format)` |
| `googleSignIn` | `auth.google.signIn` |
| `native.GoogleDrive.requestDriveToken` | `auth.google.driveToken` |
| `openBrowser` / `closeBrowser` | `browser.open` / `browser.close` |
| `toast` / `navigate` | `ui.toast` / `ui.navigate` |
| `registerHook` | `hooks.register` |

### 3.2 The rule that keeps this honest **[1.1.20]**

A CI check asserts every `case` in `dispatch` either calls `requirePermission`
or is on a short explicit free-list. Capability seventeen cannot ship ungated.

---

## 4. Contributions

```jsonc
"contributes": {
  "settings":      [{ "id": "…", "label": "…", "icon": "…", "page": "settings" }],
  "homescreen":    [{ "id": "…", "label": "…", "page": "…", "when": "…" }],
  "bookActions":   [{ "id": "…", "label": "…", "command": "sync.now" }],
  "chapterActions":[{ "id": "…", "label": "…", "command": "…" }],
  "editorToolbar": [{ "id": "…", "label": "…", "panel": "stats" }],
  "widgets":       [{ "id": "…", "label": "…", "size": "2x2" }]       // [later]
}
```

Every contribution has exactly **one** target:

| target | does |
|---|---|
| `page` | opens a full page from `pages` |
| `command` | calls a registered function — no UI |
| `panel` | docks a small surface beside the editor **[1.1.20]** — see §4a |

**This is the original bug.** v1 had only `page`, so "Back up now" opened
settings, and two of Cloud Backup's three pages were unreachable.

### 4a. Panels **[1.1.20]**

A panel is a small extension surface docked next to the editor: live word count,
a pace tracker, a scene list. It is the one contribution that shares the screen
with writing rather than replacing it, which is why it gets its own section.

**The governing constraint is that the editor wins every conflict.** A panel that
costs a writer measure, focus or a frame of typing latency has failed regardless
of what it displays.

#### 4a.1 Where it docks

| platform | dock | size |
|---|---|---|
| Desktop | right edge of the editor pane | resizable 280–480 px, persisted per extension |
| Tablet ≥ 720 dp wide | right edge | fixed 320 dp |
| Phone | **bottom sheet, never a side dock** | two detents: peek 120 dp, half 50% |

No phone is wide enough to dock a panel beside a text column and leave either
usable, so on a phone the panel is a sheet over the bottom of the editor. Same
frame, same API, different presentation — the extension does not choose and does
not need to know.

#### 4a.2 The measure floor

**The editor's text column never drops below 45 characters.** Below that, line
length stops being comfortable prose and the panel has made the app worse at its
only job.

So the panel yields, not the editor. When the window is too narrow for the panel
at its minimum width *and* the editor at 45 characters, the panel collapses to
its dot (§8b) and a toolbar button to reopen it. It does not shrink further, and
it never overlays the text column on a surface where it was docked.

#### 4a.3 Focus, which is the part that loses words

**Opening a panel does not move the caret.** The panel is inert until the user
puts focus in it deliberately, and `Esc` inside a panel returns focus to the
editor at the position it left.

A panel frame cannot call `focus()` on itself, cannot open a `ui.prompt` while
the editor has focus, and cannot be opened by the extension at all — only by the
user, through its toolbar button. An extension that could raise a panel mid-
sentence would eat the keystrokes typed into it.

This is the same instinct as the rule that signing out must not cost words: the
editor's input path is not something a feature gets to interrupt.

#### 4a.4 Update rate, and the `activity` connection

The canonical panel is live statistics, and the naive implementation subscribes
to every keystroke — which puts an extension's render on the typing path.

So: **panels never receive a per-keystroke hook.** Live data arrives on the
`activity` channel, already bucketed to 1 Hz (§2.2a), and a panel's own re-render
is throttled host-side to 4 Hz whatever it asks for. A panel that wants exact
counts calls `library.get` on an idle edge, not on every character.

| | |
|---|---|
| Fastest data feed | 1 Hz (`activity`) |
| Fastest re-render | 4 Hz, host-throttled |
| While the panel is collapsed or hidden | **no updates at all** — the frame is paused |

#### 4a.5 Lifecycle

A panel is a sandboxed frame exactly like a page, with the same CSP and the same
`dispatch` door. It is created when first opened, kept alive while docked so
switching chapters does not reset it, paused when collapsed, and destroyed when
closed or when the extension is disabled.

Only **one panel is visible at a time**. Several extensions may contribute
toolbar buttons; pressing one swaps the panel rather than stacking. Panels do not
tab, tile or float, and the last-open panel is restored on next launch.

#### 4a.6 Panels and overlay dots are one system

Both live in editor chrome, so they are specified together rather than colliding:

- A collapsed panel **is** a dot. Same colour, same position, same tap-to-expand.
- When a panel is open, that extension's dot is **suppressed** — one indicator
  per extension, never two saying the same thing.
- An extension with an overlay but no panel keeps the plain dot behaviour of §8b.

### 4.1 `when` clauses

```
"when": "book.isSaved && ext.hasPermission('network') && app.platform != 'web'"
```

Grammar: property lookup, `&&`, `||`, `!`, `==`, `!=`, string and number
literals, parentheses. **Not** `eval`, not Turing-complete — it decides
visibility, and a visibility rule that can loop is a bug generator.

Context: `app.{platform,version}` · `book.{isOpen,isSaved,chapterCount}` ·
`ext.hasPermission(name)` · `ext.settings.<key>`.

---

## 5. Pages

```jsonc
"pages": {
  "settings": { "title": "Cloud Backup", "type": "schema" },
  "conflict": { "title": "Sync Conflict", "type": "ui-file", "file": "Conflict.js" },
  "docs":     { "title": "Help", "type": "url", "url": "https://…" }
}
```

| type | rendered by | frame | needs |
|---|---|---|---|
| `schema` | AuthNo, from §6 | **none** | nothing |
| `ui-file` | the extension, in a sandboxed frame | yes | its own CSP |
| `url` | a remote page in a frame | yes | https, `network` host match |

A `schema` page needing no frame is the point: a settings-only extension can be
granted nothing at all and still be configurable.

---

## 6. The settings schema **[1.1.20]**

```jsonc
"settings": {
  "schema": [
    { "key": "provider", "type": "select", "label": "Cloud provider",
      "options": ["Google Drive", "Dropbox", "WebDAV"], "default": "Google Drive" },
    { "key": "interval", "type": "number", "label": "Sync every", "suffix": "minutes",
      "min": 5, "max": 1440, "default": 30 },
    { "key": "wifiOnly", "type": "toggle", "label": "Only on Wi-Fi", "default": true },
    { "key": "folder",   "type": "text",   "label": "Folder", "placeholder": "/AuthNo" },
    { "key": "account",  "type": "action", "label": "Connect account", "command": "auth.connect" },
    { "key": "status",   "type": "readout", "label": "Last sync", "source": "sync.status" },
    { "type": "section", "label": "Advanced", "collapsed": true, "children": [ … ] }
  ]
}
```

Control types: `toggle` · `text` · `number` · `select` · `multiselect` ·
`action` · `readout` · `section`.

- Values persist to the extension's own storage automatically. No bridge code.
- `readout` polls a registered command; that is how live status appears without
  a custom page.
- Rendered by the app, so it inherits theme, dark mode, Material You,
  accessibility and responsive layout for free.

### 6.1 What AuthNo puts on the same page, that the extension does not own

Version · author · install date · **each permission with a toggle** · hosts
contacted **[later]** · background run history **[later]** · error log §10 ·
Uninstall.

---

## 7. Onboarding **[later]**

```jsonc
"onboarding": {
  "steps": [ { "title": "…", "body": "…", "image": "onboarding/1.png" } ]
}
```

Declarative, 2–5 steps (a build with more fails), omit the key for none.
Declarative and not code because an onboarding flow runs *before any permission
has been granted*, which is exactly the wrong place for arbitrary code.

Order: **install → onboarding → permissions → ready.** Teach, then ask.

---

## 8. Background **[later]**

```jsonc
"background": {
  "command": "sync.run",
  "minInterval": 900,
  "requires": ["network"],
  "constraints": { "network": "unmetered", "charging": false }
}
```

- Android: `WorkManager` periodic work. Its 15-minute floor is the platform's.
- Desktop: main-process timer waking a hidden sandboxed renderer. **Only while
  AuthNo runs** — the window may be hidden, the app may not be quit.
- Wake → run one command → tear down. Nothing stays resident.
- Budget: 30 s wall-clock per wake then killed, wakes/day cap, failure backoff.
- **The background entry point gets no DOM, from 1.1.20 onward** — enforced by
  the build even before the runtime that requires it exists. §12.3 of the
  design doc explains why this one lands early.

---

## 8a. Widgets — fonts and templates

### 8a.1 The font problem, and why the list is curated

**RemoteViews has no typeface API.** There is no `setTypeface` that survives the
Binder round-trip, and `TypefaceSpan(Typeface)` parcels only a family *name*, not
the face — so a font file shipped inside an extension package cannot reach a
widget. This is a platform constraint, not a policy choice.

What *does* work is a font resource in **AuthNo's own APK**, referenced from a
widget layout AuthNo also ships. That is why the list is curated: the fonts have
to be ours for widgets to render them at all, and it is why an extension picks a
font by name rather than supplying one.

> **Needs an on-device check before the templates are written.** Two delivery
> paths exist — build-time layout variants per font, or a `TypefaceSpan` carried
> in a `SpannableString` — and which survives Binder on real OEM builds decides
> how the templates are generated. Test this first; it shapes all of them.

### 8a.2 The set — 22 faces

All OFL or Apache-2.0, so redistribution inside the APK is clear. Latin, Latin
Extended, Greek and Cyrillic throughout. Variable where the min SDK allows,
static instances otherwise; budget is roughly 1–2 MB total.

| # | face | class | why it is in the list |
|---|---|---|---|
| 1 | **Inter** | UI sans | the default; tabular figures, enormous glyph coverage |
| 2 | **Roboto** | UI sans | matches the system, so a widget can disappear into the launcher |
| 3 | **Open Sans** | humanist sans | the neutral workhorse |
| 4 | **Lato** | humanist sans | warmer than Open Sans at the same weight |
| 5 | **Source Sans 3** | humanist sans | widest Latin-Extended coverage of the sans group |
| 6 | **Nunito** | rounded sans | the only rounded face; friendly widgets have no other option |
| 7 | **Work Sans** | geometric sans | display-leaning without going to a true display face |
| 8 | **Roboto Condensed** | condensed | widgets are narrow — this is the most-used class after the default |
| 9 | **Barlow Condensed** | condensed | lighter colour than Roboto Condensed at small sizes |
| 10 | **Oswald** | condensed display | headline condensed; strong at 2–3 words |
| 11 | **Merriweather** | screen serif | designed for screens, holds up at widget sizes |
| 12 | **Lora** | book serif | the bookish default for a writing app |
| 13 | **Source Serif 4** | book serif | pairs with Source Sans across a widget set |
| 14 | **EB Garamond** | classical serif | a manuscript app should own one Garamond |
| 15 | **Libre Baskerville** | transitional serif | high x-height, survives small sizes better than Playfair |
| 16 | **Playfair Display** | display serif | high contrast, for large numerals and single words |
| 17 | **Abril Fatface** | display slab | the heaviest face in the set; big counts, big numbers |
| 18 | **Zilla Slab** | slab | slab that still reads as text rather than display |
| 19 | **JetBrains Mono** | mono | tabular by construction — the timer default |
| 20 | **IBM Plex Mono** | mono | a mono with more personality, same tabular property |
| 21 | **Caveat** | handwriting | a writing app wants one; casual notes and streak widgets |
| 22 | **Bebas Neue** | all-caps display | condensed all-caps; the "1,247 WORDS" case |

**Tabular figures matter more than the face for anything counting.** Inter,
JetBrains Mono, IBM Plex Mono and Roboto all keep digits at constant width, so a
timer does not jitter as it ticks. Templates in the timer and counter classes
default to one of those, and the picker marks the rest as non-tabular rather than
letting an author discover it at 59→00.

**CJK is deliberately absent.** Noto Sans JP/KR/SC/TC are 5–16 MB *each* —
bundling them would multiply the APK several times over for a case the platform
already handles, since Android falls back to the system CJK face automatically.
Widget text in those scripts renders; it renders in the system font.

### 8a.3 Templates: four first, not fifty

The 20–50 template target stands, but the first four are built alone and the rest
wait on them. Templates are the largest chunk of work in v2 and carry almost no
architectural risk — which is exactly why they should not go first. One of each
class, against the constraints already known to be hostile:

| first template | proves |
|---|---|
| **Static card** | layout, theming, the font path end to end |
| **Periodic counter** | `updatePeriodMillis` has a **30-minute floor** — anything faster needs an alarm, and the battery story has to be settled once |
| **Timer** | `setChronometer` is the **only view that ticks by itself**; everything else is a push |
| **Scrolling list** | the Binder transaction limit is ~1 MB, so a list has to page rather than send |

The timer is the one that will bend the API. Writing 46 more templates against a
design the timer has not yet tested is how 46 templates get rewritten.

---

## 8b. The editor overlay — a dot, not text

An extension with the overlay may show **a single dot in the corner of the
editor**, in its own colour, the way Android shows its microphone and camera
indicators. Earlier drafts put semi-transparent text over the toolbar; a dot is
better while writing, which is the entire time it is visible.

| state | behaviour |
|---|---|
| Idle | one dot per extension, 8 dp, at the trailing edge |
| Tapped | expands to a small sheet: extension name, its line of text, a way to silence it |
| Multiple | dots stack to three, then a `+n` dot; the sheet lists all of them |
| Android, typing | dots sit over the toolbar's trailing edge, above the keyboard |
| Desktop | bottom-right of the editor pane |

**Accessibility, which a colour-only indicator fails by default:**

- The dot's touch target is **48 dp** even though it draws at 8 dp.
- Colour is never the only carrier — the expanded sheet names the extension in
  text, and the dot carries a content description of the extension name and its
  current line.
- The dot does not animate under `prefers-reduced-motion`; it appears and
  disappears without a pulse.
- A dot never covers a caret position or a toolbar control; the toolbar reserves
  its trailing slot when any overlay is active.

An extension writes its line with `authno.ui.overlay.set(text)` and clears it
with `.clear()`. The host owns the colour, the position and the dismissal — the
extension owns one string.

---

## 9. Lifecycle

```
install → verify (.extbk CRC + RS) → manifest check → onboarding →
permissions → activate() → running ⇄ hooks/commands → deactivate() → uninstall
```

| stage | guarantees |
|---|---|
| install | package verified and, if damaged, **repaired** before anything is written to disk — EPK §6a. A package arriving over the update channel must carry a valid **Ed25519** signature; a manually chosen file may be unsigned, and is shown as unsigned |
| activate | 15 s timeout, then reported as failed to start |
| running | a throw in one hook never stops another extension's |
| deactivate | awaited, then the frame is destroyed regardless |
| uninstall | directory, storage namespace **and grants** removed |

Update: if `apiVersion` or a permission set changed, re-prompt for the delta
only. Storage survives; grants for unchanged permissions survive.

---

## 10. Diagnostics **[later]**

A per-extension log on its settings page: activation failures, permission
denials, uncaught throws, background run outcomes. Today an extension that
throws in `activate()` produces a toast and nothing an author can read.

---

## 11. Tooling

| | |
|---|---|
| `extbk build` | validates the v2 manifest, fails on a missing `reason`, >5 onboarding steps, DOM use in the background entry, unknown permission keys |
| `@authno/extension-types` | TypeScript definitions for every call and permission name; types never reach the runtime |
| `extbk check` | as now, plus a permission report: "this build calls `library.list`, which needs `library:read:all`" |
| sandbox harness | a `--deny` mode to run with a permission refused, so authors test the inert path |
| `npm run check:extbk` | already exists — the app reads what the CLI writes |

---

## 12. Everything that breaks from v1

Free to do now; not free after release.

1. `apiVersion: 2` required — v1 manifests refused, not adapted.
2. The whole host API renamed and namespaced (§3.1).
3. `getSessions` no longer returns book contents — `library.list` is metadata.
4. Extensions get **no capability** without declaring the permission.
5. Network blocked unless `network.hosts` names the host.
6. `alert()` and native form submission already gone in 1.1.19-beta.5.
7. Background code may not touch the DOM.
8. `contributes` entries take exactly one of `page` / `command` / `panel`.
9. Bootstrap `version: 4` → replaced by `apiVersion`.

**Cloud Backup 2.0.0 absorbs all nine.** It is the only extension, which is the
argument for doing this in one break rather than three.

---

## 13. Still open

1. **Ship `background` as a declarable-but-unhonoured permission in 1.1.20**, so
   the no-DOM rule binds before anyone writes background code? The API shape has
   to be frozen before the feature ships, or the first background extension
   defines it by accident.
2. **Which font delivery path survives Binder?** §8a.1 — needs an on-device
   check, and it gates how every template is generated.
3. **Does the update channel support pinning a version**, or is it always latest?

### 13a. Decided, recorded so they are not reopened

| question | answer |
|---|---|
| `library:read:current` **or** `:all` | **both** — two permissions, two prompts |
| `library.list` metadata | chapter titles, chapter preview, book name, author, ISBN and more, each opt-in per call |
| Update channel | **yes**, plus a manual "update from file" button in extension settings |
| Widgets: templates or hand-built | **both** — templates for the common cases, hand-built widgets behind a separate permission set |
| Signing | **Ed25519, in 1.1.20** — an unsigned auto-update path inherits granted permissions silently (EPK §7.2) |
| Writing-activity permission | **`activity`**, bucketed to 1 Hz (§2.2a) |
| Prompt API | **`ui.prompt` / `ui.confirm`**, host-drawn, no permission (§2.2b) |
| Editor overlay | **a dot**, Android-privacy-indicator style, expanding on tap (§8b) |
| `panel` | **in 1.1.20** (§4a) — side dock on desktop, bottom sheet on phone, behind a 45-character measure floor |
| Widget fonts | **22 curated faces** in the APK, since RemoteViews cannot take a font from a package (§8a.2) |
| Extension size cap | **1 GB** policy, 4 GiB format ceiling |
| Disabled extensions | greyed out, including the icon — never hidden |
