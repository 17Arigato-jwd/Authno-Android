# Extension system v2 — the spec, for review

Companion to `extension-system-v2.md`, which argues the design. This one just
**lists it**, so it can be checked item by item.

Written under the standing rule in `CLAUDE.md`: there are no users, so where v1
has the wrong shape it is replaced rather than kept alongside. Every break is
listed in §12.

Legend: **[1.1.20]** builds now · **[later]** specified, deferred · **[open]**
needs your decision.

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
| `notifications` | `notify.post` | "Send you notifications" | **[later]** |
| `widgets` | contributes a widget | "Add widgets to your home screen" | **[later]** |
| `background` | `background` block honoured | "Run while AuthNo is closed" | **[later]** |

Not permissions, always available: `app.*`, `ui.toast`, `ui.navigate`,
`storage.*`, `hooks.register`, `commands.register`. Each is either inert or
already private to the extension; prompting for them trains people to tap
through prompts.

### 2.3 Enforcement — where each is actually enforced

| permission | enforced by | can the extension get around it |
|---|---|---|
| every `library:*`, `browser`, `notifications` | `requirePermission()` in `dispatch` | no — it is the only door, and there is no other origin to reach |
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
  "editorToolbar": [{ "id": "…", "label": "…", "panel": "stats" }],   // [open]
  "widgets":       [{ "id": "…", "label": "…", "size": "2x2" }]       // [later]
}
```

Every contribution has exactly **one** target:

| target | does |
|---|---|
| `page` | opens a full page from `pages` |
| `command` | calls a registered function — no UI |
| `panel` | docks a small surface beside the editor **[open]** |

**This is the original bug.** v1 had only `page`, so "Back up now" opened
settings, and two of Cloud Backup's three pages were unreachable.

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

## 9. Lifecycle

```
install → verify (.extbk CRC + RS) → manifest check → onboarding →
permissions → activate() → running ⇄ hooks/commands → deactivate() → uninstall
```

| stage | guarantees |
|---|---|
| install | signature/CRC verified before anything is written to disk |
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

## 13. What I need decided

1. **`panel` in 1.1.20 or 1.1.21?** It touches the editor layout, the most
   delicate surface in the app.
2. **Does `library:read:current` exist, or is `library:read:all` the only read
   permission?** Two is more honest and more prompts.
3. **`library.list` metadata — does it include chapter *titles*?** Useful for a
   table-of-contents extension; titles can carry spoilers and plot.
4. **Ship `background` as a declarable-but-unhonoured permission in 1.1.20**, so
   the no-DOM rule binds before anyone writes background code?
5. **Widgets: real contribution, or does an extension just feed data into an
   AuthNo-shaped widget?** The second is far less work and probably enough.
6. **Does an extension get an update channel**, or is reinstall the only path?
   Affects whether `homepage` grows into something.
