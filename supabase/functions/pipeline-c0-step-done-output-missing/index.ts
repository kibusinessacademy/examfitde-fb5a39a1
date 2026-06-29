// CUT C0 — STEP_DONE_OUTPUT_MISSING.ROOT_CAUSE.1
// READ-ONLY forensic snapshot runner. Persists a classified inventory of
// `generate_blueprint_variants` steps that are status='done' but have no
// `blueprint_variants` rows. NEVER modifies pipeline state.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: capture, error: capErr } = await sb.rpc(
      "capture_step_done_output_missing_snapshot",
    );
    if (capErr) throw capErr;

    // Last 3 runs for trend
    const { data: history, error: histErr } = await sb
      .from("step_done_output_missing_snapshots")
      .select("run_id, captured_at, root_cause_code")
      .order("captured_at", { ascending: false })
      .limit(5000);
    if (histErr) throw histErr;

    const byRun = new Map<string, { captured_at: string; total: number; breakdown: Record<string, number> }>();
    for (const row of history ?? []) {
      const e = byRun.get(row.run_id) ?? { captured_at: row.captured_at as string, total: 0, breakdown: {} };
      e.total++;
      e.breakdown[row.root_cause_code] = (e.breakdown[row.root_cause_code] ?? 0) + 1;
      byRun.set(row.run_id, e);
    }
    const trend = [...byRun.entries()]
      .map(([run_id, v]) => ({ run_id, ...v }))
      .sort((a, b) => b.captured_at.localeCompare(a.captured_at))
      .slice(0, 5);

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "read_only",
        capture,
        root_cause_catalog: {
          R1_RECONCILER_FALSE_DONE:
            "verifier-reconciler / standalone_reconciler flipped status→done based on meta.ok=true without verifying blueprint_variants rows exist.",
          R2_STUCK_SCAN_ZOMBIE:
            "stuck-scan or 'zombie finalization' note finalized the step from queued→done without output verification.",
          R3_ADMIN_HEAL_NO_VERIFY:
            "admin_finalize_materialized_blueprint_variant_steps marked step done during manual heal without verifying outputs.",
          R4_RUNNER_META_HEURISTIC:
            "pipeline-runner used step_meta / latest_completed_job heuristics to call markStepDone; persistence never produced rows.",
          R5_UNKNOWN_LEGACY:
            "No finalized_by lineage in meta — legacy completion path, attribution unknown.",
          R6_OTHER: "Other finalized_by signature.",
        },
        evidence_signal_keys: [
          "had_markstepdone_mismatch",       // trigger reverted markStepDone
          "had_trigger_rollback",            // explicit 'rolled back by a trigger'
          "had_causality_blocked",           // upstream validate_blueprints never done
          "meta_ok",                         // meta.ok=true used as finalization signal
        ],
        recent_runs: trend,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
