/**
 * sessionHooks.js — v1.1.14
 *
 * Lightweight singleton hook bus that lets extensions react to session
 * lifecycle events without touching core App.js logic.
 *
 * Supported hooks:
 *   onSave        { session, trigger }  — after every content change
 *                 (trigger: 'change') and after every successful disk write
 *                 (trigger: 'autosave').
 *   onBookOpen    { session }           — a book became the active book.
 *   onBookClose   { session }           — the active book was closed/switched away.
 *   onChapterOpen { session, chapIdx, chapTitle } — the editor opened a chapter.
 *   onBookCreate  { session }           — a new book was created.
 *   onBookDelete  { sessionId, title }  — a book was removed from the library.
 *   onExport      { session, format }   — an export finished (txt|html|epub|pdf).
 *
 * Handler names are not validated — registering for a hook that is never fired
 * is silently inert, which keeps forward compatibility cheap for extensions
 * targeting a newer host.
 *
 * Usage (in an extension's entry point, via ExtensionContext):
 *
 *   const { registerHook } = useExtensions();
 *   registerHook('onSave', ({ session, trigger }) => {
 *     if (trigger === 'autosave') queueCloudUpload(session);
 *   });
 *
 * Design constraints:
 *  - Handlers run sequentially (await-in-loop) so ordering is deterministic.
 *  - A handler that throws never blocks the save path — errors are caught and
 *    logged but do not propagate back to the caller.
 *  - fireHook() is always async and always resolves (never rejects).
 *  - Multiple extensions can register for the same hook name; all are called.
 */

const _hooks = {};   // { hookName: [fn, fn, ...] }

/** Every hook name the host currently fires. Exported so docs and the
 *  developer settings panel can list them without drifting from reality. */
export const HOOK_NAMES = Object.freeze([
  'onSave',
  'onBookOpen',
  'onBookClose',
  'onChapterOpen',
  'onBookCreate',
  'onBookDelete',
  'onExport',
]);

/**
 * Register a handler for a named hook.
 *
 * @param {string}   hookName - e.g. 'onSave'
 * @param {function} handler  - sync or async fn(payload) => void
 * @returns {function}        - call to unregister (cleanup in useEffect return)
 */
export function registerHook(hookName, handler) {
  if (typeof handler !== 'function') {
    console.warn(`[sessionHooks] registerHook(${hookName}): handler must be a function`);
    return () => {};
  }
  if (!_hooks[hookName]) _hooks[hookName] = [];
  _hooks[hookName].push(handler);

  // Return an unregister function so callers can clean up in useEffect
  return function unregister() {
    if (!_hooks[hookName]) return;
    const idx = _hooks[hookName].indexOf(handler);
    if (idx !== -1) _hooks[hookName].splice(idx, 1);
  };
}

/**
 * Fire all handlers registered for hookName, passing payload to each.
 * Runs sequentially; catches errors per-handler.
 *
 * @param {string} hookName
 * @param {*}      payload   - arbitrary data passed to every handler
 * @returns {Promise<void>}
 */
export async function fireHook(hookName, payload) {
  const handlers = _hooks[hookName];
  if (!handlers || handlers.length === 0) return;

  for (const fn of handlers) {
    try {
      await fn(payload);
    } catch (err) {
      console.error(`[sessionHooks] handler for '${hookName}' threw:`, err);
    }
  }
}

/**
 * Number of currently registered handlers for a hook name.
 * Useful for skipping fireHook() calls when nobody is listening.
 *
 * @param {string} hookName
 * @returns {number}
 */
export function hookCount(hookName) {
  return _hooks[hookName]?.length ?? 0;
}

/**
 * Remove all handlers for every hook name.
 * Intended for testing; do not call in production code.
 */
export function _resetAllHooks() {
  Object.keys(_hooks).forEach(k => delete _hooks[k]);
}
