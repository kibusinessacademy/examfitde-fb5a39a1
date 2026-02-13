import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { packageId, courseId, curriculumId, certificationId, options } =
    await req.json().catch(() => ({}));

  try {
    assertUuid("package_id", packageId);
    assertUuid("course_id", courseId);
    assertUuid("curriculum_id", curriculumId);
    assertUuid("certification_id", certificationId);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  // 0) Active-packages guard: max N packages building simultaneously
  const { data: budgetRow } = await sb
    .from("llm_budget")
    .select("max_active_packages")
    .limit(1)
    .maybeSingle();
  const maxActive = budgetRow?.max_active_packages ?? 4;

  const { count: buildingCount } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "building")
    .neq("id", packageId);

  if ((buildingCount ?? 0) >= maxActive) {
    return json(
      { code: "SEQUENTIAL_QUEUE", error: `Bereits ${buildingCount} Pakete aktiv (max ${maxActive}). Dieses Paket wird automatisch gestartet, sobald ein Slot frei wird.` },
      409
    );
  }

  // 1) Acquire package lock (prevents double enqueue)
  const lockRes = await sb
    .from("course_package_locks")
    .insert({ package_id: packageId })
    .select("package_id")
    .maybeSingle();

  if (lockRes.error) {
    return json(
      { code: "PACKAGE_LOCKED", error: "Build already running/enqueued for this package." },
      409
    );
  }

  // 2) Ensure approved plan exists (Council gate)
  const { data: planRow, error: planErr } = await sb
    .from("course_package_plans")
    .select("id")
    .eq("package_id", packageId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planErr || !planRow) {
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
    return json(
      { error: "No approved course_package_plan found (Council approval required)." },
      400
    );
  }

  const opts = {
    include_learning_course: true,
    include_exam_pool: true,
    include_oral_exam: true,
    include_ai_tutor: true,
    include_handbook: true,
    exam_target: 850, // Ship-Level: marktfähig, iterativ auf 1000
    ...(options || {}),
  };

  // 3) Define pipeline steps → job_types
  const steps: Array<{ step_key: string; job_type: string }> = [];

  if (opts.include_learning_course)
    steps.push({ step_key: "scaffold_learning_course", job_type: "package_scaffold_learning_course" });
  if (opts.include_exam_pool)
    steps.push({ step_key: "generate_exam_pool", job_type: "package_generate_exam_pool" });
  if (opts.include_oral_exam)
    steps.push({ step_key: "generate_oral_exam", job_type: "package_generate_oral_exam" });
  if (opts.include_ai_tutor)
    steps.push({ step_key: "build_ai_tutor_index", job_type: "package_build_ai_tutor_index" });
  if (opts.include_handbook)
    steps.push({ step_key: "generate_handbook", job_type: "package_generate_handbook" });

  // Always run integrity + publish
  steps.push({ step_key: "run_integrity_check", job_type: "package_run_integrity_check" });
  steps.push({ step_key: "auto_publish", job_type: "package_auto_publish" });

  // 4) Init build steps in DB (UI sees queued steps immediately)
  await sb.rpc("init_course_package_steps", {
    p_package_id: packageId,
    p_steps: steps.map((s) => s.step_key),
  });

  // 5) Enqueue jobs into job_queue (Runner/pg_cron picks them up)
  // Alternate provider between openai (GPT-5.2) and anthropic (Claude Opus) for parallel throughput
  const nowIso = new Date().toISOString();
  const jobs = steps.map((s, idx) => ({
    job_type: s.job_type,
    status: "pending",
    attempts: 0,
    max_attempts: 25, // Mass Production: 429/Timeout nie als Final-Fail
    run_after: nowIso,
    payload: {
      job_version: "course_studio_v2",
      package_id: packageId,
      step_key: s.step_key,
      course_id: courseId,
      curriculum_id: curriculumId,
      certification_id: certificationId,
      provider: idx % 2 === 0 ? "openai" : "anthropic",
      options: opts,
      sequence: idx + 1,
    },
  }));

  const ins = await sb.from("job_queue").insert(jobs).select("id");
  if (ins.error) {
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
    return json({ error: ins.error.message }, 500);
  }

  // 6) Mark package as building
  await sb
    .from("course_packages")
    .update({ status: "building", build_progress: 1 })
    .eq("id", packageId);

  return json({ ok: true, enqueued: ins.data?.length || jobs.length, packageId });
});
