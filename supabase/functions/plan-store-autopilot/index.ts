// STORE.OPS.AUTOPILOT.OS.1 — plan-store-autopilot (admin-only)
// Loads StoreOps snapshots, runs Pure SSOT planner, persists run + actions.
// NO publish, NO submit, NO rollout, NO Store API.

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { planAutopilot } from "../_shared/storeOpsAutopilot/autopilotPlanner.ts";
import { buildPlanAudit } from "../_shared/storeOpsAutopilot/audit.ts";
import type {
  AutopilotInput,
  AutopilotMode,
} from "../_shared/storeOpsAutopilot/contracts.ts";

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

const VALID_MODES: AutopilotMode[] = ["disabled", "recommend_only", "safe_execute", "maintenance"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await assertAdmin(req, "plan-store-autopilot");
  if (!gate.ok) return json({ error: gate.reason }, gate.status);

  let body: { mode?: AutopilotMode; manifest_ids?: string[]; simulation?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const mode: AutopilotMode = VALID_MODES.includes(body.mode as AutopilotMode)
    ? (body.mode as AutopilotMode)
    : "recommend_only";
  const simulation = body.simulation === true;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const manifestQuery = body.manifest_ids?.length
    ? supabase.from("mobile_course_app_manifest").select("id, privacy_url, support_url, bundle_id, version_name").in("id", body.manifest_ids)
    : supabase.from("mobile_course_app_manifest").select("id, privacy_url, support_url, bundle_id, version_name");

  const [manifests, gates, builds, listings, screenshots, candidates, lifecycle, batches] = await Promise.all([
    manifestQuery,
    supabase.from("store_review_gate").select("manifest_id, review_state, android_ready, ios_ready, blockers"),
    supabase.from("store_release_builds").select("manifest_id, platform, status"),
    supabase.from("store_release_listings").select("manifest_id, platform, status"),
    supabase.from("store_release_screenshots").select("manifest_id, platform, status"),
    supabase.from("store_release_candidates").select("id, manifest_id, status, manifest_hash, listing_hash, package_hash, build_hash, created_at"),
    supabase.from("store_lifecycle_events").select("manifest_id, to_state, occurred_at_reference"),
    supabase.from("store_ops_batch_items").select("manifest_id, status"),
  ]);

  const errs = [manifests, gates, builds, listings, screenshots, candidates, lifecycle, batches]
    .map((r) => r.error?.message)
    .filter(Boolean);
  if (errs.length) return json({ error: "load_failed", details: errs }, 500);

  const manifestRows = (manifests.data ?? []) as any[];
  const manifestIds = manifestRows.map((m) => m.id);

  // Aggregate screenshots ready vs required.
  const shotMap = new Map<string, { ready: number; required: number }>();
  for (const s of (screenshots.data ?? []) as any[]) {
    const key = `${s.manifest_id}::${s.platform}`;
    const cur = shotMap.get(key) ?? { ready: 0, required: 3 };
    if (s.status === "ready" || s.status === "approved") cur.ready++;
    shotMap.set(key, cur);
  }
  const screenshotsAgg = [...shotMap.entries()].map(([k, v]) => {
    const [manifest_id, platform] = k.split("::");
    return { manifest_id, platform: platform as "android" | "ios", ready_count: v.ready, required_count: v.required };
  });

  // Latest lifecycle per manifest.
  const latestLifecycle = new Map<string, { current_state: string; has_error: boolean }>();
  for (const e of (lifecycle.data ?? []) as any[]) {
    if (!latestLifecycle.has(e.manifest_id)) {
      latestLifecycle.set(e.manifest_id, {
        current_state: e.to_state,
        has_error: ["rejected", "blocked"].includes(e.to_state),
      });
    }
  }

  // Batch open failures per manifest.
  const batchFail = new Map<string, boolean>();
  for (const b of (batches.data ?? []) as any[]) {
    if (b.status === "failed") batchFail.set(b.manifest_id, true);
  }

  const input: AutopilotInput = {
    run_id: crypto.randomUUID(),
    mode,
    requested_actions: "auto",
    evaluated_at_reference: new Date().toISOString(),
    manifests: manifestRows.map((m) => ({
      manifest_id: m.id,
      complete: Boolean(m.id && m.bundle_id && m.version_name),
      has_privacy_url: !!m.privacy_url,
      has_support_url: !!m.support_url,
    })),
    review_gates: (gates.data ?? []).map((g: any) => ({
      manifest_id: g.manifest_id,
      review_state: g.review_state,
      review_ready: g.review_state === "review_ready",
      android_ready: !!g.android_ready,
      ios_ready: !!g.ios_ready,
      blocker_count: Array.isArray(g.blockers) ? g.blockers.length : 0,
    })),
    candidates: (candidates.data ?? []).map((c: any) => ({
      candidate_id: c.id,
      manifest_id: c.manifest_id,
      status: c.status,
      invalidated: c.status === "invalidated",
      manifest_hash: c.manifest_hash,
      listing_hash: c.listing_hash,
      package_hash: c.package_hash,
      build_hash: c.build_hash,
      created_at_reference: c.created_at,
    })),
    lifecycle: manifestIds.map((id: string) => ({
      manifest_id: id,
      current_state: latestLifecycle.get(id)?.current_state ?? "unknown",
      has_error: latestLifecycle.get(id)?.has_error ?? false,
    })),
    builds: (builds.data ?? []) as any[],
    listings: (listings.data ?? []) as any[],
    screenshots: screenshotsAgg,
    kpi: [],
    batch_status: manifestIds.map((id: string) => ({
      manifest_id: id,
      has_open_failures: batchFail.get(id) ?? false,
    })),
    hash_drift: manifestIds.map((id: string) => ({ manifest_id: id, drifted: false })),
    known_limitations: { lifecycle_implemented: true, iap_dispatcher_present: true },
  };

  const plan = planAutopilot(input);

  if (simulation) {
    return json({ simulation: true, plan });
  }

  const { data: runRow, error: runErr } = await supabase
    .from("store_ops_autopilot_runs")
    .insert({
      id: input.run_id,
      mode,
      state: "planned",
      risk_score: plan.risk_score,
      risk_level: plan.risk_level,
      safe_count: plan.safe_actions.length,
      manual_count: plan.manual_actions.length,
      blocked_count: plan.blocked_actions.length,
      estimated_runtime_seconds: plan.estimated_runtime_seconds,
      recommended_sequence: plan.recommended_sequence,
      next_manual_step: plan.next_manual_step,
      warnings: plan.warnings,
      evaluated_at: plan.evaluated_at_reference,
      created_by: gate.userId,
    })
    .select()
    .single();
  if (runErr) return json({ error: "persist_failed", details: runErr.message }, 500);

  const allActions = [...plan.safe_actions, ...plan.manual_actions, ...plan.blocked_actions];
  if (allActions.length > 0) {
    const ins = await supabase.from("store_ops_autopilot_actions").insert(
      allActions.map((a) => ({
        run_id: input.run_id,
        manifest_id: a.manifest_id,
        action_type: a.action_type,
        status: a.status,
        blockers: a.blockers,
      })),
    );
    if (ins.error) return json({ error: "actions_persist_failed", details: ins.error.message }, 500);
  }

  await supabase.from("security_events").insert({
    event_type: "autopilot_planned",
    severity: "info",
    user_id: gate.userId,
    metadata: buildPlanAudit(plan),
  });

  return json({ run: runRow, plan });
});
