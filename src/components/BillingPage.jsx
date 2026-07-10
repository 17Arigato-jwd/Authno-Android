/**
 * BillingPage.jsx — Pro upgrade / billing screen (MOCK — instruction 11).
 *
 * IMPORTANT: This is a front-end simulation only. There is NO backend, NO
 * payment gateway, and NO real charge. Submitting either payment method runs a
 * fake "processing" animation, then calls unlockProMock() to flip the local
 * entitlement to Pro so the Pro UI can be tested. A UPI option is provided
 * alongside card, as requested.
 *
 * When real Google Play Billing is added, replace handlePay() and remove the
 * mock banner — the rest of the UI can stay.
 */

import { useState, useEffect } from 'react';
import { unlockProMock, resetToFree } from '../utils/entitlements';
import { useEntitlement } from '../utils/useEntitlement';
import { DSIcons, CloseButton } from '../DesignSystem';

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
  'Unlimited books & chapters',
  'Custom downloadable themes (.thmbk)',
  'Advanced export options',
  'Priority extension features',
  'Support independent development',
];

const PLANS = [
  { id: 'monthly', label: 'Monthly', price: '₹149', per: '/month', note: '' },
  { id: 'yearly',  label: 'Yearly',  price: '₹1,199', per: '/year', note: 'Save 33%' },
  { id: 'lifetime',label: 'Lifetime',price: '₹2,999', per: 'once',  note: 'Best value' },
];

export default function BillingPage({ accentHex = '#5a00d9', onClose }) {
  const { isPro } = useEntitlement();
  const wide = useWideLayout();
  const [plan, setPlan] = useState('yearly');
  const [method, setMethod] = useState('upi');       // 'upi' | 'card'
  const [status, setStatus] = useState('idle');       // idle | processing | success
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

  if (isPro && status !== 'success') {
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
      <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)', margin: '0 0 14px' }}>Everything in Pro</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {PRO_FEATURES.map((f) => (
          <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', color: 'var(--text-2)', fontSize: 14 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accentHex} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}><polyline points="20 6 9 17 4 12" /></svg>
            {f}
          </li>
        ))}
      </ul>
    </div>
  );

  const paymentColumn = (
    <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
      {/* Plans */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {PLANS.map((p) => {
          const active = plan === p.id;
          return (
            <button key={p.id} onClick={() => setPlan(p.id)}
              style={{
                flex: 1, padding: '12px 8px', borderRadius: 14, cursor: 'pointer', textAlign: 'center',
                background: active ? `${accentHex}18` : 'var(--surface)',
                border: `1.5px solid ${active ? accentHex : 'var(--border)'}`,
                transition: 'all 0.12s',
              }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>{p.label}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-1)', marginTop: 3 }}>{p.price}</div>
              <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{p.per}</div>
              {p.note ? <div style={{ fontSize: 10.5, color: accentHex, fontWeight: 700, marginTop: 4 }}>{p.note}</div> : null}
            </button>
          );
        })}
      </div>

      {/* Payment method toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <MethodTab active={method === 'upi'} onClick={() => setMethod('upi')} label="UPI" accentHex={accentHex} />
        <MethodTab active={method === 'card'} onClick={() => setMethod('card')} label="Card" accentHex={accentHex} />
      </div>

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
        {status === 'processing' ? (<><Spinner /> Processing…</>) : `Pay ${PLANS.find(p => p.id === plan)?.price} with ${method === 'upi' ? 'UPI' : 'Card'}`}
      </button>
      <p style={{ fontSize: 11, color: 'var(--text-5)', textAlign: 'center', marginTop: 12 }}>Simulated secure checkout · no real charge</p>
    </div>
  );

  return (
    <Screen accentHex={accentHex} onClose={onClose} title="Upgrade to Pro" wide={wide}>
      {/* Mock banner — makes clear no real charge occurs */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 12px', borderRadius: 10, background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', marginBottom: 20 }}>
        <DSIcons.Flask size={16} color="var(--color-warning)" />
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Demo checkout — no real payment is processed. Submitting unlocks Pro locally for testing.</span>
      </div>

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
