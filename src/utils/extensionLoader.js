/**
 * extensionLoader.js — fixed
 *
 * Key fix: Capacitor 3 readdir returns string[], Capacitor 4+ returns FileInfo[].
 * Old code did `files.filter(f => f.type === 'directory')` which always produced
 * an empty array on Capacitor 3, so no extensions were ever loaded.
 * Now we normalise each entry to its name string and attempt loadManifest() on
 * every entry — non-manifest entries (or plain files) return null and are skipped.
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
      directory: Directory.Data,
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

  // ── Android ───────────────────────────────────────────────────────────────
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');

    try {
      await Filesystem.mkdir({
        path: EXTENSIONS_DIR,
        directory: Directory.Data,
        recursive: true,
      });
    } catch (_) {}

    let files;
    try {
      const result = await Filesystem.readdir({
        path: EXTENSIONS_DIR,
        directory: Directory.Data,
      });
      files = result.files ?? [];
    } catch {
      return [];
    }

    // FIX: Capacitor 3 → string[], Capacitor 4+ → FileInfo[]
    // Don't filter by .type (unreliable across versions).
    // Just attempt to load manifest.json from every entry name.
    const names = files
      .map(f => (typeof f === 'string' ? f : (f.name ?? '')))
      .filter(n => n.length > 0 && !n.startsWith('.'));

    const manifests = await Promise.all(names.map(name => loadManifest(name)));
    return manifests.filter(Boolean);
  } catch (e) {
    logError('extensionLoader:discoverExtensions', e);
    return [];
  }
}

// ─── Per-extension config ─────────────────────────────────────────────────────

const cfgKey = (id) => `__authno_ext_cfg_${id}`;

export function getExtensionConfig(extId) {
  try { return JSON.parse(localStorage.getItem(cfgKey(extId))) ?? {}; }
  catch { return {}; }
}

export function setExtensionConfig(extId, patch) {
  try {
    const prev = getExtensionConfig(extId);
    localStorage.setItem(cfgKey(extId), JSON.stringify({ ...prev, ...patch }));
  } catch {}
}

export function clearExtensionConfig(extId) {
  try { localStorage.removeItem(cfgKey(extId)); } catch {}
}

// ─── API call helper ──────────────────────────────────────────────────────────

export async function callExtensionApi(manifest, endpoint, method = 'GET', bodyTemplate = null, templateVars = {}) {
  const api = manifest.api;
  if (!api?.baseUrl) throw new Error(`Extension "${manifest.id}" has no api.baseUrl`);

  const config = getExtensionConfig(manifest.id);
  const sub = (str) => str.replace(/\{(\w+)\}/g, (_, k) => templateVars[k] ?? config[k] ?? '');

  const url = `${api.baseUrl.replace(/\/$/, '')}${sub(endpoint)}`;
  const headers = { 'Content-Type': 'application/json' };
  if (api.authHeader && api.authField) {
    const token = config[api.authField];
    if (token) headers[api.authHeader] = `${api.authPrefix ?? ''} ${token}`.trim();
  }

  let body;
  if (bodyTemplate && ['POST','PUT','PATCH'].includes(method)) {
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
