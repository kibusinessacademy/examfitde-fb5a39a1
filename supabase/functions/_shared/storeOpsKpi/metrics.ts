/**
 * STORE.OPS.KPI.OS.1 — Pure metric helpers.
 */
import type {
  StoreOpsInput,
  KpiSummary,
  PlatformSplit,
  Platform,
} from "./contracts.ts";

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export function knownManifestIds(input: StoreOpsInput): Set<string> {
  return new Set(input.manifests.map((m) => m.manifest_id));
}

export function isStaleCandidate(
  createdIso: string,
  evaluatedIso: string,
  staleAfterDays: number,
): boolean {
  const c = Date.parse(createdIso);
  const e = Date.parse(evaluatedIso);
  if (!Number.isFinite(c) || !Number.isFinite(e)) return false;
  const days = (e - c) / 86_400_000;
  return days >= staleAfterDays;
}

export function computeSummary(input: StoreOpsInput): KpiSummary {
  const known = knownManifestIds(input);
  const total_manifests = known.size;

  // Gates
  const gates = input.review_gates.filter((g) => known.has(g.manifest_id));
  const review_ready_count = gates.filter((g) => g.review_state === "review_ready").length;
  const blocked_count = gates.filter((g) => g.review_state === "blocked").length;
  const android_ready_count = gates.filter((g) => g.android_ready).length;
  const ios_ready_count = gates.filter((g) => g.ios_ready).length;
  const average_review_score = gates.length
    ? Math.round(
        (gates.reduce((s, g) => s + (g.review_score ?? 0), 0) / gates.length) * 100,
      ) / 100
    : 0;

  // Lifecycle
  const feedback = input.lifecycle_feedback.filter((f) => known.has(f.manifest_id));
  const approved_count = feedback.filter((f) => f.store_feedback_status === "approved").length;
  const rejected_count = feedback.filter((f) => f.store_feedback_status === "rejected" || /rejected/.test(f.store_feedback_type)).length;

  const events = input.lifecycle_events.filter((e) => known.has(e.manifest_id));
  const lifecycle_blocked_count = uniq(
    events.filter((e) => e.to_state === "blocked").map((e) => e.manifest_id),
  ).length;
  const rollback_available_count = uniq(
    events.filter((e) => e.to_state === "rollback_candidate").map((e) => e.manifest_id),
  ).length;

  // Builds
  const builds = input.builds.filter((b) => known.has(b.manifest_id));
  const completed = builds.filter((b) => b.status === "success" || b.status === "failed");
  const build_success_rate = completed.length
    ? Math.round((completed.filter((b) => b.status === "success").length / completed.length) * 100) / 100
    : 0;

  // Listings
  const listings = input.listings.filter((l) => known.has(l.manifest_id));
  const missing_listing_count = input.manifests.filter((m) => {
    const ls = listings.filter((l) => l.manifest_id === m.manifest_id);
    return ls.length < 2 || ls.some((l) => l.status === null || l.status === "draft");
  }).length;

  // Screenshots
  const screenshots = input.screenshots.filter((s) => known.has(s.manifest_id));
  const missing_screenshots_count = input.manifests.filter((m) => {
    const ss = screenshots.filter((s) => s.manifest_id === m.manifest_id);
    if (ss.length < 2) return true;
    return ss.some((s) => s.ready_count < (s.required_count ?? 3));
  }).length;

  const missing_privacy_count = input.manifests.filter((m) => !m.has_privacy_url).length;
  const missing_support_count = input.manifests.filter((m) => !m.has_support_url).length;

  // Candidates
  const candidates = input.candidates.filter((c) => known.has(c.manifest_id));
  const candidate_invalidated_count = candidates.filter((c) => c.invalidated).length;
  const staleAfter = input.stale_after_days ?? 14;
  const stale_candidates_count = candidates.filter(
    (c) =>
      !c.invalidated &&
      !["released", "retired", "cancelled"].includes(c.status) &&
      isStaleCandidate(c.created_at_reference, input.evaluated_at_reference, staleAfter),
  ).length;

  return {
    total_manifests,
    review_ready_count,
    blocked_count,
    approved_count,
    rejected_count,
    build_success_rate,
    android_ready_count,
    ios_ready_count,
    missing_screenshots_count,
    missing_listing_count,
    missing_privacy_count,
    missing_support_count,
    average_review_score,
    candidate_invalidated_count,
    rollback_available_count,
    lifecycle_blocked_count,
    stale_candidates_count,
  };
}

export function computePlatformSplit(input: StoreOpsInput): PlatformSplit {
  const known = knownManifestIds(input);
  const make = (p: Platform) => ({
    listings_ready: input.listings.filter((l) => known.has(l.manifest_id) && l.platform === p && (l.status === "approved" || l.status === "review_ready")).length,
    builds_ok: input.builds.filter((b) => known.has(b.manifest_id) && b.platform === p && b.status === "success").length,
    screenshots_ok: input.screenshots.filter((s) => known.has(s.manifest_id) && s.platform === p && s.ready_count >= (s.required_count ?? 3)).length,
  });
  return { android: make("android"), ios: make("ios") };
}

export function topBlockers(input: StoreOpsInput, limit = 5): Array<{ code: string; count: number }> {
  const known = knownManifestIds(input);
  const counts = new Map<string, number>();
  for (const g of input.review_gates) {
    if (!known.has(g.manifest_id)) continue;
    for (const b of g.blockers ?? []) {
      counts.set(b.code, (counts.get(b.code) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([code, count]) => ({ code, count }));
}

export function topRejectionReasons(
  input: StoreOpsInput,
  limit = 5,
): Array<{ reason: string; count: number }> {
  const known = knownManifestIds(input);
  const counts = new Map<string, number>();
  for (const f of input.lifecycle_feedback) {
    if (!known.has(f.manifest_id)) continue;
    if (!/rejected/.test(f.store_feedback_type) && f.store_feedback_status !== "rejected") continue;
    const key = f.reason_code ?? f.store_feedback_type;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}
