/**
 * history.js — change history for the History panel (v2, 1.1.18-beta.1).
 *
 * v1 (beta.0) recorded whole-chapter snapshots per typing burst. Per the
 * author's spec for beta.1, entries are now PARAGRAPH-LEVEL CHANGES:
 *
 *   · Each entry represents edits to one region of one chapter, and carries a
 *     block diff (before → after per paragraph) for the panel's preview.
 *   · Consecutive edits to the same paragraph(s) keep merging into the open
 *     entry; moving to a different paragraph (with a real change) or pausing
 *     longer than COALESCE_MS starts a new entry.
 *   · Minor edits (under ~MIN_ENTRY_WORDS words, and not a whole added/deleted
 *     paragraph) never create a row of their own — they accumulate silently
 *     until they amount to something. Internally that's a `provisional` entry
 *     the panel hides and saves never persist.
 *   · Clicking an entry in the panel previews the diff, then offers
 *     "Revert this change" (surgical, via revertChangePatch) or
 *     "Restore chapter to here" (whole-state, via restorePatch).
 *
 * Storage model is unchanged: newest-first array on `session.history`, up to
 * SESSION_HISTORY_LIMIT in memory, BOOK_HISTORY_LIMIT persisted in the
 * .authbook (authbook.js strips `baseline` and provisional entries on save).
 */

export const SESSION_HISTORY_LIMIT = 50;
export const BOOK_HISTORY_LIMIT = 10;

// A pause longer than this seals the open entry ("kept typing" vs "came back").
const COALESCE_MS = 90_000;
// Changes need roughly this many words added/removed/rewritten (or a whole
// paragraph added/deleted) to earn their own row.
export const MIN_ENTRY_WORDS = 10;

// localStorage mirrors the whole sessions array, so unbounded snapshots could
// blow the ~5MB quota. Oldest entries drop once snapshot text exceeds this.
const CONTENT_CHAR_BUDGET = 1_000_000;

let _seq = 0;
function _id(now) { return `h${now.toString(36)}${(_seq++ & 0xfff).toString(36)}`; }

export function wordCountOf(html) {
  const text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

function _entrySize(e) {
  return (e.content?.length || 0) + (e.baseline?.length || 0)
    + (e.blocks || []).reduce((n, b) => n + (b.before?.html.length || 0) + (b.after?.html.length || 0), 0);
}

function _trim(history) {
  let out = history.slice(0, SESSION_HISTORY_LIMIT);
  let chars = 0;
  for (let i = 0; i < out.length; i++) {
    chars += _entrySize(out[i]);
    if (chars > CONTENT_CHAR_BUDGET && i > 0) { out = out.slice(0, i); break; }
  }
  return out;
}

// ─── Block splitting & diffing ───────────────────────────────────────────────

const BLOCK_TAGS = /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|LI|TABLE|HR|FIGURE)$/;

function _norm(text) { return String(text || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }

function _textOfHtml(html) {
  return _norm(String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' '));
}

/** Split chapter HTML into top-level blocks: [{ html, text }]. */
export function splitBlocks(html) {
  const src = String(html || '');
  if (!src.trim()) return [];
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.innerHTML = src;
    const out = [];
    let inline = '';
    const flushInline = () => {
      if (_norm(inline.replace(/<[^>]*>/g, ' '))) out.push({ html: inline, text: _textOfHtml(inline) });
      inline = '';
    };
    for (const node of Array.from(div.childNodes)) {
      if (node.nodeType === 1 && BLOCK_TAGS.test(node.tagName)) {
        flushInline();
        out.push({ html: node.outerHTML, text: _textOfHtml(node.outerHTML) });
      } else {
        inline += node.nodeType === 1 ? node.outerHTML : (node.textContent ?? '');
      }
    }
    flushInline();
    return out;
  }
  // Non-DOM fallback (never hit in the app; tests run under jsdom).
  return src.split(/(?<=<\/(?:p|div|h[1-6]|ul|ol|blockquote|pre|li)>)/i)
    .map((h) => ({ html: h, text: _textOfHtml(h) }))
    .filter((b) => b.text);
}

