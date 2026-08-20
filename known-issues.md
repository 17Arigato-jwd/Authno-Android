# Known issues

A maintainer's list, not a user's. Written after a sweep of all three repos on
2026-08-20 — the app at `764ae34`, the website at `5ddc44b`
(`claude/audit-followups`), the Cloud Backup extension at `cf7d748`
(`cloud-backup-plus-revamp`).

Everything here was reproduced, not inferred. Each entry says how, so nobody
has to take it on trust or re-derive it. There is a section at the bottom of
things that **look** like bugs and are not, because that is the half of a list
like this that stops getting re-investigated every few months.

Ordered by what it costs somebody, not by how interesting it is.

---

## App — `17Arigato-jwd/Authno-Android`

### 1. A contribution that targets a `command` does nothing — it navigates to `undefined`

**Severity: high.** This is the one that makes an extension look broken.

A contribution may name one of three targets, and the manifest validator says
so:

```js
// src/utils/extensionHostV2.js
const TARGETS = ['page', 'command', 'panel'];
```

Every place that activates a contribution calls `navigate(ext, item.page)`:

```
src/components/HomeScreen.jsx:375     onClick: () => navigate(tile._ext, tile.page),
src/components/BookDashboard.jsx:738  onClick={() => navigate(action._ext, action.page, session)}
```

So a contribution declaring `command` (and therefore no `page`) is navigated to
`undefined`. `panel` is in the same state. Only `page` works.

Cloud Backup's headline action is exactly this shape:

```json
{ "id": "backup-now", "label": "Back up now", "command": "sync.now", … }
```

The machinery to run it exists and is tested — `commandsV2(extId).invoke(name)`
in `src/utils/extensionCommands.js`, which `ExtensionSettingsPage` already uses
for `action` controls. Nothing joins it to a contribution.

**Reproduce:** `grep -rn "navigate(.*\.page" src/components/*.jsx`

---

### 2. `contributes.bookActions` and `contributes.chapterActions` are validated and never rendered

**Severity: high**, and it compounds #1 — Cloud Backup's book actions are
unreachable twice over.

Three names disagree:

| | slots |
|---|---|
| spec (`docs/extension-system-v2-spec.md` §4) | `bookActions`, `chapterActions` |
| validator (`CONTRIBUTION_SLOTS`) | `settings`, `homescreen`, `bookActions`, `chapterActions`, `editorToolbar`, `widgets` |
| what the app reads | `settings`, `homescreen`, `editorToolbar`, **`bookDashboard`** |

`bookDashboard` is a v1 name. It is the only slot the book screen renders, and
it is **not** in the validator's list — so a v2 manifest that declares the slot
that actually works gets `unknown contribution slot "bookDashboard" — ignored`
as a warning, and then works. And a manifest that declares the slot the spec
documents validates cleanly and shows nothing.

Cloud Backup declares `bookActions`. All three of its book actions — "Back up
now", "Cloud files", "Resolve conflict" — never appear.

**Reproduce:** `node scripts/check-extension-manifest.mjs /path/to/manifest.json`
(added in this sweep; it runs the app's real validators against a real manifest
and fails on exactly this).

---

### 3. `tier: "premium"` means Cloud Backup does not activate on a free build

**Severity: high for testing**, by design in production — but it will look like
a bug on a test device.

```js
// src/utils/ExtensionContext.js
_locked: m.tier === 'premium' && !pro,
…
if (manifest._locked) continue;   // never activated
```

Cloud Backup's manifest sets `"tier": "premium"`. On a build without a Pro
entitlement it installs, appears greyed in the list, and never runs — no
commands, no sync, no readouts. That is the intended behaviour of the tier
lock. It is on this list so that "I installed it and nothing happened" is not
mistaken for a fault.

---

### 4. `settings.schema` accepts `suffix` and `collapsed`, and the renderer ignores both

**Severity: low**, but one of them loses a unit.

Cloud Backup declares:

```json
{ "key": "interval", "type": "number", "label": "Check every",
  "suffix": "minutes", "min": 5, "max": 1440, "default": 30 }
```

`validateSchema` does not reject unknown keys, and `ExtensionSettingsPage`
renders neither. The row reads **"Check every  [30]"** with no unit anywhere.
A section's `"collapsed": true` is likewise ignored — Cloud Backup's "Advanced"
section is always open.

Either honour them or reject them at validation. Silently dropping them is the
worst of the three.

---

### 5. `CHANGELOG.md` has no section for the current version, so a release cannot be cut

**Severity: blocks release.**

`package.json` is at `1.1.20-beta.0`; the newest changelog heading is
`## 1.1.19-beta.5`. The release job builds its body from the matching section
and hard-fails without one:

```yaml
# .github/workflows/build.yml
if [ ! -s release-notes.md ]; then
  echo "::error title=Empty release notes::No '## $VER' section in CHANGELOG.md."
  exit 1
fi
```

Normal CI is unaffected — the heading check is gated on a tag or a
`release_version` dispatch — so this stays invisible until the moment somebody
tries to publish.

Changelog copy needs the owner's approval before it is written (`CLAUDE.md`),
which is why this is a listed issue rather than a fixed one.

---

### 6. `src/utils/extensionInstall.js` is a second, unused implementation of the installer

**Severity: medium (duplication, and the live copy was the wrong one).**

