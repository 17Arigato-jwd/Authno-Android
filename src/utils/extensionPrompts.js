/**
 * extensionPrompts.js — host-drawn dialogs for `ui.prompt` and `ui.confirm`.
 *
 * Spec: docs/extension-system-v2-spec.md §2.2b, and the focus rule in §4a.3.
 *
 * The point of these being host-drawn is not convenience. An extension cannot
 * draw a dialog that looks like it came from AuthNo, because the only dialog
 * that looks like AuthNo is the one AuthNo drew — so a frame cannot put up
 * something that reads as the app asking for a pen name, or a password, or
 * confirmation of something it is not really about to do.
 *
 * They need no permission: a prompt reads nothing and sends nothing. The user
 * answers or does not.
 *
 * Three rules that exist to protect the writing path rather than the dialog:
 *
 *   1. **No prompt while the editor has focus.** A dialog stealing focus
 *      mid-sentence eats the keystrokes typed into it. An extension asking a
 *      question when the user is demonstrably not talking to it is refused.
 *   2. **One at a time, and one pending per extension.** Two dialogs at once is
 *      not a decision, it is a pile.
 *   3. **Cancel is an answer.** Dismissal resolves to null or false and never
 *      throws, so an extension that forgets to catch cannot turn a person
 *      declining into an unhandled rejection.
 */

export const MAX_TITLE = 60;
export const MAX_MESSAGE = 240;

/**
 * The verbatim line, budgeted apart from the message.
 *
 * A URL used to live inside `message` and count against its 240, so a long but
 * perfectly ordinary self-hosted WebDAV address pushed the host-grant question
 * over the limit — and the runtime's `.catch(() => false)` turned that into a
 * silent refusal to connect, with nothing on screen and no reason given. The
 * address is not prose and should never have been competing with prose for
 * room.
 */
export const MAX_EMPHASIS = 300;

export class PromptRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PromptRefused';
    this.code = code;
  }
}

/**
 * @param {object}   [o]
 * @param {Function} [o.editorHasFocus] () => boolean
 * @param {Function} [o.onChange]       called when the visible dialog changes
 */
