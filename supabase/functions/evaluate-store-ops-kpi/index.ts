// STORE.OPS.KPI.OS.1 — evaluate-store-ops-kpi
// Admin-only. Loads StoreOps data, runs Pure SSOT projection, persists snapshot.
// NO Store API, NO publish, NO submit, NO IAP/entitlement changes.

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { projectStoreOpsKpi } from "../_shared/storeOpsKpi/projection.ts";
import { buildKpiAuditPayload } from "../_shared/storeOpsKpi/audit.ts";
import type { StoreOpsInput } from "../_shared/storeOpsKpi/contracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await assertAdmin(req, "evaluate-store-ops-kpi");
  if (!gate.ok) return json({ error: gate.reason }, gate.status);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [manifests, builds, listings, screenshots, gates, candidates, events, feedback] = await Promise.all([
    supabase.from("mobile_course_app_manifest").select("id, privacy_url, support_url, bundle_id, version_name"),
    supabase.from("store_release_builds").select("manifest_id, platform, status"),
    supabase.from("store_release_listings").select("manifest_id, platform, status"),
    supabase.from("store_release_screenshots").select("manifest_id, platform, status"),
    supabase.from("store_review_gate").select("manifest_id, review_state, review_score, android_ready, ios_ready, blockers"),
    supabase.from("store_release_candidates").select("id, manifest_id, status, manifest_hash, listing_hash, package_hash, build_hash, created_at"),
    supabase.from("store_lifecycle_events").select("manifest_id, candidate_id, event_type, to_state, occurred_at_reference"),
    supabase.from("store_lifecycle_feedback").select("manifest_id, store_feedback_type, store_feedback_status, reason_code"),
  ]);

  const errs = [manifests, builds, listings, screenshots, gates, candidates, events, feedback]
    .map((r) => r.error?.message)
    .filter(Boolean);
  if (errs.length) return json({ error: "load_failed", details: errs }, 500);

  // Aggregate screenshots per (manifest, platform) for ready_count vs required_count(=3).
  const screenshotMap = new Map<string, { ready: number; required: number }>();
  for (const s of (screenshots.data ?? []) as any[]) {
    const key = `${s.manifest_id}::${s.platform}`;
    const cur = screenshotMap.get(key) ?? { ready: 0, required: 3 };
    if (s.status === "ready" || s.status === "approved") cur.ready++;
    screenshotMap.set(key, cur);
  }
  const screenshotsAgg = [...screenshotMap.entries()].map(([k, v]) => {
    const [manifest_id, platform] = k.split("::");
    return { manifest_id, platform: platform as "android" | "ios", ready_count: v.ready, required_count: v.required };
  });

  const evaluated_at_reference = new Date().toISOString();

  const input: StoreOpsInput = {
    manifests: (manifests.data ?? []).map((m: any) => ({
      manifest_id: m.id,
      has_privacy_url: !!m.privacy_url,
      has_support_url: !!m.support_url,
      complete: Boolean(m.id && m.bundle_id && m.version_name),
    })),
    builds: (builds.data ?? []) as any[],
    listings: (listings.data ?? []) as any[],
    screenshots: screenshotsAgg,
    review_gates: (gates.data ?? []).map((g: any) => ({
      manifest_id: g.manifest_id,
      review_state: g.review_state,
      review_score: g.review_score ?? 0,
      android_ready: !!g.android_ready,
      ios_ready: !!g.ios_ready,
      blockers: Array.isArray(g.blockers) ? g.blockers : [],
    })),
    candidates: (candidates.data ?? []).map((c: any) => ({
      candidate_id: c.id,
      manifest_id: c.manifest_id,
      status: c.status ?? "draft",
      manifest_hash: c.manifest_hash,
      listing_hash: c.listing_hash,
      package_hash: c.package_hash,
      build_hash: c.build_hash,
      created_at_reference: c.created_at,
      invalidated: c.status === "invalidated",
    })),
    lifecycle_events: (events.data ?? []) as any[],
    lifecycle_feedback: (feedback.data ?? []) as any[],
    known_limitations: { lifecycle_implemented: true, iap_dispatcher_present: true },
    evaluated_at_reference,
    stale_after_days: 14,
  };

  const projection = projectStoreOpsKpi(input);
  const version = `${evaluated_at_reference}::${projection.health_score}`;

  const { data: snap, error: insErr } = await supabase
    .from("store_ops_kpi_snapshots")
    .insert({
      snapshot_version: version,
      health_score: projection.health_score,
      summary: projection.summary as any,
      platform_split: projection.platform_split as any,
      risk_distribution: projection.risk_distribution as any,
      bottlenecks: projection.bottlenecks as any,
      top_blockers: projection.top_blockers as any,
      top_rejection_reasons: projection.top_rejection_reasons as any,
      recommended_actions: projection.recommended_actions as any,
    })
    .select("id")
    .single();

  if (insErr) return json({ error: insErr.message }, 500);

  await supabase.from("security_events").insert({
    event_type: "store_ops_kpi_evaluated",
    severity: "info",
    payload: buildKpiAuditPayload("store_ops_kpi_persisted", projection) as any,
  });

  return json({ ok: true, snapshot_id: snap?.id, projection });
});
