/**
 * STORE.OPS.KPI.OS.1 — Projection (pure).
 */
import type {
  StoreOpsInput,
  StoreOpsKpiProjection,
  RecommendedAction,
} from "./contracts.ts";
import {
  computeSummary,
  computePlatformSplit,
  topBlockers,
  topRejectionReasons,
} from "./metrics.ts";
import { computeRiskDistribution, computeHealthScore, computeWarnings } from "./risk.ts";
import { detectBottlenecks } from "./bottlenecks.ts";

const REASONS: Record<string, string> = {
  generate_listing: "Listing fehlt oder ist im Draft.",
  generate_screenshots: "Screenshots unvollständig.",
  fix_build: "Build fehlgeschlagen.",
  complete_manifest: "Manifest unvollständig.",
  address_review_blocker: "Review-Gate blockt Release.",
  resolve_lifecycle_block: "Lifecycle ist blockiert.",
  respond_to_rejection: "Store hat abgelehnt — Antwort nötig.",
  refresh_stale_candidate: "Release-Candidate veraltet.",
};

export function projectStoreOpsKpi(input: StoreOpsInput): StoreOpsKpiProjection {
  const summary = computeSummary(input);
  const platform_split = computePlatformSplit(input);
  const risk_distribution = computeRiskDistribution(input);
  const bottlenecks = detectBottlenecks(input);
  const top_blockers = topBlockers(input);
  const top_rejection_reasons = topRejectionReasons(input);
  const warnings = computeWarnings(input);
  const health_score = computeHealthScore(input);

  const seen = new Map<string, RecommendedAction>();
  for (const b of bottlenecks) {
    const prev = seen.get(b.recommended_action);
    if (prev) {
      prev.affected_manifest_ids = [
        ...new Set([...prev.affected_manifest_ids, ...b.affected_manifest_ids]),
      ].sort();
    } else {
      seen.set(b.recommended_action, {
        action: b.recommended_action,
        reason: REASONS[b.recommended_action] ?? b.recommended_action,
        affected_manifest_ids: [...b.affected_manifest_ids].sort(),
      });
    }
  }
  // Manifest completion
  const incompleteIds = input.manifests.filter((m) => !m.complete).map((m) => m.manifest_id).sort();
  if (incompleteIds.length > 0) {
    seen.set("complete_manifest", {
      action: "complete_manifest",
      reason: REASONS.complete_manifest,
      affected_manifest_ids: incompleteIds,
    });
  }
  const recommended_actions = [...seen.values()].sort((a, b) => a.action.localeCompare(b.action));

  return {
    summary,
    platform_split,
    risk_distribution,
    bottlenecks,
    top_blockers,
    top_rejection_reasons,
    recommended_actions,
    warnings,
    health_score,
    generated_at_reference: input.evaluated_at_reference,
  };
}
