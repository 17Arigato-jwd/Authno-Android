/**
 * wordCount.js — how many words is this?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Seven places counted words, each with its own copy of
 * `text.trim().split(/\s+/)`, and a comment in Streak.jsx warning that they
 * all had to agree or "the streak baseline drifts by a few words after the
 * first edit of a chapter". Seven copies of a rule that must not diverge is a
 * rule that will.
 *
 * ── The bug that made it urgent ────────────────────────────────────────────
 * Splitting on whitespace assumes a script that separates words with spaces.
 * Japanese, Chinese and Thai do not:
 *
 *     灯台守は海を見たことがない。   →  1 "word"
 *     ผู้ดูแลประภาคารไม่เคยเห็นทะเล      →  1 "word"
 *
 * The daily goal is measured in words, so for a writer working in any of
 * those scripts the goal was unreachable by roughly an order of magnitude: a
 * full chapter counted as a handful of words, the streak never lit, the goal
 * never completed, and — once reminders shipped — the nightly notification
 * asked them to write 300 words they had already written. Nothing in the app
 * said anything was wrong, because from the app's side nothing was.
 *
 * ── How it counts now ──────────────────────────────────────────────────────
 * Intl.Segmenter with granularity 'word', which is ICU's word-break rules and
 * knows where a word ends in Japanese, Chinese and Thai as well as in English.
 * Present in every Chromium (so in Android's WebView) and in Node 16+.
 *
 * Latin text takes a fast path that skips the segmenter entirely — it gives
 * the identical answer for space-separated scripts, and this runs on every
 * editor flush, on books that can be megabytes.
 */

/** Built once: constructing a Segmenter per call is the expensive part. */
let _segmenter;
let _segmenterTried = false;

function segmenter() {
  if (_segmenterTried) return _segmenter;
  _segmenterTried = true;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      // Locale-independent on purpose. Passing the user's locale would count
      // the same manuscript differently on two devices, and the count is
      // stored in the file.
      _segmenter = new Intl.Segmenter('en', { granularity: 'word' });
    }
  } catch { _segmenter = undefined; }
  return _segmenter;
}

/**
 * Scripts that do not put spaces between words: Han, Hiragana, Katakana,
 * Thai, Lao, Khmer, Myanmar. Their presence is what decides whether the
 * slow-but-correct path is needed.
 */
const NEEDS_SEGMENTER = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u0E00-\u0E7F\u0E80-\u0EFF\u1780-\u17FF\u1000-\u109F]/;

/** HTML to plain text, matching what every one of the old counters did. */
export function plainText(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words in a plain-text string.
 *
 * Exported separately because some callers already hold plain text and
 * re-stripping tags on a whole book is not free.
 */
export function countWordsIn(text) {
  const t = String(text ?? '').trim();
  if (!t) return 0;

  // Fast path. For space-separated scripts this is what the segmenter would
  // say anyway, and it is the overwhelmingly common case.
  if (!NEEDS_SEGMENTER.test(t)) {
    return t.split(/\s+/).filter(Boolean).length;
  }

  const seg = segmenter();
  if (!seg) {
    // No Intl.Segmenter. Better than one word for a whole chapter: count each
    // character of a space-less script as a word and the rest as usual. Rough,
    // but wrong by a factor rather than by two orders of magnitude.
    const dense = (t.match(new RegExp(NEEDS_SEGMENTER.source, 'g')) || []).length;
    const rest = t.replace(new RegExp(NEEDS_SEGMENTER.source, 'g'), ' ')
      .split(/\s+/).filter(Boolean).length;
    return dense + rest;
  }

  let n = 0;
  for (const s of seg.segment(t)) if (s.isWordLike) n++;
  return n;
}

/** Words in a chunk of chapter HTML. The one every caller should use. */
export function countWords(html) {
  if (!html) return 0;
  return countWordsIn(plainText(html));
}
