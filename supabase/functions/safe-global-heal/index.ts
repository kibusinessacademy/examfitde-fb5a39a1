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
  jobs_cancelled: number;
  steps_reset: string[];
}

/** Authenticate: internal secret OR JWT with admin role */
async function authenticate(req: Request): Promise<{ ok: boolean; error?: string }> {
  // Path 1: internal edge-to-edge secret
  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  const edgeSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
  if (edgeSecret && internalSecret === edgeSecret) {
    return { ok: true };
  }

  // Path 2: Bearer JWT → validate user + check admin role
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, error: "missing_bearer_token" };
  }

  const jwt = authHeader.replace("Bearer ", "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) {
    return { ok: false, error: "missing_anon_key" };
  }

  // Use anon client with the user's JWT to validate
  const userClient = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: "unauthorized" };
  }

  // Check admin role via service-role client (bypasses RLS)
  const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
  const { data: role } = await adminSb
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (!role) {
    return { ok: false, error: "forbidden" };
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    // ── Auth ──
    const auth = await authenticate(req);
    if (!auth.ok) {
      const status = auth.error === "forbidden" ? 403 : 401;
      return json({ ok: false, error: auth.error }, status);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const minQuestions = body?.min_questions ?? 50;

    // ══════════════════════════════════════════════════════
    // 1) Find HOLLOW packages
    // ══════════════════════════════════════════════════════
    const cutoffIso = new Date(Date.now() - 2000).toISOString(); // 2s race guard

    const { data: examSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, status, meta")
      .in("step_key", [...EXAM_CHAIN_STEPS])
      .gte("updated_at", new Date(Date.now() - 30 * 86400000).toISOString());

    if (!examSteps?.length) {
      return json({ ok: true, dry_run: dryRun, healed: [], message: "No exam steps found in last 30 days" });
    }

    const packageIds = [...new Set(examSteps.map((s) => s.package_id))];

    const { data: packages } = await sb
      .from("course_packages")
      .select("id, curriculum_id, meta, status")
      .in("id", packageIds)
      .in("status", ["building", "quality_gate_failed"]);

    if (!packages?.length) {
      return json({ ok: true, dry_run: dryRun, healed: [], message: "No active packages found" });
    }

    const results: HealResult[] = [];

    for (const pkg of packages) {
      if (!pkg.curriculum_id) continue;

      const pkgSteps = examSteps.filter((s) => s.package_id === pkg.id);
      const stepMap = Object.fromEntries(pkgSteps.map((s) => [s.step_key, s.status]));

      // Check artifact counts using curriculum_id (confirmed FK)
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

      let hollowReason = "";

      if (stepMap["auto_seed_exam_blueprints"] === "done" && bpCount === 0) {
        hollowReason = `HOLLOW_BLUEPRINTS: step=done but 0 blueprints`;
      } else if (stepMap["generate_exam_pool"] === "done" && qCount < minQuestions) {
        hollowReason = `HOLLOW_EXAM_POOL: step=done but only ${qCount} questions (min=${minQuestions})`;
      } else if (
        (stepMap["validate_exam_pool"] === "running" || stepMap["validate_exam_pool"] === "queued") &&
        qCount < minQuestions
      ) {
        hollowReason = `BLOCKED_VALIDATE: validate_exam_pool ${stepMap["validate_exam_pool"]} but only ${qCount} questions`;
      } else if (stepMap["generate_exam_pool"] === "running") {
        // Zombie check – read-only even in dry_run
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
      // 2) Cancel blocking jobs (use "cancelled" – matches system enum)
      // ══════════════════════════════════════════════════════
      let jobsCancelled = 0;

      if (!dryRun) {
        // Only cancel jobs that are NOT actively running with a fresh heartbeat
        const { data: candidateJobs } = await sb
          .from("job_queue")
          .select("id, status, last_heartbeat_at")
          .eq("package_id", pkg.id)
          .in("status", ["pending", "processing"])
          .in("job_type", [
            "package_validate_exam_pool",
            "package_generate_exam_pool",
            "package_validate_blueprints",
            "package_auto_seed_exam_blueprints",
          ]);

        const jobIdsToCancel: string[] = [];
        for (const j of candidateJobs ?? []) {
          // If processing with fresh heartbeat, skip
          if (j.status === "processing" && j.last_heartbeat_at) {
            const hbAge = Date.now() - new Date(j.last_heartbeat_at).getTime();
            if (hbAge < 10 * 60_000) continue;
          }
          jobIdsToCancel.push(j.id);
        }

        if (jobIdsToCancel.length > 0) {
          await sb
            .from("job_queue")
            .update({
              status: "cancelled",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
              last_error: `SAFE_GLOBAL_HEAL: ${hollowReason}`,
            })
            .in("id", jobIdsToCancel);
        }

        jobsCancelled = jobIdsToCancel.length;
      }

      // ══════════════════════════════════════════════════════
      // 3) Reset exam chain steps – merge meta, null job_id/runner_id
      // ══════════════════════════════════════════════════════
      const stepsToReset = [...EXAM_CHAIN_STEPS];

      if (!dryRun) {
        // Load fresh meta per step to avoid stale overwrites
        for (const stepKey of stepsToReset) {
          const { data: freshStep } = await sb
            .from("package_steps")
            .select("meta, status")
            .eq("package_id", pkg.id)
            .eq("step_key", stepKey)
            .lt("updated_at", cutoffIso) // Race guard: skip if updated in last 2s
            .maybeSingle();

          if (!freshStep) {
            // Step was just touched by runner — skip to avoid race
            continue;
          }

          const existingMeta = (freshStep?.meta && typeof freshStep.meta === "object")
            ? freshStep.meta as Record<string, unknown>
            : {};

          await sb
            .from("package_steps")
            .update({
              status: "queued",
              started_at: null,
              finished_at: null,
              updated_at: new Date().toISOString(),
              job_id: null,
              runner_id: null,
              last_error: `SAFE_GLOBAL_HEAL: ${hollowReason}`,
              meta: {
                ...existingMeta,
                heal_reset_at: new Date().toISOString(),
                heal_reason: hollowReason,
                heal_source: "safe-global-heal",
              },
            })
            .eq("package_id", pkg.id)
            .eq("step_key", stepKey)
            .lt("updated_at", cutoffIso); // Race guard
        }
      }

      // ══════════════════════════════════════════════════════
      // 4) Audit trail (also for dry_run as "scan")
      // ══════════════════════════════════════════════════════
      await sb.from("auto_heal_log").insert({
        action_type: "safe_global_heal_exam_chain",
        trigger_source: "edge_function",
        target_type: "package",
        target_id: pkg.id,
        result_status: dryRun ? "scan" : "healed",
        result_detail: `${dryRun ? "DRY_RUN: " : ""}${hollowReason}`,
        metadata: {
          curriculum_id: pkg.curriculum_id,
          blueprint_count: bpCount,
          question_count: qCount,
          jobs_cancelled: jobsCancelled,
          steps_reset: stepsToReset,
          min_questions: minQuestions,
          dry_run: dryRun,
        },
      });

      results.push({
        package_id: pkg.id,
        curriculum_id: pkg.curriculum_id,
        blueprint_count: bpCount,
        question_count: qCount,
        hollow_reason: hollowReason,
        jobs_cancelled: jobsCancelled,
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
