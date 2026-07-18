/**
 * BillingPage.jsx — Pro one-time purchase screen (MOCK — instruction 11).
 *
 * IMPORTANT: This is a front-end simulation only. There is NO backend, NO
 * payment gateway, and NO real charge. Submitting either payment method runs a
 * fake "processing" animation, then calls unlockProMock() to flip the local
 * entitlement to Pro so the Pro UI can be tested. A UPI option is provided
 * alongside card for the India region.
 *
 * Monetization model (next release): single one-time purchase (₹2,999.99 in
 * India, regional equivalents elsewhere — see utils/pricing.js) preceded by a
 * 7-day free trial started at onboarding completion. The timeline block shows
 * Day 1 (unlocked) / Day 5 (reminder) / Day 7 (first charge).
 *
 * When real Google Play Billing is added, replace handlePay() and the pricing
 * lookup and remove the mock banner — the rest of the UI can stay.
 */

import { useState, useEffect, useMemo } from 'react';
import { unlockProMock, resetToFree } from '../utils/entitlements';
import { useEntitlement } from '../utils/useEntitlement';
import { getOneTimePrice } from '../utils/pricing';
import { DSIcons, CloseButton } from '../DesignSystem';
import { hapticSelect } from '../utils/haptics';

// Desktop = a centered dialog with a two-column layout; mobile/portrait = a
// full-screen sheet with a single column. This is the "not optimised for PC" fix.
function useWideLayout() {
  const compute = () => typeof window !== 'undefined' && window.innerWidth >= 880 && window.innerWidth > window.innerHeight;
  const [wide, setWide] = useState(compute);
  useEffect(() => {
    const f = () => setWide(compute());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return wide;
}

const PRO_FEATURES = [
  { t: 'Unlimited books & chapters', s: 'Write as much as you like, no caps' },
  { t: 'Custom downloadable themes', s: 'Install and make your own .thmbk packs' },
  { t: 'Advanced export', s: 'EPUB, PDF and more, with fine control' },
  { t: 'Priority extension features', s: 'First access to new tools as they ship' },
];

export default function BillingPage({ accentHex = '#5a00d9', onClose }) {
  const { tier, isTrial, trialDaysLeft } = useEntitlement();
  const wide = useWideLayout();
  const price = useMemo(() => getOneTimePrice(), []);
  const upiAvailable = price.currency === 'INR';
  const [method, setMethod] = useState(upiAvailable ? 'upi' : 'card'); // 'upi' | 'card'
  const [status, setStatus] = useState('idle');       // idle | processing | success
  const [revealed, setRevealed] = useState(false);    // payment stays hidden behind "Try now"
  const [upiId, setUpiId] = useState('');
  const [card, setCard] = useState({ number: '', name: '', expiry: '', cvv: '' });

  const canPay = method === 'upi'
    ? /^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(upiId.trim())
    : card.number.replace(/\s/g, '').length >= 12 && card.name.trim() && /^\d{2}\/\d{2}$/.test(card.expiry) && card.cvv.length >= 3;

  const handlePay = () => {
    if (!canPay || status !== 'idle') return;
    setStatus('processing');
    // Simulated processing → success. No real transaction occurs.
    setTimeout(() => {
      setStatus('success');
      unlockProMock();
      setTimeout(() => { onClose?.(); }, 1600);
    }, 1600);
  };

  if (tier === 'pro' && status !== 'success') {
    return (
      <Screen accentHex={accentHex} onClose={onClose} title="Authno Pro" wide={wide}>
        <div style={{ textAlign: 'center', padding: '32px 16px' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px', background: `${accentHex}18`, border: `1px solid ${accentHex}55`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <StarIcon color={accentHex} size={30} />
          </div>
          <h2 style={{ margin: '0 0 6px', color: 'var(--text-1)' }}>You’re on Pro</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14, margin: '0 0 24px' }}>All Pro features are unlocked. Thank you for the support.</p>
          <button onClick={resetToFree}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-3)', fontSize: 13, cursor: 'pointer' }}>
            Reset to Free (testing)
          </button>
        </div>
      </Screen>
    );
  }

  const featureColumn = (
    <div style={{ flex: wide ? '0 0 300px' : 'auto', width: wide ? 300 : '100%' }}>
      <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 14px' }}>What you unlock</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {PRO_FEATURES.map((f) => (
          <li key={f.t} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{
              width: 24, height: 24, borderRadius: 7, flexShrink: 0, marginTop: 1,
              background: 'var(--color-success-bg, rgba(34,197,94,0.1))',
              border: '1px solid var(--color-success, #22c55e)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-success, #22c55e)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)' }}>{f.t}</div>
              <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 1 }}>{f.s}</div>
            </div>
          </li>
        ))}
      </ul>

      {/* The heart of it — this purchase keeps one person's indie app alive.
          Given its own emphasized card so it reads as the real reason, not a
          bullet lost in a feature list. */}
      <SoloDevCallout accentHex={accentHex} />
    </div>
  );

  const paymentColumn = (
    <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
      {/* One-time purchase price card */}
      <div style={{
        padding: '16px 18px', borderRadius: 14, marginBottom: 20,
        background: `${accentHex}12`, border: `1.5px solid ${accentHex}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>One-time purchase</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>Pay once. Yours forever. No subscription.</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-1)' }}>{price.formatted}</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>once</div>
        </div>
      </div>

      {!revealed ? (
        // Payment is hidden until the user chooses to start. The trial is the
        // headline action; the card/UPI form only appears once they tap in.
        <div>
          <button
            onClick={() => { hapticSelect(); setRevealed(true); }}
            style={{
              width: '100%', padding: '15px 0', borderRadius: 14, border: 'none',
              background: accentHex, color: '#fff', fontSize: 15.5, fontWeight: 800,
              cursor: 'pointer', boxShadow: `0 8px 22px ${accentHex}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            }}>
            <DSIcons.Gift size={19} color="#fff" /> Try now — free for 7 days
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-4)', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
            Nothing is charged today. You'll only pay {price.formatted}, once, if you're still here after day 7 —
            {upiAvailable ? ' UPI or card' : ' card'}, your choice.
          </p>
        </div>
      ) : (
        <>
          {/* Payment method toggle — UPI is India-only */}
          {upiAvailable && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <MethodTab active={method === 'upi'} onClick={() => setMethod('upi')} label="UPI" accentHex={accentHex} />
              <MethodTab active={method === 'card'} onClick={() => setMethod('card')} label="Card" accentHex={accentHex} />
            </div>
          )}

          {method === 'upi' ? (
            <div style={{ marginBottom: 20 }}>
              <Label>UPI ID</Label>
              <input
                value={upiId} onChange={(e) => setUpiId(e.target.value)}
                placeholder="yourname@bank" autoCapitalize="none" autoCorrect="off"
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {['@oksbi', '@okhdfcbank', '@okaxis', '@ybl', '@paytm'].map(s => (
                  <button key={s} onClick={() => setUpiId((v) => (v.split('@')[0] || 'name') + s)}
                    style={{ fontSize: 11.5, padding: '5px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-3)', cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 10 }}>You’ll receive a collect request in your UPI app (simulated).</p>
            </div>
          ) : (
            <div style={{ marginBottom: 20, display: 'grid', gap: 10 }}>
              <div>
                <Label>Card number</Label>
                <input value={card.number} onChange={(e) => setCard({ ...card, number: formatCard(e.target.value) })} placeholder="1234 5678 9012 3456" inputMode="numeric" style={inputStyle} />
              </div>
              <div>
                <Label>Name on card</Label>
                <input value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} placeholder="Full name" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Label>Expiry</Label>
                  <input value={card.expiry} onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })} placeholder="MM/YY" inputMode="numeric" style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <Label>CVV</Label>
                  <input value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="•••" inputMode="numeric" style={inputStyle} />
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handlePay} disabled={!canPay || status === 'processing'}
            style={{
              width: '100%', padding: '14px 0', borderRadius: 14, border: 'none',
              background: canPay ? accentHex : 'var(--surface-md)',
              color: canPay ? '#fff' : 'var(--text-5)',
              fontSize: 15, fontWeight: 800, cursor: canPay && status === 'idle' ? 'pointer' : 'default',
              boxShadow: canPay ? `0 6px 18px ${accentHex}55` : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {status === 'processing' ? (<><Spinner /> Processing…</>) : `Start trial with ${method === 'upi' ? 'UPI' : 'Card'}`}
          </button>
          <p style={{ fontSize: 11, color: 'var(--text-5)', textAlign: 'center', marginTop: 12 }}>
            Free for 7 days, then {price.formatted} once · simulated · no real charge
          </p>
        </>
      )}
    </div>
  );

  return (
    <Screen accentHex={accentHex} onClose={onClose} title="Upgrade to Pro" wide={wide}>
      {/* Mock banner — makes clear no real charge occurs */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 12px', borderRadius: 10, background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', marginBottom: 20 }}>
        <DSIcons.Flask size={16} color="var(--color-warning)" />
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Demo checkout — no real payment is processed. Submitting unlocks Pro locally for testing.</span>
      </div>

      {status !== 'success' && (
        <div style={{ marginBottom: 24 }}>
          {/* Green trial chip + headline — prototype design */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 999, marginBottom: 12,
            background: 'var(--color-success-bg, rgba(34,197,94,0.1))',
            border: '1px solid var(--color-success, #22c55e)',
            fontSize: 10.5, fontWeight: 800, letterSpacing: 1.3, textTransform: 'uppercase',
            color: 'var(--color-success, #22c55e)',
          }}>
            <StarIcon color="var(--color-success, #22c55e)" size={11} />
            Your 7-day free trial{isTrial ? ` · ${trialDaysLeft} ${trialDaysLeft === 1 ? 'day' : 'days'} left` : ''}
          </span>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.4, color: 'var(--text-1)', margin: '0 0 8px' }}>
            Try Pro free, then pay once.
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-3)', lineHeight: 1.6, margin: '0 0 20px' }}>
            Here's how the trial works and everything it unlocks. It's a single purchase, never a subscription.
          </p>
          <TrialTimeline accentHex={accentHex} price={price.formatted} />
        </div>
      )}

      {status === 'success' ? (
        <div style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', margin: '0 auto 18px', background: 'var(--color-success-bg)', border: '1px solid var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h2 style={{ margin: '0 0 6px', color: 'var(--text-1)' }}>Payment successful</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Pro features are now unlocked.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', gap: wide ? 36 : 24, alignItems: 'flex-start' }}>
          {featureColumn}
          {paymentColumn}
        </div>
      )}
    </Screen>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────

