// STORE.OPS.AUTOPILOT.OS.1 — run-store-autopilot (admin-only)
// Executes ONLY safe Autopilot actions by delegating to the existing
// admin-only edge functions (KPI snapshot, lifecycle projection, batch plan).
// NO publish, NO submit, NO rollout, NO Store API.

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { decideExecution } from "../_shared/storeOpsAutopilot/autopilotDecision.ts";
import { projectAutopilot } from "../_shared/storeOpsAutopilot/autopilotProjection.ts";
import { buildProjectionAudit } from "../_shared/storeOpsAutopilot/audit.ts";
import {
  ALLOWED_AUTOPILOT_ACTIONS,
  type AutopilotAction,
  type AutopilotActionType,
  type AutopilotExecutionResult,
  type AutopilotMode,
  type AutopilotPlan,
  type RiskLevel,
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

/** Map of allowed autopilot action -> existing admin edge function (or null = no-op marker). */
const ACTION_DISPATCH: Partial<Record<AutopilotActionType, string | null>> = {
  run_review_gate: "evaluate-store-review-ready",
  run_store_ops_kpi: "evaluate-store-ops-kpi",
  run_lifecycle_projection: "project-store-lifecycle",
  refresh_projection: "evaluate-store-ops-kpi",
  // The remaining actions are surfaced as manual_required by the planner unless explicitly
  // wired by an operator. Autopilot never invokes Store APIs.
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await assertAdmin(req, "run-store-autopilot");
  if (!gate.ok) return json({ error: gate.reason }, gate.status);

  let body: { run_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.run_id) return json({ error: "run_id_required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: runRow, error: runErr } = await supabase
    .from("store_ops_autopilot_runs")
    .select("*")
    .eq("id", body.run_id)
    .maybeSingle();
  if (runErr || !runRow) return json({ error: "run_not_found" }, 404);

  const { data: actionsRows, error: actionsErr } = await supabase
    .from("store_ops_autopilot_actions")
    .select("manifest_id, action_type, status, blockers")
    .eq("run_id", body.run_id);
  if (actionsErr) return json({ error: "actions_load_failed" }, 500);

  const safe: AutopilotAction[] = (actionsRows ?? [])
    .filter((a: any) => a.status === "safe")
    .map((a: any) => ({
      manifest_id: a.manifest_id,
      action_type: a.action_type as AutopilotActionType,
      status: "safe",
      blockers: [],
      estimated_runtime_seconds: 0,
    }));
  const blockedCount = (actionsRows ?? []).filter((a: any) => a.status === "blocked").length;
  const manualCount = (actionsRows ?? []).filter((a: any) => a.status === "manual_required").length;

  const plan: AutopilotPlan = {
    run_id: runRow.id,
    mode: runRow.mode as AutopilotMode,
    evaluated_at_reference: runRow.evaluated_at,
    safe_actions: safe,
    manual_actions: [],
    blocked_actions: [],
    risk_score: runRow.risk_score,
    risk_level: runRow.risk_level as RiskLevel,
    estimated_runtime_seconds: runRow.estimated_runtime_seconds,
    recommended_sequence: runRow.recommended_sequence ?? [],
    next_manual_step: runRow.next_manual_step,
    warnings: [],
  };

  const decision = decideExecution(plan, runRow.mode as AutopilotMode);
  if (!decision.should_execute) {
    await supabase
      .from("store_ops_autopilot_runs")
      .update({ state: "blocked", updated_at: new Date().toISOString() })
      .eq("id", runRow.id);
    return json({ skipped: true, reason: decision.reason });
  }

  await supabase
    .from("store_ops_autopilot_runs")
    .update({ state: "running", updated_at: new Date().toISOString() })
    .eq("id", runRow.id);

  await supabase.from("security_events").insert({
    event_type: "autopilot_started",
    severity: "info",
    user_id: gate.userId,
    metadata: { run_id: runRow.id, mode: runRow.mode, safe_count: safe.length },
  });

  const results: AutopilotExecutionResult[] = [];
  for (const action of decision.executable_actions) {
    if (!ALLOWED_AUTOPILOT_ACTIONS.includes(action.action_type)) {
      results.push({
        manifest_id: action.manifest_id,
        action_type: action.action_type,
        status: "blocked",
        message: "Action not in allow-list",
      });
      continue;
    }

    const target = ACTION_DISPATCH[action.action_type];
    if (!target) {
      // No dispatcher wired — treat as skipped (manual operator action).
      results.push({ manifest_id: action.manifest_id, action_type: action.action_type, status: "skipped", message: "no_dispatcher" });
      await supabase.from("store_ops_autopilot_actions").insert({
        run_id: runRow.id,
        manifest_id: action.manifest_id,
        action_type: action.action_type,
        status: "skipped",
        message: "no_dispatcher",
      });
      continue;
    }

    try {
      const { error: invokeErr } = await supabase.functions.invoke(target, {
        body: { manifest_id: action.manifest_id, source: "autopilot", run_id: runRow.id },
      });
      const status = invokeErr ? "failed" : "succeeded";
      results.push({ manifest_id: action.manifest_id, action_type: action.action_type, status, message: invokeErr?.message });
      await supabase.from("store_ops_autopilot_actions").insert({
        run_id: runRow.id,
        manifest_id: action.manifest_id,
        action_type: action.action_type,
        status,
        message: invokeErr?.message,
      });
      await supabase.from("security_events").insert({
        event_type: status === "succeeded" ? "autopilot_action_completed" : "autopilot_action_blocked",
        severity: status === "succeeded" ? "info" : "warning",
        user_id: gate.userId,
        metadata: { run_id: runRow.id, manifest_id: action.manifest_id, action_type: action.action_type, target },
      });
    } catch (e: any) {
      results.push({ manifest_id: action.manifest_id, action_type: action.action_type, status: "failed", message: e?.message });
      await supabase.from("store_ops_autopilot_actions").insert({
        run_id: runRow.id,
        manifest_id: action.manifest_id,
        action_type: action.action_type,
        status: "failed",
        message: e?.message ?? "error",
      });
    }
  }

  const projection = projectAutopilot(plan, results, new Date().toISOString());
  await supabase
    .from("store_ops_autopilot_runs")
    .update({
      state: projection.state,
      succeeded: projection.succeeded,
      failed: projection.failed,
      blocked_count: blockedCount,
      manual_count: manualCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runRow.id);

  await supabase.from("security_events").insert({
    event_type: "autopilot_finished",
    severity: "info",
    user_id: gate.userId,
    metadata: buildProjectionAudit("autopilot_finished", projection),
  });

  return json({ run_id: runRow.id, projection, results });
});
