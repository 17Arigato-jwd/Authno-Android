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

// ── Config-at-rest obfuscation (N6) ───────────────────────────────────────────
// Extension configs can contain API tokens. They were stored as plaintext JSON
// in localStorage while the docs claimed "securely" — misleading. Values are
// now XOR-obfuscated with a per-install key before storage. IMPORTANT: this is
// OBFUSCATION, not encryption — it stops shoulder-surfing and casual log/dump
// exposure, but code running inside the app can still recover values. True
// at-rest security needs the Android Keystore (tracked for a native plugin).
// Reads fall back to plaintext JSON so pre-existing configs keep working.
function _obfKey() {
  try {
    let k = localStorage.getItem('__authno_cfg_k');
    if (!k) {
      const buf = new Uint8Array(16);
      if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(buf);
      else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
      k = btoa(String.fromCharCode(...buf));
      localStorage.setItem('__authno_cfg_k', k);
    }
    return Uint8Array.from(atob(k), c => c.charCodeAt(0));
  } catch { return new Uint8Array([7]); }
}
function _obf(str) {
  const key = _obfKey();
  const data = new TextEncoder().encode(str);
  for (let i = 0; i < data.length; i++) data[i] ^= key[i % key.length];
  let bin = ''; for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  return 'obf1:' + btoa(bin);
}
function _deobf(raw) {
  if (!raw || !raw.startsWith('obf1:')) return null;
  try {
    const key = _obfKey();
    const data = Uint8Array.from(atob(raw.slice(5)), c => c.charCodeAt(0));
    for (let i = 0; i < data.length; i++) data[i] ^= key[i % key.length];
    return new TextDecoder().decode(data);
  } catch { return null; }
}

export function getExtensionConfig(extId) {
  try {
    const raw = localStorage.getItem(cfgKey(extId));
    if (!raw) return {};
    const plain = _deobf(raw) ?? raw;   // legacy plaintext fallback
    return JSON.parse(plain) || {};
  } catch { return {}; }
}

export function setExtensionConfig(extId, patch) {
  try {
    const prev = getExtensionConfig(extId);
    localStorage.setItem(cfgKey(extId), _obf(JSON.stringify({ ...prev, ...patch })));
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

  // A7: auth/secret-typed config fields must NEVER be interpolated into the
  // URL — a hostile or careless manifest could otherwise leak a stored token
  // into query strings, server logs, or another extension's endpoint. Secrets
  // travel only via the configured auth header. Body templates may still use
  // non-secret config + session vars.
  const secretKeys = new Set([api.authField].filter(Boolean));
  for (const field of manifest.contributes?.pages
    ? Object.values(manifest.contributes.pages).flatMap(p => p.fields ?? []) : []) {
    if (field?.type === 'password' && field.key) secretKeys.add(field.key);
  }

  const subUrl  = (str) => str.replace(/\{(\w+)\}/g, (_, k) =>
    secretKeys.has(k) ? '' : (templateVars[k] ?? config[k] ?? ''));
  const subBody = (str) => str.replace(/\{(\w+)\}/g, (_, k) => templateVars[k] ?? config[k] ?? '');

  const url = `${api.baseUrl.replace(/\/$/, '')}${subUrl(endpoint)}`;
  const headers = { 'Content-Type': 'application/json' };
  if (api.authHeader && api.authField) {
    const token = config[api.authField];
    if (token) headers[api.authHeader] = `${api.authPrefix ?? ''} ${token}`.trim();
  }

  let body;
  if (bodyTemplate && ['POST','PUT','PATCH'].includes(method)) {
    const resolved = {};
    for (const [k, v] of Object.entries(bodyTemplate)) {
      resolved[k] = typeof v === 'string' ? subBody(v) : v;
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
