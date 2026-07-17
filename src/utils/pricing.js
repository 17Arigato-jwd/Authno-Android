/**
 * pricing.js — One-time purchase price, per region.
 *
 * Base price is ₹2,999.99 INR. Every other region is the base converted to
 * the local currency, rounded to the nearest 5, minus 0.01 (minus 1 for
 * zero-decimal currencies like JPY). USD / GBP / EUR figures are fixed per
 * product decision; the rest are derived from the $29.99 anchor at
 * approximate FX rates so regional prices stay coherent with each other.
 *
 * This table only drives the MOCK checkout UI. When real Google Play
 * Billing lands, the store's localized price replaces getOneTimePrice()
 * and this module becomes the web/desktop fallback.
 */

const BASE = { currency: 'INR', amount: 2999.99 };

// currency → price
const PRICES = {
  INR: 2999.99,
  USD: 29.99,
  GBP: 24.99,
  EUR: 29.99,
  CAD: 39.99,  // ~29.99 USD × 1.37 → 41 → 40 − 0.01
  AUD: 44.99,  // ~29.99 USD × 1.52 → 46 → 45 − 0.01
  SGD: 39.99,  // ~29.99 USD × 1.33 → 40 → 40 − 0.01
  JPY: 4499,   // ~29.99 USD × 150 → 4500 − 1 (zero-decimal currency)
};

const EUROZONE = new Set([
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
]);

// region code → currency (regions not listed fall back to USD)
const REGION_CURRENCY = {
  IN: 'INR',
  US: 'USD',
  GB: 'GBP',
  CA: 'CAD',
  AU: 'AUD',
  SG: 'SGD',
  JP: 'JPY',
};

function detectRegion() {
  try {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of tags) {
      const region = new Intl.Locale(tag).region;
      if (region) return region.toUpperCase();
    }
  } catch { /* fall through */ }
  return 'IN'; // home market default
}

/** The one-time Pro price for the user's region: { currency, amount, formatted, region }. */
export function getOneTimePrice() {
  const region = detectRegion();
  const currency = EUROZONE.has(region)
    ? 'EUR'
    : (REGION_CURRENCY[region] ?? (region === 'IN' ? 'INR' : 'USD'));
  const amount = PRICES[currency] ?? PRICES.USD;

  let formatted;
  try {
    formatted = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      // JPY etc. format without decimals automatically
    }).format(amount);
  } catch {
    formatted = `${currency} ${amount}`;
  }

  return { currency, amount, formatted, region };
}

export const BASE_PRICE = BASE;
