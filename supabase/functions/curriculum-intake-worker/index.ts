import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const jobType = body.job_type as string;
  const limit = Math.min(Number(body.limit ?? 10), 25);

  if (!jobType) return json(400, { error: "job_type required" }, origin);

  // Claim jobs
  const { data: jobs, error: claimErr } = await sb.rpc("claim_curriculum_intake_jobs", {
    p_job_type: jobType,
    p_limit: limit,
  });

  if (claimErr) return json(500, { error: claimErr.message }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const results: any[] = [];

  for (const job of jobs || []) {
    try {
      let fnName = "";
      let fnBody: Record<string, unknown> = {};

      switch (job.job_type) {
        case "download":
          fnName = "curriculum-download-document";
          fnBody = { candidate_id: job.candidate_id };
          break;
        case "parse":
          fnName = "curriculum-parse-document";
          fnBody = { document_id: job.source_document_id };
          break;
        case "promote":
          fnName = "curriculum-promote-candidates";
          fnBody = { limit: 1 };
          break;
        default:
          throw new Error(`Unknown job_type: ${job.job_type}`);
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(fnBody),
      });

      const data = await res.json().catch(() => ({}));

      await sb.from("curriculum_intake_jobs").update({
        status: res.ok ? "done" : "failed",
        finished_at: new Date().toISOString(),
        last_error: res.ok ? null : JSON.stringify(data),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      results.push({ job_id: job.id, status: res.ok ? "done" : "failed", data });
    } catch (e) {
      await sb.from("curriculum_intake_jobs").update({
        status: job.attempts >= (job.max_attempts || 5) ? "cancelled" : "failed",
        last_error: (e as Error).message,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      results.push({ job_id: job.id, status: "failed", error: (e as Error).message });
    }
  }

  return json(200, { ok: true, claimed: jobs?.length || 0, results }, origin);
});
