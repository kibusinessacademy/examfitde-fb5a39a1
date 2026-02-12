import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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
  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id;

  if (!packageId || !curriculumId || !certificationId) return json({ error: "Missing required fields" }, 400);

  const failAndUnlock = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "build_ai_tutor_index", p_status: "failed", p_log: { error: msg } });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!(await prereqDone(sb, packageId, "generate_oral_exam"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_oral_exam" }, 409);
    }

    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "build_ai_tutor_index", p_status: "running", p_log: { note: "Create policy + index stats" } });

    // 1) Policy versioning
    const { data: existing, error: exErr } = await sb
      .from("ai_tutor_policies").select("id, version")
      .eq("curriculum_id", curriculumId)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    if (exErr) throw exErr;

    const nextVersion = existing?.version ? existing.version + 1 : 1;
    const policy = {
      allowed_sources: ["curriculum_topics", "lessons", "question_blueprints", "exam_sessions"],
      forbid_invention: true,
      require_reference: true,
      modes: ["explainer", "coach", "examiner", "feedback"],
    };

    await sb.from("ai_tutor_policies").insert({ curriculum_id: curriculumId, policy, version: nextVersion });

    // 2) Coverage stats
    const { count: lessonCount } = await sb.from("lessons").select("id", { count: "exact", head: true }).eq("course_id", courseId || "");
    const { count: topicCount } = await sb.from("curriculum_topics").select("id", { count: "exact", head: true }).eq("certification_id", certificationId);

    await sb.from("ai_tutor_context_index").insert({
      package_id: packageId,
      index_version: 1,
      stats: { lessonCount: lessonCount ?? 0, topicCount: topicCount ?? 0, policyVersion: nextVersion },
    });

    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "build_ai_tutor_index", p_status: "done", p_log: { ok: true, policyVersion: nextVersion } });
    await sb.from("course_packages").update({ build_progress: 80 }).eq("id", packageId);

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
