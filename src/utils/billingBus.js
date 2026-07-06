/**
 * billingBus.js — lets any component request the billing/upgrade screen.
 * App subscribes and renders <BillingPage/> when openBilling() is called.
 */

const listeners = new Set();

export function openBilling() {
  for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } }
}

export function subscribeBilling(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
