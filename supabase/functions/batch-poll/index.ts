/**
 * batch-poll — Generic multi-provider batch result poller (hardened).
 * Phase A: OpenAI only.
 *
 * POST {}             — polls all active batches (cron mode)
 * POST { batch_id }   — polls a specific batch
 *
 * Fixes applied:
 *  #1: Correct pricing ($0.15/$0.075/$0.60 for gpt-4o-mini batch)
 *  #2: Idempotent import via results_imported_at
 *  #3: Separate error file parsing
 *  #4: Robust 2xx success check
 *  #5: Terminal state reconciliation for all statuses (expired/cancelled/failed)
 *  #7: Structured metadata (last_poll_raw, import_stats)
 *  #8: Poll error cooldown via poll_error_count + next_poll_after
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

/**
 * Fix #1: Correct gpt-4o-mini Batch pricing.
 * Official: $0.15/1M input, $0.075/1M cached, $0.60/1M output.
 * These ARE the batch prices (already 50% off realtime).
 */
function estimateCostUsd(
  model: string,
  inputTokens = 0,
  outputTokens = 0,
  cachedInputTokens = 0,
): number | null {
  if (!model.includes("gpt-4o-mini")) return null;
  const uncachedIn = Math.max(0, inputTokens - cachedInputTokens);
  const usd =
    (uncachedIn / 1_000_000) * 0.15 +
    (cachedInputTokens / 1_000_000) * 0.075 +
    (outputTokens / 1_000_000) * 0.60;
  return Math.round(usd * 1e6) / 1e6;
}

function eurFromUsd(usd: number | null): number | null {
  return usd != null ? Math.round(usd * 0.92 * 1e6) / 1e6 : null;
}

/** Fix #4: Robust success check */
function isSuccessResponse(row: { response_http_status?: number | null; error_body?: unknown | null }): boolean {
  return (
    row.response_http_status != null &&
    row.response_http_status >= 200 &&
    row.response_http_status < 300 &&
    !row.error_body
  );
}

