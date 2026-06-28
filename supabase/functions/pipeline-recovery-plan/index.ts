// pipeline-recovery-plan
// Reads snapshot from DB and runs the pure SSOT to return a RecoverySummary.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { buildRecoverySummary } from "../_shared/pipelineRecovery/index.ts";
import type {
  PackageSnapshot, JobSnapshot, WorkerSnapshot, RecoveryInput,
} from "../_shared/pipelineRecovery/contracts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hash(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `h_${h.toString(36)}_${s.length}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const now = new Date().toISOString();

    const [{ data: pkgRows }, { data: jobRows }, { data: workerRows }] = await Promise.all([
      sb.from("course_packages")
        .select("id,status,track,build_progress,integrity_passed,council_approved,council_approved_at,published_at,is_published,updated_at")
        .in("status", ["planning", "building", "done"])
        .limit(2000),
      sb.from("job_queue")
        .select("job_type,status,package_id,attempts,max_attempts,last_error,locked_by,updated_at")
        .in("status", ["pending", "processing", "failed"])
        .limit(5000),
      sb.from("ops_worker_heartbeats")
        .select("worker_id,job_types,last_heartbeat_at")
        .limit(200),
    ]);

    const packages: PackageSnapshot[] = (pkgRows ?? []).map((r: Record<string, unknown>) => ({
      package_id: r.id as string,
      status: (r.status as string) ?? "unknown",
      track: (r.track as string | null) ?? null,
      build_progress: Number(r.build_progress ?? 0),
      integrity_passed: (r.integrity_passed as boolean | null) ?? null,
      council_approved: (r.council_approved as boolean | null) ?? null,
      council_approved_at: (r.council_approved_at as string | null) ?? null,
      published_at: (r.published_at as string | null) ?? null,
      is_published: (r.is_published as boolean | null) ?? null,
      updated_at: (r.updated_at as string) ?? now,
    }));

    const jobs: JobSnapshot[] = (jobRows ?? []).map((r: Record<string, unknown>) => ({
      job_type: r.job_type as string,
      status: r.status as string,
      package_id: (r.package_id as string | null) ?? null,
      attempts: Number(r.attempts ?? 0),
      max_attempts: Number(r.max_attempts ?? 5),
      last_error: (r.last_error as string | null) ?? null,
      locked_by: (r.locked_by as string | null) ?? null,
      updated_at: (r.updated_at as string) ?? now,
    }));

    const workers: WorkerSnapshot[] = (workerRows ?? []).map((r: Record<string, unknown>) => ({
      worker_id: r.worker_id as string,
      job_types: (r.job_types as string[] | null) ?? [],
      last_heartbeat_at: (r.last_heartbeat_at as string) ?? now,
    }));

    const input: RecoveryInput = { now, packages, jobs, workers };
    const summary = buildRecoverySummary(input);
    const h = hash(summary);

    // Best-effort cache
    await sb.from("pipeline_recovery_plans")
      .upsert({ hash: h, scope: "full", summary, plan: summary.plans }, { onConflict: "hash" });

    return new Response(JSON.stringify({ ok: true, hash: h, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pipeline-recovery-plan error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
