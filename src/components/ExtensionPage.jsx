/**
 * ExtensionPage.jsx
 *
 * Full-screen page rendered when the user navigates to an extension page.
 * Controlled by App.js (view === 'extension-page').
 *
 * Supports four page types declared in manifest.contributes.pages:
 *
 *   webview     — renders the page URL in an <iframe>.  On Android the same
 *                 https: scheme used by the Capacitor WebView means most
 *                 external pages load fine.  A fallback "Open in browser"
 *                 button appears if loading fails.
 *
 *   api-data    — calls the extension API, renders the returned JSON as a
 *                 card grid (key/value pairs or a flat list of objects).
 *
 *   api-action  — shows a pre-filled form whose fields come from the page's
 *                 bodyTemplate + the current session context, then POSTs.
 *
 *   auth-form   — shows the extension's auth.fields so the user can enter
 *                 API keys / tokens.  Saves to extensionLoader config store.
 *
 * Props:
 *   extension   object   the manifest object for this extension
 *   pageId      string   key in manifest.contributes.pages
 *   session     object   current book session (may be null)
 *   accentHex   string   theme accent colour
 *   onBack      fn       navigate back (called after a successful action too)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, RefreshCw, ExternalLink, Check, AlertTriangle, Loader } from 'lucide-react';
import { useExtensions } from '../utils/ExtensionContext';
import { callExtensionApi } from '../utils/extensionLoader';
import { isAndroid } from '../utils/platform';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a templateVars object from the current session */
function sessionVars(session) {
  if (!session) return {};
  return {
    bookId:        session.id ?? '',
    bookTitle:     session.title ?? '',
    externalId:    session.externalId ?? '',
    chapterTitle:  session._editingChap?.title ?? '',
    chapterContent: session._editingChap?.content ?? '',
  };
}

/** Substitute {variable} tokens in a string */
function sub(str, vars) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageHeader({ title, onBack, accentHex, action }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px',
      background: 'var(--app-bg)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <button
          onClick={onBack}
          style={{
            padding: '6px', background: 'none', border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: '6px', cursor: 'pointer', color: 'var(--text-1)',
            display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span style={{
          color: 'var(--text-1)', fontWeight: 600, fontSize: '16px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
      </div>
      {action}
    </header>
  );
}

function StatusBox({ icon, title, subtitle, accentHex }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px', gap: '12px', textAlign: 'center',
    }}>
      <div style={{ fontSize: '36px', lineHeight: 1 }}>{icon}</div>
      <div style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: '16px' }}>{title}</div>
      {subtitle && <div style={{ color: 'var(--text-4)', fontSize: '13px', maxWidth: '280px' }}>{subtitle}</div>}
    </div>
  );
}

// ─── Page type: auth-form ─────────────────────────────────────────────────────

