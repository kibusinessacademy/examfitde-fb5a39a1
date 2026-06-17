// Bundle B / B2 — Publish Guard Repair
// When `package_auto_publish` is blocked with a P0001 guard reason, classify the
// guard code, reserve a repair slot, enqueue the matching repair job, and trigger
// a quality recheck before allowing a retry. Never bypasses the guard itself.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SCOPE = "publish_guard";

type Cause =
  | "missing_price"
  | "missing_artifacts"
  | "quality_gate_blocked"
  | "seo_page_missing"
  | "license_config_missing"
  | "stripe_price_missing";

function classifyGuard(err: string): Cause | null {
  const s = (err || "").toLowerCase();
  if (s.includes("stripe") && s.includes("price")) return "stripe_price_missing";
  if (s.includes("license") && s.includes("config")) return "license_config_missing";
  if (s.includes("seo") && (s.includes("page") || s.includes("pillar"))) return "seo_page_missing";
  if (s.includes("quality") || s.includes("gate") || s.includes("blocked")) return "quality_gate_blocked";
  if (s.includes("price") || s.includes("no_price")) return "missing_price";
  if (s.includes("artifact") || s.includes("missing_artifact")) return "missing_artifacts";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const summary = { scanned: 0, repaired: 0, skipped: 0, unclassified: 0, errors: [] as any[] };

  try {
    // 1) find blocked auto_publish jobs (failed in last 24h with guard-shaped errors)
    const { data: jobs, error } = await supa
      .from("job_queue")
      .select("id,payload,last_error,status,created_at")
      .eq("job_name", "package_auto_publish")
      .eq("status", "failed")
      .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;
    summary.scanned = jobs?.length || 0;

    for (const job of jobs || []) {
      const pkgId = (job.payload as any)?.package_id;
      if (!pkgId) continue;

      const cause = classifyGuard(String(job.last_error || ""));
      if (!cause) {
        summary.unclassified++;
        continue;
      }

      try {
        const { data: reserve, error: rErr } = await supa.rpc("fn_selfheal_reserve_slot", {
          p_package_id: pkgId,
          p_scope: SCOPE,
          p_cause_code: cause,
        });
        if (rErr) throw rErr;

        if (!reserve?.ok) {
          summary.skipped++;
          continue;
        }

        const policy = reserve.policy;

        // enqueue repair job
        const { data: repairJob, error: jErr } = await supa
          .from("job_queue")
          .insert({
            job_name: policy.repair_job_name,
            payload: { package_id: pkgId, reason: cause, source: "selfheal_publish_guard" },
            priority: 5,
            status: "queued",
          })
          .select("id")
          .single();
        if (jErr) throw jErr;

        // enqueue quality recheck + publish retry as follow-ups
        await supa.from("job_queue").insert([
          {
            job_name: "package_quality_gate_recheck",
            payload: { package_id: pkgId, source: "selfheal_publish_guard_followup" },
            priority: 6,
            status: "queued",
          },
          {
            job_name: "package_auto_publish",
            payload: { package_id: pkgId, source: "selfheal_publish_guard_retry" },
            priority: 7,
            status: "queued",
          },
        ]);

        await supa.rpc("fn_selfheal_commit_repair", {
          p_package_id: pkgId,
          p_scope: SCOPE,
          p_cause_code: cause,
          p_repair_action: policy.repair_action,
          p_repair_job_id: repairJob.id,
          p_attempt_no: reserve.attempt_no,
          p_evidence: { guard_error: job.last_error, failed_job_id: job.id },
        });

        summary.repaired++;
      } catch (e) {
        summary.errors.push({ package_id: pkgId, error: String(e) });
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
