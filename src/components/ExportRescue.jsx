/**
 * ExportRescue.jsx — "Export my books", reachable from the locked gate.
 *
 * The promise on the website's support page is unconditional: whatever has
 * happened to your account, your manuscripts come out. This screen is that
 * promise, and it runs with no session, no network and no key — it renders
 * from behind the gate without the gate ever opening.
 *
 * Two sources, because the localStorage mirror is not the truth:
 *   1. The mirror, which covers everything the app had open.
 *   2. "Open a file from this device", for .authbook files the mirror lost or
 *      never knew about — the real source of truth on disk.
 *
 * Nothing here writes or deletes. Worst case it exports nothing; it can never
 * cost somebody a book.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { DSIcons } from '../DesignSystem';
import { FloatingBlobs, ONB_THEME_CSS } from './Onboarding';
import { readLocalLibrary, bookWordCount, isStub, exportBookAs, RESCUE_FORMATS } from '../utils/rescue';

export default function ExportRescue({ accentHex = '#5a00d9', onBack }) {
  const mirrored = useMemo(() => readLocalLibrary(), []);
  const [opened, setOpened] = useState([]);          // books picked off disk
  const [selected, setSelected] = useState(null);    // book id being exported
  const [format, setFormat] = useState('txt');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);            // { tone, text }

  // Disk-opened copies win over their mirrored stubs — same book, better data.
  const books = useMemo(() => {
    const byId = new Map();
    for (const b of mirrored) byId.set(b.id, b);
    for (const b of opened) byId.set(b.id ?? b.title, b);
    return [...byId.values()];
  }, [mirrored, opened]);

  const current = books.find((b) => (b.id ?? b.title) === selected) || null;

  const openFromDisk = useCallback(async () => {
    setNote(null);
    try {
      const { openBook } = await import('../utils/storage');
      const book = await openBook();
      if (!book) return;                              // picker dismissed
      setOpened((prev) => [book, ...prev.filter((b) => b.id !== book.id)]);
      setSelected(book.id ?? book.title);
      setNote({ tone: 'ok', text: `Opened “${book.title || 'Untitled'}”. Choose a format below.` });
    } catch {
      setNote({ tone: 'bad', text: 'That file couldn’t be opened. If it isn’t an .authbook, pick a different one.' });
    }
  }, []);

  const runExport = useCallback(async (list) => {
    if (!list.length || busy) return;
    setBusy(true);
    setNote(null);
    let done = 0;
    const failed = [];
    for (const book of list) {
      try { await exportBookAs(book, format); done += 1; }
      catch { failed.push(book.title || 'Untitled'); }
    }
    setBusy(false);
    if (failed.length === 0) {
      setNote({ tone: 'ok', text: `Exported ${done} ${done === 1 ? 'book' : 'books'} as ${format.toUpperCase()}.` });
    } else {
      setNote({
        tone: 'bad',
        text: `${done} exported. These didn’t write: ${failed.join(', ')}. Try another format — TXT is the one that always works.`,
      });
    }
  }, [busy, format]);

  const exportable = books.filter((b) => !isStub(b));

  return (
    <div className="onb" style={S.root}>
      <style>{ONB_THEME_CSS}</style>
      <FloatingBlobs accentHex={accentHex} />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.2, 0.9, 0.3, 1] }}
        style={S.card}
      >
        <div style={S.badge}><DSIcons.Download size={19} /></div>
        <h1 style={S.title}>Export my books</h1>
        <p style={S.sub}>
          No key, no account and no internet needed. This reads the books on
          this device and writes them out wherever you like. Nothing here
          changes or deletes anything.
        </p>

        <div style={S.formatRow} role="radiogroup" aria-label="Export format">
          {RESCUE_FORMATS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={format === f.id}
              title={f.hint}
              onClick={() => setFormat(f.id)}
              disabled={busy}
              style={{ ...S.formatChip, ...(format === f.id ? S.formatChipOn : null) }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p style={S.formatHint}>{RESCUE_FORMATS.find((f) => f.id === format)?.hint}</p>

        {note && (
          <div style={note.tone === 'bad' ? S.error : S.ok} role="status">
            <DSIcons.Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{note.text}</span>
          </div>
        )}

        {books.length === 0 ? (
          <div style={S.empty}>
            <p style={{ margin: '0 0 6px', fontWeight: 600 }}>No books found on this device.</p>
            <p style={{ margin: 0 }}>
              If your books live in a folder AuthNo hasn’t opened yet, use the
              button below to pick an <code style={S.code}>.authbook</code> file
              directly.
            </p>
          </div>
        ) : (
          <div style={S.list}>
            {books.map((b) => {
              const id = b.id ?? b.title;
              const stub = isStub(b);
              return (
                <button
                  key={id}
                  onClick={() => { setSelected(id === selected ? null : id); setNote(null); }}
                  disabled={busy}
                  style={{ ...S.row, ...(selected === id ? S.rowOn : null) }}
                >
                  <DSIcons.Book size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
                  <span style={S.rowText}>
                    <span style={S.rowTitle}>{b.title || 'Untitled'}</span>
                    <span style={S.rowMeta}>
                      {stub
                        ? 'text not in this copy — open the file from disk'
                        : `${bookWordCount(b).toLocaleString()} words · ${(b.chapters || []).length || 1} chapter${(b.chapters || []).length === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  {selected === id && !stub && <DSIcons.Check size={15} style={{ flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={() => runExport(current && !isStub(current) ? [current] : [])}
          disabled={busy || !current || isStub(current)}
          style={{ ...S.cta, opacity: busy || !current || isStub(current) ? 0.45 : 1 }}
        >
          {busy ? 'Writing…' : current ? `Export “${trim(current.title)}” as ${format.toUpperCase()}` : 'Choose a book above'}
        </button>

        {exportable.length > 1 && (
          <button
            onClick={() => runExport(exportable)}
            disabled={busy}
            style={S.secondary}
          >
            Export all {exportable.length} as {format.toUpperCase()}
          </button>
        )}

        <button onClick={openFromDisk} disabled={busy} style={S.secondary}>
          Open a file from this device
        </button>

        <button onClick={onBack} disabled={busy} style={S.back}>
          Back to sign in
        </button>

        <p style={S.foot}>
          Your <code style={S.code}>.authbook</code> files stay exactly where
          they are. Exporting copies them out — it never moves or removes the
          originals.
        </p>
      </motion.div>
    </div>
  );
}

const trim = (t) => {
  const s = String(t || 'Untitled');
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
};

const S = {
  root: {
    position: 'fixed', inset: 0, zIndex: 100000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'max(18px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom))',
    background: 'var(--onb-bg)', overflowY: 'auto',
  },
  card: {
    position: 'relative', zIndex: 1, width: '100%', maxWidth: 480,
    background: 'var(--onb-card)',
    border: '1px solid var(--onb-border)',
    borderRadius: 22, padding: 'clamp(24px, 6vw, 34px)',
    backdropFilter: 'blur(22px)', boxShadow: '0 28px 70px rgba(0,0,0,0.5)',
    margin: 'auto',
  },
  badge: {
    width: 42, height: 42, borderRadius: 13, marginBottom: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--onb-accent-soft)',
    color: 'var(--onb-accent)',
  },
  title: { fontFamily: 'Sora, sans-serif', fontSize: 25, fontWeight: 800, letterSpacing: '-0.5px', margin: '0 0 10px', color: 'var(--onb-text1)' },
  sub: { fontSize: 14, lineHeight: 1.66, color: 'var(--onb-text3)', margin: '0 0 20px' },
  formatRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  formatChip: {
    flex: '1 1 auto', minWidth: 68, padding: '9px 12px', borderRadius: 10,
    background: 'var(--onb-field)',
    border: '1px solid var(--onb-field-border)',
    color: 'var(--onb-text3)',
    fontFamily: 'Sora, sans-serif', fontWeight: 700, fontSize: 13, cursor: 'pointer',
    transition: 'background .15s, color .15s, border-color .15s',
  },
  formatChipOn: {
    background: 'var(--onb-accent-soft)',
    borderColor: 'var(--onb-accent)',
    color: 'var(--onb-text1)',
  },
  formatHint: { fontSize: 12, color: 'var(--onb-text4)', margin: '0 0 18px' },
  list: {
    display: 'flex', flexDirection: 'column', gap: 6,
    maxHeight: 260, overflowY: 'auto', marginBottom: 18,
    paddingRight: 2,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 11, width: '100%',
    padding: '11px 13px', borderRadius: 11, textAlign: 'left',
    background: 'var(--onb-surface)',
    border: '1px solid var(--onb-border)',
    color: 'var(--onb-text2)', cursor: 'pointer',
    transition: 'background .15s, border-color .15s',
  },
  rowOn: {
    background: 'var(--onb-accent-soft)',
    borderColor: 'var(--onb-accent)',
  },
  rowText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: 600, color: 'var(--onb-text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowMeta: { fontSize: 11.5, color: 'var(--onb-text4)' },
  empty: {
    fontSize: 13, lineHeight: 1.65, marginBottom: 18, padding: '14px 15px', borderRadius: 12,
    background: 'var(--onb-surface)',
    border: '1px solid var(--onb-border)',
    color: 'var(--onb-text3)',
  },
  error: {
    display: 'flex', gap: 9, alignItems: 'flex-start',
    background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
    borderRadius: 11, padding: '11px 13px', marginBottom: 14,
    fontSize: 13, lineHeight: 1.6, color: '#fca5a5',
  },
  ok: {
    display: 'flex', gap: 9, alignItems: 'flex-start',
    background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)',
    borderRadius: 11, padding: '11px 13px', marginBottom: 14,
    fontSize: 13, lineHeight: 1.6, color: '#6ee7b7',
  },
  cta: {
    width: '100%', padding: '14px 20px', borderRadius: 13, border: 'none',
    background: 'var(--onb-accent-fill)',
    color: '#fff', fontFamily: 'Sora, sans-serif', fontWeight: 700, fontSize: 15,
    cursor: 'pointer', transition: 'opacity .2s',
  },
  secondary: {
    display: 'block', width: '100%', marginTop: 10, padding: '11px 16px',
    borderRadius: 12, cursor: 'pointer',
    background: 'var(--onb-field)',
    border: '1px solid var(--onb-field-border)',
    color: 'var(--onb-text2)',
    fontFamily: 'Sora, sans-serif', fontWeight: 600, fontSize: 13.5,
  },
  back: {
    display: 'block', width: '100%', marginTop: 12, padding: '8px 0',
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--onb-text4)',
    fontSize: 12.5, textDecoration: 'underline', fontFamily: 'inherit',
  },
  code: { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: '0.92em' },
  foot: { fontSize: 12, lineHeight: 1.6, color: 'var(--onb-text4)', margin: '18px 0 0' },
};
