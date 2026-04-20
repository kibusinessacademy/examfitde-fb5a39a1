/**
 * Visitor-ID: stabile, anonyme Browser-ID für Paywall-Experiment-Sticky.
 * SSOT-konform: serverseitige Sticky-Logik via assign_paywall_variant_anon().
 * Niemals PII enthalten.
 */
const STORAGE_KEY = 'examfit_visitor_id';
const COOKIE_KEY = 'ef_vid';
const COOKIE_MAX_AGE_DAYS = 365;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAge};samesite=lax`;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback (sehr unwahrscheinlich gebraucht)
  return 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getOrCreateVisitorId(): string {
  if (typeof window === 'undefined') return '';

  // 1) Cookie hat Vorrang (SSR-konform)
  const cookieId = readCookie(COOKIE_KEY);
  if (cookieId && cookieId.length >= 8) {
    try {
      window.localStorage.setItem(STORAGE_KEY, cookieId);
    } catch {
      /* ignore */
    }
    return cookieId;
  }

  // 2) localStorage Fallback
  let id: string | null = null;
  try {
    id = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* ignore (private mode) */
  }

  if (!id || id.length < 8) {
    id = generateId();
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  writeCookie(COOKIE_KEY, id);
  return id;
}
