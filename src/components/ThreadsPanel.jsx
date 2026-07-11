/**
 * ThreadsPanel.jsx — the panel half of the Threads feature.
 *
 * Desktop: a side pane tiled to the right of the manuscript (v1 = single pane,
 * per docs/threads-spec.md; tiling-to-2 + tabs is v1.1).
 * Android:  a bottom sheet covering ~5/8 of the screen.
 *
 * Views: thread list (grouped by type, TODO badges, global reminders) →
 * thread detail (entries auto-sorted by manuscript position, TODO flags,
 * relations, type meta fields) → new-thread form → type manager (user-defined
 * types with custom fields — the generic engine, nothing hardcoded).
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { DSIcons, toast, CloseButton } from '../DesignSystem';
import {
  getAllTypes, typeById, threadColor, sortedEntries, todoCount, allOpenTodos,
  addThread, updateThread, removeThread, addEntry, updateEntry, removeEntry,
  addType, removeType, addRelation, removeRelation, relationsOf,
  locateAnchors, exportOutlineMarkdown, THREAD_COLORS,
} from '../utils/threads';
import { hapticDelete, hapticNodeConnect } from '../utils/haptics';

/**
 * Debounce a value until it stops changing for `ms`. The session object gets a
 * new identity on every keystroke; anchor lookups over the whole manuscript
 * should wait for a typing lull instead of rescanning per character.
 */
function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const ICON_CHOICES = ['BookOpen', 'User', 'Star', 'Flame', 'Lightning', 'Globe', 'Heart', 'Target', 'Key', 'Eye'];

function TypeIcon({ name, size = 14, color = 'currentColor' }) {
  const I = DSIcons[name] || DSIcons.Extension;
  return <I size={size} color={color} />;
}

function PanelHeader({ title, onBack, onClose, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--nav-bg)', flexShrink: 0 }}>
      {onBack && (
        <button onClick={onBack} aria-label="Back" style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <DSIcons.ChevronLeft size={16} />
        </button>
      )}
      <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      {right}
      <CloseButton onClick={onClose} label="Close threads panel" />
    </div>
  );
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({ entry, color, anchored, onToggleTodo, onToggleDone, onJump, onDelete, onEditText, focusRef }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.text);
  useEffect(() => setText(entry.text), [entry.text]);

  return (
    <div ref={focusRef} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 8px', borderRadius: 8, background: 'var(--surface)', border: `1px solid ${entry.todo && !entry.done ? 'var(--color-danger)' : 'var(--border-sm)'}` }}>
      {/* TODO/done circle */}
      <button
        onClick={() => (entry.todo ? onToggleDone() : onToggleTodo())}
        title={entry.todo ? (entry.done ? 'Reopen' : 'Mark done') : 'Flag as TODO'}
        style={{
          width: 16, height: 16, borderRadius: '50%', marginTop: 2, flexShrink: 0, cursor: 'pointer',
          border: `1.5px solid ${entry.todo && !entry.done ? 'var(--color-danger)' : entry.done ? 'var(--color-success)' : 'var(--text-5)'}`,
          background: entry.done ? 'var(--color-success)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}
      >
        {entry.done && <DSIcons.Check size={9} color="#fff" />}
      </button>

      {/* Text */}
      {editing ? (
        <input
          autoFocus value={text}
          onChange={e => setText(e.target.value)}
          onBlur={() => { setEditing(false); if (text.trim() && text !== entry.text) onEditText(text.trim()); }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(entry.text); setEditing(false); } }}
          style={{ flex: 1, minWidth: 0, background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 6, color: 'var(--text-1)', fontSize: 12.5, padding: '4px 7px', outline: 'none' }}
        />
      ) : (
        <span onClick={() => setEditing(true)} style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45, color: entry.done ? 'var(--text-5)' : 'var(--text-2)', textDecoration: entry.done ? 'line-through' : 'none', cursor: 'text', wordBreak: 'break-word' }}>
          {entry.todo && !entry.done && <span style={{ color: 'var(--color-danger)', fontWeight: 700, marginRight: 5, fontSize: 10 }}>TODO</span>}
          {entry.text}
        </span>
      )}

      {/* Jump + delete */}
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        {anchored && (
          <button onClick={onJump} title="Jump to spot in the manuscript" style={{ border: 'none', background: 'transparent', color, cursor: 'pointer', padding: 3, display: 'flex' }}>
            <DSIcons.Link size={13} color="currentColor" />
          </button>
        )}
        <button onClick={onDelete} title="Delete note" style={{ border: 'none', background: 'transparent', color: 'var(--text-5)', cursor: 'pointer', padding: 3, display: 'flex' }}>
          <DSIcons.Trash size={13} color="currentColor" />
        </button>
      </div>
    </div>
  );
}

