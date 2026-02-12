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
  const curriculumId = p.curriculum_id;

  if (!packageId || !curriculumId) return json({ error: "Missing required fields" }, 400);

  const failAndUnlock = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "generate_oral_exam", p_status: "failed", p_log: { error: msg } });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!(await prereqDone(sb, packageId, "generate_exam_pool"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_exam_pool" }, 409);
    }

    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "generate_oral_exam", p_status: "running", p_log: { note: "Creating oral_exam_sessionset" } });

    const { data: oralBps, error: obErr } = await sb
      .from("oral_exam_blueprints").select("id")
      .eq("curriculum_id", curriculumId).eq("status", "approved").limit(30);
    if (obErr) throw obErr;

    const blueprint_ids = (oralBps || []).map((x: { id: string }) => x.id);

    await sb.from("oral_exam_sessionsets").insert({
      package_id: packageId,
      title: "Oral Exam Set (auto)",
      blueprint_ids,
    });

    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "generate_oral_exam", p_status: "done", p_log: { ok: true, count: blueprint_ids.length } });
    await sb.from("course_packages").update({ build_progress: 70 }).eq("id", packageId);

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
