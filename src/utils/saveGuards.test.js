/**
 * The guards that stand between a partially-loaded book and the file it came
 * from.
 *
 * A large book can be opened in "preview" mode: the chapter list loads, the
 * bodies do not, and each unloaded chapter carries `content: null`. Writing
 * that session back produces a book with the right chapters and nothing in
 * them — structurally intact, which is what makes it so hard to notice.
 *
 * `saveBook` refuses, and its comment calls itself "the backstop for any that
 * forget". `exportAs*` refuses through withAllChapters. `autoSaveBook` did
 * not, and it is the one that needs it most: it is the only one that runs with
 * nobody asking, four seconds after a book is opened.
 */

jest.mock('./platform', () => ({ isAndroid: () => true, isElectron: () => false }));

const mockWritten = new Map();
jest.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', External: 'EXTERNAL' },
  Filesystem: {
    mkdir: async () => {},
    writeFile: async ({ path, data }) => { mockWritten.set(path, data); return { uri: `file://${path}` }; },
    readFile: async ({ path }) => {
      if (!mockWritten.has(path)) throw new Error('no such file');
      return { data: mockWritten.get(path) };
    },
    stat: async ({ path }) => {
      if (!mockWritten.has(path)) throw new Error('no such file');
      return { type: 'file' };
    },
    readdir: async () => ({ files: [] }),
    getUri: async ({ path }) => ({ uri: `file://${path}` }),
    deleteFile: async ({ path }) => { mockWritten.delete(path); },
  },
}));

const chapter = (idx, content) => ({
  chap_idx: idx, order: idx, title: `Chapter ${idx}`, content,
  word_count: content == null ? 5000 : String(content).split(' ').length,
});

/** A book opened in preview: the list is there, the bodies are not. */
const previewSession = () => ({
  id: 'b1',
  title: 'The Long Novel',
  // Not content:// — this is the app-folder copy, which is exactly the one
  // autoSaveBook is responsible for and the one a writer never chose a
  // location for.
  filePath: 'AuthNo/The Long Novel.authbook',
  _preview: true,
  content: '',
  chapters: [chapter(1, null), chapter(2, null), chapter(3, null)],
});

beforeEach(() => { mockWritten.clear(); });

describe('autoSaveBook', () => {
  /**
   * The regression. Every condition here is reachable without the writer doing
   * anything unusual: a long book, stored where the app puts books nobody has
   * placed by hand, opened and left alone for four seconds.
   */
  test('refuses a book whose chapters are not all loaded', async () => {
    const { autoSaveBook } = require('./storage');
    const r = await autoSaveBook(previewSession());

    expect(r.success).toBe(false);
    expect(mockWritten.size).toBe(0);
  });

  test('a fully loaded book still autosaves', async () => {
    const { autoSaveBook } = require('./storage');
    const r = await autoSaveBook({
      ...previewSession(),
      _preview: false,
      chapters: [chapter(1, '<p>real words</p>'), chapter(2, '<p>more</p>')],
    });

    expect(r.success).toBe(true);
    expect(mockWritten.size).toBeGreaterThan(0);
  });

  /**
   * One loaded chapter beside two unloaded ones is the shape a writer reaches
   * by opening a single chapter of a preview book — and it is worse than the
   * all-null case, because the book that gets written looks like it has
   * content.
   */
  test('refuses when only some chapters are loaded', async () => {
    const { autoSaveBook } = require('./storage');
    const half = previewSession();
    half.chapters[0] = chapter(1, '<p>the one chapter they opened</p>');

    const r = await autoSaveBook(half);
    expect(r.success).toBe(false);
    expect(mockWritten.size).toBe(0);
  });

  /** The stub case, which isContentless already caught: no chapters at all. */
  test('still refuses a mirror stub', async () => {
    const { autoSaveBook } = require('./storage');
    const r = await autoSaveBook({ id: 'b1', title: 'Stub', filePath: 'AuthNo/Stub.authbook' });
    expect(r.success).toBe(false);
    expect(mockWritten.size).toBe(0);
  });

  /**
   * An empty book somebody genuinely just made has no filePath yet, so there
   * is nothing to overwrite — but it also has nothing to save, and writing an
   * empty file for every new book is how a shelf fills with Untitled Books.
   */
  test('refuses a book with no content at all', async () => {
    const { autoSaveBook } = require('./storage');
    const r = await autoSaveBook({ id: 'b2', title: 'Fresh', chapters: [], content: '' });
    expect(r.success).toBe(false);
    expect(mockWritten.size).toBe(0);
  });
});

