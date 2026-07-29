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
  trialEndsFrom, trialDaysLeftFrom, getStoredAccess,
} from '../utils/access';
import { designFromSeed, sigilDataUri, seedFromUserId } from '../utils/sigil';
import { googleAvailable, googleFlow } from '../utils/googleAuth';

import { gateErrorText } from '../utils/gateApi';

export default function MembershipCard({ accentHex = '#5a00d9', onSignOut }) {
  const [member, setMember] = useState(null);
  const [sigil, setSigil] = useState(null);
  const [confirming, setConfirming] = useState(false);

  /* Connecting Google to an account that already exists. The app holds no
     session — it keeps a signed device key and drops session tokens on the
     floor — so the link authenticates with that key rather than asking for a
     password the app has no reason to want again. */
  const [googleOn, setGoogleOn] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleDone, setGoogleDone] = useState(false);
  const [googleErr, setGoogleErr] = useState(null);
  useEffect(() => { let live = true; googleAvailable().then((v) => { if (live) setGoogleOn(v); }); return () => { live = false; }; }, []);

  const connectGoogle = useCallback(async () => {
    setGoogleBusy(true);
    setGoogleErr(null);
    try {
      await googleFlow('link', { accessKey: getStoredAccess()?.key });
      setGoogleDone(true);
    } catch (e) {
      const reason = e?.code || e?.message || 'unknown';
      if (reason !== 'cancelled') setGoogleErr(gateErrorText(reason));
    } finally {
      setGoogleBusy(false);
    }
  }, []);

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

      {googleOn && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-sm)' }}>
          {googleDone ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <DSIcons.Check size={13} />
              Google is connected. You can sign in with it next time.
            </div>
          ) : (
            <button
              onClick={connectGoogle}
              disabled={googleBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '9px 14px', borderRadius: 10, cursor: googleBusy ? 'default' : 'pointer',
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
                opacity: googleBusy ? 0.5 : 1,
              }}
            >
              <GoogleMark />
              {googleBusy ? 'Waiting for Google…' : 'Connect a Google account'}
            </button>
          )}
          {googleErr && (
            <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8, lineHeight: 1.5 }}>{googleErr}</div>
          )}
        </div>
      )}

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

/** Google's mark, inline — no remote image on a screen that must work offline. */
function GoogleMark({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.6c0-1.6-.1-2.8-.4-4.1H24v7.4h12.9c-.3 2.2-1.7 5.4-4.8 7.6l7.6 5.9c4.5-4.2 6.8-10.3 6.8-16.8z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2 1.4-4.8 2.4-8.3 2.4-6.4 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
