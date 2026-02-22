/**
 * Shared helpers for Org Console privacy, scope, UUID validation,
 * fiscal-year calculation, and learner pseudonymization.
 */

export type ReportScope = "ANONYMIZED" | "PSEUDONYMIZED" | "IDENTIFIED";

export function clampScope(input: unknown, fallback: ReportScope): ReportScope {
  return (input === "ANONYMIZED" || input === "PSEUDONYMIZED" || input === "IDENTIFIED")
    ? input
    : fallback;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export function clampInt(v: string | null, defVal: number, min: number, max: number) {
  const n = v ? parseInt(v, 10) : defVal;
  if (Number.isNaN(n)) return defVal;
  return Math.max(min, Math.min(max, n));
}

export function clampStr(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

/**
 * Fiscal year start/end (inclusive start, exclusive end).
 * fiscalStartMonth: 1..12
 */
export function fiscalYearRange(now: Date, fiscalStartMonth: number) {
  const m = fiscalStartMonth - 1; // 0-indexed
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  // If current month is before fiscal start → still in previous fiscal year
  const startYear = month < m ? year - 1 : year;

  const start = new Date(Date.UTC(startYear, m, 1, 0, 0, 0));
  const end = new Date(Date.UTC(startYear + 1, m, 1, 0, 0, 0));
  return { start, end };
}

export function parseRangeParams(url: URL) {
  const start = url.searchParams.get("start_date"); // YYYY-MM-DD
  const end = url.searchParams.get("end_date");     // YYYY-MM-DD
  const startOk = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null;
  const endOk = end && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null;
  return { start_date: startOk, end_date: endOk };
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stable pseudonym per org+learner (server secret salt).
 * Returns e.g. "L-3f8a2b1c09"
 */
export async function pseudonymizeLearner(orgId: string, learnerUserId: string): Promise<string> {
  const salt = Deno.env.get("ORG_PSEUDO_SALT") ?? "missing_salt";
  const fp = await sha256Hex(`${salt}|${orgId}|${learnerUserId}`);
  return `L-${fp.slice(0, 10)}`;
}
