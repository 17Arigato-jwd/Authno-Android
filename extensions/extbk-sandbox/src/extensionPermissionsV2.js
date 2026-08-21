/**
 * extensionPermissionsV2.js — the permission model for apiVersion 2.
 *
 * Spec: docs/extension-system-v2-spec.md §2.
 *
 * v1 has no permission model at all. `dispatch` in extensionSandbox.js is a
 * flat switch, so every extension can do everything the switch can do, and the
 * only honest reading of a v1 manifest's permissions is "all of them". That is
 * why v1 packages are refused rather than adapted: guessing here means guessing
 * wrong in the direction that costs somebody their manuscripts.
 *
 * Two enforcement points, and they are deliberately different in kind:
 *
 *   - `requirePermission` guards `dispatch`, which is the ONLY door out of the
 *     frame. There is no second origin to reach, so a check here is a check
 *     everywhere.
 *   - `buildCsp` hands enforcement to the browser for `network`, because a
 *     policy the frame cannot edit beats a check the frame could route around.
 *     Measured: with `connect-src 'none'` an <img> beacon still reached the
 *     server; with `default-src 'none'` it did not. So the policy is built
 *     deny-first and grants are added, never the other way round.
 */

// ─── The permission set (§2.2) ───────────────────────────────────────────────

/**
 * `prompt` is the line a person reads. It says what the extension can do, not
 * how the app does it — "Read all your books", never "call library.list".
 */
export const PERMISSIONS = {
  'library:read:current': {
    ships: '1.1.20',
    methods: ['library.get'],
    prompt: 'Read the book you have open',
  },
  'library:read:all': {
    ships: '1.1.20',
    methods: ['library.list', 'library.getAny'],
    prompt: 'Read all your books',
    // Reading every book includes reading the open one. Modelled as implication
    // rather than by listing library.get under both: a method that appears in
    // two permissions has no single answer to "what gates this", and the
    // reverse index silently keeps whichever was declared last — which denied
    // library.get to an extension holding only library:read:current, the exact
    // permission that exists to allow it.
    implies: ['library:read:current'],
  },
  'library:write': {
    ships: '1.1.20',
    methods: ['library.create', 'library.update'],
    prompt: 'Add and change books',
  },
  'library:export': {
    ships: '1.1.20',
    methods: ['library.export'],
    prompt: 'Turn your books into files',
  },
  network: {
    ships: '1.1.20',
    // `network.requestHost` is the one gated method here; the rest of this
    // permission is enforced by the browser rather than by dispatch.
    methods: ['network.requestHost'],
    prompt: 'Connect to the internet',
    needsHosts: true,
  },
  browser: {
    ships: '1.1.20',
    methods: ['browser.open', 'auth.oauth', 'auth.googleSignIn', 'auth.requestDriveToken', 'auth.signOut'],
    prompt: 'Open pages in your browser',
  },
  activity: {
    ships: '1.1.20',
    methods: ['activity.getRate', 'activity.onWriting'],
    prompt: 'See when you are writing',
  },
  notifications: {
    ships: 'later',
    methods: ['notify.post'],
    prompt: 'Send you notifications',
  },
  widgets: {
    ships: 'later',
    methods: [],
    prompt: 'Add widgets to your home screen',
  },
  background: {
    ships: 'later',
    methods: [],
    prompt: 'Run while AuthNo is closed',
  },
};

/**
 * Always available, never prompted (§2.2).
 *
 * Each is either inert or already private to the extension. Prompting for them
 * would train people to tap through prompts, which is how a permission dialog
 * stops being a decision.
 */
export const FREE_METHODS = new Set([
  'app.version', 'app.platform', 'app.locale',
  'ui.toast', 'ui.navigate', 'ui.prompt', 'ui.confirm', 'ui.overlay.set', 'ui.overlay.clear',
  'storage.get', 'storage.set', 'storage.remove', 'storage.keys',
  'storage.getJSON', 'storage.setJSON',
  'hooks.register', 'commands.register',
]);

/** Reverse index: method → the permission that gates it. */
const METHOD_TO_PERMISSION = (() => {
  const map = new Map();
  for (const [name, def] of Object.entries(PERMISSIONS)) {
    for (const method of def.methods) map.set(method, name);
  }
  return map;
})();

export function permissionForMethod(method) {
  return METHOD_TO_PERMISSION.get(method) ?? null;
}

/** Everything holding `name` also confers, transitively. */
export function impliedBy(name, seen = new Set()) {
  for (const child of PERMISSIONS[name]?.implies ?? []) {
    if (seen.has(child)) continue;
    seen.add(child);
    impliedBy(child, seen);
  }
  return seen;
}