// Cheap word-level change size: strip the common prefix/suffix words, the
// bigger remaining side is how much of the paragraph actually changed.
function _wordsChanged(beforeText, afterText) {
  const a = beforeText ? beforeText.split(' ') : [];
  const b = afterText ? afterText.split(' ') : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1, endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  return Math.max(endA - start + 1, endB - start + 1, 0);
}

/**
 * Diff two chapter HTMLs at block (paragraph) level.
 * Returns ops: [{ type: 'changed'|'added'|'removed', before?, after?,
 *                 aIndex, bIndex, formatting? , words }]
 * before/after are { html, text }; `words` is the size of the change.
 */
export function diffBlocks(beforeHtml, afterHtml) {
  const a = splitBlocks(beforeHtml);
  const b = splitBlocks(afterHtml);

  // LCS on block texts.
  const n = a.length, m = b.length;
  const MAX_CELLS = 400_000;
  let pairsA = [], pairsB = [];
  if (n * m <= MAX_CELLS) {
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i].text === b[j].text
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i].text === b[j].text) { pairsA.push(i); pairsB.push(j); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
  } else {
    // Degenerate huge docs: match common prefix/suffix only.
    let p = 0;
    while (p < n && p < m && a[p].text === b[p].text) { pairsA.push(p); pairsB.push(p); p++; }
    let sa = n - 1, sb = m - 1;
    const tailA = [], tailB = [];
    while (sa >= p && sb >= p && a[sa].text === b[sb].text) { tailA.unshift(sa); tailB.unshift(sb); sa--; sb--; }
    pairsA = pairsA.concat(tailA); pairsB = pairsB.concat(tailB);
  }

  const ops = [];
  const emitGap = (aFrom, aTo, bFrom, bTo) => {
    const dels = []; const adds = [];
    for (let i = aFrom; i < aTo; i++) dels.push(i);
    for (let j = bFrom; j < bTo; j++) adds.push(j);
    const paired = Math.min(dels.length, adds.length);
    for (let k = 0; k < paired; k++) {
      const B = a[dels[k]], A = b[adds[k]];
      ops.push({
        type: 'changed', before: B, after: A, aIndex: dels[k], bIndex: adds[k],
        formatting: B.text === A.text || undefined,
        words: B.text === A.text ? 0 : _wordsChanged(B.text, A.text),
      });
    }
    for (let k = paired; k < dels.length; k++) {
      const B = a[dels[k]];
      ops.push({ type: 'removed', before: B, aIndex: dels[k], bIndex: bFrom + paired, words: B.text ? B.text.split(' ').length : 0 });
    }
    for (let k = paired; k < adds.length; k++) {
      const A = b[adds[k]];
      ops.push({ type: 'added', after: A, aIndex: aFrom + paired, bIndex: adds[k], words: A.text ? A.text.split(' ').length : 0 });
    }
  };

  let prevA = 0, prevB = 0;
  for (let k = 0; k <= pairsA.length; k++) {
    const ca = k < pairsA.length ? pairsA[k] : n;
    const cb = k < pairsB.length ? pairsB[k] : m;
    if (ca > prevA || cb > prevB) emitGap(prevA, ca, prevB, cb);
    prevA = ca + 1; prevB = cb + 1;
  }
  return ops;
}

function _diffWords(ops) { return ops.reduce((s, o) => s + (o.words || 0), 0); }
function _structural(ops) { return ops.some((o) => (o.type === 'added' || o.type === 'removed') && (o.words || 0) > 0); }
function _qualifies(ops) { return _diffWords(ops) >= MIN_ENTRY_WORDS || _structural(ops); }

// The incremental diff (head.content → new) touches the same region as the
// open entry when any of its before-texts appear in the entry's after-texts.
function _touchesSameRegion(entryOps, incOps) {
  const afterTexts = new Set(entryOps.filter((o) => o.after).map((o) => o.after.text));
  return incOps.some((o) => o.before && afterTexts.has(o.before.text));
}

// ─── Recording ────────────────────────────────────────────────────────────────

function _mkEditEntry(chapIdx, chapTitle, baseline, afterContent, now) {
  const blocks = diffBlocks(baseline, afterContent);
  const entry = {
    id: _id(now), ts: now, kind: 'edit', chapIdx,
    chapTitle: chapTitle || `Chapter ${chapIdx}`,
    baseline, content: afterContent, blocks,
    words: wordCountOf(afterContent), prevWords: wordCountOf(baseline),
  };
  if (!_qualifies(blocks)) entry.provisional = true;
  return entry;
}

