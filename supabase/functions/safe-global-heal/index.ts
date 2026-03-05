import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * STEP_ARTIFACT_GUARDS
 * Maps step_key → artifact existence check.
 * If the check returns count < min, the step is HOLLOW and must be reset.
 * Uses curriculum_id resolved from course_packages.
 */
const EXAM_CHAIN_STEPS = [
  "auto_seed_exam_blueprints",
  "validate_blueprints",
  "generate_exam_pool",
  "validate_exam_pool",
] as const;

interface HealResult {
  package_id: string;
  curriculum_id: string;
  blueprint_count: number;
  question_count: number;
  hollow_reason: string;
  jobs_canceled: number;
  steps_reset: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    // Auth: require service-role or internal secret
    const authHeader = req.headers.get("authorization") ?? "";
    const internalSecret = req.headers.get("x-internal-secret") ?? "";
    const edgeSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";

    // Allow service_role bearer OR internal secret
    const isServiceRole = authHeader.includes(SERVICE_ROLE);
    const isInternal = edgeSecret && internalSecret === edgeSecret;

    if (!isServiceRole && !isInternal) {
      // Also allow authenticated admin via JWT (check user_roles)
      const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false },
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await sb.auth.getUser(
        authHeader.replace("Bearer ", ""),
      );
      if (!user) return json({ ok: false, error: "unauthorized" }, 401);

      const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false },
      });
      const { data: role } = await adminSb
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!role) return json({ ok: false, error: "forbidden" }, 403);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const minQuestions = body?.min_questions ?? 50;

    // ══════════════════════════════════════════════════════
    // 1) Find HOLLOW packages: exam steps marked done but artifacts missing
    // ══════════════════════════════════════════════════════

    // Get all packages with exam-chain steps updated in last 30 days
    const { data: examSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, status")
      .in("step_key", [...EXAM_CHAIN_STEPS])
      .gte("updated_at", new Date(Date.now() - 30 * 86400000).toISOString());

    if (!examSteps?.length) {
      return json({ ok: true, dry_run: dryRun, healed: [], message: "No exam steps found in last 30 days" });
    }

    // Unique package IDs
    const packageIds = [...new Set(examSteps.map((s) => s.package_id))];

    // Resolve curriculum_id for each package
    const { data: packages } = await sb
      .from("course_packages")
      .select("id, curriculum_id, meta, status")
      .in("id", packageIds)
      .in("status", ["building", "done"]); // Only active packages

    if (!packages?.length) {
      return json({ ok: true, dry_run: dryRun, healed: [], message: "No active packages found" });
    }

    const results: HealResult[] = [];

    for (const pkg of packages) {
      if (!pkg.curriculum_id) continue;

      const pkgSteps = examSteps.filter((s) => s.package_id === pkg.id);
      const stepMap = Object.fromEntries(pkgSteps.map((s) => [s.step_key, s.status]));

      // Check artifact counts
      const [bpRes, qRes] = await Promise.all([
        sb.from("question_blueprints")
          .select("id", { count: "exact", head: true })
          .eq("curriculum_id", pkg.curriculum_id),
        sb.from("exam_questions")
          .select("id", { count: "exact", head: true })
          .eq("curriculum_id", pkg.curriculum_id),
      ]);

      const bpCount = bpRes.count ?? 0;
      const qCount = qRes.count ?? 0;

      // Determine if HOLLOW
      let hollowReason = "";

      // Case 1: Blueprint step done but no blueprints
      if (stepMap["auto_seed_exam_blueprints"] === "done" && bpCount === 0) {
        hollowReason = `HOLLOW_BLUEPRINTS: step=done but 0 blueprints`;
      }
      // Case 2: Exam pool step done but too few questions
      else if (stepMap["generate_exam_pool"] === "done" && qCount < minQuestions) {
        hollowReason = `HOLLOW_EXAM_POOL: step=done but only ${qCount} questions (min=${minQuestions})`;
      }
      // Case 3: Validate step stuck on artifact missing (running/queued with no artifacts)
      else if (
        (stepMap["validate_exam_pool"] === "running" || stepMap["validate_exam_pool"] === "queued") &&
        qCount < minQuestions
      ) {
        hollowReason = `BLOCKED_VALIDATE: validate_exam_pool ${stepMap["validate_exam_pool"]} but only ${qCount} questions`;
      }
      // Case 4: Step running without active job (zombie)
      else if (stepMap["generate_exam_pool"] === "running") {
        const { count: activeJobs } = await sb
          .from("job_queue")
          .select("id", { count: "exact", head: true })
          .eq("package_id", pkg.id)
          .in("job_type", ["package_generate_exam_pool"])
          .in("status", ["pending", "processing"]);
        if ((activeJobs ?? 0) === 0) {
          hollowReason = `ZOMBIE_STEP: generate_exam_pool running but no active job`;
        }
      }

      if (!hollowReason) continue;

      // ══════════════════════════════════════════════════════
      // 2) Cancel blocking jobs
      // ══════════════════════════════════════════════════════
      let jobsCanceled = 0;

      if (!dryRun) {
        const { data: canceledJobs } = await sb
          .from("job_queue")
          .update({
            status: "cancelled",
            completed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
            last_error: `SAFE_GLOBAL_HEAL: ${hollowReason}`,
          })
          .eq("package_id", pkg.id)
          .in("status", ["pending", "processing"])
          .in("job_type", [
            "package_validate_exam_pool",
            "package_generate_exam_pool",
            "package_validate_blueprints",
            "package_auto_seed_exam_blueprints",
          ])
          .select("id");

        jobsCanceled = canceledJobs?.length ?? 0;
      }

      // ══════════════════════════════════════════════════════
      // 3) Reset exam chain steps back to queued
      // ══════════════════════════════════════════════════════
      const stepsToReset = [...EXAM_CHAIN_STEPS];

      if (!dryRun) {
        await sb
          .from("package_steps")
          .update({
            status: "queued",
            started_at: null,
            finished_at: null,
            meta: {
              heal_reset_at: new Date().toISOString(),
              heal_reason: hollowReason,
              heal_source: "safe-global-heal",
            },
          })
          .eq("package_id", pkg.id)
          .in("step_key", stepsToReset);
      }

      // ══════════════════════════════════════════════════════
      // 4) Audit trail
      // ══════════════════════════════════════════════════════
      if (!dryRun) {
        await sb.from("auto_heal_log").insert({
          action_type: "safe_global_heal_exam_chain",
          trigger_source: "edge_function",
          target_type: "package",
          target_id: pkg.id,
          result_status: "healed",
          result_detail: hollowReason,
          metadata: {
            curriculum_id: pkg.curriculum_id,
            blueprint_count: bpCount,
            question_count: qCount,
            jobs_canceled: jobsCanceled,
            steps_reset: stepsToReset,
            min_questions: minQuestions,
          },
        });
      }

      results.push({
        package_id: pkg.id,
        curriculum_id: pkg.curriculum_id,
        blueprint_count: bpCount,
        question_count: qCount,
        hollow_reason: hollowReason,
        jobs_canceled: jobsCanceled,
        steps_reset: [...stepsToReset],
      });
    }

    return json({
      ok: true,
      dry_run: dryRun,
      scanned_packages: packages.length,
      healed: results,
      healed_count: results.length,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? "unknown_error";
    console.error("[safe-global-heal] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
