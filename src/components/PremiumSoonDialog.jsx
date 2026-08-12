/**
 * PremiumSoonDialog.jsx — what a locked Pro feature shows while purchasing is
 * not yet available.
 *
 * Billing is intentionally switched off for now (no gateway is live), so rather
 * than open a checkout the app is honest: the feature is premium, purchasing
 * isn't open yet, and nothing is being sold today. This replaces BillingPage as
 * the target of openBilling() — every existing Pro gate routes here, so there's
 * no path that can surface a checkout the user can't complete.
 *
 * During the 7-day trial isPro() is true, so this never appears; it's what a
 * user meets after the trial lapses.
 */

import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { T } from '../utils/motion';
import { DSIcons } from '../DesignSystem';
import { useEntitlement } from '../utils/useEntitlement';

export default function PremiumSoonDialog({ accentHex = '#5a00d9', onClose }) {
  const { isTrial, trialDaysLeft } = useEntitlement();
  const trialRunning = isTrial && trialDaysLeft > 0;

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2600,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        background: 'var(--modal-overlay-bg, rgba(0,0,0,0.75))', backdropFilter: 'blur(6px)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={T.base}
        style={{
          width: 'min(420px, 92vw)', textAlign: 'center',
          background: 'var(--modal-bg)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '30px 26px 24px',
          boxShadow: `0 28px 80px rgba(0,0,0,0.5), 0 0 60px ${accentHex}14`,
        }}
      >
        <div style={{
          width: 60, height: 60, borderRadius: '50%', margin: '0 auto 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${accentHex}18`, border: `1px solid ${accentHex}55`,
        }}>
          <DSIcons.Lock size={26} color={accentHex} />
        </div>

        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: 'var(--text-1)' }}>
          Uh Oh, This is a Premium feature
        </h2>

        <p style={{ margin: '0 0 6px', fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-3)' }}>
          {trialRunning
            ? 'Premium isn’t on sale just yet — it’s coming soon. Everything stays unlocked for the rest of your trial.'
            : 'Premium isn’t on sale just yet — it’s coming soon. Everything you’ve written stays yours and stays on your device in the meantime.'}
        </p>

        <p style={{ margin: '0 0 22px', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-4)' }}>
          Thanks for being here this early — it genuinely helps.
        </p>

        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '13px 0', borderRadius: 13, border: 'none',
            background: accentHex, color: 'var(--on-accent, #fff)', fontSize: 14.5, fontWeight: 800,
            cursor: 'pointer', boxShadow: `0 6px 18px ${accentHex}55`,
          }}
        >
          Got it
        </button>
      </motion.div>
    </div>,
    document.body
  );
}
