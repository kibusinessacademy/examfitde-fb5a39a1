/**
 * batch-canary-diagnose — Downloads and displays OpenAI error/output files for canary batches.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBatchAdapter } from "../_shared/batch/router.ts";
import type { BatchProvider } from "../_shared/batch/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Get canary batches
  const { data: batches } = await sb
    .from("llm_batches")
    .select("id, model, status, provider, provider_batch_id, input_file_id, output_file_id, error_file_id, error_summary, metadata")
    .eq("job_type", "canary_test")
    .order("created_at", { ascending: false })
    .limit(5);

  const results = [];

  for (const batch of batches || []) {
    const adapter = getBatchAdapter((batch.provider || "openai") as BatchProvider);
    const entry: Record<string, unknown> = {
      id: batch.id,
      model: batch.model,
      status: batch.status,
      provider_batch_id: batch.provider_batch_id,
      output_file_id: batch.output_file_id,
      error_file_id: batch.error_file_id,
    };

    // Also poll latest status from OpenAI
    if (batch.provider_batch_id) {
      try {
        const pollResult = await adapter.poll(batch.provider_batch_id);
        entry.live_status = pollResult.status;
        entry.live_request_counts = pollResult.request_counts;
        entry.live_output_file_id = pollResult.output_file_id;
        entry.live_error_file_id = pollResult.error_file_id;

        // Download error file
        const errFileId = pollResult.error_file_id || batch.error_file_id;
        if (errFileId) {
          try {
            const errorContent = await adapter.downloadOutput(errFileId);
            entry.error_file_raw = errorContent;
            entry.error_file_parsed = adapter.parseErrorJsonl(errorContent);
          } catch (e) {
            entry.error_file_download_error = (e as Error).message;
          }
        }

        // Download output file
        const outFileId = pollResult.output_file_id || batch.output_file_id;
        if (outFileId) {
          try {
            const outputContent = await adapter.downloadOutput(outFileId);
            entry.output_file_raw = outputContent;
            entry.output_file_parsed = adapter.parseOutputJsonl(outputContent);
          } catch (e) {
            entry.output_file_download_error = (e as Error).message;
          }
        }
      } catch (e) {
        entry.poll_error = (e as Error).message;
      }
    }

    results.push(entry);
  }

  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
