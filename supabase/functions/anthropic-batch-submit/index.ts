import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { submitBatch, BATCH_DEFAULT_MODEL, type BatchRequestItem } from "../_shared/anthropic-batch.ts";

/**
 * anthropic-batch-submit — Cron-triggered (every 5 min)
 *
 * 1. Collects pending batch requests from anthropic_batch_requests
 * 2. Groups them (max 10,000 per batch per Anthropic limit)
 * 3. Submits to Anthropic Batch API
 * 4. Updates DB with batch_id + status
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_BATCH_SIZE = 10_000; // Anthropic limit
const MIN_BATCH_SIZE = 1;     // Submit even single items (batch discount still applies)

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
    // 1. Fetch pending batch requests
    const { data: pending, error: fetchErr } = await sb
      .from("anthropic_batch_requests")
      .select("id, custom_id, request_params, model, priority")
      .eq("status", "pending")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(MAX_BATCH_SIZE);

    if (fetchErr) {
      console.error(`[batch-submit] DB fetch error: ${fetchErr.message}`);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!pending || pending.length < MIN_BATCH_SIZE) {
      return new Response(JSON.stringify({
        ok: true,
        message: "No pending batch requests",
        count: pending?.length ?? 0,
        elapsed_ms: Date.now() - startMs,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[batch-submit] Collecting ${pending.length} pending requests`);

    // 2. Build batch request items
    const requests: BatchRequestItem[] = pending.map(item => ({
      custom_id: item.custom_id,
      params: {
        model: item.model || BATCH_DEFAULT_MODEL,
        ...item.request_params,
      },
    }));

    // 3. Submit to Anthropic
    const batchResult = await submitBatch(requests, apiKey);
    console.log(`[batch-submit] Submitted batch ${batchResult.batch_id} with ${batchResult.request_count} requests`);

    // 4. Record the batch
    const { error: batchInsertErr } = await sb
      .from("anthropic_batches")
      .insert({
        batch_id: batchResult.batch_id,
        status: "submitted",
        request_count: batchResult.request_count,
        model: pending[0]?.model || BATCH_DEFAULT_MODEL,
        expires_at: batchResult.expires_at,
        meta: {
          submit_latency_ms: Date.now() - startMs,
          job_types: [...new Set(pending.map(p => p.request_params?.job_type || "unknown"))],
        },
      });

    if (batchInsertErr) {
      console.error(`[batch-submit] Batch insert error: ${batchInsertErr.message}`);
    }

    // 5. Update all requests with batch_id + status
    const ids = pending.map(p => p.id);
    const { error: updateErr } = await sb
      .from("anthropic_batch_requests")
      .update({
        batch_id: batchResult.batch_id,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        expires_at: batchResult.expires_at,
      })
      .in("id", ids);

    if (updateErr) {
      console.error(`[batch-submit] Request update error: ${updateErr.message}`);
    }

    // 6. Log to ops_events
    await sb.from("ops_events").insert({
      event_type: "anthropic_batch_submitted",
      severity: "info",
      payload: {
        batch_id: batchResult.batch_id,
        request_count: batchResult.request_count,
        expires_at: batchResult.expires_at,
        elapsed_ms: Date.now() - startMs,
      },
    }).catch(() => {});

    return new Response(JSON.stringify({
      ok: true,
      batch_id: batchResult.batch_id,
      request_count: batchResult.request_count,
      expires_at: batchResult.expires_at,
      elapsed_ms: Date.now() - startMs,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[batch-submit] Error: ${msg}`);

    await sb.from("ops_events").insert({
      event_type: "anthropic_batch_submit_failed",
      severity: "error",
      payload: { error: msg.slice(0, 500), elapsed_ms: Date.now() - startMs },
    }).catch(() => {});

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