/**
 * Record a typing/formatting flush on one chapter (called per debounced
 * flush, ~2.5×/s while typing). Pure — returns the new history array.
 */
export function recordEdit(history, { chapIdx, chapTitle, beforeContent, afterContent }, now = Date.now()) {
  if (beforeContent === afterContent) return history || [];
  const h = history || [];
  const head = h[0];
  const headIsEdit = head && head.kind === 'edit' && head.chapIdx === chapIdx && head.content != null;
  const active = headIsEdit && (head.provisional || now - head.ts < COALESCE_MS);

  if (active) {
    // Moved to a different paragraph with a substantial change → new entry.
    if (!head.provisional) {
      const inc = diffBlocks(head.content, afterContent);
      if (inc.length && !_touchesSameRegion(head.blocks || [], inc) && _qualifies(inc)) {
        return _trim([_mkEditEntry(chapIdx, chapTitle, head.content, afterContent, now), ...h]);
      }
    }
    // Merge into the open entry (re-diff from its baseline).
    const baseline = head.baseline ?? beforeContent;
    if (baseline === afterContent) {
      // Typed back to exactly the pre-entry state — drop the entry.
      return _trim(h.slice(1));
    }
    const blocks = diffBlocks(baseline, afterContent);
    const updated = {
      ...head, ts: now, content: afterContent, blocks,
      chapTitle: chapTitle ?? head.chapTitle,
      words: wordCountOf(afterContent),
    };
    if (_qualifies(blocks)) delete updated.provisional;
    else updated.provisional = true;
    return _trim([updated, ...h.slice(1)]);
  }

  // No open entry: accumulate from the last recorded state of this chapter so
  // sub-threshold edits eventually add up to a row instead of vanishing.
  const lastForChap = h.find((e) => e.chapIdx === chapIdx && e.content != null);
  const baseline = lastForChap ? lastForChap.content : beforeContent;
  if (baseline === afterContent) return h;
  return _trim([_mkEditEntry(chapIdx, chapTitle, baseline, afterContent, now), ...h]);
}

/**
 * Record a structural / book-level change. Kinds:
 *   'add-chapter' | 'delete-chapter' | 'rename-chapter' | 'rename-book' |
 *   'move-chapter' | 'restore'
 */
export function recordOp(history, entry, now = Date.now()) {
  const h = history || [];
  const head = h[0];
  if (head && head.kind === entry.kind && head.chapIdx === (entry.chapIdx ?? null) &&
      (entry.kind === 'rename-chapter' || entry.kind === 'rename-book') &&
      now - head.ts < COALESCE_MS) {
    return _trim([{ ...head, ...entry, ts: now }, ...h.slice(1)]);
  }
  return _trim([{ id: _id(now), ts: now, chapIdx: null, ...entry }, ...h]);
}

/** Entries the panel should show (provisional accumulators stay hidden). */
export function visibleHistory(history) {
  return (history || []).filter((e) => !e.provisional);
}

/** Strip fields that must not persist (book files and the localStorage mirror). */
export function persistableHistory(history, limit = BOOK_HISTORY_LIMIT) {
  return (history || [])
    .filter((e) => !e.provisional)
    .slice(0, limit)
    .map(({ baseline, ...rest }) => rest);
}

// ─── Restoring ────────────────────────────────────────────────────────────────

function _mirrorFirst(chapters, previewOf) {
  const first = [...chapters].sort((a, b) => a.order - b.order)[0];
  const content = first?.content ?? '';
  return { content, preview: previewOf ? previewOf(content) : undefined };
}

/**
 * Whole-state restore ("Restore chapter to here"): puts the entry's chapter
 * back into the captured after-state. Returns null when already there.
 */
