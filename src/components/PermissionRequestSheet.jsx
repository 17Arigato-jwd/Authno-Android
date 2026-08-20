/**
 * PermissionRequestSheet.jsx — what an extension is asking to do.
 *
 * Mounts once at app root, beside InstallSheet, and draws whatever
 * `permissionRequests()` currently has to ask. The queue is a plain module
 * rather than context because the install that raises the question runs from
 * an event handler MainActivity wires up, long before any provider mounts.
 *
 * ── Three decisions worth stating ────────────────────────────────────────────
 *
 * **Everything starts switched ON.** The alternative — everything off, opt in
 * — reads as safer and is not: an extension that lands with nothing granted
 * appears broken, the person turns everything on to make it work, and the
 * switches have taught them that switches are an obstacle. Defaults that are
 * usually right, on a sheet that is easy to read, get more attention paid to
 * the one that is wrong.
 *
 * **The author's reason is quoted, not paraphrased.** It is their sentence and
 * it is shown as theirs, under a line the app wrote saying what the permission
 * actually covers. A person comparing "Read all your books" against "To copy
 * every book, not only the one you have open" can see whether the two agree.
 * That comparison is the point of asking at all.
 *
 * **Dismissing is an answer.** Back, Escape, the backdrop and the drag-down
 * all mean no to everything new — not "ask again later". An install has
 * already happened by the time this appears; leaving the question open would
 * leave an extension in a state that is neither refused nor allowed.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { BottomSheet, Toggle, COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../DesignSystem';
import { permissionRequests } from '../utils/permissionRequests';

/**
 * Permissions a person should look twice at.
 *
 * Two, and the shortness is the point. Marking three of four rows makes the
 * marker mean "this is a permission", which every row already says — a shot of
 * the Cloud Backup sheet with read:all, write AND network flagged reads as
 * decoration rather than as a warning.
 *
 * These two are the ones with no bound on them: read:all sees every manuscript
 * and write can overwrite one. `network` is left unmarked because the origins
 * it may reach are listed underneath it, which is a better warning than a
 * label — and because an extension that has network and nothing else cannot
 * send anything worth sending.
 */
const WEIGHTY = new Set(['library:read:all', 'library:write']);

