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

  if (!packageId || !courseId) return json({ error: "Missing required fields" }, 400);

  const failAndUnlock = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "failed", p_log: { error: msg } });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!(await prereqDone(sb, packageId, "generate_handbook"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_handbook" }, 409);
    }

    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "running", p_log: { note: "validate_course_integrity()" } });

    const { data, error } = await sb.rpc("validate_course_integrity", { p_course_id: courseId });
    if (error) throw error;
    const ok = Boolean((data as Record<string, unknown>)?.passed ?? (data as Record<string, unknown>)?.ok ?? false);
    if (!ok) throw new Error("Integrity check failed");

    await sb.rpc("update_course_package_step", { p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "done", p_log: { ok: true } });
    await sb.from("course_packages").update({ integrity_passed: true, status: "qa", build_progress: 95 }).eq("id", packageId);

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
