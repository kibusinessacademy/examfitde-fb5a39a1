/**
 * STORE.OPS.KPI.OS.1 — Bottleneck detection (pure).
 */
import type {
  Bottleneck,
  BottleneckKind,
  RecommendedActionKind,
  RiskLevel,
  StoreOpsInput,
} from "./contracts.ts";
import { knownManifestIds, isStaleCandidate } from "./metrics.ts";

function severityFor(ratio: number): RiskLevel {
  if (ratio >= 0.75) return "critical";
  if (ratio >= 0.5) return "high";
  if (ratio >= 0.25) return "medium";
  return "low";
}

function mk(
  kind: BottleneckKind,
  ids: string[],
  total: number,
  action: RecommendedActionKind,
): Bottleneck | null {
  if (ids.length === 0) return null;
  return {
    kind,
    severity: severityFor(total === 0 ? 0 : ids.length / total),
    affected_count: ids.length,
    affected_manifest_ids: [...new Set(ids)].sort(),
    recommended_action: action,
  };
}

export function detectBottlenecks(input: StoreOpsInput): Bottleneck[] {
  const known = knownManifestIds(input);
  const total = known.size;
  if (total === 0) return [];
  const out: Bottleneck[] = [];

  // Listings
  const listingIds = input.manifests
    .filter((m) => {
      const ls = input.listings.filter((l) => l.manifest_id === m.manifest_id);
      return ls.length < 2 || ls.some((l) => !l.status || l.status === "draft");
    })
    .map((m) => m.manifest_id);
  const lb = mk("listing_bottleneck", listingIds, total, "generate_listing");
  if (lb) out.push(lb);

  // Screenshots
  const ssIds = input.manifests
    .filter((m) => {
      const ss = input.screenshots.filter((s) => s.manifest_id === m.manifest_id);
      if (ss.length < 2) return true;
      return ss.some((s) => s.ready_count < (s.required_count ?? 3));
    })
    .map((m) => m.manifest_id);
  const sb = mk("screenshot_bottleneck", ssIds, total, "generate_screenshots");
  if (sb) out.push(sb);

  // Builds
  const failedIds = [
    ...new Set(
      input.builds
        .filter((b) => known.has(b.manifest_id) && b.status === "failed")
        .map((b) => b.manifest_id),
    ),
  ];
  const bb = mk("build_bottleneck", failedIds, total, "fix_build");
  if (bb) out.push(bb);

  // Review gate
  const reviewIds = input.review_gates
    .filter((g) => known.has(g.manifest_id) && (g.review_state === "blocked" || g.review_state === "build_failed" || g.review_state === "missing_assets"))
    .map((g) => g.manifest_id);
  const rb = mk("review_gate_bottleneck", reviewIds, total, "address_review_blocker");
  if (rb) out.push(rb);

  // Lifecycle blocked
  const lifeIds = [
    ...new Set(
      input.lifecycle_events
        .filter((e) => known.has(e.manifest_id) && e.to_state === "blocked")
        .map((e) => e.manifest_id),
    ),
  ];
  const lcb = mk("lifecycle_bottleneck", lifeIds, total, "resolve_lifecycle_block");
  if (lcb) out.push(lcb);

  // Rejection
  const rejIds = [
    ...new Set(
      input.lifecycle_feedback
        .filter(
          (f) =>
            known.has(f.manifest_id) &&
            (/rejected/.test(f.store_feedback_type) || f.store_feedback_status === "rejected"),
        )
        .map((f) => f.manifest_id),
    ),
  ];
  const rjb = mk("rejection_bottleneck", rejIds, total, "respond_to_rejection");
  if (rjb) out.push(rjb);

  // Stale candidates
  const staleAfter = input.stale_after_days ?? 14;
  const staleIds = [
    ...new Set(
      input.candidates
        .filter(
          (c) =>
            known.has(c.manifest_id) &&
            !c.invalidated &&
            !["released", "retired", "cancelled"].includes(c.status) &&
            isStaleCandidate(c.created_at_reference, input.evaluated_at_reference, staleAfter),
        )
        .map((c) => c.manifest_id),
    ),
  ];
  const stb = mk("stale_candidate_bottleneck", staleIds, total, "refresh_stale_candidate");
  if (stb) out.push(stb);

  return out;
}
