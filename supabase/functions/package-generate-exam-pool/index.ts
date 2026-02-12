import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data, error } = await sb
    .from("course_package_build_steps")
    .select("status")
    .eq("package_id", packageId)
    .eq("step_key", stepKey)
    .maybeSingle();
  if (error) throw error;
  return data?.status === "done";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const examTarget = Number(p.options?.exam_target ?? 1000);

  if (!packageId || !curriculumId) return json({ error: "Missing package_id or curriculum_id" }, 400);

  const failAndUnlock = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "failed", p_log: { error: msg },
    });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    // Prereq: scaffold_learning_course must be done
    if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
    }

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "running",
      p_log: { note: `Generating exam pool target=${examTarget}` },
    });

    const { data: bps, error: bpErr } = await sb
      .from("question_blueprints")
      .select("id, max_variations")
      .eq("curriculum_id", curriculumId)
      .eq("status", "approved");
    if (bpErr) throw bpErr;
    if (!bps?.length) throw new Error("No approved question_blueprints for curriculum");

    const per = Math.max(1, Math.ceil(examTarget / bps.length));
    for (let i = 0; i < bps.length; i++) {
      const bp = bps[i] as { id: string; max_variations: number | null };
      const cap = typeof bp.max_variations === "number" && bp.max_variations > 0 ? bp.max_variations : per;
      const count = Math.min(per, cap);
      const { error } = await sb.functions.invoke("generate-blueprint-questions", {
        body: { blueprintId: bp.id, count, baseSeed: Date.now() + i },
      });
      if (error) throw error;
    }

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "done",
      p_log: { ok: true, target: examTarget, blueprints: bps.length },
    });
    await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
