/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Policy guards.
 * Pure. Enforces allow-list for recommendations and rejects forbidden symbols.
 */
import {
  ALLOWED_RECOMMENDATIONS,
  FORBIDDEN_RECOMMENDATIONS,
  type IntelligenceRecommendationCode,
} from "./contracts.ts";

export function isAllowedRecommendation(code: string): code is IntelligenceRecommendationCode {
  return (ALLOWED_RECOMMENDATIONS as readonly string[]).includes(code);
}

export function isForbiddenRecommendation(code: string): boolean {
  return (FORBIDDEN_RECOMMENDATIONS as readonly string[]).includes(code);
}

export function assertNoForbidden(codes: string[]): void {
  for (const c of codes) {
    if (isForbiddenRecommendation(c)) {
      throw new Error(`forbidden_recommendation:${c}`);
    }
  }
}

export function filterAllowedRecommendations<T extends { code: string }>(
  recs: T[],
): { allowed: T[]; rejected: T[] } {
  const allowed: T[] = [];
  const rejected: T[] = [];
  for (const r of recs) {
    if (isForbiddenRecommendation(r.code) || !isAllowedRecommendation(r.code)) {
      rejected.push(r);
    } else {
      allowed.push(r);
    }
  }
  return { allowed, rejected };
}