/**
 * TrialTimeline — the horizontal Day 1 / Day 5 / Day 7 rail from the
 * prototype: three circled milestone icons joined by a line, day labels
 * beneath, then a bold title and a one-line sub per milestone.
 */
function TrialTimeline({ accentHex, price }) {
  const MILESTONES = [
    {
      day: 'DAY 1 · TODAY',
      title: 'Unlocked',
      body: 'Full Pro access, right now',
      color: 'var(--color-success, #22c55e)',
      fill: true,
      icon: (c) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </svg>
      ),
    },
    {
      day: 'DAY 5',
      title: 'Reminder',
      body: "We'll nudge you before it ends",
      color: 'var(--text-4)',
      icon: (c) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      ),
    },
    {
      day: 'DAY 7',
      title: `First charge`,
      body: `${price} — only if you stay`,
      color: accentHex,
      icon: (c) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      ),
    },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 16px' }}>
        How your free trial works
      </h2>
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {/* connecting line behind the milestone circles */}
        <div style={{ position: 'absolute', top: 17, left: 'calc(16.66% + 18px)', right: 'calc(16.66% + 18px)', height: 2, background: 'var(--border)' }} />
        {MILESTONES.map((m) => (
          <div key={m.day} style={{ textAlign: 'center', position: 'relative' }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', margin: '0 auto 8px',
              background: m.fill ? 'var(--color-success-bg, rgba(34,197,94,0.12))' : 'var(--modal-bg)',
              border: `2px solid ${m.color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {m.icon(m.color)}
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: m.color, marginBottom: 3 }}>{m.day}</div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-1)', marginBottom: 2 }}>{m.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.4 }}>{m.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SoloDevCallout — the "you're keeping one person's app alive" block. Deliberately
 * warmer and more prominent than the feature bullets: a soft accent-tinted card
 * with a heart, so the human reason to buy doesn't read like just another perk.
 */
function SoloDevCallout({ accentHex }) {
  return (
    <div style={{
      marginTop: 18, padding: '14px 15px', borderRadius: 14,
      background: `${accentHex}12`, border: `1px solid ${accentHex}44`,
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 9, flexShrink: 0, marginTop: 1,
        background: `${accentHex}22`, border: `1px solid ${accentHex}66`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <DSIcons.HeartFill size={15} color={accentHex} />
      </span>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-1)', marginBottom: 2 }}>
          You're supporting a solo developer
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55 }}>
          AuthNo is built and maintained by one person — no investors, no ads, no
          selling your writing. Going Pro is what keeps an independent, offline-first
          app going.
        </div>
      </div>
    </div>
  );
}

function Screen({ children, accentHex, onClose, title, wide }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2600,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--modal-overlay-bg, rgba(0,0,0,0.75))', backdropFilter: 'blur(6px)',
        padding: wide ? '24px' : '0',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        display: 'flex', flexDirection: 'column',
        width: wide ? 'min(940px, 96vw)' : '100vw',
        height: wide ? 'auto' : '100dvh',
        maxHeight: wide ? '90vh' : '100dvh',
        background: 'var(--modal-bg)',
        border: wide ? '1px solid var(--border)' : 'none',
        borderRadius: wide ? 20 : 0,
        overflow: 'hidden',
        boxShadow: wide ? `0 32px 80px rgba(0,0,0,0.5), 0 0 80px ${accentHex}14` : 'none',
      }}>
        {/* Sticky header — the close button no longer scrolls away */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--modal-bg)', flexShrink: 0 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{title}</h1>
          <CloseButton onClick={onClose} />
        </div>
        {/* Scroll body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: wide ? '24px 28px max(24px, env(safe-area-inset-bottom))' : '18px 18px max(24px, env(safe-area-inset-bottom))' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function MethodTab({ active, onClick, label, accentHex }) {
  return (
    <button onClick={onClick}
      style={{
        flex: 1, padding: '10px 0', borderRadius: 12, cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
        background: active ? `${accentHex}18` : 'var(--surface)',
        border: `1.5px solid ${active ? accentHex : 'var(--border)'}`,
        color: active ? 'var(--text-1)' : 'var(--text-3)',
      }}>
      {label}
    </button>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10,
  background: 'var(--input-bg)', border: '1px solid var(--input-border)',
  color: 'var(--text-1)', fontSize: 14, outline: 'none',
};

function Label({ children }) {
  return <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, marginBottom: 6 }}>{children}</div>;
}

function Spinner() {
  return (
    <span style={{ width: 15, height: 15, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'ra-spin 0.7s linear infinite' }}>
      <style>{'@keyframes ra-spin{to{transform:rotate(360deg)}}'}</style>
    </span>
  );
}

function StarIcon({ color, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function formatCard(v) {
  return v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}
function formatExpiry(v) {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}
