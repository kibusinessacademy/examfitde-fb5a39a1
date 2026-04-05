/**
 * Upgrade Decision Logic — EXAM_FIRST → AUSBILDUNG_VOLL
 *
 * Score ≥ 75 → upgrade recommended
 * Score 40–74 → monitor (stay)
 * Score < 40 → stay
 */

export type UpgradeDecision = "upgrade" | "monitor" | "stay";

export interface UpgradeResult {
  decision: UpgradeDecision;
  recommended_track: "AUSBILDUNG_VOLL" | "EXAM_FIRST";
  score: number;
}

export function decideUpgrade(score: number): UpgradeResult {
  if (score >= 75) {
    return { decision: "upgrade", recommended_track: "AUSBILDUNG_VOLL", score };
  }
  if (score >= 40) {
    return { decision: "monitor", recommended_track: "EXAM_FIRST", score };
  }
  return { decision: "stay", recommended_track: "EXAM_FIRST", score };
}
