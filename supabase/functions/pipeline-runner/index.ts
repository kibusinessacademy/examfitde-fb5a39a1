import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * pipeline-runner — Cron-triggered (every 60s)
 *
 * 1. Check capacity (MAX_CONCURRENT_PACKAGES)
 * 2. acquire_next_package_lease() → one package
 * 3. Preflight checks for the next step
 * 4. Execute the step's edge function with heartbeat + lease renewal
 * 5. Mark step done/fail, release lease, exit
 *
 * Designed for short-lived invocations (max 1 step per run).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_CONCURRENT_PACKAGES = 3;

// ── Step ordering + mapping to actual edge functions ──
type StepKey =
  | "scaffold_learning_course"
  | "auto_seed_exam_blueprints"
  | "generate_exam_pool"
  | "generate_oral_exam"
  | "build_ai_tutor_index"
  | "generate_handbook"
  | "run_integrity_check"
  | "quality_council"
  | "auto_publish";

const STEP_ORDER: StepKey[] = [
  "scaffold_learning_course",
  "auto_seed_exam_blueprints",
  "generate_exam_pool",
  "generate_oral_exam",
  "build_ai_tutor_index",
  "generate_handbook",
  "run_integrity_check",
  "quality_council",
  "auto_publish",
];

const STEP_FUNCTION_MAP: Record<StepKey, string> = {
  scaffold_learning_course: "package-scaffold-learning-course",
  auto_seed_exam_blueprints: "package-auto-seed-exam-blueprints",
  generate_exam_pool: "package-generate-exam-pool",
  generate_oral_exam: "package-generate-oral-exam",
  build_ai_tutor_index: "package-build-ai-tutor-index",
  generate_handbook: "package-generate-handbook",
  run_integrity_check: "package-run-integrity-check",
  quality_council: "package-quality-council",
  auto_publish: "package-auto-publish",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeRpc(
  sb: ReturnType<typeof createClient>,
  fn: string,
  params: Record<string, unknown>,
) {
  try {
    const result = await sb.rpc(fn, params);
    return result;
  } catch (_) {
    return { data: null, error: _ };
  }
}

async function safeQuery(promise: PromiseLike<unknown>) {
  try {
    return await promise;
  } catch (_) {
    return null;
  }
}

interface StepRow {
  step_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  timeout_seconds?: number;
  started_at?: string;
}

/**
 * Run step function with heartbeat + lease renewal in background.
 */
async function runStepWithHeartbeat(opts: {
  sb: ReturnType<typeof createClient>;
  supabaseUrl: string;
  serviceRoleKey: string;
  packageId: string;
  stepKey: string;
  runnerId: string;
  functionName: string;
  body: Record<string, unknown>;
}) {
  const {
    sb,
    supabaseUrl,
    serviceRoleKey,
    packageId,
    stepKey,
    runnerId,
    functionName,
    body,
  } = opts;

  let stopped = false;

  // Background heartbeat loop (every 30s)
  const heartbeatLoop = (async () => {
    while (!stopped) {
      try {
        await sb.rpc("step_heartbeat", {
          p_package_id: packageId,
          p_step_key: stepKey,
          p_runner_id: runnerId,
        });
      } catch (_) {
        /* ignore */
      }
      await sleep(30_000);
    }
  })();

  // Background lease renewal (every 90s, lease = 600s)
  const renewLoop = (async () => {
    while (!stopped) {
      try {
        await sb.rpc("renew_package_lease", {
          p_package_id: packageId,
          p_runner_id: runnerId,
          p_lease_seconds: 600,
        });
      } catch (_) {
        /* ignore */
      }
      await sleep(90_000);
    }
  })();

  // Actually call the step function
  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(body),
  });

  stopped = true;
  await Promise.allSettled([heartbeatLoop, renewLoop]);

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `${functionName} HTTP ${res.status}: ${text.slice(0, 800)}`,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

/**
 * Find the next step to run for this package (FIFO by STEP_ORDER).
 */
