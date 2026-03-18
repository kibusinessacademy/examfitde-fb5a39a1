/**
 * batch-submit — Generic multi-provider batch submission (hardened).
 * Phase A: OpenAI only.
 *
 * Fix #1: Submit failure → DB state correctly set to 'failed'
 * Fix #6: 200MB guard in adapter
 * Fix #7: Structured metadata with submit_raw + input_stats
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBatchAdapter } from "../_shared/batch/router.ts";
import { validateProviderModelCompat } from "../_shared/model-catalog.ts";
import { batchSafeModel, isCanaryBatchModel, getRemapLog } from "../_shared/batch/routing-config.ts";
import { logGovernanceEvent } from "../_shared/batch/governance-logger.ts";
import type { BatchCreateInput, BatchProvider, NormalizedBatchRequest } from "../_shared/batch/types.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let batchId: string | null = null;

  try {
    const body = await req.json();
    const provider = (body.provider || "openai") as BatchProvider;
    const rawModel = String(body.model || "gpt-4o-mini");
    const isCanary = body.metadata?.batch_mode === "canary";
    const model = batchSafeModel(rawModel, { isCanary });
    const endpoint = String(body.endpoint || "/v1/chat/completions");
    const jobType = String(body.job_type || "generic_batch");
    const requests: NormalizedBatchRequest[] = Array.isArray(body.requests) ? body.requests : [];

    // Persist remap events from batchSafeModel
    if (rawModel !== model) {
      await logGovernanceEvent(sb, {
        event_type: "model_remapped",
        requested_model: rawModel,
        effective_model: model,
        reason: `Auto-remapped in batch-submit. isCanary=${isCanary}`,
        job_type: jobType,
        metadata: { request_count: requests.length, ...(body.metadata || {}) },
      });
    }

    // Tag canary batches in metadata
    const batchMetadata = {
      ...(body.metadata || {}),
      ...(isCanary ? { batch_mode: "canary", requested_model: rawModel, effective_model: model } : {}),
    };

    if (!requests.length) return json({ ok: false, error: "requests[] required" }, 400);
    if (requests.length > 50_000) return json({ ok: false, error: "Max 50,000 requests per batch" }, 400);

    // ── P2 Guard: Provider-Model Compatibility Check (SSOT) ──
    const mismatchErr = validateProviderModelCompat(provider, model);
    if (mismatchErr) {
      return json({
        ok: false,
        error: `${mismatchErr}. Batch rejected.`,
        code: "PROVIDER_MODEL_MISMATCH",
      }, 422);
    }

    // 1) Create batch record
    const { data: batch, error: bErr } = await sb
      .from("llm_batches")
      .insert({
        provider,
        job_type: jobType,
        model,
        endpoint,
        status: "draft",
        request_count: requests.length,
        metadata: batchMetadata,
        created_by: "batch-submit",
      })
      .select("id")
      .single();

    if (bErr) throw bErr;
    batchId = batch.id;

    // 2) Insert individual request rows
    const reqRows = requests.map((r) => ({
      batch_id: batch.id,
      provider,
      custom_id: r.custom_id,
      source_job_id: r.source_job_id || null,
      source_table: r.source_table || null,
      source_ref: r.source_ref || null,
      ai_generation_request_id: r.ai_generation_request_id || null,
      job_type: r.job_type || jobType,
      model: r.model || model,
      endpoint: r.endpoint || endpoint,
      request_payload: r.request_payload,
      status: "queued",
    }));

    const { error: rErr } = await sb.from("llm_batch_requests").insert(reqRows);
    if (rErr) throw rErr;

    // 3) Upload + submit to provider
    await sb.from("llm_batches").update({ status: "uploading" }).eq("id", batch.id);

    const adapter = getBatchAdapter(provider);
    const input: BatchCreateInput = {
      provider,
      model,
      endpoint,
      completion_window: "24h",
      metadata: body.metadata || {},
      requests,
    };

    const submitted = await adapter.submit(input);

    // 4) Update batch with provider info (Fix #7: structured metadata)
    await sb
      .from("llm_batches")
      .update({
        status: submitted.status,
        provider_batch_id: submitted.provider_batch_id,
        input_file_id: submitted.input_file_id || null,
        output_file_id: submitted.output_file_id || null,
        error_file_id: submitted.error_file_id || null,
        provider_request_counts: submitted.raw?.request_counts || {},
        submitted_at: new Date().toISOString(),
        metadata: {
          ...(body.metadata || {}),
          submit_raw: submitted.raw,
          input_stats: {
            request_count: requests.length,
            input_bytes: (submitted.raw as any)?.input_bytes ?? null,
          },
        },
      })
      .eq("id", batch.id);

    // 5) Mark requests as submitted
    await sb
      .from("llm_batch_requests")
      .update({ status: "submitted" })
      .eq("batch_id", batch.id);

    return json({
      ok: true,
      batch_id: batch.id,
      provider,
      provider_batch_id: submitted.provider_batch_id,
      status: submitted.status,
      request_count: submitted.request_count,
    });
  } catch (error) {
    const errMsg = String((error as Error)?.message || error);
    console.error("[batch-submit]", errMsg);

    // Fix #1: On failure, mark batch + requests as failed in DB
    if (batchId) {
      await sb.from("llm_batches").update({
        status: "failed",
        error_summary: { submit_error: errMsg },
        completed_at: new Date().toISOString(),
      }).eq("id", batchId);

      await sb.from("llm_batch_requests")
        .update({
          status: "failed",
          error_body: { submit_error: errMsg },
          completed_at: new Date().toISOString(),
        })
        .eq("batch_id", batchId)
        .in("status", ["queued", "submitted"]);
    }

    return json({ ok: false, error: errMsg }, 500);
  }
});
