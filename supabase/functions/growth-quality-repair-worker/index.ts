// growth-quality-repair-worker (Welle 5.2 — Foundation-Bridge)
// ─────────────────────────────────────────────────────────────
// Claims pending jobs of types:
//   - growth_quality_repair_cta             (subscore=cta)
//   - growth_quality_repair_funnel_audit    (subscore=funnel_events)
//
// For each claimed job:
//   1. fn_growth_repair_start_run(package_id, subscore, job_id)  → snapshots pre_score
//   2. Run audit RPC (fn_audit_growth_cta / fn_audit_growth_funnel)
//   3. fn_growth_repair_complete_run(run_id, artifact_ref, …)    → applies gate
//        - audit_only modules: kein council
//        - Fail-Closed wenn post_score IS NULL (Welle 5.2)
//   4. job_queue → completed/failed (mit run_id im result)
//   5. auto_heal_log Audit
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

const TYPE_TO_SUBSCORE: Record<string, string> = {
  growth_quality_repair_cta: "cta",
  growth_quality_repair_funnel_audit: "funnel_events",
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
    const subscore = TYPE_TO_SUBSCORE[job.job_type];
    const packageId = job.package_id ?? (job.payload as any)?.package_id;

    if (!rpcName || !subscore || !packageId) {
      await markJob(supa, job.id, "failed", null, "missing_rpc_or_package_id");
      await audit(supa, packageId, job.job_type, "failed", "missing_rpc_or_package_id", { job_id: job.id });
      results.push({ job_id: job.id, status: "failed", reason: "missing_rpc_or_package_id" });
      continue;
    }

    // 1. Start repair-run (snapshots pre_score, enforces module enabled)
    const { data: runId, error: startErr } = await supa.rpc("fn_growth_repair_start_run", {
      p_package_id: packageId,
      p_subscore: subscore,
      p_job_id: job.id,
    });

    if (startErr || !runId) {
      const msg = startErr?.message ?? "start_run_failed";
      await markJob(supa, job.id, "failed", null, msg);
      await audit(supa, packageId, job.job_type, "failed", msg, { job_id: job.id, phase: "start_run" });
      results.push({ job_id: job.id, status: "failed", reason: msg });
      continue;
    }

    // 2. Audit
    const { data: auditResult, error: rpcErr } = await supa.rpc(rpcName, {
      p_package_id: packageId,
    });

    // 3. Complete repair-run (applies fail-closed gate)
    const { data: completeRes, error: completeErr } = await supa.rpc(
      "fn_growth_repair_complete_run",
      {
        p_run_id: runId,
        p_artifact_ref: auditResult ?? null,
        p_council_verdict: null,
        p_council_score: null,
        p_error: rpcErr ? rpcErr.message : null,
      },
    );

    const finalStatus = (completeRes as any)?.status as string | undefined;
    const gateReasons = (completeRes as any)?.gate_reasons ?? [];

    if (completeErr) {
      await markJob(supa, job.id, "failed", { run_id: runId, complete_error: completeErr.message }, completeErr.message);
      await audit(supa, packageId, job.job_type, "failed", completeErr.message, {
        job_id: job.id, run_id: runId, phase: "complete_run",
      });
      results.push({ job_id: job.id, run_id: runId, status: "failed", reason: completeErr.message });
      continue;
    }

    // job_queue mirrors run outcome
    const jobStatus: "completed" | "failed" =
      finalStatus === "completed" ? "completed" : "failed";
    await markJob(
      supa,
      job.id,
      jobStatus,
      { run_id: runId, run_status: finalStatus, audit: auditResult, gate_reasons: gateReasons },
      jobStatus === "failed" ? `gate_${finalStatus}: ${gateReasons.join(",")}` : null,
    );

    await audit(supa, packageId, job.job_type, finalStatus ?? "unknown",
      `subscore=${subscore} verdict=${(auditResult as any)?.verdict ?? "n/a"}`,
      {
        job_id: job.id,
        run_id: runId,
        run_status: finalStatus,
        gate_reasons: gateReasons,
        audit_verdict: (auditResult as any)?.verdict,
      });

    results.push({
      job_id: job.id,
      run_id: runId,
      package_id: packageId,
      job_type: job.job_type,
      subscore,
      run_status: finalStatus,
      gate_reasons: gateReasons,
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
    metadata: { ...metadata, job_type: jobType, worker: "growth-quality-repair-worker", wave: "5.2" },
  });
}
