/**
 * ErrorLogger.js — Structured error reporting for AuthNo
 *
 * Catches errors from file I/O, format parsing, extensions and themes, formats
 * them into something a person can act on, and keeps a history the writer can
 * review and send us.
 *
 * Usage:
 *   import { logError, getErrorHistory, clearErrorHistory } from './ErrorLogger';
 *
 *   try { ... } catch (e) {
 *     logError('saveBook', e, { sessionTitle: session.title });
 *   }
 *
 * ── Two things this gets right that the first version did not ────────────────
 *
 * 1. A repeating error no longer destroys the log. Entries are deduplicated on
 *    operation + message and carry a count. Autosave failing every two seconds
 *    used to push fifty copies of one message through a fifty-entry buffer and
 *    flush every other clue inside two minutes — precisely when something was
 *    badly wrong and the earlier entries mattered most. Fifty DISTINCT problems
 *    are now kept, and "×340" is better evidence than forty more copies.
 *
 * 2. Every operation the app actually logs has a category. Seventeen keys were
 *    in use against eight definitions, so extensions, themes, autosave, exports
 *    and the file read all fell through to "Unknown error — please restart the
 *    app": wrong, and unhelpful in a way that sends people to reinstall.
 *    Namespaced keys (`extensionLoader:loadManifest`) resolve by prefix, so a
 *    new one in an existing area is categorised without touching this file.
 */

const STORAGE_KEY = 'authno_error_log';
const MAX_ENTRIES = 50;

// ─── Severity ────────────────────────────────────────────────────────────────
// Drives ordering in the bug report, so whoever reads it starts with the thing
// that costs the writer something rather than a theme that failed to load.
export const SEVERITY = {
  DATA: 'data',   // work is at risk, or an operation on a manuscript failed
  APP: 'app',     // a feature is broken, the writing is fine
  MINOR: 'minor', // cosmetic or optional subsystem
};

// ─── Error categories ─────────────────────────────────────────────────────────
// `suggestion` is read by a writer mid-problem. It should say what to DO. If
// there is nothing useful to do, say that plainly rather than inventing a
// ritual — "restart the app" as a universal answer trains people to ignore it.

