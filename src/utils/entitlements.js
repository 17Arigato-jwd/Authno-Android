// entitlements.js — Tier / entitlement helpers.
//
// Per product decision, billing is a LOCAL MOCK: the billing page simulates a
// successful transaction (including a UPI option) and calls unlockProMock(),
// which flips this flag and unlocks the Pro UI for local testing. No real
// payment gateway or backend is wired. When real Google Play Billing lands,
// only this module and the billing page change.

export const ENTITLEMENTS = { FREE: 'free', PRO: 'pro' };

const KEY = 'authno_tier';
const _subs = new Set();

export function getEntitlement() {
  try { return localStorage.getItem(KEY) ?? ENTITLEMENTS.FREE; }
  catch { return ENTITLEMENTS.FREE; }
}

export function isPro() {
  return getEntitlement() === ENTITLEMENTS.PRO;
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

/** Simulate a successful purchase and unlock Pro locally (mock only). */
export function unlockProMock() { _set(ENTITLEMENTS.PRO); }

/** Restore/downgrade to free — used by the "restore" and dev toggles. */
export function resetToFree() { _set(ENTITLEMENTS.FREE); }

/** Dev/testing helper — not exposed in UI */
export function _setTier(tier) { _set(tier); }
