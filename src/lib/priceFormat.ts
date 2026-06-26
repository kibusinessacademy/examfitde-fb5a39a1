/**
 * Central Price Formatting SSOT
 *
 * UI MUST render German format: "24,90 €" (comma decimal, NBSP before €).
 * JSON-LD / Schema.org / Stripe MUST keep numeric values (e.g. 24.9) — do NOT use these helpers there.
 *
 * Quick reference:
 *  - UI display:        formatEuro(24.9)          → "24,90 €"
 *  - UI from cents:     formatEuroCents(2490)     → "24,90 €"
 *  - SEO/JSON-LD/Stripe: pass the raw numeric value (e.g. PRODUCT_PRICES.bundle = 24.9).
 */

const NBSP = '\u00A0';

/**
 * Format a EUR amount (in Euros) as German display string.
 * Always 2 fraction digits, NBSP before €. NEVER use this in JSON-LD/Schema.org.
 */
export function formatEuro(amount: number, opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? 2;
  if (!Number.isFinite(amount)) return `0,00${NBSP}€`;
  const formatted = amount.toLocaleString('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formatted}${NBSP}€`;
}

/**
 * Format a EUR amount given in cents as German display string.
 */
export function formatEuroCents(cents: number): string {
  if (!Number.isFinite(cents)) return `0,00${NBSP}€`;
  return formatEuro(cents / 100);
}
