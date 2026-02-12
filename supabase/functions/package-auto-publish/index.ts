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

  const unlockFail = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "auto_publish", p_status: "failed", p_log: { error: msg },
    });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!(await prereqDone(sb, packageId, "run_integrity_check"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: run_integrity_check" }, 409);
    }

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "auto_publish", p_status: "running",
      p_log: { note: "Mark course publish_ready + package published" },
    });

    const { error: cErr } = await sb
      .from("courses").update({ publishing_status: "publish_ready", status: "ready" }).eq("id", courseId);
    if (cErr) throw cErr;

    const { error: pErr } = await sb
      .from("course_packages").update({ status: "published", build_progress: 100, council_approved: true }).eq("id", packageId);
    if (pErr) throw pErr;

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "auto_publish", p_status: "done", p_log: { ok: true },
    });

    // ✅ unlock package
    await sb.from("course_package_locks").delete().eq("package_id", packageId);

    // ✅ Trigger next queued package (sequential pipeline)
    await sb.from("job_queue").insert({
      job_type: "package_queue_next",
      status: "pending",
      attempts: 0,
      max_attempts: 1,
      run_after: new Date(Date.now() + 5_000).toISOString(), // 5s delay
      payload: { completed_package_id: packageId },
    });

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await unlockFail(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
