import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, getCorsHeaders } from "../_shared/cors.ts";
import { validateExamPool, type ExamQuestionRecord } from "../_shared/certifications/validate-exam-pool.ts";

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
        const { data: curriculum } = await sb
          .from("curricula")
          .select("id")
          .eq("certification_id", cert.id)
          .limit(1)
          .single();

        if (!curriculum) throw new Error(`No curriculum for ${cert.slug}`);

        // Fetch all blueprints (paginated)
        const blueprintIds: string[] = [];
        let bpFrom = 0;
        while (true) {
          const { data: page } = await sb
            .from("question_blueprints")
            .select("id")
            .eq("curriculum_id", curriculum.id)
            .neq("status", "deprecated")
            .order("id", { ascending: true })
            .range(bpFrom, bpFrom + 499);

          if (!page || page.length === 0) break;
          blueprintIds.push(...page.map((r: any) => r.id));
          if (page.length < 500) break;
          bpFrom += 500;
        }

        // Fetch all exam questions (paginated)
        const allQuestions: ExamQuestionRecord[] = [];
        let qFrom = 0;
        while (true) {
          const { data: page } = await sb
            .from("exam_questions")
            .select("id, blueprint_id, competency_id, question_type, question_text, options, correct_answer, explanation, trap_type, conflict_type, review_state, status")
            .eq("certification_id", cert.id)
            .order("id", { ascending: true })
            .range(qFrom, qFrom + 499);

          if (!page || page.length === 0) break;
          allQuestions.push(...(page as unknown as ExamQuestionRecord[]));
          if (page.length < 500) break;
          qFrom += 500;
        }

        const result = validateExamPool({
          certSlug: cert.slug,
          certId: cert.id,
          curriculumId: curriculum.id,
          validationProfile: cert.validation_profile ?? "CERT_TECH",
          questions: allQuestions,
          blueprintIds,
        });

        results.push(result as unknown as Record<string, unknown>);
      } catch (e) {
        results.push({ slug: cert.slug, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const overallGate = results.some((r: any) => r.gate_class === "major_regeneration_required")
      ? "major_regeneration_required"
      : results.some((r: any) => r.gate_class === "targeted_regeneration_required")
        ? "targeted_regeneration_required"
        : results.some((r: any) => r.gate_class === "warning")
          ? "warning"
          : "pass";

    return json(200, { ok: true, overall_gate: overallGate, results }, req);
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) }, req);
  }
});