function AuthFormPage({ extension, accentHex, onBack }) {
  const { getConfig, setConfig, clearConfig } = useExtensions();
  const fields = extension.auth?.fields ?? [];
  const [values, setValues] = useState(() => {
    const stored = getConfig(extension.id);
    const init = {};
    fields.forEach(f => { init[f.key] = stored[f.key] ?? ''; });
    return init;
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setConfig(extension.id, values);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    clearConfig(extension.id);
    const empty = {};
    fields.forEach(f => { empty[f.key] = ''; });
    setValues(empty);
  };

  if (fields.length === 0) {
    return <StatusBox icon="ℹ️" title="No configuration needed" subtitle="This extension does not require any credentials." accentHex={accentHex} />;
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: '18px', marginBottom: '4px' }}>
          {extension.name} Account
        </div>
        <div style={{ color: 'var(--text-4)', fontSize: '13px' }}>
          {extension.description ?? 'Configure your credentials to enable this extension.'}
        </div>
      </div>

      {fields.map(f => (
        <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ color: 'var(--text-3)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            {f.label}
          </label>
          <input
            type={f.type === 'password' ? 'password' : 'text'}
            placeholder={f.hint ?? ''}
            value={values[f.key] ?? ''}
            onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px', color: 'var(--text-1)', fontSize: '14px',
              outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = accentHex}
            onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
          />
          {f.hint && (
            <div style={{ color: 'var(--text-4)', fontSize: '11px' }}>{f.hint}</div>
          )}
        </div>
      ))}

      {/* Save / Clear buttons */}
      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        <button
          onClick={handleSave}
          style={{
            flex: 1, padding: '11px', borderRadius: '8px',
            background: saved ? '#22c55e' : accentHex,
            color: '#fff', fontWeight: 700, fontSize: '14px',
            border: 'none', cursor: 'pointer',
            transition: 'background 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}
        >
          {saved ? <><Check size={16} /> Saved!</> : 'Save credentials'}
        </button>
        <button
          onClick={handleClear}
          style={{
            padding: '11px 16px', borderRadius: '8px',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
            color: 'var(--text-3)', fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

// ─── Page type: webview ───────────────────────────────────────────────────────

function WebviewPage({ url, accentHex }) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  if (!url) {
    return <StatusBox icon="⚠️" title="No URL configured" subtitle="This page does not have a URL specified in the manifest." accentHex={accentHex} />;
  }

  const openExternal = () => {
    try { window.open(url, '_blank', 'noopener'); } catch {}
  };

  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {loading && !failed && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: '12px', color: 'var(--text-4)',
          zIndex: 2, background: 'var(--app-bg)',
        }}>
          <Loader size={28} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: '13px' }}>Loading…</span>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {failed ? (
        <StatusBox
          icon="🌐"
          title="Could not load page"
          subtitle={`The extension page at ${url} could not be displayed inside the app.`}
          accentHex={accentHex}
        />
      ) : (
        <iframe
          src={url}
          title="Extension page"
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setFailed(true); }}
          style={{
            flex: 1, width: '100%', border: 'none',
            background: '#fff',
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}

      {/* Always show open-externally button */}
      <div style={{
        padding: '8px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'flex-end',
        background: 'var(--app-bg)', flexShrink: 0,
      }}>
        <button
          onClick={openExternal}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'transparent', border: 'none',
            color: accentHex, fontSize: '12px', cursor: 'pointer',
          }}
        >
          <ExternalLink size={13} /> Open in browser
        </button>
      </div>
    </div>
  );
}

// ─── Page type: api-data ──────────────────────────────────────────────────────

