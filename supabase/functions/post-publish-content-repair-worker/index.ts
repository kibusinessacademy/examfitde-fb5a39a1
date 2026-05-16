// supabase/functions/post-publish-content-repair-worker/index.ts
//
// M9.3b · Post-Publish Content-Repair Worker
// Scope: ONLY content_gap_published_locked. Bypasses package_pipeline_steps.
// Handles two job_types:
//   - post_publish_content_repair_lessons  → fn_m9_repair_lessons_for_package
//   - post_publish_content_repair_scaffold → noop (deferred, awaits M9.3c blueprint input)
//
// Idempotency enforced via job_queue.idempotency_key at enqueue time.
// Audit every outcome via auto_heal_log action_type='post_publish_content_repair_*'.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const HANDLED_JOB_TYPES = [
  "post_publish_content_repair_lessons",
  "post_publish_content_repair_scaffold",
];

const MAX_JOBS_PER_RUN = 10;
const WORKER_NAME = "post-publish-content-repair-worker";

type Outcome = {
  status: "completed" | "failed" | "noop";
  reason?: string;
  details?: Record<string, unknown>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function handleRepairLessons(
  sb: ReturnType<typeof createClient>,
  pkgId: string,
): Promise<Outcome> {
  const { data, error } = await sb.rpc("fn_m9_repair_lessons_for_package" as any, {
    p_package_id: pkgId,
  });
  if (error) return { status: "failed", reason: `rpc_error: ${error.message}` };
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok !== true) {
    return { status: "noop", reason: String(r.reason ?? "rpc_not_ok"), details: r };
  }
  const flipped = Number(r.lessons_flipped ?? 0);
  return {
    status: flipped > 0 ? "completed" : "noop",
    reason: flipped > 0 ? undefined : "no_lessons_to_flip",
    details: r,
  };
}

async function handleScaffold(
  _sb: ReturnType<typeof createClient>,
  _pkgId: string,
): Promise<Outcome> {
  // Deferred: scaffold path requires blueprint input (M9.3c).
  // We complete the job with noop so it doesn't loop forever.
  return {
    status: "noop",
    reason: "scaffold_deferred_pending_m9_3c_blueprint_input",
    details: { note: "Course/modules/lessons creation needs source blueprint — out of scope for M9.3b lesson-flip path." },
  };
}

const HANDLERS: Record<string, (sb: any, pkgId: string) => Promise<Outcome>> = {
  post_publish_content_repair_lessons: handleRepairLessons,
  post_publish_content_repair_scaffold: handleScaffold,
};

async function drainOnce(sb: any) {
  const { data: candidates, error: selErr } = await sb
    .from("job_queue")
    .select("id")
    .in("job_type", HANDLED_JOB_TYPES)
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_JOBS_PER_RUN);

  if (selErr) {
    console.error(`[${WORKER_NAME}] select error:`, selErr);
    return { claimed: 0, results: [] };
  }
  if (!candidates?.length) return { claimed: 0, results: [] };

  const ids = candidates.map((r: any) => r.id);
  const { data: claimed, error: claimErr } = await sb
    .from("job_queue")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      locked_at: new Date().toISOString(),
      locked_by: WORKER_NAME,
    })
    .in("id", ids)
    .eq("status", "pending")
    .select("id, job_type, payload");

  if (claimErr) {
    console.error(`[${WORKER_NAME}] claim error:`, claimErr);
    return { claimed: 0, results: [] };
  }
  if (!claimed?.length) return { claimed: 0, results: [] };

  const results: any[] = [];
  for (const job of claimed) {
    const pkgId = job.payload?.package_id as string | undefined;
    const handler = HANDLERS[job.job_type];
    let outcome: Outcome;

    if (!handler) {
      outcome = { status: "failed", reason: `unknown_job_type_${job.job_type}` };
    } else if (!pkgId) {
      outcome = { status: "failed", reason: "missing_package_id_in_payload" };
    } else {
      try {
        outcome = await handler(sb, pkgId);
      } catch (e) {
        outcome = { status: "failed", reason: "handler_exception", details: { error: (e as Error).message } };
      }
    }

    const dbStatus = outcome.status === "failed" ? "failed" : "completed";
    await sb.from("job_queue").update({
      status: dbStatus,
      completed_at: new Date().toISOString(),
      last_error: outcome.status === "failed" ? (outcome.reason ?? null) : null,
      result: { outcome: outcome.status, reason: outcome.reason ?? null, details: outcome.details ?? null },
    }).eq("id", job.id);

    await sb.from("auto_heal_log").insert({
      action_type: `post_publish_content_repair:${job.job_type.replace("post_publish_content_repair_", "")}`,
      trigger_source: `cron:${WORKER_NAME}`,
      target_type: "course_package",
      target_id: pkgId ?? null,
      result_status: outcome.status === "failed" ? "failed" : (outcome.status === "noop" ? "skipped" : "success"),
      metadata: {
        job_id: job.id,
        job_type: job.job_type,
        outcome: outcome.status,
        reason: outcome.reason ?? null,
        details: outcome.details ?? null,
      },
    });

    results.push({ job_id: job.id, job_type: job.job_type, package_id: pkgId, ...outcome });
  }

  return { claimed: claimed.length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const r = await drainOnce(sb);
    return json({ ok: true, worker: WORKER_NAME, ...r });
  } catch (e) {
    console.error(`[${WORKER_NAME}] fatal:`, e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
