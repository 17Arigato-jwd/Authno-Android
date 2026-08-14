# Known issues

Everything open against the app and the site as of 1.1.19-beta.3, ordered by
what would hurt most if it were still true on release day.

Fixed things are not listed — the changelog has those — except at the bottom,
where the shape of two of them is worth remembering.

---

## Blocking release

### 1. `android:allowBackup="true"` with no extraction rules — APP · SECURITY

Deferred by the owner to 1.1.20-beta, alongside the cloud-backup work. The only
item here with a decision already attached.

Android Auto Backup copies the app's private data to the user's Google Drive.
That includes the WebView's localStorage, which holds both the books and the
access key. Two consequences:

- Manuscripts leave the device, silently, from an app that tells people the
  device is the only place they live.
- Restoring a backup onto a handset signs you in as its owner. The gate's
  cooldown, the per-account rate limiting and the key file's password are all
  bypassed — they guard the sign-in path, and this is not the sign-in path.

The fix is one attribute plus a `dataExtractionRules` file. The reason it is
not one line of *work* is that turning backup off makes replacing a phone lose
anything not exported, so the export path has to be load-bearing first.

### 2. The hardware pass has not been run — APP

`docs/device-test-plan.md`, Parts 1 and 2. Nothing in CI can exercise an alarm
firing with the app closed, a widget on a real launcher, a chapter surviving a
process death mid-autosave, or an OEM battery manager quietly dropping a
repeating alarm. Part 1 is the data-loss half and is the one that matters.

### 3. Deep links have never run on a real desktop OS — APP

The argv parsing is covered thoroughly because it is pure, and both installers
now build in CI. What has not been exercised is the OS half: the registry
write, the `.desktop` MimeType, the "Open AuthNo?" dialog, and the launch path.

One-line check on an installed build: paste `authno://auth/google?google=test`
into a browser address bar. The app should come up and the gate should reject
it as a bad handoff — which means the whole chain worked except the part that
is supposed to fail.

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
hostname is a per-deploy build variable (`VITE_GATE_API`) the site Worker
cannot see at runtime. Tightenable by threading it through as a Worker env var
and templating the header.

---

## Worth doing, not blocking

### 6. Extension UI pages have no `oauth` — APP

The background half can call `host.oauth({ authUrl, redirect })`; a `ui-file`
page's bridge is the older surface and cannot. An extension that wants to
authorise from a settings page has to hand the request to its background half
first. Fixable by adding the one method to that bridge.

### 7. Two host calls are Android-only — APP · won't fix

`googleSignIn` and `requestDriveToken` are Play Services APIs, and everything
that makes them worth calling is the part that does not exist off Android: no
client id, no redirect, no browser, and silent refresh handled by the OS.
`requestDriveToken` goes through `Identity.authorize()`, which derives the
caller from the package name and signing certificate. There is nothing on a
laptop to derive.

`host.oauth({ authUrl, redirect })` replaces them — a browser round trip that
comes home on `com.aurorastudios.authno://`, the same on both platforms. The
two native calls throw with a message pointing at it.

Worth knowing if you write an extension: Google will not accept a bare
`authno://` as a `redirect_uri`. The reverse-DNS form is what it takes, which
is why that is the scheme `oauth` insists on — and why an extension cannot name
`authno://auth/` as its redirect and be woken by the app's own sign-in.

### 8. `authno://` can still fail to register — APP

The `.deb` and `.rpm` claim it through their `.desktop` entry; Windows claims
it at first run through `setAsDefaultProtocolClient`. What remains is narrower:
a managed machine that refuses the registry write, another program already
holding the scheme, or a binary run out of a checkout.

Handled rather than open — `isDefaultProtocolClient` is asked before a browser
opens, and a paste-the-address panel is offered instead of waiting for a link
that is never coming. That path is not a hole: the address is not a credential,
the single-use 60-second handoff inside it is, and the gate refuses that if it
is stale or already spent.

Note for whoever touches the packaging: electron-builder's `protocols` block
only reaches Linux. There is no NSIS path for it — the option's own schema
calls it macOS-only — so on Windows the runtime call is the whole mechanism,
not a belt-and-braces duplicate of the installer.

### 9. The username rule lives in two files — APP · by design

`worker/src/lib/username.js` is authoritative; `src/utils/penName.js` mirrors
it so the app can refuse a name without a round trip. They must be changed
together, and nothing checks that they agree — the app can afford to be no
stricter than the gate, because a name the gate would refuse is one nobody can
ever register.

