/**
 * extensionRunnerV2.js — starting and stopping a v2 extension.
 *
 * Spec: docs/extension-system-v2-spec.md §9.
 *
 * The v1 runner in extensionSandbox.js builds a frame and wires a flat
 * `dispatch` that checks nothing. This one builds the frame from a host
 * (extensionHostV2.js), so the policy in the document and the checks on the
 * bridge come from one permission set, and a revoke moves both.
 *
 * Both runners exist during the port. That is not a shim: `runExtensionV2` is
 * selected by `apiVersion` and shares no code path with v1, so when Cloud
 * Backup ships as 2.0.0 the old one is deleted in a single commit rather than
 * unpicked. A v1 manifest reaching this function is refused (§9) — guessing
 * what its permissions would have been means guessing "all of them".
 *
 * What is NOT tested here, deliberately, following the note in
 * extensionSandbox.test.js: whether the frame is really isolated. jsdom has no
 * origin model, so such a test would pass just as happily against a frame
 * carrying `allow-same-origin`. That claim belongs to `npm run check:sandbox`
 * in a real browser. What IS tested here is everything decided *before* the
 * browser gets involved: which document is built, which policy is in it, which
 * messages are believed, and what teardown lets go of.
 */

import { createExtensionHost, ManifestError, API_VERSION } from './extensionHostV2.js';
import { FRAME_SANDBOX, BOOTSTRAP_V2, createHostRouter, toSendable } from './sandboxProtocol.js';

const ACTIVATE_TIMEOUT_MS = 15000;

const _running = new Map();

/**
 * Start one v2 extension.
 *
 * @param {object} o
 * @param {object}   o.manifest
 * @param {object}   o.files       path → source, the linkable module graph
 * @param {string}   o.entry
 * @param {string[]} o.granted
 * @param {string[]} o.userHosts   origins the user approved after install
 * @param {object}   o.handlers
 * @param {object}   [o.meter]
 * @param {Function} [o.onDenied]
 * @param {Function} [o.registerHook]
 * @param {object}   [o.dom]       document/window seam, for tests
 */
