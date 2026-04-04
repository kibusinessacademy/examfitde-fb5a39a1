import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, getCorsHeaders } from "../_shared/cors.ts";

function json(status: number, body: unknown, origin?: string | null) {
  const headers = origin ? getCorsHeaders(origin) : getCorsHeaders("*");
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

type ExamQuestion = {
  id: string;
  curriculum_id: string;
  competency_id: string | null;
  blueprint_id: string | null;
  question_type: string;
  question_text: string;
  options: Array<{ id?: string; text: string; is_correct: boolean }>;
  correct_answer: number;
  explanation: string;
  trap_type: string | null;
  conflict_type: string | null;
  cognitive_level: string | null;
  difficulty: string | null;
};

function mapDifficulty(cogLevel: string | null, difficulty: string | null): string {
  if (difficulty && ["easy", "medium", "hard"].includes(difficulty)) return difficulty;
  switch (cogLevel) {
    case "remember":
    case "understand":
      return "easy";
    case "apply":
    case "analyze":
      return "medium";
    case "evaluate":
    case "create":
      return "hard";
    default:
      return "medium";
  }
}

function buildMiniCheckRow(eq: ExamQuestion, sortOrder: number) {
  return {
    lesson_id: null,
    curriculum_id: eq.curriculum_id,
    competency_id: eq.competency_id,
    question_text: eq.question_text,
    options: eq.options,
    correct_answer: eq.correct_answer,
    explanation: eq.explanation,
    difficulty: mapDifficulty(eq.cognitive_level, eq.difficulty),
    cognitive_level: eq.cognitive_level ?? "apply",
    mode: "drill",
    status: "draft",
    sort_order: sortOrder,
    source_blueprint_id: eq.blueprint_id,
    trap_type: eq.trap_type,
    trap_tags: eq.trap_type ? [eq.trap_type] : [],
    distractor_meta: {
      source_exam_question_id: eq.id,
      source_blueprint_id: eq.blueprint_id,
      derivation: "exam_pool_to_minicheck_v1",
    },
  };
}

async function fetchAllRows(
  sb: ReturnType<typeof createClient>,
  table: string,
  filters: Record<string, unknown>,
  select: string,
  orderCol = "id"
) {
  const rows: unknown[] = [];
  let from = 0;
  const pageSize = 500;
  while (true) {
    let q = sb.from(table).select(select).order(orderCol, { ascending: true }).range(from, from + pageSize - 1);
    for (const [k, v] of Object.entries(filters)) {
      q = q.eq(k, v);
    }
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const certIds: string[] = body.certification_ids ?? [];
    const slugs: string[] = body.slugs ?? [];
    const maxPerCompetency: number = body.max_per_competency ?? 5;

    if (!certIds.length && !slugs.length) {
      return json(400, { error: "certification_ids or slugs required" }, origin);
    }

    // Resolve certifications
    let certQuery = sb.from("certifications").select("id, slug, title");
    if (certIds.length) certQuery = certQuery.in("id", certIds);
    else certQuery = certQuery.in("slug", slugs);
    const { data: certs, error: certErr } = await certQuery;
    if (certErr) return json(500, { error: certErr.message }, origin);
    if (!certs?.length) return json(404, { error: "No certifications found" }, origin);

    const results: Array<Record<string, unknown>> = [];

    for (const cert of certs) {
      try {
        // Get curriculum
        const { data: curriculum, error: curErr } = await sb
          .from("curricula")
          .select("id")
          .eq("certification_id", cert.id)
          .limit(1)
          .single();
        if (curErr || !curriculum) throw new Error(`No curriculum for ${cert.slug}`);

        // Fetch all exam_questions for this curriculum
        const examQuestions = (await fetchAllRows(
          sb,
          "exam_questions",
          { curriculum_id: curriculum.id },
          "id, curriculum_id, competency_id, blueprint_id, question_type, question_text, options, correct_answer, explanation, trap_type, conflict_type, cognitive_level, difficulty",
        )) as ExamQuestion[];

        if (examQuestions.length === 0) {
          results.push({ slug: cert.slug, ok: false, error: "No exam_questions found" });
          continue;
        }

        // Check existing minicheck_questions to avoid duplicates (by source_blueprint_id)
        const blueprintIds = examQuestions.map((eq) => eq.blueprint_id).filter(Boolean) as string[];
        const existingMCs = blueprintIds.length > 0
          ? await fetchAllRows(
              sb,
              "minicheck_questions",
              { curriculum_id: curriculum.id },
              "source_blueprint_id",
            )
          : [];
        const existingBpSet = new Set(
          (existingMCs as Array<{ source_blueprint_id: string | null }>)
            .map((m) => m.source_blueprint_id)
            .filter(Boolean),
        );

        // Group by competency
        const byCompetency = new Map<string, ExamQuestion[]>();
        for (const eq of examQuestions) {
          const key = eq.competency_id ?? "unknown";
          if (!byCompetency.has(key)) byCompetency.set(key, []);
          byCompetency.get(key)!.push(eq);
        }

        // Select up to maxPerCompetency per competency, skip already-derived
        const pendingRows: ReturnType<typeof buildMiniCheckRow>[] = [];
        let sortCounter = 0;

        for (const [_compId, questions] of byCompetency) {
          // Filter out already-derived
          const fresh = questions.filter((eq) => !existingBpSet.has(eq.blueprint_id ?? ""));
          // Deterministic selection: prefer diversity of trap_type + cognitive_level
          const selected = fresh.slice(0, maxPerCompetency);
          for (const eq of selected) {
            pendingRows.push(buildMiniCheckRow(eq, ++sortCounter));
          }
        }

        if (pendingRows.length === 0) {
          results.push({
            slug: cert.slug,
            ok: true,
            skipped: true,
            reason: "all_minichecks_exist",
            exam_questions_total: examQuestions.length,
          });
          continue;
        }

        // Batch insert
        let inserted = 0;
        for (let i = 0; i < pendingRows.length; i += 50) {
          const batch = pendingRows.slice(i, i + 50);
          const { error: insErr } = await sb.from("minicheck_questions").insert(batch);
          if (insErr) throw insErr;
          inserted += batch.length;
        }

        // Distribution stats
        const diffDist: Record<string, number> = {};
        const trapDist: Record<string, number> = {};
        for (const row of pendingRows) {
          diffDist[row.difficulty] = (diffDist[row.difficulty] ?? 0) + 1;
          const tt = row.trap_type ?? "none";
          trapDist[tt] = (trapDist[tt] ?? 0) + 1;
        }

        results.push({
          slug: cert.slug,
          ok: true,
          curriculum_id: curriculum.id,
          exam_questions_total: examQuestions.length,
          competencies_covered: byCompetency.size,
          minichecks_generated: inserted,
          minichecks_skipped: examQuestions.length - pendingRows.length,
          distribution: { difficulty: diffDist, trap_type: trapDist },
        });
      } catch (e) {
        results.push({
          slug: cert.slug,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return json(200, { ok: true, results }, origin);
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) }, origin);
  }
});
