// Bundle B / B1 — Handbook Tail Auto-Repair
// Scans for packages whose `validate_handbook_depth` step is in softFail / failed,
// classifies cause, reserves a repair slot, enqueues the repair job, and retries
// the validate step. Audit-only — never bypasses the DAG.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STEP_KEY = "validate_handbook_depth";
const SCOPE = "handbook_tail";
const SOFT_FAIL_STATUSES = ["soft_failed", "failed"];

type Cause =
  | "depth_too_shallow"
  | "missing_sections"
  | "thin_competency_coverage"
  | "expand_job_stale"
  | "expand_job_failed";

interface ClassifyInput {
  step: any;
  expandJobs: any[];
}

function classify({ step, expandJobs }: ClassifyInput): Cause {
  const err = String(step?.last_error || "").toLowerCase();
  const meta = step?.meta || {};

  if (err.includes("missing_section") || meta?.missing_sections?.length) return "missing_sections";
  if (err.includes("competency") || err.includes("coverage")) return "thin_competency_coverage";
  if (err.includes("depth") || err.includes("shallow") || err.includes("too_short")) return "depth_too_shallow";

  const failed = expandJobs.filter((j) => j.status === "failed").length;
  const stale = expandJobs.filter((j) => {
    if (j.status !== "running" && j.status !== "queued") return false;
    const hb = j.last_heartbeat_at ? new Date(j.last_heartbeat_at).getTime() : 0;
    return hb && Date.now() - hb > 30 * 60_000;
  }).length;

  if (failed > 0) return "expand_job_failed";
  if (stale > 0) return "expand_job_stale";

  // Default to shallow — safest expand action
  return "depth_too_shallow";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const summary = { scanned: 0, repaired: 0, skipped: 0, errors: [] as any[] };

  try {
    // 1) find candidate steps
    const { data: steps, error } = await supa
      .from("package_steps")
      .select("id,package_id,status,last_error,meta,attempts,max_attempts")
      .eq("step_key", STEP_KEY)
      .in("status", SOFT_FAIL_STATUSES)
      .limit(20);

    if (error) throw error;
    summary.scanned = steps?.length || 0;

    for (const step of steps || []) {
      try {
        // 2) gather expand-job evidence
        const { data: expandJobs } = await supa
          .from("job_queue")
          .select("id,status,last_heartbeat_at,last_error")
          .eq("job_name", "expand_handbook_section")
          .contains("payload", { package_id: step.package_id })
          .order("created_at", { ascending: false })
          .limit(50);

        const cause = classify({ step, expandJobs: expandJobs || [] });

        // 3) reserve repair slot
        const { data: reserve, error: rErr } = await supa.rpc("fn_selfheal_reserve_slot", {
          p_package_id: step.package_id,
          p_scope: SCOPE,
          p_cause_code: cause,
        });
        if (rErr) throw rErr;

        if (!reserve?.ok) {
          summary.skipped++;
          continue;
        }

        const policy = reserve.policy;

        // 4) enqueue repair job (via job_queue)
        const { data: job, error: jobErr } = await supa
          .from("job_queue")
          .insert({
            job_name: policy.repair_job_name,
            payload: { package_id: step.package_id, reason: cause, source: "selfheal_handbook_tail" },
            priority: 5,
            status: "queued",
          })
          .select("id")
          .single();
        if (jobErr) throw jobErr;

        // 5) commit ledger
        await supa.rpc("fn_selfheal_commit_repair", {
          p_package_id: step.package_id,
          p_scope: SCOPE,
          p_cause_code: cause,
          p_repair_action: policy.repair_action,
          p_repair_job_id: job.id,
          p_attempt_no: reserve.attempt_no,
          p_evidence: { step_id: step.id, last_error: step.last_error, expand_jobs: (expandJobs || []).length },
        });

        // 6) reset step to queued for retry (within max_attempts)
        if ((step.attempts ?? 0) < (step.max_attempts ?? 3)) {
          await supa
            .from("package_steps")
            .update({ status: "queued", last_error: `repair_enqueued:${cause}` })
            .eq("id", step.id);
        }

        summary.repaired++;
      } catch (e) {
        summary.errors.push({ package_id: step.package_id, error: String(e) });
      }
    }

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e), summary }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
