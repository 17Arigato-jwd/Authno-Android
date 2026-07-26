/**
 * mock.js — the fake host an extension is developed against.
 *
 * The previous mock session invented its own shape: chapters keyed by a string
 * `id`, with `content` and no `chap_idx`, `order` or `word_count`. Real AuthNo
 * sessions are keyed by numeric `chap_idx`, and every documented pattern —
 * `chapters.find(c => c.chap_idx === n)` — silently returned undefined against
 * the mock. Developers wrote code that passed in the sandbox and broke on the
 * first device. The shapes below match src/utils/authbook.js exactly.
 */

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const countWords = (html) => {
  const t = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
  return t.trim().split(/\s+/).filter(Boolean).length;
};

function chapter(chapIdx, title, content, synopsis = '') {
  return {
    chap_idx: chapIdx,
    title,
    order: chapIdx,
    content,
    synopsis,
    word_count: countWords(content),
    created: iso(now - 9 * 864e5),
    updated: iso(now - 36e5),
  };
}

function book(id, title, chapters, extra = {}) {
  return {
    id,
    title,
    type: 'book',
    content: chapters[0]?.content ?? '',
    preview: String(chapters[0]?.content ?? '').replace(/<[^>]*>/g, ' ').trim().slice(0, 100),
    chapters,
    authors: [{ name: 'Sandbox Author' }],
    genre: '',
    description: '',
    language: 'en',
    publisher: '',
    isbn: '',
    devices: [],
    filePath: null,
    created: iso(now - 9 * 864e5),
    updated: iso(now - 36e5),
    ...extra,
  };
}

/** Streak log shaped exactly like Streak.jsx expects: keyed YYYY-MM-DD. */
function streakLog(goal = 500) {
  const key = (n) => {
    const d = new Date(now - n * 864e5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const log = {};
  [640, 712, 588, 903].forEach((w, i) => { log[key(i + 1)] = { words: w, goal }; });
  log[key(0)] = { words: 213, goal };
  return { log, goalWords: goal, dailyBaseline: {}, goalHistory: [] };
}

export function makeLibrary() {
  return [
    book('mock-book-1', 'The Salt Road', [
      chapter(1, 'Chapter 1: The Weighing House',
        '<p>Every caravan out of Terrek was weighed twice — once by the guild, once by whoever the guild was frightened of that season.</p>',
        'Two weighings, and what the second one is really for.'),
      chapter(2, 'Chapter 2: What the Camels Knew',
        '<p>Camels are not wise. They are, however, extremely well informed.</p>',
        'The lead camel refuses a gate three days running.'),
      chapter(3, 'Chapter 3: Forty Days of Nothing', '<p>White, white, wind, white.</p>', ''),
    ], {
      genre: 'Historical fiction',
      description: 'Eleven years of caravans, told from the weighing-house window.',
      streak: streakLog(),
      threads: {
        version: 1,
        types: [{ id: 'ty_place', name: 'Location', icon: 'Globe', color: '#f59e0b', fields: [{ key: 'region', label: 'Region' }] }],
        threads: [
          { id: 'th_mira', typeId: 'character-arc', name: 'Mira', color: null, meta: { character: 'Mira Vansh' },
            entries: [{ id: 'en_1', text: 'Watches the second weighing from the same window for eleven years.', anchorIds: [], todo: false, done: false, created: iso(now - 2 * 864e5) }] },
          { id: 'th_terrek', typeId: 'ty_place', name: 'Terrek', color: null, meta: { region: 'The Marches' },
            entries: [{ id: 'en_2', text: 'Looks smaller coming back. Everyone says so.', anchorIds: [], todo: true, done: false, created: iso(now - 864e5) }] },
        ],
        relations: [],
      },
    }),
    book('mock-book-2', 'Nightjar', [
      chapter(1, 'Chapter 1: The Second Call',
        '<p>The nightjar called twice before Sera understood it was not a bird.</p>',
        'Sera realises the bird is a signal.'),
    ], { genre: 'Gothic mystery' }),
    book('mock-book-3', 'Notes on Craft', [
      chapter(1, 'On Endings', '<p>Endings are promises kept.</p>', ''),
    ], { genre: 'Non-fiction' }),
  ];
}

/**
 * Slim session, matching what AuthnoHostAPI.getSession() actually hands a
 * ui-file page — id, title, externalId and chapter titles, with no prose. The
 * old mock handed over everything, so pages written against it broke when the
 * real bridge stripped the content out.
 */
export function slimSession(b) {
  if (!b) return null;
  return {
    id: b.id,
    title: b.title,
    externalId: b.externalId ?? '',
    chapters: (b.chapters ?? []).map((c) => ({ chap_idx: c.chap_idx, title: c.title, order: c.order })),
  };
}

/** Metadata rows, matching AuthNoExtensionAPI.getSessions(). */
export function sessionList(library) {
  return library.map((b) => ({
    id: b.id, title: b.title, updated: b.updated, filePath: b.filePath ?? null,
  }));
}

/** Every hook the real host fires, with a representative payload builder. */
export const HOOKS = [
  { name: 'onSave',        label: 'Save (autosave)', payload: (b) => ({ session: b, trigger: 'autosave' }) },
  { name: 'onSave',        label: 'Save (change)',   payload: (b) => ({ session: b, trigger: 'change' }), key: 'onSave:change' },
  { name: 'onBookOpen',    label: 'Book opened',     payload: (b) => ({ session: b }) },
  { name: 'onBookClose',   label: 'Book closed',     payload: (b) => ({ session: b }) },
  { name: 'onChapterOpen', label: 'Chapter opened',  payload: (b) => ({ session: b, chapIdx: b.chapters?.[0]?.chap_idx ?? 1, chapTitle: b.chapters?.[0]?.title ?? 'Chapter 1' }) },
  { name: 'onBookCreate',  label: 'Book created',    payload: (b) => ({ session: b }) },
  { name: 'onBookDelete',  label: 'Book deleted',    payload: (b) => ({ sessionId: b.id, title: b.title }) },
  { name: 'onExport',      label: 'Exported (pdf)',  payload: (b) => ({ session: b, format: 'pdf' }) },
];
