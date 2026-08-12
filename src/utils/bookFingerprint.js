/**
 * bookFingerprint — "has anything in this book's file changed?"
 *
 * The Android autosave loop runs every couple of seconds over every open book.
 * Writing them all through the Storage Access Framework each tick meant
 * constant SAF traffic, wasted battery, and every extension's onSave hook
 * firing for books nobody had touched. So each book is fingerprinted, and one
 * whose fingerprint is unchanged is skipped.
 *
 * That makes this function load-bearing for data safety: anything it cannot
 * see is a change that never reaches the .authbook file.
 *
 * It answers a different question from `updated`. `updated` means "the user
 * edited this book" and drives the recently-edited ordering; this means "the
 * bytes we would write are different". Conflating them is what broke:
 *
 *   - renaming a chapter from the editor  (chapter titles were not covered)
 *   - changing the writing goal           (streak was not covered)
 *   - the first-book coach clearing its demo paragraph
 *
 * Each looked identical to `updated | title | chapter count`, so autosave
 * skipped the book. Renaming a chapter and going straight back — with no
 * typing afterwards to bump `updated` — lost the new name on the next open.
 */

// Separators are control characters, which cannot appear in a title or a
// synopsis. Joining on a printable character would let two different books
// collide: chapters titled "ab" + "c" and "a" + "bc" share a concatenation.
const FIELD   = '\u0001';
const CHAPTER = '\u0002';
const SECTION = '\u0003';

export const bookFingerprint = (s) => {
  if (!s) return '';
  return [
    s.updated ?? '',
    s.title ?? '',
    (s.chapters || [])
      .map((c) => [
        c.chap_idx,
        c.title ?? '',
        // Length rather than a hash of the content: an edit to the text also
        // stamps `updated`, so the pair still catches a same-length rewrite,
        // and this stays O(chapters) per tick instead of O(words). Hashing
        // every chapter of every open book on a 2-second timer is exactly the
        // cost the dirty-tracking exists to avoid.
        (c.content ?? '').length,
        c.order,
        c.synopsis ?? '',
      ].join(FIELD))
      .join(CHAPTER),
    JSON.stringify(s.streak ?? {}),
  ].join(SECTION);
};

export default bookFingerprint;