export const MAX_REASON = 120;

/**
 * How many servers one extension may be granted at runtime.
 *
 * Bounded because "the user typed it" stops being meaningful consent at the
 * fiftieth prompt, and an extension that needs a hundred hosts is describing a
 * proxy rather than a backup destination.
 */
export const MAX_USER_HOSTS = 8;

// ─── Manifest validation (§2.1) ──────────────────────────────────────────────

/**
 * Validate a manifest's `permissions` block.
 *
 * Returns { ok, errors, warnings, requested }. Two rules pull in opposite
 * directions on purpose (§1):
 *
 *   - An unknown key at the TOP level of the manifest is a warning, so an
 *     extension built against v3 still loads here.
 *   - An unknown key inside `permissions` is an ERROR, because a typo'd
 *     permission that is merely ignored means "not requested", and the
 *     extension then fails at runtime in a way nobody can read. Fail at build
 *     time where the author is looking.
 */
export function validatePermissions(permissions) {
  const errors = [];
  const warnings = [];
  const requested = [];

  if (permissions === undefined || permissions === null) {
    return { ok: true, errors, warnings, requested };
  }
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    return { ok: false, errors: ['permissions must be an object'], warnings, requested };
  }

  for (const [name, decl] of Object.entries(permissions)) {
    const def = PERMISSIONS[name];
    if (!def) {
      errors.push(`unknown permission "${name}" — a typo here would silently mean "not requested"`);
      continue;
    }
    if (def.ships === 'later') {
      warnings.push(`"${name}" is declared but not honoured yet; it will be inert`);
    }
    if (!decl || typeof decl !== 'object') {
      errors.push(`"${name}" must be an object with a reason`);
      continue;
    }

    const reason = decl.reason;
    if (typeof reason !== 'string' || reason.trim() === '') {
      errors.push(`"${name}" needs a reason — it is shown to the person deciding`);
    } else if (reason.length > MAX_REASON) {
      errors.push(`"${name}" reason is ${reason.length} characters; the limit is ${MAX_REASON}`);
    }

    if (def.needsHosts) {
      const hosts = decl.hosts;
      const wantsUserHosts = decl.userHosts !== undefined;

      if (wantsUserHosts) {
        const u = decl.userHosts;
        if (!u || typeof u !== 'object' || Array.isArray(u)) {
          errors.push('"network".userHosts must be an object');
        } else {
          if (typeof u.reason !== 'string' || u.reason.trim() === '') {
            errors.push('"network".userHosts needs its own reason — it is a separate question');
          } else if (u.reason.length > MAX_REASON) {
            errors.push(`"network".userHosts reason is ${u.reason.length} characters; the limit is ${MAX_REASON}`);
          }
          const max = u.max ?? 1;
          if (!Number.isInteger(max) || max < 1 || max > MAX_USER_HOSTS) {
            errors.push(`"network".userHosts.max must be a whole number from 1 to ${MAX_USER_HOSTS}`);
          }
        }
      }

      // An extension may declare no fixed hosts at all IF it asks for
      // user-supplied ones — a WebDAV client genuinely cannot know the server
      // in advance. What it may never do is ask for neither and expect the
      // network anyway.
      if ((!Array.isArray(hosts) || hosts.length === 0) && !wantsUserHosts) {
        errors.push('"network" needs a hosts array, or userHosts — an unbounded grant is not a grant');
      } else if (Array.isArray(hosts)) {
        for (const host of hosts) {
          const problem = hostProblem(host);
          if (problem) errors.push(`"network" host ${JSON.stringify(host)}: ${problem}`);
        }
      }
    } else if (decl.hosts !== undefined) {
      errors.push(`"${name}" does not take hosts`);
    }

    requested.push(name);
  }

  return { ok: errors.length === 0, errors, warnings, requested };
}

/**
 * Why a network host is unacceptable, or null if it is fine.
 *
 * One-label wildcards are allowed; a bare domain wildcard is not. The same rule
 * the site's CORS allowlist uses, for the same reason: `https://*.pages.dev`
 * grants every project anybody has ever deployed there.
 */
const WILDCARD_PLACEHOLDER = 'wildcard-placeholder';

/**
 * Characters a content security policy may contain.
 *
 * Defined here, next to host validation, and imported by `assertPolicySafe` —
 * one list, so the question "may this host be granted" and the question "may
 * this policy be assembled" cannot answer differently. They used to: a host
 * containing a double quote parsed to an origin containing a double quote,
 * passed every check here, and blew up at the far end where the policy was
 * built. Two charsets that must agree and are written down twice is a bug
 * waiting for the input that tells them apart.
 *
 * Square brackets are in the set because an IPv6 origin cannot be written
 * without them, and a CSP source expression allows them.
 */
