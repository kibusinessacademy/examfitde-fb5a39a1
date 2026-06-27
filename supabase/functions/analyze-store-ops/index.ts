// STORE.OPS.INTELLIGENCE.OS.1 — analyze-store-ops (admin-only).
// Read-only analysis over existing StoreOps snapshots. Persists run + findings.
// NO publish, NO submit, NO rollout, NO Store API, NO new write paths beyond own tables.

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { projectIntelligence } from "../_shared/storeOpsIntelligence/projection.ts";
import { buildIntelligenceAudit } from "../_shared/storeOpsIntelligence/audit.ts";
import type { IntelligenceInput } from "../_shared/storeOpsIntelligence/contracts.ts";

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

  const gate = await assertAdmin(req, "analyze-store-ops");
  if (!gate.ok) return json({ error: gate.reason }, gate.status);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [batches, items, kpi, runs, actions] = await Promise.all([
    supabase.from("store_ops_batches").select("id, state, total, succeeded, failed, blocked, skipped, created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("store_ops_batch_items").select("batch_id, manifest_id, action_type, status, blockers").limit(2000),
    supabase.from("store_ops_kpi_snapshots").select("id, health_score, blocked_count, rejected_count, build_success_rate, top_rejection_reasons, top_blockers, created_at").order("created_at", { ascending: false }).limit(50),
    supabase.from("store_ops_autopilot_runs").select("id, mode, state, risk_score, risk_level, safe_count, manual_count, blocked_count, succeeded, failed, evaluated_at").order("evaluated_at", { ascending: false }).limit(200),
    supabase.from("store_ops_autopilot_actions").select("run_id, manifest_id, action_type, status, blockers").limit(2000),
  ]);

  const errs = [batches, items, kpi, runs, actions].map((r) => r.error?.message).filter(Boolean);
  if (errs.length) return json({ error: "load_failed", details: errs }, 500);

  const evaluatedAt = new Date().toISOString();
  const input: IntelligenceInput = {
    run_id: crypto.randomUUID(),
    evaluated_at_reference: evaluatedAt,
    batches: (batches.data ?? []).map((b: any) => ({
      batch_id: b.id,
      state: b.state ?? "unknown",
      total: b.total ?? 0,
      succeeded: b.succeeded ?? 0,
      failed: b.failed ?? 0,
      blocked: b.blocked ?? 0,
      skipped: b.skipped ?? 0,
      created_at_reference: b.created_at ?? evaluatedAt,
    })),
    batch_items: (items.data ?? []).map((i: any) => ({
      batch_id: i.batch_id,
      manifest_id: i.manifest_id,
      action_type: i.action_type,
      status: i.status,
      blocker_codes: Array.isArray(i.blockers)
        ? i.blockers.map((b: any) => (typeof b === "string" ? b : b?.code)).filter(Boolean)
        : [],
    })),
    kpi_history: (kpi.data ?? []).map((s: any) => ({
      snapshot_id: s.id,
      health_score: Number(s.health_score ?? 0),
      blocked_count: Number(s.blocked_count ?? 0),
      rejected_count: Number(s.rejected_count ?? 0),
      build_success_rate: Number(s.build_success_rate ?? 0),
      top_rejection_reasons: Array.isArray(s.top_rejection_reasons) ? s.top_rejection_reasons : [],
      top_blockers: Array.isArray(s.top_blockers) ? s.top_blockers : [],
      created_at_reference: s.created_at ?? evaluatedAt,
    })),
    autopilot_runs: (runs.data ?? []).map((r: any) => ({
      run_id: r.id,
      mode: r.mode,
      state: r.state,
      risk_score: Number(r.risk_score ?? 0),
      risk_level: r.risk_level,
      safe_count: Number(r.safe_count ?? 0),
      manual_count: Number(r.manual_count ?? 0),
      blocked_count: Number(r.blocked_count ?? 0),
      succeeded: Number(r.succeeded ?? 0),
      failed: Number(r.failed ?? 0),
      evaluated_at_reference: r.evaluated_at ?? evaluatedAt,
    })),
    autopilot_actions: (actions.data ?? []).map((a: any) => ({
      run_id: a.run_id,
      manifest_id: a.manifest_id,
      action_type: a.action_type,
      status: a.status,
      blocker_codes: Array.isArray(a.blockers)
        ? a.blockers.map((b: any) => (typeof b === "string" ? b : b?.code)).filter(Boolean)
        : [],
    })),
  };

  const projection = projectIntelligence(input);

  const { data: runRow, error: runErr } = await supabase
    .from("store_ops_intelligence_runs")
    .insert({
      id: input.run_id,
      evaluated_at: evaluatedAt,
      risk_total: projection.risk.total,
      risk_level: projection.risk.level,
      risk_technical: projection.risk.technical,
      risk_governance: projection.risk.governance,
      risk_operational: projection.risk.operational,
      confidence_score: projection.confidence.score,
      confidence_breakdown: projection.confidence,
      recommendation_codes: projection.recommendations.map((r) => r.code),
      warnings: projection.warnings,
      input_batches_count: input.batches.length,
      input_runs_count: input.autopilot_runs.length,
      input_kpi_count: input.kpi_history.length,
      created_by: gate.userId,
    })
    .select()
    .single();
  if (runErr) return json({ error: "persist_failed", details: runErr.message }, 500);

  if (projection.findings.length > 0) {
    const ins = await supabase.from("store_ops_intelligence_findings").insert(
      projection.findings.map((f) => ({
        run_id: input.run_id,
        kind: f.kind,
        key: f.key,
        value_numeric: f.value_numeric,
        value_text: f.value_text,
        detail: f.detail,
      })),
    );
    if (ins.error) return json({ error: "findings_persist_failed", details: ins.error.message }, 500);
  }

  await supabase.from("security_events").insert({
    event_type: "store_ops_intelligence_analyzed",
    severity: "info",
    user_id: gate.userId,
    metadata: buildIntelligenceAudit(projection),
  });

  return json({ run: runRow, projection });
});
