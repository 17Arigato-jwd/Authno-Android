/**
 * threads.js — Threads engine (plotlines / character arcs / custom types)
 * ─────────────────────────────────────────────────────────────────────────────
 * See docs/threads-spec.md. Design rules honoured here:
 *
 *   • NOTHING is hardcoded to "plotline" or "character arc" — both are just
 *     configured ThreadType instances. Users can define their own types (with
 *     custom fields) and future extensions can register more.
 *   • Anchors live INSIDE the chapter HTML as <span data-authno-anchor="id">
 *     (span) / <span data-authno-pin="id"> (point), so they move with the text
 *     during edits and persist through .authbook save/load with zero extra
 *     format work. The threads store only references anchor ids.
 *   • Entries auto-sort by manuscript position; unanchored TODOs pin to the top.
 *
 * Data shape (session.threads):
 *   {
 *     version: 1,
 *     types:     [{ id, name, icon, color, fields: [{ key, label }], builtin? }],
 *     threads:   [{ id, typeId, name, color?, meta: {}, entries: [] }],
 *     relations: [{ id, aThreadId, bThreadId, label?, note? }],
 *   }
 *   entry: { id, text, anchorIds: [], todo: bool, done: bool, created }
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Ids ───────────────────────────────────────────────────────────────────────
export function tid(prefix = 't') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Default (builtin) types — instances of the generic system, not classes ────
export const DEFAULT_THREAD_TYPES = [
  {
    id: 'plotline', name: 'Plotline', icon: 'BookOpen', color: '#22c55e',
    fields: [], builtin: true,
  },
  {
    id: 'character-arc', name: 'Character Arc', icon: 'User', color: '#38bdf8',
    fields: [{ key: 'character', label: 'Character' }], builtin: true,
  },
];

// Palette offered when creating threads/types (any hex is allowed via picker).
export const THREAD_COLORS = ['#22c55e', '#38bdf8', '#a855f7', '#f59e0b', '#ec4899', '#ef4444', '#14b8a6', '#f97316'];

export function emptyThreadsData() {
  return { version: 1, types: [], threads: [], relations: [] };
}

/** Normalise whatever is on the session into a full store (never mutates). */
export function getThreadsData(session) {
  const d = session?.threads;
  if (!d || typeof d !== 'object') return emptyThreadsData();
  return {
    version:   d.version || 1,
    types:     Array.isArray(d.types)     ? d.types     : [],
    threads:   Array.isArray(d.threads)   ? d.threads   : [],
    relations: Array.isArray(d.relations) ? d.relations : [],
  };
}

/** Builtin types + per-book custom types (custom overrides builtin on id clash). */
export function getAllTypes(data) {
  const byId = new Map(DEFAULT_THREAD_TYPES.map(t => [t.id, t]));
  for (const t of data.types) byId.set(t.id, t);
  return Array.from(byId.values());
}

export function typeById(data, typeId) {
  return getAllTypes(data).find(t => t.id === typeId)
      ?? { id: typeId, name: typeId, icon: 'Extension', color: '#a855f7', fields: [] };
}

export function threadColor(data, thread) {
  return thread.color || typeById(data, thread.typeId).color;
}

// ── Mutations (all return a NEW data object) ──────────────────────────────────

export function addType(data, { name, icon = 'Extension', color = '#a855f7', fields = [] }) {
  const type = { id: tid('ty'), name: name.trim() || 'Custom', icon, color, fields };
  return { data: { ...data, types: [...data.types, type] }, type };
}

export function removeType(data, typeId) {
  // Threads of a removed type keep working — typeById falls back gracefully.
  return { ...data, types: data.types.filter(t => t.id !== typeId) };
}

export function addThread(data, { typeId, name, color = null, meta = {} }) {
  const thread = { id: tid('th'), typeId, name: name.trim() || 'Untitled thread', color, meta, entries: [] };
  return { data: { ...data, threads: [...data.threads, thread] }, thread };
}

export function updateThread(data, threadId, patch) {
  return { ...data, threads: data.threads.map(t => (t.id === threadId ? { ...t, ...patch } : t)) };
}

