/**
 * bookScan.js — "why is my book not showing up?"
 *
 * Finding books touches a lot of things that can each fail quietly: storage
 * permission, two app directories that may or may not exist, every file in
 * them, and the saved location of every book already in the library. The
 * scanning code is written to be resilient, which in practice meant:
 *
 *     } catch { /* skip corrupt *\/ }
 *     } catch { /* directory not available *\/ }
 *     } catch { return []; }
 *
 * Resilient is right — one damaged file must not stop the other forty loading.
 * But every one of those swallowed the only evidence of what went wrong, so a
 * book that failed to appear was indistinguishable from a book that was never
 * there, and there was nothing to send us.
 *
 * This runs the same walk deliberately and records an outcome for every single
 * thing it touched, including the successes. It never throws, changes nothing
 * on disk, and reads no chapter text it does not need.
 *
 * The output is meant to be read by a person: `formatScanReport` turns it into
 * something that can be pasted into a message.
 */

import { isAndroid, isElectron } from './platform';
import { logError } from './ErrorLogger';

/** Outcome of examining one thing. */
export const OUTCOME = {
  OK: 'ok',            // found and readable
  UNREADABLE: 'unreadable', // exists but could not be read
  DAMAGED: 'damaged',  // read, but could not be understood as a book
  MISSING: 'missing',  // recorded location no longer resolves
  SKIPPED: 'skipped',  // deliberately not examined, with a reason
};

const SAVE_SUBDIR = 'AuthNo';

/**
 * Walk everywhere books come from and report what happened to each.
 *
 * @param {object[]} sessions - books currently in the library, so their saved
 *                              locations can be checked too. A book can be open
 *                              and still have a file that no longer resolves.
 * @returns {object} report
 */
export async function scanForBooks(sessions = []) {
  const started = Date.now();
  const report = {
    startedAt: new Date().toISOString(),
    platform: isAndroid() ? 'android' : isElectron() ? 'electron' : 'web',
    steps: [],   // ordered narrative of what was attempted
    files: [],   // one entry per file or location examined
    durationMs: 0,
  };

  const step = (name, status, detail) => {
    report.steps.push({ name, status, detail: detail ?? null });
  };
  const file = (entry) => { report.files.push(entry); };

  // ── Where are we ────────────────────────────────────────────────────────
  if (report.platform !== 'android') {
    // Not a failure. The app-folder walk is an Android concept; desktop and web
    // books are opened by path or picker and have no directory to sweep.
    step('Platform check', OUTCOME.SKIPPED,
      `${report.platform} — the app folder is Android-only, so only saved book locations are checked`);
  } else {
    step('Platform check', OUTCOME.OK, 'android');
  }

  // ── Permission ──────────────────────────────────────────────────────────
  // Checked before the directories, because "no files found" and "not allowed
  // to look" are completely different problems that look identical afterwards.
  if (report.platform === 'android') {
    try {
      const { checkStoragePermission } = await import('./storage');
      const status = await checkStoragePermission();
      // 'unknown' means the check itself failed, which is neither a pass nor a
      // refusal and must not be reported as either.
      step('Storage permission',
        status === 'granted' ? OUTCOME.OK : OUTCOME.UNREADABLE,
        status === 'unknown' ? 'could not be determined — treat the results below with suspicion' : status);
    } catch (e) {
      step('Storage permission', OUTCOME.UNREADABLE, e?.message || String(e));
    }
  }

  // ── The app folder, in both places it can live ──────────────────────────
  if (report.platform === 'android') {
    let Filesystem, Directory;
    try {
      const m = await import('@capacitor/filesystem');
      Filesystem = m.Filesystem; Directory = m.Directory;
    } catch (e) {
      step('Filesystem plugin', OUTCOME.UNREADABLE, e?.message || String(e));
    }

    if (Filesystem) {
      for (const dirName of ['External', 'Data']) {
        const directory = Directory[dirName];
        let names = [];
        try {
          const res = await Filesystem.readdir({ path: SAVE_SUBDIR, directory });
          names = (res.files || []).map((f) => (typeof f === 'string' ? f : f.name));
          step(`Folder ${dirName}/${SAVE_SUBDIR}`, OUTCOME.OK,
            `${names.length} item${names.length === 1 ? '' : 's'}`);
        } catch (e) {
          // A missing directory is normal — it is created on first save. Say so
          // rather than reporting it as a fault the writer should act on.
          step(`Folder ${dirName}/${SAVE_SUBDIR}`, OUTCOME.MISSING, e?.message || String(e));
          continue;
        }

        for (const name of names) {
          if (!name.endsWith('.authbook')) {
            file({ source: `${dirName}/${SAVE_SUBDIR}`, name, outcome: OUTCOME.SKIPPED,
              stage: 'filter', detail: 'not a .authbook file' });
            continue;
          }
          const path = `${SAVE_SUBDIR}/${name}`;
          let data;
          try {
            ({ data } = await Filesystem.readFile({ path, directory }));
          } catch (e) {
            file({ source: `${dirName}/${SAVE_SUBDIR}`, name, outcome: OUTCOME.UNREADABLE,
              stage: 'read', detail: e?.message || String(e) });
            continue;
          }
          await _describeBytes({ file, source: `${dirName}/${SAVE_SUBDIR}`, name, base64: data });
        }
      }
    }
  }

  // ── Saved locations of books already in the library ─────────────────────
  // A book can be open and perfectly readable on screen while the file it came
  // from has become unreachable — the SAF grant expired, the SD card is out,
  // the file was moved. That is invisible until a save fails.
  for (const s of sessions) {
    if (!s?.filePath) {
      file({ source: 'library', name: s?.title || s?.id || 'untitled', outcome: OUTCOME.SKIPPED,
        stage: 'location', detail: 'never saved to a file — lives in the app only' });
      continue;
    }
    const label = s.title || s.id;
    if (report.platform === 'android' && s.filePath.startsWith('content://')) {
      try {
        const { registerPlugin } = await import('@capacitor/core');
        const plugin = registerPlugin('AuthnoFilePicker');
        const res = await plugin.checkUri({ uri: s.filePath });
        file({ source: 'library', name: label, path: s.filePath,
          outcome: res?.accessible ? OUTCOME.OK : OUTCOME.MISSING,
          stage: 'location',
          detail: res?.accessible ? 'saved location still reachable'
            : 'the saved location no longer resolves — re-open the book to reconnect it' });
      } catch (e) {
        file({ source: 'library', name: label, path: s.filePath, outcome: OUTCOME.MISSING,
          stage: 'location', detail: e?.message || String(e) });
      }
    } else {
      file({ source: 'library', name: label, path: s.filePath, outcome: OUTCOME.SKIPPED,
        stage: 'location', detail: 'checked only on Android' });
    }
  }

  report.durationMs = Date.now() - started;
  report.summary = summarise(report);
  return report;
}

