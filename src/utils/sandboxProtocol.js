/**
 * sandboxProtocol.js — the conversation between the app and an extension frame.
 *
 * Split out of extensionSandbox.js for one reason: nothing in here imports
 * anything. Not React, not the design system, not Capacitor. That makes it the
 * only part of the sandbox a browser can be handed directly — strip the
 * `export` keywords and it is a valid classic script — which is what lets
 * `npm run check:extensions` drive the REAL protocol in a REAL frame instead of
 * a reimplementation of it that agrees with the original until one of them
 * changes.
 *
 * That mattered more than it sounds. Before this split the bootstrap below was
 * a string that had never been executed anywhere: jsdom cannot run a frame's
 * scripts, so every test of the sandbox was a test of the mock beside it.
 *
 * ── The messages ─────────────────────────────────────────────────────────────
 *
 *   frame → app   ext-boot                       I am alive, send me the code
 *   app   → frame ext-load    {modules,entry,…}  the module graph, leaves first
 *   frame → app   ext-ready   {error}            activate() returned, or did not
 *   frame → app   ext-call    {id,method,args}   do this for me
 *   app   → frame ext-reply   {id,result,error}  here, or here is why not
 *   app   → frame ext-hook    {id,name,args}     something happened; do you care
 *   frame → app   ext-reply   {id,result}        the handler's answer
 *   app   → frame ext-deactivate                 last chance to clean up
 *   frame → app   ext-deactivated                 ...and it is taken; drop me
 *
 * `ext-reply` travels both directions with independent id spaces, which is
 * safe because each side only ever looks up ids it issued.
 */

/**
 * The sandbox attribute every extension frame carries. One string, exported,
 * because there are two of those frames and they drifted.
 *
 * `extensionSandbox.js` builds the background frame and `ExtensionPage.jsx`
 * renders the UI one. They run the same bootstrap and need the same boundary,
 * but each spelled its own attribute — and the UI half kept
 * `allow-same-origin allow-forms allow-modals` long after the background half
 * was narrowed. `allow-same-origin` on a *srcdoc* document is the whole
 * boundary: srcdoc content inherits the embedder's origin, so extension UI was
 * running with the app's, one property access from `parent.localStorage` and
 * the books and access key inside it.
 *
 * What made that survivable for so long is worse than the flag itself.
 * `check:sandbox` asserts this exact property in a real browser — and passed,
 * because it built its own frame with its own hard-coded `allow-scripts`
 * rather than the one the app ships. A check that writes down the answer it
 * expects is checking the fixture. It reads this constant now, and so does
 * every frame.
 *
 * Nothing else goes in it. `allow-forms` and `allow-modals` were the UI half's
 * additions and neither is needed: a `submit` handler that calls
 * `preventDefault` works without `allow-forms` (only the navigation is
 * blocked), and `alert()` from an extension is indistinguishable from the
 * app's own dialogs, which is a good enough reason on its own.
 */
export const FRAME_SANDBOX = 'allow-scripts';

/**
 * The frame's half, as a source string, parameterised by which host API it
 * hands the extension.
 *
 * There are two of those APIs and only one protocol. v1 gets a flat object
 * whose method names ARE the dispatch names; v2 gets a namespaced one whose
 * names are the v2 capability names, because v2's dispatch checks a permission
 * per method and a flat `getSessions` has no permission to check.
 *
 * They are built from one template rather than written twice, for the reason
 * this whole file exists: the previous pair of frame builders spelled their own
 * sandbox attribute and drifted, and one of them carried `allow-same-origin`
 * for months. Two hand-maintained copies of a message protocol would go the
 * same way, and the failure would be a version of the app that talks to a
 * version of the frame that no longer answers.
 *
 * @param {string} apiSource  a function expression: (call, hooks, listeners) => api
 */