function ShieldIcon({ color }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function HostList({ hosts, muted }) {
  if (!Array.isArray(hosts) || hosts.length === 0) return null;
  return (
    <ul style={{ margin: `${SPACING.sm}px 0 0`, padding: 0, listStyle: 'none' }}>
      {hosts.map((h) => (
        <li key={h} style={{
          fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.xs,
          color: muted, padding: '2px 0', wordBreak: 'break-all',
        }}>{h}</li>
      ))}
    </ul>
  );
}

export default function PermissionRequestSheet({ accentHex = COLORS.violetDark }) {
  const [, forceRender] = useState(0);

  // Seeded from whatever is already queued rather than filled in by an effect.
  // The effect version rendered one frame with every switch off before turning
  // them on — a flicker on the one screen where a switch's position is the
  // whole message.
  const [granted, setGranted] = useState(
    () => new Set((permissionRequests().current()?.asked ?? []).map((a) => a.permission)),
  );

  // The queue notifies; the component re-reads. It holds no copy of the
  // request, so a second install arriving mid-answer cannot leave the sheet
  // drawing one extension and resolving another.
  //
  // Subscribing rather than constructing: the queue is a module singleton and
  // whichever install path ran first already created it. On Android that is
  // routinely a cold-start intent, before this has mounted — so the request
  // this sheet most needs to draw is one that already exists.
  useEffect(() => {
    const off = permissionRequests().subscribe(() => forceRender((n) => n + 1));
    forceRender((n) => n + 1);   // catch anything queued before we mounted
    return off;
  }, []);

  const req = permissionRequests().current();
  const waiting = permissionRequests().waiting();

  // Everything on again whenever the request CHANGES — answering one and
  // moving to the next must reset the switches rather than carry the previous
  // person's answer across. Keyed on extId, and skipped on the first render
  // because the initial state above already did it.
  const drawn = useRef(req?.extId ?? null);
  useEffect(() => {
    if (!req || drawn.current === req.extId) return;
    drawn.current = req.extId;
    setGranted(new Set(req.asked.map((a) => a.permission)));
  }, [req]);

  const toggle = useCallback((name) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const allow = useCallback(() => {
    permissionRequests().answer([...granted]);
  }, [granted]);

  const dismiss = useCallback(() => {
    permissionRequests().dismiss();
  }, []);

  const summary = useMemo(() => {
    if (!req) return '';
    const n = granted.size;
    const total = req.asked.length;
    if (n === 0) return `Allow nothing`;
    if (n === total) return total === 1 ? 'Allow it' : `Allow all ${total}`;
    return `Allow ${n} of ${total}`;
  }, [req, granted]);

  if (!req) return null;

  const muted = COLORS.textSubtle;

  return (
    <BottomSheet isOpen onClose={dismiss} accentHex={accentHex} maxWidth="560px">
      <div style={{ padding: `0 ${SPACING.lg}px ${SPACING.lg}px` }}>

        {/* Who is asking. A person answering deserves to know before the list. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.xs }}>
          <div style={{
            width: 38, height: 38, flexShrink: 0, borderRadius: RADIUS.md,
            background: `${accentHex}22`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ShieldIcon color={accentHex} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.bold,
              color: COLORS.textPrimary, lineHeight: 1.2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{req.name}</div>
            <div style={{ fontSize: TYPOGRAPHY.size.sm, color: muted }}>
              {req.version ? `Version ${req.version} · ` : ''}
              {req.asked.length === 1 ? 'wants permission for one thing' : `wants permission for ${req.asked.length} things`}
            </div>
          </div>
        </div>

        <p style={{
          fontSize: TYPOGRAPHY.size.base, color: COLORS.textMuted,
          lineHeight: 1.55, margin: `${SPACING.md}px 0 ${SPACING.lg}px`,
        }}>
          It is already installed. Nothing below happens until you allow it, and
          you can change any of this later.
        </p>

        {/* The list. One row per permission, the app's line above the author's. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.sm }}>
          {req.asked.map((item) => {
            const on = granted.has(item.permission);
            const weighty = WEIGHTY.has(item.permission);
            return (
              <div
                key={item.permission}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: SPACING.md,
                  padding: `${SPACING.md}px`,
                  borderRadius: RADIUS.lg,
                  border: `1px solid ${on ? `${accentHex}44` : COLORS.border}`,
                  background: on ? `${accentHex}0f` : 'rgba(255,255,255,0.02)',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: TYPOGRAPHY.size.base,
                    fontWeight: TYPOGRAPHY.weight.semibold,
                    color: COLORS.textPrimary,
                    display: 'flex', alignItems: 'center', gap: SPACING.sm, flexWrap: 'wrap',
                  }}>
                    {item.prompt}
                    {weighty && (
                      <span style={{
                        fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.bold,
                        letterSpacing: TYPOGRAPHY.tracking.wide, textTransform: 'uppercase',
                        color: COLORS.warning, background: `${COLORS.warning}1e`,
                        padding: '2px 6px', borderRadius: RADIUS.sm,
                      }}>worth a look</span>
                    )}
                  </div>

                  {/* The author's own sentence, marked as theirs. */}
                  {item.reason ? (
                    <div style={{
                      fontSize: TYPOGRAPHY.size.sm, color: muted,
                      lineHeight: 1.5, marginTop: 4,
                      borderLeft: `2px solid ${COLORS.border}`, paddingLeft: SPACING.sm,
                    }}>
                      &ldquo;{item.reason}&rdquo;
                      <span style={{ opacity: 0.7 }}> — {req.name}</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: TYPOGRAPHY.size.sm, color: muted, marginTop: 4 }}>
                      No reason given.
                    </div>
                  )}

                  <HostList hosts={item.hosts} muted={muted} />
                </div>

                {/* ariaLabel, not label: the design system's `label` renders
                    as visible text beside the switch, which took half the row
                    and wrapped the permission's own name one word per line.
                    A screenshot found that; jsdom cannot see it. */}
                <Toggle
                  on={on}
                  onChange={() => toggle(item.permission)}
                  accentHex={accentHex}
                  size="sm"
                  ariaLabel={`${on ? 'Allow' : 'Do not allow'}: ${item.prompt}`}
                  style={{ flexShrink: 0 }}
                />
              </div>
            );
          })}
        </div>

        {/* Already agreed to, shown so the sheet is the whole picture. */}
        {req.carried.length > 0 && (
          <p style={{ fontSize: TYPOGRAPHY.size.sm, color: muted, marginTop: SPACING.md }}>
            {req.carried.length === 1
              ? 'One permission you allowed before is unchanged.'
              : `${req.carried.length} permissions you allowed before are unchanged.`}
          </p>
        )}

        <div style={{ display: 'flex', gap: SPACING.sm, marginTop: SPACING.lg }}>
          <button
            onClick={dismiss}
            style={{
              flex: '0 0 auto', padding: `12px ${SPACING.lg}px`,
              borderRadius: RADIUS.lg, border: `1px solid ${COLORS.border}`,
              background: 'transparent', color: COLORS.textMuted,
              fontSize: TYPOGRAPHY.size.base, fontWeight: TYPOGRAPHY.weight.semibold,
              cursor: 'pointer',
            }}
          >Not now</button>
          <button
            onClick={allow}
            style={{
              flex: 1, padding: `12px ${SPACING.lg}px`,
              borderRadius: RADIUS.lg, border: 'none',
              background: granted.size === 0 ? COLORS.surface3 : accentHex,
              color: granted.size === 0 ? COLORS.textMuted : '#fff',
              fontSize: TYPOGRAPHY.size.base, fontWeight: TYPOGRAPHY.weight.bold,
              cursor: 'pointer', transition: 'background 0.15s',
            }}
          >{summary}</button>
        </div>

        {waiting > 0 && (
          <p style={{
            fontSize: TYPOGRAPHY.size.sm, color: muted,
            textAlign: 'center', marginTop: SPACING.md, marginBottom: 0,
          }}>
            {waiting === 1 ? 'One more extension to review' : `${waiting} more extensions to review`}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
