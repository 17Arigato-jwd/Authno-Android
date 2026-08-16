/**
 * extensionDispatchV2.js — the one door out of an extension frame.
 *
 * Spec: docs/extension-system-v2-spec.md §2.3, §3.
 *
 * v1's dispatch is a flat switch with no checks, so an extension can reach
 * everything the switch can reach. This is the replacement, and the shape is
 * the point rather than the contents:
 *
 *   every call → requirePermission → capability → sendable result
 *
 * There is no second path. The frame is sandboxed with `allow-scripts` and no
 * `allow-same-origin`, so it has an opaque origin: no localStorage, no
 * IndexedDB, no same-origin fetch, and no way to reach the host except
 * postMessage — which arrives here. A check in this function is therefore a
 * check everywhere, which is why it is worth keeping this file boring.
 *
 * Capabilities are injected rather than imported. The host owns what
 * `library.get` means; this module owns only who may ask.
 */

import { PermissionDenied, UnknownMethod } from './extensionPermissionsV2.js';

/** A refusal an extension can catch, rather than a channel that dies. */
export class DispatchError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'DispatchError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const MAX_ARGS = 8;

/**
 * Build a dispatcher for one extension.
 *
 * @param {object} o
 * @param {string}        o.extId
 * @param {PermissionSet} o.permissions   the grants in force, live
 * @param {object}        o.capabilities  method name → async (args, ctx) => any
 * @param {Function}      [o.onDenied]    (permission, method) — for the warning UI
 * @param {Function}      [o.now]
 */
export function createDispatch({
  extId,
  permissions,
  capabilities,
  onDenied = null,
  now = () => Date.now(),
}) {
  if (!extId) throw new Error('createDispatch needs an extId');
  if (!permissions) throw new Error('createDispatch needs a PermissionSet');

  let disposed = false;

  async function dispatch(method, args = []) {
    if (disposed) {
      throw new DispatchError('extension-stopped', 'this extension is no longer running');
    }

    // Shape checks first. A method name that is not a string cannot be looked
    // up safely, and an unbounded argument list is a way to make the host do
    // unbounded work before any permission has been considered.
    if (typeof method !== 'string' || method === '') {
      throw new DispatchError('bad-method', 'method must be a non-empty string');
    }
    if (!Array.isArray(args)) {
      throw new DispatchError('bad-args', 'args must be an array');
    }
    if (args.length > MAX_ARGS) {
      throw new DispatchError('too-many-args', `at most ${MAX_ARGS} arguments`);
    }

    // The gate. Deliberately before the capability lookup: an extension must
    // not be able to probe which methods exist by watching which ones answer
    // "unknown" and which answer "denied".
    try {
      permissions.require(method, now());
    } catch (e) {
      if (e instanceof PermissionDenied) {
        if (onDenied) {
          try { onDenied(e.permission, method); } catch { /* reporting is best-effort */ }
        }
        throw new DispatchError('permission-denied', e.message, {
          permission: e.permission, method,
        });
      }
      if (e instanceof UnknownMethod) {
        throw new DispatchError('unknown-method', `no such method: ${method}`, { method });
      }
      throw e;
    }

    // `capabilities` is a plain object supplied by the host, so a method name
    // like "constructor" or "__proto__" would otherwise resolve to something
    // from Object.prototype and be called.
    if (!Object.prototype.hasOwnProperty.call(capabilities, method)) {
      throw new DispatchError('unknown-method', `no such method: ${method}`, { method });
    }
    const fn = capabilities[method];
    if (typeof fn !== 'function') {
      throw new DispatchError('unknown-method', `no such method: ${method}`, { method });
    }

    try {
      return await fn(args, { extId, permissions });
    } catch (e) {
      // A capability that throws is an error in the app, not a protocol
      // failure. It is reported as a plain rejection the extension can catch,
      // with the message preserved and nothing else — a stack would leak host
      // paths into a sandbox that is not supposed to know them.
      throw new DispatchError('capability-failed', String(e?.message ?? e), { method });
    }
  }

  dispatch.dispose = () => { disposed = true; };
  dispatch.isDisposed = () => disposed;
  return dispatch;
}

/**
 * The always-available capabilities (§2.2), which need no grant.
 *
 * Kept here rather than in the permission module because these are behaviour,
 * and that one is policy. `handlers` supplies the parts only the app can do.
 */
export function freeCapabilities({ extId, storage, ui, app }) {
  const str = (v) => String(v ?? '');
  return {
    'app.version': async () => app.version(),
    'app.platform': async () => app.platform(),
    'app.locale': async () => app.locale(),

    'ui.toast': async ([message, opts]) => ui.toast(str(message), opts ?? {}),
    'ui.navigate': async ([pageId, session]) => ui.navigate(extId, str(pageId), session ?? null),
    'ui.prompt': async ([opts]) => ui.prompt(extId, opts ?? {}),
    'ui.confirm': async ([opts]) => ui.confirm(extId, opts ?? {}),
    'ui.overlay.set': async ([text]) => ui.overlaySet(extId, str(text)),
    'ui.overlay.clear': async () => ui.overlayClear(extId),

    'storage.get': async ([key]) => storage.get(str(key)),
    'storage.set': async ([key, value]) => storage.set(str(key), value),
    'storage.remove': async ([key]) => storage.remove(str(key)),
    'storage.keys': async () => storage.keys(),
    'storage.getJSON': async ([key, fallback]) => {
      // The parse everyone rewrites, with the swallow-the-error bug removed:
      // a corrupt value returns the fallback rather than undefined, so a
      // caller cannot tell "absent" from "broken" and then write over it.
      const raw = await storage.get(str(key));
      if (raw === null || raw === undefined) return fallback ?? null;
      try { return JSON.parse(raw); } catch { return fallback ?? null; }
    },
    'storage.setJSON': async ([key, value]) => storage.set(str(key), JSON.stringify(value ?? null)),
  };
}

/**
 * The `activity` capabilities (§2.2a).
 *
 * Subscription is host-side: the extension registers interest and the host
 * pushes, so an extension cannot poll the meter faster than the meter ticks and
 * reconstruct finer timing than the bucketing allows.
 */
export function activityCapabilities({ meter, push }) {
  let off = null;
  const caps = {
    'activity.getRate': async () => meter.getRate(),
    'activity.onWriting': async ([enabled]) => {
      const want = enabled !== false;
      if (want && !off) off = meter.subscribe((event) => push(event));
      if (!want && off) { off(); off = null; }
      return want;
    },
  };
  caps.__unsubscribe = () => { if (off) { off(); off = null; } };
  return caps;
}