function ApiDataPage({ extension, page, session, accentHex }) {
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const vars = { ...sessionVars(session), ...({ /* book-level stored vars */ }) };
      const result = await callExtensionApi(extension, page.endpoint, page.method ?? 'GET', null, vars);
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [extension, page, session]);

  useEffect(() => {
    load();

    const handler = () => load();
    window.addEventListener('extension-api-refresh', handler);

    return () => window.removeEventListener('extension-api-refresh', handler);
  }, [load]);

  if (loading) return <StatusBox icon={<Loader size={28} style={{ animation: 'spin 1s linear infinite' }} />} title="Loading data…" accentHex={accentHex} />;
  if (error)   return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <StatusBox icon="⚠️" title="Could not load data" subtitle={error} accentHex={accentHex} />
      <div style={{ padding: '0 24px 24px', display: 'flex', justifyContent: 'center' }}>
        <button onClick={load} style={{ padding: '8px 20px', borderRadius: '8px', background: accentHex, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
          Retry
        </button>
      </div>
    </div>
  );

  // Generic renderer: if data is an object, render key/value cards
  const entries = Object.entries(data ?? {});

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Refresh button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: '12px', cursor: 'pointer' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {entries.length === 0 ? (
        <StatusBox icon="📭" title="No data returned" subtitle="The API returned an empty response." accentHex={accentHex} />
      ) : entries.map(([key, val]) => (
        <div key={key} style={{
          padding: '14px 16px', borderRadius: '12px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ color: 'var(--text-3)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '4px' }}>
            {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
          </div>
          <div style={{ color: 'var(--text-1)', fontSize: '20px', fontWeight: 700 }}>
            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page type: api-action ────────────────────────────────────────────────────

function ApiActionPage({ extension, page, session, accentHex, onBack }) {
  const vars    = sessionVars(session);
  const { getConfig } = useExtensions();
  const config  = getConfig(extension.id);
  const allVars = { ...vars, ...config };

  // Pre-fill form fields from the bodyTemplate
  const [fields, setFields] = useState(() => {
    const init = {};
    if (page.bodyTemplate) {
      Object.entries(page.bodyTemplate).forEach(([k, v]) => {
        init[k] = typeof v === 'string' ? sub(v, allVars) : String(v);
      });
    }
    return init;
  });

  const [status,  setStatus]  = useState('idle'); // idle | loading | success | error
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    setStatus('loading');
    try {
      await callExtensionApi(extension, page.endpoint, page.method ?? 'POST', page.bodyTemplate, allVars);
      setStatus('success');
      setMessage(page.successMessage ?? 'Done!');
      setTimeout(() => { setStatus('idle'); onBack?.(); }, 1800);
    } catch (e) {
      setStatus('error');
      setMessage(e.message);
    }
  };

  if (status === 'success') return <StatusBox icon="✅" title={message} accentHex={accentHex} />;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: '18px' }}>{page.title}</div>

      {Object.entries(fields).map(([key, val]) => (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ color: 'var(--text-3)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
          </label>
          <textarea
            value={val}
            onChange={e => setFields(p => ({ ...p, [key]: e.target.value }))}
            rows={key.toLowerCase().includes('content') ? 8 : 2}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px', resize: 'vertical',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px', color: 'var(--text-1)', fontSize: '13px',
              outline: 'none', fontFamily: 'inherit',
            }}
            onFocus={e => e.target.style.borderColor = accentHex}
            onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
          />
        </div>
      ))}

      {status === 'error' && (
        <div style={{
          padding: '10px 12px', borderRadius: '8px',
          background: '#dc262622', border: '1px solid #dc262644',
          color: '#fca5a5', fontSize: '13px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <AlertTriangle size={14} /> {message}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={status === 'loading'}
        style={{
          padding: '12px', borderRadius: '8px',
          background: status === 'loading' ? accentHex + '88' : accentHex,
          color: '#fff', fontWeight: 700, fontSize: '14px',
          border: 'none', cursor: status === 'loading' ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        }}
      >
        {status === 'loading'
          ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</>
          : page.submitLabel ?? 'Submit'}
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </button>
    </div>
  );
}

// ─── Page type: ui-file ───────────────────────────────────────────────────────
//
// Renders an extension's JS UI file inside a sandboxed iframe.
// The iframe gets a synchronous window.CloudBackupAPI shim that routes every
// call back to the parent via postMessage, so Settings.js never needs to poll
// or wait — the API is available the moment the page runs.
//
// PostMessage protocol (iframe → parent):
//   { source: 'CloudBackupAPI', callId, method, args }
// Parent response (parent → iframe):
//   { source: 'CloudBackupAPIResponse', callId, result?, error? }
//
// Supported methods:
//   storage.get(key)          → value string | null
//   storage.set(key, val)     → void
//   storage.remove(key)       → void
//   getStatus()               → { activeProvider, tileStatus, queueEntries }
//   connectProvider(key, cfg) → void   (WebDAV: stores creds; OAuth: triggers flow)
//   disconnectProvider()      → void

const EXT_STORAGE_PREFIX = (extId) => `__extstore_${extId}_`;

function buildSrcdoc(scriptContent, accentHex) {
  const shimJs = `
(function () {
  'use strict';
  let _seq = 0;
  const _pending = {};

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.source !== 'CloudBackupAPIResponse') return;
    var p = _pending[e.data.callId];
    if (!p) return;
    delete _pending[e.data.callId];
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result);
  });

  function rpc(method, args) {
    return new Promise(function (resolve, reject) {
      var id = String(++_seq);
      _pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ source: 'CloudBackupAPI', callId: id, method: method, args: args || [] }, '*');
    });
  }

  window.CloudBackupAPI = {
    getStatus: function () { return rpc('getStatus', []); },
    connectProvider: function (key, cfg) { return rpc('connectProvider', [key, cfg]); },
    disconnectProvider: function () { return rpc('disconnectProvider', []); },
    storage: {
      get:    function (k)    { return rpc('storage.get',    [k]); },
      set:    function (k, v) { return rpc('storage.set',    [k, v]); },
      remove: function (k)    { return rpc('storage.remove', [k]); },
    },
  };
})();
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <style>
    :root { --accent: ${accentHex ?? '#6366f1'}; }
    html, body { margin: 0; padding: 0; background: transparent; height: 100%; }
  </style>
  <script>${shimJs}<\/script>
</head>
<body>
<script>
${scriptContent}
<\/script>
</body>
</html>`;
}

function UiFilePage({ extension, pageDef, accentHex }) {
  const iframeRef = useRef(null);
  const [srcdoc, setSrcdoc] = useState(null);
  const [loadErr, setLoadErr] = useState(null);

  // ── Load the extension's JS file from the Capacitor filesystem ────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const filePath = `AuthNo/extensions/${extension.id}/${pageDef.file}`;
        const result = await Filesystem.readFile({
          path: filePath,
          directory: Directory.Data,
          encoding: 'utf8',
        });
        if (!cancelled) setSrcdoc(buildSrcdoc(result.data, accentHex));
      } catch (e) {
        if (!cancelled) setLoadErr(e.message);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [extension.id, pageDef.file, accentHex]);

  // ── Handle postMessage API calls from the iframe ───────────────────────────
  useEffect(() => {
    const PREFIX = EXT_STORAGE_PREFIX(extension.id);

    async function handleMessage(event) {
      if (event.data?.source !== 'CloudBackupAPI') return;
      const { callId, method, args } = event.data;

      const reply = (result, error) => {
        iframeRef.current?.contentWindow?.postMessage({
          source: 'CloudBackupAPIResponse',
          callId,
          result:  result  ?? null,
          error:   error   ? String(error) : undefined,
        }, '*');
      };

      try {
        // ── Storage primitives ──────────────────────────────────────────────
        if (method === 'storage.get') {
          const val = localStorage.getItem(PREFIX + args[0]);
          return reply(val);
        }
        if (method === 'storage.set') {
          if (args[1] == null) localStorage.removeItem(PREFIX + args[0]);
          else localStorage.setItem(PREFIX + args[0], String(args[1]));
          return reply(null);
        }
        if (method === 'storage.remove') {
          localStorage.removeItem(PREFIX + args[0]);
          return reply(null);
        }

        // ── getStatus ───────────────────────────────────────────────────────
        if (method === 'getStatus') {
          const activeProvider = localStorage.getItem(PREFIX + 'activeProvider') || null;
          const tileStatus     = localStorage.getItem(PREFIX + 'tileStatus')     || 'synced';
          const rawQueue       = localStorage.getItem(PREFIX + 'queue');
          const queueEntries   = rawQueue ? JSON.parse(rawQueue) : [];
          return reply({ activeProvider, tileStatus, queueEntries });
        }

        // ── connectProvider ─────────────────────────────────────────────────
        if (method === 'connectProvider') {
          const [providerKey, config] = args;

          // WebDAV: just store the config — no OAuth needed
          if (providerKey === 'webdav') {
            localStorage.setItem(PREFIX + 'activeProvider', 'webdav');
            localStorage.setItem(PREFIX + `creds:webdav`, JSON.stringify(config));
            localStorage.setItem(PREFIX + 'tileStatus', 'synced');
            return reply(null);
          }

          // OAuth providers: open browser via Capacitor
          try {
            const { Browser } = await import('@capacitor/browser');
            const { App }     = await import('@capacitor/app');

            // PKCE helpers
            const verifier   = generateCodeVerifier();
            const challenge  = await sha256Base64url(verifier);
            const state      = generateCodeVerifier().slice(0, 16);

            const { authUrl, tokenUrl, clientId, redirectUri, scope } = getOAuthConfig(providerKey);
            if (!authUrl) throw new Error(`OAuth not configured for ${providerKey}. Register a client ID first.`);

            const params = new URLSearchParams({
              client_id: clientId, redirect_uri: redirectUri,
              response_type: 'code', scope, state,
              code_challenge: challenge, code_challenge_method: 'S256',
              access_type: 'offline', prompt: 'consent',
            });

            const code = await new Promise((res, rej) => {
              const listener = App.addListener('appUrlOpen', (ev) => {
                const url = new URL(ev.url ?? '');
                if (!url.href.startsWith(redirectUri)) return;
                listener.then(l => l.remove()).catch(() => {});
                Browser.close();
                if (url.searchParams.get('state') !== state) { rej(new Error('State mismatch')); return; }
                const c = url.searchParams.get('code');
                if (!c) { rej(new Error('No auth code returned')); return; }
                res(c);
              });
              Browser.open({ url: `${authUrl}?${params}` });
            });

            const tokenRes = await fetch(tokenUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: clientId, redirect_uri: redirectUri,
                grant_type: 'authorization_code', code, code_verifier: verifier,
              }),
            });
            if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
            const tokens = await tokenRes.json();

            const creds = {
              accessToken:  tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAt:    Date.now() + (tokens.expires_in ?? 3600) * 1000,
            };
            localStorage.setItem(PREFIX + 'activeProvider', providerKey);
            localStorage.setItem(PREFIX + `creds:${providerKey}`, JSON.stringify(creds));
            localStorage.setItem(PREFIX + 'tileStatus', 'synced');
            return reply(null);
          } catch (e) {
            throw e;
          }
        }

        // ── disconnectProvider ──────────────────────────────────────────────
        if (method === 'disconnectProvider') {
          const current = localStorage.getItem(PREFIX + 'activeProvider');
          if (current) localStorage.removeItem(PREFIX + `creds:${current}`);
          localStorage.removeItem(PREFIX + 'activeProvider');
          localStorage.removeItem(PREFIX + 'tileStatus');
          localStorage.removeItem(PREFIX + 'queue');
          return reply(null);
        }

        reply(null, `Unknown API method: ${method}`);
      } catch (e) {
        reply(null, e.message);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [extension.id]);

  if (loadErr) {
    return (
      <StatusBox
        icon="⚠️"
        title="Could not load extension page"
        subtitle={loadErr}
        accentHex={accentHex}
      />
    );
  }

  if (!srcdoc) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--text-4)' }}>
        <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '13px' }}>Loading…</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      title={pageDef.title ?? extension.name}
      style={{ flex: 1, width: '100%', border: 'none', display: 'block' }}
      sandbox="allow-scripts allow-same-origin allow-popups"
    />
  );
}

