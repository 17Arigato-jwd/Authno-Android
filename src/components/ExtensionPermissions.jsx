/**
 * ExtensionPermissions.jsx — what each extension may do, and what it is asking for.
 *
 * `extensionSettingsModel.buildExtensionsTab()` decides everything on this
 * screen: which rows exist, which are dimmed, what each warning says, and
 * whether a warning can be fixed here. This draws that answer and wires the
 * three things it is allowed to change — a grant, a runtime host, and an
 * unanswered install.
 *
 * The rules it is drawing, restated because they are easy to erode:
 *
 *   - **Every declared permission gets a row**, granted or not. A screen
 *     listing only what was said yes to is a screen that cannot show you what
 *     you said no to.
 *   - **A refused permission an extension keeps reaching for is surfaced.**
 *     The alternative is an extension that silently looks broken while the app
 *     knows exactly why it is not working.
 *   - **"Nobody asked you" is not "you said no."** They need different
 *     sentences and different buttons; the model separates them and so does
 *     this.
 *   - **A user-granted host is listed and revocable.** A grant you cannot see
 *     is a grant you cannot take back, and these are the ones no manifest
 *     mentions.
 *
 * Changing a grant restarts the extension. That is not a nicety — the frame's
 * Content-Security-Policy was built from the grants in force when it loaded,
 * and a document cannot be re-policied, so a revoked network permission would
 * otherwise show as off while it was still working.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DSIcons, Toggle, COLORS, RADIUS, SPACING, TYPOGRAPHY, toast } from '../DesignSystem';
import { useExtensions } from '../utils/ExtensionContext';
import { buildExtensionsTab } from '../utils/extensionSettingsModel';
import { readGrants } from '../utils/extensionGrants';
import { setGrants, hostV2 } from '../utils/extensionRuntime';
import { permissionRequests } from '../utils/permissionRequests';
import { promptPlan } from '../utils/extensionPermissionsV2';

const WARNING_TONE = {
  'permissions-unanswered': COLORS.info,
  'missing-permission': COLORS.warning,
  'too-old': COLORS.warning,
  failed: COLORS.danger,
  'bad-settings-schema': COLORS.danger,
};

function WarningRow({ warning, onFix, accentHex }) {
  const tone = WARNING_TONE[warning.kind] ?? COLORS.warning;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: SPACING.sm,
      padding: SPACING.md, borderRadius: RADIUS.md,
      background: `${tone}14`, border: `1px solid ${tone}40`,
    }}>
      <DSIcons.Warning size={15} color={tone} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: TYPOGRAPHY.size.sm, color: COLORS.textPrimary, lineHeight: 1.5 }}>
          {warning.text}
        </div>
        {/* How often, when the ledger counted it. "Once" and "two hundred
            times" are different problems and the number is the only thing
            that separates them. */}
        {warning.count > 0 && warning.count < Number.MAX_SAFE_INTEGER && (
          <div style={{ fontSize: TYPOGRAPHY.size.xs, color: COLORS.textSubtle, marginTop: 2 }}>
            {warning.prompt ? `${warning.prompt} · ` : ''}
            {warning.count === 1 ? 'once' : `${warning.count} times`}
          </div>
        )}
      </div>
      {warning.canFixHere && (
        <button
          onClick={onFix}
          style={{
            flexShrink: 0, padding: `6px ${SPACING.md}px`, borderRadius: RADIUS.sm,
            border: 'none', background: accentHex, color: 'var(--on-accent, #fff)',
            fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.bold,
            cursor: 'pointer',
          }}
        >Review</button>
      )}
    </div>
  );
}

