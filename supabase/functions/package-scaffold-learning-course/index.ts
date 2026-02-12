import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;

  if (!packageId || !courseId || !curriculumId) {
    return json({ error: "Missing package_id, course_id, or curriculum_id" }, 400);
  }

  const failAndUnlock = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "scaffold_learning_course", p_status: "failed", p_log: { error: msg },
    });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    // Step 1 has no prereq
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "scaffold_learning_course", p_status: "running",
      p_log: { note: "Invoking generate-course" },
    });

    const { data, error } = await sb.functions.invoke("generate-course", {
      body: { courseId, curriculumId },
    });
    if (error) throw error;
    if ((data as Record<string, unknown>)?.code === "GENERATION_LOCKED") throw new Error("GENERATION_LOCKED");

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "scaffold_learning_course", p_status: "done", p_log: { ok: true },
    });
    await sb.from("course_packages").update({ build_progress: 25 }).eq("id", packageId);

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
