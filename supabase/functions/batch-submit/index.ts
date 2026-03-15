/**
 * batch-submit — Generic multi-provider batch submission.
 * Phase A: OpenAI only.
 *
 * POST { provider, model, endpoint, job_type, metadata, requests[] }
 * Each request: { custom_id, request_payload, source_job_id?, source_table?, source_ref?, job_type?, model? }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBatchAdapter } from "../_shared/batch/router.ts";
import type { BatchCreateInput, BatchProvider } from "../_shared/batch/types.ts";

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

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const provider = (body.provider || "openai") as BatchProvider;
    const model = String(body.model || "gpt-4o-mini");
    const endpoint = String(body.endpoint || "/v1/chat/completions");
    const jobType = String(body.job_type || "generic_batch");
    const requests = Array.isArray(body.requests) ? body.requests : [];

    if (!requests.length) return json({ ok: false, error: "requests[] required" }, 400);
    if (requests.length > 50_000) return json({ ok: false, error: "Max 50,000 requests per batch" }, 400);

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
        metadata: body.metadata || {},
        created_by: "batch-submit",
      })
      .select("id")
      .single();

    if (bErr) throw bErr;

    // 2) Insert individual request rows
    const reqRows = requests.map((r: any) => ({
      batch_id: batch.id,
      provider,
      custom_id: r.custom_id,
      source_job_id: r.source_job_id || null,
      source_table: r.source_table || null,
      source_ref: r.source_ref || null,
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
      requests: requests.map((r: any) => ({
        custom_id: r.custom_id,
        source_job_id: r.source_job_id || null,
        source_table: r.source_table || null,
        source_ref: r.source_ref || null,
        job_type: r.job_type || jobType,
        model: r.model || model,
        endpoint: r.endpoint || endpoint,
        request_payload: r.request_payload,
      })),
    };

    const submitted = await adapter.submit(input);

    // 4) Update batch with provider info
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
    console.error("[batch-submit]", error);
    return json({ ok: false, error: String((error as Error)?.message || error) }, 500);
  }
});