export function restorePatch(session, entryId, previewOf, now = Date.now()) {
  const h = session?.history || [];
  const entry = h.find((e) => e.id === entryId);
  if (!entry) return null;

  const chapters = [...(session.chapters || [])];

  if (entry.kind === 'rename-book') {
    if (session.title === entry.chapTitle) return null;
    const history = recordOp(h, { kind: 'restore', chapIdx: null, chapTitle: entry.chapTitle, label: 'Book title' }, now);
    return { patch: { title: entry.chapTitle, history }, label: `Restored title "${entry.chapTitle}"` };
  }

  if (entry.chapIdx == null || entry.content == null) {
    if (entry.kind === 'rename-chapter') {
      const i = chapters.findIndex((c) => c.chap_idx === entry.chapIdx);
      if (i === -1 || chapters[i].title === entry.chapTitle) return null;
      chapters[i] = { ...chapters[i], title: entry.chapTitle };
      const history = recordOp(h, { kind: 'restore', chapIdx: entry.chapIdx, chapTitle: entry.chapTitle }, now);
      return { patch: { chapters, history }, label: `Restored chapter name "${entry.chapTitle}"` };
    }
    return null;
  }

  const idx = chapters.findIndex((c) => c.chap_idx === entry.chapIdx);
  const nowIso = new Date(now).toISOString();

  // "Added chapter" is a marker, not a text snapshot — if the chapter still
  // exists, restoring it must NOT blank out whatever has been written since.
  if (entry.kind === 'add-chapter' && idx >= 0) return null;

  let restoredAsNew = false;
  if (idx >= 0) {
    if (chapters[idx].content === entry.content) return null; // already there
    if (entry.kind === 'delete-chapter') {
      // chap_idx was reused by a newer chapter (indices come from max+1) —
      // never overwrite the newcomer; resurrect under a fresh idx instead.
      restoredAsNew = true;
    } else {
      chapters[idx] = { ...chapters[idx], content: entry.content, updated: nowIso };
    }
  }
  if (idx < 0 || restoredAsNew) {
    const freeIdx = restoredAsNew
      ? Math.max(...chapters.map((c) => c.chap_idx)) + 1
      : entry.chapIdx;
    const maxOrder = chapters.length ? Math.max(...chapters.map((c) => c.order)) : 0;
    chapters.push({
      chap_idx: freeIdx,
      title: entry.chapTitle || `Chapter ${entry.chapIdx}`,
      order: restoredAsNew ? maxOrder + 1 : (entry.order ?? maxOrder + 1),
      content: entry.content,
      created: nowIso, updated: nowIso,
      ...(entry.synopsis ? { synopsis: entry.synopsis } : {}),
    });
  }

  const mirror = _mirrorFirst(chapters, previewOf);
  const history = recordOp(h, {
    kind: 'restore', chapIdx: entry.chapIdx,
    chapTitle: entry.chapTitle || `Chapter ${entry.chapIdx}`,
    content: entry.content, words: wordCountOf(entry.content),
  }, now);

  return {
    patch: { chapters, ...mirror, history },
    label: (idx >= 0 && !restoredAsNew)
      ? `Restored "${entry.chapTitle || `Chapter ${entry.chapIdx}`}"`
      : `Brought back "${entry.chapTitle || `Chapter ${entry.chapIdx}`}"`,
  };
}

// Locate the current-blocks index a revert op applies to, or -1.
function _locate(cur, op) {
  if (op.type === 'removed') return -1; // handled by insertion, not location
  const targetText = op.after?.text;
  if (targetText == null) return -1;
  // Prefer exact html match, fall back to text match.
  let i = cur.findIndex((b) => b.html === op.after.html);
  if (i === -1) i = cur.findIndex((b) => b.text === targetText);
  return i;
}

/** True when at least part of the entry's change can still be reverted. */
export function canRevertEntry(session, entry) {
  if (!entry?.blocks?.length || entry.chapIdx == null) return false;
  const chap = (session?.chapters || []).find((c) => c.chap_idx === entry.chapIdx);
  if (!chap) return false;
  const cur = splitBlocks(chap.content);
  return entry.blocks.some((op) => {
    if (op.type === 'removed') return !cur.some((b) => b.text === op.before.text);
    return _locate(cur, op) !== -1;
  });
}

/**
 * Surgical revert ("Revert this change"): undoes just this entry's paragraph
 * changes against the CURRENT chapter text, keeping every other edit made
 * since. Ops whose paragraphs have changed further are skipped; returns null
 * when nothing is revertable any more.
 */