function frameBootstrap(apiSource) {
  return `
(function () {
  'use strict';
  var pending = {};
  var seq = 0;
  var hooks = {};
  var listeners = [];

  function call(method, args) {
    return new Promise(function (res, rej) {
      var id = ++seq;
      pending[id] = { res: res, rej: rej };
      parent.postMessage({ type: 'ext-call', id: id, method: method, args: args }, '*');
    });
  }

  function reply(id, result, error) {
    parent.postMessage({ type: 'ext-reply', id: id, result: result, error: error }, '*');
  }

  // The host API, built by whichever version this frame is for. Every method on
  // it is a round trip the host can refuse; there is no other surface, because
  // there is no other origin to reach.
  var api = (${apiSource})(call, hooks, listeners);

  window.AuthnoHostAPI = api;

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg) return;

    if (msg.type === 'ext-reply') {
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (msg.error) p.rej(new Error(msg.error)); else p.res(msg.result);
      return;
    }

    // A push from the host — the activity meter, so far. Unlike a hook it
    // wants no answer, which is why it is a separate message type: a listener
    // that throws must not look like a handler that refused.
    if (msg.type === 'ext-event') {
      for (var li = 0; li < listeners.length; li++) {
        try { listeners[li](msg.event); } catch (err) { /* one listener, not all */ }
      }
      return;
    }

    // A hook fired in the app. Run every handler, hand back the first result
    // that is not undefined, and never let one handler's throw stop the others.
    if (msg.type === 'ext-hook') {
      var list = hooks[msg.name] || [];
      Promise.all(list.map(function (h) {
        try { return Promise.resolve(h.apply(null, msg.args || [])).catch(function () { return undefined; }); }
        catch (err) { return Promise.resolve(undefined); }
      })).then(function (results) {
        var first;
        for (var i = 0; i < results.length; i++) {
          if (results[i] !== undefined) { first = results[i]; break; }
        }
        reply(msg.id, first, null);
      });
      return;
    }

    // The module graph, leaves first. Each becomes a blob URL, and the next
    // module's source already names it — which is the only order blob URLs can
    // be built in, since a URL cannot be referenced before its content exists.
    if (msg.type === 'ext-load') {
      (function () {
        var urls = [];
        try {
          for (var i = 0; i < msg.modules.length; i++) {
            var src = msg.modules[i].source;
            // Swap each placeholder for the blob URL that module became. The
            // list is leaves-first, so everything this module imports already
            // has one — which is the only order blob URLs can be built in.
            for (var j = 0; j < urls.length; j++) {
              src = src.split('__authno_mod_' + j + '__').join(urls[j]);
            }
            urls.push(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
          }
        } catch (err) {
          parent.postMessage({ type: 'ext-ready', error: 'blob: ' + err.message }, '*');
          return;
        }
        import(urls[urls.length - 1]).then(function (mod) {
          if (typeof mod.activate !== 'function') {
            parent.postMessage({ type: 'ext-ready', error: 'no activate() export' }, '*');
            return;
          }
          return Promise.resolve(mod.activate(Object.assign({}, api, {
            extension: msg.manifest,
            app: msg.app,
          }))).then(function (deactivate) {
            window.__authnoDeactivate = typeof deactivate === 'function' ? deactivate : null;
            parent.postMessage({ type: 'ext-ready', error: null }, '*');
          });
        }).catch(function (err) {
          parent.postMessage({ type: 'ext-ready', error: String(err && err.message ? err.message : err) }, '*');
        });
      })();
      return;
    }

    // Deactivating is not instant. An extension's teardown may flush a queue
    // or write its last state, and those are host calls — round trips that
    // need the app still listening when they arrive. So the frame does its
    // work, waits for it, and only then says it is done; the app tears down on
    // that word rather than on its own message going out.
    if (msg.type === 'ext-deactivate') {
      var fn = window.__authnoDeactivate;
      window.__authnoDeactivate = null;
      Promise.resolve()
        .then(function () { return fn ? fn() : undefined; })
        .catch(function () { /* a teardown that throws still ends */ })
        .then(function () {
          hooks = {};
          parent.postMessage({ type: 'ext-deactivated' }, '*');
        });
      return;
    }
  });

  parent.postMessage({ type: 'ext-boot' }, '*');
})();
`;
}

