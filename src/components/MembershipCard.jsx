/**
 * MembershipCard.jsx — who you are inside the closed beta.
 *
 * Shows the pen name the access key was issued to, the member sigil derived
 * from the user id, generation depth and the signed trial deadline. Rendered
 * in Settings → About, and only when the build is invite-gated — an un-gated
 * beta has no membership to describe.
 *
 * Read-only by design: there is no "sign out" and no way to clear the key from
 * here. Removing access would do nothing useful (the books stay either way)
 * and everything harmful (a fumbled tap costs someone their key).
 */

import { useEffect, useState } from 'react';
import { DSIcons } from '../DesignSystem';
import { isGateRequired, verifyStoredAccess, trialEndsFrom, trialDaysLeftFrom } from '../utils/access';
import { designFromSeed, sigilDataUri, seedFromUserId } from '../utils/sigil';

export default function MembershipCard({ accentHex = '#5a00d9' }) {
  const [member, setMember] = useState(null);
  const [sigil, setSigil] = useState(null);

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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: 16,
      borderRadius: 14, marginBottom: 20,
      background: 'var(--surface)', border: `1px solid ${accentHex}44`,
    }}>
      {sigil
        ? <img src={sigil} alt="" width={48} height={48} style={{ borderRadius: 12, flexShrink: 0, display: 'block' }} />
        : <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--surface-md)', flexShrink: 0 }} />}

      <div style={{ flex: 1, minWidth: 0 }}>
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
    </div>
  );
}