// ── Thread detail view ────────────────────────────────────────────────────────

function ThreadDetail({ session, data, thread, onChangeData, onStripAnchors, onJump, accentHex, focusEntryId }) {
  const [newNote, setNewNote] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const focusRef = useRef(null);
  const type = typeById(data, thread.typeId);
  const color = threadColor(data, thread);
  // Debounced: locateAnchors regex-scans every chapter's HTML — O(manuscript).
  // The session identity changes per keystroke, so without the debounce this
  // rescans the whole book on every character typed while the panel is open.
  const settledSession = useDebounced(session, 300);
  const anchorMap = useMemo(() => locateAnchors(settledSession), [settledSession]);
  const entries = useMemo(() => sortedEntries(thread, anchorMap), [thread, anchorMap]);
  const rels = relationsOf(data, thread.id);

  useEffect(() => {
    if (focusEntryId && focusRef.current) focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusEntryId]);

  const deleteEntry = (entry) => {
    hapticDelete();
    if (entry.anchorIds?.length) onStripAnchors(entry.anchorIds);
    onChangeData(removeEntry(data, thread.id, entry.id));
  };

  const linkable = data.threads.filter(t => t.id !== thread.id && !rels.some(r => r.otherId === t.id));

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Identity + meta fields */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 4, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{type.name}</span>
        {todoCount(thread) > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
            {todoCount(thread)} TODO{todoCount(thread) > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {(type.fields || []).map(f => (
        <div key={f.key}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>{f.label}</div>
          <input
            value={thread.meta?.[f.key] ?? ''}
            onChange={e => onChangeData(updateThread(data, thread.id, { meta: { ...thread.meta, [f.key]: e.target.value } }))}
            placeholder={f.label}
            style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 8, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none' }}
          />
        </div>
      ))}

      {/* Connections */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {rels.map(({ relation, otherId }) => {
          const other = data.threads.find(t => t.id === otherId);
          if (!other) return null;
          return (
            <span key={relation.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, background: 'var(--surface-md)', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-3)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: threadColor(data, other) }} />
              {other.name}
              <button onClick={() => onChangeData(removeRelation(data, relation.id))} title="Unlink" style={{ border: 'none', background: 'transparent', color: 'var(--text-5)', cursor: 'pointer', padding: 0, display: 'flex' }}>
                <DSIcons.X size={9} />
              </button>
            </span>
          );
        })}
        {linkable.length > 0 && (
          linkOpen ? (
            <select
              autoFocus
              onBlur={() => setLinkOpen(false)}
              onChange={e => { if (e.target.value) { hapticNodeConnect(); onChangeData(addRelation(data, thread.id, e.target.value).data); } setLinkOpen(false); }}
              defaultValue=""
              style={{ fontSize: 11.5, padding: '3px 6px', borderRadius: 8, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-1)', outline: 'none' }}
            >
              <option value="" disabled>Link to…</option>
              {linkable.map(t => <option key={t.id} value={t.id} style={{ background: 'var(--modal-bg)', color: 'var(--text-1)' }}>{t.name}</option>)}
            </select>
          ) : (
            <button onClick={() => setLinkOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: 'transparent', border: '1px dashed var(--border)', fontSize: 11, color: 'var(--text-4)', cursor: 'pointer' }}>
              <DSIcons.Link size={10} color="currentColor" /> Connect
            </button>
          )
        )}
      </div>

      {/* Entries */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-5)', fontStyle: 'italic', padding: '10px 4px' }}>
            No notes yet. Select prose in the editor and use the tag chip to anchor a note here.
          </div>
        )}
        {entries.map(e => (
          <EntryRow
            key={e.id}
            entry={e}
            color={color}
            focusRef={e.id === focusEntryId ? focusRef : null}
            anchored={(e.anchorIds || []).some(id => anchorMap.has(id))}
            onToggleTodo={() => onChangeData(updateEntry(data, thread.id, e.id, { todo: true, done: false }))}
            onToggleDone={() => onChangeData(updateEntry(data, thread.id, e.id, { done: !e.done }))}
            onJump={() => { const id = (e.anchorIds || []).find(a => anchorMap.has(a)); if (id) onJump(id); }}
            onDelete={() => deleteEntry(e)}
            onEditText={(text) => onChangeData(updateEntry(data, thread.id, e.id, { text }))}
          />
        ))}
      </div>

      {/* Add note */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={newNote} onChange={e => setNewNote(e.target.value)}
          placeholder="Add a note or reminder…"
          onKeyDown={e => {
            if (e.key === 'Enter' && newNote.trim()) {
              onChangeData(addEntry(data, thread.id, { text: newNote.trim(), todo: e.shiftKey }).data);
              setNewNote('');
            }
          }}
          style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none' }}
        />
        <button
          onClick={() => { if (newNote.trim()) { onChangeData(addEntry(data, thread.id, { text: newNote.trim(), todo: true }).data); setNewNote(''); } }}
          title="Add as TODO reminder"
          style={{ padding: '0 10px', borderRadius: 8, border: '1px solid var(--color-danger)', background: 'var(--color-danger-bg)', color: 'var(--color-danger)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >
          TODO
        </button>
      </div>
    </div>
  );
}

// ── New thread / type manager forms ───────────────────────────────────────────

function NewThreadForm({ data, onChangeData, onCreated, accentHex }) {
  const types = getAllTypes(data);
  const [typeId, setTypeId] = useState(types[0]?.id);
  const [name, setName] = useState('');
  const [color, setColor] = useState(null);

  const create = () => {
    if (!name.trim()) return;
    const { data: next, thread } = addThread(data, { typeId, name, color });
    onChangeData(next);
    onCreated(thread.id);
  };

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {types.map(ty => (
          <button key={ty.id} onClick={() => setTypeId(ty.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${typeId === ty.id ? accentHex : 'var(--border)'}`,
              background: typeId === ty.id ? `${accentHex}18` : 'var(--surface)',
              color: typeId === ty.id ? accentHex : 'var(--text-3)' }}>
            <TypeIcon name={ty.icon} size={12} /> {ty.name}
          </button>
        ))}
      </div>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Thread name…"
        onKeyDown={e => e.key === 'Enter' && create()}
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-1)', fontSize: 13, outline: 'none' }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {THREAD_COLORS.map(c => (
          <button key={c} onClick={() => setColor(color === c ? null : c)} title={c}
            style={{ width: 22, height: 22, borderRadius: 7, background: c, cursor: 'pointer', border: 'none', outline: color === c ? `2px solid var(--text-1)` : '2px solid transparent', outlineOffset: 2 }} />
        ))}
        <span style={{ fontSize: 10.5, color: 'var(--text-5)', alignSelf: 'center' }}>{color ? '' : `default: type colour`}</span>
      </div>
      <button onClick={create} disabled={!name.trim()}
        style={{ padding: '10px 0', borderRadius: 10, border: 'none', background: name.trim() ? accentHex : 'var(--surface-md)', color: name.trim() ? '#fff' : 'var(--text-5)', fontSize: 13, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'default' }}>
        Create thread
      </button>
    </div>
  );
}

function TypeManager({ data, onChangeData, accentHex }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('Star');
  const [color, setColor] = useState(THREAD_COLORS[2]);
  const [fieldsText, setFieldsText] = useState('');

  const create = () => {
    if (!name.trim()) return;
    const fields = fieldsText.split(',').map(s => s.trim()).filter(Boolean)
      .map(label => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label }));
    onChangeData(addType(data, { name, icon, color, fields }).data);
    setName(''); setFieldsText('');
  };

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
      <div style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.5 }}>
        Thread types are fully user-definable — Plotline and Character Arc are just the built-in defaults. Custom types travel with this book.
      </div>

      {/* Existing types */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {getAllTypes(data).map(ty => (
          <div key={ty.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-sm)' }}>
            <span style={{ color: ty.color, display: 'flex' }}><TypeIcon name={ty.icon} size={14} /></span>
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-2)', fontWeight: 600 }}>{ty.name}</span>
            {(ty.fields || []).length > 0 && <span style={{ fontSize: 10, color: 'var(--text-5)' }}>{ty.fields.map(f => f.label).join(' · ')}</span>}
            {ty.builtin
              ? <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-5)', textTransform: 'uppercase' }}>built-in</span>
              : (
                <button onClick={() => onChangeData(removeType(data, ty.id))} title="Remove type" style={{ border: 'none', background: 'transparent', color: 'var(--text-5)', cursor: 'pointer', padding: 2, display: 'flex' }}>
                  <DSIcons.Trash size={13} />
                </button>
              )}
          </div>
        ))}
      </div>

      {/* Create */}
      <div style={{ borderTop: '1px solid var(--border-sm)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>New type</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Type name (e.g. Theme, Mystery, Setup→Payoff)"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none' }} />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {ICON_CHOICES.map(ic => (
            <button key={ic} onClick={() => setIcon(ic)} title={ic}
              style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                border: `1px solid ${icon === ic ? accentHex : 'var(--border)'}`,
                background: icon === ic ? `${accentHex}18` : 'var(--surface)', color: icon === ic ? accentHex : 'var(--text-4)' }}>
              <TypeIcon name={ic} size={13} />
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {THREAD_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} style={{ width: 20, height: 20, borderRadius: 6, background: c, cursor: 'pointer', border: 'none', outline: color === c ? '2px solid var(--text-1)' : '2px solid transparent', outlineOffset: 2 }} />
          ))}
        </div>
        <input value={fieldsText} onChange={e => setFieldsText(e.target.value)} placeholder="Custom fields, comma-separated (e.g. Character, Stakes)"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-1)', fontSize: 12.5, outline: 'none' }} />
        <button onClick={create} disabled={!name.trim()}
          style={{ padding: '9px 0', borderRadius: 10, border: 'none', background: name.trim() ? accentHex : 'var(--surface-md)', color: name.trim() ? '#fff' : 'var(--text-5)', fontSize: 12.5, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'default' }}>
          Add type
        </button>
      </div>
    </div>
  );
}

// ── Thread list view ──────────────────────────────────────────────────────────

function ThreadList({ session, data, onOpenThread, onChangeData, onStripAnchors, onNew, onTypes, accentHex, onJumpEntry }) {
  const todos = allOpenTodos(data);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const types = getAllTypes(data);

  const deleteThread = (t) => {
    hapticDelete();
    const anchorIds = t.entries.flatMap(e => e.anchorIds || []);
    if (anchorIds.length) onStripAnchors(anchorIds);
    onChangeData(removeThread(data, t.id));
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Global reminders roll-up */}
      {todos.length > 0 && (
        <div style={{ borderRadius: 10, border: '1px solid var(--color-danger)', background: 'var(--color-danger-bg)', overflow: 'hidden' }}>
          <button onClick={() => setRemindersOpen(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-danger)', fontSize: 12, fontWeight: 700 }}>
            <DSIcons.Bell size={13} color="currentColor" />
            {todos.length} open reminder{todos.length > 1 ? 's' : ''}
            <span style={{ marginLeft: 'auto', display: 'flex' }}>{remindersOpen ? <DSIcons.ChevronUp size={12} /> : <DSIcons.ChevronDown size={12} />}</span>
          </button>
          {remindersOpen && (
            <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {todos.map(({ thread, entry }) => (
                <button key={entry.id} onClick={() => onJumpEntry(thread.id, entry.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 7, border: 'none', background: 'var(--modal-bg)', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: threadColor(data, thread), flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.text}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-5)', flexShrink: 0 }}>{thread.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Threads grouped by type */}
      {types.map(ty => {
        const threads = data.threads.filter(t => t.typeId === ty.id);
        if (!threads.length) return null;
        return (
          <div key={ty.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.7px', margin: '2px 2px 6px' }}>
              <span style={{ color: ty.color, display: 'flex' }}><TypeIcon name={ty.icon} size={11} /></span> {ty.name}s
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {threads.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border-sm)', cursor: 'pointer' }}
                  onClick={() => onOpenThread(t.id)}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: threadColor(data, t), flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-5)' }}>{t.entries.length}</span>
                  {todoCount(t) > 0 && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>{todoCount(t)}</span>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); deleteThread(t); }} title="Delete thread"
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-5)', cursor: 'pointer', padding: 2, display: 'flex' }}>
                    <DSIcons.Trash size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {data.threads.length === 0 && (
        <div style={{ textAlign: 'center', padding: '26px 14px', color: 'var(--text-4)', fontSize: 12.5, lineHeight: 1.6 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, margin: '0 auto 10px', background: 'var(--surface)', border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>
            <DSIcons.Tag size={20} color="currentColor" />
          </div>
          No threads yet.<br />
          Select some prose in the editor and tap the tag chip — or create a thread below.
        </div>
      )}

      {/* Footer actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 8 }}>
        <button onClick={onNew}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 0', borderRadius: 9, border: 'none', background: accentHex, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          <DSIcons.Plus size={13} color="currentColor" /> New thread
        </button>
        <button onClick={onTypes} title="Manage thread types"
          style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <DSIcons.Settings size={13} color="currentColor" />
        </button>
        <button
          title="Copy Markdown outline"
          onClick={async () => {
            const md = exportOutlineMarkdown(session, data);
            try { await navigator.clipboard.writeText(md); toast('Threads outline copied as Markdown', { variant: 'success' }); }
            catch { toast('Could not copy the outline', { variant: 'danger' }); }
          }}
          style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <DSIcons.Copy size={13} color="currentColor" />
        </button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ThreadsPanel({
  session, data, onChangeData, onStripAnchors, onJump,
  openThreadId, focusEntryId, onOpenThread,
  accentHex = '#5a00d9', android = false, onClose,
}) {
  const [view, setView] = useState('list'); // list | new | types
  const openThread = data.threads.find(t => t.id === openThreadId) || null;

  const body = openThread ? (
    <ThreadDetail
      session={session} data={data} thread={openThread}
      onChangeData={onChangeData} onStripAnchors={onStripAnchors}
      onJump={onJump} accentHex={accentHex} focusEntryId={focusEntryId}
    />
  ) : view === 'new' ? (
    <NewThreadForm data={data} onChangeData={onChangeData} accentHex={accentHex}
      onCreated={(id) => { setView('list'); onOpenThread(id); }} />
  ) : view === 'types' ? (
    <TypeManager data={data} onChangeData={onChangeData} accentHex={accentHex} />
  ) : (
    <ThreadList
      session={session} data={data} accentHex={accentHex}
      onOpenThread={onOpenThread} onChangeData={onChangeData} onStripAnchors={onStripAnchors}
      onNew={() => setView('new')} onTypes={() => setView('types')}
      onJumpEntry={(threadId, entryId) => onOpenThread(threadId, entryId)}
    />
  );

  const header = (
    <PanelHeader
      title={openThread ? openThread.name : view === 'new' ? 'New thread' : view === 'types' ? 'Thread types' : 'Threads'}
      onBack={openThread ? () => onOpenThread(null) : view !== 'list' ? () => setView('list') : null}
      onClose={onClose}
    />
  );

  if (android) {
    // Mobile: bottom sheet covering ~5/8 of the screen (spec).
    return (
      <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 2380, background: 'var(--modal-overlay-bg, rgba(0,0,0,0.5))' }} onClick={onClose} />
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, height: '62.5dvh', zIndex: 2390,
          display: 'flex', flexDirection: 'column',
          background: 'var(--modal-bg)', borderTop: '1px solid var(--border)',
          borderRadius: '18px 18px 0 0', overflow: 'hidden',
          animation: 'threadsSheetUp 0.22s cubic-bezier(0.32,0.72,0,1)',
        }}>
          <style>{`@keyframes threadsSheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)', margin: '8px auto 0', flexShrink: 0 }} />
          {header}
          {body}
        </div>
      </>
    );
  }

  // Desktop: side pane tiled next to the manuscript.
  return (
    <div style={{
      width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--border)', background: 'var(--sidebar-bg)',
      overflow: 'hidden',
    }}>
      {header}
      {body}
    </div>
  );
}

// ── Desktop tiling (v1.1 — the hyprland concept from the spec) ───────────────
// The right column tiles up to TWO thread windows vertically. The first open
// thread owns the top window; every further thread becomes a browser-style
// tab in the bottom window (switchable, closable per tab). Closing the top
// window promotes the bottom window's first tab into it.

function TabStrip({ ids, data, activeId, onActivate, onCloseThread, accentHex }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', gap: 2, padding: '6px 8px 0',
      borderBottom: '1px solid var(--border)', background: 'var(--nav-bg)',
      overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', flexShrink: 0,
    }}>
      {ids.map((id) => {
        const t = data.threads.find((x) => x.id === id);
        if (!t) return null;
        const active = id === activeId;
        return (
          <div
            key={id}
            onClick={() => onActivate(id)}
            title={t.name}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
              borderRadius: '8px 8px 0 0', cursor: 'pointer', maxWidth: 150, minWidth: 0,
              background: active ? 'var(--surface-md)' : 'transparent',
              borderBottom: active ? `2px solid ${accentHex}` : '2px solid transparent',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: threadColor(data, t), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: active ? 700 : 500, color: active ? 'var(--text-1)' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.name}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onCloseThread(id); }}
              aria-label={`Close ${t.name}`}
              style={{ border: 'none', background: 'transparent', color: 'var(--text-5)', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}
            >
              <DSIcons.X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function ThreadsTilesDesktop({
  session, data, onChangeData, onStripAnchors, onJump,
  openThreadIds = [], activeTabId, focusEntryId,
  onOpenThread, onCloseThread, onActivateTab,
  accentHex = '#5a00d9', onClose,
}) {
  const [view, setView] = useState('list'); // list | new | types — window A only

  const primary = data.threads.find((t) => t.id === openThreadIds[0]) || null;
  const tabIds = openThreadIds.slice(1);
  const activeTab = tabIds.includes(activeTabId) ? activeTabId : (tabIds[0] ?? null);
  const secondary = data.threads.find((t) => t.id === activeTab) || null;

  const detail = (thread) => (
    <ThreadDetail
      session={session} data={data} thread={thread}
      onChangeData={onChangeData} onStripAnchors={onStripAnchors}
      onJump={onJump} accentHex={accentHex}
      focusEntryId={focusEntryId}
    />
  );

  return (
    <div style={{
      width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--border)', background: 'var(--sidebar-bg)',
      overflow: 'hidden',
    }}>
      {/* Window A — first open thread, or the list/new/types views */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <PanelHeader
          title={primary ? primary.name : view === 'new' ? 'New thread' : view === 'types' ? 'Thread types' : 'Threads'}
          onBack={primary ? () => onCloseThread(primary.id) : view !== 'list' ? () => setView('list') : null}
          onClose={onClose}
        />
        {primary ? detail(primary) : view === 'new' ? (
          <NewThreadForm data={data} onChangeData={onChangeData} accentHex={accentHex}
            onCreated={(id) => { setView('list'); onOpenThread(id); }} />
        ) : view === 'types' ? (
          <TypeManager data={data} onChangeData={onChangeData} accentHex={accentHex} />
        ) : (
          <ThreadList
            session={session} data={data} accentHex={accentHex}
            onOpenThread={onOpenThread} onChangeData={onChangeData} onStripAnchors={onStripAnchors}
            onNew={() => setView('new')} onTypes={() => setView('types')}
            onJumpEntry={(threadId, entryId) => onOpenThread(threadId, entryId)}
          />
        )}
      </div>

      {/* Window B — the rest as tabs */}
      {tabIds.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--border)' }}>
          <TabStrip
            ids={tabIds} data={data} activeId={activeTab}
            onActivate={onActivateTab} onCloseThread={onCloseThread}
            accentHex={accentHex}
          />
          {secondary && detail(secondary)}
        </div>
      )}
    </div>
  );
}
