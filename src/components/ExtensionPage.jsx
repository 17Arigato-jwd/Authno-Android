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

  useEffect(() => { load(); }, [load]);

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
  const refreshRef = useRef(null);
  const headerAction = pageDef.type === 'api-data' ? (
    <button
      onClick={() => refreshRef.current?.()}
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
    </div>
  );
}
