import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;

  if (!packageId || !courseId || !curriculumId) {
    return json({ error: "Missing package_id, course_id, or curriculum_id" }, 400);
  }

  // pipeline-runner handles step_start/step_done/step_fail.
  // Do NOT touch pipeline_lock / course_package_locks / update_course_package_step.

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fnUrl = `${supabaseUrl}/functions/v1/generate-course`;

    const resp = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-job-runner-key": serviceRoleKey,
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")!}`,
      },
      body: JSON.stringify({ courseId, curriculumId }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok && (data as Record<string, unknown>)?.code !== "GENERATION_LOCKED") {
      throw new Error(data?.error || `generate-course returned ${resp.status}`);
    }
    if ((data as Record<string, unknown>)?.code === "GENERATION_LOCKED") {
      // Idempotency: if already generating, treat as success (another run is handling it)
      console.log(`[scaffold] Course ${courseId} already locked — treating as idempotent success`);
      return json({ ok: true, skipped: true, reason: "GENERATION_LOCKED" });
    }

    return json({ ok: true, result: data ?? null });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    // Idempotency: if unique constraint violation, the scaffold already ran
    if (msg.includes("23505") || msg.includes("duplicate") || msg.includes("already exists")) {
      console.log(`[scaffold] Idempotent hit: ${msg}`);
      return json({ ok: true, skipped: true, reason: "already_exists" });
    }
    console.error(`[scaffold] Error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
