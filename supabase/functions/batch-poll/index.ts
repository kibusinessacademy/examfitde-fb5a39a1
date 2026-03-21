/**
 * batch-poll — Generic multi-provider batch result poller (v3 hardened).
 *
 * POST {}             — polls all active batches (cron mode)
 * POST { batch_id }   — polls a specific batch
 *
 * v3 Hardening:
 *  #1: completed-Reconciliation getrennt von failed/expired/cancelled
 *  #2: results_imported_at erst nach Output+Error-Import
 *  #3: lte statt lt für next_poll_after Query
 *  #4: import_attempts Zähler für Observability
 *  #5: error_summary immer gemerged
 *  #6: Request-Updates idempotent (nur completed_at IS NULL)
 *  #7: parseErrorJsonl aus Adapter nutzen
 *  #8: next_poll_after bei nicht-terminalem Poll auf 5min setzen
 *  #9: Kostenberechnung aus SSOT model-pricing.ts
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBatchAdapter } from "../_shared/batch/router.ts";
import { estimateCostEur, PRICING_META } from "../_shared/model-pricing.ts";
import { logLLMCostEvent } from "../_shared/ai-client.ts";
import type { BatchProvider, ParsedBatchOutputRow } from "../_shared/batch/types.ts";

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

/** Fix #9: Use SSOT pricing. Returns EUR directly. */
function estimateCostForRequest(
  model: string,
  inputTokens = 0,
  outputTokens = 0,
  cachedInputTokens = 0,
): number {
  return estimateCostEur(model, inputTokens, outputTokens, cachedInputTokens);
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

/** Exponential backoff for poll errors */
function getNextPollAfter(errorCount: number): string {
  const backoffMinutes = Math.min(60, Math.pow(2, Math.min(errorCount, 6)));
  return new Date(Date.now() + backoffMinutes * 60_000).toISOString();
}

/** Fix #5: Always merge error_summary */
function mergeErrorSummary(existing: any, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...(existing || {}), ...patch };
}

