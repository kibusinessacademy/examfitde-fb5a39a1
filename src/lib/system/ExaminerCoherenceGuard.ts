/**
 * Phase 7.1 — Runtime Examiner Coherence Guard.
 *
 * Verifiziert, dass ein gegebener `ExaminationConsciousness`-Snapshot
 * surface-übergreifend dieselbe prüferische Wahrheit erzeugt:
 *   - identischer Verdict-Tone
 *   - identische Top-Priorität
 *   - konsistente Dramaturgie-Phase
 *   - konsistente Personality-Identität
 *
 * Wird in Golden-State-Snapshots und ggf. in Dev-Warnungen verwendet.
 * Keine Side-Effects, keine UI-Logik.
 */
import type { ExaminationConsciousness } from "./ExaminationConsciousness";
import { FORBIDDEN_EXAMINER_TOKENS } from "./ExaminerLexicon";

export interface CoherenceReport {
  ok: boolean;
  violations: string[];
}

/**
 * Stellt sicher, dass ein einzelner Snapshot in sich kohärent ist.
 * Verbietet stille Inkonsistenzen wie "Verdict=stable, Top-Risk=critical".
 */
export function assertSnapshotCoherence(c: ExaminationConsciousness): CoherenceReport {
  const violations: string[] = [];

  if (c.verdict.tone === "stable" && c.topRisks.some((r) => r.tone === "critical")) {
    violations.push("verdict_tone_contradicts_top_risks");
  }
  if (c.verdict.tone === "critical" && c.topRisks.every((r) => r.tone === "stable")) {
    violations.push("verdict_critical_without_critical_risks");
  }
  if (c.psychology.priority.tone !== c.verdict.tone &&
      c.psychology.priority.tone === "stable" && c.verdict.tone === "critical") {
    violations.push("priority_stable_vs_verdict_critical");
  }
  if (c.fatigue.level === "kritisch" && c.simulation.beats[0]?.intent === "warmup") {
    violations.push("critical_fatigue_in_warmup");
  }
  for (const token of FORBIDDEN_EXAMINER_TOKENS) {
    if (c.verdict.headline.includes(token) || c.verdict.detail.includes(token)) {
      violations.push(`forbidden_token_in_verdict:${token}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Vergleicht zwei Snapshots, die aus demselben Zustand abgeleitet wurden
 * (z. B. aus zwei Surfaces). Sie müssen prüferisch identisch sein.
 */
export function assertCrossSurfaceCoherence(
  a: ExaminationConsciousness,
  b: ExaminationConsciousness,
): CoherenceReport {
  const violations: string[] = [];
  if (a.verdict.tone !== b.verdict.tone) violations.push("verdict_tone_drift");
  if (a.verdict.headline !== b.verdict.headline) violations.push("verdict_headline_drift");
  if (a.personality.key !== b.personality.key) violations.push("personality_drift");
  if (a.dramaturgy.phase !== b.dramaturgy.phase) violations.push("dramaturgy_phase_drift");
  if (a.psychology.priority.focus !== b.psychology.priority.focus) violations.push("priority_focus_drift");
  if (a.transfer.level !== b.transfer.level) violations.push("transfer_level_drift");
  if (Math.round(a.readiness) !== Math.round(b.readiness)) violations.push("readiness_drift");
  return { ok: violations.length === 0, violations };
}
