/**
 * ErrorLogger.js — Structured error reporting for AuthNo
 *
 * Catches errors from file I/O, format parsing, and other operations,
 * formats them into a human-readable report, and stores a history so
 * the user can review what went wrong and share it for debugging.
 *
 * Usage:
 *   import { logError, getErrorHistory, clearErrorHistory } from './ErrorLogger';
 *
 *   try { ... } catch (e) {
 *     logError('saveBook', e, { sessionTitle: session.title });
 *   }
 */

const STORAGE_KEY = 'authno_error_log';
const MAX_ENTRIES = 50;

// ─── Error categories ─────────────────────────────────────────────────────────

const CATEGORIES = {
  saveBook:         { label: 'Save',         icon: '💾', suggestion: 'Try Save As to choose a different location.' },
  saveAsBook:       { label: 'Save As',       icon: '📁', suggestion: 'Try tapping Save As again. If it keeps failing, restart the app.' },
  openBook:         { label: 'Open file',     icon: '📂', suggestion: 'The file may be corrupt or in an unsupported format.' },
  listSavedBooks:   { label: 'Load library',  icon: '📚', suggestion: 'Your books are still in memory. Try restarting the app.' },
  encodeSession:    { label: 'Encode book',   icon: '⚙️',  suggestion: 'This is an internal error. Please report it.' },
  decodeSession:    { label: 'Decode book',   icon: '⚙️',  suggestion: 'The file format may be outdated or corrupt.' },
  permissions:      { label: 'Permissions',   icon: '🔒', suggestion: 'Go to Android Settings → Apps → AuthNo → Permissions.' },
  unknown:          { label: 'Unknown error', icon: '❓', suggestion: 'Please restart the app and try again.' },
};

// ─── Core log function ────────────────────────────────────────────────────────

/**
 * Record an error. Call this in every catch block.
 *
 * @param {string}  operation  - name of the function that failed (key of CATEGORIES)
 * @param {Error}   error      - the caught error object
 * @param {object}  [context]  - extra context (e.g. { sessionTitle, filePath })
 * @returns {object}           - the formatted error entry
 */
export function logError(operation, error, context = {}) {
  const category = CATEGORIES[operation] || CATEGORIES.unknown;
  const entry = {
    id:        Date.now().toString(),
    timestamp: new Date().toISOString(),
    operation,
    category:  category.label,
    icon:      category.icon,
    suggestion: category.suggestion,
    message:   error?.message || String(error),
    stack:     error?.stack   || null,
    context,
    appVersion: _getAppVersion(),
    platform:   _getPlatform(),
  };

  // Persist to localStorage (capped at MAX_ENTRIES)
  try {
    const existing = _loadHistory();
    const updated  = [entry, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch { /* storage full or unavailable — still return the entry */ }

  // Always log to console for developer debugging
  console.error(`[AuthNo ${category.label}]`, entry.message, context, error);

  return entry;
}

// ─── History management ───────────────────────────────────────────────────────

export function getErrorHistory() {
  return _loadHistory();
}

export function clearErrorHistory() {
  localStorage.removeItem(STORAGE_KEY);
}

// ─── Human-readable report ────────────────────────────────────────────────────

/**
 * Format an error entry into a string suitable for sharing or displaying.
 */
export function formatError(entry) {
  const lines = [
    `${entry.icon} ${entry.category} failed`,
    ``,
    `What happened: ${entry.message}`,
    `Suggestion: ${entry.suggestion}`,
    ``,
    `── Technical details ──`,
    `Time:      ${new Date(entry.timestamp).toLocaleString()}`,
    `Operation: ${entry.operation}`,
    `Version:   ${entry.appVersion}`,
    `Platform:  ${entry.platform}`,
  ];

  if (Object.keys(entry.context || {}).length > 0) {
    lines.push(`Context:   ${JSON.stringify(entry.context)}`);
  }

  if (entry.stack) {
    lines.push(``, `Stack trace:`, entry.stack.split('\n').slice(0, 6).join('\n'));
  }

  return lines.join('\n');
}

/**
 * Format the last N errors as a plain-text bug report for sharing.
 */
export function formatBugReport(maxEntries = 10) {
  const history = _loadHistory().slice(0, maxEntries);
  if (!history.length) return 'No errors recorded.';

  const header = [
    `AuthNo Bug Report`,
    `Generated: ${new Date().toLocaleString()}`,
    `Version: ${_getAppVersion()}`,
    `Platform: ${_getPlatform()}`,
    `─────────────────────────────`,
    '',
  ].join('\n');

  const body = history.map((e, i) =>
    `[${i + 1}] ${formatError(e)}`
  ).join('\n\n─────────────────────────────\n\n');

  return header + body;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function _getAppVersion() {
  try {
    return localStorage.getItem('authno_version') || '1.1.8-beta.2';
  } catch { return 'unknown'; }
}

function _getPlatform() {
  if (typeof window === 'undefined') return 'unknown';
  if (window.Capacitor?.getPlatform() === 'android') return 'android';
  if (window.electron) return 'electron';
  return 'web';
}
