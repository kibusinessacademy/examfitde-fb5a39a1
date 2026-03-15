import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  getBatchStatus,
  fetchBatchResults,
  parseBatchResult,
  BATCH_DISCOUNT,
} from "../_shared/anthropic-batch.ts";
import { logLLMCostEvent } from "../_shared/ai-client.ts";

/**
 * anthropic-batch-poll — Cron-triggered (every 5 min)
 *
 * 1. Finds all active (submitted/in_progress) batches
 * 2. Polls Anthropic for status
 * 3. For completed batches: fetches results, updates DB, logs costs
 * 4. Re-enqueues completed jobs back into the pipeline
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startMs = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Find active batches
    const { data: activeBatches, error: fetchErr } = await sb
      .from("anthropic_batches")
      .select("id, batch_id, status, request_count, model")
      .in("status", ["submitted", "in_progress"])
      .order("created_at", { ascending: true })
      .limit(20);

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!activeBatches || activeBatches.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        message: "No active batches to poll",
        elapsed_ms: Date.now() - startMs,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[batch-poll] Polling ${activeBatches.length} active batches`);

    let totalCompleted = 0;
    let totalFailed = 0;
    const processedBatches: string[] = [];

    for (const batch of activeBatches) {
      try {
        // 2. Check status with Anthropic
        const status = await getBatchStatus(batch.batch_id, apiKey);
        console.log(`[batch-poll] Batch ${batch.batch_id}: ${status.status} (${status.request_counts.succeeded}/${batch.request_count} done)`);

        // Update batch status
        if (status.status !== batch.status) {
          await sb.from("anthropic_batches").update({
            status: status.status === "ended" ? "ended" : status.status,
            completed_count: status.request_counts.succeeded,
            failed_count: status.request_counts.errored + status.request_counts.expired + status.request_counts.canceled,
            ...(status.ended_at ? { ended_at: status.ended_at } : {}),
          }).eq("id", batch.id);
        }

        // 3. If ended, fetch and process results
        if (status.status === "ended" && status.results_url) {
          console.log(`[batch-poll] Fetching results for batch ${batch.batch_id}`);
          const results = await fetchBatchResults(status.results_url, apiKey);

          let batchTotalCost = 0;
          let batchTotalIn = 0;
          let batchTotalOut = 0;

          for (const resultItem of results) {
            const parsed = parseBatchResult(resultItem);

            // Update the individual request
            const updateData: Record<string, any> = {
              status: parsed.ok ? "completed" : "failed",
              result_content: parsed.content || null,
              result_usage: parsed.usage || null,
              result_stop_reason: parsed.stop_reason || null,
              error_message: parsed.error || null,
              cost_eur: parsed.cost_eur,
              tokens_in: parsed.usage?.input_tokens || 0,
              tokens_out: parsed.usage?.output_tokens || 0,
              cache_read_input_tokens: parsed.usage?.cache_read_input_tokens || 0,
              cache_creation_input_tokens: parsed.usage?.cache_creation_input_tokens || 0,
              model: parsed.model,
              completed_at: new Date().toISOString(),
            };

            const { error: reqUpdateErr } = await sb
              .from("anthropic_batch_requests")
              .update(updateData)
              .eq("custom_id", resultItem.custom_id);

            if (reqUpdateErr) {
              console.error(`[batch-poll] Request update error for ${resultItem.custom_id}: ${reqUpdateErr.message}`);
            }

            // Log cost event (with batch discount noted)
            await logLLMCostEvent(sb, {
              job_type: "anthropic_batch",
              provider: "anthropic",
              model: parsed.model,
              tokens_in: parsed.usage?.input_tokens || 0,
              tokens_out: parsed.usage?.output_tokens || 0,
              cost_eur: parsed.cost_eur,
              status: parsed.ok ? "success" : "error",
              error_message: parsed.error,
              cache_read_input_tokens: parsed.usage?.cache_read_input_tokens,
              cache_creation_input_tokens: parsed.usage?.cache_creation_input_tokens,
              meta: {
                batch_id: batch.batch_id,
                custom_id: resultItem.custom_id,
                batch_discount: BATCH_DISCOUNT,
                stop_reason: parsed.stop_reason,
              },
            });

            batchTotalCost += parsed.cost_eur;
            batchTotalIn += parsed.usage?.input_tokens || 0;
            batchTotalOut += parsed.usage?.output_tokens || 0;

            if (parsed.ok) totalCompleted++;
            else totalFailed++;
          }

          // Update batch totals
          await sb.from("anthropic_batches").update({
            total_cost_eur: batchTotalCost,
            total_tokens_in: batchTotalIn,
            total_tokens_out: batchTotalOut,
            ended_at: new Date().toISOString(),
          }).eq("id", batch.id);

          processedBatches.push(batch.batch_id);

          // 4. Re-enqueue completed jobs back into pipeline
          // Find all completed requests that have a job_id
          const { data: completedRequests } = await sb
            .from("anthropic_batch_requests")
            .select("job_id, custom_id, result_content, status, job_type, package_id")
            .eq("batch_id", batch.batch_id)
            .eq("status", "completed")
            .not("job_id", "is", null);

          if (completedRequests && completedRequests.length > 0) {
            for (const cr of completedRequests) {
              // Update the original job with the batch result
              await sb.from("job_queue").update({
                status: "completed",
                result: {
                  ok: true,
                  batch_result: true,
                  batch_id: batch.batch_id,
                  content_length: cr.result_content?.length || 0,
                },
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                locked_at: null,
                locked_by: null,
              }).eq("id", cr.job_id);
            }
            console.log(`[batch-poll] Re-enqueued ${completedRequests.length} completed jobs from batch ${batch.batch_id}`);
          }
        }
      } catch (batchErr) {
        const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
        console.error(`[batch-poll] Error polling batch ${batch.batch_id}: ${msg}`);
      }
    }

    await sb.from("ops_events").insert({
      event_type: "anthropic_batch_poll_complete",
      severity: "info",
      payload: {
        batches_polled: activeBatches.length,
        batches_processed: processedBatches,
        completed: totalCompleted,
        failed: totalFailed,
        elapsed_ms: Date.now() - startMs,
      },
    }).catch(() => {});

    return new Response(JSON.stringify({
      ok: true,
      batches_polled: activeBatches.length,
      batches_processed: processedBatches.length,
      completed: totalCompleted,
      failed: totalFailed,
      elapsed_ms: Date.now() - startMs,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[batch-poll] Error: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
