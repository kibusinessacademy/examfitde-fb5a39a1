import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseByProviderFamily } from "../_shared/qualification-provider-parsers.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 20), 50);

  const { data: candidates, error } = await sb
    .from("qualification_candidates")
    .select(`
      *,
      intake_raw_documents(*)
    `)
    .eq("status", "raw_fetched")
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) return json(500, { error: error.message });

  const results: any[] = [];

  for (const c of candidates || []) {
    try {
      const docs = ((c as any).intake_raw_documents || []) as any[];
      const doc = docs.sort((a: any, b: any) => +new Date(b.fetched_at) - +new Date(a.fetched_at))[0];
      if (!doc?.content_text) {
        results.push({ candidate_id: c.id, error: "missing_content_text" });
        continue;
      }

      const parsed = parseByProviderFamily({
        providerFamily: c.provider_family || "misc",
        title: doc.extracted_title || c.title_raw,
        text: doc.content_text,
        url: c.source_url || "",
      });

      const { data: parsedId, error: parseErr } = await sb.rpc("upsert_parsed_qualification_model", {
        p_candidate_id: c.id,
        p_parser_version: "v3-pdf-html-pipeline",
        p_canonical_title: parsed.canonical_title,
        p_education_type: parsed.education_type,
        p_award_type: parsed.award_type,
        p_provider_family: parsed.provider_family,
        p_source_authority: parsed.source_authority,
        p_legal_basis: parsed.legal_basis,
        p_regulation_reference: parsed.regulation_reference,
        p_exam_parts: parsed.exam_parts,
        p_handlungsbereiche: parsed.handlungsbereiche,
        p_competency_areas: parsed.competency_areas,
        p_oral_components: parsed.oral_components,
        p_project_components: parsed.project_components,
        p_admission_rules: parsed.admission_rules,
        p_pass_rules: parsed.pass_rules,
        p_title_aliases: parsed.title_aliases,
        p_evidence: parsed.evidence,
        p_quality_score: parsed.quality_score,
        p_warnings: parsed.warnings,
      });

      if (parseErr) throw parseErr;

      await sb.from("qualification_candidates").update({
        status: "parsed",
        updated_at: new Date().toISOString(),
      }).eq("id", c.id);

      results.push({
        candidate_id: c.id,
        parsed_model_id: parsedId,
        quality_score: parsed.quality_score,
        award_type: parsed.award_type,
      });
    } catch (e) {
      results.push({
        candidate_id: c.id,
        error: (e as Error).message,
      });
    }
  }

  return json(200, {
    ok: true,
    processed: results.length,
    results,
  });
});
