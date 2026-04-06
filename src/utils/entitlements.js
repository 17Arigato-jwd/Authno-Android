// entitlements.js — Tier / entitlement helpers
// Tier is stored in localStorage for now; replaced by Google Play Billing in Phase 5.6.

export const ENTITLEMENTS = { FREE: 'free', PRO: 'pro' };

export function getEntitlement() {
  return localStorage.getItem('authno_tier') ?? ENTITLEMENTS.FREE;
}

export function isPro() {
  return getEntitlement() === ENTITLEMENTS.PRO;
}

/** Dev/testing helper — not exposed in UI */
export function _setTier(tier) {
  localStorage.setItem('authno_tier', tier);
}
