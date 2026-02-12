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
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id;
  const courseId = p.course_id;
  const options = p.options || {};

  const unlockFail = async (msg: string, report?: unknown) => {
    await sb.from("course_packages").update({
      status: "failed",
      integrity_passed: false,
      integrity_report: report || { error: msg },
    }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "failed",
      p_log: { error: msg, report },
    });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    // Prereq: handbook must be done
    if (!(await prereqDone(sb, packageId, "generate_handbook"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_handbook" }, 409);
    }

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "running",
      p_log: { note: "Running validate_course_integrity_v2" },
    });

    // Call the enhanced integrity check
    const { data, error } = await sb.rpc("validate_course_integrity_v2", {
      p_course_id: courseId,
      p_package_id: packageId,
      p_options: {
        exam_target: options.exam_target || 1000,
        oral_target: options.oral_target || 20,
        handbook_chapter_target: options.handbook_chapter_target || 5,
      },
    });

    if (error) throw error;

    const report = data as Record<string, unknown>;
    const passed = Boolean(report?.passed);
    const score = Number(report?.score ?? 0);

    // Build human-readable summary for the step log
    const summary = {
      score,
      passed,
      lessons: `${(report?.lessons as any)?.actual || 0}/${(report?.lessons as any)?.expected || 0}`,
      exam_questions: `${(report?.exam as any)?.total || 0}/${(report?.exam as any)?.target || 1000}`,
      oral_scenarios: `${(report?.oral as any)?.total || 0}/${(report?.oral as any)?.target || 20}`,
      handbook_chapters: `${(report?.handbook as any)?.chapters || 0}/${(report?.handbook as any)?.target || 5}`,
      tutor_index: Boolean(report?.tutor_index),
      issues: ((report?.issues as any[]) || []).length,
      warnings: ((report?.warnings as any[]) || []).length,
    };

    if (!passed) {
      await unlockFail(`Integrity Score ${score}/100 – ${summary.issues} critical issues`, report);
      return json({ ok: false, error: `Integrity check failed (score: ${score})`, report }, 422);
    }

    // Passed!
    await sb.from("course_packages").update({
      integrity_passed: true,
      status: "qa",
      build_progress: 95,
    }).eq("id", packageId);

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "done",
      p_log: { ok: true, ...summary },
    });

    return json({ ok: true, score, summary });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await unlockFail(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
