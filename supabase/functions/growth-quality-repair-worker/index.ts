// growth-quality-repair-worker
// ─────────────────────────────
// Claims and processes pending jobs of types:
//   - growth_quality_repair_cta
//   - growth_quality_repair_funnel_audit
//
// For each claimed job:
//   1. Run corresponding audit RPC (fn_audit_growth_cta / fn_audit_growth_funnel)
//   2. Write result to job_queue.result + mark completed
//   3. Audit-log into auto_heal_log (action_type='growth_quality_repair_worker')
//
// Triggered by cron (every 5 min) or manual invoke. Returns a summary.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HANDLED_TYPES = [
  "growth_quality_repair_cta",
  "growth_quality_repair_funnel_audit",
] as const;

const TYPE_TO_RPC: Record<string, string> = {
  growth_quality_repair_cta: "fn_audit_growth_cta",
  growth_quality_repair_funnel_audit: "fn_audit_growth_funnel",
};

const MAX_CLAIM = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const startedAt = new Date().toISOString();
  const lockToken = `growth-quality-repair-worker:${crypto.randomUUID()}`;

  // 1. Claim up to MAX_CLAIM pending jobs (oldest first)
  const { data: claimables, error: claimErr } = await supa
    .from("job_queue")
    .select("id, job_type, package_id, payload, attempts")
    .in("job_type", HANDLED_TYPES as unknown as string[])
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_CLAIM);

  if (claimErr) {
    return new Response(
      JSON.stringify({ status: "error", phase: "claim_select", error: claimErr.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }

  const results: Array<Record<string, unknown>> = [];

  for (const job of claimables ?? []) {
    // Soft-claim: flip pending → processing only if still pending
    const { data: claimed, error: lockErr } = await supa
      .from("job_queue")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        locked_at: new Date().toISOString(),
        locked_by: lockToken,
        attempts: (job.attempts ?? 0) + 1,
      })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (lockErr || !claimed) {
      results.push({ job_id: job.id, status: "skipped", reason: lockErr?.message ?? "race_lost" });
      continue;
    }

    const rpcName = TYPE_TO_RPC[job.job_type];
    const packageId = job.package_id ?? (job.payload as any)?.package_id;

    if (!rpcName || !packageId) {
      await markJob(supa, job.id, "failed", null, "missing_rpc_or_package_id");
      await audit(supa, packageId, job.job_type, "failed", "missing_rpc_or_package_id", {
        job_id: job.id,
      });
      results.push({ job_id: job.id, status: "failed", reason: "missing_rpc_or_package_id" });
      continue;
    }

    const { data: auditResult, error: rpcErr } = await supa.rpc(rpcName, {
      p_package_id: packageId,
    });

    if (rpcErr) {
      await markJob(supa, job.id, "failed", null, rpcErr.message);
      await audit(supa, packageId, job.job_type, "failed", rpcErr.message, {
        job_id: job.id,
      });
      results.push({ job_id: job.id, status: "failed", reason: rpcErr.message });
      continue;
    }

    await markJob(supa, job.id, "completed", auditResult, null);
    await audit(
      supa,
      packageId,
      job.job_type,
      "completed",
      (auditResult as any)?.verdict ?? "ok",
      { job_id: job.id, verdict: (auditResult as any)?.verdict, recommended_action: (auditResult as any)?.recommended_action },
    );

    results.push({
      job_id: job.id,
      package_id: packageId,
      job_type: job.job_type,
      status: "completed",
      verdict: (auditResult as any)?.verdict,
    });
  }

  return new Response(
    JSON.stringify({
      status: "ok",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      claimed: results.length,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});

async function markJob(
  supa: ReturnType<typeof createClient>,
  jobId: string,
  status: "completed" | "failed",
  result: unknown,
  lastError: string | null,
) {
  await supa
    .from("job_queue")
    .update({
      status,
      completed_at: new Date().toISOString(),
      result: result as any,
      last_error: lastError,
    })
    .eq("id", jobId);
}

async function audit(
  supa: ReturnType<typeof createClient>,
  packageId: string | null | undefined,
  jobType: string,
  resultStatus: string,
  resultDetail: string,
  metadata: Record<string, unknown>,
) {
  await supa.from("auto_heal_log").insert({
    action_type: "growth_quality_repair_worker",
    target_id: packageId ?? null,
    target_type: "package",
    result_status: resultStatus,
    result_detail: resultDetail,
    metadata: { ...metadata, job_type: jobType, worker: "growth-quality-repair-worker" },
  });
}
