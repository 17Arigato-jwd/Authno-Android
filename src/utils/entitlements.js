// entitlements.js — Tier / entitlement helpers.
//
// Per product decision, billing is a LOCAL MOCK: the billing page simulates a
// successful transaction (including a UPI option) and calls unlockProMock(),
// which flips this flag and unlocks the Pro UI for local testing. No real
// payment gateway or backend is wired. When real Google Play Billing lands,
// only this module and the billing page change.
//
// Trial layer: After onboarding, user gets 7-day free access to Pro features.
// isTrialActive() extends Pro access. trialDaysLeft() helps render countdown UI.

export const ENTITLEMENTS = { FREE: 'free', PRO: 'pro', TRIAL: 'trial' };

const KEY = 'authno_tier';
const TRIAL_START_KEY = 'authno_trial_started_at';
const TRIAL_DAYS = 7;
const _subs = new Set();

export function getEntitlement() {
  try { return localStorage.getItem(KEY) ?? ENTITLEMENTS.FREE; }
  catch { return ENTITLEMENTS.FREE; }
}

export function isPro() {
  const tier = getEntitlement();
  return tier === ENTITLEMENTS.PRO || (tier === ENTITLEMENTS.TRIAL && isTrialActive());
}

export function isTrialActive() {
  if (getEntitlement() !== ENTITLEMENTS.TRIAL) return false;
  try {
    const startedAt = localStorage.getItem(TRIAL_START_KEY);
    if (!startedAt) return false;
    const start = parseInt(startedAt, 10);
    const now = Date.now();
    const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    return daysPassed < TRIAL_DAYS;
  } catch {
    return false;
  }
}

export function trialDaysLeft() {
  if (!isTrialActive()) return 0;
  try {
    const startedAt = localStorage.getItem(TRIAL_START_KEY);
    if (!startedAt) return 0;
    const start = parseInt(startedAt, 10);
    const now = Date.now();
    const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    return Math.max(0, TRIAL_DAYS - daysPassed);
  } catch {
    return 0;
  }
}

function _set(tier) {
  try { localStorage.setItem(KEY, tier); } catch { /* ignore */ }
  for (const fn of _subs) { try { fn(tier); } catch (e) { console.error(e); } }
}

/** Subscribe to tier changes (returns unsubscribe). */
export function subscribeEntitlement(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

/** Activate 7-day trial (called after onboarding completes).
 *  Never downgrades a purchased Pro, and never resets an existing trial
 *  clock — replaying onboarding from Settings must not grant a fresh trial. */
export function startTrialMock() {
  if (getEntitlement() === ENTITLEMENTS.PRO) return;
  try {
    if (!localStorage.getItem(TRIAL_START_KEY)) {
      localStorage.setItem(TRIAL_START_KEY, String(Date.now()));
    }
  } catch { /* ignore */ }
  _set(ENTITLEMENTS.TRIAL);
}

/** Simulate a successful purchase and unlock Pro locally (mock only). */
export function unlockProMock() { _set(ENTITLEMENTS.PRO); }

/** Restore/downgrade to free — used by the "restore" and dev toggles. */
export function resetToFree() {
  _set(ENTITLEMENTS.FREE);
  try { localStorage.removeItem(TRIAL_START_KEY); } catch { /* ignore */ }
}

/** Dev/testing helper — not exposed in UI */
export function _setTier(tier) { _set(tier); }
