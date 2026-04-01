/**
 * extensionLoader.js
 *
 * Discovers, loads, and validates Authno extensions.
 *
 * On Android:
 *   Extensions live at {ExternalStorage}/AuthNo/extensions/{id}/manifest.json
 *   Authno scans this directory on startup via @capacitor/filesystem.
 *
 * On web / Electron (dev):
 *   Falls back to localStorage key `__authno_dev_extensions` so you can
 *   paste a test manifest array during development without a real device.
 *
 * ─── Extension manifest shape ────────────────────────────────────────────────
 *
 * {
 *   "id":          "com.example.inkstone",      // required, reverse-domain
 *   "name":        "Inkstone",                  // required, display name
 *   "version":     "1.0.0",                     // required
 *   "description": "Publish to Webnovel",       // optional
 *   "icon":        "🔖",                        // emoji OR relative path to icon.png
 *   "permissions": ["network", "book:read"],    // optional
 *
 *   "auth": {                                   // optional — if extension needs credentials
 *     "type": "apikey" | "oauth2" | "basic",
 *     "fields": [
 *       { "key": "apiKey", "label": "API Key", "type": "password", "hint": "..." },
 *       { "key": "username", "label": "Username", "type": "text" }
 *     ]
 *   },
 *
 *   "contributes": {
 *     "homescreen": [                           // action tiles in HomeScreen "What to do?" card
 *       { "id": "dashboard", "label": "Inkstone", "icon": "📊", "page": "dashboard" }
 *     ],
 *
 *     "bookDashboard": {
 *       "tabs": [                               // new tabs in the BookDashboard tab bar
 *         { "id": "stats", "label": "Stats", "icon": "📈", "page": "novel-stats" }
 *       ],
 *       "actions": [                            // extra action buttons on BookDashboard
 *         { "id": "publish", "label": "Publish Chapter", "icon": "🚀", "page": "publish" }
 *       ]
 *     },
 *
 *     "settings": [                             // nav items added to the Settings sidebar
 *       { "id": "config", "label": "Inkstone Account", "icon": "🔑", "page": "auth" }
 *     ],
 *
 *     "pages": {                               // full-screen pages the extension can open
 *       "dashboard": {
 *         "title": "Inkstone Dashboard",
 *         "type": "webview",                   // "webview" | "api-data" | "api-action" | "auth-form"
 *         "url": "https://inkstone.webnovel.com"
 *       },
 *       "novel-stats": {
 *         "title": "Novel Stats",
 *         "type": "api-data",
 *         "endpoint": "/v1/novel/{externalId}/stats",
 *         "display": "stats-grid"              // how to render the JSON result
 *       },
 *       "publish": {
 *         "title": "Publish Chapter",
 *         "type": "api-action",
 *         "endpoint": "/v1/chapter/publish",
 *         "method": "POST",
 *         "bodyTemplate": {
 *           "novelId": "{externalId}",
 *           "chapterTitle": "{chapterTitle}",
 *           "content": "{chapterContent}"
 *         },
 *         "successMessage": "Chapter published!"
 *       },
 *       "auth": {
 *         "title": "Inkstone Account",
 *         "type": "auth-form"                  // renders manifest.auth.fields
 *       }
 *     }
 *   },
 *
 *   "api": {                                   // optional — shared API config used by all pages
 *     "baseUrl": "https://api.inkstone.webnovel.com",
 *     "authHeader": "Authorization",
 *     "authPrefix": "Bearer",
 *     "authField": "apiKey"                    // which auth.fields key is the token
 *   }
 * }
 */

import { isAndroid } from './platform';
import { logError } from './ErrorLogger';

const EXTENSIONS_DIR = 'AuthNo/extensions';

// ─── Validation ───────────────────────────────────────────────────────────────

function validateManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Manifest must be a JSON object');
  if (!raw.id      || typeof raw.id      !== 'string') throw new Error('manifest.id is required');
  if (!raw.name    || typeof raw.name    !== 'string') throw new Error('manifest.name is required');
  if (!raw.version || typeof raw.version !== 'string') throw new Error('manifest.version is required');
  if (!/^[\w.-]+$/.test(raw.id)) throw new Error('manifest.id must be alphanumeric, dots, or dashes');
  return true;
}

