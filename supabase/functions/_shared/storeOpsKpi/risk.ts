/**
 * STORE.OPS.KPI.OS.1 — Risk evaluation (pure).
 */
import type { RiskDistribution, RiskLevel, StoreOpsInput } from "./contracts.ts";
import { knownManifestIds, isStaleCandidate, topRejectionReasons } from "./metrics.ts";

export function classifyManifestRisk(
  input: StoreOpsInput,
  manifestId: string,
): RiskLevel {
  let score = 0;

  const gate = input.review_gates.find((g) => g.manifest_id === manifestId);
  if (gate) {
    if (gate.review_state === "blocked") score += 4;
    if (gate.review_state === "build_failed") score += 3;
    if (gate.review_state === "missing_assets") score += 2;
    if (!gate.android_ready) score += 1;
    if (!gate.ios_ready) score += 1;
    if ((gate.blockers ?? []).length >= 3) score += 1;
  } else {
    score += 1;
  }

  const builds = input.builds.filter((b) => b.manifest_id === manifestId);
  if (builds.some((b) => b.status === "failed")) score += 2;

  const listings = input.listings.filter((l) => l.manifest_id === manifestId);
  if (listings.length < 2) score += 1;

  const screenshots = input.screenshots.filter((s) => s.manifest_id === manifestId);
  if (screenshots.length < 2 || screenshots.some((s) => s.ready_count < (s.required_count ?? 3))) {
    score += 1;
  }

  const feedback = input.lifecycle_feedback.filter((f) => f.manifest_id === manifestId);
  const rejections = feedback.filter(
    (f) => /rejected/.test(f.store_feedback_type) || f.store_feedback_status === "rejected",
  );
  if (rejections.length >= 2) score += 2;
  else if (rejections.length === 1) score += 1;

  // Repeated rejection reason (same reason_code more than once)
  const reasonCount = new Map<string, number>();
  for (const r of rejections) {
    const k = r.reason_code ?? r.store_feedback_type;
    reasonCount.set(k, (reasonCount.get(k) ?? 0) + 1);
  }
  if ([...reasonCount.values()].some((n) => n >= 2)) score += 1;

  const events = input.lifecycle_events.filter((e) => e.manifest_id === manifestId);
  if (events.some((e) => e.to_state === "blocked")) score += 2;

  const candidates = input.candidates.filter((c) => c.manifest_id === manifestId);
  const staleAfter = input.stale_after_days ?? 14;
  if (
    candidates.some(
      (c) =>
        !c.invalidated &&
        !["released", "retired", "cancelled"].includes(c.status) &&
        isStaleCandidate(c.created_at_reference, input.evaluated_at_reference, staleAfter),
    )
  ) {
    score += 1;
  }

  // Hash mismatch within candidate set (manifest_hash drifting)
  const hashes = new Set(candidates.map((c) => c.manifest_hash).filter(Boolean));
  if (hashes.size > 1) score += 1;

  if (score >= 7) return "critical";
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

export function computeRiskDistribution(input: StoreOpsInput): RiskDistribution {
  const known = knownManifestIds(input);
  const dist: RiskDistribution = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const id of known) {
    dist[classifyManifestRisk(input, id)]++;
  }
  return dist;
}

export function computeWarnings(input: StoreOpsInput): string[] {
  const warnings: string[] = [];
  if (!input.known_limitations.lifecycle_implemented) {
    warnings.push("lifecycle_layer_missing");
  }
  if (!input.known_limitations.iap_dispatcher_present) {
    warnings.push("iap_dispatcher_missing");
  }
  if (topRejectionReasons(input, 1).some((r) => r.count >= 2)) {
    warnings.push("repeated_rejection_reason");
  }
  const hashDriftManifests = new Set<string>();
  for (const c of input.candidates) {
    const peers = input.candidates.filter((x) => x.manifest_id === c.manifest_id);
    const distinct = new Set(peers.map((p) => p.manifest_hash).filter(Boolean));
    if (distinct.size > 1) hashDriftManifests.add(c.manifest_id);
  }
  if (hashDriftManifests.size > 0) warnings.push("manifest_hash_drift");
  return warnings;
}

export function computeHealthScore(input: StoreOpsInput): number {
  const known = knownManifestIds(input);
  if (known.size === 0) return 0;
  const dist = computeRiskDistribution(input);
  // Weights: low=1.0, medium=0.7, high=0.3, critical=0.0
  const weighted =
    dist.low * 1.0 + dist.medium * 0.7 + dist.high * 0.3 + dist.critical * 0.0;
  const base = weighted / known.size;

  // Penalties from systemic warnings
  const warnings = computeWarnings(input);
  let penalty = 0;
  if (warnings.includes("repeated_rejection_reason")) penalty += 0.05;
  if (warnings.includes("manifest_hash_drift")) penalty += 0.05;

  // Build success rate factor
  const completedBuilds = input.builds.filter((b) => b.status === "success" || b.status === "failed");
  let buildFactor = 1;
  if (completedBuilds.length > 0) {
    const ok = completedBuilds.filter((b) => b.status === "success").length / completedBuilds.length;
    buildFactor = 0.6 + 0.4 * ok; // 0.6..1.0
  }

  const raw = Math.max(0, base * buildFactor - penalty);
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}