const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

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
      // Fix #3: lte instead of lt to avoid edge-case skips
      query = query.or(`next_poll_after.is.null,next_poll_after.lte.${now}`);
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
          // Reset error count on successful poll
          poll_error_count: 0,
          last_poll_error: null,
          // Fix #8: Set next poll interval for non-terminal batches
          next_poll_after: isTerminal
            ? null
            : new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
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

        // Idempotent import check
        let processedCount = 0;
        const alreadyImported = !!(batch as any).results_imported_at;
        let outputImported = !poll.output_file_id || alreadyImported;
        let errorImported = !poll.error_file_id || alreadyImported;

        // ── Output file import ──
        if (poll.status === "completed" && poll.output_file_id && !alreadyImported) {
          try {
            // Fix #4: Increment import_attempts
            await sb.from("llm_batches").update({
              import_attempts: ((batch as any).import_attempts || 0) + 1,
            }).eq("id", batch.id);

            const content = await adapter.downloadOutput(poll.output_file_id);
            const rows = adapter.parseOutputJsonl(content);

            let totalCostEur = 0;

            for (const row of rows) {
              const usage = row.usage_data;
              const costEur = estimateCostForRequest(
                batch.model,
                usage?.input_tokens ?? 0,
                usage?.output_tokens ?? 0,
                usage?.cached_input_tokens ?? 0,
              );

              totalCostEur += costEur;
              const succeeded = isSuccessResponse(row);

              // Fix #6: Only update rows not yet completed (idempotent)
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
                  cost_usd: null, // deprecated, use cost_eur
                  cost_eur: costEur,
                  completed_at: now,
                })
                .eq("batch_id", batch.id)
                .eq("custom_id", row.custom_id)
                .is("completed_at", null); // Fix #6: idempotent guard

              // ── P0 FIX: Log every batch result to llm_cost_events (SSOT) ──
              // This was the 99.6% telemetry gap — batch results were never logged.
              const reqMeta = (row as any).custom_id ? { custom_id: row.custom_id, batch_id: batch.id } : { batch_id: batch.id };
              await logLLMCostEvent(sb, {
                job_type: (batch as any).job_type || "batch_unknown",
                provider: (batch as any).provider || "openai",
                model: batch.model,
                tokens_in: usage?.input_tokens ?? 0,
                tokens_out: usage?.output_tokens ?? 0,
                cost_eur: costEur,
                package_id: (batch as any).package_id || null,
                status: succeeded ? "success" : "error",
                error_message: succeeded ? null : JSON.stringify(row.error_body)?.slice(0, 300),
                meta: {
                  ...reqMeta,
                  batch_discount: true,
                  cached_input_tokens: usage?.cached_input_tokens ?? 0,
                },
              });

              processedCount++;
            }

            // Mark output as imported with observability counters
            await sb.from("llm_batches").update({
              output_imported_at: now,
              metadata: {
                ...((batch.metadata as any) || {}),
                last_poll_raw: poll.raw,
                import_stats: {
                  output_row_count: rows.length,
                  rows_processed: processedCount,
                  total_cost_eur: Math.round(totalCostEur * 1e6) / 1e6,
                  pricing_source: PRICING_META.source,
                  pricing_date: PRICING_META.effective_date,
                  imported_at: now,
                },
              },
            }).eq("id", batch.id);

            outputImported = true;
          } catch (dlErr) {
            console.error(`[batch-poll] Download/process failed for batch ${batch.id}:`, dlErr);
            // Fix #5: Merge error_summary instead of overwriting
            await sb.from("llm_batches").update({
              error_summary: mergeErrorSummary(
                (batch as any).error_summary,
                { download_error: String(dlErr), download_error_at: now },
              ),
            }).eq("id", batch.id);
          }
        }

        // ── Error file import ──
        if (isTerminal && poll.error_file_id && !alreadyImported) {
          try {
            const errContent = await adapter.downloadOutput(poll.error_file_id);
            // Fix #7: Use adapter's parseErrorJsonl
            const errRows: ParsedBatchOutputRow[] = adapter.parseErrorJsonl(errContent);

            for (const row of errRows) {
              if (!row.custom_id) continue;
              // Fix #6: Only update rows not yet completed
              await sb
                .from("llm_batch_requests")
                .update({
                  status: "failed",
                  error_body: row.error_body || { code: "batch_error", message: "Error in batch error file" },
                  completed_at: now,
                })
                .eq("batch_id", batch.id)
                .eq("custom_id", row.custom_id)
                .is("completed_at", null);
            }

            await sb.from("llm_batches").update({
              error_imported_at: now,
              metadata: {
                ...((batch.metadata as any) || {}),
                error_file_row_count: errRows.length,
              },
            }).eq("id", batch.id);

            errorImported = true;
          } catch (errDlErr) {
            console.warn(`[batch-poll] Error file download failed for batch ${batch.id}:`, errDlErr);
            await sb.from("llm_batches").update({
              error_summary: mergeErrorSummary(
                (batch as any).error_summary,
                { error_file_download_error: String(errDlErr), error_file_error_at: now },
              ),
            }).eq("id", batch.id);
          }
        }

        // Fix #2: Only set results_imported_at when BOTH output and error are done
        if (outputImported && errorImported && !alreadyImported && isTerminal) {
          // Count missing results for observability
          const { count: missingCount } = await sb
            .from("llm_batch_requests")
            .select("id", { count: "exact", head: true })
            .eq("batch_id", batch.id)
            .in("status", ["queued", "submitted"]);

          await sb.from("llm_batches").update({
            results_imported_at: now,
            metadata: {
              ...((batch.metadata as any) || {}),
              missing_result_count: missingCount ?? 0,
            },
          }).eq("id", batch.id);

          // Auto-trigger domain importer with atomicity guard
          // Only trigger if domain_import_started_at is still NULL
          const { data: guardCheck } = await sb
            .from("llm_batches")
            .select("domain_import_started_at")
            .eq("id", batch.id)
            .is("domain_import_started_at", null)
            .single();

          if (guardCheck) {
            await sb.from("llm_batches").update({
              domain_import_started_at: now,
            }).eq("id", batch.id);

            try {
              const importUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/batch-result-importer`;
              fetch(importUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({ batch_id: batch.id }),
              }).catch((e) => console.warn(`[batch-poll] batch-result-importer fire-and-forget failed: ${e}`));
            } catch { /* non-fatal */ }
          }
        }

        // ── Terminal state reconciliation ──
        if (isTerminal) {
          if (poll.status === "failed" || poll.status === "expired" || poll.status === "cancelled") {
            // Fix #1: Hard terminal — all remaining open requests get the batch's terminal status
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
          } else if (poll.status === "completed") {
            // Fix #1: Completed batch — orphaned requests = missing from output/error files
            await sb
              .from("llm_batch_requests")
              .update({
                status: "failed",
                completed_at: now,
                error_body: {
                  code: "missing_batch_result",
                  message: "Batch completed but no output/error row was found for this request",
                },
              })
              .eq("batch_id", batch.id)
              .in("status", ["queued", "submitted"]);
          }
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

        const newErrorCount = ((batch as any).poll_error_count || 0) + 1;
        await sb.from("llm_batches").update({
          poll_error_count: newErrorCount,
          last_poll_error: errMsg,
          next_poll_after: getNextPollAfter(newErrorCount),
          last_polled_at: now,
          // Fix #5: Merge error_summary
          error_summary: mergeErrorSummary(
            (batch as any).error_summary,
            { poll_error: errMsg, poll_error_at: now },
          ),
        }).eq("id", batch.id);

        results.push({
          batch_id: batch.id,
          error: errMsg,
          poll_error_count: newErrorCount,
        });
      }
    }

    // ── Catch-up: trigger domain import for completed batches missing it ──
    // Handles batches that completed but whose domain import was never triggered
    // (e.g. after cleanup migrations reset domain_import_started_at)
    try {
      const { data: pendingImport } = await sb
        .from("llm_batches")
        .select("id, job_type")
        .eq("status", "completed")
        .not("results_imported_at", "is", null)
        .is("domain_import_started_at", null)
        .is("domain_import_completed_at", null)
        .limit(40);

      if (pendingImport?.length) {
        const importUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/batch-result-importer`;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        let triggered = 0;

        for (const b of pendingImport) {
          // Set guard atomically
          const { data: guard } = await sb
            .from("llm_batches")
            .update({ domain_import_started_at: now })
            .eq("id", b.id)
            .is("domain_import_started_at", null)
            .select("id")
            .single();

          if (guard) {
            fetch(importUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
              body: JSON.stringify({ batch_id: b.id }),
            }).catch((e) => console.warn(`[batch-poll] catchup import failed for ${b.id}: ${e}`));
            triggered++;
          }
        }

        if (triggered > 0) {
          console.log(`[batch-poll] CATCHUP: triggered domain import for ${triggered} completed batches`);
        }
      }
    } catch (catchupErr) {
      console.warn(`[batch-poll] catchup error: ${(catchupErr as Error)?.message?.slice(0, 100)}`);
    }

    // ── Stale Reaper: auto-fail batches stuck in uploading/draft >30 min ──
    // Uses last_heartbeat_at (precise) or falls back to created_at.
    let reapedCount = 0;
    let reapedRequestCount = 0;
    try {
      const staleThreshold = new Date(Date.now() - 30 * 60_000).toISOString();
      const { data: staleBatches } = await sb
        .from("llm_batches")
        .select("id, status, created_at, last_heartbeat_at, submit_attempts")
        .in("status", ["uploading", "draft"])
        .limit(20);

      // Filter: stale if heartbeat OR created_at is older than threshold
      const staleFiltered = (staleBatches || []).filter((b: any) => {
        const ref = b.last_heartbeat_at || b.created_at;
        return ref < staleThreshold;
      });

      if (staleFiltered.length) {
        const staleIds = staleFiltered.map((b: any) => b.id);

        await sb.from("llm_batches").update({
          status: "failed",
          completed_at: now,
          error_summary: {
            root_cause: "STUCK_PRE_SUBMIT",
            detail: "Auto-reaped by batch-poll: stuck in uploading/draft >30min",
            reaped_at: now,
          },
        }).in("id", staleIds);

        const { count } = await sb.from("llm_batch_requests")
          .update({
            status: "failed",
            completed_at: now,
            error_body: {
              code: "BATCH_STUCK_PRE_SUBMIT",
              message: "Parent batch never reached provider. Auto-reaped.",
            },
          })
          .in("batch_id", staleIds)
          .in("status", ["queued", "submitted"]);

        reapedCount = staleIds.length;
        reapedRequestCount = count ?? 0;
        console.log(`[batch-poll] STALE REAPER: ${reapedCount} batches, ${reapedRequestCount} requests reaped`);

        // Log reaper telemetry
        try {
          await sb.from("admin_actions").insert({
            action: "batch_stale_reaper",
            scope: "llm_batches",
            affected_ids: staleIds,
            payload: {
              reaped_batches: reapedCount,
              reaped_requests: reapedRequestCount,
              batch_details: staleFiltered.map((b: any) => ({
                id: b.id,
                status: b.status,
                submit_attempts: b.submit_attempts ?? 0,
                age_minutes: Math.round((Date.now() - new Date(b.created_at).getTime()) / 60_000),
              })),
            },
          });
        } catch { /* telemetry non-fatal */ }
      }
    } catch (reaperErr) {
      console.warn(`[batch-poll] stale reaper error: ${(reaperErr as Error)?.message?.slice(0, 100)}`);
    }

    return json({ ok: true, polled: results.length, results });
  } catch (error) {
    console.error("[batch-poll]", error);
    return json({ ok: false, error: String((error as Error)?.message || error) }, 500);
  }
});