export function removeThread(data, threadId) {
  return {
    ...data,
    threads:   data.threads.filter(t => t.id !== threadId),
    relations: data.relations.filter(r => r.aThreadId !== threadId && r.bThreadId !== threadId),
  };
}

export function addEntry(data, threadId, { text = '', anchorIds = [], todo = false }) {
  const entry = { id: tid('en'), text, anchorIds, todo, done: false, created: new Date().toISOString() };
  return {
    data: {
      ...data,
      threads: data.threads.map(t => (t.id === threadId ? { ...t, entries: [...t.entries, entry] } : t)),
    },
    entry,
  };
}

export function updateEntry(data, threadId, entryId, patch) {
  return {
    ...data,
    threads: data.threads.map(t => t.id !== threadId ? t : {
      ...t, entries: t.entries.map(e => (e.id === entryId ? { ...e, ...patch } : e)),
    }),
  };
}

export function removeEntry(data, threadId, entryId) {
  return {
    ...data,
    threads: data.threads.map(t => t.id !== threadId ? t : {
      ...t, entries: t.entries.filter(e => e.id !== entryId),
    }),
  };
}

export function addRelation(data, aThreadId, bThreadId, label = '') {
  if (aThreadId === bThreadId) return { data, relation: null };
  const dup = data.relations.find(r =>
    (r.aThreadId === aThreadId && r.bThreadId === bThreadId) ||
    (r.aThreadId === bThreadId && r.bThreadId === aThreadId));
  if (dup) return { data, relation: dup };
  const relation = { id: tid('re'), aThreadId, bThreadId, label };
  return { data: { ...data, relations: [...data.relations, relation] }, relation };
}

export function removeRelation(data, relationId) {
  return { ...data, relations: data.relations.filter(r => r.id !== relationId) };
}

export function relationsOf(data, threadId) {
  return data.relations
    .filter(r => r.aThreadId === threadId || r.bThreadId === threadId)
    .map(r => ({ relation: r, otherId: r.aThreadId === threadId ? r.bThreadId : r.aThreadId }));
}

// ── Anchor position lookup (anchors live in chapter HTML) ─────────────────────
// One attribute regex is the single source of truth for anchor markup detection;
// DOM-side removal goes through stripAnchorEls below.

const ANCHOR_SCAN_RE = /data-authno-(?:anchor|pin)="([^"]+)"/g;

/**
 * Map anchorId → { chapIdx, offset } by scanning chapter content strings.
 * Cheap enough for typical books; callers debounce/memoize (never per keystroke).
 * Legacy chapterless sessions fall back to scanning session.content as chapter 1.
 */
export function locateAnchors(session) {
  const map = new Map();
  const chapters = session?.chapters?.length
    ? [...session.chapters].sort((a, b) => a.order - b.order)
    : (session?.content ? [{ chap_idx: 1, order: 1, content: session.content }] : []);
  chapters.forEach((c, chapPos) => {
    const html = c.content || '';
    ANCHOR_SCAN_RE.lastIndex = 0;
    let m;
    while ((m = ANCHOR_SCAN_RE.exec(html)) !== null) {
      if (!map.has(m[1])) map.set(m[1], { chapIdx: c.chap_idx, chapPos, offset: m.index });
    }
  });
  return map;
}

/**
 * Remove anchor markup for the given ids inside a live DOM root: span anchors
 * are unwrapped (prose kept), point pins deleted. Shared by the state-side
 * stripAnchorsFromChapters and the Editor's live-DOM patch so the two can
 * never diverge. Returns true if anything was removed.
 */
export function stripAnchorEls(root, ids) {
  const idSet = ids instanceof Set ? ids : new Set(ids);
  let touched = false;
  root.querySelectorAll('[data-authno-anchor],[data-authno-pin]').forEach(el => {
    const id = el.getAttribute('data-authno-anchor') || el.getAttribute('data-authno-pin');
    if (!idSet.has(id)) return;
    touched = true;
    if (el.hasAttribute('data-authno-pin')) el.remove();
    else el.replaceWith(...el.childNodes);   // unwrap, keep the prose
  });
  return touched;
}

