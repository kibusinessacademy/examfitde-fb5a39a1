/**
 * SSOT Math Helpers for Quality Gates & Integrity Checks
 *
 * Shared utilities for safe percentage calculations across
 * Council, Integrity, and KPI functions.
 */

/**
 * Safe percentage: 0/0 → 100 (N/A = PASS).
 * Use when "no items to measure" means the check is not applicable.
 */
export function pctOrNA(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 100;
}

/**
 * Safe percentage: 0/0 → 0.
 * Use when "no items" means genuinely zero coverage.
 */
export function pctOrZero(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}