function HostRow({ host, onRevoke }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: SPACING.sm,
      padding: `4px 0`, fontFamily: TYPOGRAPHY.mono,
      fontSize: TYPOGRAPHY.size.xs, color: COLORS.textSubtle,
    }}>
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{host}</span>
      <button
        onClick={onRevoke}
        aria-label={`Stop allowing ${host}`}
        style={{
          flexShrink: 0, padding: '3px 8px', borderRadius: RADIUS.sm,
          border: `1px solid ${COLORS.border}`, background: 'transparent',
          color: COLORS.textMuted, fontFamily: TYPOGRAPHY.sans,
          fontSize: TYPOGRAPHY.size.xs, cursor: 'pointer',
        }}
      >Remove</button>
    </div>
  );
}

export default function ExtensionPermissions({ accentHex = COLORS.violetDark }) {
  const { extensions } = useExtensions();
  const [busy, setBusy] = useState(null);
  const [, forceRender] = useState(0);

  // The permission ledger lives on the running host and changes as an
  // extension is refused things, so the warnings are only current while
  // somebody is looking. A slow tick rather than a subscription: the ledger
  // has no change event, and a refusal is not urgent enough to invent one.
  useEffect(() => {
    const t = setInterval(() => forceRender((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, []);

  const tab = useMemo(
    () => buildExtensionsTab({
      extensions,
      grantsFor: (id) => readGrants(id).granted,
      userHostsFor: (id) => readGrants(id).userHosts,
      hostFor: (id) => hostV2(id),
    }),
    // `extensions` changes identity on every refresh, which is the signal that
    // something was installed, removed or restarted.
    [extensions, busy], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const change = useCallback(async (extId, next, hosts) => {
    setBusy(extId);
    try {
      await setGrants(extId, next, hosts);
    } catch (e) {
      toast(`Could not change permissions: ${e.message}`, { variant: 'danger' });
    } finally {
      setBusy(null);
      forceRender((n) => n + 1);
    }
  }, []);

  const togglePermission = useCallback((row, permission, on) => {
    const held = new Set(readGrants(row.id).granted);
    if (on) held.add(permission); else held.delete(permission);
    return change(row.id, [...held], null);
  }, [change]);

  const revokeHost = useCallback((row, host) => {
    const { granted, userHosts } = readGrants(row.id);
    return change(row.id, granted, userHosts.filter((h) => h !== host));
  }, [change]);

  /**
   * Put the questions that were never asked.
   *
   * The same queue and the same sheet the install would have used, so there is
   * one dialog and one set of words for this — rather than a second, subtly
   * different screen that exists only because the first one was missed.
   */
  const review = useCallback((row) => {
    const manifest = extensions.find((e) => e.id === row.id);
    if (!manifest) return;
    const held = readGrants(row.id).granted;
    const plan = promptPlan(manifest.permissions, held);
    permissionRequests()
      .ask(row.id, plan, { name: row.name, version: row.version, icon: row.icon })
      .then((answered) => change(row.id, answered, null))
      .catch(() => { /* the queue was full; the warning stays and can be retried */ });
  }, [extensions, change]);

  if (!tab.exists) return null;

  // Nothing to say about an extension that declared no permissions and is
  // behaving. Filtering here rather than in the model because the model's job
  // is the whole list; this section is only the part with something to show.
  const rows = tab.rows.filter((r) => r.permissions.length > 0 || r.warnings.length > 0);
  if (rows.length === 0) return null;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: SPACING.sm }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: SPACING.sm,
        fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.bold,
        letterSpacing: TYPOGRAPHY.tracking.wide, textTransform: 'uppercase',
        color: COLORS.textSubtle, padding: `0 ${SPACING.xs}px`,
      }}>
        Permissions
        {tab.needsAttention > 0 && (
          <span style={{
            padding: '1px 6px', borderRadius: RADIUS.full,
            background: COLORS.warningSoft, color: COLORS.warning,
            fontSize: TYPOGRAPHY.size.xs,
          }}>{tab.needsAttention}</span>
        )}
      </div>

      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            borderRadius: RADIUS.lg, border: `1px solid ${COLORS.border}`,
            background: 'var(--surface, rgba(255,255,255,0.02))',
            padding: SPACING.md,
            display: 'flex', flexDirection: 'column', gap: SPACING.sm,
            // Dimmed as one piece, icon included. A row greyed with a bright
            // icon reads as a rendering bug rather than as "not running".
            opacity: row.dimmed ? 0.55 : 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACING.sm }}>
            <span style={{
              fontSize: TYPOGRAPHY.size.base, fontWeight: TYPOGRAPHY.weight.bold,
              color: COLORS.textPrimary,
            }}>{row.name}</span>
            <span style={{ fontSize: TYPOGRAPHY.size.xs, color: COLORS.textSubtle }}>
              {row.version}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{
              fontSize: TYPOGRAPHY.size.xs,
              color: row.running ? COLORS.success : COLORS.textSubtle,
            }}>{row.running ? 'running' : (row.blocked ?? 'stopped')}</span>
          </div>

          {row.warnings.map((w, i) => (
            <WarningRow
              key={`${w.kind}-${w.permission ?? i}`}
              warning={w}
              accentHex={accentHex}
              onFix={() => review(row)}
            />
          ))}

          {row.permissions.map((p) => (
            <div key={p.permission} style={{
              display: 'flex', alignItems: 'flex-start', gap: SPACING.md,
              paddingTop: SPACING.xs,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: TYPOGRAPHY.size.sm, color: COLORS.textPrimary,
                  fontWeight: TYPOGRAPHY.weight.medium,
                }}>
                  {p.prompt}
                  {p.inert && (
                    <span style={{ color: COLORS.textSubtle, fontWeight: TYPOGRAPHY.weight.normal }}>
                      {' '}· not in this version
                    </span>
                  )}
                </div>
                {p.reason && (
                  <div style={{
                    fontSize: TYPOGRAPHY.size.xs, color: COLORS.textSubtle,
                    lineHeight: 1.5, marginTop: 2,
                  }}>&ldquo;{p.reason}&rdquo;</div>
                )}

                {/* Two lists, and the labels are what tells them apart.
                    Unlabelled they run together into one column of grey
                    monospace, and the difference between them is the whole
                    point: the first is what the author declared and the
                    permission covers, the second is what somebody typed in —
                    and only the second can be taken back here. */}
                {(p.hosts?.length > 0 || p.userHosts?.length > 0) && (
                  <div style={{
                    marginTop: SPACING.sm,
                    borderLeft: `2px solid ${COLORS.border}`,
                    paddingLeft: SPACING.sm,
                    display: 'flex', flexDirection: 'column', gap: SPACING.sm,
                  }}>
                    {p.hosts?.length > 0 && (
                      <div>
                        <div style={{
                          fontSize: TYPOGRAPHY.size.xs, color: COLORS.textSubtle,
                          textTransform: 'uppercase', letterSpacing: TYPOGRAPHY.tracking.wide,
                          marginBottom: 3,
                        }}>Declared by the extension</div>
                        {p.hosts.map((h) => (
                          <div key={h} style={{
                            fontFamily: TYPOGRAPHY.mono, fontSize: TYPOGRAPHY.size.xs,
                            color: COLORS.textSubtle, wordBreak: 'break-all', padding: '1px 0',
                          }}>{h}</div>
                        ))}
                      </div>
                    )}
                    {p.userHosts?.length > 0 && (
                      <div>
                        <div style={{
                          fontSize: TYPOGRAPHY.size.xs, color: COLORS.textSubtle,
                          textTransform: 'uppercase', letterSpacing: TYPOGRAPHY.tracking.wide,
                          marginBottom: 3,
                        }}>Added by you</div>
                        {p.userHosts.map((h) => (
                          <HostRow key={h} host={h} onRevoke={() => revokeHost(row, h)} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Toggle
                on={p.granted}
                disabled={p.inert || busy === row.id}
                onChange={() => togglePermission(row, p.permission, !p.granted)}
                accentHex={accentHex}
                size="sm"
                ariaLabel={`${p.granted ? 'Allow' : 'Do not allow'}: ${p.prompt}`}
                style={{ flexShrink: 0 }}
              />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