// ── OAuth config per provider ──────────────────────────────────────────────────
// Replace __PROVIDER_CLIENT_ID__ placeholders with real values before shipping.

function getOAuthConfig(providerKey) {
  const configs = {
    gdrive: {
      authUrl:     'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl:    'https://oauth2.googleapis.com/token',
      clientId:    '__GDRIVE_CLIENT_ID__',
      redirectUri: 'com.aurorastudios.authno:/oauth2/gdrive',
      scope:       'https://www.googleapis.com/auth/drive.file',
    },
    onedrive: {
      authUrl:     'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
      tokenUrl:    'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      clientId:    '__ONEDRIVE_CLIENT_ID__',
      redirectUri: 'com.aurorastudios.authno:/oauth2/onedrive',
      scope:       'Files.ReadWrite.AppFolder offline_access',
    },
    dropbox: {
      authUrl:     'https://www.dropbox.com/oauth2/authorize',
      tokenUrl:    'https://api.dropboxapi.com/oauth2/token',
      clientId:    '__DROPBOX_CLIENT_ID__',
      redirectUri: 'com.aurorastudios.authno:/oauth2/dropbox',
      scope:       '',
    },
  };
  return configs[providerKey] ?? {};
}

// ── PKCE utilities ─────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  const arr = new Uint8Array(48);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function sha256Base64url(str) {
  const enc  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── Main ExtensionPage ───────────────────────────────────────────────────────

