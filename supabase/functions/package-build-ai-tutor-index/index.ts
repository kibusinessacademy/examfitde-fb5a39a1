import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}
async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data, error } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (error) throw error;
  return data?.status === "done";
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
    // certification_id is optional — fallback to curriculum_id for topic lookups
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || curriculumId; // fallback for topic lookups

  // Runner SSOT: prerequisites via view (mapped to package_steps)
  if (!(await prereqDone(sb, packageId, "generate_oral_exam"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_oral_exam" }, 409);
  }

  // Idempotent: check if already done for this package
  const { data: existingIdx, error: exErr } = await sb
    .from("ai_tutor_context_index").select("id")
    .eq("package_id", packageId).maybeSingle();
  if (exErr) throw exErr;

  // Policy: find or create for this curriculum
  const { data: existingPolicy, error: polQErr } = await sb
    .from("ai_tutor_policies").select("id, version")
    .eq("curriculum_id", curriculumId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (polQErr) throw polQErr;

  let policyVersion = existingPolicy?.version || 0;

  if (!existingPolicy) {
    policyVersion = 1;
    const policy = {
      forbid_invention: true,
      require_reference: true,
      allowed_sources: ["curriculum_topics", "lessons", "question_blueprints", "exam_sessions", "oral_exam_sessionsets"],
      modes: ["explainer", "coach", "examiner", "feedback"],
      binding_rule: "each answer must map to competency OR lesson OR exam_session OR curriculum_topic",
      depth_requirement: "tutor must reference curriculum_topics subtopics when answering domain-specific questions",
    };
    const { error: polInsErr } = await sb.from("ai_tutor_policies").insert({
      curriculum_id: curriculumId, policy, version: policyVersion,
    });
    if (polInsErr) throw new Error(`Policy insert failed: ${polInsErr.message}`);
  }

  // Counts — now including curriculum_topics depth
  // Count lessons via modules (lessons has module_id, not course_id)
  const { data: modulesForCourse } = await sb
    .from("modules").select("id").eq("course_id", courseId);
  const modIds = (modulesForCourse || []).map((m: any) => m.id);
  const { count: lessonCount } = modIds.length > 0
    ? await sb.from("lessons").select("id", { count: "exact", head: true }).in("module_id", modIds)
    : { count: 0 };

  const { count: topicCount } = await sb
    .from("curriculum_topics").select("id", { count: "exact", head: true }).eq("certification_id", certificationId);

  const { count: subtopicCount } = await sb
    .from("curriculum_topics").select("id", { count: "exact", head: true })
    .eq("certification_id", certificationId)
    .not("parent_topic_id", "is", null);

  // ═══ DEPTH GATE: Warn if no subtopics exist ═══
  const depthStatus = (subtopicCount ?? 0) > 0 ? "deep" : "shallow";
  if (depthStatus === "shallow") {
    console.warn(`[AI-Tutor-Index] ⚠️ No subtopics for certification ${certificationId} — tutor will have limited depth`);
  }

  // Context index (idempotent)
  if (!existingIdx) {
    const { error: idxErr } = await sb.from("ai_tutor_context_index").insert({
      package_id: packageId,
      index_version: 1,
      stats: {
        lessonCount: lessonCount ?? 0,
        topicCount: topicCount ?? 0,
        subtopicCount: subtopicCount ?? 0,
        depthStatus,
        policyVersion,
      },
    });
    if (idxErr) throw new Error(`Context index insert failed: ${idxErr.message}`);
  } else {
    // Update existing index with depth stats
    await sb.from("ai_tutor_context_index").update({
      stats: {
        lessonCount: lessonCount ?? 0,
        topicCount: topicCount ?? 0,
        subtopicCount: subtopicCount ?? 0,
        depthStatus,
        policyVersion,
      },
      index_version: 2,
    }).eq("package_id", packageId);
  }

  // Optional progress hint (non-critical)
  try { await sb.from("course_packages").update({ build_progress: 80 }).eq("id", packageId); } catch (_) { /* ignore */ }

  return json({ ok: true, policyVersion, lessonCount: lessonCount ?? 0, topicCount: topicCount ?? 0, subtopicCount: subtopicCount ?? 0, depthStatus });
});