function pickNextRunnableStep(
  steps: StepRow[],
): {
  stepKey: StepKey;
  reason: "runnable" | "exhausted" | "already_running" | "timed_out";
} | null {
  const byKey = new Map<string, StepRow>();
  for (const s of steps) byKey.set(s.step_key, s);

  for (const k of STEP_ORDER) {
    const s = byKey.get(k);
    if (!s) continue;

    if (s.status === "done" || s.status === "skipped") continue;
    if (s.status === "blocked") continue;

    // Check for timeout on running steps
    if (s.status === "running") {
      const timeout = s.timeout_seconds || 600;
      if (s.started_at) {
        const elapsed =
          (Date.now() - new Date(s.started_at).getTime()) / 1000;
        if (elapsed > timeout) {
          return { stepKey: k, reason: "timed_out" };
        }
      }
      return { stepKey: k, reason: "already_running" };
    }

    const retryable =
      s.status === "queued" || s.status === "failed" || s.status === "timeout";
    if (retryable && s.attempts < s.max_attempts)
      return { stepKey: k, reason: "runnable" };
    if (retryable && s.attempts >= s.max_attempts)
      return { stepKey: k, reason: "exhausted" };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const runnerId = `runner_${crypto.randomUUID().slice(0, 8)}`;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // ── 0) Capacity check ──
    const { count: activeLeases } = await sb
      .from("package_leases")
      .select("package_id", { count: "exact", head: true });

    if ((activeLeases ?? 0) >= MAX_CONCURRENT_PACKAGES) {
      return json({
        ok: true,
        idle: true,
        reason: "capacity_reached",
        active: activeLeases,
        max: MAX_CONCURRENT_PACKAGES,
      });
    }

    // ── 1) Acquire lease ──
    const { data: pkgId, error: acquireErr } = await sb.rpc(
      "acquire_next_package_lease",
      { p_runner_id: runnerId, p_lease_seconds: 600 },
    );

    if (acquireErr) {
      console.error("[runner] acquire error:", acquireErr.message);
      return json({ ok: false, error: acquireErr.message }, 500);
    }

    if (!pkgId) {
      return json({
        ok: true,
        idle: true,
        reason: "no_queued_packages_or_lease_active",
      });
    }

    const packageId = String(pkgId);
    console.log(
      `[runner] Acquired lease for package ${packageId.slice(0, 8)}`,
    );

    // ── 2) Load package metadata ──
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select(
        "id,pipeline_mode,course_id,curriculum_id,certification_id,feature_flags",
      )
      .eq("id", packageId)
      .single();

    if (pkgErr || !pkg) {
      await safeRpc(sb, "release_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
      });
      return json(
        { ok: false, error: pkgErr?.message ?? "package not found" },
        500,
      );
    }

    // ── Auto-resolve missing curriculum_id from course ──
    if (!pkg.curriculum_id && pkg.course_id) {
      const { data: course } = await sb
        .from("courses")
        .select("curriculum_id")
        .eq("id", pkg.course_id)
        .single();

      if (course?.curriculum_id) {
        await safeQuery(
          sb
            .from("course_packages")
            .update({ curriculum_id: course.curriculum_id })
            .eq("id", packageId),
        );
        pkg.curriculum_id = course.curriculum_id;
        console.log(
          `[runner] Auto-resolved curriculum_id for package ${packageId.slice(0, 8)}`,
        );
      }
    }

    // ── Block if still missing required IDs ──
    if (!pkg.curriculum_id || !pkg.course_id) {
      await safeQuery(
        sb
          .from("course_packages")
          .update({
            status: "blocked",
            blocked_reason: "missing_curriculum_or_course_id",
          })
          .eq("id", packageId),
      );
      await safeRpc(sb, "release_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
      });
      console.warn(
        `[runner] Package ${packageId.slice(0, 8)} blocked: missing curriculum_id or course_id`,
      );
      return json({
        ok: true,
        packageId,
        blocked: true,
        reason: "missing_curriculum_or_course_id",
      });
    }

    const mode = (pkg.pipeline_mode ?? "factory") as "factory" | "production";

    // ── 3) Load steps & pick next ──
    const { data: steps, error: stepsErr } = await sb
      .from("package_steps")
      .select("step_key,status,attempts,max_attempts,timeout_seconds,started_at")
      .eq("package_id", packageId);

    if (stepsErr) {
      await safeRpc(sb, "release_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
      });
      return json({ ok: false, error: stepsErr.message }, 500);
    }

    const next = pickNextRunnableStep((steps ?? []) as StepRow[]);

    if (!next) {
      const statuses = (steps ?? []).map((s: StepRow) => s.status);
      const allDone =
        statuses.length > 0 &&
        statuses.every((s: string) => s === "done" || s === "skipped");

      if (allDone) {
        await safeQuery(
          sb
            .from("course_packages")
            .update({ status: "done" })
            .eq("id", packageId),
        );
        console.log(
          `[runner] Package ${packageId.slice(0, 8)} → done (all steps complete)`,
        );
      } else {
        await safeQuery(
          sb
            .from("course_packages")
            .update({
              status: "blocked",
              blocked_reason: "no_runnable_steps",
            })
            .eq("id", packageId),
        );
      }

      await safeRpc(sb, "release_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
      });
      return json({
        ok: true,
        packageId,
        finished: allDone,
        blocked: !allDone,
      });
    }

    // ── Exhausted retries → fail-forward ──
    if (next.reason === "exhausted") {
      await safeQuery(
        sb
          .from("course_packages")
          .update({
            status: "failed",
            last_error: `Attempts exhausted on step ${next.stepKey}`,
          })
          .eq("id", packageId),
      );

      await safeQuery(
        sb.from("ops_alerts").insert({
          source: "pipeline-runner",
          severity: "error",
          message: `STEP_EXHAUSTED: ${next.stepKey} pkg ${packageId.slice(0, 8)}`,
          payload: { packageId, stepKey: next.stepKey },
        }),
      );

      await safeRpc(sb, "release_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
      });
      return json({
        ok: true,
        packageId,
        stepKey: next.stepKey,
        exhausted: true,
      });
    }

    // ── Already running ──
    if (next.reason === "already_running") {
      console.warn(
        `[runner] Step ${next.stepKey} already running for ${packageId.slice(0, 8)} — skipping`,
      );
      await safeRpc(sb, "release_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
      });
      return json({
        ok: true,
        packageId,
        stepKey: next.stepKey,
        skipped: "already_running",
      });
    }

    // ── Timed out → reset to failed for retry ──
    if (next.reason === "timed_out") {
      console.warn(
        `[runner] Step ${next.stepKey} timed out for ${packageId.slice(0, 8)} — marking timeout`,
      );
      await safeRpc(sb, "step_fail", {
        p_package_id: packageId,
        p_step_key: next.stepKey,
        p_error: "STEP_TIMEOUT",
      });
      await safeQuery(
        sb
          .from("course_packages")
          .update({
            status: "building",
            last_error: `Step ${next.stepKey}: TIMEOUT`,
          })
          .eq("id", packageId),
      );
      await safeRpc(sb, "release_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
      });
      return json({
        ok: true,
        packageId,
        stepKey: next.stepKey,
        timeout_reset: true,
      });
    }

    const stepKey = next.stepKey;
    const functionName = STEP_FUNCTION_MAP[stepKey];
    console.log(`[runner] Starting step ${stepKey} → ${functionName}`);

    // ── 4) step_start ──
    await sb.rpc("step_start", {
      p_package_id: packageId,
      p_step_key: stepKey,
      p_runner_id: runnerId,
    });

    // ── 5) Execute with heartbeat ──
    try {
      const result = await runStepWithHeartbeat({
        sb,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SERVICE_ROLE_KEY,
        packageId,
        stepKey,
        runnerId,
        functionName,
        body: {
          payload: {
            package_id: packageId,
            course_id: pkg.course_id,
            curriculum_id: pkg.curriculum_id,
            certification_id: pkg.certification_id,
            mode,
            feature_flags: pkg.feature_flags ?? {},
          },
        },
      });

      // QA: factory = non-blocking, production = blocking
      if (stepKey === "quality_council" && mode === "factory") {
        await sb.rpc("step_done", {
          p_package_id: packageId,
          p_step_key: stepKey,
          p_meta: {
            mode,
            score: result?.score,
            warnings: result?.warnings ?? [],
          },
        });
      } else {
        await sb.rpc("step_done", {
          p_package_id: packageId,
          p_step_key: stepKey,
          p_meta: result ?? {},
        });
      }

      // Update build_progress
      const doneCount =
        (steps ?? []).filter(
          (s: StepRow) => s.status === "done" || s.status === "skipped",
        ).length + 1;
      const totalSteps = STEP_ORDER.length;
      const progress = Math.round((doneCount / totalSteps) * 100);
      await safeQuery(
        sb
          .from("course_packages")
          .update({ build_progress: progress })
          .eq("id", packageId),
      );

      // If last step done → package done
      if (stepKey === "auto_publish") {
        await safeQuery(
          sb
            .from("course_packages")
            .update({ status: "done" })
            .eq("id", packageId),
        );
      }

      await safeRpc(sb, "release_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
      });

      console.log(
        `[runner] ✅ Step ${stepKey} done for ${packageId.slice(0, 8)} (progress ${progress}%)`,
      );
      return json({ ok: true, packageId, stepKey, mode, progress });
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      console.error(`[runner] ❌ Step ${stepKey} failed: ${msg}`);

      await safeRpc(sb, "step_fail", {
        p_package_id: packageId,
        p_step_key: stepKey,
        p_error: msg,
      });

      // IMPORTANT: do NOT hard-fail the whole package here.
      // Keep it "building" so the runner can retry until max_attempts is exhausted
      await safeQuery(
        sb
          .from("course_packages")
          .update({
            status: "building",
            last_error: `Step ${stepKey}: ${msg.slice(0, 250)}`,
          })
          .eq("id", packageId),
      );

      await safeQuery(
        sb.from("ops_alerts").insert({
          source: "pipeline-runner",
          severity: "error",
          message: `STEP_FAILED: ${stepKey} pkg ${packageId.slice(0, 8)}`,
          payload: { packageId, stepKey, error: msg.slice(0, 1200) },
        }),
      );

      await safeRpc(sb, "release_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
      });
      return json({ ok: false, packageId, stepKey, error: msg }, 500);
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[runner] Fatal:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
