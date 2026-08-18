/**
 * extensionHostV2.js — assembling one running extension.
 *
 * Spec: docs/extension-system-v2-spec.md §1, §2.3, §4, §5, §9.
 *
 * Everything the v2 work has built so far is a piece: the permission set, the
 * dispatcher, the capabilities, the `when` language, the CSP. This is where
 * they are put together, and it is deliberately the only place that knows the
 * order:
 *
 *     manifest → validate → grants → PermissionSet → capabilities → dispatch
 *                                          ↓
 *                                    CSP → frame document
 *
 * Two enforcement points, and they must be built from the SAME PermissionSet.
 * A frame whose CSP was generated from the manifest while dispatch checks the
 * grants would let a refused `network` permission still reach the network,
 * because the CSP is what actually stops that one. So `csp()` is read off the
 * permission set rather than recomputed here.
 *
 * v1 manifests are refused rather than adapted (§9). Guessing what a v1
 * extension's permissions would have been means guessing "all of them", and
 * that guess is wrong in the direction that costs somebody their manuscripts.
 */

import {
  permissionSetFor, validatePermissions, promptPlan, hostProblem,
} from './extensionPermissionsV2.js';
import { createDispatch, freeCapabilities, activityCapabilities } from './extensionDispatchV2.js';
import { libraryCapabilities } from './extensionLibraryV2.js';
import { parseWhen } from './whenClause.js';

export const API_VERSION = 2;

/** Contribution slots, and the one target each entry may name (§4). */
const CONTRIBUTION_SLOTS = [
  'settings', 'homescreen', 'bookActions', 'chapterActions', 'editorToolbar', 'widgets',
];
const TARGETS = ['page', 'command', 'panel'];
const PAGE_TYPES = ['ui-file', 'url'];

export class ManifestError extends Error {
  constructor(errors) {
    super(`invalid v2 manifest: ${errors.join('; ')}`);
    this.name = 'ManifestError';
    this.errors = errors;
  }
}

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate a v2 manifest.
 *
 * The asymmetry in §1 is deliberate and is the reason this is not one loop:
 * an unknown key at the TOP level is a warning, so an extension built against
 * a future version still loads; an unknown key inside `permissions` is an
 * error, because a typo there means "not requested" and the extension then
 * fails at runtime somewhere nobody is looking.
 */