const CATEGORIES = {
  // ── Files and manuscripts ──
  saveBook:       { label: 'Save',          icon: '💾', severity: SEVERITY.DATA,
                    suggestion: 'Your writing is still open and unsaved on screen. Try Save As to write it somewhere else before closing the app.' },
  saveAsBook:     { label: 'Save As',       icon: '📁', severity: SEVERITY.DATA,
                    suggestion: 'Pick a different folder — some locations do not allow apps to write.' },
  autoSaveBook:   { label: 'Auto-save',     icon: '💾', severity: SEVERITY.DATA,
                    suggestion: 'Nothing is lost yet, but the automatic copy is not being written. Use Save to place this book somewhere you choose.' },
  openBook:       { label: 'Open file',     icon: '📂', severity: SEVERITY.APP,
                    suggestion: 'The file may be damaged or not a .authbook. Try opening it from the Library instead of the file manager.' },
  importBook:     { label: 'Import',        icon: '📥', severity: SEVERITY.APP,
                    suggestion: 'Check the file opens in whatever created it. Very large documents can also fail here.' },
  listSavedBooks: { label: 'Load library',  icon: '📚', severity: SEVERITY.APP,
                    suggestion: 'Books already open are unaffected. Developer → Scan for books shows which files could not be read.' },
  readSessionFromFile: { label: 'Read book file', icon: '📖', severity: SEVERITY.DATA,
                    suggestion: 'The book is on disk but could not be read back. Open it from the Library to reconnect it.' },
  encodeSession:  { label: 'Encode book',   icon: '⚙️', severity: SEVERITY.DATA,
                    suggestion: 'The book could not be prepared for writing to disk. Please send this report — it should not happen.' },
  decodeSession:  { label: 'Decode book',   icon: '⚙️', severity: SEVERITY.DATA,
                    suggestion: 'The file could not be understood. Damaged files are often repairable — send this report before deleting anything.' },
  permissions:    { label: 'Permissions',   icon: '🔒', severity: SEVERITY.APP,
                    suggestion: 'Android Settings → Apps → AuthNo → Permissions, then allow file access.' },

  // ── Exports ──
  exportTxt:      { label: 'Export TXT',    icon: '📤', severity: SEVERITY.APP,
                    suggestion: 'Your book is unaffected. Try another format, or export one chapter at a time.' },
  exportHtml:     { label: 'Export HTML',   icon: '📤', severity: SEVERITY.APP,
                    suggestion: 'Your book is unaffected. Try another format, or export one chapter at a time.' },
  exportEpub:     { label: 'Export EPUB',   icon: '📤', severity: SEVERITY.APP,
                    suggestion: 'Your book is unaffected. Try another format, or export one chapter at a time.' },
  exportPdf:      { label: 'Export PDF',    icon: '📤', severity: SEVERITY.APP,
                    suggestion: 'Your book is unaffected. PDF is the heaviest format — TXT or EPUB will usually work.' },

  // ── Subsystems (namespaced keys resolve to these by prefix) ──
  extensionLoader:  { label: 'Extensions',  icon: '🧩', severity: SEVERITY.MINOR,
                      suggestion: 'An extension failed to load. Your books are unaffected; disable it in Extensions if it keeps happening.' },
  extensionRuntime: { label: 'Extensions',  icon: '🧩', severity: SEVERITY.MINOR,
                      suggestion: 'An extension misbehaved while running. Your books are unaffected; disable it in Extensions.' },
  extbkInstaller:   { label: 'Extensions',  icon: '🧩', severity: SEVERITY.MINOR,
                      suggestion: 'A bundled extension could not be installed. Nothing else is affected.' },
  themeLoader:      { label: 'Themes',      icon: '🎨', severity: SEVERITY.MINOR,
                      suggestion: 'A theme could not be loaded, so the default is in use. Nothing else is affected.' },
  bookScan:         { label: 'Book scan',   icon: '🔎', severity: SEVERITY.APP,
                      suggestion: 'See the scan report in Developer → Scan for books for which files failed and why.' },
  refresh:          { label: 'Refresh',     icon: '🔄', severity: SEVERITY.MINOR,
                      suggestion: 'Try the action again.' },

  unknown:        { label: 'Unexpected error', icon: '❓', severity: SEVERITY.APP,
                    suggestion: 'Your books are not affected by this. Please send this report so it can be identified.' },
};

/**
 * Resolve an operation key to a category.
 *
 * Exact match first, then the part before the first colon, so
 * `extensionLoader:discoverExtensions` lands on `extensionLoader` and a new
 * operation in an existing area is categorised without editing this file.
 */
export function categoryFor(operation) {
  if (CATEGORIES[operation]) return CATEGORIES[operation];
  const ns = String(operation ?? '').split(':')[0];
  return CATEGORIES[ns] || CATEGORIES.unknown;
}

// ─── Core log function ────────────────────────────────────────────────────────

/**
 * Record an error. Call this in every catch block.
 *
 * @param {string}  operation  - the failing operation ('saveBook', 'themeLoader:scan')
 * @param {Error}   error      - the caught error
 * @param {object}  [context]  - extra detail (e.g. { sessionTitle, filePath })
 * @returns {object}           - the stored entry
 */
