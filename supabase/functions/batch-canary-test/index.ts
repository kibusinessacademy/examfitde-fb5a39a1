/**
 * batch-canary-test — Diagnostic canary for GPT-5.4 batch pipeline.
 *
 * Submits exactly 1 request per model (gpt-5.4-mini + gpt-5.4-nano)
 * through the real batch-submit path, with full diagnostic logging.
 *
 * Usage: POST /functions/v1/batch-canary-test
 *   { "models": ["gpt-5.4-mini", "gpt-5.4-nano"] }
 *
 * Returns detailed diagnostics for each submission.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildBatchChatRequest } from "../_shared/batch/routing-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const body = await req.json().catch(() => ({}));
  const models: string[] = body.models || ["gpt-5.4-mini", "gpt-5.4-nano"];
  const results: Record<string, unknown>[] = [];

  for (const model of models) {
    const customId = `canary-${model}-${Date.now()}`;
    const startMs = Date.now();

    // Build the exact same payload that production uses
    const requestPayload = buildBatchChatRequest(
      model,
      [
        { role: "system", content: "Du bist ein hilfreicher Assistent. Antworte kurz." },
        { role: "user", content: "Was ist 2 + 2? Antworte in einem Satz." },
      ],
      { temperature: 0.1, max_tokens: 100 },
    );

    // Log the exact payload for diagnostics
    const diagnosticPayload = {
      custom_id: customId,
      model,
      endpoint: "/v1/chat/completions",
      request_payload: requestPayload,
    };

    console.log(`[canary] ── Model: ${model} ──`);
    console.log(`[canary] Request payload:`, JSON.stringify(diagnosticPayload, null, 2));

    // Check which token key was used (the critical fix)
    const tokenKey = "max_completion_tokens" in requestPayload
      ? "max_completion_tokens"
      : "max_tokens" in requestPayload
        ? "max_tokens"
        : "NONE";
    console.log(`[canary] Token limit key used: ${tokenKey} = ${requestPayload[tokenKey]}`);

    // Submit via batch-submit function (same path as production)
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/batch-submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          provider: "openai",
          model,
          endpoint: "/v1/chat/completions",
          job_type: "canary_test",
          metadata: {
            canary: "true",
            model,
            submitted_at: new Date().toISOString(),
          },
          requests: [
            {
              custom_id: customId,
              job_type: "canary_test",
              model,
              endpoint: "/v1/chat/completions",
              request_payload: requestPayload,
            },
          ],
        }),
      });

      const result = await resp.json();
      const elapsedMs = Date.now() - startMs;

      console.log(`[canary] ${model} response (${resp.status}):`, JSON.stringify(result));

      // If batch was created, fetch the JSONL that would have been sent
      let batchRecord = null;
      if (result.batch_id) {
        const { data } = await sb
          .from("llm_batches")
          .select("id, status, provider_batch_id, input_file_id, error_file_id, metadata, error_summary")
          .eq("id", result.batch_id)
          .single();
        batchRecord = data;
      }

      results.push({
        model,
        custom_id: customId,
        token_key_used: tokenKey,
        token_value: requestPayload[tokenKey],
        submit_http_status: resp.status,
        submit_ok: result.ok,
        batch_id: result.batch_id || null,
        provider_batch_id: result.provider_batch_id || null,
        provider_status: result.status || null,
        error: result.error || null,
        batch_record: batchRecord,
        elapsed_ms: elapsedMs,
      });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      console.error(`[canary] ${model} FAILED:`, msg);
      results.push({
        model,
        custom_id: customId,
        token_key_used: tokenKey,
        submit_ok: false,
        error: msg,
        elapsed_ms: Date.now() - startMs,
      });
    }
  }

  // Summary
  const allOk = results.every((r) => r.submit_ok);
  console.log(`[canary] ── SUMMARY: ${allOk ? "ALL OK" : "FAILURES DETECTED"} ──`);

  return json({
    ok: allOk,
    canary_at: new Date().toISOString(),
    summary: allOk
      ? "Both models submitted successfully. Poll in ~2 min to check completion."
      : "One or more submissions failed. Check diagnostics.",
    results,
    next_step: "Call batch-poll or wait for cron. Then check: SELECT * FROM llm_batches WHERE job_type = 'canary_test' ORDER BY created_at DESC;",
  });
});
