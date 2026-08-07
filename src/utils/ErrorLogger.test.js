import {
  logError, getErrorHistory, clearErrorHistory, formatError, formatBugReport,
  errorSummary, categoryFor, SEVERITY,
} from './ErrorLogger';

beforeEach(() => { clearErrorHistory(); });

describe('categories cover what the app actually logs', () => {
  // These are the operation keys really passed to logError/showError across the
  // codebase. Every one falling through to "unknown" was the old behaviour, and
  // "unknown" tells a writer to restart the app for a theme that failed to load.
  const REAL_KEYS = [
    'saveBook', 'saveAsBook', 'autoSaveBook', 'openBook', 'importBook',
    'listSavedBooks', 'readSessionFromFile', 'encodeSession', 'decodeSession',
    'exportTxt', 'exportHtml', 'exportEpub', 'exportPdf',
    'extensionLoader:discoverExtensions', 'extensionLoader:loadManifest',
    'extensionRuntime:activate', 'extensionRuntime:import', 'extensionRuntime:openBrowser',
    'extbkInstaller:seed:install',
    'themeLoader:install', 'themeLoader:refresh', 'themeLoader:scan', 'themeLoader:scan-dev',
  ];

  test.each(REAL_KEYS)('%s resolves to a real category', (key) => {
    expect(categoryFor(key).label).not.toBe('Unexpected error');
  });

  test('a namespaced key resolves by its prefix', () => {
    // So a new operation in an existing area needs no edit to ErrorLogger.
    expect(categoryFor('themeLoader:somethingNew').label).toBe('Themes');
    expect(categoryFor('extensionRuntime:whatever').label).toBe('Extensions');
  });

  test('a genuinely unknown key still falls back', () => {
    expect(categoryFor('somethingNobodyDefined').label).toBe('Unexpected error');
    expect(categoryFor(undefined).label).toBe('Unexpected error');
  });

  test('operations that risk written work are marked as such', () => {
    for (const k of ['saveBook', 'autoSaveBook', 'encodeSession', 'decodeSession', 'readSessionFromFile']) {
      expect(categoryFor(k).severity).toBe(SEVERITY.DATA);
    }
    // A theme failing is not in the same class and must not read like it is.
    expect(categoryFor('themeLoader:scan').severity).toBe(SEVERITY.MINOR);
  });
});

describe('a repeating error does not flush the log', () => {
  test('the same failure is counted, not duplicated', () => {
    for (let i = 0; i < 200; i++) logError('autoSaveBook', new Error('disk full'));
    const h = getErrorHistory();
    expect(h).toHaveLength(1);
    expect(h[0].count).toBe(200);
  });

  test('earlier, different problems survive a flood', () => {
    // This is the whole point. Autosave failing every two seconds used to push
    // 50 copies through a 50-entry buffer and destroy every other clue.
    logError('decodeSession', new Error('the one clue that mattered'));
    for (let i = 0; i < 200; i++) logError('autoSaveBook', new Error('disk full'));
    const messages = getErrorHistory().map((e) => e.message);
    expect(messages).toContain('the one clue that mattered');
    expect(getErrorHistory()).toHaveLength(2);
  });

  test('different messages from one operation stay separate', () => {
    logError('saveBook', new Error('permission denied'));
    logError('saveBook', new Error('disk full'));
    expect(getErrorHistory()).toHaveLength(2);
  });

  test('a repeat moves back to the front, and keeps when it started', () => {
    logError('saveBook', new Error('first problem'));
    logError('themeLoader:scan', new Error('later problem'));
    logError('saveBook', new Error('first problem'));
    const h = getErrorHistory();
    expect(h[0].message).toBe('first problem');
    expect(h[0].count).toBe(2);
    expect(new Date(h[0].firstSeen) <= new Date(h[0].timestamp)).toBe(true);
  });

  test('the newest context wins on a repeat', () => {
    // Autosave failing across four books: the latest path is the useful one.
    logError('autoSaveBook', new Error('disk full'), { sessionTitle: 'Book A' });
    logError('autoSaveBook', new Error('disk full'), { sessionTitle: 'Book D' });
    expect(getErrorHistory()[0].context.sessionTitle).toBe('Book D');
  });

  test('the log is still capped at 50 distinct problems', () => {
    for (let i = 0; i < 80; i++) logError('saveBook', new Error(`problem ${i}`));
    expect(getErrorHistory()).toHaveLength(50);
  });
});

describe('reporting', () => {
  test('summary counts distinct and total', () => {
    logError('saveBook', new Error('a'));
    for (let i = 0; i < 5; i++) logError('themeLoader:scan', new Error('b'));
    const s = errorSummary();
    expect(s.distinct).toBe(2);
    expect(s.total).toBe(6);
    expect(s.worst).toBe(SEVERITY.DATA);
  });

  test('worst severity reflects the most serious thing present', () => {
    logError('themeLoader:scan', new Error('cosmetic'));
    expect(errorSummary().worst).toBe(SEVERITY.MINOR);
    logError('saveBook', new Error('serious'));
    expect(errorSummary().worst).toBe(SEVERITY.DATA);
  });

  test('the bug report leads with what threatens the writing', () => {
    // Logged least-serious first, so time ordering alone would bury the save.
    logError('themeLoader:scan', new Error('theme missing'));
    logError('extensionLoader:loadManifest', new Error('bad manifest'));
    logError('saveBook', new Error('could not write the book'));
    const report = formatBugReport(10);
    expect(report.indexOf('could not write the book'))
      .toBeLessThan(report.indexOf('theme missing'));
  });

  test('a repeat count reaches the report', () => {
    for (let i = 0; i < 12; i++) logError('autoSaveBook', new Error('disk full'));
    expect(formatBugReport(5)).toContain('×12');
  });

  test('an empty log says so', () => {
    expect(formatBugReport()).toBe('No errors recorded.');
  });

  test('formatError includes the suggestion and stays readable', () => {
    const entry = logError('saveBook', new Error('permission denied'), { filePath: '/x/y' });
    const text = formatError(entry);
    expect(text).toContain('permission denied');
    expect(text).toContain('Save As');
    expect(text).toContain('/x/y');
  });
});

describe('robustness', () => {
  test('a corrupt stored log does not throw', () => {
    localStorage.setItem('authno_error_log', 'not json');
    expect(getErrorHistory()).toEqual([]);
    expect(() => logError('saveBook', new Error('x'))).not.toThrow();
  });

  test('a non-array stored log does not throw', () => {
    localStorage.setItem('authno_error_log', '{"nope":true}');
    expect(getErrorHistory()).toEqual([]);
  });

  test('a thrown non-Error still records', () => {
    logError('saveBook', 'just a string');
    expect(getErrorHistory()[0].message).toBe('just a string');
  });
});
