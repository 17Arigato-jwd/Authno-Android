/**
 * ExtensionPage.jsx
 *
 * Changes from v1.1.14:
 *   - Added 'ui-file' page type (was completely missing — caused blank screen)
 *   - UiFilePage reads the extension's JS file from Capacitor filesystem,
 *     builds a self-contained srcdoc iframe with CloudBackupAPI injected
 *     synchronously before the extension script executes.
 *   - The API bridge uses postMessage for two-way communication so the iframe's
 *     isolated window can call storage.get/set, navigate, etc.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, RefreshCw, ExternalLink, Check, AlertTriangle, Loader } from 'lucide-react';
import { useExtensions } from '../utils/ExtensionContext';
import { callExtensionApi } from '../utils/extensionLoader';
import { isAndroid } from '../utils/platform';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sessionVars(session) {
  if (!session) return {};
  return {
    bookId:         session.id ?? '',
    bookTitle:      session.title ?? '',
    externalId:     session.externalId ?? '',
    chapterTitle:   session._editingChap?.title ?? '',
    chapterContent: session._editingChap?.content ?? '',
  };
}

function sub(str, vars) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// ─── Shared sub-components ───────────────────────────────────────────────────

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

function StatusBox({ icon, title, subtitle }) {
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

// ─── Page type: ui-file ───────────────────────────────────────────────────────
//
// Loads the extension's JS UI file from disk and renders it in a sandboxed
// iframe. CloudBackupAPI (or any window.* the extension sets) is bridged via
// postMessage so the isolated iframe window can call host-app operations.
//
// Message protocol (parent → iframe):
//   { type: 'init', api: { status, creds... } }     — first message on load
//
// Message protocol (iframe → parent):
//   { type: 'api-call', id, method, args }           — extension calls bridge
//
// Message protocol (parent → iframe):
//   { type: 'api-result', id, result?, error? }      — response to api-call

const EXT_BASE = 'https://localhost/extensions';

async function readExtensionFile(extId, relPath) {
  if (!isAndroid()) return null;
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const r = await Filesystem.readFile({
    path: `AuthNo/extensions/${extId}/${relPath}`,
    directory: Directory.Data,
    encoding: 'utf8',
  });
  return r.data;
}

function UiFilePage({ extension, pageDef, session, accentHex }) {
  const [srcdoc, setSrcdoc]     = useState(null);
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const iframeRef               = useRef(null);
  const pendingRef              = useRef({});   // id → { resolve, reject }
  const msgIdRef                = useRef(0);

  // ── Build srcdoc ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const fileCode = await readExtensionFile(extension.id, pageDef.file);
        if (cancelled) return;

        if (!fileCode) {
          setError(`Could not read ${pageDef.file} — make sure the extension is properly installed.`);
          return;
        }

        // The bridge shim is injected as an inline <script> that runs BEFORE
        // the extension script. It sets up window.CloudBackupAPI (and any future
        // window.*API objects) as async proxies backed by postMessage to the parent.
        //
        // Every storage.get / storage.set / navigate call from the extension UI
        // goes through this bridge — the iframe never needs direct filesystem access.
        const bridgeShim = `
(function() {
  var _pending = {};
  var _seq = 0;

  function call(method, args) {
    return new Promise(function(res, rej) {
      var id = ++_seq;
      _pending[id] = { res: res, rej: rej };
      window.parent.postMessage({ type: 'api-call', id: id, method: method, args: args }, '*');
    });
  }

  window.CloudBackupAPI = {
    getStatus:          function()          { return call('getStatus', []); },
    connectProvider:    function(k, c)      { return call('connectProvider', [k, c]); },
    disconnectProvider: function()          { return call('disconnectProvider', []); },
    resolveConflict:    function(id, r)     { return call('resolveConflict', [id, r]); },
    storage: {
      get: function(k)    { return call('storage.get', [k]); },
      set: function(k, v) { return call('storage.set', [k, v]); },
    },
    navigate: function(ext, pageId, session) {
      return call('navigate', [pageId, session]);
    },
    providers: {},
    queue: null,
    extension: ${JSON.stringify(extension)},
  };

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || msg.type !== 'api-result') return;
    var p = _pending[msg.id];
    if (!p) return;
    delete _pending[msg.id];
    if (msg.error) p.rej(new Error(msg.error));
    else p.res(msg.result);
  });
})();
        `;

        const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; padding: 0; background: transparent; }
  </style>
  <script>${bridgeShim}<\/script>
</head>
<body>
  <script type="module">
${fileCode}
  <\/script>
</body>
</html>`;

        setSrcdoc(doc);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [extension, pageDef]);

  // ── Handle postMessage calls from the iframe ────────────────────────────────
  useEffect(() => {
    const extStorage = (() => {
      const ns = `__ext_kv_${extension.id}__`;
      return {
        get: (k) => localStorage.getItem(ns + k),
        set: (k, v) => {
          if (v === null || v === undefined) localStorage.removeItem(ns + k);
          else localStorage.setItem(ns + k, String(v));
        },
      };
    })();

    const handler = async (e) => {
      const msg = e.data;
      if (!msg || msg.type !== 'api-call' || e.source !== iframeRef.current?.contentWindow) return;

      const { id, method, args } = msg;
      const reply = (result, error) => {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'api-result', id, result, error },
          '*'
        );
      };

      try {
        let result;
        if (method === 'storage.get')  result = extStorage.get(args[0]);
        else if (method === 'storage.set') { extStorage.set(args[0], args[1]); result = null; }
        else if (method === 'getStatus') {
          // Pull live data from extension's own window.CloudBackupAPI if available
          const api = window.CloudBackupAPI;
          result = api?.getStatus ? await api.getStatus() : { activeProvider: null, tileStatus: 'synced', queueEntries: [] };
        }
        else if (method === 'connectProvider') {
          const api = window.CloudBackupAPI;
          if (!api?.connectProvider) throw new Error('connectProvider not available');
          result = await api.connectProvider(...args);
        }
        else if (method === 'disconnectProvider') {
          const api = window.CloudBackupAPI;
          if (!api?.disconnectProvider) throw new Error('disconnectProvider not available');
          result = await api.disconnectProvider();
        }
        else if (method === 'resolveConflict') {
          const api = window.CloudBackupAPI;
          if (!api?.resolveConflict) throw new Error('resolveConflict not available');
          result = await api.resolveConflict(...args);
        }
        else if (method === 'navigate') {
          // args[0] = pageId, args[1] = passedSession
          // Navigate to another page within the same extension
          window.dispatchEvent(new CustomEvent('__ext-navigate', {
            detail: { extension, pageId: args[0], session: args[1] ?? session }
          }));
          result = null;
        }
        else throw new Error(`Unknown bridge method: ${method}`);

        reply(result, undefined);
      } catch (err) {
        reply(undefined, err.message);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [extension, session]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--text-4)' }}>
        <Loader size={28} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '13px' }}>Loading extension…</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <StatusBox
        icon="⚠️"
        title="Extension failed to load"
        subtitle={error}
      />
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      title={pageDef.title ?? extension.name}
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
      style={{ flex: 1, width: '100%', border: 'none', background: 'transparent' }}
    />
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
    return <StatusBox icon="ℹ️" title="No configuration needed" subtitle="This extension does not require any credentials." />;
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
              borderRadius: '8px', color: 'var(--text-1)', fontSize: '14px', outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = accentHex}
            onBlur={e  => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
          />
        </div>
      ))}

      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        <button
          onClick={handleSave}
          style={{
            flex: 1, padding: '11px', borderRadius: '8px',
            background: saved ? '#22c55e' : accentHex,
            color: '#fff', fontWeight: 700, fontSize: '14px',
            border: 'none', cursor: 'pointer', transition: 'background 0.2s',
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
            color: 'var(--text-3)', fontSize: '13px', cursor: 'pointer',
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
  const [failed, setFailed]   = useState(false);
  const [loading, setLoading] = useState(true);

  if (!url) return <StatusBox icon="⚠️" title="No URL configured" subtitle="This page does not have a URL specified in the manifest." />;

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
      {failed
        ? <StatusBox icon="🌐" title="Could not load page" subtitle={`The extension page at ${url} could not be displayed.`} />
        : <iframe
            src={url}
            title="Extension page"
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setFailed(true); }}
            style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
      }
      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: 'var(--app-bg)', flexShrink: 0 }}>
        <button onClick={() => { try { window.open(url, '_blank', 'noopener'); } catch {} }}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', border: 'none', color: accentHex, fontSize: '12px', cursor: 'pointer' }}>
          <ExternalLink size={13} /> Open in browser
        </button>
      </div>
    </div>
  );
}

// ─── Page type: api-data ──────────────────────────────────────────────────────

function ApiDataPage({ extension, page, session, accentHex }) {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const vars = sessionVars(session);
      const result = await callExtensionApi(extension, page.endpoint, page.method ?? 'GET', null, vars);
      setData(result);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [extension, page, session]);

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener('extension-api-refresh', h);
    return () => window.removeEventListener('extension-api-refresh', h);
  }, [load]);

  if (loading) return <StatusBox icon={<Loader size={28} style={{ animation: 'spin 1s linear infinite' }} />} title="Loading data…" />;
  if (error)   return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <StatusBox icon="⚠️" title="Could not load data" subtitle={error} />
      <div style={{ padding: '0 24px 24px', display: 'flex', justifyContent: 'center' }}>
        <button onClick={load} style={{ padding: '8px 20px', borderRadius: '8px', background: accentHex, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
          Retry
        </button>
      </div>
    </div>
  );

  const entries = Object.entries(data ?? {});
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: '12px', cursor: 'pointer' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      {entries.length === 0
        ? <StatusBox icon="📭" title="No data returned" subtitle="The API returned an empty response." />
        : entries.map(([key, val]) => (
          <div key={key} style={{ padding: '14px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ color: 'var(--text-3)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '4px' }}>
              {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
            </div>
            <div style={{ color: 'var(--text-1)', fontSize: '20px', fontWeight: 700 }}>
              {typeof val === 'object' ? JSON.stringify(val) : String(val)}
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ─── Page type: api-action ────────────────────────────────────────────────────

function ApiActionPage({ extension, page, session, accentHex, onBack }) {
  const vars    = sessionVars(session);
  const { getConfig } = useExtensions();
  const config  = getConfig(extension.id);
  const allVars = { ...vars, ...config };

  const [fields,  setFields]  = useState(() => {
    const init = {};
    if (page.bodyTemplate) {
      Object.entries(page.bodyTemplate).forEach(([k, v]) => {
        init[k] = typeof v === 'string' ? sub(v, allVars) : String(v);
      });
    }
    return init;
  });
  const [status,  setStatus]  = useState('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    setStatus('loading');
    try {
      await callExtensionApi(extension, page.endpoint, page.method ?? 'POST', page.bodyTemplate, allVars);
      setStatus('success');
      setMessage(page.successMessage ?? 'Done!');
      setTimeout(() => { setStatus('idle'); onBack?.(); }, 1800);
    } catch (e) { setStatus('error'); setMessage(e.message); }
  };

  if (status === 'success') return <StatusBox icon="✅" title={message} />;

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
              width: '100%', boxSizing: 'border-box', padding: '10px 12px', resize: 'vertical',
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
        <div style={{ padding: '10px 12px', borderRadius: '8px', background: '#dc262622', border: '1px solid #dc262644', color: '#fca5a5', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
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

// ─── Main ExtensionPage ───────────────────────────────────────────────────────

export default function ExtensionPage({ extension, pageId, session, accentHex, onBack, inline = false }) {
  const pageDef = extension?.contributes?.pages?.[pageId];

  if (!pageDef) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--app-bg)' }}>
        <PageHeader title={extension?.name ?? 'Extension'} onBack={onBack} accentHex={accentHex} />
        <StatusBox icon="❓" title="Page not found" subtitle={`The extension "${extension?.name}" does not declare a page with id "${pageId}".`} />
      </div>
    );
  }

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
      {!inline && <PageHeader title={title} onBack={onBack} accentHex={accentHex} action={headerAction} />}

      {pageDef.type === 'ui-file' && (
        <UiFilePage extension={extension} pageDef={pageDef} session={session} accentHex={accentHex} />
      )}
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
    </div>
  );
}