/**
 * v1's API: flat names that are also the dispatch names.
 *
 * Frozen. v1 extensions are built against exactly this and the whole v1 path
 * is deleted in one commit when Cloud Backup ships as 2.0.0 — nothing new
 * should be added here.
 */
const API_V1 = `function (call, hooks) {
  function makeStorage() {
    return {
      get: function (k) { return call('storage.get', [k]); },
      set: function (k, v) { return call('storage.set', [k, v]); },
      remove: function (k) { return call('storage.set', [k, null]); },
      keys: function () { return call('storage.keys', []); },
      getJSON: function (k, fallback) {
        return call('storage.get', [k]).then(function (v) {
          if (v === null || v === undefined) return fallback === undefined ? null : fallback;
          try { return JSON.parse(v); } catch (e) { return fallback === undefined ? null : fallback; }
        });
      },
      setJSON: function (k, v) { return call('storage.set', [k, JSON.stringify(v)]); },
    };
  }

  return {
    version: 4,
    storage: makeStorage(),
    navigate: function (pageId, session) { return call('navigate', [pageId, session]); },
    toast: function (m, o) { return call('toast', [String(m == null ? '' : m), o || {}]); },
    openBrowser: function (url) { return call('openBrowser', [url]); },
    closeBrowser: function () { return call('closeBrowser', []); },
    googleSignIn: function (opts) { return call('googleSignIn', [opts]); },
    oauth: function (opts) { return call('oauth', [opts || {}]); },
    getSessions: function () { return call('getSessions', []); },
    encodeSession: function (s) { return call('encodeSession', [s]); },
    importSession: function (b64) { return call('importSession', [b64]); },
    replaceSession: function (id, b64) { return call('replaceSession', [id, b64]); },
    exportSessionAs: function (s, fmt) { return call('exportSessionAs', [s, fmt]); },
    requestDriveToken: function (opts) { return call('native.GoogleDrive.requestDriveToken', [opts]); },
    registerHook: function (name, handler) {
      (hooks[name] = hooks[name] || []).push(handler);
      call('registerHook', [name]);
      return function off() {
        hooks[name] = (hooks[name] || []).filter(function (h) { return h !== handler; });
      };
    },
  };
}`;

export const BOOTSTRAP = frameBootstrap(API_V1);

/**
 * v2's API: namespaced, and the names are the capability names.
 *
 * The shape is not decoration. v2's dispatch looks up a permission per method
 * (`library.get` needs `library:read:current`, `browser.open` needs `browser`),
 * so a flat `getSessions` has nothing to check and could only ever be
 * ungoverned. Writing the frame's API as `authno.library.get(id)` means the
 * call an author writes and the permission a user approved are the same word.
 *
 * Three things an author should know, because each is a real edge:
 *
 * 1. **`network` has no method here.** The permission is enforced by the CSP in
 *    this document, so an extension just calls `fetch()` and the browser
 *    refuses anything off the manifest's host list. `network.requestHost` is
 *    the one exception, because adding a host is an act, not a request.
 *
 * 2. **A granted host does not reach a running frame.** A document cannot be
 *    re-policied after it loads, so `requestHost` resolves with
 *    `needsRestart: true` and the extension should say so rather than retrying
 *    a fetch that will keep failing.
 *
 * 3. **`library.get` is scoped by argument, not by name.** With only
 *    `library:read:current` it answers for the open book and refuses every
 *    other id. `library.getAny` is the one that needs `library:read:all`.
 */
