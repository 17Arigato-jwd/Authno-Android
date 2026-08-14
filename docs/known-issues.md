# Known issues

Everything open against the app and the site as of 1.1.19-beta.3, ordered by
what would hurt most if it were still true on release day.

Fixed things are not listed — the changelog has those — except where the shape
of one is worth remembering: the two site-side entries below, and the two
mistakes at the bottom.

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

## Was "should be fixed before release" — both now done

Nothing is left in this tier. Both entries are on the site's
`claude/audit-followups`, and they are kept here rather than deleted because
one of them was wrong about itself in a way worth not repeating.

### 4. `ALLOWED_ORIGIN` defaulted to `*` — SITE · SECURITY

**Fixed.** The fallback is an explicit list now, in `worker/src/lib/cors.js`,
and the `"*"` that `wrangler.jsonc` also set is gone.

This entry called it "not credential exposure, but pin it anyway", which was
right about the risk and wrong about the cost. Pinning it to the site's origins
would have taken sign-in down on both app platforms, because the app is not
exempt from CORS and nothing here said so:

- Android runs under `androidScheme: "https"`, so the WebView's origin is
  `https://localhost` and every gate call is cross-origin.
- The desktop renderer is loaded with `loadFile`, so it is a `file://` page and
  sends `Origin: null`.

Measured in Chromium rather than assumed: with no matching allow-origin the
fetch fails outright, preflight included, and `*` and `null` are the only two
values that let it through. So `null` is on the allowlist, it is the weakest
entry on it — any sandboxed iframe anywhere serialises to `null` — and what
removes it is giving the desktop renderer a real origin instead of `file://`.
That is an app change, not a gate change, and it is the residue this leaves
behind.

Found on the way: `siteUrl()` fell back to `ALLOWED_ORIGIN`, which was `*`,
which its own guard rejected — so the real fallback was `""` and a finished
Google sign-in on the website redirected *relative to the gate*, landing on the
API's own host.

### 5. CSP `connect-src` was wider than it needed to be — SITE · SECURITY

**Fixed.** It names the one gate origin. `worker-site/securityHeaders.js` is
the only copy of the policy: the Worker half reads `GATE_ORIGIN` at runtime, a
vite plugin writes `dist/_headers` at build time from `VITE_GATE_API`, and
`public/_headers` is gone rather than kept alongside — two copies with a
comment on each asking whoever edits one to remember the other is how they
drift, and that pair already had.

`npm run check:csp` drives both directions in a real browser now: an unrelated
`*.workers.dev` origin must be refused, and the gate the build names must not
be. CI treats `dist/_headers` as a required build output, because missing it
means a public site with no CSP, no HSTS and no frame-ancestors, deployed
green.

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

### 13. The desktop renderer has no origin of its own — APP · SECURITY

Left behind by the fix to issue 4, and the reason `null` is on the gate's CORS
allowlist. `main.js` loads the built page with `loadFile`, so the renderer is a
`file://` document and sends `Origin: null` on every call to the gate. The gate
has to allow `null` for desktop sign-in to work at all, and `null` is what any
sandboxed iframe anywhere serialises to — so that one entry is close to
allowing everything, and it is there because there is nothing better to name.

What fixes it is on this side: register a `standard` + `secure` custom scheme
and load the app from it, so the renderer has a real origin the gate can
allowlist by name. It is not a one-liner — asset paths, the deep-link handling
and the packaged/dev split all run through how the window is loaded — and it
wants the same hardware pass issue 3 does, which is why it is here rather than
above.

Worth keeping in proportion: sessions are Bearer tokens, never cookies, so no
browser attaches a credential on its own and a hostile page can already call
the gate from its own server. This is defence in depth that is currently one
layer thinner than it reads.

---

## Verifying it

The jest suite covers what jsdom can reach. Six things it cannot, each with a
script, and every one of them has caught something real:

| | what it is for |
|---|---|
| `npm run check:timezones` | the writing day on days that are 23 or 25 hours long. A zone is fixed before the first `Date` exists, so setting `TZ` inside a test file does nothing — measured, not assumed. |
| `npm run check:sandbox` | that an extension frame really cannot reach the app. jsdom has no origin model, so a unit test of this passes against a sandbox with a hole in it. |
| `npm run check:extensions` | the extension protocol end to end. jsdom cannot execute a frame's scripts, so the bootstrap was a string nothing had ever run. |
| `npm run stress:extensions` | twenty at once, churn, floods, and extensions that misbehave. The bar is not that one cannot be bad — it is that one bad one cannot take its neighbours with it. |
| `npm run check:csp` (site) | the shipped Content-Security-Policy, parsed out of the `dist/_headers` the build just wrote and driven over nine routes. Both directions: an unrelated origin has to be refused, and the gate the build names has to not be. A CSP has no compiler behind it. |
| `npm run check:headers` (site) | that the site's two deployments serve the same headers. Pages reads a file, the Worker sets them in code, and they were two hand-maintained copies until they came from one module. |

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
