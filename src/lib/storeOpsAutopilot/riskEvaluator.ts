/**
 * STORE.OPS.AUTOPILOT.OS.1 — Risk evaluator (pure, deterministic).
 */
import type { AutopilotInput, RiskLevel } from "./contracts.ts";

/** Returns a 0-100 risk score and a level. Lower = safer. */
export function evaluateRisk(input: AutopilotInput): { score: number; level: RiskLevel } {
  let score = 0;

  for (const g of input.review_gates) {
    if (!g.review_ready) score += 6;
    score += Math.min(g.blocker_count, 10) * 2;
  }
  for (const l of input.lifecycle) if (l.has_error) score += 8;
  for (const b of input.builds) if (b.status === "failed") score += 5;
  for (const ls of input.listings) {
    if (ls.status === "rejected") score += 6;
    if (ls.status === "draft") score += 2;
  }
  for (const s of input.screenshots) if (s.ready_count < s.required_count) score += 3;
  for (const h of input.hash_drift) if (h.drifted) score += 7;
  for (const b of input.batch_status) if (b.has_open_failures) score += 5;
  for (const k of input.kpi) {
    if (k.risk_level === "critical") score += 12;
    else if (k.risk_level === "high") score += 7;
    else if (k.risk_level === "medium") score += 3;
  }

  if (score > 100) score = 100;
  let level: RiskLevel = "low";
  if (score >= 70) level = "critical";
  else if (score >= 45) level = "high";
  else if (score >= 20) level = "medium";
  return { score, level };
}
