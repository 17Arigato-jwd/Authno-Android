/**
 * permissionRequests.js — the queue between an install and the person.
 *
 * `installExtbkBytes` needs an answer to "may this extension do these things"
 * and is not a React component; the dialog that asks is. This is the seam, and
 * it is a module rather than context for the same reason `extensionPrompts.js`
 * is: the install runs from an event handler wired up by MainActivity, long
 * before any component that could provide a context has mounted.
 *
 * ── Why an install can be left unanswered ───────────────────────────────────
 *
 * The install itself does NOT wait. It completes, and records that nobody was
 * asked — `_permissionsPending`. That distinction is the whole reason this
 * module is small: "you said no" and "nobody asked you" look identical from
 * inside an extension and are completely different to a person, and the app
 * has to be able to tell the difference months later.
 *
 * So this queue is allowed to outlive the sheet that would have drawn it. An
 * extension installed while the app was backgrounded, or from a cold-start
 * intent, is asked the next time somebody is looking.
 */

/** Nothing may sit in front of the writer forever. */
const MAX_QUEUED = 8;

export function createPermissionRequests() {
  const queue = [];
  const listeners = new Set();
  let visible = null;

  const notify = () => {
    for (const fn of listeners) {
      try { fn(); } catch { /* one listener's problem, not the queue's */ }
    }
  };

  /**
   * Promote the next request if nothing is showing.
   *
   * Deliberately silent. Every caller ends with `pump(); notify();` so one
   * state change produces one notification — an `ask` that both enqueues and
   * promotes is still one change to the screen, and notifying from both places
   * rendered it twice.
   */
  function pump() {
    if (visible || queue.length === 0) return;
    visible = queue.shift();
  }

  return {
    /**
     * Tell me when the visible request changes.
     *
     * A subscription rather than a constructor option, and that is not a
     * style choice. This is a module singleton: the first caller wins, and the
     * first caller is whichever install path runs first — which on Android is
     * a cold-start intent, before any component has mounted. A component that
     * could only install its callback by being the one to CREATE the queue
     * would silently never be told anything, and the sheet would never appear
     * for exactly the installs most in need of it.
     */
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    /**
     * Ask about one extension. Resolves with the permissions granted.
     *
     * @param {string} extId
     * @param {object} plan   from promptPlan(): { prompt, carried, dropped }
     * @param {object} [meta] { name, version, icon } for the dialog's heading
     */
    ask(extId, plan, meta = {}) {
      const asked = Array.isArray(plan?.prompt) ? plan.prompt : [];

      // Nothing to ask about. Answering immediately rather than drawing an
      // empty sheet: an update that added no permissions must not put a
      // dialog in front of somebody for the sake of consistency.
      if (asked.length === 0) return Promise.resolve([...(plan?.carried ?? [])]);

      // One extension, one question. A second install of the same id while
      // its dialog is up is the same question, and two of them would leave
      // whichever was answered second overwriting the first.
      const existing = visible?.extId === extId
        ? visible
        : queue.find((q) => q.extId === extId);
      if (existing) return existing.settled;

      // visible counts. The one on screen is still outstanding — it is the
      // one a person is looking at — and a cap that ignored it would let the
      // queue grow to MAX_QUEUED + 1 and, worse, mean the limit changed
      // depending on whether a sheet happened to be up.
      if (queue.length + (visible ? 1 : 0) >= MAX_QUEUED) {
        // Refused rather than dropped silently. An install that could not ask
        // records that nobody was asked, which is recoverable from the
        // Extensions tab; a promise that never settles is not.
        return Promise.reject(new Error('too many extensions are waiting to be asked'));
      }

      let resolve;
      const settled = new Promise((r) => { resolve = r; });
      queue.push({
        extId,
        name: String(meta.name ?? extId),
        version: meta.version ? String(meta.version) : null,
        icon: meta.icon ?? null,
        asked,
        carried: [...(plan?.carried ?? [])],
        dropped: [...(plan?.dropped ?? [])],
        settled,
        resolve,
      });
      // Notified even when this one does not become visible: the sheet says
      // how many are still waiting, so a second request changes what is on
      // screen without changing which request is on it.
      pump();
      notify();
      return settled;
    },

    /** What the dialog should draw, without the resolver. */
    current() {
      if (!visible) return null;
      const { resolve, settled, ...rest } = visible;
      return rest;
    },

    /** How many are still waiting, so the sheet can say "1 of 3". */
    waiting() { return queue.length; },

    /**
     * The person answered.
     *
     * `granted` is what they left switched on. Carried permissions are added
     * back because they were agreed to on a previous install and this dialog
     * never showed them — dropping them here would silently revoke a grant
     * the person was not asked about.
     */
    answer(granted = []) {
      if (!visible) return false;
      const entry = visible;
      visible = null;
      const allowed = new Set(entry.asked.map((a) => a.permission));
      const kept = [...new Set([
        ...granted.filter((g) => allowed.has(g)),
        ...entry.carried,
      ])];
      entry.resolve(kept);
      pump();
      notify();
      return true;
    },

    /**
     * Dismissed without answering — the back button, or the sheet's close.
     *
     * Resolves with the carried permissions only, which is "no to everything
     * new". Not a rejection: a dismissal is an answer, and the install has
     * already happened either way.
     */
    dismiss() {
      if (!visible) return false;
      const entry = visible;
      visible = null;
      entry.resolve([...entry.carried]);
      pump();
      notify();
      return true;
    },

    reset() {
      // Settle everything rather than leaving promises hanging. A caller
      // awaiting one of these is inside an install.
      if (visible) { visible.resolve([...visible.carried]); visible = null; }
      while (queue.length) { const q = queue.shift(); q.resolve([...q.carried]); }
      notify();
    },
  };
}

let shared = null;
export function permissionRequests() {
  if (!shared) shared = createPermissionRequests();
  return shared;
}
export function __resetPermissionRequests() {
  if (shared) shared.reset();
  shared = null;
}