export const API_V2 = `function (call, hooks, listeners) {
  function ns(prefix) {
    return function (name, args) { return call(prefix + '.' + name, args || []); };
  }
  var s = ns('storage'), u = ns('ui'), l = ns('library'), a = ns('app');

  return {
    version: 2,

    app: {
      version: function () { return a('version'); },
      platform: function () { return a('platform'); },
      locale: function () { return a('locale'); },
    },

    ui: {
      toast: function (m, o) { return u('toast', [String(m == null ? '' : m), o || {}]); },
      navigate: function (pageId, session) { return u('navigate', [pageId, session || null]); },
      prompt: function (o) { return u('prompt', [o || {}]); },
      confirm: function (o) { return u('confirm', [o || {}]); },
      overlay: {
        set: function (text) { return call('ui.overlay.set', [text]); },
        clear: function () { return call('ui.overlay.clear', []); },
      },
    },

    storage: {
      get: function (k) { return s('get', [k]); },
      set: function (k, v) { return s('set', [k, v]); },
      remove: function (k) { return s('remove', [k]); },
      keys: function () { return s('keys', []); },
      getJSON: function (k, fallback) { return s('getJSON', [k, fallback]); },
      setJSON: function (k, v) { return s('setJSON', [k, v]); },
    },

    library: {
      list: function (o) { return l('list', [o || {}]); },
      get: function (id, o) { return l('get', [id, o || {}]); },
      getAny: function (id, o) { return l('getAny', [id, o || {}]); },
      create: function (book) { return l('create', [book]); },
      update: function (id, patch) { return l('update', [id, patch]); },
      exportAs: function (id, format) { return l('export', [id, format]); },
    },

    browser: {
      open: function (url) { return call('browser.open', [url]); },
      close: function () { return call('browser.close', []); },
    },

    auth: {
      oauth: function (o) { return call('auth.oauth', [o || {}]); },
      googleSignIn: function (o) { return call('auth.googleSignIn', [o]); },
      requestDriveToken: function (o) { return call('auth.requestDriveToken', [o]); },
      // Resolves { ok: false, reason } rather than throwing when there is no
      // native session to end, so a teardown can await it unconditionally.
      signOut: function () { return call('auth.signOut', []); },
    },

    network: {
      requestHost: function (url) { return call('network.requestHost', [url]); },
    },

    activity: {
      getRate: function () { return call('activity.getRate', []); },
      onWriting: function (handler) {
        if (typeof handler !== 'function') return call('activity.onWriting', [false]);
        listeners.push(handler);
        call('activity.onWriting', [true]);
        return function off() {
          var i = listeners.indexOf(handler);
          if (i >= 0) listeners.splice(i, 1);
          if (listeners.length === 0) call('activity.onWriting', [false]);
        };
      },
    },

    /**
     * Something a button, a settings action or a readout can invoke.
     *
     * Only names in the manifest's \`commands\` array are accepted — the host
     * refuses the rest — so what a contribution might trigger is knowable by
     * reading the manifest rather than by running the code. That is what makes
     * a contribution reviewable before it is installed.
     *
     * Registered under a reserved prefix so a command and a hook can share the
     * same name without either shadowing the other.
     */
    commands: {
      register: function (name, handler) {
        var key = '__command:' + name;
        hooks[key] = [handler];
        return call('commands.register', [name]).then(function () {
          return function off() { delete hooks[key]; };
        });
      },
    },

    registerHook: function (name, handler) {
      (hooks[name] = hooks[name] || []).push(handler);
      call('registerHook', [name]);
      return function off() {
        hooks[name] = (hooks[name] || []).filter(function (h) { return h !== handler; });
      };
    },
  };
}`;

export const BOOTSTRAP_V2 = frameBootstrap(API_V2);