describe('the other two doors, which already had the guard', () => {
  test('saveBook refuses a partially loaded book', async () => {
    const { saveBook } = require('./storage');
    const r = await saveBook(previewSession());
    expect(r.success).toBe(false);
    expect(r.needsHydration).toBe(true);
  });

  /**
   * Export throws rather than returning a short book: a refused export is
   * recoverable in a way that a silently truncated manuscript is not.
   */
  test('export refuses rather than writing a shorter book', async () => {
    const { exportAsTxt } = require('./storage');
    await expect(exportAsTxt(previewSession())).rejects.toThrow(/whole book|still unread/i);
  });
});

/**
 * Save As is the one that destroys rather than truncates.
 *
 * On Android it deletes the app-folder autosave once the copy is written, on
 * the reasoning that the book has been promoted out of the app folder. Run
 * with unloaded chapters, that writes an empty copy where the writer chose AND
 * removes the only complete one.
 */
describe('saveAsBook', () => {
  test('loads the rest of the book rather than writing a hollow copy', async () => {
    const { saveAsBook } = require('./storage');
    // Nothing on disk to hydrate FROM, so this must fail rather than proceed.
    await expect(saveAsBook(previewSession())).rejects.toThrow(/whole book|still unread/i);
    expect(mockWritten.size).toBe(0);
  });

  test('a fully loaded book gets past the guard', async () => {
    const { saveAsBook } = require('./storage');
    const full = {
      ...previewSession(),
      _preview: false,
      chapters: [chapter(1, '<p>real words</p>')],
    };
    // Platform is mocked to Android, so this reaches the native file picker
    // and fails there — which is the assertion. What matters is WHICH error:
    // the picker's, meaning hydration let it through, and not the one about
    // chapters still being unread.
    await expect(saveAsBook(full)).rejects.toThrow(/AuthnoFilePicker/);
  });
});

/**
 * What the refusals above look like to whoever asked for the save.
 *
 * The guards were the fix; this is the other half of it. saveBook refuses by
 * returning rather than throwing, and the Save button read only `cancelled` —
 * so a refused save produced a green "Saved ✓", a haptic tick and a tour step,
 * and a writer who believed their work was on disk. A prevented data loss
 * reported as a success is the data loss, one layer up and slower.
 */
describe('reading a save result', () => {
  const { saveOutcome } = require('./storage');

  test('a real save', () => {
    expect(saveOutcome({ success: true })).toBe('saved');
    expect(saveOutcome({ success: true, filePath: 'content://x' })).toBe('saved');
    expect(saveOutcome({ success: true, downloaded: true })).toBe('saved');
  });

  /** Dismissing the picker is a decision, not a failure. Nothing should shout. */
  test('a dismissed picker', () => {
    expect(saveOutcome({ success: false, cancelled: true })).toBe('cancelled');
  });

  /**
   * The two the Save button used to call success. Both mean the book on disk
   * is still whole, and both mean nothing was written.
   */
  test('a guard refusing', () => {
    expect(saveOutcome({ success: false, needsHydration: true })).toBe('refused');
    expect(saveOutcome({ success: false, skippedEmpty: true })).toBe('refused');
  });

  /**
   * Distinct from 'refused' because it is the one with a recovery: the file is
   * gone, so forgetting the path turns the next save into a fresh "where shall
   * I put this?" rather than another silent failure against a dead uri.
   */
  test('a file that has gone away', () => {
    expect(saveOutcome({ success: false, staleUri: true })).toBe('stale-path');
  });

  test('anything else is a failure, including nothing at all', () => {
    expect(saveOutcome({ success: false })).toBe('failed');
    expect(saveOutcome({})).toBe('failed');
    expect(saveOutcome(null)).toBe('failed');
    expect(saveOutcome(undefined)).toBe('failed');
    expect(saveOutcome('ok')).toBe('failed');
  });

  /**
   * The precedence that matters: a cancelled picker on a book that ALSO could
   * not be hydrated is still just a cancellation, and a stale path is reported
   * as such even though `success` is false either way.
   */
  test('cancellation and a dead path outrank a plain failure', () => {
    expect(saveOutcome({ success: false, cancelled: true, needsHydration: true })).toBe('cancelled');
    expect(saveOutcome({ success: false, staleUri: true, skippedEmpty: true })).toBe('stale-path');
  });

  /**
   * Only 'saved' may be reported as saved. Written as the rule rather than as
   * four cases, because the bug was a caller that tested for the failures it
   * happened to know about and let the rest through.
   */
  test('nothing else is ever "saved"', () => {
    for (const r of [
      { success: false, needsHydration: true },
      { success: false, skippedEmpty: true },
      { success: false, staleUri: true },
      { success: false, cancelled: true },
      { success: false },
      {},
      null,
    ]) {
      expect(saveOutcome(r)).not.toBe('saved');
    }
  });
});
