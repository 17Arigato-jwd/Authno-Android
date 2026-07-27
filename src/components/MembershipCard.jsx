/**
 * MembershipCard.jsx — who you are inside the closed beta.
 *
 * Shows the pen name the access key was issued to, the member sigil derived
 * from the user id, generation depth and the signed trial deadline. Rendered
 * in Settings → About, and only when the build is invite-gated — an un-gated
 * beta has no membership to describe.
 *
 * Signing out is here because a shared machine needs it: one writer has to be
 * able to hand the app to another. The fumbled-tap risk is real, so it sits
 * behind a dialog that states plainly what it does and doesn't cost — books
 * are untouched, and getting back in needs the key file again.
 */

import { useCallback, useEffect, useState } from 'react';
import { DSIcons } from '../DesignSystem';
import { ConfirmDialog } from './ConfirmDialog';
import {
  isGateRequired, verifyStoredAccess, clearStoredAccess, resetAttempts,
  trialEndsFrom, trialDaysLeftFrom,
} from '../utils/access';
import { designFromSeed, sigilDataUri, seedFromUserId } from '../utils/sigil';

export default function MembershipCard({ accentHex = '#5a00d9', onSignOut }) {
  const [member, setMember] = useState(null);
  const [sigil, setSigil] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const signOut = useCallback(() => {
    // Clear the key, not the library. Attempts reset too: signing out
    // deliberately is not a failed sign-in, so the next person shouldn't
    // inherit a cooldown someone else earned.
    //
    // App.js re-raises the gate rather than us reloading the window — a reload
    // would drop editor state that hasn't been flushed to the sessions array
    // yet, which would make signing out cost words. It must never cost words.
    clearStoredAccess();
    resetAttempts();
    setConfirming(false);
    onSignOut?.();
  }, [onSignOut]);

  useEffect(() => {
    if (!isGateRequired()) return undefined;
    let cancelled = false;
    (async () => {
      const payload = await verifyStoredAccess();
      if (cancelled || !payload) return;
      setMember(payload);
      try {
        const seed = await seedFromUserId(payload.uid);
        if (!cancelled) setSigil(sigilDataUri(designFromSeed(seed), 96));
      } catch { /* the card reads fine without the mark */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!member) return null;

  const daysLeft = trialDaysLeftFrom(member);
  const endsAt = trialEndsFrom(member);
  const trialLine = daysLeft > 0
    ? `Everything unlocked for ${daysLeft} more ${daysLeft === 1 ? 'day' : 'days'}`
    : endsAt
      ? `Trial ended ${new Date(endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
      : 'Invited member';

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: 16,
        borderRadius: 14, marginBottom: 20, flexWrap: 'wrap',
        background: 'var(--surface)', border: `1px solid ${accentHex}44`,
      }}>
        {sigil
          ? <img src={sigil} alt="" width={48} height={48} style={{ borderRadius: 12, flexShrink: 0, display: 'block' }} />
          : <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--surface-md)', flexShrink: 0 }} />}

        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {member.u}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 2 }}>
            {trialLine}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
            <DSIcons.Key size={11} />
            Generation {member.gen ?? 0}
            {member.q ? ` · ${member.q} invites to give` : ''}
          </div>
        </div>

        {/* Only offered when a host can actually act on it — no dead buttons. */}
        {typeof onSignOut === 'function' && (
        <button
          onClick={() => setConfirming(true)}
          style={{
            flexShrink: 0, padding: '7px 14px', borderRadius: 9, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-3)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
          }}
        >
          Sign out
        </button>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Sign out of ${member.u}?`}
        accentHex={accentHex}
        confirmLabel="Sign out"
        onCancel={() => setConfirming(false)}
        onConfirm={signOut}
        body={
          <>
            <p style={{ margin: '0 0 10px' }}>
              AuthNo will ask for a key file again, and you can sign in as
              anyone — this or a different account.
            </p>
            <p style={{ margin: 0 }}>
              <b>Your books stay exactly where they are.</b> Nothing on this
              device is deleted, and the sign-in screen can still export them
              even if you never sign back in.
            </p>
          </>
        }
      />
    </>
  );
}
