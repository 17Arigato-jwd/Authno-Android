/**
 * penName.js — rules for the handle shown inside the app.
 *
 * This is the LOCAL pen name from onboarding, stored in `authno_profile`. It
 * is not the account username: that one lives on the gate, which is
 * authoritative for it and enforces its own copy of these rules server-side
 * (worker/src/lib/username.js in the website repo).
 *
 * Two separate fields needing the same answer is a duplication, and the honest
 * options were to duplicate the rule or to leave the local one unchecked. It
 * was unchecked — the onboarding field was `onChange={(e) =>
 * setUsername(e.target.value)}` straight into storage, so a pen name could be
 * `admin`, `root`, or `AuthNo Support`, with nothing anywhere to say otherwise.
 *
 * Duplicated deliberately, then, and the two must be kept in step. The worker
 * is the source of truth; if a name is added there, add it here. The app can
 * afford to be no stricter than the gate, because a handle the gate would
 * refuse is one the writer cannot ever actually register.
 */

const RESERVED = new Set([
  'admin', 'administrator', 'authno', 'auth_no', 'extbk', 'root', 'system',
  'support', 'help', 'staff', 'team', 'official', 'mod', 'moderator',
  'owner', 'founder', 'dev', 'developer', 'api', 'www', 'mail', 'billing',
  'security', 'info', 'contact', 'abuse', 'webmaster', 'postmaster',
  'anonymous', 'guest', 'null', 'undefined', 'everyone', 'here',
]);

const BRAND_PREFIX = 'authno';
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };

/** Strip the leading @ people type out of habit, then normalise. */
export function normalizePenName(input) {
  return String(input ?? '')
    .trim()
    .replace(/^@+/, '')
    .normalize('NFKC')
    .toLowerCase();
}

/**
 * The shape a reader would mistake the name for.
 *
 * Whole-name only, never a substring: matching substrings would refuse
 * `badminton` for containing `admin`.
 */
export function reservedSkeleton(norm) {
  return String(norm || '')
    .replace(/_/g, '')
    .replace(/[013457]/g, (d) => LEET[d])
    .replace(/\d+$/, '');
}

export function isReserved(norm) {
  if (RESERVED.has(norm)) return true;
  const skeleton = reservedSkeleton(norm);
  if (skeleton && RESERVED.has(skeleton)) return true;
  return skeleton.startsWith(BRAND_PREFIX);
}

/**
 * @returns {{ ok: boolean, reason?: string, message?: string }}
 *
 * The pen name is optional, so blank is valid — the field says "(optional)"
 * and a form that accepts nothing then complains about it is worse than one
 * that never asked.
 */
export function validatePenName(input) {
  const norm = normalizePenName(input);
  if (!norm) return { ok: true };

  if (norm.length < 3) {
    return { ok: false, reason: 'too-short', message: 'A little longer — three characters or more.' };
  }
  if (norm.length > 20) {
    return { ok: false, reason: 'too-long', message: 'A little shorter — twenty characters at most.' };
  }
  if (!/^[a-z0-9_]+$/.test(norm)) {
    return { ok: false, reason: 'bad-characters', message: 'Letters, numbers and underscores only.' };
  }
  if (/^_+$/.test(norm) || /^\d+$/.test(norm)) {
    return { ok: false, reason: 'bad-characters', message: 'Needs at least one letter in it.' };
  }
  if (isReserved(norm)) {
    return { ok: false, reason: 'reserved', message: 'That one is kept for AuthNo itself. Try another.' };
  }
  return { ok: true };
}

/** What actually gets stored: normalised, or empty when it was left blank. */
export function cleanPenName(input) {
  const norm = normalizePenName(input);
  return validatePenName(norm).ok ? norm : '';
}
