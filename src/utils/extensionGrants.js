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
 */
export function readGrants(extId) {
  try {
    const raw = localStorage.getItem(KEY(extId));
    if (!raw) return { granted: [], userHosts: [] };
    const parsed = JSON.parse(raw);
    return {
      granted: Array.isArray(parsed?.granted)
        ? parsed.granted.filter((p) => typeof p === 'string' && PERMISSIONS[p])
        : [],
      userHosts: Array.isArray(parsed?.userHosts)
        ? parsed.userHosts.filter((h) => typeof h === 'string' && !hostProblem(h))
        : [],
    };
  } catch {
    // A store that will not parse is treated as no grants at all. Failing
    // closed is the only safe direction here.
    return { granted: [], userHosts: [] };
  }
}

export function writeGrants(extId, granted = [], userHosts = []) {
  try {
    localStorage.setItem(KEY(extId), JSON.stringify({
      granted: [...new Set(granted.filter((p) => PERMISSIONS[p]))].sort(),
      userHosts: [...new Set(userHosts.filter((h) => !hostProblem(h)))],
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
