import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeFetchedTitle(url: string, body: string): string {
  const titleMatch = body.match(/<title[^>]*>(.*?)<\/title>/is);
  if (titleMatch?.[1]) return titleMatch[1].replace(/\s+/g, " ").trim();
  return url;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const workerId = body.worker_id || "qualification-fetch-documents";
  const claimLimit = Math.min(Number(body.limit ?? 10), 25);

  const { data: jobs, error: claimErr } = await sb.rpc("claim_qualification_fetch_jobs", {
    p_limit: claimLimit,
    p_worker_id: workerId,
    p_lease_minutes: 10,
  });

  if (claimErr) return json(500, { error: claimErr.message });

  const results: any[] = [];

  for (const job of jobs || []) {
    try {
      const { data: source } = await sb
        .from("qualification_source_registry")
        .select("*")
        .eq("id", job.source_registry_id)
        .single();

      if (!source?.canonical_url) throw new Error("source_not_found");

      const res = await fetch(source.canonical_url, {
        headers: {
          "User-Agent": "ExamFit Qualification Intake Bot/1.0",
          "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.8",
        },
      });

      const contentType = res.headers.get("content-type") || "";
      const bodyText = await res.text();

      let candidateId = job.candidate_id;

      if (!candidateId) {
        const { data: candidateUpsert } = await sb.rpc("upsert_qualification_candidate", {
          p_title_raw: (source as any).meta?.title_raw || source.canonical_url,
          p_source_url: source.canonical_url,
          p_provider_family: source.provider_family,
          p_source_type: contentType.includes("pdf") ? "pdf" : "html",
          p_award_type_hint: (job.payload as any)?.award_type || null,
          p_metadata: {
            source_registry_id: source.id,
            discovery_payload: job.payload,
          },
        });
        candidateId = candidateUpsert;
      }

      const extractedTitle = normalizeFetchedTitle(source.canonical_url, bodyText);
      const contentText = contentType.includes("html") ? htmlToText(bodyText) : bodyText;

      await sb.from("intake_raw_documents").insert({
        candidate_id: candidateId,
        source_url: source.canonical_url,
        content_type: contentType,
        extracted_title: extractedTitle,
        content_text: contentText,
        source_hash: crypto.randomUUID(),
        metadata: {
          source_registry_id: source.id,
          http_status: res.status,
        },
      });

      await sb.from("qualification_candidates").update({
        status: "raw_fetched",
        updated_at: new Date().toISOString(),
      }).eq("id", candidateId);

      await sb.from("qualification_fetch_queue").update({
        status: "done",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_http_status: res.status,
        candidate_id: candidateId,
      }).eq("id", job.id);

      await sb.from("qualification_source_registry").update({
        content_type: contentType,
        intake_candidate_id: candidateId,
        last_seen_at: new Date().toISOString(),
      }).eq("id", source.id);

      results.push({
        job_id: job.id,
        candidate_id: candidateId,
        url: source.canonical_url,
        status: "done",
      });
    } catch (e) {
      await sb.from("qualification_fetch_queue").update({
        status: (job.attempts || 0) + 1 >= (job.max_attempts || 5) ? "dead" : "failed",
        last_error: (e as Error).message,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      }).eq("id", job.id);

      results.push({
        job_id: job.id,
        status: "failed",
        error: (e as Error).message,
      });
    }
  }

  return json(200, {
    ok: true,
    claimed: jobs?.length || 0,
    results,
  });
});
