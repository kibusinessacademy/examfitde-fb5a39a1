import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * ai-generation-finalizer — Closes the loop on gateway requests.
 *
 * Called after domain import is complete (by batch-result-importer or sync callers).
 * Updates: ai_generation_requests → job_queue → package build steps.
 *
 * Can also be invoked as a sweep to catch any stuck records.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

interface FinalizeRequest {
  /** Finalize a specific gateway request */
  request_id?: string;
  /** Finalize a specific batch */
  batch_id?: string;
  /** Sweep: finalize all stuck completed-but-not-finalized records */
  sweep?: boolean;
  /** Max age in minutes for sweep (default 30) */
  sweep_max_age_minutes?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body: FinalizeRequest = await req.json().catch(() => ({}));
    const now = new Date().toISOString();
    let finalized = 0;
    let errors = 0;

    // ── Collect records to finalize ──
    let query = sb
      .from("ai_generation_requests")
      .select("id, job_type, status, source_id, source_ref, package_id, course_id, llm_batch_id, result_summary")
      .in("status", ["completed", "failed"]);

    if (body.request_id) {
      query = query.eq("id", body.request_id);
    } else if (body.batch_id) {
      query = query.eq("llm_batch_id", body.batch_id);
    } else if (body.sweep) {
      // Sweep: find records that completed but may not have had post-processing
      const maxAge = body.sweep_max_age_minutes || 30;
      const cutoff = new Date(Date.now() - maxAge * 60_000).toISOString();
      query = query
        .gte("completed_at", cutoff)
        .is("result_summary->finalized_at", null);
    } else {
      return json({ error: "Provide request_id, batch_id, or sweep:true" }, 400);
    }

    const { data: records, error: qErr } = await query.limit(200);
    if (qErr) throw qErr;
    if (!records?.length) return json({ ok: true, finalized: 0, message: "Nothing to finalize" });

    for (const rec of records) {
      try {
        // 1. Mark gateway request as finalized
        const existingSummary = (rec.result_summary && typeof rec.result_summary === "object")
          ? rec.result_summary as Record<string, unknown>
          : {};

        await sb.from("ai_generation_requests").update({
          result_summary: {
            ...existingSummary,
            finalized_at: now,
            finalizer_version: "v1",
          },
          updated_at: now,
        }).eq("id", rec.id);

        // 2. Update linked job_queue entries
        const jobStatus = rec.status === "completed" ? "completed" : "failed";
        const sourceRef = rec.source_ref as Record<string, unknown> | null;

        // Find job by source correlation
        if (rec.source_id || sourceRef?.job_id) {
          const jobId = (sourceRef?.job_id as string) || rec.source_id;
          if (jobId) {
            await sb.from("job_queue").update({
              status: jobStatus,
              updated_at: now,
              meta: sb.rpc ? undefined : undefined, // preserve existing meta
            }).eq("id", jobId).in("status", ["batch_pending", "processing", "running"]);
          }
        }

        // 3. Log finalization
        console.log(`[finalizer] ${rec.id.slice(0, 8)} → ${jobStatus} (${rec.job_type})`);
        finalized++;
      } catch (recErr) {
        console.error(`[finalizer] Error on ${rec.id.slice(0, 8)}: ${(recErr as Error).message}`);
        errors++;
      }
    }

    return json({
      ok: true,
      finalized,
      errors,
      total_checked: records.length,
    });
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[finalizer] UNHANDLED: ${msg.slice(0, 300)}`);
    return json({ ok: false, error: msg.slice(0, 200) }, 500);
  }
});
