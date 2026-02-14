import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("course_id", p?.course_id);
    assertUuid("curriculum_id", p?.curriculum_id);
    assertUuid("certification_id", p?.certification_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id;

  // pipeline-runner handles step_start/step_done/step_fail.
  // Do NOT touch pipeline_lock / course_package_locks / update_course_package_step.

  try {
    // Idempotent: check if already done for this package
    const { data: existingIdx } = await sb
      .from("ai_tutor_context_index").select("id")
      .eq("package_id", packageId).maybeSingle();

    if (existingIdx) {
      console.log("ai_tutor_context_index already exists for package, skipping insert");
    }

    // Policy: find or create for this curriculum
    const { data: existing } = await sb
      .from("ai_tutor_policies").select("id, version")
      .eq("curriculum_id", curriculumId)
      .order("version", { ascending: false }).limit(1).maybeSingle();

    let policyVersion = existing?.version || 0;

    if (!existing) {
      policyVersion = 1;
      const policy = {
        forbid_invention: true,
        require_reference: true,
        allowed_sources: ["curriculum_topics", "lessons", "question_blueprints", "exam_sessions", "oral_exam_sessionsets"],
        modes: ["explainer", "coach", "examiner", "feedback"],
        binding_rule: "each answer must map to competency OR lesson OR exam_session",
      };
      const { error: polErr } = await sb.from("ai_tutor_policies").insert({
        curriculum_id: curriculumId, policy, version: policyVersion,
      });
      if (polErr) {
        throw new Error(`Policy insert failed: ${polErr.message || JSON.stringify(polErr)}`);
      }
    }

    // Counts
    const { count: lessonCount } = await sb
      .from("lessons").select("id", { count: "exact", head: true }).eq("course_id", courseId);

    const { count: topicCount } = await sb
      .from("curriculum_topics").select("id", { count: "exact", head: true }).eq("certification_id", certificationId);

    // Context index (idempotent)
    if (!existingIdx) {
      const { error: idxErr } = await sb.from("ai_tutor_context_index").insert({
        package_id: packageId, index_version: 1,
        stats: { lessonCount: lessonCount ?? 0, topicCount: topicCount ?? 0, policyVersion },
      });
      if (idxErr) {
        throw new Error(`Context index insert failed: ${idxErr.message || JSON.stringify(idxErr)}`);
      }
    }

    return json({ ok: true, policyVersion, lessonCount: lessonCount ?? 0, topicCount: topicCount ?? 0 });
  } catch (e: unknown) {
    const msg = typeof e === "object" && e !== null && "message" in e ? (e as Error).message : JSON.stringify(e);
    console.error("build_ai_tutor_index error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
