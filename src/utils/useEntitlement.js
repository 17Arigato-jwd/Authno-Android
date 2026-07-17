/**
 * useEntitlement.js — reactive Pro/Free state for components (U10).
 *
 * ProGate and the billing page use this so unlocking Pro (via the mock purchase)
 * immediately re-renders every gated feature without a reload.
 *
 * Trial-aware: an active 7-day trial counts as Pro for feature gating
 * (isPro), while `tier` stays 'trial' so the billing page can still show
 * the purchase flow and countdown.
 */

import { useState, useEffect } from 'react';
import { getEntitlement, subscribeEntitlement, isTrialActive, trialDaysLeft } from './entitlements';

export function useEntitlement() {
  const [tier, setTier] = useState(getEntitlement());
  useEffect(() => subscribeEntitlement(setTier), []);
  const isTrial = tier === 'trial' && isTrialActive();
  return {
    tier,
    isPro: tier === 'pro' || isTrial,
    isTrial,
    trialDaysLeft: isTrial ? trialDaysLeft() : 0,
  };
}

export function useIsPro() {
  return useEntitlement().isPro;
}
