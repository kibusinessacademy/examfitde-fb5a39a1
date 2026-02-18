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
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("course_id", p?.course_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const courseId = p.course_id as string;

  if (!(await prereqDone(sb, packageId, "generate_handbook"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_handbook" }, 409);
  }

  // Get curriculum_id from course
  const { data: courseData } = await sb.from("courses").select("curriculum_id").eq("id", courseId).single();
  const currId = courseData?.curriculum_id;

  // Get module IDs for this course to count lessons
  const { data: modules } = await sb.from("modules").select("id").eq("course_id", courseId);
  const moduleIds = (modules || []).map((m: any) => m.id);

  // ── FIXED: Count approved vs total questions separately ──
  const [
    { count: totalQuestions },
    { count: approvedQuestions },
    { count: pendingQuestions },
    { count: lessonCount },
  ] = await Promise.all([
    sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", currId ?? courseId),
    sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", currId ?? courseId).eq("qc_status", "approved"),
    sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", currId ?? courseId).eq("qc_status", "pending"),
    moduleIds.length > 0
      ? sb.from("lessons").select("id", { count: "exact", head: true }).in("module_id", moduleIds)
      : Promise.resolve({ count: 0 }),
  ]);

  const approved = approvedQuestions ?? 0;
  const total = totalQuestions ?? 0;
  const lessons = lessonCount ?? 0;

  // Score based on APPROVED questions (the production-ready metric)
  const score =
    approved >= 850 && lessons >= 10 ? 95 :
    approved >= 500 && lessons >= 10 ? 90 :
    approved >= 250 ? 75 : 55;

  const hardFailReasons: string[] = [];
  if (approved < 850) hardFailReasons.push(`TOO_FEW_APPROVED_QUESTIONS (${approved}/850)`);
  if (lessons < 10) hardFailReasons.push(`TOO_FEW_LESSONS (${lessons}/10)`);

  const report = {
    score,
    generated_at: new Date().toISOString(),
    v3: {
      hard_fail_reasons: hardFailReasons,
      stats: {
        questionCount: total,
        approvedQuestionCount: approved,
        pendingQuestionCount: pendingQuestions ?? 0,
        lessonCount: lessons,
        note: "questionCount=total (all statuses), approvedQuestionCount=production-ready",
      },
    },
  };

  console.log(`[integrity-check] pkg=${packageId.slice(0, 8)} approved=${approved} total=${total} lessons=${lessons} score=${score} hardFails=${hardFailReasons.length}`);

  const { error: uErr } = await sb.from("course_packages").update({
    integrity_report: report,
    build_progress: hardFailReasons.length === 0 ? 95 : 80,
  }).eq("id", packageId);

  if (uErr) throw uErr;
  return json({ ok: true, report });
});
