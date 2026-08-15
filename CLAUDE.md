# AuthNo (app) — working notes

## Publishing rule: ask before writing these into user-facing text

Three categories need the owner's explicit approval **before** the copy is
written, committed or pushed. This covers anything a user reads: UI strings,
dialogs, onboarding, the changelog, store listings, README.

1. **How the system works internally.** What is stored, how keys are protected,
   sessions, device revocation, recovery, rate limiting, the invite tree. The
   test is whether a line describes *mechanism* or tells somebody *what to do*.
   "Your books stay exactly where they are" is a consequence and is fine. "The
   key file is encrypted with your pen name and email" is mechanism and is not.

2. **Anything commercial.** Prices, tiers, free-vs-paid splits, billing
   behaviour, what happens when a purchase lapses, refunds.

3. **Features that do not exist yet.** Cloud backup, AI assistance, the
   marketplace, anything on the roadmap. Shipping is the bar, not planning.

Everything else proceeds normally — bug fixes, layout, animations,
accessibility, performance, correcting text that is simply wrong.

Code comments are exempt: they explain mechanism to whoever maintains this, and
that is their job. The rule is about text a user sees.

## Until public release: break things for a better system

There are no users. Nothing is deployed to anybody. So until the app is
publicly released, a change that breaks existing behaviour, formats, manifests
or stored data is **allowed and preferred** when it buys a better system — no
compatibility shims, no adapters, no "keep the old path working too".

The one thing this does not license is breaking something *by accident*. The
rule is about deliberate redesign, not about skipping the check that says
whether the new thing works. `docs/known-issues.md` and the sweep documents
still record what is broken.

This flips one default in particular: when a decision is between the correct
shape and the compatible one, take the correct shape and delete the other.

## Things that must stay true

- **Being locked out never means losing manuscripts.** The gate is a closed
  door, not a bonfire. `src/utils/rescue.js` + `ExportRescue.jsx` are the escape
  hatch, reachable from the gate with no key, no account, no network — and
  deliberately checked *before* the cooldown, because retrieving your own work
  is not a sign-in attempt.
- **Signing out must not cost words.** It clears the key and re-raises the gate;
  it never reloads the window (that would drop editor state not yet flushed to
  the sessions array) and never touches the library.
- The localStorage mirror under `offlineWriterSessions` is a *mirror*, not the
  truth. Under quota pressure `App.js` degrades it to `{id,title,filePath}`
  stubs. Code reading it must handle that rather than assume chapters exist.

## Verification

`CI=true npx react-scripts test --watchAll=false` for the suite.

For gated builds, set `REACT_APP_REQUIRE_INVITE=true` and
`REACT_APP_ACCESS_PUBKEY=<spki base64>`; the public key must match the signing
key you mint test keys with, or every key reads as a bad signature.

Browser checks: build, serve `build/`, drive with playwright-core
(`executablePath: '/opt/pw-browsers/chromium'`, `--no-sandbox`).

`"WidgetData" plugin is not implemented on web` is expected off-device, but
only as a *caught* error — a `console.debug` from `widgetBridge` in a dev
build, and nothing at all in a production one. If it ever shows up again as an
uncaught page error or an unhandled rejection, that is the thenable bug back:
Capacitor's plugin object is a Proxy that answers `then` with a callable, so
handing it to promise resolution makes `await` hang forever instead of
throwing. See the comment on `getPlugin`.
