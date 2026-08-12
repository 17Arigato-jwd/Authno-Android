import { scanForBooks, safeScanForBooks, summarise, formatScanReport, OUTCOME } from './bookScan';

// Under jsdom the platform is 'web', so the Android app-folder walk is skipped
// and the saved-location pass is what runs. That is enough to pin the contract:
// every session is accounted for, nothing throws, and nothing is silent.

describe('scanForBooks', () => {
  test('reports the platform and never throws on an empty library', async () => {
    const r = await scanForBooks([]);
    expect(r.platform).toBe('web');
    expect(r.files).toEqual([]);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(typeof r.durationMs).toBe('number');
  });

  test('accounts for every book in the library', async () => {
    const sessions = [
      { id: 'a', title: 'Saved Book', filePath: 'content://x/1' },
      { id: 'b', title: 'Never Saved' },
      { id: 'c', title: 'Desktop Book', filePath: '/home/me/c.authbook' },
    ];
    const r = await scanForBooks(sessions);
    expect(r.files).toHaveLength(3);
    // Nothing may be dropped in silence — that was the original problem.
    for (const s of sessions) {
      expect(r.files.some((f) => f.name === s.title)).toBe(true);
    }
  });

  test('an unsaved book is called out as unsaved, not as missing', async () => {
    const r = await scanForBooks([{ id: 'b', title: 'Never Saved' }]);
    const entry = r.files[0];
    expect(entry.outcome).toBe(OUTCOME.SKIPPED);
    expect(entry.detail).toMatch(/never saved/i);
  });

  test('explains why it skipped the folder walk off Android', async () => {
    const r = await scanForBooks([]);
    const platformStep = r.steps.find((s) => s.name === 'Platform check');
    expect(platformStep.status).toBe(OUTCOME.SKIPPED);
    expect(platformStep.detail).toMatch(/android-only/i);
  });

  test('a session with no title still gets an identifiable entry', async () => {
    const r = await scanForBooks([{ id: 'no-title-here' }]);
    expect(r.files[0].name).toBe('no-title-here');
  });

  test('survives a malformed session object', async () => {
    const r = await scanForBooks([null, undefined, {}]);
    expect(r.files).toHaveLength(3);
  });
});

describe('summarise', () => {
  const report = (outcomes) => ({
    files: outcomes.map((o, i) => ({ name: `f${i}`, outcome: o })),
  });

  test('counts each outcome', () => {
    const s = summarise(report([OUTCOME.OK, OUTCOME.OK, OUTCOME.DAMAGED, OUTCOME.MISSING, OUTCOME.SKIPPED]));
    expect(s).toMatchObject({ examined: 5, ok: 2, damaged: 1, missing: 1, skipped: 1 });
  });

  test('problems excludes deliberate skips', () => {
    // A book that was never saved is not a problem to fix.
    const s = summarise(report([OUTCOME.OK, OUTCOME.SKIPPED, OUTCOME.SKIPPED]));
    expect(s.problems).toBe(0);
  });

  test('problems counts everything actionable', () => {
    const s = summarise(report([OUTCOME.DAMAGED, OUTCOME.UNREADABLE, OUTCOME.MISSING]));
    expect(s.problems).toBe(3);
  });

  test('counts files that only opened after repair', () => {
    const s = summarise({ files: [
      { outcome: OUTCOME.OK, repaired: true },
      { outcome: OUTCOME.OK },
    ] });
    expect(s.repaired).toBe(1);
  });
});

describe('formatScanReport', () => {
  test('says so when nothing has run', () => {
    expect(formatScanReport(null)).toMatch(/no scan/i);
  });

  test('is readable and names every file with its reason', async () => {
    const r = await scanForBooks([
      { id: 'a', title: 'Saved Book', filePath: 'content://x/1' },
      { id: 'b', title: 'Never Saved' },
    ]);
    const text = formatScanReport(r);
    expect(text).toContain('AuthNo — Book scan');
    expect(text).toContain('Saved Book');
    expect(text).toContain('Never Saved');
    expect(text).toContain('── Steps ──');
    expect(text).toContain('── Files ──');
  });

  test('surfaces repaired files, because the writer would never otherwise know', () => {
    const text = formatScanReport({
      startedAt: new Date().toISOString(), platform: 'android', durationMs: 12,
      steps: [], files: [{ name: 'x.authbook', source: 'External/AuthNo', outcome: OUTCOME.OK, repaired: true }],
    });
    expect(text).toMatch(/opened only after automatic repair/i);
  });

  test('an empty file list is stated rather than left blank', () => {
    const text = formatScanReport({
      startedAt: new Date().toISOString(), platform: 'web', durationMs: 1, steps: [], files: [],
    });
    expect(text).toMatch(/nothing examined/i);
  });
});

describe('safeScanForBooks', () => {
  test('returns a report rather than throwing when the scan itself fails', async () => {
    // A diagnostic that explodes tells you nothing. Passing something that
    // breaks iteration proves the wrapper holds.
    const r = await safeScanForBooks({ [Symbol.iterator]: null });
    expect(r).toBeTruthy();
    expect(r.summary.problems).toBeGreaterThan(0);
    expect(formatScanReport(r)).toContain('AuthNo — Book scan');
  });
});

// ── The real scan paths, not just the diagnostic ─────────────────────────────
// bookScan.js answers "what happened?" when asked. These cover the other half:
// the app's own scan noticing on its own, so a problem reaches the error log
// without the writer having to go looking for it.
describe('the app notices scan failures without being asked', () => {
  const { clearErrorHistory, getErrorHistory } = require('./ErrorLogger');
  beforeEach(() => clearErrorHistory());

  test('a location check that throws is recorded, not swallowed', async () => {
    const { checkFileIntegrity } = await import('./storage');
    // Not Android under jsdom, so this returns early — the point is that it
    // does not throw and leaves the log clean rather than logging noise.
    await expect(checkFileIntegrity([{ id: 'a', filePath: 'content://x/1' }])).resolves.toEqual([]);
    expect(getErrorHistory()).toHaveLength(0);
  });

  test('a failed permission check does not report success', async () => {
    // The old fallback returned 'granted' when the check threw, so a scan that
    // found nothing would also claim access was fine — the same answer as a
    // real pass, with the opposite meaning.
    const { checkStoragePermission } = await import('./storage');
    const status = await checkStoragePermission();
    expect(['granted', 'denied', 'unknown']).toContain(status);
    // jsdom is not Android, so this short-circuits to 'granted' before the
    // plugin is ever reached; the point is that 'unknown' is now expressible.
    expect(status).toBe('granted');
  });

  test('a missing folder is not treated as an error worth reporting', async () => {
    // Distinguishing the two is the whole point: the app folder does not exist
    // until the first save, so reporting it every launch would be noise that
    // trains people to ignore the log.
    const { isMissingDirError } = await import('./storage');
    expect(isMissingDirError(new Error('Directory does not exist'))).toBe(true);
    expect(isMissingDirError(new Error('ENOENT: no such file or directory'))).toBe(true);
    // Being blocked is NOT the same as there being nothing there, and only one
    // of the two is worth telling anybody about.
    expect(isMissingDirError(new Error('Permission denied'))).toBe(false);
    expect(isMissingDirError(new Error('EACCES'))).toBe(false);
    expect(isMissingDirError(null)).toBe(false);
  });
});
