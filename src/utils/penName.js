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

/**
 * Cyrillic letters that are drawn the same as a Latin one.
 *
 * The one-script rule stops a MIXED name, but an all-Cyrillic name can still
 * spell something that reads as Latin — `аdmіn` is five Cyrillic letters and
 * one reader's admin. Folding them here means the reserved list keeps working
 * against it without the list needing a Cyrillic column.
 */
const CYRILLIC_LOOKALIKE = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x',
  м: 'm', т: 't', к: 'k', в: 'b', н: 'h',
};
// Only the letters the allowed range can actually produce. Ukrainian і, ј and
// ѕ are the sharpest lookalikes of all and are simply not in it — if that
// range is ever widened past Russian, they belong in the map above on the same
// commit, or the reserved list quietly stops covering the new letters.
//
// The fold is narrow but not decorative. Given the letters this range can
// produce, exactly two reserved names are spellable — `теам` reads as `team`
// and `ехтвк` as `extbk` — and both are caught by it. Most of the list is out
// of reach because Russian has no lowercase lookalike for `r`, `d`, `i`, `u`
// or `g`, which is worth knowing before anyone widens the range and assumes
// the coverage stayed the same.

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
    .replace(/[а-яёіјѕ]/g, (c) => CYRILLIC_LOOKALIKE[c] ?? c)  // аdmіn
    .replace(/[_-]/g, '')                     // _admin_, ad_min, ad-min
    .replace(/[013457]/g, (d) => LEET[d])     // adm1n, r00t, 4dmin
    .replace(/\d+$/, '');                     // admin2, dev01
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
// ── Scripts ─────────────────────────────────────────────────────────────────
//
// Letters only. Digits and separators are handled separately because they
// belong to no script and are allowed alongside any of them.

const SCRIPTS = {
  // a–z only. Accented Latin is left out on purpose: é/e and ñ/n are a large
  // confusable surface inside a single script, where the one-script rule
  // cannot help.
  latin: /[a-z]/,
  // Lowercase а–я plus ё. NFKC and toLowerCase have already run, so uppercase
  // and full-width forms have folded into this range.
  cyrillic: /[\u0430-\u044F\u0451]/,
  // Hiragana, katakana (with ー, which is part of ordinary spelling rather
  // than punctuation), and the CJK ideographs kanji is drawn from. Han is
  // shared with Chinese, so a Han-only name is reachable from either language
  // — still one script, so still covered by the rule below.
  japanese: /[\u3041-\u3096\u30A1-\u30FA\u30FC\u4E00-\u9FFF]/,
};

/** ASCII digits and the two separators. Allowed in any script, never alone. */
const NEUTRAL = /[0-9_-]/;

/** Which of the three a name draws its letters from. */
export function scriptsUsed(norm) {
  return Object.keys(SCRIPTS).filter((name) => SCRIPTS[name].test(norm));
}

const MESSAGES = {
  'too-short': 'A little longer — three characters or more.',
  'too-long': 'A little shorter — twenty characters at most.',
  'bad-characters': 'Letters, numbers, underscores and hyphens. Latin, Japanese or Russian.',
  'mixed-scripts': 'One alphabet at a time — Latin, Japanese or Russian, not a mix.',
  'bad-start': 'Start with a letter.',
  'bad-end': 'Cannot end with an underscore or a hyphen.',
  'double-separator': 'No two underscores or hyphens in a row.',
  reserved: 'That one is kept for AuthNo itself. Try another.',
  default: 'That name cannot be used.',
};

/**
 * The account rule, for a name that is required.
 *
 * Lifted from worker/src/lib/username.js rather than written again — the gate
 * is authoritative and the app can afford to be no stricter, because a name
 * the gate would refuse is one nobody can ever actually register. The reasons
 * are the gate's; the sentences are this file's, because the gate has no
 * business holding user-facing copy.
 */
export function validateUsername(input) {
  const norm = normalizePenName(input);
  const r = checkUsername(norm);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason, message: MESSAGES[r.reason] ?? MESSAGES.default };
}

/** Validate a NORMALIZED username. Returns { ok, reason? } with stable reasons. */
function checkUsername(norm) {
  if (norm.length < 3) return { ok: false, reason: 'too-short' };
  if (norm.length > 20) return { ok: false, reason: 'too-long' };

  // Every character is a letter of an allowed script, a digit, or a separator.
  for (const ch of norm) {
    if (NEUTRAL.test(ch)) continue;
    if (Object.values(SCRIPTS).some((re) => re.test(ch))) continue;
    return { ok: false, reason: 'bad-characters' };
  }

  const scripts = scriptsUsed(norm);
  // No letters at all: digits and separators only. Reads as a record number,
  // which is the other half of impersonating the system.
  if (scripts.length === 0) return { ok: false, reason: 'bad-characters' };
  // The homoglyph rule. See the header.
  if (scripts.length > 1) return { ok: false, reason: 'mixed-scripts' };

  // Shape. A separator at either end, or two in a row, makes a name that reads
  // as somebody else's with punctuation sprinkled on it.
  //
  // ー is in the Japanese letter range because it is part of ordinary spelling,
  // but it is a length mark rather than a sound and cannot begin a word — it
  // starts a name the way a hyphen would.
  if (NEUTRAL.test(norm[0]) || norm[0] === '\u30FC') return { ok: false, reason: 'bad-start' };
  if (/[_-]$/.test(norm)) return { ok: false, reason: 'bad-end' };
  if (/[_-]{2}/.test(norm)) return { ok: false, reason: 'double-separator' };

  if (isReserved(norm)) return { ok: false, reason: 'reserved' };
  return { ok: true };
}

/**
 * @returns {{ ok: boolean, reason?: string, message?: string }}
 *
 * The pen name is optional, so blank is valid — the field says "(optional)"
 * and a form that accepts nothing then complains about it is worse than one
 * that never asked. Everything else is the account rule above.
 */
export function validatePenName(input) {
  const norm = normalizePenName(input);
  if (!norm) return { ok: true };
  return validateUsername(norm);
}

/** What actually gets stored: normalised, or empty when it was left blank. */
export function cleanPenName(input) {
  const norm = normalizePenName(input);
  return validatePenName(norm).ok ? norm : '';
}
