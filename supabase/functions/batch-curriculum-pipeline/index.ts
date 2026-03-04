import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

/**
 * Batch Curriculum Pipeline – DB Setup Only (no AI calls)
 *
 * For each draft curriculum:
 * 1. Enqueue `generate_curriculum_content` job (AI generates LFs + comps, freezes)
 * 2. Enqueue `setup_course_package` job (creates course + package + plan)
 *
 * The job-runner cron picks these up and processes them sequentially.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { action, limit: rawLimit } = await req.json().catch(() => ({ action: "run", limit: 5 }));
  const limit = Math.min(Math.max(rawLimit || 5, 1), 50);

  if (action === "status") {
    const [draftRes, frozenRes, pkgRes, buildRes, queuedJobs] = await Promise.all([
      sb.from("curricula").select("id", { count: "exact", head: true }).eq("status", "draft"),
      sb.from("curricula").select("id", { count: "exact", head: true }).eq("status", "frozen"),
      sb.from("course_packages").select("id", { count: "exact", head: true }),
      sb.from("course_packages").select("id", { count: "exact", head: true }).eq("status", "building"),
      sb.from("job_queue").select("id", { count: "exact", head: true })
        .in("job_type", ["generate_curriculum_content", "setup_course_package"])
        .in("status", ["pending", "processing"]),
    ]);
    return json({
      draft_curricula: draftRes.count || 0,
      frozen_curricula: frozenRes.count || 0,
      packages_total: pkgRes.count || 0,
      packages_building: buildRes.count || 0,
      pipeline_jobs_pending: queuedJobs.count || 0,
    });
  }

  // ── Main: Enqueue jobs for N draft curricula ────────────────────

  // Find draft curricula not yet in the job queue
  // Load full payload to extract curriculum_id (arrow select returns wrong key)
  const { data: pendingJobRows } = await sb
    .from("job_queue")
    .select("payload")
    .eq("job_type", "generate_curriculum_content")
    .in("status", ["pending", "processing"]);

  const alreadyQueued = new Set(
    (pendingJobRows || [])
      .map((j: any) => j?.payload?.curriculum_id)
      .filter(Boolean)
  );

  const { data: draftCurricula, error: fetchErr } = await sb
    .from("curricula")
    .select("id, title, beruf_id")
    .eq("status", "draft")
    .order("updated_at", { ascending: true })
    .limit(limit + alreadyQueued.size); // fetch extra to skip already-queued

  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!draftCurricula?.length) return json({ message: "No draft curricula remaining", enqueued: 0 });

  // Filter out already-queued
  const toProcess = draftCurricula
    .filter((c) => !alreadyQueued.has(c.id))
    .slice(0, limit);

  if (toProcess.length === 0) {
    return json({ message: "All draft curricula already queued", enqueued: 0 });
  }

   // Enqueue generate_curriculum_content jobs – split 50/50 between OpenAI & Google
  const jobs = toProcess.map((c, idx) => ({
    job_type: "generate_curriculum_content",
    status: "pending",
    attempts: 0,
    max_attempts: 3,
    priority: 5,
    run_after: new Date(Date.now() + idx * 2000).toISOString(), // 2s stagger
    payload: {
      curriculum_id: c.id,
      beruf_id: c.beruf_id,
      provider: idx % 2 === 0 ? "openai" : "google", // alternate GPT / Gemini
    },
  }));

  const { error: insErr } = await sb.from("job_queue").insert(jobs);
  if (insErr) return json({ error: insErr.message }, 500);

  // Also enqueue setup_course_package for each (runs after content is generated)
  const setupJobs = toProcess.map((c, idx) => ({
    job_type: "setup_course_package",
    status: "pending",
    attempts: 0,
    max_attempts: 5,
    priority: 6, // slightly lower priority (runs after content gen)
    run_after: new Date(Date.now() + (idx + toProcess.length) * 3000).toISOString(),
    payload: {
      curriculum_id: c.id,
      beruf_id: c.beruf_id,
    },
  }));

  await sb.from("job_queue").insert(setupJobs);

  console.log(`[BatchPipeline] Enqueued ${toProcess.length} curricula (${toProcess.length * 2} jobs total)`);

  return json({
    enqueued: toProcess.length,
    jobs_created: toProcess.length * 2,
    curricula: toProcess.map((c) => ({ id: c.id, title: c.title })),
  });
});