/**
 * The same API, for a v2 extension's UI page.
 *
 * A page is a second frame of the same extension, and the whole point of it
 * being second is that it must not be more powerful than the first. v1's page
 * bridge was a hand-written object with `getSessions`, `importSession` and
 * `encodeSession` on it and no permission check anywhere — so an extension
 * that had been refused the library could open its own settings page and read
 * every book from there.
 *
 * This builds the identical object from the identical source and the host
 * routes it through the identical dispatch, so a page can do exactly what the
 * background half can do and nothing else.
 *
 * Two differences, both because a page is not a background worker: `hooks` is
 * an empty object (a page cannot register one — it is gone when the user
 * navigates away, and a hook that outlived its frame would fire into nothing),
 * and `close()` is added, which is the one thing only a page needs.
 */
export function pageApiV2() {
  return `
(function () {
  'use strict';
  var pending = {};
  var seq = 0;
  var listeners = [];

  function call(method, args) {
    return new Promise(function (res, rej) {
      var id = ++seq;
      pending[id] = { res: res, rej: rej };
      window.parent.postMessage({ type: 'api-call', id: id, method: method, args: args }, '*');
    });
  }

  var api = (${API_V2})(call, {}, listeners);
  api.close = function () { window.parent.postMessage({ type: 'ext-close' }, '*'); };
  // A page cannot outlive itself, so a hook it registered could only fire into
  // a frame that is gone. Refused with a reason rather than silently ignored.
  api.registerHook = function () {
    throw new Error('a page cannot register a hook — do that in the extension\\'s background half');
  };
  window.authno = api;

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg) return;
    if (msg.type === 'api-result') {
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (msg.error) p.rej(new Error(msg.error)); else p.res(msg.result);
      return;
    }
    if (msg.type === 'ext-event') {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](msg.event); } catch (err) { /* one listener, not all */ }
      }
    }
  });
})();
`;
}

/**
 * The srcdoc for one extension's frame.
 *
 * No CSP meta tag: the opaque origin is the boundary, and a policy inside the
 * frame would only constrain code that is already walled off.
 *
 * The closing tag is split so this file can be served as a script itself
 * without the parser ending it here — the usual reason, not a typo.
 */
export function sandboxDocument() {
  const close = `</${'script'}>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><script>${BOOTSTRAP}${close}</head><body></body></html>`;
}

/**
 * The app's half of the conversation.
 *
 * Given a way to talk to one frame and a way to perform a request, this
 * returns the message handler and a teardown. It holds no opinion about WHAT
 * an extension may ask for — that is `dispatch`, and it lives with the
 * capabilities it grants rather than with the plumbing that carries them.
 *
 * @param {object}   o
 * @param {Function} o.post          send one message to the frame
 * @param {Function} o.dispatch      (method, args) => Promise<any>
 * @param {Function} o.onReady       ({ok, error}) once activate() has settled
 * @param {Function} o.registerHook  (name, handler) => unsubscribe
 * @param {Function} o.payload       () => the ext-load body
 * @param {Function} [o.sendable]    make a value survive structured clone
 * @param {number}   [o.hookTimeoutMs]
 */
