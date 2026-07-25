/**
 * billing.js — the real purchase path (replaces the local-only mock).
 *
 * AuthNo is offline-first with no accounts and no backend, so the purchase flow
 * is deliberately gateway-agnostic:
 *
 *   1. "Buy" opens a real hosted checkout in the system browser
 *      (Razorpay/Stripe payment link, Gumroad, LemonSqueezy — whatever
 *       REACT_APP_CHECKOUT_URL points at). The gateway handles cards, UPI,
 *       tax and receipts; no card data ever touches this app, so there's no
 *       PCI surface and no secret key to leak.
 *   2. The buyer receives a signed license key.
 *   3. They paste it in; utils/license.js verifies the signature offline and
 *      Pro unlocks permanently, on every device, with no phone-home.
 *
 * Configure with:
 *   REACT_APP_CHECKOUT_URL     — hosted checkout / payment-link URL
 *   REACT_APP_LICENSE_PUBKEY   — base64 SPKI P-256 public key (see license.js)
 *
 * When those are absent, isBillingLive() is false and the UI keeps the clearly
 * labelled demo checkout. It never pretends an unconfigured build can charge.
 *
 * NOTE (Android): Google Play requires Play Billing for digital goods sold
 * inside a Play-distributed app. PROVIDER.play is the seam for that — it stays
 * unimplemented until a Play product ID + billing plugin are added, and
 * isBillingLive() reports false there rather than routing Play users to an
 * external checkout, which would violate policy.
 */

import { isLicensingConfigured, verifyLicenseKey, storeLicense, clearStoredLicense } from './license';
import { unlockProMock, resetToFree } from './entitlements';

export const PROVIDER = { HOSTED: 'hosted', PLAY: 'play', NONE: 'none' };

const isAndroidApp = () =>
  typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.());

export function getCheckoutUrl() {
  return (process.env.REACT_APP_CHECKOUT_URL || '').trim();
}

/** Which real provider applies on this platform (NONE = fall back to demo). */
export function getProvider() {
  if (isAndroidApp()) return PROVIDER.PLAY;         // Play Billing seam (not yet wired)
  if (getCheckoutUrl() && isLicensingConfigured()) return PROVIDER.HOSTED;
  return PROVIDER.NONE;
}

/** True when this build can actually take money on this platform. */
export function isBillingLive() {
  return getProvider() === PROVIDER.HOSTED;
}

/**
 * Open the hosted checkout in the SYSTEM browser (never in-app): payment pages
 * must show the real address bar and padlock for the buyer to trust them, and
 * gateways block embedded webviews for the same reason.
 */
export async function openCheckout() {
  const url = getCheckoutUrl();
  if (!url) return { ok: false, error: 'not-configured' };
  try {
    // Electron desktop — hand off to the OS browser via the preload bridge.
    if (typeof window !== 'undefined' && window.electron?.openExternal) {
      await window.electron.openExternal(url);
      return { ok: true };
    }
    // Capacitor (if ever used on a non-Play build) — system browser.
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, presentationStyle: 'popover' });
      return { ok: true };
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Verify a pasted license key and unlock Pro for good.
 * Returns { ok: true } or { ok: false, reason } with a stable reason code.
 */
export async function activateLicense(key) {
  if (!isLicensingConfigured()) return { ok: false, reason: 'not-configured' };
  try {
    const payload = await verifyLicenseKey(key);
    storeLicense(key);
    unlockProMock();            // flips the local tier to PRO (see entitlements)
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/** Remove a license from this device (a "deactivate"/sign-out equivalent). */
export function deactivateLicense() {
  clearStoredLicense();
  resetToFree();
}
