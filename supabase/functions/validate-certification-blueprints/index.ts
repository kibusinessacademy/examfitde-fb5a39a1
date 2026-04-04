import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import {
  validateBlueprints,
  type BlueprintRecord,
  type BlueprintValidationResult,
} from "../_shared/certifications/validate-blueprints.ts";

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
  const certIds: string[] = body.certification_ids ?? [];
  const slugs: string[] = body.slugs ?? [];

  if (!certIds.length && !slugs.length) {
    return json(400, { error: "certification_ids or slugs required" }, origin);
  }

  // Resolve certifications
  let certQuery = sb
    .from("certifications")
    .select("id, title, slug, validation_profile");

  if (certIds.length) {
    certQuery = certQuery.in("id", certIds);
  } else {
    certQuery = certQuery.in("slug", slugs);
  }

  const { data: certs, error: certErr } = await certQuery;
  if (certErr) return json(500, { error: certErr.message }, origin);
  if (!certs?.length) return json(404, { error: "No certifications found" }, origin);

  const results: BlueprintValidationResult[] = [];
  let allPassed = true;

  for (const cert of certs) {
    try {
      // Get curriculum
      const { data: curriculum } = await sb
        .from("curricula")
        .select("id")
        .eq("certification_id", cert.id)
        .limit(1)
        .single();

      if (!curriculum) {
        results.push({
          certification_slug: cert.slug,
          certification_id: cert.id,
          curriculum_id: "",
          validation_profile: cert.validation_profile ?? "GENERAL",
          total_blueprints: 0,
          total_competencies: 0,
          gate_class: "major_regeneration_required",
          findings: [{ code: "NO_CURRICULUM", severity: "critical", detail: "No curriculum found" }],
          distribution: { by_knowledge_type: {}, by_cognitive_level: {}, by_trap_type: {}, difficulty_approx: {} },
          coverage: { competencies_covered: 0, competencies_total: 0, coverage_pct: 0 },
        });
        allPassed = false;
        continue;
      }

      // Get learning fields for this curriculum
      const { data: lfs } = await sb
        .from("learning_fields")
        .select("id")
        .eq("curriculum_id", curriculum.id);
      const lfIds = (lfs ?? []).map((lf: any) => lf.id);

      // Get all competencies
      const { data: comps } = await sb
        .from("competencies")
        .select("id")
        .in("learning_field_id", lfIds.length ? lfIds : ["__none__"])
        .order("id", { ascending: true });
      const competencyIds = (comps ?? []).map((c: any) => c.id);

      // Get all non-deprecated blueprints — paginated
      const allBps: BlueprintRecord[] = [];
      let from = 0;
      const pageSize = 500;
      while (true) {
        const { data: page } = await sb
          .from("question_blueprints")
          .select(
            "id, curriculum_id, competency_id, learning_field_id, name, canonical_statement, knowledge_type, cognitive_level, didactic_intent, exam_context_type, expected_trap_type, exam_relevance_score, allowed_question_types, status"
          )
          .eq("curriculum_id", curriculum.id)
          .neq("status", "deprecated")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);

        if (!page || page.length === 0) break;
        allBps.push(...(page as unknown as BlueprintRecord[]));
        if (page.length < pageSize) break;
        from += pageSize;
      }

      const result = validateBlueprints({
        certSlug: cert.slug,
        certId: cert.id,
        curriculumId: curriculum.id,
        validationProfile: cert.validation_profile ?? "GENERAL",
        blueprints: allBps,
        competencyIds,
      });

      if (result.gate_class !== "pass") allPassed = false;
      results.push(result);
    } catch (e) {
      allPassed = false;
      results.push({
        certification_slug: cert.slug,
        certification_id: cert.id,
        curriculum_id: "",
        validation_profile: cert.validation_profile ?? "GENERAL",
        total_blueprints: 0,
        total_competencies: 0,
        gate_class: "major_regeneration_required",
        findings: [{ code: "VALIDATION_ERROR", severity: "critical", detail: (e as Error).message }],
        distribution: { by_knowledge_type: {}, by_cognitive_level: {}, by_trap_type: {}, difficulty_approx: {} },
        coverage: { competencies_covered: 0, competencies_total: 0, coverage_pct: 0 },
      });
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.gate_class === "pass").length,
    warning: results.filter((r) => r.gate_class === "warning").length,
    targeted_regen: results.filter((r) => r.gate_class === "targeted_regeneration_required").length,
    major_regen: results.filter((r) => r.gate_class === "major_regeneration_required").length,
    all_passed: allPassed,
  };

  return json(200, { ok: true, summary, results }, origin);
});