It has no consumer. `extbkInstaller.js` does the same job and is what every
install path calls. The two are not equivalent: `extensionInstall.js`'s header
names three ordering rules, and the live path violated the third until this
sweep —

> **Grants are destroyed on uninstall.** Otherwise reinstalling the same id
> silently inherits every permission the user granted a previous version.

That specific hole is now fixed in `extbkInstaller.uninstallExtension`. The
duplication remains, and with it the chance of the same divergence again. Either
delete the unused module or migrate the live path onto it — but not casually:
`extbkInstaller` is on every install surface.

**Reproduce:** `grep -rl "extensionInstall" src scripts electron | grep -v test`
→ nothing.

---

### 7. `src/utils/widgetTemplates.js` has no consumer

**Severity: none today — informational.**

`validateWidgets(manifest)` is never called, so an extension declaring a widget
with a one-minute refresh (there is a 30-minute floor), an unavailable typeface,
or an oversized `RemoteViews` payload installs cleanly and fails silently on a
device — which is precisely what the module was written to prevent.

It is not yet a live bug: the spec marks the `widgets` contribution **[later]**,
and nothing renders it. It becomes one the day widgets ship, so it is here to be
picked up then rather than rediscovered.

---

## Website — `17Arigato-jwd/Authno-Website`

### 8. `npm run check:csp` cannot run in CI or in a container — it dies before its first assertion

**Severity: high.** A security check that does not run looks exactly like a
security check that passes.

```js
// scripts/csp-check.mjs:99
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
```

`undefined` sends playwright-core to its own download directory. Images that set
`PLAYWRIGHT_BROWSERS_PATH` — including this one — have a chromium that
playwright-core did not install, so the lookup resolves to a path that does not
exist:

```
browserType.launch: Executable doesn't exist at …/chromium_headless_shell-…/…
Please run the following command to download new browsers
```

The app repo hit this and fixed it in `scripts/chromium.mjs`, whose own header
says why it matters: *"That is not a check failing. It is a check not running,
and it exits with the same code either way if nobody is reading."* The website
still has the original. Port `chromium.mjs` across.

**Reproduce:** `cd /workspace/aw && node scripts/csp-check.mjs`

---

### 9. A production build with `VITE_GATE_API` unset silently narrows the CSP

**Severity: medium — a deploy-time footgun.**

```
_headers written — VITE_GATE_API was unset, so connect-src is 'self' alone
```

That is correct for a local build and wrong for a deployed one: `connect-src
'self'` blocks every call to the gate API, so sign-in fails at runtime with a
CSP violation rather than at build time with an error. It is a log line, not a
warning, and the build exits 0.

A deploy build should refuse to write `_headers` without the variable, or at
minimum fail loudly.

---

### 10. The client bundle is 624 kB (182 kB gzipped) in one chunk

**Severity: low.**

```
dist/assets/index-BlNsIdAi.js   623.88 kB │ gzip: 181.99 kB
(!) Some chunks are larger than 500 kB after minification.
```

For a marketing and docs site where the first paint is text, that is a lot to
parse before anything is interactive. The docs pages are the obvious split
(`src/docs/**`), since most visitors never open them.

---

## Extension — `17Arigato-jwd/Authno-Cloud-Backup-Extension`

### 11. Everything it declares is correct; what it declares is not all reachable

The manifest validates cleanly against the app's real validators — permissions,
pages, commands, `when` clauses and settings schema all pass. Its API calls all
resolve to methods that exist. Its three page files exist.

Its problems are the app's: issues **#1**, **#2**, **#3** and **#4** above are
all reasons that a correct Cloud Backup manifest produces a worse experience
than it should. There is no fix to make on this side, which is why there is no
separate entry — but it should not be read as "the extension is fine and the
app is broken" either. The two were built against each other without either
side checking the other, and `scripts/check-extension-manifest.mjs` now exists
so that stops being possible.

---

## Checked, and NOT bugs

Recording these because each cost real time to rule out.

- **`entry` is absent from the extension manifest.** It defaults to `index.js`
  (`extensionRunnerV2.js:52`), which the extension has.
- **`authno.library.exportAs` is not in the app's method table.** The frame API
  maps it to the `library.export` wire method
  (`sandboxProtocol.js:326`). Correct as written.
- **`chapter.titles` / `chapter.preview` / `chapter.synopsis` have no frame API
  method.** They are not methods — they are permission names for opt-in extras
  on `library.list` (`LIST_EXTRAS` in `extensionLibraryV2.js`).
- **`auth.disconnect` is declared and never invoked from the manifest.** It is
  registered at runtime (`index.js:398`) and reached from the extension's own
  settings page.
- **`ExtensionPanel`, `ExtensionDots`, `ExtensionPromptDialog` and
  `PermissionRequestSheet` look unmounted** to a naive grep for
  `from './Component'`. All four are imported and rendered by `src/App.js`
  (lines 539, 2285, 2303, 2307).
- **An uncaught `SecurityError` reading `localStorage` inside the extension's
  sandboxed frame.** That is Playwright — `addInitScript` runs in *every* frame,
  including the sandboxed one. Not the app.
- **`TODO` appears eleven times in `src/`.** All of them are the app's own TODO
  *feature* (thread TODOs), not code markers.
- **`bookImport`, `bookScan`, `materialYou`, `themePicker`, `pkce`, `epkCorpus`
  look orphaned.** They are reached through dynamic `import()` or from scripts,
  which a `from|require` grep misses.