/**
 * Sort a thread's entries for display:
 *   1. unanchored TODOs (pinned top, newest last)
 *   2. anchored entries by manuscript position (chapter order, then offset)
 *   3. unanchored non-TODO notes (bottom)
 */
export function sortedEntries(thread, anchorMap) {
  const posOf = (e) => {
    for (const id of e.anchorIds || []) {
      const p = anchorMap.get(id);
      if (p) return p.chapPos * 1e9 + p.offset;
    }
    return null;
  };
  const todos = [], anchored = [], rest = [];
  for (const e of thread.entries) {
    const p = posOf(e);
    if (p === null && e.todo && !e.done) todos.push(e);
    else if (p !== null) anchored.push([p, e]);
    else rest.push(e);
  }
  anchored.sort((a, b) => a[0] - b[0]);
  return [...todos, ...anchored.map(([, e]) => e), ...rest];
}

export function todoCount(thread) {
  return thread.entries.filter(e => e.todo && !e.done).length;
}

export function allOpenTodos(data) {
  const out = [];
  for (const t of data.threads) {
    for (const e of t.entries) if (e.todo && !e.done) out.push({ thread: t, entry: e });
  }
  return out;
}

// ── Anchor removal from content (DOM-based unwrap, regex-free) ────────────────

/**
 * Remove anchor/pin markup for `anchorIds` from every chapter's HTML.
 * Returns { chapters, changed } with span anchors unwrapped (text kept) and
 * point pins deleted. Uses the same stripAnchorEls as the Editor's live-DOM
 * patch, so serialized and on-screen results always match.
 */
export function stripAnchorsFromChapters(chapters, anchorIds) {
  if (!anchorIds.length) return { chapters, changed: false };
  const ids = new Set(anchorIds);
  let changed = false;
  const next = (chapters || []).map(c => {
    const html = c.content || '';
    // Cheap substring guard before paying for a DOM parse of the chapter.
    if (![...ids].some(id => html.includes(`"${id}"`))) return c;
    const div = document.createElement('div');
    div.innerHTML = html;
    if (!stripAnchorEls(div, ids)) return c;
    changed = true;
    return { ...c, content: div.innerHTML };
  });
  return { chapters: next, changed };
}

// ── Markdown outline export ───────────────────────────────────────────────────

export function exportOutlineMarkdown(session, data) {
  const anchorMap = locateAnchors(session);
  const chapTitle = new Map((session?.chapters || []).map(c => [c.chap_idx, c.title]));
  const lines = [`# ${session?.title || 'Untitled Book'} — Threads outline`, ''];

  for (const type of getAllTypes(data)) {
    const threads = data.threads.filter(t => t.typeId === type.id);
    if (!threads.length) continue;
    lines.push(`## ${type.name}s`, '');
    for (const t of threads) {
      lines.push(`### ${t.name}`);
      for (const f of type.fields || []) {
        if (t.meta?.[f.key]) lines.push(`- **${f.label}:** ${t.meta[f.key]}`);
      }
      const rels = relationsOf(data, t.id);
      if (rels.length) {
        const names = rels.map(({ otherId }) => data.threads.find(x => x.id === otherId)?.name || '?');
        lines.push(`- **Connected to:** ${names.join(', ')}`);
      }
      lines.push('');
      for (const e of sortedEntries(t, anchorMap)) {
        const anchor = (e.anchorIds || []).map(id => anchorMap.get(id)).find(Boolean);
        const where = anchor ? ` _(${chapTitle.get(anchor.chapIdx) || `Ch ${anchor.chapIdx}`})_` : '';
        lines.push(e.todo ? `- [${e.done ? 'x' : ' '}] ${e.text}${where}` : `- ${e.text}${where}`);
      }
      lines.push('');
    }
  }
  if (lines.length === 2) lines.push('_No threads yet._');
  return lines.join('\n');
}