export const POLICY_UNSAFE = /[^A-Za-z0-9 :/.*'_;,=?&%+[\]-]/g;

export function hostProblem(host) {
  if (typeof host !== 'string' || host === '') return 'must be a string';
  if (host === '*' || host === 'https://*') return 'a wildcard host is not a grant';
  const probe = host.replace('://*.', `://${WILDCARD_PLACEHOLDER}.`);
  let url;
  try {
    url = new URL(probe);
  } catch {
    return 'is not a URL';
  }
  if (url.protocol !== 'https:') return 'must be https';
  if (url.pathname !== '/' || url.search || url.hash) return 'must be an origin, with no path';
  if (host.includes('*')) {
    if (!host.startsWith('https://*.')) return 'a wildcard may only replace the first label';
    const rest = host.slice('https://*.'.length);
    if (rest.split('.').length < 2) return 'a wildcard may not stand for a whole domain';
  }

  // The string has to BE its own origin, not merely parse to one.
  //
  // Everything above tested the URL the parser produced, and every caller then
  // kept the author's text. The WHATWG parser is lenient exactly where the CSP
  // charset is not: it strips tabs, newlines and carriage returns anywhere in
  // the input, so `https://a\nb` was validated as `https://ab` and then stored
  // and written into the policy with the newline still in it. Building the
  // frame then threw, `activateExtension` caught it, and the extension was
  // silently dead with a manifest that passed every check.
  //
  // Comparing against `url.origin` closes the whole family at once — anything
  // the parser had to alter to make sense of is refused here rather than
  // discovered three layers down.
  if (canonicalHost(host) !== host) return 'must be written exactly as its own origin';

  // And the parser is lenient in one more direction: it will keep a character
  // in the host that no policy may contain, `"` being the one that matters,
  // and `origin` hands it straight back — so the comparison above passes and
  // the policy still cannot be assembled. Checked against the SAME list
  // `assertPolicySafe` uses, because the two agreeing is the whole point.
  const bad = host.match(POLICY_UNSAFE);
  if (bad) {
    return `may not contain ${JSON.stringify([...new Set(bad)].join(''))}`;
  }

  return null;
}

/**
 * The origin form of a host, or null if it is not one.
 *
 * Exported because storing this rather than the author's text is what makes
 * the grant and the policy the same string by construction. `hostProblem`
 * compares against it; callers that persist a host should save it.
 */
export function canonicalHost(host) {
  const raw = String(host ?? '');
  const wild = raw.startsWith('https://*.');
  const probe = wild ? raw.replace('://*.', `://${WILDCARD_PLACEHOLDER}.`) : raw;
  let origin;
  try {
    origin = new URL(probe).origin;
  } catch {
    return null;
  }
  // `origin` is "null" for opaque schemes, which is a string and would other-
  // wise compare as a perfectly good host.
  if (origin === 'null') return null;
  return wild ? origin.replace(`://${WILDCARD_PLACEHOLDER}.`, '://*.') : origin;
}

/** The hosts an extension declared under `network`, normalised to origins. */
export function declaredHosts(permissions) {
  const raw = permissions?.network?.hosts;
  if (!Array.isArray(raw)) return [];
  return raw.filter((h) => !hostProblem(h));
}

// ─── Content Security Policy (§2.3) ──────────────────────────────────────────

/**
 * Build the policy for an extension frame.
 *
 * Deny first, then grant. Never assembled by naming `connect-src` and hoping
 * the rest defaults sensibly: `connect-src` does not cover `<img>`, and an
 * image request is a perfectly good exfiltration channel — the URL carries the
 * payload and the response is irrelevant. Measured both ways.
 *
 * `hosts` is what the extension DECLARED intersected with what was GRANTED. An
 * extension whose `network` permission was refused gets no host anywhere in the
 * policy, so there is no channel out of the frame except postMessage — which is
 * `dispatch`, which is checked.
 */
export function buildCsp(hosts = []) {
  const clean = hosts.filter((h) => !hostProblem(h));
  const remote = clean.join(' ');

  const directives = [
    "default-src 'none'",
    "script-src 'unsafe-inline' blob:",
    "style-src 'unsafe-inline'",
    `img-src data: blob:${remote ? ` ${remote}` : ''}`,
    `media-src data: blob:${remote ? ` ${remote}` : ''}`,
    "font-src data:",
    remote ? `connect-src ${remote}` : "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    // No `frame-ancestors`. This policy is only ever delivered in a <meta>
    // tag, and the browser ignores that directive there — along with
    // `report-uri` and `sandbox` — so it protected nothing and logged
    //
    //   The Content Security Policy directive 'frame-ancestors' is ignored
    //   when delivered via a <meta> element.
    //
    // to the console every time an extension started. A directive that cannot
    // take effect is worse than no directive: it reads as a protection that is
    // in force, and it trains whoever is watching the console to scroll past
    // errors from the extension system.
    //
    // Nothing is lost. `frame-ancestors` says who may embed THIS document, and
    // the only thing that embeds it is AuthNo, which created it. What stops
    // the extension embedding anything is `frame-src 'none'`, which a <meta>
    // policy does enforce.
    "object-src 'none'",
    "worker-src blob:",
  ];
  return directives.join('; ') + ';';
}

// ─── Grants and enforcement (§2.3, §2.4) ─────────────────────────────────────

export class PermissionDenied extends Error {
  constructor(permission, method) {
    super(`permission-denied: ${method} needs "${permission}"`);
    this.name = 'PermissionDenied';
    this.code = 'permission-denied';
    this.permission = permission;
    this.method = method;
  }
}

export class UnknownMethod extends Error {
  constructor(method) {
    super(`unknown-method: ${method}`);
    this.name = 'UnknownMethod';
    this.code = 'unknown-method';
    this.method = method;
  }
}

/**
 * One extension's grants, plus a record of what it was refused.
 *
 * The ledger is not bookkeeping for its own sake. The spec requires the app to
 * notice when an extension needs something it does not have and say so, rather
 * than letting the extension appear broken — "Cloud Backup tried to read your
 * library 12 times but does not have permission" is a sentence the Extensions
 * tab can only write if somebody counted.
 */
export class PermissionSet {
  constructor(granted = [], { requested = [], hosts = [], userHosts = [], maxUserHosts = 0 } = {}) {
    this.granted = new Set(granted);
    this.requested = new Set(requested);
    this.hosts = hosts.filter((h) => !hostProblem(h));
    /**
     * Servers the user named at runtime.
     *
     * A WebDAV client cannot know its server in advance, and no wildcard is an
     * honest substitute — `https://*` is not a grant, it is the absence of one.
     * So the address the user types IS the grant: they are told which host is
     * about to be reachable, they agree, and it joins the policy. That keeps
     * the property the whole design rests on, which is that the CSP lists real
     * origins rather than a promise about future ones.
     */
    this.userGranted = [...new Set(userHosts.filter((h) => !hostProblem(h)))].slice(0, maxUserHosts);
    this.maxUserHosts = maxUserHosts;
    this.denials = new Map();   // permission → { count, methods:Set, firstAt, lastAt }
  }

  /** Direct grant, or one implied by a grant — see `implies` in PERMISSIONS. */
  has(permission) {
    if (this.granted.has(permission)) return true;
    for (const held of this.granted) {
      if (impliedBy(held).has(permission)) return true;
    }
    return false;
  }

  /** Grant/revoke take effect immediately — §2.4 requires no restart. */
  grant(permission) {
    if (!PERMISSIONS[permission]) return false;
    this.granted.add(permission);
    this.denials.delete(permission);
    return true;
  }

  revoke(permission) { return this.granted.delete(permission); }

  /**
   * The door. Throws PermissionDenied, which `dispatch` turns into a rejected
   * call the extension can catch — a refusal is an answer, not a crash.
   *
   * A method nobody declared is UnknownMethod rather than a denial: an
   * extension calling something that does not exist has a bug, and telling it
   * "permission denied" would send the author looking in the wrong place.
   */
  require(method, now = Date.now()) {
    if (FREE_METHODS.has(method)) return true;

    const permission = permissionForMethod(method);
    if (!permission) throw new UnknownMethod(method);
    if (this.has(permission)) return true;

    // Record the denial against the permission the AUTHOR DECLARED, when one
    // of those would have covered this method by implication.
    //
    // Otherwise the warning names a permission nobody asked for: Cloud Backup
    // declares library:read:all, calls library.get, and library.get is gated by
    // library:read:current — so the honest-looking version tells the user to
    // grant "Read the book you have open" when the thing on the consent screen
    // says "Read all your books". The user cannot act on that.
    let attributed = permission;
    if (!this.requested.has(permission)) {
      for (const req of this.requested) {
        if (impliedBy(req).has(permission)) { attributed = req; break; }
      }
    }

    const entry = this.denials.get(attributed)
      ?? { count: 0, methods: new Set(), firstAt: now, lastAt: now };
    entry.count += 1;
    entry.methods.add(method);
    entry.lastAt = now;
    this.denials.set(attributed, entry);

    // The thrown error still names the permission that actually gates the call,
    // because that is what the extension author needs in order to fix it.
    throw new PermissionDenied(permission, method);
  }

  /**
   * What the Extensions tab needs to warn about, worst first.
   *
   * `wasRequested` separates the two cases that look identical from here and
   * are not: a permission the author declared and the user refused is the
   * user's decision to revisit, while one the extension never declared at all
   * is the author's bug.
   */
  missing() {
    return [...this.denials.entries()]
      .map(([permission, e]) => ({
        permission,
        prompt: PERMISSIONS[permission]?.prompt ?? permission,
        count: e.count,
        methods: [...e.methods].sort(),
        firstAt: e.firstAt,
        lastAt: e.lastAt,
        wasRequested: this.requested.has(permission),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** Hosts to put in the CSP: declared and granted, plus any the user named. */
  effectiveHosts() {
    if (!this.has('network')) return [];
    return [...new Set([...this.hosts, ...this.userGranted])];
  }

  /** Just the runtime ones, for the settings screen to list and revoke. */
  userHosts() { return [...this.userGranted]; }

  canRequestHost() { return this.has('network') && this.userGranted.length < this.maxUserHosts; }

  /**
   * Record a host the user agreed to.
   *
   * Returns { ok, host, changed }. `changed` is false when the host was
   * already granted, which matters to the caller: see §restart below — a
   * policy that did not change must not cost the extension a restart.
   */
  grantHost(url) {
    if (!this.has('network')) return { ok: false, reason: 'no-network-permission' };
    const problem = hostProblem(url);
    if (problem) return { ok: false, reason: 'bad-host', detail: problem };
    if (this.userGranted.includes(url)) return { ok: true, host: url, changed: false };
    if (this.userGranted.length >= this.maxUserHosts) {
      return { ok: false, reason: 'too-many-hosts', max: this.maxUserHosts };
    }
    this.userGranted.push(url);
    return { ok: true, host: url, changed: true };
  }

  revokeHost(url) {
    const i = this.userGranted.indexOf(url);
    if (i < 0) return false;
    this.userGranted.splice(i, 1);
    return true;
  }

  /** Everything in force, implications expanded — for the settings screen. */
  effective() {
    const out = new Set(this.granted);
    for (const held of this.granted) for (const p of impliedBy(held)) out.add(p);
    return [...out].sort();
  }

  csp() { return buildCsp(this.effectiveHosts()); }

  toJSON() {
    // userHosts is persisted: a server the user named once should not have to
    // be named again on every launch.
    return { granted: [...this.granted].sort(), hosts: this.hosts, userHosts: [...this.userGranted] };
  }
}

/**
 * What to prompt for on install, or on update.
 *
 * On update only the DELTA is prompted (§9): re-asking for permissions somebody
 * already considered is how a prompt becomes a thing to dismiss. A permission
 * that disappeared from the manifest is dropped rather than kept, so an
 * extension cannot retain a grant by removing the declaration that explained it.
 */
export function promptPlan(manifestPermissions, previouslyGranted = []) {
  const { requested, errors } = validatePermissions(manifestPermissions);
  const had = new Set(previouslyGranted);

  const toPrompt = [];
  const carried = [];
  for (const name of requested) {
    if (had.has(name)) carried.push(name);
    else toPrompt.push(name);
  }
  const dropped = [...had].filter((p) => !requested.includes(p));

  return {
    ok: errors.length === 0,
    errors,
    prompt: toPrompt.map((name) => ({
      permission: name,
      prompt: PERMISSIONS[name]?.prompt ?? name,
      reason: manifestPermissions?.[name]?.reason ?? '',
      hosts: name === 'network' ? declaredHosts(manifestPermissions) : undefined,
    })),
    carried,
    dropped,
  };
}

/**
 * Build a PermissionSet from a manifest and the grants on record.
 *
 * A grant is only honoured while the manifest still asks for it, so an update
 * that quietly stops declaring `library:read:all` also stops being able to use
 * it — the declaration is the thing the user agreed to.
 */
export function permissionSetFor(manifest, grantedNames = [], userHosts = []) {
  const permissions = manifest?.permissions ?? {};
  const { requested } = validatePermissions(permissions);
  const honoured = grantedNames.filter((g) => requested.includes(g));
  const declaredMax = permissions?.network?.userHosts
    ? Math.min(MAX_USER_HOSTS, permissions.network.userHosts.max ?? 1)
    : 0;
  return new PermissionSet(honoured, {
    requested,
    hosts: declaredHosts(permissions),
    userHosts,
    maxUserHosts: declaredMax,
  });
}