export function logError(operation, error, context = {}) {
  const category = categoryFor(operation);
  const message = error?.message || String(error);
  const now = new Date().toISOString();

  const entry = {
    id:         `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp:  now,
    firstSeen:  now,
    count:      1,
    operation,
    category:   category.label,
    icon:       category.icon,
    severity:   category.severity,
    suggestion: category.suggestion,
    message,
    stack:      error?.stack || null,
    context,
    appVersion: _getAppVersion(),
    platform:   _getPlatform(),
  };

  try {
    const existing = _loadHistory();
    // Same operation AND same message = the same problem happening again. Keep
    // one entry, count it, and move it to the front so recency still reads
    // correctly. Context is refreshed to the latest occurrence: when autosave
    // fails on four books in turn, the most recent filePath is the useful one.
    const at = existing.findIndex((e) => e.operation === operation && e.message === message);
    let updated;
    if (at !== -1) {
      const prev = existing[at];
      const merged = {
        ...prev,
        timestamp: now,
        count: (prev.count || 1) + 1,
        firstSeen: prev.firstSeen || prev.timestamp,
        context,
        stack: entry.stack || prev.stack,
        // Categories can change between versions; re-resolve on every hit so an
        // old entry does not keep a stale label after an update.
        category: category.label,
        icon: category.icon,
        severity: category.severity,
        suggestion: category.suggestion,
      };
      updated = [merged, ...existing.slice(0, at), ...existing.slice(at + 1)];
    } else {
      updated = [entry, ...existing];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated.slice(0, MAX_ENTRIES)));
  } catch { /* storage full or unavailable — still return and log the entry */ }

  console.error(`[AuthNo ${category.label}]`, message, context, error);
  return entry;
}

// ─── History management ───────────────────────────────────────────────────────

export function getErrorHistory() {
  return _loadHistory();
}

export function clearErrorHistory() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Count of distinct problems, and of total occurrences. */
export function errorSummary() {
  const h = _loadHistory();
  return {
    distinct: h.length,
    total: h.reduce((n, e) => n + (e.count || 1), 0),
    worst: h.some((e) => e.severity === SEVERITY.DATA) ? SEVERITY.DATA
      : h.some((e) => e.severity === SEVERITY.APP) ? SEVERITY.APP
        : h.length ? SEVERITY.MINOR : null,
  };
}

// ─── Human-readable report ────────────────────────────────────────────────────

export function formatError(entry) {
  const lines = [
    `${entry.icon} ${entry.category} failed${entry.count > 1 ? ` (×${entry.count})` : ''}`,
    ``,
    `What happened: ${entry.message}`,
    `Suggestion: ${entry.suggestion}`,
    ``,
    `── Technical details ──`,
    `Time:      ${new Date(entry.timestamp).toLocaleString()}`,
  ];
  if (entry.count > 1 && entry.firstSeen) {
    lines.push(`First seen: ${new Date(entry.firstSeen).toLocaleString()}`);
  }
  lines.push(
    `Operation: ${entry.operation}`,
    `Severity:  ${entry.severity || 'app'}`,
    `Version:   ${entry.appVersion}`,
    `Platform:  ${entry.platform}`,
  );

  if (Object.keys(entry.context || {}).length > 0) {
    lines.push(`Context:   ${JSON.stringify(entry.context)}`);
  }
  if (entry.stack) {
    lines.push(``, `Stack trace:`, entry.stack.split('\n').slice(0, 6).join('\n'));
  }
  return lines.join('\n');
}

/**
 * Format the log as a plain-text bug report.
 *
 * Ordered by severity, not time: whoever reads this should meet anything that
 * threatens the writing before a theme that failed to load.
 */
export function formatBugReport(maxEntries = 10) {
  const history = _loadHistory();
  if (!history.length) return 'No errors recorded.';

  const rank = { [SEVERITY.DATA]: 0, [SEVERITY.APP]: 1, [SEVERITY.MINOR]: 2 };
  const sorted = [...history].sort((a, b) =>
    (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1) ||
    new Date(b.timestamp) - new Date(a.timestamp)
  ).slice(0, maxEntries);

  const summary = errorSummary();
  const header = [
    `AuthNo Bug Report`,
    `Generated: ${new Date().toLocaleString()}`,
    `Version: ${_getAppVersion()}`,
    `Platform: ${_getPlatform()}`,
    `Problems: ${summary.distinct} distinct, ${summary.total} occurrences`,
    `─────────────────────────────`,
    '',
  ].join('\n');

  const body = sorted.map((e, i) => `[${i + 1}] ${formatError(e)}`)
    .join('\n\n─────────────────────────────\n\n');

  return header + body;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function _getAppVersion() {
  try {
    return localStorage.getItem('authno_version') || 'unknown';
  } catch { return 'unknown'; }
}

function _getPlatform() {
  if (typeof window === 'undefined') return 'unknown';
  if (window.Capacitor?.getPlatform() === 'android') return 'android';
  if (window.electron) return 'electron';
  return 'web';
}
