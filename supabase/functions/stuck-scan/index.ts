import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { STEP_TO_JOB_TYPE, inferBackoffSeconds } from "../_shared/job-map.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// inferBackoffSeconds imported from _shared/job-map.ts

async function safeRpc(
  sb: ReturnType<typeof createClient>,
  fn: string,
  params: Record<string, unknown>,
) {
  try {
    const result = await sb.rpc(fn, params);
    if (result.error) {
      console.warn(`[stuck-scan] RPC ${fn} returned error:`, result.error.message);
    }
    return result;
  } catch (e) {
    console.error(`[stuck-scan] RPC ${fn} threw:`, (e as Error).message);
    return { data: null, error: e };
  }
}

/**
 * stuck-scan v4 – Hardened production watchdog
 *
 * Changes from v3:
 * - Stale job requeue uses run_after (not scheduled_at) for correct claim delay
 * - Query filters by min cutoff server-side to reduce data transfer
 * - Zombie detection expanded to running/enqueued/queued with step-scoped cleanup
 * - Escalation breaker adds age guard + failure signature check
 * - System freeze detector alerts when no jobs complete for >2h
 * - Chunked batch updates to avoid edge function timeouts
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── Health endpoint ──
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    await safeRpc(sb, "upsert_worker_heartbeat", {
      p_worker_name: "stuck-scan",
      p_instance_id: "stuck-scan-singleton",
      p_version: "v4-hardened",
      p_processed_count: 0,
      p_metadata: { type: "health_check" },
    });
    return json({ ok: true, health: true, version: "v4-hardened" });
  }

  try {
    // Load policy for timeouts
    const { data: policyRow } = await sb
      .from("triage_policy")
      .select("policy_json")
      .eq("is_active", true)
      .maybeSingle();

    const policy = policyRow?.policy_json as Record<string, unknown> | null;
    const stuckConfig = (policy as any)?.production_specific?.stuck_detection ?? {};
    const heartbeatTimeout = stuckConfig.job_processing_heartbeat_timeout_seconds ?? 600;
    const packageTimeout = stuckConfig.package_no_progress_timeout_minutes ?? 90;

    // Job-type-specific stale thresholds (seconds)
    const JOB_TYPE_STALE_OVERRIDES: Record<string, number> = {
      package_generate_exam_pool: 240,
      package_generate_lessons: 300,
      package_generate_flashcards: 300,
      package_elite_harden: 240,
    };

    // ══════════════════════════════════════════════════════
    // 1) Clean stale processing jobs (no heartbeat)
    //    Filter server-side by minimum threshold to reduce data transfer
    // ══════════════════════════════════════════════════════
    const now = Date.now();
    const minThreshold = Math.min(
      heartbeatTimeout,
      ...Object.values(JOB_TYPE_STALE_OVERRIDES).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0),
    );
    const minCutoffIso = new Date(now - minThreshold * 1000).toISOString();

    const { data: processingJobs } = await sb
      .from("job_queue")
      .select("id, attempts, max_attempts, job_type, locked_at")
      .eq("status", "processing")
      .lt("locked_at", minCutoffIso);

    const staleJobs = (processingJobs || []).filter((job) => {
      const threshold = JOB_TYPE_STALE_OVERRIDES[job.job_type] ?? heartbeatTimeout;
      const cutoff = now - threshold * 1000;
      return job.locked_at && new Date(job.locked_at).getTime() < cutoff;
    });

    let staleCount = 0;
    let failedFromStale = 0;
    const toFail: Array<{ id: string; attempts: number; max_attempts: number; job_type: string; threshold: number }> = [];
    const toPending: Array<{ id: string; attempts: number; max_attempts: number; job_type: string; threshold: number }> = [];

    for (const sj of staleJobs) {
      const newAttempts = (sj.attempts || 0) + 1;
      const maxAttempts = sj.max_attempts || 3;
      const effectiveThreshold = JOB_TYPE_STALE_OVERRIDES[sj.job_type] ?? heartbeatTimeout;
      if (newAttempts >= maxAttempts) {
        toFail.push({ id: sj.id, attempts: newAttempts, max_attempts: maxAttempts, job_type: sj.job_type, threshold: effectiveThreshold });
      } else {
        toPending.push({ id: sj.id, attempts: newAttempts, max_attempts: maxAttempts, job_type: sj.job_type, threshold: effectiveThreshold });
      }
      staleCount++;
    }

    // Chunked updates — use run_after (not scheduled_at) for correct claim delay
    for (const c of chunk(toPending, 25)) {
      await Promise.all(c.map((sj) => {
        // Derive backoff from job_type: heavy generators get longer cooldown
        const typeBackoff = inferBackoffSeconds(sj.job_type);
        return sb.from("job_queue").update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          run_after: new Date(Date.now() + typeBackoff * 1000).toISOString(),
          last_error: `Stale lock (>${sj.threshold}s, type=${sj.job_type}) — attempt ${sj.attempts}/${sj.max_attempts}`,
          last_error_code: "STALE_LOCK",
          attempts: sj.attempts,
        }).eq("id", sj.id);
      }));
    }
    for (const c of chunk(toFail, 25)) {
      await Promise.all(c.map((sj) => sb.from("job_queue").update({
        status: "failed",
        locked_at: null,
        locked_by: null,
        last_error: `Stale lock (>${sj.threshold}s, type=${sj.job_type}) — max attempts (${sj.max_attempts}) reached`,
        last_error_code: "STALE_LOCK_EXHAUSTED",
        attempts: sj.attempts,
        completed_at: new Date().toISOString(),
      }).eq("id", sj.id)));
      failedFromStale += c.length;
    }

    // ══════════════════════════════════════════════════════
    // 1b) ZOMBIE STEP DETECTION (with age guard)
    // Steps in "running"/"enqueued"/"queued" with meta.ok=true or batch_complete=true
    // — worker completed but step never finalized.
    // Only auto-fix if age > 5 minutes (not a fresh step).
    // ══════════════════════════════════════════════════════
    const ZOMBIE_MIN_AGE_MS = 5 * 60 * 1000;
    const { data: zombieSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, meta, attempts, started_at, status")
      .in("status", ["running", "enqueued", "queued"]);

    const zombieResults: Array<{ package_id: string; step_key: string; action: string }> = [];
    for (const zs of zombieSteps || []) {
      const meta = (zs.meta ?? {}) as Record<string, unknown>;
      if (meta.ok !== true && meta.batch_complete !== true) continue;

      const age = zs.started_at ? Date.now() - new Date(zs.started_at).getTime() : Infinity;
      if (age <= ZOMBIE_MIN_AGE_MS) continue;

      // Race-safety gate: only finalize if NO active jobs remain for this step (via RPC — robust JSONB filter)
      const jobType = STEP_TO_JOB_TYPE[zs.step_key] ?? null;
      if (jobType) {
        const { data: activeJobCnt } = await safeRpc(sb, "count_active_jobs_for_package", {
          p_package_id: zs.package_id,
          p_job_type: jobType,
          p_statuses: ["pending", "processing"],
        });
        if ((activeJobCnt ?? 0) > 0) {
          console.log(`[stuck-scan] Zombie candidate ${zs.step_key} for ${zs.package_id.slice(0, 8)} skipped: ${activeJobCnt} active jobs remain`);
          continue;
        }
      }

      // ── HOLLOW COMPLETION GUARD ──
      // Before finalizing generate_exam_pool, verify at least 1 question exists.
      // This prevents the catastrophic bug where a step is marked "done" with 0 artifacts.
      if (zs.step_key === "generate_exam_pool") {
        const { data: pkg } = await sb.from("course_packages").select("curriculum_id").eq("id", zs.package_id).maybeSingle();
        if (pkg?.curriculum_id) {
          const { count: qCount } = await sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", pkg.curriculum_id);
          if ((qCount ?? 0) === 0) {
            console.warn(`[stuck-scan] HOLLOW GUARD: ${zs.step_key} for ${zs.package_id.slice(0,8)} has 0 exam questions — NOT finalizing, resetting to queued`);
            await sb.from("package_steps").update({
              status: "queued",
              started_at: null,
              finished_at: null,
              meta: { note: "HOLLOW_GUARD: 0 artifacts, reset by stuck-scan" },
            }).eq("package_id", zs.package_id).eq("step_key", zs.step_key);
            zombieResults.push({ package_id: zs.package_id, step_key: zs.step_key, action: "HOLLOW GUARD: reset to queued (0 questions)" });
            continue;
          }
        }
      }

      // 1) Finalize step (match on current status for race safety)
      await sb.from("package_steps").update({
        status: "done",
        finished_at: new Date().toISOString(),
        last_error: null,
      }).eq("package_id", zs.package_id).eq("step_key", zs.step_key).in("status", ["running", "enqueued", "queued"]);

      // 2) Cancel jobs scoped to this step
      await safeRpc(sb, "cancel_jobs_for_package", {
        p_package_id: zs.package_id,
        p_job_type: jobType,
        p_statuses: ["pending", "failed"],
        p_reason: `stuck-scan zombie finalize: cleanup for step ${zs.step_key}`,
      });

      // 3) Cancel stale processing jobs scoped to this step
      await safeRpc(sb, "cancel_stale_processing_jobs_for_package", {
        p_package_id: zs.package_id,
        p_job_type: jobType,
        p_stale_minutes: 15,
        p_reason: `stuck-scan zombie finalize: cleanup stale processing for step ${zs.step_key}`,
      });

      // 4) Log
      await sb.from("auto_heal_log").insert({
        action_type: "zombie_step_auto_finalize",
        trigger_source: "stuck-scan",
        target_type: "package_step",
        target_id: zs.package_id,
        result_status: "applied",
        result_detail: `Step ${zs.step_key} was ${zs.status} with meta.ok=${meta.ok}, batch_complete=${meta.batch_complete} for ${Math.round(age / 60000)}min — forced to done + jobs cancelled`,
        metadata: { step_key: zs.step_key, original_status: zs.status, meta, age_min: Math.round(age / 60000) },
      });

      zombieResults.push({ package_id: zs.package_id, step_key: zs.step_key, action: `forced to done (was ${zs.status}) + jobs cancelled` });
    }

    if (zombieResults.length > 0) {
      console.log(`[stuck-scan] 🧟 Fixed ${zombieResults.length} zombie step(s)`);
    }

    // ══════════════════════════════════════════════════════
    // 1c) ESCALATION LOOP DETECTION (scoped by step type)
    // - validate_* steps: skip + notify (safe to skip)
    // - generate_* / other steps: mark package needs_manual_review (NOT skip)
    // Guards: age > 10min since last update + failure signal required
    // ══════════════════════════════════════════════════════
    const ESCALATION_MAX = 10;
    const { data: escalatedSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, attempts, status, updated_at, last_error, meta")
      .gte("attempts", ESCALATION_MAX)
      .not("status", "in", '("done","skipped","blocked")');

    const escalationResults: Array<{ package_id: string; step_key: string; action: string }> = [];
    for (const es of escalatedSteps || []) {
      // Age guard: only act on loops that have been stable for a while
      const updatedAt = es.updated_at ? new Date(es.updated_at).getTime() : 0;
      const ageMs = updatedAt > 0 ? (Date.now() - updatedAt) : Infinity;
      if (ageMs < 10 * 60 * 1000) continue;

      // Signature guard: require some failure signal
      const lastErr = String(es.last_error || "");
      const metaErr = String(((es.meta ?? {}) as Record<string, unknown>)?.error || "");
      if (!lastErr && !metaErr) continue;

      const isValidation = es.step_key.startsWith("validate_");
      const jobType = STEP_TO_JOB_TYPE[es.step_key] ?? null;

      if (isValidation) {
        // Safe to skip validation steps — content exists, just validation is looping
        await sb.from("package_steps").update({
          status: "skipped",
          finished_at: new Date().toISOString(),
          last_error: `stuck-scan: escalation breaker after ${es.attempts} attempts`,
        }).eq("package_id", es.package_id).eq("step_key", es.step_key);

        // Cancel related jobs via RPC (step-scoped)
        await safeRpc(sb, "cancel_jobs_for_package", {
          p_package_id: es.package_id,
          p_job_type: jobType,
          p_statuses: ["pending", "failed"],
          p_reason: `stuck-scan escalation breaker: skip ${es.step_key}`,
        });

        escalationResults.push({ package_id: es.package_id, step_key: es.step_key, action: "skipped (validation loop)" });
        console.warn(`[stuck-scan] 🛑 Escalation breaker: skipped ${es.step_key} for ${es.package_id.slice(0, 8)} after ${es.attempts} attempts`);
      } else {
        // NOT safe to skip generate_* or other critical steps — flag for manual review
        await sb.from("course_packages").update({
          stuck_reason: `Escalation loop: step ${es.step_key} has ${es.attempts} attempts — manual review required`,
        }).eq("id", es.package_id);

        // Cancel related jobs to stop the loop (step-scoped)
        await safeRpc(sb, "cancel_jobs_for_package", {
          p_package_id: es.package_id,
          p_job_type: jobType,
          p_statuses: ["pending", "failed"],
          p_reason: `stuck-scan escalation breaker: halt ${es.step_key}`,
        });

        escalationResults.push({ package_id: es.package_id, step_key: es.step_key, action: "flagged for manual review (non-validation)" });
        console.warn(`[stuck-scan] 🛑 Escalation: ${es.step_key} for ${es.package_id.slice(0, 8)} flagged for manual review after ${es.attempts} attempts`);
      }
    }

    // ══════════════════════════════════════════════════════
    // 1d) SYSTEM FREEZE DETECTION
    // If there are NO completed jobs for a long time while pending/processing exist,
    // alert ops — this indicates a runner crash, cron failure, or queue deadlock.
    // ══════════════════════════════════════════════════════
    let systemFrozen = false;
    {
      const FREEZE_MINUTES = 120;
      const ACTIVE_STALL_MINUTES = 20;
      const nowIso = new Date().toISOString();

      const { data: lastCompleted } = await sb
        .from("job_queue")
        .select("completed_at")
        .eq("status", "completed")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1);

      const { count: processingCnt } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "processing");

      const { count: readyPendingCnt } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .or(`run_after.is.null,run_after.lte.${nowIso}`);

      const { data: lastActive } = await sb
        .from("job_queue")
        .select("updated_at")
        .in("status", ["pending", "processing"])
        .order("updated_at", { ascending: false })
        .limit(1);

      const activeCnt = (processingCnt ?? 0) + (readyPendingCnt ?? 0);
      const lastCompletedAt = lastCompleted?.[0]?.completed_at
        ? new Date(lastCompleted[0].completed_at as string).getTime()
        : 0;
      const lastActiveAt = lastActive?.[0]?.updated_at
        ? new Date(lastActive[0].updated_at as string).getTime()
        : 0;

      const freezeCutoff = Date.now() - FREEZE_MINUTES * 60_000;
      const activityCutoff = Date.now() - ACTIVE_STALL_MINUTES * 60_000;
      const isFrozen =
        activeCnt > 0 &&
        (lastCompletedAt === 0 || lastCompletedAt < freezeCutoff) &&
        (lastActiveAt === 0 || lastActiveAt < activityCutoff);

      if (isFrozen) {
        systemFrozen = true;
        const dedupeTitle = `⚫ System-Freeze: keine completed Jobs seit ${FREEZE_MINUTES}min`;
        const dedupeSince = new Date(Date.now() - 60 * 60_000).toISOString();
        const dedupeKey = `system_freeze_${new Date().toISOString().slice(0, 13)}`;
        const { count: existing } = await sb
          .from("admin_notifications")
          .select("id", { count: "exact", head: true })
          .eq("category", "ops")
          .eq("title", dedupeTitle)
          .gte("created_at", dedupeSince);
        if ((existing ?? 0) === 0) {
          await sb.from("admin_notifications").insert({
            title: dedupeTitle,
            body: `Ready-Queue/Processing aktiv (${activeCnt}), aber kein Completion seit >${FREEZE_MINUTES} Min und keine Queue-Aktivität seit >${ACTIVE_STALL_MINUTES} Min. Prüfe Runner + Lease-Hygiene.`,
            category: "ops",
            severity: "error",
            metadata: {
              dedupe_key: dedupeKey,
              active_jobs: activeCnt,
              processing: processingCnt ?? 0,
              ready_pending: readyPendingCnt ?? 0,
              last_completed_at: lastCompleted?.[0]?.completed_at ?? null,
              last_active_at: lastActive?.[0]?.updated_at ?? null,
            },
          });
        }
      }
    }

    // ══════════════════════════════════════════════════════
    // 2) Find building packages with no progress
    // ══════════════════════════════════════════════════════
    const stuckSince = new Date(Date.now() - packageTimeout * 60_000).toISOString();
    const { data: stuckPackages } = await sb
      .from("course_packages")
      .select("id, title, last_progress_at, stuck_reason, course_id")
      .eq("status", "building")
      .is("published_at", null)
      .lt("last_progress_at", stuckSince);

    const results: Array<{ package_id: string; retried: number; reason: string }> = [];

    for (const pkg of stuckPackages || []) {
      // Check package_steps FIRST (SSOT for pipeline state)
      const { count: activeSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["running", "enqueued"]);

      if ((activeSteps ?? 0) > 0) {
        if (pkg.stuck_reason) {
          await sb.from("course_packages").update({ stuck_reason: null }).eq("id", pkg.id);
        }
        results.push({ package_id: pkg.id, retried: 0, reason: `Skipped: ${activeSteps} active steps in package_steps` });
        continue;
      }

      // Check active leases
      const { count: activeLeases } = await sb
        .from("package_leases")
        .select("package_id", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .gt("lease_until", new Date().toISOString());

      if ((activeLeases ?? 0) > 0) {
        if (pkg.stuck_reason) {
          await sb.from("course_packages").update({ stuck_reason: null }).eq("id", pkg.id);
        }
        results.push({ package_id: pkg.id, retried: 0, reason: `Skipped: active lease exists` });
        continue;
      }

      // Check for queued/failed steps that can be retried
      const { count: retryableSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["queued", "failed"]);

      if ((retryableSteps ?? 0) > 0) {
        if (pkg.stuck_reason) {
          await sb.from("course_packages").update({ stuck_reason: null }).eq("id", pkg.id);
        }
        results.push({ package_id: pkg.id, retried: 0, reason: `Has ${retryableSteps} retryable steps — will be picked up by runner` });
        continue;
      }

      // Auto-retry recoverable jobs
      const { data: retried } = await sb.rpc("auto_retry_stuck_package", { p_package_id: pkg.id });
      const retriedCount = retried ?? 0;

      if (retriedCount === 0) {
        // Check if ALL steps are done — package should be published
        const { count: totalSteps } = await sb
          .from("package_steps")
          .select("step_key", { count: "exact", head: true })
          .eq("package_id", pkg.id);

        const { count: doneSteps } = await sb
          .from("package_steps")
          .select("step_key", { count: "exact", head: true })
          .eq("package_id", pkg.id)
          .in("status", ["done", "skipped"]);

        if ((totalSteps ?? 0) > 0 && (doneSteps ?? 0) === (totalSteps ?? 0)) {
          await sb.from("course_packages")
            .update({ status: "published", stuck_reason: null, build_progress: 100 })
            .eq("id", pkg.id);
          results.push({ package_id: pkg.id, retried: 0, reason: `All ${totalSteps} steps done — promoted to published` });
        } else {
          await sb.rpc("mark_package_stuck", {
            p_id: pkg.id,
            p_reason: `No progress for ${packageTimeout}min, no retryable steps or jobs`,
          });
          results.push({ package_id: pkg.id, retried: 0, reason: `Marked stuck: no retryable steps or jobs` });
        }
      } else {
        results.push({ package_id: pkg.id, retried: retriedCount, reason: `Auto-retried ${retriedCount} jobs` });
      }
    }

    // ══════════════════════════════════════════════════════
    // 3) Orphan detection
    // ══════════════════════════════════════════════════════
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id, title, build_progress, updated_at, course_id")
      .eq("status", "building")
      .is("published_at", null)
      .is("stuck_reason", null);

    const orphanResults: Array<{ package_id: string; action: string }> = [];
    for (const pkg of buildingPkgs || []) {
      const { count: activeSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["running", "enqueued", "queued", "failed"]);

      if ((activeSteps ?? 0) > 0) continue;

      const { count: totalSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id);

      const { count: doneSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["done", "skipped"]);

      if ((totalSteps ?? 0) > 0 && (doneSteps ?? 0) === (totalSteps ?? 0)) {
        await sb.from("course_packages")
          .update({ status: "published", build_progress: 100, stuck_reason: null })
          .eq("id", pkg.id);
        orphanResults.push({ package_id: pkg.id, action: "All steps done — promoted to published" });
        continue;
      }

      if ((totalSteps ?? 0) === 0) {
        orphanResults.push({ package_id: pkg.id, action: "No steps yet — waiting for runner bootstrap" });
        continue;
      }

      await sb.from("course_packages").update({
        stuck_reason: "No actionable steps remaining",
      }).eq("id", pkg.id);
      orphanResults.push({ package_id: pkg.id, action: "marked stuck (no actionable steps)" });
    }

    // ══════════════════════════════════════════════════════
    // 4) Alert if stuck packages detected
    // ══════════════════════════════════════════════════════
    const allStuck = [
      ...results.filter(r => r.reason.includes("Marked stuck")),
      ...orphanResults.filter(o => o.action.includes("stuck")),
      ...escalationResults,
    ];
    if (allStuck.length > 0) {
      await sb.from("admin_notifications").insert({
        title: `${allStuck.length} Package(s) stuck/escalated`,
        body: `Pakete ohne Fortschritt, verwaiste Builds oder Eskalations-Loops erkannt.`,
        category: "ops",
        severity: "warning",
        metadata: { details: allStuck },
      });
    }

    // ══════════════════════════════════════════════════════
    // 5) Scheduled Hygiene – clean orphan leases & non-building jobs
    // ══════════════════════════════════════════════════════
    let hygieneResult: Record<string, unknown> = {};
    try {
      const { data: hData, error: hErr } = await sb.rpc("ops_hygiene_cleanup", {
        p_max_lease_cleanup: 50,
        p_max_job_cleanup: 200,
      });
      if (hErr) {
        console.warn(`[stuck-scan] Hygiene RPC error: ${hErr.message}`);
      } else {
        hygieneResult = hData ?? {};
        if ((hData?.orphan_leases_removed ?? 0) + (hData?.idle_leases_removed ?? 0) + (hData?.non_building_jobs_failed ?? 0) > 0) {
          console.log(`[stuck-scan] Hygiene: ${JSON.stringify(hData)}`);
        }
      }
    } catch (hEx) {
      console.warn(`[stuck-scan] Hygiene threw: ${(hEx as Error).message}`);
    }

    // ══════════════════════════════════════════════════════
    // NIGHTLY POOL-MISMATCH SWEEP
    // Auto-fix jobs where worker_pool doesn't match SSOT and alert
    // ══════════════════════════════════════════════════════
    let poolMismatchFixed = 0;
    try {
      // Import pool definitions dynamically to stay in sync with SSOT
      const { JOB_DEFINITIONS } = await import("../_shared/job-map.ts");
      const contentJobTypes = Object.entries(JOB_DEFINITIONS)
        .filter(([_, def]: [string, any]) => def.pool === "content")
        .map(([k]) => k);

      if (contentJobTypes.length > 0) {
        // Only fix PENDING jobs (not processing) to avoid race with active workers
        const { data: mismatched } = await sb
          .from("job_queue")
          .select("id, job_type, worker_pool, meta")
          .eq("status", "pending")
          .eq("worker_pool", "core")
          .in("job_type", contentJobTypes)
          .limit(200);

        if (mismatched && mismatched.length > 0) {
          for (const row of mismatched) {
            const mergedMeta = { ...(row.meta as Record<string, unknown> ?? {}), pool_autofixed: true, old_pool: "core", fixed_by: "stuck-scan-sweep" };
            await sb.from("job_queue").update({
              worker_pool: "content",
              meta: mergedMeta,
              updated_at: new Date().toISOString(),
            }).eq("id", row.id);
          }
          poolMismatchFixed += mismatched.length;
          const mismatchJobTypes = [...new Set(mismatched.map(r => r.job_type))];
          const mismatchSampleIds = mismatched.slice(0, 5).map(r => r.id);
          console.warn(`[stuck-scan] 🔧 POOL_SWEEP: Fixed ${mismatched.length} job(s) from core→content | types=${mismatchJobTypes.join(",")} | samples=${mismatchSampleIds.join(",")}`);

          // Alert if mismatch found (indicates upstream drift)
          await sb.from("admin_notifications").insert({
            title: "Pool Mismatch Sweep: jobs auto-fixed",
            body: `${mismatched.length} job(s) were on wrong pool (core instead of content). Auto-fixed. Job types: ${mismatchJobTypes.join(", ")}`,
            category: "ops",
            severity: "warn",
            metadata: { fixed_count: mismatched.length, job_types: mismatchJobTypes, sample_ids: mismatchSampleIds },
          }).then(() => {}, () => {});
        }
      }
    } catch (sweepErr) {
      console.warn(`[stuck-scan] Pool sweep error: ${(sweepErr as Error).message}`);
    }

    console.log(`[stuck-scan] ${results.length} timeout-checked, ${orphanResults.length} orphan-checked, ${staleCount} stale jobs reset (${failedFromStale} permanently failed), ${zombieResults.length} zombie steps fixed, ${escalationResults.length} escalation loops handled${systemFrozen ? ", ⚫ SYSTEM FREEZE DETECTED" : ""}${poolMismatchFixed > 0 ? `, 🔧 ${poolMismatchFixed} pool mismatches fixed` : ""}`);

    return json({
      ok: true,
      config: { heartbeat_timeout_s: heartbeatTimeout, package_timeout_min: packageTimeout },
      stuck_packages: results,
      orphan_packages: orphanResults,
      stale_jobs_reset: staleCount,
      stale_jobs_permanently_failed: failedFromStale,
      zombie_steps_fixed: zombieResults,
      escalation_loops: escalationResults,
      system_frozen: systemFrozen,
      hygiene: hygieneResult,
      pool_mismatch_fixed: poolMismatchFixed,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[stuck-scan] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