// ─── Single-extension loader ──────────────────────────────────────────────────

async function loadManifest(dirName) {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const result = await Filesystem.readFile({
      path: `${EXTENSIONS_DIR}/${dirName}/manifest.json`,
      directory: Directory.ExternalStorage,
      encoding: 'utf8',
    });
    const raw = JSON.parse(result.data);
    validateManifest(raw);
    return { ...raw, _dirName: dirName };
  } catch (e) {
    logError('extensionLoader:loadManifest', e, { dirName });
    return null;
  }
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * Scan the extensions directory and return all valid manifests.
 * Always resolves (never throws) — bad manifests are silently skipped.
 */
export async function discoverExtensions() {
  // ── Dev / web / Electron fallback ────────────────────────────────────────
  if (!isAndroid()) {
    try {
      const raw = localStorage.getItem('__authno_dev_extensions');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(m => {
        try { validateManifest(m); return true; } catch { return false; }
      }) : [];
    } catch {
      return [];
    }
  }

  // ── Android: scan ExternalStorage/AuthNo/extensions/ ─────────────────────
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');

    // Ensure the directory exists (no-op if already present)
    try {
      await Filesystem.mkdir({
        path: EXTENSIONS_DIR,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
    } catch (_) {}

    let files;
    try {
      const result = await Filesystem.readdir({
        path: EXTENSIONS_DIR,
        directory: Directory.ExternalStorage,
      });
      files = result.files ?? [];
    } catch {
      return []; // directory empty or unreadable
    }

    const dirs = files.filter(f => f.type === 'directory');
    const manifests = await Promise.all(dirs.map(f => loadManifest(f.name)));
    return manifests.filter(Boolean);
  } catch (e) {
    logError('extensionLoader:discoverExtensions', e);
    return [];
  }
}

// ─── Per-extension config (auth credentials, settings) ───────────────────────

const cfgKey = (id) => `__authno_ext_cfg_${id}`;

/** Read the stored config object for an extension (API keys, tokens, etc.) */
export function getExtensionConfig(extId) {
  try {
    return JSON.parse(localStorage.getItem(cfgKey(extId))) ?? {};
  } catch {
    return {};
  }
}

/** Merge-write config fields for an extension */
export function setExtensionConfig(extId, patch) {
  try {
    const prev = getExtensionConfig(extId);
    localStorage.setItem(cfgKey(extId), JSON.stringify({ ...prev, ...patch }));
  } catch {}
}

/** Wipe the stored config for an extension (e.g. sign-out) */
export function clearExtensionConfig(extId) {
  try { localStorage.removeItem(cfgKey(extId)); } catch {}
}

// ─── API call helper ──────────────────────────────────────────────────────────

/**
 * Perform a generic API call described by the extension manifest's "api" block.
 *
 * templateVars: { externalId, chapterTitle, chapterContent, bookId, ... }
 * Returns the parsed JSON body or throws on network / HTTP error.
 */
export async function callExtensionApi(manifest, endpoint, method = 'GET', bodyTemplate = null, templateVars = {}) {
  const api = manifest.api;
  if (!api?.baseUrl) throw new Error(`Extension "${manifest.id}" has no api.baseUrl`);

  const config = getExtensionConfig(manifest.id);

  // Substitute {variable} tokens in a string
  const sub = (str) => str.replace(/\{(\w+)\}/g, (_, k) =>
    templateVars[k] ?? config[k] ?? ''
  );

  // Build URL
  const url = `${api.baseUrl.replace(/\/$/, '')}${sub(endpoint)}`;

  // Build headers
  const headers = { 'Content-Type': 'application/json' };
  if (api.authHeader && api.authField) {
    const token = config[api.authField];
    if (token) headers[api.authHeader] = `${api.authPrefix ?? ''} ${token}`.trim();
  }

  // Build body
  let body;
  if (bodyTemplate && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    const resolved = {};
    for (const [k, v] of Object.entries(bodyTemplate)) {
      resolved[k] = typeof v === 'string' ? sub(v) : v;
    }
    body = JSON.stringify(resolved);
  }

  const res = await fetch(url, { method, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json().catch(() => ({}));
}