export function validateManifestV2(manifest) {
  const errors = [];
  const warnings = [];

  if (!isPlain(manifest)) return { ok: false, errors: ['manifest must be an object'], warnings };

  if (manifest.apiVersion !== API_VERSION) {
    errors.push(
      manifest.apiVersion === undefined
        ? 'apiVersion is missing; v2 extensions must declare "apiVersion": 2'
        : `apiVersion ${JSON.stringify(manifest.apiVersion)} is not supported — rebuild against v2`,
    );
    // Nothing below is meaningful for a manifest of another version.
    return { ok: false, errors, warnings };
  }

  for (const key of ['id', 'name', 'version']) {
    if (typeof manifest[key] !== 'string' || manifest[key].trim() === '') {
      errors.push(`${key} is required`);
    }
  }
  if (typeof manifest.id === 'string' && !/^[\w.-]+$/.test(manifest.id)) {
    // The id keys the install directory, the storage namespace and the grants,
    // so a path separator in it is a traversal in three places at once.
    errors.push('id may contain only letters, digits, dot, dash and underscore');
  }

  const perms = validatePermissions(manifest.permissions);
  errors.push(...perms.errors);
  warnings.push(...perms.warnings);

  const pages = manifest.pages;
  if (pages !== undefined) {
    if (!isPlain(pages)) errors.push('pages must be an object');
    else {
      for (const [pageId, page] of Object.entries(pages)) {
        if (!isPlain(page)) { errors.push(`page "${pageId}" must be an object`); continue; }
        if (!PAGE_TYPES.includes(page.type)) {
          errors.push(`page "${pageId}" needs a type of ${PAGE_TYPES.join(' or ')}`);
        }
        if (page.type === 'ui-file' && typeof page.file !== 'string') {
          errors.push(`page "${pageId}" needs a file`);
        }
        if (page.type === 'url') {
          if (typeof page.url !== 'string' || !/^https:\/\//i.test(page.url)) {
            errors.push(`page "${pageId}" needs an https url`);
          }
          // A remote page is a frame pointed at somebody else's server, so it
          // is only coherent when the extension also asked for the network.
          if (!perms.requested.includes('network')) {
            errors.push(`page "${pageId}" is a url page, which needs the network permission`);
          }
        }
      }
    }
  }

  const contributes = manifest.contributes;
  if (contributes !== undefined) {
    if (!isPlain(contributes)) errors.push('contributes must be an object');
    else {
      for (const [slot, entries] of Object.entries(contributes)) {
        if (!CONTRIBUTION_SLOTS.includes(slot)) {
          warnings.push(`unknown contribution slot "${slot}" — ignored`);
          continue;
        }
        if (!Array.isArray(entries)) { errors.push(`contributes.${slot} must be an array`); continue; }
        entries.forEach((entry, i) => {
          const where = `contributes.${slot}[${i}]`;
          if (!isPlain(entry)) { errors.push(`${where} must be an object`); return; }
          if (typeof entry.id !== 'string' || !entry.id) errors.push(`${where} needs an id`);
          if (typeof entry.label !== 'string' || !entry.label) errors.push(`${where} needs a label`);

          const named = TARGETS.filter((t) => entry[t] !== undefined);
          if (named.length === 0) errors.push(`${where} needs one of ${TARGETS.join(', ')}`);
          if (named.length > 1) {
            // v1's bug, in the other direction: every button opened the same
            // page because a contribution had only one possible target. Two
            // targets is the same ambiguity read from the other side.
            errors.push(`${where} names ${named.join(' and ')} — a contribution has exactly one target`);
          }
          if (entry.page !== undefined && !isPlain(pages)) {
            errors.push(`${where} points at page "${entry.page}" but there are no pages`);
          } else if (entry.page !== undefined && !(entry.page in pages)) {
            errors.push(`${where} points at page "${entry.page}", which does not exist`);
          }
          if (entry.when !== undefined) {
            try { parseWhen(entry.when); } catch (e) { errors.push(`${where} when: ${e.message}`); }
          }
        });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * The frame document, carrying the policy.
 *
 * The CSP goes in a meta tag inside the srcdoc, and that is not a weak spot:
 * measured, a frame cannot remove the meta, inject a looser policy, reach the
 * network with XHR, or nest a frame to escape it. What the frame *cannot* be
 * given is `allow-same-origin` — srcdoc inherits the embedder's origin, so
 * `allow-scripts allow-same-origin` together is not a sandbox at all.
 */
export function frameDocumentV2({ csp, bootstrap }) {
  const policy = assertPolicySafe(csp);
  const close = `</${'script'}>`;
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(policy)}">`
    + `<script>${bootstrap}${close}`
    + '</head><body></body></html>';
}

/**
 * A CSP is built from a closed vocabulary — directive names, scheme names,
 * origins, and a handful of quoted keywords. Nothing legitimate in one needs
 * `<`, `>`, `&` or a backtick.
 *
 * So the policy is VALIDATED rather than merely escaped. Escaping the quote is
 * enough to keep the string inside the attribute today, but it makes the safety
 * of the document depend on one substitution being right forever, and a policy
 * containing markup at all means something upstream is already wrong — a host
 * that slipped past `hostProblem`, or a caller passing attacker input straight
 * in. Better to refuse than to neutralise and carry on.
 */
export function assertPolicySafe(csp) {
  const text = String(csp ?? '');
  const bad = text.match(/[^A-Za-z0-9 :/.*'_;,=?&%+-]/g);
  if (bad) {
    throw new Error(`content security policy contains ${JSON.stringify([...new Set(bad)].join(''))}`);
  }
  return text;
}

/** Belt to the validator's braces: the attribute is escaped as well. */
function escapeAttr(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Assemble one extension.
 *
 * @param {object} o
 * @param {object}   o.manifest
 * @param {string[]} o.granted     permissions on record for this extension
 * @param {object}   o.handlers    app-side implementations, injected
 * @param {object}   [o.meter]     the activity meter
 * @param {Function} [o.push]      deliver an event into the frame
 * @param {Function} [o.onDenied]
 */
export function createExtensionHost({
  manifest, granted = [], userHosts = [], handlers,
  meter = null, push = () => {}, onDenied = null,
}) {
  const check = validateManifestV2(manifest);
  if (!check.ok) throw new ManifestError(check.errors);

  const permissions = permissionSetFor(manifest, granted, userHosts);

  const capabilities = {
    ...freeCapabilities({
      extId: manifest.id,
      storage: handlers.storage,
      ui: handlers.ui,
      app: handlers.app,
    }),
    ...libraryCapabilities(handlers.library),
    ...(handlers.browser ? browserCapabilities(handlers.browser) : {}),
    ...(handlers.network
      ? networkCapabilities({ extId: manifest.id, permissions, ...handlers.network })
      : {}),
  };

  let activity = null;
  if (meter) {
    activity = activityCapabilities({ meter, push });
    Object.assign(capabilities, activity);
    delete capabilities.__unsubscribe;
  }

  const dispatch = createDispatch({
    extId: manifest.id,
    permissions,
    capabilities,
    onDenied: onDenied
      ? (permission, method) => onDenied(manifest.id, permission, method)
      : null,
  });

  return {
    id: manifest.id,
    manifest,
    permissions,
    dispatch,
    warnings: check.warnings,

    /** The policy in force right now — read from the permission set, not rebuilt. */
    csp: () => permissions.csp(),
    document: (bootstrap) => frameDocumentV2({ csp: permissions.csp(), bootstrap }),

    /** What the Extensions tab should warn about (§2.3). */
    missingPermissions: () => permissions.missing(),

    /** Stop answering, and let go of anything that outlives the frame. */
    dispose() {
      dispatch.dispose();
      if (activity) activity.__unsubscribe();
    },
  };
}

/**
 * `network.requestHost` — the extension asks, the user answers, the host joins
 * the policy.
 *
 * The awkward part is honest rather than hidden: **the policy lives in the
 * frame's document**, and a document cannot be re-policied once it has loaded.
 * So a newly granted host does not reach the running frame — the extension has
 * to be restarted for it to take effect, and the result says so rather than
 * resolving true and leaving the extension wondering why its fetch still fails.
 *
 * That is a real cost of putting the CSP in the document, and it is still the
 * right place for it: a policy the frame cannot edit beats one it could.
 *
 * @param {Function} ask     (extId, url) => Promise<boolean>  the user's answer
 * @param {Function} persist (extId, hosts) => void
 * @param {Function} [onGranted] (extId) => void — the app may restart the frame
 */
export function networkCapabilities({ extId, permissions, ask, persist, onGranted = null }) {
  return {
    'network.requestHost': async ([url]) => {
      const wanted = String(url ?? '');

      if (!permissions.canRequestHost()) {
        const why = permissions.has('network') ? 'too-many-hosts' : 'no-network-permission';
        return { ok: false, reason: why };
      }
      // Checked before the user is asked, so nobody is prompted to approve
      // something that was never going to be accepted.
      const problem = hostProblem(wanted);
      if (problem) return { ok: false, reason: 'bad-host', detail: problem };

      if (permissions.userHosts().includes(wanted)) {
        return { ok: true, host: wanted, alreadyGranted: true, needsRestart: false };
      }

      const agreed = await ask(extId, wanted);
      if (!agreed) return { ok: false, reason: 'declined' };

      const result = permissions.grantHost(wanted);
      if (!result.ok) return result;

      persist(extId, permissions.userHosts());
      if (onGranted) { try { onGranted(extId); } catch { /* the app's problem */ } }

      return { ok: true, host: wanted, alreadyGranted: false, needsRestart: result.changed };
    },
  };
}

/** `browser` and `auth.*`, which are one permission because they are one act. */
export function browserCapabilities(browser) {
  return {
    'browser.open': async ([url]) => {
      const target = String(url ?? '');
      // https only, checked here rather than trusted from the frame: an
      // extension that could pass javascript: or file: would be choosing what
      // the host opens, not merely asking it to open something.
      if (!/^https:\/\//i.test(target)) {
        throw new Error('browser.open needs an https URL');
      }
      return browser.open(target);
    },
    'browser.close': async () => browser.close(),
    'auth.oauth': async ([opts]) => browser.oauth(opts ?? {}),
    'auth.googleSignIn': async ([opts]) => browser.googleSignIn(opts ?? {}),
    'auth.requestDriveToken': async ([opts]) => browser.requestDriveToken(opts ?? {}),
  };
}

/** Re-exported so the install flow has one import for the whole v2 surface. */
export { promptPlan };