/**
 * Read enough of a file to say whether it is a usable book, and record what it
 * turned out to be. Decoding is the expensive part but it is also the only
 * thing that separates "a file exists" from "a book you can open".
 */
async function _describeBytes({ file, source, name, base64 }) {
  try {
    const { base64ToBytes, detectFormat } = await import('./authbook');
    const bytes = base64ToBytes(base64);
    const format = detectFormat(bytes);
    if (format !== 'vchs' && format !== 'legacy-json') {
      file({ source, name, outcome: OUTCOME.DAMAGED, stage: 'format', bytes: bytes.length,
        detail: 'not recognised as a book file' });
      return;
    }
    const { openBookFromBytes } = await import('./storage');
    const session = await openBookFromBytes(base64, null);
    if (!session) {
      file({ source, name, outcome: OUTCOME.DAMAGED, stage: 'decode', bytes: bytes.length,
        detail: 'the file could not be decoded into a book' });
      return;
    }
    file({
      source, name, outcome: OUTCOME.OK, stage: 'decode', bytes: bytes.length,
      title: session.title, chapters: (session.chapters || []).length,
      // A file that needed Reed-Solomon repair still opens, and the writer
      // would never know. Worth saying — it usually means failing storage.
      detail: session._recovery ? 'opened, but the file needed repair' : 'opened normally',
      repaired: !!session._recovery,
    });
  } catch (e) {
    file({ source, name, outcome: OUTCOME.DAMAGED, stage: 'decode',
      detail: e?.message || String(e) });
  }
}

export function summarise(report) {
  const tally = (o) => report.files.filter((f) => f.outcome === o).length;
  return {
    examined: report.files.length,
    ok: tally(OUTCOME.OK),
    unreadable: tally(OUTCOME.UNREADABLE),
    damaged: tally(OUTCOME.DAMAGED),
    missing: tally(OUTCOME.MISSING),
    skipped: tally(OUTCOME.SKIPPED),
    repaired: report.files.filter((f) => f.repaired).length,
    problems: tally(OUTCOME.UNREADABLE) + tally(OUTCOME.DAMAGED) + tally(OUTCOME.MISSING),
  };
}

/** Plain text, for pasting into a message. */
export function formatScanReport(report) {
  if (!report) return 'No scan has been run.';
  const s = report.summary || summarise(report);
  const lines = [
    'AuthNo — Book scan',
    `Ran: ${new Date(report.startedAt).toLocaleString()}  (${report.durationMs} ms)`,
    `Platform: ${report.platform}`,
    '',
    `Examined ${s.examined}: ${s.ok} opened, ${s.damaged} damaged, ${s.unreadable} unreadable, ${s.missing} missing, ${s.skipped} skipped`,
  ];
  if (s.repaired) lines.push(`${s.repaired} file(s) opened only after automatic repair.`);
  lines.push('', '── Steps ──');
  for (const st of report.steps) lines.push(`  [${st.status}] ${st.name}${st.detail ? ` — ${st.detail}` : ''}`);

  lines.push('', '── Files ──');
  if (!report.files.length) lines.push('  (nothing examined)');
  for (const f of report.files) {
    const where = f.path || f.source;
    const extra = f.title ? ` "${f.title}", ${f.chapters} chapter(s)` : '';
    const size = typeof f.bytes === 'number' ? `, ${f.bytes} bytes` : '';
    lines.push(`  [${f.outcome}] ${f.name} (${where})${extra}${size}`);
    if (f.detail) lines.push(`        ${f.stage}: ${f.detail}`);
  }
  return lines.join('\n');
}

/**
 * Run a scan and never let it throw. The diagnostic failing is itself a fact
 * worth recording rather than an exception in the UI that ran it.
 */
export async function safeScanForBooks(sessions = []) {
  try {
    return await scanForBooks(sessions);
  } catch (e) {
    logError('bookScan', e);
    return {
      startedAt: new Date().toISOString(),
      platform: 'unknown',
      steps: [{ name: 'Scan', status: OUTCOME.UNREADABLE, detail: e?.message || String(e) }],
      files: [],
      durationMs: 0,
      summary: { examined: 0, ok: 0, unreadable: 0, damaged: 0, missing: 0, skipped: 0, repaired: 0, problems: 1 },
    };
  }
}
