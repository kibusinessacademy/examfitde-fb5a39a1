/**
 * batch-poll — Generic multi-provider batch result poller.
 * Phase A: OpenAI only.
 *
 * POST { batch_id }  — polls a specific batch
 * POST {}            — polls all active batches (cron mode)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBatchAdapter } from "../_shared/batch/router.ts";
import type { BatchProvider } from "../_shared/batch/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Conservative gpt-4o-mini batch pricing (50% discount already applied) */
function estimateCostUsd(
  model: string,
  inputTokens = 0,
  outputTokens = 0,
  cachedInputTokens = 0,
): number | null {
  // Batch = 50% of realtime. gpt-4o-mini realtime: $0.15/1M in, $0.60/1M out
  if (!model.includes("gpt-4o-mini")) return null;
  const uncachedIn = Math.max(0, inputTokens - cachedInputTokens);
  const usd =
    (uncachedIn / 1_000_000) * 0.075 +
    (cachedInputTokens / 1_000_000) * 0.0375 +
    (outputTokens / 1_000_000) * 0.3;
  return Math.round(usd * 1e6) / 1e6;
}

function eurFromUsd(usd: number | null): number | null {
  return usd != null ? Math.round(usd * 0.92 * 1e6) / 1e6 : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const specificBatchId = body.batch_id as string | undefined;

    // Fetch active batches to poll
    let query = sb
      .from("llm_batches")
      .select("*")
      .in("status", ["submitted", "validating", "in_progress", "finalizing"]);

    if (specificBatchId) {
      query = query.eq("id", specificBatchId);
    }

    const { data: batches, error: bErr } = await query.limit(50);
    if (bErr) throw bErr;
    if (!batches?.length) return json({ ok: true, polled: 0, message: "No active batches" });

    const results: any[] = [];

    for (const batch of batches) {
      try {
        const adapter = getBatchAdapter(batch.provider as BatchProvider);
        if (!batch.provider_batch_id) {
          console.warn(`[batch-poll] Batch ${batch.id} has no provider_batch_id, skipping`);
          continue;
        }

        const poll = await adapter.poll(batch.provider_batch_id);

        // Update batch status
        const batchUpdate: Record<string, unknown> = {
          status: poll.status,
          last_polled_at: new Date().toISOString(),
          output_file_id: poll.output_file_id || batch.output_file_id,
          error_file_id: poll.error_file_id || batch.error_file_id,
        };

        if (poll.request_counts) {
          batchUpdate.completed_count = poll.request_counts.completed ?? batch.completed_count;
          batchUpdate.failed_count = poll.request_counts.failed ?? batch.failed_count;
          batchUpdate.provider_request_counts = poll.request_counts;
        }

        const isTerminal = ["completed", "failed", "expired", "cancelled"].includes(poll.status);
        if (isTerminal && !batch.completed_at) {
          batchUpdate.completed_at = new Date().toISOString();
        }

        await sb.from("llm_batches").update(batchUpdate).eq("id", batch.id);

        // If completed and has output, download + process results
        let processedCount = 0;
        if (poll.status === "completed" && poll.output_file_id) {
          try {
            const content = await adapter.downloadOutput(poll.output_file_id);
            const rows = adapter.parseOutputJsonl(content);

            for (const row of rows) {
              const usage = row.usage_data;
              const costUsd = estimateCostUsd(
                batch.model,
                usage?.input_tokens ?? 0,
                usage?.output_tokens ?? 0,
                usage?.cached_input_tokens ?? 0,
              );

              const reqUpdate: Record<string, unknown> = {
                status: row.response_http_status === 200 ? "completed" : "failed",
                response_http_status: row.response_http_status,
                response_body: row.response_body,
                error_body: row.error_body,
                usage_data: row.usage_data,
                tokens_in: usage?.input_tokens ?? null,
                tokens_out: usage?.output_tokens ?? null,
                cached_input_tokens: usage?.cached_input_tokens ?? null,
                total_tokens: usage?.total_tokens ?? null,
                cost_usd: costUsd,
                cost_eur: eurFromUsd(costUsd),
                completed_at: new Date().toISOString(),
              };

              await sb
                .from("llm_batch_requests")
                .update(reqUpdate)
                .eq("batch_id", batch.id)
                .eq("custom_id", row.custom_id);

              processedCount++;
            }
          } catch (dlErr) {
            console.error(`[batch-poll] Failed to download/process results for batch ${batch.id}:`, dlErr);
            await sb.from("llm_batches").update({
              error_summary: { download_error: String(dlErr) },
            }).eq("id", batch.id);
          }
        }

        // Handle error file if present
        if (isTerminal && poll.error_file_id) {
          try {
            const errContent = await adapter.downloadOutput(poll.error_file_id);
            const errRows = adapter.parseOutputJsonl(errContent);

            for (const row of errRows) {
              await sb
                .from("llm_batch_requests")
                .update({
                  status: "failed",
                  error_body: row.error_body || row.raw,
                  completed_at: new Date().toISOString(),
                })
                .eq("batch_id", batch.id)
                .eq("custom_id", row.custom_id);
            }
          } catch (errDlErr) {
            console.warn(`[batch-poll] Could not download error file for batch ${batch.id}:`, errDlErr);
          }
        }

        // Mark any remaining submitted requests as expired if batch expired
        if (poll.status === "expired") {
          await sb
            .from("llm_batch_requests")
            .update({ status: "expired", completed_at: new Date().toISOString() })
            .eq("batch_id", batch.id)
            .eq("status", "submitted");
        }

        results.push({
          batch_id: batch.id,
          provider: batch.provider,
          status: poll.status,
          processed: processedCount,
        });
      } catch (pollErr) {
        console.error(`[batch-poll] Error polling batch ${batch.id}:`, pollErr);
        results.push({
          batch_id: batch.id,
          error: String((pollErr as Error)?.message || pollErr),
        });
      }
    }

    return json({ ok: true, polled: results.length, results });
  } catch (error) {
    console.error("[batch-poll]", error);
    return json({ ok: false, error: String((error as Error)?.message || error) }, 500);
  }
});
