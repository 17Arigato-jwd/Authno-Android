/**
 * extensionSettingsModel.js — what the Extensions tab shows.
 *
 * Spec: docs/extension-system-v2-spec.md §6.1 and §2.3.
 *
 * A view-model, not a component. It answers "what should be on this screen"
 * from the manifests, the grants and the ledger, and a component renders the
 * result. The split is not tidiness: every rule below is a decision somebody
 * made, and a decision buried in JSX is a decision nobody can test.
 *
 * The rules this file exists to hold:
 *
 *   - The tab **does not exist** until an extension is installed. An empty
 *     settings section is a promise the app has not kept.
 *   - A disabled extension is **greyed, not hidden** — icon included. One you
 *     cannot find is one you cannot re-enable.
 *   - Every permission gets a row with a toggle, whether granted or not, so
 *     the screen is the whole list rather than only what was said yes to.
 *   - A permission an extension keeps reaching for and does not have is
 *     **surfaced**, because the alternative is an extension that silently
 *     looks broken.
 *
 * COPY REVIEW: every user-visible string this module produces is in `STRINGS`
 * at the bottom, in one place, so it can be read and approved without reading
 * the logic. Nothing here writes prose inline.
 */

import { PERMISSIONS } from './extensionPermissionsV2.js';
import { validateSchema, reconcileValues } from './extensionSettingsSchema.js';

/** Why an extension is not running. Ordered: the first true one wins. */
export const BLOCKED = {
  TOO_OLD: 'too-old',
  LOCKED: 'locked',
  DISABLED: 'disabled',
  FAILED: 'failed',
};

/**
 * Build the tab.
 *
 * @param {object} o
 * @param {object[]} o.extensions  installed manifests, annotated by the loader
 * @param {Function} o.grantsFor   (extId) => string[]
 * @param {Function} [o.hostFor]   (extId) => running host, or null
 * @param {Function} [o.valuesFor] (extId) => stored settings values
 */