There were three copies until this release: `AccessGate.jsx` had its own regex
for the Google sign-up button, and it had already drifted — it predated
hyphens and predated Japanese and Russian, so it would have greyed out the
button for every name in those alphabets while the gate was willing to
register them. That one is gone; the remaining two are deliberate.

If the Cyrillic range is ever widened past Russian, `CYRILLIC_LOOKALIKE` needs
the new letters in the same commit. Ukrainian `і`, `ј` and `ѕ` are the
sharpest lookalikes of all and are currently out of range rather than folded.

### 10. The reminder falls back to generic wording — APP

`ReminderText` answers whenever the stored line is from another day — correct,
since a stale line names a book you may have finished and a streak you may have
lost. But it means somebody who never opens the app between reminders only ever
sees the two fixed sentences, which is the opposite of who the varied copy was
written for.

### 11. One 608 kB JS chunk on the site — SITE

Not a bug. The build warns on every run, so the warning has stopped carrying
information, which is its own small cost.

### 12. `updatePeriodMillis` is the widgets' only refresh — APP

Thirty minutes, the platform floor. The countdown's clock ticks by itself, but
the word count and the streak underneath it are only as fresh as the last sync
or the last half hour. Nothing is wrong; it is the ceiling on how live a widget
can look.

---

## Verifying it

The jest suite covers what jsdom can reach. Five things it cannot, each with a
script, and every one of them has caught something real:

| | what it is for |
|---|---|
| `npm run check:timezones` | the writing day on days that are 23 or 25 hours long. A zone is fixed before the first `Date` exists, so setting `TZ` inside a test file does nothing — measured, not assumed. |
| `npm run check:sandbox` | that an extension frame really cannot reach the app. jsdom has no origin model, so a unit test of this passes against a sandbox with a hole in it. |
| `npm run check:extensions` | the extension protocol end to end. jsdom cannot execute a frame's scripts, so the bootstrap was a string nothing had ever run. |
| `npm run stress:extensions` | twenty at once, churn, floods, and extensions that misbehave. The bar is not that one cannot be bad — it is that one bad one cannot take its neighbours with it. |
| `npm run check:csp` (site) | the shipped Content-Security-Policy, parsed out of `_headers` and driven over nine routes. A CSP has no compiler behind it. |

The desktop installers are built by CI on a tag, a dispatched release, or a
pull request labelled `build-desktop`. Packaging is the one thing no other job
catches: electron-builder's config is not exercised by `Build React` or by
anything in jest, so a broken `protocols` block first shows up when you cut a
release.

---

## Two mistakes worth remembering

Neither is open. Both are here because the *shape* of them will recur.

**A sandbox that was not one.** Extension UI ran in an iframe carrying
`sandbox="allow-scripts allow-same-origin"`. Those two flags together are not a
weaker sandbox, they are none: `srcdoc` content inherits the embedder's origin,
so the second flag handed extension code the app's own. The careful postMessage
bridge underneath was decoration that extension code could step around without
trying. What let it stand was that the isolation was asserted in a comment and
never executed anywhere.

**Three doors, two guards.** A book opened in preview has every chapter with
`content: null`. `saveBook` refused to write one — its comment even called
itself "the backstop for any that forget" — and the exports refused through
`withAllChapters`. `autoSaveBook` did not, and it is the one that runs with
nobody asking, four seconds after a book is opened. `saveAsBook` did not
either, and on Android it deletes the app-folder copy once the new one is
written, so unhydrated it wrote a hollow book and removed the only whole one.
The same class of bug sat in the two paths where it did most damage, behind a
guard that already existed and was known to be needed. When a rule earns a
backstop, count the doors.

---

## Notes on things that look like issues and are not

- **The JS suite has failed 4 tests twice, unreproducibly.** Both times a
  re-run — including `--json`, which reports per-test results — came back
  clean, and every run since has been green. No cause found and none invented.
  If it recurs, capture the whole output rather than the summary line: the
  failing suite names are the only thing that was missing.
- **`console.debug` about `WidgetData` off-device.** Expected, and only ever as
  a caught error. If it returns as an uncaught page error, that is the
  Capacitor thenable bug back — see the comment on `getPlugin`.
- **The `offlineWriterSessions` mirror holding stubs.** Deliberate. Under quota
  pressure `App.js` degrades it to `{id,title,filePath}`, and readers are
  supposed to cope rather than assume chapters exist. The save guards above are
  what stop a stub being written back over a real book.
- **The gate answering `501`.** The payments and subscription-refresh routes
  are seams, not failures.
