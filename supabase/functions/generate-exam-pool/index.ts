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

        // Filter out blueprints with missing mandatory fields
        const validBlueprints = allBlueprints.filter(bp => {
          if (!bp.competency_id || !bp.learning_field_id || !bp.curriculum_id) {
            console.warn(`[generate-exam-pool] Skipping blueprint ${bp.id}: missing competency_id=${bp.competency_id}, learning_field_id=${bp.learning_field_id}`);
            return false;
          }
          return true;
        });

        const skippedInvalid = allBlueprints.length - validBlueprints.length;
        if (skippedInvalid > 0) {
          console.warn(`[generate-exam-pool] ${cert.slug}: skipped ${skippedInvalid} blueprints with missing FK fields`);
        }

        if (validBlueprints.length === 0) {
          results.push({ slug: cert.slug, ok: false, error: "No valid blueprints (all missing mandatory fields)" });
          continue;
        }

        // Dedup against valid blueprints only
        const bpIds = validBlueprints.map((bp) => bp.id);
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

        const pendingRows = validBlueprints
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
        let promotable = 0;
        let needsReview = 0;
        for (const row of pendingRows) {
          if (row.qc_status === "tier1_passed") promotable++;
          else needsReview++;
        }

        for (let i = 0; i < pendingRows.length; i += 50) {
          const batch = pendingRows.slice(i, i + 50);
          const { error: insErr } = await sb.from("exam_questions").insert(batch);
          if (insErr) throw insErr;
          inserted += batch.length;
        }

        // ── Stufe 3: Post-insert threshold check ──
        const APPROVED_THRESHOLD = 50;
        const { count: approvedCount } = await sb
          .from("exam_questions")
          .select("id", { count: "exact", head: true })
          .eq("certification_id", cert.id)
          .eq("status", "approved");

        const belowThreshold = (approvedCount ?? 0) < APPROVED_THRESHOLD;

        // If below threshold and there are promotable drafts, enqueue heal job
        if (belowThreshold && promotable > 0) {
          // Resolve package_id from certification (NOT cert.id!)
          const { data: pkg } = await sb
            .from("course_packages")
            .select("id")
            .eq("certification_id", cert.id)
            .eq("status", "building")
            .limit(1)
            .single();

          if (pkg) {
            // Check for existing heal job using correct package_id
            const { data: existingJob } = await sb
              .from("job_queue")
              .select("id")
              .eq("job_type", "heal_exam_promotion")
              .in("status", ["pending", "queued", "processing"])
              .eq("package_id", pkg.id)
              .limit(1);

            if (!existingJob?.length) {
              console.log(`[generate-exam-pool] ${cert.slug}: approved=${approvedCount}/${APPROVED_THRESHOLD}, package=${pkg.id}, deficit heal eligible`);
            }
          }
        }

        results.push({
          slug: cert.slug, ok: true,
          curriculum_id: curriculum.id,
          blueprints_total: allBlueprints.length,
          blueprints_valid: validBlueprints.length,
          blueprints_skipped_invalid: skippedInvalid,
          questions_generated: inserted,
          questions_skipped: validBlueprints.length - pendingRows.length,
          questions_promotable: promotable,
          questions_needs_review: needsReview,
          approved_total: approvedCount ?? 0,
          below_threshold: belowThreshold,
          validation_profile: cert.validation_profile,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : (typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e));
        results.push({ slug: cert.slug, ok: false, error: errMsg });
      }
    }

    return json(200, { ok: true, results }, req);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : (typeof e === 'object' && e !== null ? JSON.stringify(e) : String(e));
    return json(500, { ok: false, error: errMsg }, req);
  }
});
