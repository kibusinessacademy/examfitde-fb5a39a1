/**
 * Central timezone configuration for the entire app.
 * All user-facing timestamps should use these helpers.
 */

export const APP_TIMEZONE = 'Europe/Berlin';
export const APP_LOCALE = 'de-DE';

/** Format a date/timestamp string for display (date + time) */
export function formatDateTime(ts: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'medium',
    ...opts,
  });
}

/** Format only the date part */
export function formatDate(ts: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    ...opts,
  });
}

/** Format only the time part */
export function formatTime(ts: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...opts,
  });
}

/** Get current time as a Berlin-localized string */
export function nowBerlin(): string {
  return new Date().toLocaleString(APP_LOCALE, { timeZone: APP_TIMEZONE });
}

/** Format cents as EUR currency string (e.g. "39,00 €") */
export function formatEur(cents: number): string {
  return (cents / 100).toLocaleString(APP_LOCALE, { style: 'currency', currency: 'EUR' });
}

/** Format a EUR amount (already in euros, not cents) */
export function formatEurAmount(eur: number, decimals = 2): string {
  return eur.toLocaleString(APP_LOCALE, { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
