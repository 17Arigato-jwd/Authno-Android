# Known issues

Everything open against the app and the site, as of 1.1.19-beta.3. Ordered by
what would hurt most if it were still true on release day.

Fixed things are not listed — the changelog has those. This is what remains.

---

## Blocking release

### 1. Extensions have no sandbox worth the name — APP · SECURITY

**Fixed in this branch**, both halves, and checked in a real browser rather
than asserted — `npm run check:sandbox`. Kept here because the shape of it is
worth remembering.

Extension UI pages ran in an iframe carrying
`sandbox="allow-scripts allow-same-origin"`. Those two flags together are not a
weaker sandbox, they are *no* sandbox: `srcdoc` content inherits the embedder's
origin, so `allow-same-origin` handed extension code the app's own origin.
`parent.localStorage`, `parent.document` and every module the app had loaded
were one property access away, and the whole postMessage bridge underneath it —
carefully scoping storage per extension, proxying native plugins — was
decoration that extension code could step around without trying.

The background half was worse: `activateExtension()` called `import()` directly
into the app's context, with no iframe at all.

### 2. `android:allowBackup="true"` with no extraction rules — APP · SECURITY

Deferred by the owner to 1.1.20-beta, alongside the cloud-backup work.

Android Auto Backup copies the app's private data to the user's Google Drive.
That includes the WebView's localStorage, which holds both the books and the
access key. Two consequences:

- Manuscripts leave the device, silently, on a device the app tells people is
  the only place they live.
- Restoring a backup onto a handset signs you in as its owner. The gate's
  cooldown, the per-account rate limiting and the key file's password are all
  bypassed — they guard the sign-in path, and this is not the sign-in path.

The fix is one attribute plus a `dataExtractionRules` file. The reason it is
not one line of *work* is that turning backup off makes replacing a phone lose
anything not exported, so the export path has to be load-bearing first.

### 3. The hardware pass has not been run — APP

`docs/device-test-plan.md`, Parts 1 and 2. Nothing in CI can exercise an alarm
firing with the app closed, a widget on a real launcher, a chapter surviving a
process death mid-autosave, or an OEM battery manager quietly dropping a
repeating alarm. Part 1 is the data-loss half and is the one that matters.

---

## Should be fixed before release

### 4. `ALLOWED_ORIGIN` defaults to `*` — SITE · SECURITY

`worker/src/index.js` falls back to `*` when the variable is unset. Sessions
are Bearer tokens rather than cookies, so this is not credential exposure — a
browser will not attach anything automatically. It should still be pinned in
production: leaving it open means any page anywhere can drive the gate API with
a token it has somehow obtained, and narrowing it later is the kind of change
that breaks a deploy nobody is watching.

### 5. CSP `connect-src` is wider than it needs to be — SITE · SECURITY

`https://*.workers.dev` rather than the one gate host, because the exact
hostname is a per-deploy build variable (`VITE_GATE_API`) that the site Worker
cannot see at runtime. Tightenable by threading it through as a Worker env var
and templating the header.

### 6. A remote extension page kept `allow-same-origin` — APP · SECURITY

**Fixed in this branch.** The `url` page type loaded a manifest-supplied
address with `allow-same-origin allow-popups`. Not the escape issue 1 was — the
origin it kept was the extension author's server, not the app's — but nothing
required either flag, and nothing checked the address was https before loading
it under the app's own chrome.

---

## Worth doing, not blocking

### 7a. `authno://` can still fail to register — APP

The `.deb`, the `.rpm` and the Windows installer all claim the scheme, and the
AppImage that could not has been dropped. What remains is narrower: a managed
machine that refuses the registry write, another program already holding
`authno://`, or a binary run straight out of a checkout.

Handled rather than open — `app.isDefaultProtocolClient` is asked before a
browser opens, and a paste-the-address panel is offered instead of waiting for
a link that is never coming. The paste path is not a hole: the address is not a
credential, the single-use 60-second handoff inside it is, and the gate refuses
that if it is stale or already spent.

### 7. Extension UI pages could not use relative imports — APP

**Fixed in this branch.** A `ui-file` page was inlined into its `srcdoc`
document as a single `<script type="module">`. A module in a srcdoc document
has no base URL to resolve `./helper.js` against, so any UI split across files
failed at load with a bare-specifier error — and every extension author who hit
it concluded, reasonably, that UI pages had to be one file.

Both halves of an extension now link their modules the same way.

### 8. Two host calls are still Android-only — APP

The app's own Google sign-in now works on desktop through `authno://` — see
below — but two calls an EXTENSION can make still do not: `googleSignIn`
(Credential Manager) and `requestDriveToken` (the native account picker) have
no desktop equivalent and throw with a reason.

`openBrowser` is fine now: it opens the real browser, and an extension that
routes its round trip through the gate can be handed the result back on the
`authno://` scheme exactly as the app is. What is missing is only the two
native shortcuts, so an extension that wants Drive on desktop has to do the
ordinary OAuth dance rather than ask Android for a token.

### 9. The reminder falls back to generic wording — APP

`ReminderText` answers whenever the stored line is from another day — correct,
since a stale line names a book you may have finished and a streak you may have
lost. But it means somebody who never opens the app between reminders only ever
sees the two fixed sentences, which is the opposite of who the varied copy was
for.

### 10. One 608 kB JS chunk on the site — SITE

Not a bug. The build warns on every run, so the warning has stopped carrying
information, which is its own small cost.

### 11. `updatePeriodMillis` is the widgets' only refresh — APP

Thirty minutes, the platform floor. The countdown's clock ticks by itself, but
the word count and the streak underneath it are only as fresh as the last sync
or the last half hour. Nothing is wrong; it is just the ceiling on how live a
widget can look.

---

## Notes on things that look like issues and are not

- **`console.debug` about `WidgetData` off-device.** Expected, and only ever as
  a caught error. If it returns as an uncaught page error, that is the
  Capacitor thenable bug back — see the comment on `getPlugin`.
- **The `offlineWriterSessions` mirror holding stubs.** Deliberate. Under quota
  pressure `App.js` degrades it to `{id,title,filePath}`, and readers are
  supposed to cope rather than assume chapters exist.
- **The gate answering `501`.** The payments and subscription-refresh routes
  are seams, not failures.
