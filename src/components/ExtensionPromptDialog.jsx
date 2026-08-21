/**
 * ExtensionPromptDialog.jsx — the question an extension asked.
 *
 * `extensionPrompts.js` has held the whole model since the v2 work: one dialog
 * at a time, refused while the editor has focus, refused if the extension
 * already has one open, cancelled when its extension stops. It had no
 * consumer, and the consequence was not a missing feature — it was a hang.
 *
 * `authno.ui.confirm()` enqueues an entry and returns a promise that settles
 * when somebody calls `answer()` or `dismiss()`. Nothing called either. So an
 * extension asking a question waited forever, and so did anything awaiting it
 * — including `network.requestHost`, which is how a WebDAV server gets
 * permission to be reached at all. Cloud Backup's connect flow would have
 * stopped dead on the one call that makes self-hosting possible.
 *
 * ── Why the app draws it ────────────────────────────────────────────────────
 *
 * An extension cannot style this, cannot choose where it appears, and cannot
 * leave off whose question it is. A dialog is the moment a person is asked to
 * decide something, and the one thing they always need is who is asking —
 * which is exactly what an extension drawing its own dialog would be free to
 * omit.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FrostedModal, COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../DesignSystem';
import { prompts } from '../utils/extensionPrompts';
import { colourFor } from '../utils/extensionSurfaces';
import { useExtensions } from '../utils/ExtensionContext';

export default function ExtensionPromptDialog({ accentHex = COLORS.violetDark }) {
  // Names rather than ids, read from the installed list. A person agreed to
  // install "Cloud Backup"; being asked something by "cloud-backup" names a
  // directory at them.
  const { extensions } = useExtensions();
  const [, forceRender] = useState(0);
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  // Subscribe rather than construct: extensionRuntime creates this singleton
  // the first time an extension asks anything, long before this mounts.
  useEffect(() => prompts().subscribe(() => forceRender((n) => n + 1)), []);

  const entry = prompts().current();

  // Reset the field whenever the question changes — answering one and moving
  // to the next must not carry the previous answer across.
  //
  // Keyed on `seq` rather than on what the question SAYS. Two identical
  // questions are two questions: "Which folder?" asked about a second book is
  // word-for-word the first, and content-keying left the first book's answer
  // sitting in the field as the default for the second.
  //
  // During render rather than in an effect, so the field is right the first
  // time it is painted instead of one frame later — which is also the only
  // version that survives being server-rendered.
  const [shownSeq, setShownSeq] = useState(null);
  if (entry && shownSeq !== entry.seq) {
    setShownSeq(entry.seq);
    setText(entry.kind === 'prompt' ? (entry.initial ?? '') : '');
  }

  // Focus the field, but only for a prompt. A confirm has no field, and moving
  // focus to a button means Enter answers a question the person may not have
  // read yet.
  useEffect(() => {
    if (entry?.kind === 'prompt') inputRef.current?.focus();
  }, [entry?.kind, entry?.extId]);

  const answer = useCallback(() => { prompts().answer(text); }, [text]);
  const dismiss = useCallback(() => { prompts().dismiss(); }, []);

  if (!entry) return null;

  const who = entry.extId;
  const label = extensions.find((e) => String(e.id) === who)?.name ?? who;
  const accent = entry.danger ? COLORS.danger : accentHex;

  return (
    <FrostedModal isOpen onClose={dismiss} accentHex={accent} maxWidth="420px">
      {/* No padding of its own: FrostedModal pads an untitled panel already,
          and adding to it inset the question twice. */}
      <div>
        {/* Whose question it is, before the question. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: SPACING.sm,
          marginBottom: SPACING.md,
        }}>
          <span aria-hidden="true" style={{
            width: 8, height: 8, borderRadius: '50%',
            background: colourFor(who), flexShrink: 0,
          }} />
          <span style={{
            fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.bold,
            letterSpacing: TYPOGRAPHY.tracking.wide, textTransform: 'uppercase',
            color: COLORS.textSubtle,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label} is asking</span>
        </div>

        {entry.title && (
          <h2 style={{
            fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.bold,
            color: COLORS.textPrimary, margin: `0 0 ${SPACING.sm}px`, lineHeight: 1.3,
          }}>{entry.title}</h2>
        )}

        {entry.message && (
          <p style={{
            fontSize: TYPOGRAPHY.size.base, color: COLORS.textMuted,
            lineHeight: 1.6,
            margin: `0 0 ${entry.emphasis ? SPACING.md : SPACING.lg}px`,
            // A message may still arrive with its own line breaks — an
            // extension writes these, and collapsing what it wrote would
            // reflow somebody else's paragraph.
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{entry.message}</p>
        )}

        {/*
          The fact the answer turns on, set apart from the sentence around it.
          Only the app can fill this in (see `hostConfirm`), and the host-grant
          question is what it exists for: an address in running prose reads as
          background, and this is the one line somebody has to actually look at
          before saying yes.

          `anywhere`, not `break-word`: a long path has no spaces to break at,
          and the alternative to breaking mid-token is a line that runs out of
          the panel.
        */}
        {entry.emphasis && (
          <div style={{
            fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.sm,
            color: COLORS.textPrimary, lineHeight: 1.5,
            padding: `10px ${SPACING.md}px`, borderRadius: RADIUS.md,
            background: 'rgba(0,0,0,0.28)', border: `1px solid ${COLORS.border}`,
            overflowWrap: 'anywhere', margin: `0 0 ${SPACING.md}px`,
          }}>{entry.emphasis}</div>
        )}

        {entry.note && (
          <p style={{
            fontSize: TYPOGRAPHY.size.sm, color: COLORS.textMuted,
            lineHeight: 1.5, margin: `0 0 ${SPACING.lg}px`,
          }}>{entry.note}</p>
        )}

        {entry.kind === 'prompt' && (
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); answer(); }
              if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
            }}
            placeholder={entry.placeholder ?? ''}
            aria-label={entry.title || entry.message || 'Answer'}
            style={{
              width: '100%', padding: `10px ${SPACING.md}px`,
              borderRadius: RADIUS.md, border: `1px solid ${COLORS.border}`,
              background: 'rgba(0,0,0,0.25)', color: COLORS.textPrimary,
              fontSize: TYPOGRAPHY.size.base, marginBottom: SPACING.lg,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        )}

        <div style={{ display: 'flex', gap: SPACING.sm, justifyContent: 'flex-end' }}>
          <button
            onClick={dismiss}
            style={{
              padding: `10px ${SPACING.lg}px`, borderRadius: RADIUS.md,
              border: `1px solid ${COLORS.border}`, background: 'transparent',
              color: COLORS.textMuted, fontSize: TYPOGRAPHY.size.base,
              fontWeight: TYPOGRAPHY.weight.semibold, cursor: 'pointer',
            }}
          >{entry.kind === 'prompt' ? 'Cancel' : 'No'}</button>
          <button
            onClick={answer}
            style={{
              padding: `10px ${SPACING.lg}px`, borderRadius: RADIUS.md,
              border: 'none', background: accent, color: 'var(--on-accent, #fff)',
              fontSize: TYPOGRAPHY.size.base, fontWeight: TYPOGRAPHY.weight.bold,
              cursor: 'pointer',
            }}
          >{entry.kind === 'prompt' ? 'Done' : 'Yes'}</button>
        </div>
      </div>
    </FrostedModal>
  );
}
