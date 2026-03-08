import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseByProviderFamily } from "../_shared/qualification-provider-parsers.ts";
import { extractSections } from "../_shared/pdf-sectionizer.ts";
import { computeConfidence } from "../_shared/qualification-confidence.ts";

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

      // Base parse by provider family
      const parsed = parseByProviderFamily({
        providerFamily: c.provider_family || "misc",
        title: doc.extracted_title || c.title_raw,
        text: doc.content_text,
        url: c.source_url || "",
      });

      // Enhanced: PDF Sectionizer overlay
      const sections = extractSections(doc.content_text);

      // Merge sectionizer results into parsed model
      if (sections.exam_parts.length > 0) {
        parsed.exam_parts = [
          ...(parsed.exam_parts || []),
          ...sections.exam_parts.map((t: string) => ({ title: t, source: "sectionizer" })),
        ];
      }
      if (sections.handlungsbereiche.length > 0) {
        parsed.handlungsbereiche = [
          ...(parsed.handlungsbereiche || []),
          ...sections.handlungsbereiche.map((t: string) => ({ title: t, source: "sectionizer" })),
        ];
      }
      if (sections.competency_areas.length > 0) {
        parsed.competency_areas = [
          ...(parsed.competency_areas || []),
          ...sections.competency_areas.map((t: string) => ({ title: t, source: "sectionizer" })),
        ];
      }
      if (sections.project_component) {
        parsed.project_components = [
          ...(parsed.project_components || []),
          ...sections.competency_areas
            .filter(() => sections.project_component)
            .slice(0, 1)
            .map(() => ({ title: "Projektarbeit", source: "sectionizer" })),
        ];
        if (!parsed.project_components.length) {
          parsed.project_components = [{ title: "Projektarbeit", source: "sectionizer" }];
        }
      }
      if (sections.oral_component) {
        parsed.oral_components = [
          ...(parsed.oral_components || []),
          { title: "Mündliche Prüfung / Fachgespräch", source: "sectionizer" },
        ];
      }

      // Admission rules from sectionizer
      if (sections.admission_hints.length > 0 && !parsed.admission_rules) {
        parsed.admission_rules = sections.admission_hints;
      }

      // Pass rules from sectionizer
      if (sections.pass_rule_hints.length > 0 && !parsed.pass_rules) {
        parsed.pass_rules = sections.pass_rule_hints;
      }

      // Legal basis from sectionizer
      if (sections.legal_references.length > 0 && !parsed.legal_basis) {
        parsed.legal_basis = sections.legal_references[0];
      }

      // Confidence Council: compute quality score
      const confidenceScore = computeConfidence({
        exam_parts: parsed.exam_parts,
        handlungsbereiche: parsed.handlungsbereiche,
        competency_areas: parsed.competency_areas,
        project_components: parsed.project_components,
        oral_components: parsed.oral_components,
        legal_basis: parsed.legal_basis,
        regulation_reference: parsed.regulation_reference,
        admission_rules: parsed.admission_rules,
        pass_rules: parsed.pass_rules,
        title_aliases: parsed.title_aliases,
      });

      // Use the higher of parser quality score and confidence score
      const finalScore = Math.max(parsed.quality_score || 0, confidenceScore);

      const { data: parsedId, error: parseErr } = await sb.rpc("upsert_parsed_qualification_model", {
        p_candidate_id: c.id,
        p_parser_version: "v4-sectionizer-confidence",
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
        p_quality_score: finalScore,
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
        quality_score: finalScore,
        confidence_score: confidenceScore,
        award_type: parsed.award_type,
        sectionizer: {
          paragraphs: sections.paragraphs.length,
          exam_parts: sections.exam_parts.length,
          handlungsbereiche: sections.handlungsbereiche.length,
          project: sections.project_component,
          oral: sections.oral_component,
        },
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
