/**
 * extensionGrants.js — what the user said yes to, on disk.
 *
 * Spec: docs/extension-system-v2-spec.md §2.4, §9.
 *
 * Small on purpose. Grants are the one piece of extension state the extension
 * itself must never be able to touch, so they live apart from its storage
 * namespace rather than inside it — an extension that could write its own
 * grants would not need to ask for anything.
 *
 * They are also the thing that has to be *destroyed* on uninstall. Reinstalling
 * the same id would otherwise silently inherit every permission a previous
 * version was given, and the id is chosen by the author.
 */

import { PERMISSIONS, hostProblem } from './extensionPermissionsV2';

const KEY = (extId) => `__authno_ext_grants_${extId}`;

/**
 * Read the grants on record.
 *
 * Anything unrecognised is dropped rather than trusted: a permission name that
 * is no longer in the set, or a host that would not pass validation today, must
 * not become effective just because it was written down once.
 *
 * `asked` is the third thing, and it is not a grant. "You said no" and "nobody
 * put the question to you" are the same empty array and completely different
 * to a person — an install from a cold-start intent or a share-sheet handoff
 * never gets to ask, and the extension then runs, does nothing, and explains
 * nothing. The installer used to answer this with a flag on its return value,
 * which nothing persisted, so the one screen that exists to say so could never
 * find out. It belongs here: this record is written at install and destroyed
 * on uninstall, which is exactly the lifetime of the answer.
 *
 * A record written before this existed reads as `asked: true`. Those installs
 * did put the question — the paths that skip it are the ones this flag was
 * added for — and defaulting the other way would nag every existing user about
 * a decision they already made.
 */
export function readGrants(extId) {
  try {
    const raw = localStorage.getItem(KEY(extId));
    if (!raw) return { granted: [], userHosts: [], asked: false };
    const parsed = JSON.parse(raw);
    return {
      granted: Array.isArray(parsed?.granted)
        ? parsed.granted.filter((p) => typeof p === 'string' && PERMISSIONS[p])
        : [],
      userHosts: Array.isArray(parsed?.userHosts)
        ? parsed.userHosts.filter((h) => typeof h === 'string' && !hostProblem(h))
        : [],
      asked: parsed?.asked !== false,
    };
  } catch {
    // A store that will not parse is treated as no grants at all. Failing
    // closed is the only safe direction here.
    return { granted: [], userHosts: [], asked: false };
  }
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.asked] whether the question was put. Omitted keeps
 *   whatever is on record, so the callers that only change permissions — the
 *   Extensions tab, a host granting a typed WebDAV address — do not have to
 *   know this exists.
 */
export function writeGrants(extId, granted = [], userHosts = [], opts = {}) {
  try {
    const asked = opts.asked === undefined ? readGrants(extId).asked : !!opts.asked;
    localStorage.setItem(KEY(extId), JSON.stringify({
      granted: [...new Set(granted.filter((p) => PERMISSIONS[p]))].sort(),
      userHosts: [...new Set(userHosts.filter((h) => !hostProblem(h)))],
      asked,
    }));
    return true;
  } catch {
    return false;
  }
}

/** Called on uninstall. See the note above for why this is not optional. */
export function clearGrants(extId) {
  try { localStorage.removeItem(KEY(extId)); return true; } catch { return false; }
}
