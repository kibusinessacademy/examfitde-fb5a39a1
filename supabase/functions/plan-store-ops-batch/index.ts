// STORE.OPS.BATCH.OS.1 — plan-store-ops-batch (admin-only)
// Loads StoreOps snapshots, runs Pure SSOT plan, persists batch + items.
// NO publish, NO submit, NO rollout, NO Store API.

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { planBatch } from "../_shared/storeOpsBatch/batchPlan.ts";
import { buildBatchPlanAudit } from "../_shared/storeOpsBatch/audit.ts";
import type {
  BatchActionType,
  BatchPlanInput,
} from "../_shared/storeOpsBatch/contracts.ts";

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

  const gate = await assertAdmin(req, "plan-store-ops-batch");
  if (!gate.ok) return json({ error: gate.reason }, gate.status);

  let body: { manifest_ids?: string[]; selected_action_types?: string[]; batch_label?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const manifest_ids = (body.manifest_ids ?? []).filter((x) => typeof x === "string");
  const selected_action_types = (body.selected_action_types ?? []).filter(
    (x) => typeof x === "string",
  ) as BatchActionType[];
  if (manifest_ids.length === 0 || selected_action_types.length === 0) {
    return json({ error: "manifest_ids_and_actions_required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [manifests, builds, gates, kpi, lifecycle] = await Promise.all([
    supabase
      .from("mobile_course_app_manifest")
      .select("id, privacy_url, support_url, bundle_id, version_name")
      .in("id", manifest_ids),
    supabase.from("store_release_builds").select("manifest_id, platform, status").in("manifest_id", manifest_ids),
    supabase
      .from("store_review_gate")
      .select("manifest_id, review_state, android_ready, ios_ready, blockers")
      .in("manifest_id", manifest_ids),
    supabase.from("store_ops_kpi_snapshots").select("payload").order("created_at", { ascending: false }).limit(1),
    supabase.from("store_lifecycle_events").select("manifest_id, to_state, occurred_at_reference").in("manifest_id", manifest_ids),
  ]);

  const errs = [manifests, builds, gates, kpi, lifecycle].map((r) => r.error?.message).filter(Boolean);
  if (errs.length) return json({ error: "load_failed", details: errs }, 500);

  const lifecycleLatest = new Map<string, { current_state: string; blocked: boolean }>();
  for (const e of (lifecycle.data ?? []) as any[]) {
    const prev = lifecycleLatest.get(e.manifest_id);
    if (!prev) lifecycleLatest.set(e.manifest_id, {
      current_state: e.to_state,
      blocked: ["rejected", "blocked", "cancelled"].includes(e.to_state),
    });
  }

  const input: BatchPlanInput = {
    batch_id: crypto.randomUUID(),
    manifest_ids,
    selected_action_types,
    planned_at_reference: new Date().toISOString(),
    manifests: (manifests.data ?? []).map((m: any) => ({
      manifest_id: m.id,
      complete: Boolean(m.id && m.bundle_id && m.version_name),
      has_privacy_url: !!m.privacy_url,
      has_support_url: !!m.support_url,
    })),
    review_gates: (gates.data ?? []).map((g: any) => ({
      manifest_id: g.manifest_id,
      review_state: g.review_state,
      android_ready: !!g.android_ready,
      ios_ready: !!g.ios_ready,
      blocked: g.review_state === "blocked" || g.review_state === "build_failed",
    })),
    kpi: [],
    lifecycle: manifest_ids.map((id) => ({
      manifest_id: id,
      current_state: lifecycleLatest.get(id)?.current_state ?? "unknown",
      blocked: lifecycleLatest.get(id)?.blocked ?? false,
    })),
    builds: (builds.data ?? []) as any[],
  };

  const plan = planBatch(input);
  const blocked = plan.items.filter((i) => i.status === "blocked").length;

  const { data: insertedBatch, error: insertErr } = await supabase
    .from("store_ops_batches")
    .insert({
      id: input.batch_id,
      batch_label: body.batch_label ?? null,
      state: blocked === plan.items.length && plan.items.length > 0 ? "blocked" : "planned",
      selected_action_types,
      manifest_ids,
      total: plan.items.length,
      blocked,
      warnings: plan.warnings,
      planned_at: input.planned_at_reference,
      created_by: gate.userId,
    })
    .select()
    .single();

  if (insertErr) return json({ error: "persist_failed", details: insertErr.message }, 500);

  if (plan.items.length > 0) {
    const itemsErr = await supabase.from("store_ops_batch_items").insert(
      plan.items.map((i) => ({
        batch_id: input.batch_id,
        manifest_id: i.manifest_id,
        action_type: i.action_type,
        status: i.status,
        blockers: i.blockers,
      })),
    );
    if (itemsErr.error) return json({ error: "items_persist_failed", details: itemsErr.error.message }, 500);
  }

  await supabase.from("security_events").insert({
    event_type: "store_ops_batch_planned",
    severity: "info",
    user_id: gate.userId,
    metadata: buildBatchPlanAudit(plan),
  });

  return json({ batch: insertedBatch, plan });
});