export function buildExtensionsTab({
  extensions = [],
  grantsFor = () => [],
  hostFor = () => null,
  valuesFor = () => ({}),
  userHostsFor = () => [],
} = {}) {
  const installed = Array.isArray(extensions) ? extensions.filter(Boolean) : [];

  // The tab is absent, not empty. A settings section that exists and says
  // "nothing here" is a worse answer than not being there.
  if (installed.length === 0) return { exists: false, rows: [] };

  const rows = installed
    .map((manifest) => buildRow({ manifest, grantsFor, hostFor, valuesFor, userHostsFor }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    exists: true,
    rows,
    /** For a badge on the tab itself: how many extensions want attention. */
    needsAttention: rows.filter((r) => r.warnings.length > 0).length,
  };
}

function buildRow({ manifest, grantsFor, hostFor, valuesFor, userHostsFor }) {
  const extId = String(manifest.id);
  const granted = new Set(grantsFor(extId) ?? []);
  const host = hostFor(extId);

  const blocked = manifest._tooOld ? BLOCKED.TOO_OLD
    : manifest._locked ? BLOCKED.LOCKED
      : manifest.enabled === false ? BLOCKED.DISABLED
        : manifest._failed ? BLOCKED.FAILED
          : null;

  // Greyed, not hidden — and the icon greys with everything else, so a
  // disabled extension does not sit in the list looking active.
  const dimmed = blocked !== null;

  const permissions = permissionRows(manifest, granted, userHostsFor(extId) ?? []);
  const warnings = warningRows({ manifest, host, permissions, blocked });

  const schema = manifest.settings?.schema;
  const schemaCheck = validateSchema(schema);
  const settings = schemaCheck.ok
    ? { schema: schema ?? [], ...reconcileValues(schema, valuesFor(extId)) }
    : { schema: [], values: {}, dropped: [], reset: [], errors: schemaCheck.errors };

  return {
    id: extId,
    name: String(manifest.name ?? extId),
    version: String(manifest.version ?? ''),
    author: String(manifest.author ?? ''),
    icon: manifest.icon ?? null,
    installedAt: manifest.installedAt ?? null,

    running: !!host,
    blocked,
    dimmed,
    // Carried explicitly so a component cannot decide to dim the row and leave
    // the icon bright, which is the version of this that looks like a bug.
    dimIcon: dimmed,

    permissions,
    warnings,
    settings,

    actions: {
      canToggleEnabled: blocked !== BLOCKED.TOO_OLD && blocked !== BLOCKED.LOCKED,
      canUpdateFromFile: true,
      canUninstall: true,
      canOpenSettingsPage: schemaCheck.ok && (schema?.length ?? 0) > 0,
    },
  };
}

/**
 * One row per permission the manifest declares — granted or not.
 *
 * Showing only the granted ones would make the screen a list of what was said
 * yes to, when what somebody wants is the whole list with its answers.
 */
function permissionRows(manifest, granted, userHosts) {
  const declared = manifest.permissions ?? {};
  return Object.keys(declared)
    .filter((name) => PERMISSIONS[name])
    .map((name) => ({
      permission: name,
      prompt: PERMISSIONS[name].prompt,
      // The author's own words, verbatim, next to the toggle that acts on them.
      reason: String(declared[name]?.reason ?? ''),
      granted: granted.has(name),
      hosts: name === 'network' ? (declared[name]?.hosts ?? []) : undefined,
      // Servers the user named at runtime, listed separately and each
      // revocable. A grant you cannot see is a grant you cannot take back,
      // and these are the ones the manifest never mentioned.
      userHosts: name === 'network' ? [...userHosts] : undefined,
      canAddHost: name === 'network' ? !!declared[name]?.userHosts : undefined,
      // A deferred permission can be declared but does nothing yet, and a
      // toggle that changes nothing is worse than one that is not offered.
      inert: PERMISSIONS[name].ships === 'later',
    }))
    .sort((a, b) => a.permission.localeCompare(b.permission));
}

/**
 * What to tell the user, worst first.
 *
 * The missing-permission case is the one the spec asks for by name: an
 * extension that keeps being refused looks broken, and the app knows exactly
 * why, so it should say so rather than leaving somebody to guess.
 */
function warningRows({ manifest, host, permissions, blocked }) {
  const out = [];

  // "Nobody asked you" is a different state from "you said no", and it needs a
  // different sentence and a different button. An extension installed without
  // its questions ever being put runs perfectly, does nothing, and explains
  // nothing — which from the outside is indistinguishable from broken.
  if (manifest._permissionsPending) {
    const unanswered = permissions.filter((p) => !p.granted && !p.inert);
    if (unanswered.length) {
      out.push({
        kind: 'permissions-unanswered',
        text: STRINGS.permissionsUnanswered,
        permissions: unanswered.map((p) => p.permission),
        count: Number.MAX_SAFE_INTEGER,   // sorts above the ledger warnings
        canFixHere: true,
      });
    }
  }

  if (blocked === BLOCKED.TOO_OLD) {
    out.push({ kind: 'too-old', text: STRINGS.tooOld, minAppVersion: manifest.minAppVersion ?? null });
  }
  if (blocked === BLOCKED.FAILED) {
    out.push({ kind: 'failed', text: STRINGS.failed });
  }

  for (const m of host?.missingPermissions?.() ?? []) {
    const row = permissions.find((p) => p.permission === m.permission);
    out.push({
      kind: 'missing-permission',
      permission: m.permission,
      count: m.count,
      // Declared and refused is the user's decision to revisit; never declared
      // is the author's bug, and the two deserve different sentences.
      text: m.wasRequested ? STRINGS.permissionRefused : STRINGS.permissionUndeclared,
      canFixHere: !!row && !row.granted,
      prompt: m.prompt,
    });
  }

  const settingsErrors = manifest.settings?.schema
    ? validateSchema(manifest.settings.schema).errors
    : [];
  if (settingsErrors.length) {
    out.push({ kind: 'bad-settings-schema', text: STRINGS.badSchema, errors: settingsErrors });
  }

  return out.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
}

/**
 * Every user-visible string this module produces.
 *
 * Deliberately in one block. These describe consequences rather than
 * mechanism — what happened and what can be done about it — and they are here
 * so they can be reviewed as copy rather than found scattered through logic.
 */
export const STRINGS = {
  tooOld: 'This extension needs a newer version of AuthNo.',
  failed: 'This extension did not start.',
  permissionRefused: 'This extension has been asking for a permission it does not have.',
  permissionUndeclared: 'This extension is asking for something it never requested.',
  badSchema: 'This extension\'s settings could not be read.',
  permissionsUnanswered: 'This extension has not been asked what it may do yet.',
};
