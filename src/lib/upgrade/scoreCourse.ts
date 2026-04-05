/**
 * Course Upgrade Scoring — SSOT for EXAM_FIRST → AUSBILDUNG_VOLL promotion.
 *
 * Weighted scoring based on real usage, revenue, and B2B signals.
 * Score range: 0–100.
 */

export interface UpgradeMetrics {
  revenue_30d: number;
  active_users_30d: number;
  sessions_30d: number;
  completion_rate: number; // 0–1
  b2b_signals: number;
}

export const UPGRADE_THRESHOLDS = {
  revenue_30d: 3000,
  active_users_30d: 150,
  sessions_30d: 800,
  completion_rate: 0.6,
  b2b_signals: 2,
} as const;

const WEIGHTS = {
  revenue: 40,
  users: 20,
  engagement: 20,
  completion: 10,
  b2b: 10,
} as const;

export function scoreCourseUpgrade(metrics: UpgradeMetrics): number {
  const t = UPGRADE_THRESHOLDS;

  const revenue = Math.min(metrics.revenue_30d / t.revenue_30d, 1) * WEIGHTS.revenue;
  const users = Math.min(metrics.active_users_30d / t.active_users_30d, 1) * WEIGHTS.users;
  const engagement = Math.min(metrics.sessions_30d / t.sessions_30d, 1) * WEIGHTS.engagement;
  const completion = Math.min(metrics.completion_rate / t.completion_rate, 1) * WEIGHTS.completion;
  const b2b = Math.min(metrics.b2b_signals / t.b2b_signals, 1) * WEIGHTS.b2b;

  return Math.round((revenue + users + engagement + completion + b2b) * 100) / 100;
}