export function createPrompts({
  editorHasFocus: initialFocusTest = () => false,
  onChange = null,
} = {}) {
  // `let`, because the app supplies this after the singleton exists — see
  // setEditorFocusTest.
  let editorHasFocus = initialFocusTest;
  /** At most one visible; others wait. extId → pending entry. */
  const queue = [];
  let visible = null;

  /**
   * Listeners, plus the constructor's onChange for callers that build their own.
   *
   * `prompts()` returns whatever already exists and ignores its argument, so a
   * component that could only be told about changes by CONSTRUCTING the
   * singleton would never be told about anything — extensionRuntime creates it
   * the first time an extension asks a question, which is long before the
   * dialog mounts. subscribe() is how a component joins one it did not make.
   */
  const listeners = new Set();
  const notify = () => {
    if (onChange) { try { onChange(); } catch { /* the UI's problem */ } }
    for (const fn of listeners) { try { fn(); } catch { /* one listener's */ } }
  };

  function shape(kind, extId, opts, trusted) {
    const title = String(opts?.title ?? '');
    const message = String(opts?.message ?? '');

    // Refused rather than truncated, and a `confirm` is why. "Delete every
    // book permanently?" cut to fit is a different question, and it is the
    // dangerous half that gets cut. An author hits this once, during
    // development, and fixes the string.
    if (title.length > MAX_TITLE) {
      throw new PromptRefused('title-too-long', `title is ${title.length} characters; the limit is ${MAX_TITLE}`);
    }
    if (message.length > MAX_MESSAGE) {
      throw new PromptRefused('message-too-long', `message is ${message.length} characters; the limit is ${MAX_MESSAGE}`);
    }
    if (!title && !message) {
      throw new PromptRefused('empty', 'a dialog needs a title or a message');
    }

    return {
      kind,
      extId: String(extId),
      title,
      message,
      // Read only for questions the APP composed. An extension that could set
      // these would be choosing which part of its own question looks
      // authoritative, and the whole reason these dialogs are host-drawn is
      // that it does not get to choose what the question looks like.
      emphasis: trusted ? String(opts?.emphasis ?? '').slice(0, MAX_EMPHASIS) : '',
      note: trusted ? String(opts?.note ?? '').slice(0, MAX_MESSAGE) : '',
      placeholder: kind === 'prompt' ? String(opts?.placeholder ?? '') : undefined,
      initial: kind === 'prompt' ? String(opts?.initial ?? '') : undefined,
      danger: kind === 'confirm' ? !!opts?.danger : undefined,
    };
  }

  function pump() {
    if (visible || queue.length === 0) return;
    visible = queue.shift();
    notify();
  }

  /**
   * Which question this is, not what it says.
   *
   * The dialog resets its text field when the question changes, and it needs
   * something to compare. Identity by content — extId + title + message —
   * says two IDENTICAL questions are the same one, and asking "Which folder?"
   * about a second book is exactly that: the field would still hold the answer
   * typed for the first.
   */
  let seq = 0;

  function enqueue(kind, extId, opts, trusted = false) {
    const id = String(extId);

    // Rule 1. Not deferred — refused, so the extension learns it asked at the
    // wrong moment rather than having a dialog appear later out of context.
    if (editorHasFocus()) {
      return Promise.reject(new PromptRefused('editor-has-focus', 'not while the editor has focus'));
    }
    if (visible?.extId === id || queue.some((q) => q.extId === id)) {
      return Promise.reject(new PromptRefused('already-asking', 'this extension already has a question open'));
    }

    let entry;
    try {
      entry = shape(kind, id, opts, trusted);
    } catch (e) {
      return Promise.reject(e);
    }
    entry.seq = ++seq;

    const settled = new Promise((resolve) => { entry.resolve = resolve; });
    queue.push(entry);
    pump();
    return settled;
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    prompt(extId, opts) { return enqueue('prompt', extId, opts); },
    confirm(extId, opts) { return enqueue('confirm', extId, opts); },

    /**
     * A question the app asks ON BEHALF of an extension.
     *
     * Same dialog, same attribution — the person is still told which extension
     * caused it — but the app wrote every word, so it may also say which part
     * is the fact being decided (`emphasis`) and which is the caution after it
     * (`note`). The host-grant question is the case: the address is the one
     * thing the answer turns on, and set in running prose it reads as
     * background.
     *
     * Deliberately not an option on `confirm`: `handlers.ui.confirm` hands the
     * sandbox's options straight through, so anything `confirm` honours is
     * something an extension can set.
     */
    hostConfirm(extId, opts) { return enqueue('confirm', extId, opts, true); },

    /**
     * What to draw, without the resolver.
     *
     * `extId` goes out with it so the dialog can be labelled with the
     * extension's name and colour — a person answering a question deserves to
     * know who is asking, and that is the whole reason these are host-drawn.
     */
    current() {
      if (!visible) return null;
      const { resolve, ...rest } = visible;
      return rest;
    },

    /** The user answered. A prompt returns its text; a confirm returns true. */
    answer(value) {
      if (!visible) return false;
      const entry = visible;
      visible = null;
      entry.resolve(entry.kind === 'prompt' ? String(value ?? '') : true);
      notify();
      pump();
      return true;
    },

    /** The user declined. Never a throw: declining is an answer. */
    dismiss() {
      if (!visible) return false;
      const entry = visible;
      visible = null;
      entry.resolve(entry.kind === 'prompt' ? null : false);
      notify();
      pump();
      return true;
    },

    /**
     * An extension was disabled or stopped while its question was on screen.
     *
     * Settled rather than left hanging: the frame is going, and a promise
     * nobody will ever resolve is a leak inside a sandbox that is about to be
     * destroyed anyway.
     */
    cancelFor(extId) {
      const id = String(extId);
      let cancelled = 0;

      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].extId === id) {
          queue[i].resolve(queue[i].kind === 'prompt' ? null : false);
          queue.splice(i, 1);
          cancelled += 1;
        }
      }
      if (visible?.extId === id) {
        const entry = visible;
        visible = null;
        entry.resolve(entry.kind === 'prompt' ? null : false);
        cancelled += 1;
      }
      if (cancelled) { notify(); pump(); }
      return cancelled;
    },

    pending() { return queue.length + (visible ? 1 : 0); },

    /**
     * Tell the queue how to find out whether the editor has focus.
     *
     * A constructor option, and `prompts()` takes none — so the rule it
     * governs ("not while the editor has focus") defaulted to `() => false`
     * and never fired. An extension could put a dialog in front of somebody
     * mid-sentence, which is the exact thing the rule exists to stop.
     */
    setEditorFocusTest(fn) {
      if (typeof fn === 'function') editorHasFocus = fn;
    },

    reset() {
      for (const q of queue) q.resolve(q.kind === 'prompt' ? null : false);
      queue.length = 0;
      if (visible) { visible.resolve(visible.kind === 'prompt' ? null : false); visible = null; }
    },
  };
}

let shared = null;
export function prompts(opts) {
  if (!shared) shared = createPrompts(opts);
  return shared;
}
export function __resetPrompts() {
  if (shared) shared.reset();
  shared = null;
}
