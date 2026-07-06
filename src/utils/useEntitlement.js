/**
 * useEntitlement.js — reactive Pro/Free state for components (U10).
 *
 * ProGate and the billing page use this so unlocking Pro (via the mock purchase)
 * immediately re-renders every gated feature without a reload.
 */

import { useState, useEffect } from 'react';
import { getEntitlement, isPro as _isPro, subscribeEntitlement } from './entitlements';

export function useEntitlement() {
  const [tier, setTier] = useState(getEntitlement());
  useEffect(() => subscribeEntitlement(setTier), []);
  return { tier, isPro: tier === 'pro' };
}

export function useIsPro() {
  return useEntitlement().isPro;
}