export function revertChangePatch(session, entryId, previewOf, now = Date.now()) {
  const h = session?.history || [];
  const entry = h.find((e) => e.id === entryId);
  if (!entry?.blocks?.length || entry.chapIdx == null) return null;

  const chapters = [...(session.chapters || [])];
  const ci = chapters.findIndex((c) => c.chap_idx === entry.chapIdx);
  if (ci === -1) return null;

  let cur = splitBlocks(chapters[ci].content);
  let applied = 0;

  for (const op of entry.blocks) {
    if (op.type === 'changed') {
      const i = _locate(cur, op);
      if (i !== -1) { cur[i] = { html: op.before.html, text: op.before.text }; applied++; }
    } else if (op.type === 'added') {
      const i = _locate(cur, op);
      if (i !== -1) { cur.splice(i, 1); applied++; }
    } else if (op.type === 'removed') {
      if (!cur.some((b) => b.text === op.before.text)) {
        cur.splice(Math.min(op.aIndex ?? cur.length, cur.length), 0, { html: op.before.html, text: op.before.text });
        applied++;
      }
    }
  }
  if (!applied) return null;

  const newHtml = cur.map((b) => b.html).join('');
  if (newHtml === chapters[ci].content) return null;
  const nowIso = new Date(now).toISOString();
  chapters[ci] = { ...chapters[ci], content: newHtml, updated: nowIso };

  const mirror = _mirrorFirst(chapters, previewOf);
  const chapTitle = entry.chapTitle || `Chapter ${entry.chapIdx}`;
  const history = recordOp(h, {
    kind: 'restore', chapIdx: entry.chapIdx, chapTitle,
    content: newHtml, words: wordCountOf(newHtml),
  }, now);

  return {
    patch: { chapters, ...mirror, history },
    label: `Reverted the change in "${chapTitle}"`,
    partial: applied < entry.blocks.length,
  };
}

// ─── Display helpers ─────────────────────────────────────────────────────────

/** Human label + detail line for a panel row. */
export function describeEntry(entry) {
  const chap = entry.chapTitle || (entry.chapIdx ? `Chapter ${entry.chapIdx}` : '');
  switch (entry.kind) {
    case 'edit': {
      const ops = (entry.blocks || []).filter((o) => !o.formatting);
      const fmtOnly = (entry.blocks || []).length > 0 && ops.length === 0;
      const delta = (entry.words ?? 0) - (entry.prevWords ?? entry.words ?? 0);
      const d = delta > 0 ? `+${delta} words` : delta < 0 ? `${delta} words` : '';
      if (fmtOnly) return { title: `Formatting in ${chap}`, detail: 'style change' };
      if (!ops.length) { // old-format (beta.0) entries without block diffs
        return { title: `Edited ${chap}`, detail: d || 'edited' };
      }
      if (ops.length === 1) {
        const o = ops[0];
        const line = (o.words || 0) < 12;
        if (o.type === 'added') return { title: `Added a ${line ? 'line' : 'paragraph'} in ${chap}`, detail: d || `+${o.words} words` };
        if (o.type === 'removed') return { title: `Deleted a ${line ? 'line' : 'paragraph'} in ${chap}`, detail: d || `-${o.words} words` };
        return { title: `Rewrote a ${line ? 'line' : 'paragraph'} in ${chap}`, detail: d || `${o.words} words changed` };
      }
      return { title: `Edited ${ops.length} paragraphs in ${chap}`, detail: d || `${_diffWords(ops)} words changed` };
    }
    case 'checkpoint':     return { title: `Earlier version of ${chap}`, detail: `${entry.words ?? 0} words` };
    case 'add-chapter':    return { title: `Added ${chap}`, detail: 'new chapter' };
    case 'delete-chapter': return { title: `Deleted ${chap}`, detail: 'restorable' };
    case 'rename-chapter': return { title: `Renamed chapter`, detail: `to "${chap}"` };
    case 'rename-book':    return { title: `Renamed book`, detail: `to "${chap}"` };
    case 'move-chapter':   return { title: `Moved ${chap}`, detail: 'reordered' };
    case 'restore':        return { title: `Restored ${chap || 'earlier version'}`, detail: entry.words != null ? `${entry.words} words` : '' };
    default:               return { title: 'Change', detail: '' };
  }
}

/** Short relative timestamp for panel rows ("just now", "5m ago", "2h ago"). */
export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const d = Math.round(hrs / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
