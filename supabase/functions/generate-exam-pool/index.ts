import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, getCorsHeaders } from "../_shared/cors.ts";
import { buildExamQuestionRow, type BlueprintQuestionSource } from "../_shared/certifications/exam-pool-from-blueprint.ts";

function json(status: number, body: unknown, req: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  if (req.method !== "POST") return json(405, { error: "POST only" }, req);

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const certIds: string[] = body.certification_ids ?? [];
    const slugs: string[] = body.slugs ?? [];

    if (!certIds.length && !slugs.length) {
      return json(400, { error: "certification_ids or slugs required" }, req);
    }

    let certQuery = sb.from("certifications").select("id, slug, title, validation_profile");
    if (certIds.length) certQuery = certQuery.in("id", certIds);
    else certQuery = certQuery.in("slug", slugs);

    const { data: certs, error: certErr } = await certQuery;
    if (certErr) return json(500, { error: certErr.message }, req);
    if (!certs?.length) return json(404, { error: "No certifications found" }, req);

    const results: Array<Record<string, unknown>> = [];

    for (const cert of certs) {
      try {
        const { data: curriculum, error: curErr } = await sb
          .from("curricula")
          .select("id")
          .eq("certification_id", cert.id)
          .limit(1)
          .single();

        if (curErr || !curriculum) throw new Error(`No curriculum for ${cert.slug}`);

        // Paginated blueprint fetch
        const allBlueprints: BlueprintQuestionSource[] = [];
        let from = 0;
        const pageSize = 500;
        while (true) {
          const { data: page, error: bpErr } = await sb
            .from("question_blueprints")
            .select("id, curriculum_id, competency_id, learning_field_id, name, canonical_statement, knowledge_type, cognitive_level, didactic_intent, exam_context_type, decision_structure, expected_trap_type, allowed_question_types, exam_relevance_score")
            .eq("curriculum_id", curriculum.id)
            .neq("status", "deprecated")
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);

          if (bpErr) throw bpErr;
          if (!page || page.length === 0) break;
          allBlueprints.push(...(page as BlueprintQuestionSource[]));
          if (page.length < pageSize) break;
          from += pageSize;
        }

        if (allBlueprints.length === 0) {
          results.push({ slug: cert.slug, ok: false, error: "No blueprints found" });
          continue;
        }

        // Dedup: check existing questions by blueprint_id
        const bpIds = allBlueprints.map((bp) => bp.id);
        const existingSet = new Set<string>();
        for (let i = 0; i < bpIds.length; i += 500) {
          const chunk = bpIds.slice(i, i + 500);
          const { data: existing } = await sb
            .from("exam_questions")
            .select("blueprint_id")
            .eq("certification_id", cert.id)
            .in("blueprint_id", chunk);
          for (const row of existing ?? []) {
            if (row.blueprint_id) existingSet.add(row.blueprint_id);
          }
        }

        const pendingRows = allBlueprints
          .filter((bp) => !existingSet.has(bp.id))
          .map((bp) => buildExamQuestionRow({ certificationId: cert.id, blueprint: bp }));

        if (pendingRows.length === 0) {
          results.push({
            slug: cert.slug, ok: true, skipped: true,
            reason: "all_exam_questions_exist",
            total_blueprints: allBlueprints.length,
          });
          continue;
        }

        // Batch insert in chunks of 50
        let inserted = 0;
        for (let i = 0; i < pendingRows.length; i += 50) {
          const batch = pendingRows.slice(i, i + 50);
          const { error: insErr } = await sb.from("exam_questions").insert(batch);
          if (insErr) throw insErr;
          inserted += batch.length;
        }

        results.push({
          slug: cert.slug, ok: true,
          curriculum_id: curriculum.id,
          blueprints_total: allBlueprints.length,
          questions_generated: inserted,
          questions_skipped: allBlueprints.length - pendingRows.length,
          validation_profile: cert.validation_profile,
        });
      } catch (e) {
        results.push({ slug: cert.slug, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json(200, { ok: true, results }, req);
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) }, req);
  }
});