export async function runExtensionV2({
  manifest,
  files = {},
  entry = 'index.js',
  granted = [],
  userHosts = [],
  handlers,
  meter = null,
  onDenied = null,
  registerHook = () => () => {},
  dom = null,
  activateTimeoutMs = ACTIVATE_TIMEOUT_MS,
}) {
  // `??` would be wrong here: an explicitly null document is "there is no DOM",
  // not "fall back to the global one". Presence of `dom` decides which pair is
  // used, and the values inside it are taken as given.
  const doc = dom ? dom.document : (typeof document !== 'undefined' ? document : null);
  const win = dom ? dom.window : (typeof window !== 'undefined' ? window : null);
  if (!doc || !win) return { ok: false, error: 'no DOM to run an extension in' };

  if (manifest?.apiVersion !== API_VERSION) {
    // §9: refused, not adapted, and the message says what to do about it.
    return {
      ok: false,
      error: manifest?.apiVersion === undefined
        ? 'this extension was built for the old API — rebuild it with extbk build against v2'
        : `apiVersion ${manifest.apiVersion} is not supported — rebuild against v2`,
    };
  }

  let host;
  try {
    // userHosts, not just granted: a host the user approved at runtime lives
    // apart from the manifest's list and is the whole reason `network` can
    // cover a WebDAV server nobody could have named at build time. Dropping it
    // here — which is what happened until this line — meant an approved host
    // was written to disk, read back on the next start, and then left out of
    // the policy, so the fetch it was granted for kept failing and nothing in
    // the app could say why.
    host = createExtensionHost({
      manifest, granted, userHosts, handlers, meter, push: (e) => pushEvent(e), onDenied,
    });
  } catch (e) {
    if (e instanceof ManifestError) return { ok: false, error: e.message, errors: e.errors };
    throw e;
  }

  const extId = manifest.id;
  if (_running.has(extId)) await stopExtensionV2(extId);

  const frame = doc.createElement('iframe');
  // allow-scripts and nothing else. Adding allow-same-origin would undo the
  // whole design: srcdoc inherits the embedder's origin, so the two together
  // put the extension INSIDE the app rather than beside it.
  frame.setAttribute('sandbox', FRAME_SANDBOX);
  frame.setAttribute('title', `${manifest.name ?? extId} (background)`);
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';

  // The document carries the policy built from the grants in force. This is
  // the difference from v1, which shipped a frame with no policy at all.
  //
  // BOOTSTRAP_V2, not BOOTSTRAP: the two differ only in the API object they
  // hand the extension, and v1's is flat — `getSessions`, `openBrowser` — which
  // are the v1 dispatch's method names and mean nothing to this one. A v2
  // extension given the v1 bootstrap gets `unknown-method` for every call it
  // makes, which reads as a broken extension rather than a wrong frame.
  frame.srcdoc = host.document(BOOTSTRAP_V2);

  const post = (msg) => {
    try { frame.contentWindow?.postMessage(msg, '*'); } catch { /* torn down */ }
  };
  function pushEvent(event) {
    post({ type: 'ext-event', event: toSendable(event) });
  }

  let settle;
  const ready = new Promise((res) => { settle = res; });

  const router = createHostRouter({
    post,
    payload: () => ({ modules: buildModules(files, entry), entry, manifest }),
    dispatch: (method, args) => host.dispatch(method, args),
    onReady: (outcome) => settle(outcome),
    registerHook,
    sendable: toSendable,
  });

  const onMessage = (e) => {
    // Identity, not origin. An opaque-origin frame reports `origin: "null"`,
    // and so do several other things; the window reference is the only thing
    // that is actually this frame.
    if (e.source !== frame.contentWindow) return;
    router.onMessage(e.data);
  };

  win.addEventListener('message', onMessage);
  doc.body.appendChild(frame);

  let timer = null;
  const outcome = await Promise.race([
    ready,
    new Promise((res) => {
      timer = setTimeout(() => res({ ok: false, error: 'activation timed out' }), activateTimeoutMs);
    }),
  ]);
  if (timer !== null) clearTimeout(timer);

  const teardown = async () => {
    // Awaited rather than fired and forgotten: an extension's deactivate() may
    // flush a queue, and those are host calls that need the app still
    // listening when they land.
    await router.teardown();
    win.removeEventListener('message', onMessage);
    // dispose() after teardown, so calls made during deactivate() still work —
    // disposing first would refuse the extension's own last writes.
    host.dispose();
    try { frame.remove(); } catch { /* already detached */ }
  };

  if (!outcome.ok) { await teardown(); return outcome; }

  _running.set(extId, { frame, teardown, host });
  return { ok: true, host };
}

/**
 * The module list handed to the frame.
 *
 * Placeholders, not blob URLs: a blob minted out here would belong to the
 * app's origin, which is both useless to an opaque-origin frame and a small
 * hole in the wall it is standing behind. The frame mints its own.
 */
function buildModules(files, entry) {
  const paths = Object.keys(files);
  // Entry last — the order is leaves-first, because a module cannot be
  // referenced before the blob that defines it exists.
  const ordered = [...paths.filter((p) => p !== entry), ...paths.filter((p) => p === entry)];
  return ordered.map((path) => ({ path, source: files[path] }));
}

/** Stop one extension. Safe for one that is not running. */
export async function stopExtensionV2(extId) {
  const entry = _running.get(extId);
  if (!entry) return false;
  _running.delete(extId);
  try { await entry.teardown(); } catch { /* the frame is going regardless */ }
  return true;
}

export async function stopAllV2() {
  for (const extId of [..._running.keys()]) await stopExtensionV2(extId);
}

export function runningV2() {
  return [..._running.keys()];
}

/** The live host for one extension, for the settings screen. */
export function hostFor(extId) {
  return _running.get(extId)?.host ?? null;
}
