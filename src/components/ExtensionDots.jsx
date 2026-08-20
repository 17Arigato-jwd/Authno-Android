/**
 * ExtensionDots.jsx — what is running, in the corner.
 *
 * The shape Android uses for the microphone and camera: a small coloured dot
 * that appears when something is active, sits out of the way, and tells you
 * more when you tap it. It is a good shape to borrow because it answers the
 * only question a person actually has — *is something running right now* —
 * without answering it at the cost of the thing they were doing.
 *
 * ── Three rules the model owns, not this component ──────────────────────────
 *
 * `extensionSurfaces.js` decides which dots exist, what colour each is, and
 * how many to show before collapsing to `+n`. This draws the answer. That
 * split is why the rules are testable at all, and it is worth not eroding:
 * anything here that starts deciding rather than drawing belongs there.
 *
 * ── What this component owns ────────────────────────────────────────────────
 *
 * **Never colour alone.** A dot that only differs by hue tells a
 * colour-blind reader nothing, and there are eight accent hues in rotation.
 * Every dot carries an accessible name, the row is a real button, and tapping
 * opens a sheet that names each extension in words.
 *
 * **A 48dp target around an 8dp dot.** The model carries both numbers so this
 * cannot quietly use the visual size for both — which is how you get an
 * indicator nobody can hit.
 *
 * **Out of the writer's way.** Bottom-trailing, above the safe area, and
 * `pointer-events: none` on everything except the button itself, so the
 * indicator never eats a tap meant for the text beneath it.
 */

import { useEffect, useState, useCallback } from 'react';
import { BottomSheet, COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../DesignSystem';
import { surfaces } from '../utils/extensionSurfaces';

export default function ExtensionDots({ hidden = false }) {
  const [, forceRender] = useState(0);
  const [open, setOpen] = useState(false);

  // Subscribe rather than construct: the singleton already exists by the time
  // the editor mounts, because the first extension to set an overlay creates
  // it — and that happens at activation.
  useEffect(() => surfaces().subscribe(() => forceRender((n) => n + 1)), []);

  const { shown, overflow, total } = surfaces().dots();

  const close = useCallback(() => setOpen(false), []);

  // Closing on its own when the last extension stops. A sheet listing nothing,
  // left up because the thing it described ended, is a dead end.
  useEffect(() => { if (total === 0) setOpen(false); }, [total]);

  if (total === 0 || hidden) return null;

  const label = total === 1
    ? `1 extension is doing something`
    : `${total} extensions are doing something`;

  return (
    <>
      <div
        style={{
          position: 'fixed',
          right: `calc(${SPACING.md}px + env(safe-area-inset-right, 0px))`,
          bottom: `calc(${SPACING.md}px + env(safe-area-inset-bottom, 0px))`,
          zIndex: 120,
          // The wrapper never takes a tap. Only the button below does, and it
          // is the only thing here big enough to be worth hitting.
          pointerEvents: 'none',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={label}
          title={label}
          style={{
            pointerEvents: 'auto',
            // 48dp of target around dots that draw at 8. The model carries
            // both so this cannot conflate them.
            minWidth: 48, minHeight: 48,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: `0 ${SPACING.sm}px`,
            border: 'none', borderRadius: RADIUS.full,
            background: 'rgba(0,0,0,0.42)',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            cursor: 'pointer',
            animation: 'authnoDotIn 0.22s ease',
          }}
        >
          <style>{`
            @keyframes authnoDotIn { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: none; } }
            @media (prefers-reduced-motion: reduce) { @keyframes authnoDotIn { from { opacity: 1; } to { opacity: 1; } } }
          `}</style>

          {shown.map((d) => (
            <span
              key={d.extId}
              // The dot is decoration; the button carries the name. Marking it
              // presentational stops a screen reader reading eight anonymous
              // bullets before the sentence that explains them.
              aria-hidden="true"
              style={{
                width: d.sizeDp, height: d.sizeDp, borderRadius: '50%',
                background: d.colour, flexShrink: 0,
                boxShadow: `0 0 6px ${d.colour}aa`,
              }}
            />
          ))}

          {overflow > 0 && (
            <span aria-hidden="true" style={{
              fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.bold,
              color: COLORS.textMuted, marginLeft: 1,
            }}>+{overflow}</span>
          )}
        </button>
      </div>

      <BottomSheet isOpen={open} onClose={close} title="Running now" maxWidth="480px">
        <div style={{ padding: `0 ${SPACING.lg}px ${SPACING.lg}px` }}>
          {/* Every dot, in words. This is the answer to "what is that dot". */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.sm }}>
            {surfaces().dots().shown.map((d) => (
              <div key={d.extId} style={{
                display: 'flex', alignItems: 'flex-start', gap: SPACING.md,
                padding: SPACING.md, borderRadius: RADIUS.lg,
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${COLORS.border}`,
              }}>
                <span aria-hidden="true" style={{
                  width: 10, height: 10, borderRadius: '50%', marginTop: 5,
                  background: d.colour, flexShrink: 0,
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: TYPOGRAPHY.size.base,
                    fontWeight: TYPOGRAPHY.weight.semibold,
                    color: COLORS.textPrimary,
                  }}>{d.extId}</div>
                  <div style={{
                    fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle,
                    lineHeight: 1.5, marginTop: 2,
                  }}>{d.text}</div>
                </div>
              </div>
            ))}
          </div>

          {overflow > 0 && (
            <p style={{
              fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle,
              marginTop: SPACING.md, marginBottom: 0,
            }}>
              {overflow === 1
                ? 'One more extension is running.'
                : `${overflow} more extensions are running.`}
            </p>
          )}

          <p style={{
            fontSize: TYPOGRAPHY.size.sm, color: COLORS.textSubtle,
            marginTop: SPACING.lg, marginBottom: 0,
          }}>
            Each line is written by the extension itself.
          </p>
        </div>
      </BottomSheet>
    </>
  );
}