/** Fix #8: Exponential backoff for poll errors */
function getNextPollAfter(errorCount: number): string {
  const backoffMinutes = Math.min(60, Math.pow(2, Math.min(errorCount, 6)));
  return new Date(Date.now() + backoffMinutes * 60_000).toISOString();
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
    const now = new Date().toISOString();

    // Fetch active batches to poll
    let query = sb
      .from("llm_batches")
      .select("*")
      .in("status", ["submitted", "validating", "in_progress", "finalizing"]);

    if (specificBatchId) {
      query = query.eq("id", specificBatchId);
    } else {
      // Fix #8: Skip batches in cooldown
      query = query.or(`next_poll_after.is.null,next_poll_after.lt.${now}`);
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
        const isTerminal = ["completed", "failed", "expired", "cancelled"].includes(poll.status);

        // Update batch status
        const batchUpdate: Record<string, unknown> = {
          status: poll.status,
          last_polled_at: now,
          output_file_id: poll.output_file_id || batch.output_file_id,
          error_file_id: poll.error_file_id || batch.error_file_id,
          // Fix #8: Reset error count on successful poll
          poll_error_count: 0,
          last_poll_error: null,
          next_poll_after: null,
          metadata: {
            ...((batch.metadata as any) || {}),
            last_poll_raw: poll.raw,
          },
        };

        if (poll.request_counts) {
          batchUpdate.completed_count = poll.request_counts.completed ?? batch.completed_count;
          batchUpdate.failed_count = poll.request_counts.failed ?? batch.failed_count;
          batchUpdate.provider_request_counts = poll.request_counts;
        }

        if (isTerminal && !batch.completed_at) {
          batchUpdate.completed_at = now;
        }

        await sb.from("llm_batches").update(batchUpdate).eq("id", batch.id);

        // Fix #2: Only import results if not already imported
        let processedCount = 0;
        const alreadyImported = !!(batch as any).results_imported_at;

        if (poll.status === "completed" && poll.output_file_id && !alreadyImported) {
          try {
            const content = await adapter.downloadOutput(poll.output_file_id);
            const rows = adapter.parseOutputJsonl(content);

            let totalCostUsd = 0;

            for (const row of rows) {
              const usage = row.usage_data;
              const costUsd = estimateCostUsd(
                batch.model,
                usage?.input_tokens ?? 0,
                usage?.output_tokens ?? 0,
                usage?.cached_input_tokens ?? 0,
              );

              if (costUsd) totalCostUsd += costUsd;

              // Fix #4: Robust success determination
              const succeeded = isSuccessResponse(row);

              await sb
                .from("llm_batch_requests")
                .update({
                  status: succeeded ? "completed" : "failed",
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
                  completed_at: now,
                })
                .eq("batch_id", batch.id)
                .eq("custom_id", row.custom_id);

              processedCount++;
            }

            // Fix #2: Mark as imported
            await sb.from("llm_batches").update({
              results_imported_at: now,
              metadata: {
                ...((batch.metadata as any) || {}),
                last_poll_raw: poll.raw,
                import_stats: {
                  rows_processed: processedCount,
                  total_cost_usd: Math.round(totalCostUsd * 1e6) / 1e6,
                  imported_at: now,
                },
              },
            }).eq("id", batch.id);
          } catch (dlErr) {
            console.error(`[batch-poll] Download/process failed for batch ${batch.id}:`, dlErr);
            await sb.from("llm_batches").update({
              error_summary: { download_error: String(dlErr) },
            }).eq("id", batch.id);
          }
        }

        // Fix #3: Handle error file separately with defensive parsing
        if (isTerminal && poll.error_file_id && !alreadyImported) {
          try {
            const errContent = await adapter.downloadOutput(poll.error_file_id);
            // Use adapter's error parser if available, otherwise defensive parse
            const errRows = errContent
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((line) => {
                try {
                  return JSON.parse(line);
                } catch {
                  return null;
                }
              })
              .filter(Boolean);

            for (const row of errRows) {
              if (!row.custom_id) continue;
              await sb
                .from("llm_batch_requests")
                .update({
                  status: "failed",
                  error_body: row.error || { code: "batch_error", message: "Error in batch error file" },
                  completed_at: now,
                })
                .eq("batch_id", batch.id)
                .eq("custom_id", row.custom_id);
            }
          } catch (errDlErr) {
            console.warn(`[batch-poll] Error file download failed for batch ${batch.id}:`, errDlErr);
          }
        }

        // Fix #5: Terminal state reconciliation — catch ALL orphaned requests
        if (isTerminal) {
          const terminalStatus = poll.status === "expired" ? "expired"
            : poll.status === "cancelled" ? "cancelled"
            : "failed";

          await sb
            .from("llm_batch_requests")
            .update({
              status: terminalStatus,
              completed_at: now,
              error_body: { code: `batch_${poll.status}`, message: `Batch ended with status: ${poll.status}` },
            })
            .eq("batch_id", batch.id)
            .in("status", ["queued", "submitted"]);
        }

        results.push({
          batch_id: batch.id,
          provider: batch.provider,
          status: poll.status,
          processed: processedCount,
          already_imported: alreadyImported,
        });
      } catch (pollErr) {
        const errMsg = String((pollErr as Error)?.message || pollErr);
        console.error(`[batch-poll] Error polling batch ${batch.id}:`, errMsg);

        // Fix #8: Increment error count + set cooldown
        const newErrorCount = ((batch as any).poll_error_count || 0) + 1;
        await sb.from("llm_batches").update({
          poll_error_count: newErrorCount,
          last_poll_error: errMsg,
          next_poll_after: getNextPollAfter(newErrorCount),
          last_polled_at: now,
        }).eq("id", batch.id);

        results.push({
          batch_id: batch.id,
          error: errMsg,
          poll_error_count: newErrorCount,
        });
      }
    }

    return json({ ok: true, polled: results.length, results });
  } catch (error) {
    console.error("[batch-poll]", error);
    return json({ ok: false, error: String((error as Error)?.message || error) }, 500);
  }
});
