/**
 * hostV2.js — the host half, for a v2 extension.
 *
 * Everything the extension is allowed to ask for, answered in one place, with
 * the permission gate in front of it. Two reasons it lives on the server
 * rather than in the harness page:
 *
 *   - An author can read it. "What does library.list actually return in the
 *     sandbox?" should be answerable by opening one file, not by reading a
 *     string that is assembled into a <script> tag.
 *   - The permission decisions and the call log are state the UI wants, and
 *     the UI is served from here.
 *
 * The method names are the app's, not invented: they are the ones
 * `sandboxProtocol.js` dispatches and `extensionRuntime.js` answers. A name
 * that is wrong here is wrong on a phone too, which is the point.
 */

// The app's own permission model, vendored and checked by `npm run
// check:vendored`. Writing a second copy of "which method needs what" is how
// a sandbox comes to allow something a phone refuses.
import { permissionForMethod, FREE_METHODS, PERMISSIONS } from './extensionPermissionsV2.js';

export class SandboxHost {
  constructor({ library, storage = new Map(), config = {} }) {
    this.library = library;
    this.storage = storage;
    this.config = config;
    /** permission name → granted? Everything the manifest asks for, on by default. */
    this.grants = new Map();
    /** Every call, newest last, for the request log. */
    this.calls = [];
    this.maxCalls = 400;
  }

  /** Start from the manifest: every declared permission granted. */
  seedGrants(manifest) {
    this.grants.clear();
    for (const name of Object.keys(manifest?.permissions ?? {})) this.grants.set(name, true);
  }

  setGrant(name, on) { this.grants.set(name, !!on); }

  /**
   * Is this method allowed right now?
   *
   * Mirrors the app: a method maps to at most one permission, a handful are
   * free, and anything unmapped is refused rather than waved through — an
   * unknown method is a typo or a capability nobody has reviewed.
   */
  check(method) {
    if (FREE_METHODS.has(method)) return null;
    const needed = permissionForMethod(method);
    if (!needed) return `Unknown method: ${method}`;
    if (this.grants.get(needed) === false) {
      return `Permission denied: ${method} needs "${needed}", which is switched off in the sandbox`;
    }
    return null;
  }

  /** Every permission the app knows about, for the toggles. */
  static allPermissions() { return Object.keys(PERMISSIONS); }

  record(entry) {
    this.calls.push({ ...entry, at: Date.now() });
    if (this.calls.length > this.maxCalls) this.calls.shift();
  }

  async dispatch(method, args = []) {
    const denied = this.check(method);
    if (denied) {
      this.record({ method, args, outcome: 'denied', detail: denied });
      throw new Error(denied);
    }
    try {
      const result = await this._run(method, args);
      this.record({ method, args, outcome: 'ok' });
      return result;
    } catch (e) {
      this.record({ method, args, outcome: 'error', detail: e?.message ?? String(e) });
      throw e;
    }
  }

  async _run(method, args) {
    const S = this.storage;
    switch (method) {
      // ── Storage ────────────────────────────────────────────────────────────
      case 'storage.get':     return S.has(args[0]) ? S.get(args[0]) : null;
      case 'storage.set':
        if (args[1] === null || args[1] === undefined) S.delete(args[0]);
        else S.set(args[0], String(args[1]));
        return null;
      case 'storage.remove':  S.delete(args[0]); return null;
      case 'storage.keys':    return [...S.keys()];
      case 'storage.getJSON': {
        if (!S.has(args[0])) return args[1] ?? null;
        try { return JSON.parse(S.get(args[0])); } catch { return args[1] ?? null; }
      }
      case 'storage.setJSON': S.set(args[0], JSON.stringify(args[1] ?? null)); return null;

      // ── Library ────────────────────────────────────────────────────────────
      case 'library.list':    return this.library.map(slim);
      case 'library.getAny':  return this.library.find((b) => b.id === args[0]) ?? null;
      case 'library.get':     return this.library.find((b) => b.id === args[0]) ?? null;
      case 'library.export': {
        const book = this.library.find((b) => b.id === args[0]);
        if (!book) throw new Error(`No book ${args[0]}`);
        const text = (book.chapters ?? []).map((c) => `${c.title}\n\n${c.content}`).join('\n\n');
        return {
          filename: `${book.title}.${args[1] ?? 'authbook'}`,
          base64: Buffer.from(text, 'utf8').toString('base64'),
          mimeType: 'application/octet-stream',
        };
      }
      case 'library.update':
      case 'library.create': {
        // Upsert, like the app: a matching id replaces rather than duplicates.
        const incoming = decodeBook(args[0]);
        const idx = this.library.findIndex((b) => b.id === incoming.id);
        if (idx >= 0) this.library[idx] = { ...this.library[idx], ...incoming };
        else this.library.push(incoming);
        return { id: incoming.id, created: idx < 0 };
      }

      // ── UI ─────────────────────────────────────────────────────────────────
      case 'ui.toast':        return null;   // surfaced through the call log
      case 'ui.navigate':     return null;
      case 'ui.confirm':      return true;   // always yes here; the log shows what was asked
      case 'ui.prompt':       return args[1]?.default ?? '';
      case 'ui.overlay.set':
      case 'ui.overlay.clear': return null;

      // ── Network ────────────────────────────────────────────────────────────
      //
      // Deliberately not proxied. A dev server that quietly makes real requests
      // on an author's behalf is a surprise, and the interesting failures here
      // are the ones where a host is NOT granted. Switch the permission off to
      // see what the extension does when refused.
      case 'network.requestHost':
        // Granting a typed-in host is a decision, so the sandbox makes it
        // visibly: it says yes and logs it, rather than silently widening.
        return { ok: true, host: String(args[0] ?? '') };

      case 'browser.open':
        return null;

      case 'auth.oauth':
      case 'auth.googleSignIn':
      case 'auth.requestDriveToken':
        throw new Error(`${method} needs a real browser round trip, which the sandbox cannot complete`);
      case 'auth.signOut':
        return null;

      case 'activity.getRate':   return 0;
      case 'activity.onWriting': return null;
      case 'notify.post':        return null;

      // ── App ────────────────────────────────────────────────────────────────
      case 'app.version':  return 'sandbox';
      case 'app.platform': return 'sandbox';
      case 'app.locale':   return 'en';

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}

/** The shape library.list returns — metadata, never chapter text. */
function slim(b) {
  return {
    id: b.id,
    title: b.title,
    updated: b.updated,
    chapterCount: (b.chapters ?? []).length,
    wordCount: b.wordCount ?? 0,
  };
}

function decodeBook(payload) {
  const data = typeof payload === 'string' ? payload : payload?.data;
  let text = '';
  try { text = Buffer.from(String(data ?? ''), 'base64').toString('utf8'); } catch { /* not base64 */ }
  return {
    id: `imported-${Date.now()}`,
    title: text.split('\n')[0]?.slice(0, 60) || 'Imported book',
    updated: new Date().toISOString(),
    chapters: [{ id: 'c1', title: 'Chapter 1', content: text }],
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}
