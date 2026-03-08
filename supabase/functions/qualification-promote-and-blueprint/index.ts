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
  const limit = Math.min(Number(body.limit ?? 10), 50);
  const perCompetency = Math.min(Number(body.per_competency ?? 6), 12);

  // Find ready drafts not yet promoted to curricula
  const { data: drafts, error: dErr } = await sb
    .from("qualification_curriculum_drafts")
    .select("id, draft_title, qualification_catalog_id, readiness_score, award_type, education_type")
    .in("status", ["ready"])
    .order("readiness_score", { ascending: false })
    .limit(limit);

  if (dErr) return json(500, { error: dErr.message }, origin);

  const results: any[] = [];

  for (const draft of drafts || []) {
    try {
      // Step 1: Generate curriculum (learning_fields + competencies)
      const { data: currResult, error: currErr } = await sb.rpc(
        "generate_curriculum_from_qualification_draft",
        { p_draft_id: draft.id }
      );

      if (currErr) throw new Error(`curriculum: ${currErr.message}`);
      if (!currResult?.ok) {
        results.push({ draft_id: draft.id, step: "curriculum", skipped: currResult?.reason });
        continue;
      }

      const curriculumId = currResult.curriculum_id;

      // Step 2: Generate exam blueprint
      const { data: bpResult, error: bpErr } = await sb.rpc(
        "generate_exam_blueprint_from_qualification_draft",
        { p_draft_id: draft.id, p_curriculum_id: curriculumId }
      );

      if (bpErr) throw new Error(`blueprint: ${bpErr.message}`);

      const blueprintId = bpResult?.blueprint_id;

      // Step 3: Seed question blueprints
      let seedResult: any = null;
      if (blueprintId) {
        const { data: sResult, error: sErr } = await sb.rpc(
          "seed_question_blueprints_from_qualification",
          {
            p_curriculum_id: curriculumId,
            p_blueprint_id: blueprintId,
            p_per_competency: perCompetency,
          }
        );

        if (sErr) throw new Error(`seed: ${sErr.message}`);
        seedResult = sResult;
      }

      results.push({
        draft_id: draft.id,
        draft_title: draft.draft_title,
        curriculum_id: curriculumId,
        blueprint_id: blueprintId,
        learning_fields: currResult.learning_fields,
        competencies: currResult.competencies,
        question_blueprints: seedResult?.created_blueprints ?? 0,
        ok: true,
      });
    } catch (e) {
      results.push({
        draft_id: draft.id,
        draft_title: draft.draft_title,
        error: (e as Error).message,
        ok: false,
      });
    }
  }

  return json(200, {
    ok: true,
    processed: results.length,
    results,
  }, origin);
});