export function createHostRouter({
  post, dispatch, onReady, registerHook, payload,
  sendable = (v) => v,
  hookTimeoutMs = 5000,
  teardownTimeoutMs = 3000,
}) {
  const hookOffs = [];
  const hookPending = new Map();
  let hookSeq = 0;

  /**
   * Ask the frame to run something it registered, and wait for the answer.
   *
   * Used by two callers that look different and are not: a hook the app's own
   * bus fired, and a command a button invoked. Both are "the host has a name
   * the frame gave it and wants the handler behind it run", and both must be
   * bounded — a frame that never answers must not stall the app's hook chain
   * or leave a button spinning. The extension is a listener here, not a
   * gatekeeper.
   */
  function fire(name, args) {
    return new Promise((resolve) => {
      if (torn) return resolve(undefined);
      const id = ++hookSeq;
      hookPending.set(id, resolve);
      setTimeout(() => { if (hookPending.delete(id)) resolve(undefined); }, hookTimeoutMs);
      post({ type: 'ext-hook', id, name, args: sendable(args) });
    });
  }
  let closing = false;   // deactivate sent; still answering the frame
  let torn = false;      // done; the frame is on its own
  let closed = null;     // resolves when the frame says it has finished

  async function onMessage(msg) {
    if (torn || !msg || typeof msg !== 'object') return;

    // The frame's teardown has finished. Anything it wanted to save has been
    // saved, because it waited for those calls before sending this.
    if (msg.type === 'ext-deactivated') {
      finish();
      return;
    }

    if (msg.type === 'ext-boot') {
      post({ type: 'ext-load', ...payload() });
      return;
    }

    if (msg.type === 'ext-ready') {
      onReady(msg.error ? { ok: false, error: msg.error } : { ok: true });
      return;
    }

    // A hook handler's answer coming back. Ids here are ours, issued below.
    if (msg.type === 'ext-reply') {
      const settle = hookPending.get(msg.id);
      if (!settle) return;
      hookPending.delete(msg.id);
      settle(msg.result);
      return;
    }

    if (msg.type !== 'ext-call') return;

    // Registering is the one request answered here rather than in dispatch:
    // it is about this conversation, not about a capability. The handler stays
    // in the frame; only the name crosses, so the app knows what to forward.
    if (msg.method === 'registerHook') {
      // A hook registered while shutting down would be wired to a bus this
      // frame is about to stop answering.
      if (closing) { post({ type: 'ext-reply', id: msg.id, result: null, error: null }); return; }
      const name = String(msg.args?.[0] ?? '');
      hookOffs.push(registerHook(name, (...args) => fire(name, args)));
      post({ type: 'ext-reply', id: msg.id, result: null, error: null });
      return;
    }

    try {
      const result = await dispatch(msg.method, msg.args ?? []);
      post({ type: 'ext-reply', id: msg.id, result: sendable(result), error: null });
    } catch (err) {
      post({ type: 'ext-reply', id: msg.id, result: null, error: String(err?.message ?? err) });
    }
  }

  function finish() {
    if (torn) return;
    torn = true;
    for (const off of hookOffs) { try { off(); } catch { /* already gone */ } }
    // Anything still waiting on the frame resolves rather than leaking a
    // promise nobody will ever settle.
    for (const settle of hookPending.values()) { try { settle(undefined); } catch { /* gone */ } }
    hookPending.clear();
    if (closed) closed();
  }

  /**
   * Ask the frame to stop, and wait for it to have stopped.
   *
   * Returns a promise so the caller does not remove the frame out from under a
   * teardown that is still writing. Bounded, because a frame that never
   * answers must not keep the app from closing it — but the bound is the only
   * thing that ends this, so it is generous relative to a couple of round
   * trips.
   */
  function teardown() {
    if (torn) return Promise.resolve();
    if (closing) return closed ? closedPromise : Promise.resolve();
    closing = true;
    // Hooks stop firing now: the frame is going, and an answer that arrives
    // after it has gone is worse than no answer.
    for (const off of hookOffs) { try { off(); } catch { /* already gone */ } }
    hookOffs.length = 0;
    post({ type: 'ext-deactivate' });
    setTimeout(finish, teardownTimeoutMs);
    return closedPromise;
  }

  let closedPromise = new Promise((res) => { closed = res; });

  // `fire` is exposed so the command registry can reach a handler the frame
  // registered without going through the app's hook bus — a command is
  // invoked by a button, not broadcast to every listener.
  return { onMessage, teardown, fire };
}

/**
 * postMessage uses structured clone, which throws on a function, a DOM node or
 * a React element — and a throw there would look to the extension like the host
 * hanging up mid-call. A JSON round trip drops exactly the things that cannot
 * cross anyway, and does it where the failure can be explained.
 */
export function toSendable(value) {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}