export default function ExtensionPage({ extension, pageId, session, accentHex, onBack, inline = false }) {
  const pageDef = extension?.contributes?.pages?.[pageId];

  // Unknown page
  if (!pageDef) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--app-bg)' }}>
        <PageHeader
          title={extension?.name ?? 'Extension'}
          onBack={onBack}
          accentHex={accentHex}
        />
        <StatusBox
          icon="❓"
          title="Page not found"
          subtitle={`The extension "${extension?.name}" does not declare a page with id "${pageId}".`}
          accentHex={accentHex}
        />
      </div>
    );
  }

  // Refresh button shown in the header for api-data pages
  const headerAction = pageDef.type === 'api-data' ? (
    <button
      onClick={() => window.dispatchEvent(new Event('extension-api-refresh'))}
      style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '6px' }}
      aria-label="Refresh"
    >
      <RefreshCw size={16} />
    </button>
  ) : null;

  const title = pageDef.title ?? extension.name;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: inline ? 'transparent' : 'var(--app-bg)', overflow: 'hidden' }}>
      {!inline && (
        <PageHeader title={title} onBack={onBack} accentHex={accentHex} action={headerAction} />
      )}

      {/* Render the correct page type */}
      {pageDef.type === 'auth-form' && (
        <AuthFormPage extension={extension} accentHex={accentHex} onBack={onBack} />
      )}
      {pageDef.type === 'webview' && (
        <WebviewPage url={pageDef.url} accentHex={accentHex} />
      )}
      {pageDef.type === 'api-data' && (
        <ApiDataPage extension={extension} page={pageDef} session={session} accentHex={accentHex} />
      )}
      {pageDef.type === 'api-action' && (
        <ApiActionPage extension={extension} page={pageDef} session={session} accentHex={accentHex} onBack={onBack} />
      )}
      {pageDef.type === 'ui-file' && (
        <UiFilePage extension={extension} pageDef={pageDef} accentHex={accentHex} />
      )}
    </div>
  );
}
