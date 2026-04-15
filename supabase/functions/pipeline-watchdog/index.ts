import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  neutralizeStaleTransientFailed,
  reviveLearningContentStepIfDead,
  getLearningContentLiveness,
} from "../_shared/learning-content-revive.ts";
import { getNeedsRegenCount } from "../_shared/learning-content-scheduler.ts";
import { QC_COVERAGE_ELIGIBLE } from "../_shared/qc-status.ts";

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

async function hasRecentOpenAlert(
  sb: ReturnType<typeof createClient>,
  source: string,
  containsMessage: string,
  minutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const { data } = await sb
    .from("ops_alerts")
    .select("id")
    .eq("source", source)
    .is("acknowledged_at", null)
    .gte("created_at", since)
    .ilike("message", `%${containsMessage}%`)
    .limit(1);
  return !!(data && data.length > 0);
}

/** Compute LF IDs that have 0 approved/tier1_passed questions in the exam pool */
async function computeMissingLfIds(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  packageId: string,
): Promise<string[]> {
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id")
    .eq("curriculum_id", curriculumId);

  const lfIds = (lfs || []).map((x: { id: string }) => x.id);
  if (lfIds.length === 0) return [];

  // exam_questions links via curriculum_id (no package_id column)
  const { data: rows } = await sb
    .from("exam_questions")
    .select("learning_field_id")
    .eq("curriculum_id", curriculumId)
    .in("qc_status", QC_COVERAGE_ELIGIBLE as unknown as string[]);

  const covered = new Set((rows || []).map((x: { learning_field_id: string }) => x.learning_field_id));
  return lfIds.filter((id: string) => !covered.has(id));
}

// Job type → step key mapping: derived from SSOT (STEP_TO_JOB_TYPE in job-map.ts)
import { STEP_TO_JOB_TYPE } from "../_shared/job-map.ts";
const JOB_TYPE_TO_STEP: Record<string, string> = Object.fromEntries(
  Object.entries(STEP_TO_JOB_TYPE).map(([step, jobType]) => [jobType, step])
);

/** When watchdog exhausts a job → also fail the linked step (SSOT sync).
 *  This prevents the runner from spawning new jobs for a terminally-failed step. */
async function syncStepOnJobExhaustion(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  jobType: string,
  jobId: string,
  reason: string,
) {
  const stepKey = JOB_TYPE_TO_STEP[jobType];
  if (!stepKey) return;

  await sb.from("package_steps").update({
    status: "failed",
    last_error: `Watchdog: job ${jobId.slice(0, 8)} exhausted (${reason}) — step synced to failed`,
  }).eq("package_id", packageId).eq("step_key", stepKey).eq("job_id", jobId);

  console.log(`[watchdog] SSOT sync: step ${stepKey} on pkg ${packageId.slice(0, 8)} → failed (${reason})`);
}

/**
 * pipeline-watchdog — Safety-net fallback (runs every 5 minutes via cron)
 *
 * The primary self-healing now happens in acquire_next_package_lease (RPC),
 * which atomically purges expired leases and reclaims orphaned packages.
 *
 * This watchdog only handles edge cases the runner can't:
 * 1. Expire stale steps (no heartbeat within timeout_seconds)
 * 2. Detect pipeline stalls (queued > 0 but nothing processing)
 * 3. Auto-resolve stall alerts when pipeline is healthy
 * 4. Final safety-net: re-queue orphaned building packages (belt-and-suspenders)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const actions: string[] = [];

  try {
    // ── 1) Expire stale steps (heartbeat-based timeout) ──
    // SAFETY: Before expiring, verify the linked job isn't still active.
    // The RPC only expires steps in 'running' status with stale heartbeats.
    const { data: expiredSteps, error: stepErr } = await sb.rpc(
      "expire_stale_steps",
    );
    if (stepErr) {
      console.error("[watchdog] expire_stale_steps error:", stepErr.message);
    }
    const staleSteps = (expiredSteps as Array<{
      package_id: string;
      step_key: string;
      runner_id: string;
      job_id?: string;
    }>) ?? [];

    for (const s of staleSteps) {
      // Double-check: if the step has a job_id, verify the job isn't still running
      if (s.job_id) {
        const { data: job } = await sb
          .from("job_queue")
          .select("status")
          .eq("id", s.job_id)
          .maybeSingle();

        if (job && (job.status === "processing" || job.status === "pending")) {
          // Job is still alive — revert the timeout, just heartbeat it
          console.log(`[watchdog] Step ${s.step_key} timed out but job ${s.job_id.slice(0, 8)} is ${job.status} — reverting timeout`);
          await sb
            .from("package_steps")
            .update({ status: "running", last_heartbeat_at: new Date().toISOString() })
            .eq("package_id", s.package_id)
            .eq("step_key", s.step_key);
          continue;
        }
      }

      actions.push(
        `Step timeout: ${s.step_key} on pkg ${s.package_id.slice(0, 8)}`,
      );

      // FIX: Reset the timed-out step to 'queued' so the runner can re-enqueue it.
      // Previously, the step stayed in 'timeout' status and the package stayed in 'queued',
      // causing the package to be permanently stuck.
      await sb
        .from("package_steps")
        .update({
          status: "queued",
          job_id: null,
          runner_id: null,
          started_at: null,
          last_error: `Watchdog: step '${s.step_key}' timed out — auto-reset to queued`,
        })
        .eq("package_id", s.package_id)
        .eq("step_key", s.step_key);

      // Ensure the package is in 'building' so the runner picks it up
      await sb
        .from("course_packages")
        .update({
          status: "building",
          last_error: `Watchdog: step '${s.step_key}' timed out — auto-recovered`,
        })
        .eq("id", s.package_id);
    }

    // ── 2) Safety-net: purge any expired leases the runner missed ──
    const { data: expiredLeases, error: leaseErr } = await sb.rpc(
      "expire_stale_leases",
    );
    if (leaseErr) {
      console.error("[watchdog] expire_stale_leases error:", leaseErr.message);
    }
    const staleLeases = (expiredLeases as Array<{
      package_id: string;
      runner_id: string;
    }>) ?? [];

    if (staleLeases.length > 0) {
      actions.push(`Safety-net: purged ${staleLeases.length} expired leases`);
    }

    // ── 2b) Zombie job sweep: fail jobs stuck in 'processing' with no lock ──
    // Tightened to 5min — edge functions timeout at 55s,
    // so anything unlocked for 5min is definitively dead.
    // ALSO catch jobs where locked_at is stale (>20min old) even if non-null.
    // v5.3: Raised from 10→20min to match job-runner lock timeout and prevent
    // premature STALE_LOCK kills on long-running AI jobs (exam-pool, glossary).
    const ZOMBIE_AGE_MINUTES = 5;
    const STALE_LOCK_MINUTES = 20;
    const zombieCutoff = new Date(Date.now() - ZOMBIE_AGE_MINUTES * 60 * 1000).toISOString();
    const staleLockCutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000).toISOString();

    // Type 1: Processing with NO lock at all — fetch first, then update with RACE-GUARD
    const { data: zombieJobs } = await sb
      .from("job_queue")
      .select("id, attempts, max_attempts, package_id, job_type, last_error, meta")
      .eq("status", "processing")
      .is("locked_at", null)
      .lt("updated_at", zombieCutoff);

    let zombieCount = 0;
    for (const zj of zombieJobs || []) {
      // FIX: Stale locks caused by transient errors (503/timeout) must NOT consume attempts
      const lastErr = String(zj.last_error ?? zj.meta?.last_error ?? "").toLowerCase();
      const isTransientZombie = lastErr.includes("503") || lastErr.includes("504") || lastErr.includes("502")
        || lastErr.includes("timeout") || lastErr.includes("service unavailable")
        || lastErr.includes("rate limit") || lastErr.includes("llm_empty")
        || lastErr.includes("transient") || lastErr.includes("all providers failed");
      const newAttempts = isTransientZombie ? (zj.attempts || 0) : (zj.attempts || 0) + 1;
      const maxAttempts = zj.max_attempts || 3;
      if (!isTransientZombie && newAttempts >= maxAttempts) {
        // RACE-GUARD: repeat original filter conditions in UPDATE to prevent overwriting freshly-claimed jobs
        const { count } = await sb.from("job_queue").update({
          status: "failed",
          last_error: `Watchdog zombie: no lock >${ZOMBIE_AGE_MINUTES}min — max attempts (${maxAttempts}) reached`,
          last_error_code: "ZOMBIE_EXHAUSTED",
          attempts: newAttempts,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", zj.id).eq("status", "processing").is("locked_at", null);

        // SSOT: sync step status so runner doesn't spawn new jobs for this exhausted step
        if (count && count > 0 && zj.package_id) {
          await syncStepOnJobExhaustion(sb, zj.package_id, zj.job_type, zj.id, "ZOMBIE_EXHAUSTED");
        }
      } else {
        await sb.from("job_queue").update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          scheduled_at: new Date(Date.now() + (isTransientZombie ? 60_000 : 30_000)).toISOString(),
          last_error: isTransientZombie
            ? `Watchdog zombie: transient stale lock — reset (no attempts consumed)`
            : `Watchdog zombie: no lock >${ZOMBIE_AGE_MINUTES}min — attempt ${newAttempts}/${maxAttempts}`,
          last_error_code: isTransientZombie ? "ZOMBIE_TRANSIENT_RESET" : "ZOMBIE_RETRY",
          attempts: newAttempts,
          updated_at: new Date().toISOString(),
        }).eq("id", zj.id).eq("status", "processing").is("locked_at", null);
      }
      zombieCount++;
    }

    // Type 2: Processing with STALE lock (locked_at too old) — fetch first, then update with RACE-GUARD
    const { data: staleJobs } = await sb
      .from("job_queue")
      .select("id, attempts, max_attempts, package_id, job_type, last_error, meta")
      .eq("status", "processing")
      .lt("locked_at", staleLockCutoff);

    let staleLockCount = 0;
    for (const sj of staleJobs || []) {
      // FIX: Stale locks caused by transient errors must NOT consume attempts
      const lastErr = String(sj.last_error ?? sj.meta?.last_error ?? "").toLowerCase();
      const isTransientStale = lastErr.includes("503") || lastErr.includes("504") || lastErr.includes("502")
        || lastErr.includes("timeout") || lastErr.includes("service unavailable")
        || lastErr.includes("rate limit") || lastErr.includes("llm_empty")
        || lastErr.includes("transient") || lastErr.includes("all providers failed");
      const newAttempts = isTransientStale ? (sj.attempts || 0) : (sj.attempts || 0) + 1;
      const maxAttempts = sj.max_attempts || 3;
      if (!isTransientStale && newAttempts >= maxAttempts) {
        // RACE-GUARD: repeat stale-lock cutoff in UPDATE
        const { count } = await sb.from("job_queue").update({
          status: "failed",
          last_error: `Watchdog: stale lock >${STALE_LOCK_MINUTES}min — max attempts (${maxAttempts}) reached`,
          last_error_code: "STALE_LOCK_EXHAUSTED",
          attempts: newAttempts,
          locked_at: null,
          locked_by: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", sj.id).eq("status", "processing").lt("locked_at", staleLockCutoff);

        if (count && count > 0 && sj.package_id) {
          await syncStepOnJobExhaustion(sb, sj.package_id, sj.job_type, sj.id, "STALE_LOCK_EXHAUSTED");
        }
      } else {
        // RACE-GUARD: repeat stale-lock cutoff
        await sb.from("job_queue").update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          scheduled_at: new Date(Date.now() + (isTransientStale ? 60_000 : 30_000)).toISOString(),
          last_error: isTransientStale
            ? `Watchdog: transient stale lock — reset (no attempts consumed)`
            : `Watchdog: stale lock >${STALE_LOCK_MINUTES}min — attempt ${newAttempts}/${maxAttempts}`,
          last_error_code: isTransientStale ? "STALE_LOCK_TRANSIENT_RESET" : "STALE_LOCK",
          attempts: newAttempts,
          updated_at: new Date().toISOString(),
        }).eq("id", sj.id).eq("status", "processing").lt("locked_at", staleLockCutoff);
      }
      staleLockCount++;
    }

    const zombieJobCount = zombieCount + staleLockCount;
    if (zombieJobCount > 0) {
      actions.push(`Zombie sweep: ${zombieCount} unlocked + ${staleLockCount} stale-locked jobs (transient-aware attempts)`);
    }

    // ── 2c) Ghost-Running-Step Guard ──
    // Detect steps stuck in 'running' that have NO active job (processing|pending) in job_queue.
    // This prevents the runner from endlessly re-creating jobs for orphaned steps.
    const GHOST_AGE_MINUTES = 10;
    const ghostCutoff = new Date(Date.now() - GHOST_AGE_MINUTES * 60 * 1000).toISOString();

    const { data: ghostSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, job_id, attempts, max_attempts, last_error")
      .eq("status", "running")
      .lt("last_heartbeat_at", ghostCutoff);

    let ghostCount = 0;
    for (const gs of ghostSteps || []) {
      // Check if there's still an active job for this step
      let hasActiveJob = false;
      if (gs.job_id) {
        const { data: activeJob } = await sb
          .from("job_queue")
          .select("id")
          .eq("id", gs.job_id)
          .in("status", ["processing", "pending"])
          .maybeSingle();
        hasActiveJob = !!activeJob;
      }

      if (!hasActiveJob) {
        // FIX: Ghost steps from transient errors (503/timeout) must NOT consume attempts
        const lastStepErr = String(gs.last_error ?? "").toLowerCase();
        const isTransientGhost = lastStepErr.includes("503") || lastStepErr.includes("504") || lastStepErr.includes("502")
          || lastStepErr.includes("timeout") || lastStepErr.includes("transient")
          || lastStepErr.includes("service unavailable") || lastStepErr.includes("all providers failed");
        const stepAttempts = isTransientGhost ? (gs.attempts || 0) : (gs.attempts || 0) + 1;
        const stepMax = gs.max_attempts || 5;
        if (!isTransientGhost && stepAttempts >= stepMax) {
          // Exhausted → fail the step and package
          await sb.from("package_steps").update({
            status: "failed",
            job_id: null,
            runner_id: null,
            last_error: `Watchdog ghost-guard: running without active job, attempts exhausted (${stepAttempts}/${stepMax})`,
            attempts: stepAttempts,
          }).eq("package_id", gs.package_id).eq("step_key", gs.step_key).eq("status", "running");

          await sb.from("course_packages").update({
            status: "failed",
            last_error: `Step ${gs.step_key} exhausted after ghost-guard recovery`,
          }).eq("id", gs.package_id);
        } else {
          // Reset to queued for re-enqueue
          await sb.from("package_steps").update({
            status: "queued",
            job_id: null,
            runner_id: null,
            started_at: null,
            attempts: stepAttempts,
            last_error: isTransientGhost
              ? `Watchdog ghost-guard: transient stale — reset (no attempts consumed)`
              : `Watchdog ghost-guard: running without active job — reset (attempt ${stepAttempts}/${stepMax})`,
          }).eq("package_id", gs.package_id).eq("step_key", gs.step_key).eq("status", "running");
        }

        ghostCount++;
        actions.push(`Ghost-step: ${gs.step_key} on pkg ${(gs.package_id as string).slice(0, 8)} (attempt ${stepAttempts}/${stepMax})`);
      }
    }
    if (ghostCount > 0) {
      console.log(`[watchdog] Ghost-running guard: healed ${ghostCount} orphaned steps`);
    }

    // ── 3) Auto-heal: building without lease or jobs → reset to queued ──
    // The view ops_building_without_job_or_lease already excludes packages
    // that have an active lease (including heal-dispatch leases).
    // Additional grace: skip packages with a recent pending/queued job (< 10 min old)
    // to avoid reverting packages where the runner hasn't picked up the job yet.
    const GRACE_JOB_MINUTES = 10;
    const jobGraceCutoff = new Date(Date.now() - GRACE_JOB_MINUTES * 60 * 1000).toISOString();

    const { data: zombieCandidates, error: zombieFetchErr } = await sb
      .from("ops_building_without_job_or_lease")
      .select("package_id")
      .limit(50);

    if (zombieFetchErr) {
      console.error("[watchdog] ops_building_without_job_or_lease fetch error:", zombieFetchErr.message);
    }

    let healedZombies = 0;
    if (zombieCandidates?.length) {
      const candidateIds = zombieCandidates.map((z: any) => z.package_id);

      // Check for recently created jobs — these packages may have been healed
      // and the runner just hasn't claimed them yet
      const { data: recentJobs } = await sb
        .from("job_queue")
        .select("package_id")
        .in("package_id", candidateIds)
        .in("status", ["pending", "queued"])
        .gte("created_at", jobGraceCutoff);

      const recentJobPkgIds = new Set((recentJobs || []).map((j: any) => j.package_id));

      const revertableIds: string[] = [];
      for (const cid of candidateIds) {
        if (recentJobPkgIds.has(cid)) {
          console.log(`[watchdog] GRACE_SKIP: pkg ${cid.slice(0, 8)} has recent pending job — within ${GRACE_JOB_MINUTES}min grace`);
          continue;
        }
        revertableIds.push(cid);
      }

      if (revertableIds.length > 0) {
        const { count } = await sb
          .from("course_packages")
          .update({
            status: "queued",
            updated_at: new Date().toISOString(),
            last_error: "Watchdog: building without job/lease — reset to queued",
          })
          .in("id", revertableIds)
          .eq("status", "building");

        healedZombies = count ?? revertableIds.length;
      }
    }

    if (healedZombies > 0) {
      actions.push(`Zombie building reset: ${healedZombies} packages (lease+job-grace-aware)`);
    }

    // ── 3b) Auto-Unblock: QG-failed packages that have been healed ──
    // If validate_exam_pool + run_integrity_check are both done and
    // next steps (quality_council/auto_publish) are queued → unblock to building.
    {
      const { data: qgHealedPkgs } = await sb
        .from("course_packages")
        .select("id, integrity_passed")
        .eq("status", "quality_gate_failed")
        .limit(20);

      let unblocked = 0;
      for (const pkg of qgHealedPkgs || []) {
        // ── CRITICAL: integrity_passed flag is the SSOT for gate result ──
        // status=done on run_integrity_check only means "check executed",
        // NOT "gate passed". Must verify integrity_passed=true on package.
        if (!(pkg as any).integrity_passed) continue;

        const { data: stepRows } = await sb
          .from("package_steps")
          .select("step_key, status, meta")
          .eq("package_id", pkg.id);

        if (!stepRows || stepRows.length === 0) continue;

        const byKey = new Map(stepRows.map((s: any) => [s.step_key, s.status]));

        // Check healing prerequisites
        const validateDone = byKey.get("validate_exam_pool") === "done";
        const integrityDone = byKey.get("run_integrity_check") === "done";
        if (!validateDone || !integrityDone) continue;

        // Double-check: run_integrity_check meta.ok must be true
        const integrityStep = stepRows.find((s: any) => s.step_key === "run_integrity_check");
        const integrityMeta = integrityStep?.meta as Record<string, unknown> | null;
        if (!integrityMeta?.ok) {
          console.warn(`[watchdog] QG-unblock BLOCKED: pkg ${(pkg.id as string).slice(0, 8)} — integrity step done but meta.ok=${integrityMeta?.ok}`);
          continue;
        }

        // Check that next steps are queued (ready for runner)
        const hasQueuedNext = stepRows.some((s: any) =>
          (s.step_key === "quality_council" || s.step_key === "auto_publish") && s.status === "queued"
        );
        if (!hasQueuedNext) continue;

        // No active jobs? (prevent race)
        const { count: activeJobs } = await sb
          .from("job_queue")
          .select("id", { count: "exact", head: true })
          .eq("package_id", pkg.id)
          .in("status", ["processing", "pending"]);
        if ((activeJobs ?? 0) > 0) continue;

        // Unblock! Use RPC to prevent uniq_visible_package_per_curriculum violation
        await sb.rpc("safe_transition_package_status", {
          p_package_id: pkg.id,
          p_new_status: "building",
          p_extra: { last_error: "Watchdog auto-unblock: QG healed, integrity_passed=true" },
        });

        unblocked++;
        actions.push(`QG-unblock: pkg ${(pkg.id as string).slice(0, 8)} → building (integrity_passed+healed)`);
        console.log(`[watchdog] QG-unblock: ${(pkg.id as string).slice(0, 8)} — integrity_passed=true, validate+integrity done, next steps queued`);
      }

      if (unblocked > 0) {
        await sb.from("auto_heal_log").insert({
          action_type: "qg_auto_unblock",
          trigger_source: "pipeline-watchdog",
          result_status: "applied",
          result_detail: `Unblocked ${unblocked} QG-healed package(s)`,
        });
      }
    }

    // ── 4) QG-Failed Auto-Heal ──
    // Detect quality_gate_failed packages and reset them to building
    // with re-queued steps so the pipeline can retry after gap-closing.
    const QG_COOLDOWN_MINUTES = 60; // Don't re-heal within 60 min
    const QG_MAX_HEAL_CYCLES = 3;   // Circuit breaker: max heal attempts before blocking
    const qgCooldownCutoff = new Date(Date.now() - QG_COOLDOWN_MINUTES * 60 * 1000).toISOString();

    const { data: qgFailedPkgs } = await sb
      .from("course_packages")
      .select("id, title, integrity_report, updated_at, curriculum_id, published_at, blocked_reason, retry_count")
      .eq("status", "quality_gate_failed")
      .lt("updated_at", qgCooldownCutoff) // Only packages that have been stuck for > cooldown
      .limit(5); // Process max 5 per cycle to avoid overload

    let qgHealedCount = 0;
    let qgSeenCount = 0;
    let qgSkippedCount = 0;

    for (const pkg of (qgFailedPkgs || [])) {
      qgSeenCount++;

      // Hard guard: truly immutable packages (published AND NOT qg-failed) are NOT executable.
      // But: packages that WERE published and then demoted to quality_gate_failed by the
      // publish-readiness gate SHOULD be healable — their published_at is stale/invalid.
      const hasLegacyViolation = String(pkg.blocked_reason || "").includes("LEGACY_VIOLATION");
      if (hasLegacyViolation) {
        qgSkippedCount++;
        console.log(`[watchdog] QG-heal skip LEGACY_VIOLATION pkg=${(pkg.id as string).slice(0, 8)}`);
        continue;
      }

      // ── Circuit Breaker: stop infinite QG-heal loops ──
      const currentRetryCount = (pkg as any).retry_count ?? 0;
      if (currentRetryCount >= QG_MAX_HEAL_CYCLES) {
        // Block the package — generator cannot produce enough content
        await sb.from("course_packages").update({
          status: "blocked",
          blocked_reason: "pipeline_repair_required",
          updated_at: new Date().toISOString(),
        }).eq("id", pkg.id);
        await sb.from("admin_notifications").insert({
          title: `QG-Heal exhausted: ${(pkg.title as string || "").slice(0, 40)}`,
          body: `Package ${(pkg.id as string).slice(0, 8)} blocked after ${currentRetryCount} QG-heal cycles. Manual review required.`,
          severity: "error",
          category: "pipeline",
          entity_type: "course_package",
          entity_id: pkg.id as string,
        });
        qgSkippedCount++;
        actions.push(`QG-heal BLOCKED: pkg ${(pkg.id as string).slice(0, 8)} after ${currentRetryCount} cycles`);
        console.warn(`[watchdog] QG-heal CIRCUIT BREAKER: pkg=${(pkg.id as string).slice(0, 8)} blocked after ${currentRetryCount} cycles`);
        continue;
      }

      // Clear stale published_at if present — the package is NOT published anymore
      if (pkg.published_at) {
        await sb.from("course_packages").update({ published_at: null }).eq("id", pkg.id);
        console.log(`[watchdog] QG-heal: cleared stale published_at for pkg=${(pkg.id as string).slice(0, 8)}`);
      }

      const report = pkg.integrity_report as any;
      const hardFails: string[] = report?.v3?.hard_fail_reasons || [];

      // ── Fingerprint-based dedup: don't re-heal if same failures persist ──
      const failFingerprint = hardFails.slice().sort().join("|");
      const lastHealFingerprint = report?.v3?.last_heal_fingerprint || "";
      if (failFingerprint && failFingerprint === lastHealFingerprint) {
        qgSkippedCount++;
        console.log(`[watchdog] QG-heal SKIP: same failures persist for pkg=${(pkg.id as string).slice(0, 8)}: ${failFingerprint.slice(0, 80)}`);
        continue;
      }

      if (hardFails.length === 0) {
        // No structured failures — try generic re-run of integrity + council
        console.log(`[watchdog] QG-heal: no hard_fail_reasons for pkg=${(pkg.id as string).slice(0, 8)}, doing generic retry`);
        // Fall through to generic case below instead of skipping
      }

      // Determine which steps need re-queuing based on failure type
      const stepsToReset: string[] = [];
      let healReason = "";

      const hasLfCoverage = hardFails.some((f: string) => f.includes("LF_COVERAGE"));
      const hasPoolIssue = hardFails.some((f: string) => f.includes("EXAM_POOL") || f.includes("TOO_FEW"));
      const hasBloomGap = hardFails.some((f: string) => f.includes("HARDISH_TOO_LOW") || f.includes("BLOOM_") || f.includes("EASY_TOO_HIGH"));

      if (hasBloomGap && pkg.curriculum_id) {
        // Trigger targeted bloom gap-fill BEFORE resetting steps
        try {
          const { enqueueJob } = await import("../_shared/enqueue.ts");
          await enqueueJob(sb, {
            job_type: "pool_fill_bloom_gaps",
            payload: {
              curriculum_id: pkg.curriculum_id,
              package_id: pkg.id,
              heal_reason: "WATCHDOG_BLOOM_GAP_HEAL",
            },
            max_attempts: 3,
          });
          actions.push(`Bloom-gap-fill enqueued for pkg ${(pkg.id as string).slice(0, 8)}`);
        } catch (e) {
          console.error(`[watchdog] bloom-gap-fill enqueue error:`, (e as Error).message);
        }
      }

      if (hasLfCoverage) {
        // LF_COVERAGE: DON'T re-queue generate_exam_pool (pool_fill_lf_gaps handles it)
        // This prevents race conditions between the two generators
        stepsToReset.push(
          "validate_exam_pool",
          "build_ai_tutor_index", "validate_tutor_index",
          "generate_oral_exam", "validate_oral_exam",
          "run_integrity_check", "quality_council", "auto_publish",
        );
        healReason = "LF_COVERAGE_GAP";
      } else if (hasPoolIssue) {
        // Full pool regen needed
        stepsToReset.push(
          "generate_exam_pool", "validate_exam_pool",
          "build_ai_tutor_index", "validate_tutor_index",
          "generate_oral_exam", "validate_oral_exam",
          "run_integrity_check", "quality_council", "auto_publish",
        );
        healReason = "EXAM_POOL_INSUFFICIENT";
      } else {
        // Generic: re-queue from integrity check onwards
        stepsToReset.push("run_integrity_check", "quality_council", "auto_publish");
        healReason = "GENERIC_QG_RETRY";
      }

      // Reset the steps to queued — track actual updates
      let stepsResetCount = 0;
      for (const stepKey of stepsToReset) {
        const { data: updatedRows } = await sb
          .from("package_steps")
          .update({
            status: "queued",
            attempts: 0,
            job_id: null,
            runner_id: null,
            started_at: null,
            last_error: `Watchdog QG-heal: reset for ${healReason}`,
          })
          .eq("package_id", pkg.id)
          .eq("step_key", stepKey)
          .select("step_key");
        stepsResetCount += updatedRows?.length ?? 0;
      }

      if (stepsResetCount === 0) {
        console.warn(`[watchdog] QG-heal PARTIAL: pkg=${(pkg.id as string).slice(0, 8)} — 0 steps actually reset`);
        qgSkippedCount++;
        continue;
      }

      // Reset package to building + increment retry_count for circuit breaker tracking
      // Store heal fingerprint to prevent re-healing with identical failures
      const updatedReport = { ...(report || {}), v3: { ...(report?.v3 || {}), last_heal_fingerprint: failFingerprint } };
      await sb
        .from("course_packages")
        .update({
          status: "building",
          retry_count: currentRetryCount + 1,
          integrity_report: updatedReport,
          last_error: `Watchdog QG-heal: ${healReason} — ${hardFails.length} blocker(s), ${stepsResetCount} steps reset → retry (cycle ${currentRetryCount + 1}/${QG_MAX_HEAL_CYCLES})`,
        })
        .eq("id", pkg.id);

      // Archive failed jobs (preserve forensics), delete only cancelled
      await sb
        .from("job_queue")
        .update({ status: "cancelled", last_error: `Watchdog QG-heal cleanup` })
        .eq("package_id", pkg.id)
        .eq("status", "failed");

      await sb
        .from("job_queue")
        .delete()
        .eq("package_id", pkg.id)
        .eq("status", "cancelled");

      // ── Targeted LF gap-fill: compute real missing IDs + enqueue ──
      if (hasLfCoverage && pkg.curriculum_id) {
        let missingLfIds: string[] = [];
        try {
          missingLfIds = await computeMissingLfIds(sb, pkg.curriculum_id as string, pkg.id as string);
        } catch (e) {
          console.error(`[watchdog] computeMissingLfIds error for pkg=${(pkg.id as string).slice(0, 8)}:`, (e as Error).message);
        }

        // FIX: Use enqueueJob helper (not raw insert) to respect SSOT pool routing + immutability guard
        let gapFillEnqueued = false;
        try {
          const { enqueueJob } = await import("../_shared/enqueue.ts");
          await enqueueJob(sb, {
            job_type: "pool_fill_lf_gaps",
            payload: {
              package_id: pkg.id,
              curriculum_id: pkg.curriculum_id,
              missing_learning_field_ids: missingLfIds,
              missing_count: missingLfIds.length,
              heal_reason: healReason,
            },
            package_id: pkg.id as string,
            priority: 15,
          });
          gapFillEnqueued = true;
        } catch (enqErr) {
          console.warn(`[watchdog] pool_fill_lf_gaps enqueue blocked for pkg=${(pkg.id as string).slice(0, 8)}: ${(enqErr as Error).message}`);
        }

        if (gapFillEnqueued) {
          console.log(
            `[watchdog] QG-heal: enqueued pool_fill_lf_gaps for pkg=${(pkg.id as string).slice(0, 8)} (${missingLfIds.length} missing LFs: ${missingLfIds.map((id: string) => id.slice(0, 8)).join(", ")})`,
          );
        }
      }

      // ── Targeted Bloom/Difficulty gap-fill: enqueue alongside LF gaps ──
      if (pkg.curriculum_id) {
        try {
          const { enqueueJob } = await import("../_shared/enqueue.ts");
          await enqueueJob(sb, {
            job_type: "pool_fill_bloom_gaps",
            payload: {
              package_id: pkg.id,
              curriculum_id: pkg.curriculum_id,
              heal_reason: healReason,
            },
            package_id: pkg.id as string,
            priority: 14,
          });
          console.log(`[watchdog] QG-heal: enqueued pool_fill_bloom_gaps for pkg=${(pkg.id as string).slice(0, 8)}`);
        } catch (enqErr) {
          console.warn(`[watchdog] pool_fill_bloom_gaps enqueue blocked: ${(enqErr as Error).message}`);
        }
      }

      qgHealedCount++;
      actions.push(
        `QG-heal: ${(pkg.title as string).slice(0, 30)} (${healReason}, ${stepsResetCount}/${stepsToReset.length} steps reset)`,
      );

      console.log(
        `[watchdog] QG-heal: pkg=${(pkg.id as string).slice(0, 8)} "${pkg.title}" reason=${healReason} fails=${hardFails.join("; ")} steps_reset=${stepsResetCount}`,
      );
    }

    // ── 4b) Failed-Package Auto-Heal ──
    // Detect packages with status='failed' and attempt recovery by resetting
    // failed/timeout steps to queued + setting package back to building.
    // Uses same circuit-breaker pattern as QG-heal.
    const FAILED_COOLDOWN_MINUTES = 60;
    const FAILED_MAX_HEAL_CYCLES = 3;
    const failedCooldownCutoff = new Date(Date.now() - FAILED_COOLDOWN_MINUTES * 60 * 1000).toISOString();

    const { data: failedPkgs } = await sb
      .from("course_packages")
      .select("id, title, updated_at, curriculum_id, retry_count, blocked_reason, last_error")
      .eq("status", "failed")
      .lt("updated_at", failedCooldownCutoff)
      .limit(5);

    let failedHealedCount = 0;

    for (const pkg of (failedPkgs || [])) {
      const currentRetryCount = (pkg as any).retry_count ?? 0;

      // Circuit breaker
      if (currentRetryCount >= FAILED_MAX_HEAL_CYCLES) {
        await sb.from("course_packages").update({
          status: "blocked",
          blocked_reason: "pipeline_repair_required",
          updated_at: new Date().toISOString(),
        }).eq("id", pkg.id);
        await sb.from("admin_notifications").insert({
          title: `Failed-Heal exhausted: ${(pkg.title as string || "").slice(0, 40)}`,
          body: `Package ${(pkg.id as string).slice(0, 8)} blocked after ${currentRetryCount} failed-heal cycles. Manual review required.`,
          severity: "error",
          category: "pipeline",
          entity_type: "course_package",
          entity_id: pkg.id as string,
        });
        actions.push(`Failed-heal BLOCKED: pkg ${(pkg.id as string).slice(0, 8)} after ${currentRetryCount} cycles`);
        continue;
      }

      // Get package steps – find failed/timeout ones to reset
      const { data: stepRows } = await sb
        .from("package_steps")
        .select("step_key, status, attempts, max_attempts")
        .eq("package_id", pkg.id);

      if (!stepRows || stepRows.length === 0) continue;

      const stepsToReset = stepRows.filter((s: any) =>
        s.status === "failed" || s.status === "timeout"
      );

      if (stepsToReset.length === 0) {
        // No failed steps – might be a package-level failure with all steps done
        // Just reset the package to building so the runner can evaluate
        await sb.from("course_packages").update({
          status: "building",
          retry_count: currentRetryCount + 1,
          last_error: `Watchdog failed-heal: no failed steps found, resetting package (cycle ${currentRetryCount + 1}/${FAILED_MAX_HEAL_CYCLES})`,
          updated_at: new Date().toISOString(),
        }).eq("id", pkg.id);
        failedHealedCount++;
        actions.push(`Failed-heal (no failed steps): pkg ${(pkg.id as string).slice(0, 8)} → building`);
        continue;
      }

      // Reset failed steps to queued
      let stepsResetCount = 0;
      for (const step of stepsToReset) {
        const { data: updRows } = await sb
          .from("package_steps")
          .update({
            status: "queued",
            attempts: 0,
            job_id: null,
            runner_id: null,
            started_at: null,
            last_error: `Watchdog failed-heal: auto-reset (cycle ${currentRetryCount + 1})`,
          })
          .eq("package_id", pkg.id)
          .eq("step_key", step.step_key)
          .select("step_key");
        stepsResetCount += updRows?.length ?? 0;
      }

      // Clean up failed jobs for this package
      await sb.from("job_queue")
        .update({ status: "cancelled", last_error: "Watchdog failed-heal cleanup" })
        .eq("package_id", pkg.id)
        .eq("status", "failed");

      // Reset package to building
      await sb.from("course_packages").update({
        status: "building",
        retry_count: currentRetryCount + 1,
        last_error: `Watchdog failed-heal: ${stepsResetCount} steps reset → retry (cycle ${currentRetryCount + 1}/${FAILED_MAX_HEAL_CYCLES})`,
        updated_at: new Date().toISOString(),
      }).eq("id", pkg.id);

      failedHealedCount++;
      actions.push(`Failed-heal: pkg ${(pkg.id as string).slice(0, 8)} "${(pkg.title as string || "").slice(0, 30)}" — ${stepsResetCount} steps reset`);
      console.log(`[watchdog] Failed-heal: pkg=${(pkg.id as string).slice(0, 8)} steps_reset=${stepsResetCount} cycle=${currentRetryCount + 1}`);
    }

    if (failedHealedCount > 0) {
      try {
        await sb.from("auto_heal_log").insert({
          action_type: "failed_package_auto_heal",
          trigger_source: "pipeline-watchdog",
          result_status: "applied",
          result_detail: `Healed ${failedHealedCount} failed package(s)`,
        });
      } catch (_e) { /* best-effort */ }
    }

    // ── 5) Count active state ──
    const { count: activeLeases } = await sb
      .from("package_leases")
      .select("package_id", { count: "exact", head: true })
      .gt("lease_until", new Date().toISOString());

    const { count: queuedCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued");

    const { count: buildingCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "building");

    // ── 6) Stall detection ──
    const isStalled =
      (queuedCount ?? 0) > 0 &&
      (buildingCount ?? 0) === 0 &&
      (activeLeases ?? 0) === 0;

    if (isStalled) {
      const alreadyAlerted = await hasRecentOpenAlert(
        sb,
        "pipeline-watchdog",
        "PIPELINE_STALLED",
        10,
      );
      if (!alreadyAlerted) {
        try {
          await sb
            .from("ops_alerts")
            .insert({
              source: "pipeline-watchdog",
              severity: "error",
              message: `PIPELINE_STALLED: queued=${queuedCount} building=${buildingCount} leases=${activeLeases}`,
              payload: {
                queued: queuedCount,
                building: buildingCount,
                activeLeases,
                ts: new Date().toISOString(),
              },
            });
        } catch (_) { /* non-critical */ }
        actions.push(
          `PIPELINE_STALLED alert: queued=${queuedCount} building=${buildingCount}`,
        );
      }
    }

    // ── 7) Auto-resolve stall alerts when healthy ──
    const isHealthy = (activeLeases ?? 0) > 0;
    if (isHealthy) {
      try {
        await sb
          .from("ops_alerts")
          .update({ acknowledged_at: new Date().toISOString() })
          .eq("source", "pipeline-watchdog")
          .is("acknowledged_at", null)
          .ilike("message", "%PIPELINE_STALLED%");
      } catch (_) { /* non-critical */ }
    }

    // ── 8) Learning-content liveness guard (v2 — shard-aware) ──
    // Uses composite liveness: parent jobs + shard jobs + shard table state.
    // Detects shard_orphaned and fully_idle verdicts as deadlock conditions.
    let lcRevivedCount = 0;
    let lcNeutralizedCount = 0;
    let lcDeadlockCount = 0;
    try {
      const { data: buildingPkgs } = await sb
        .from("course_packages")
        .select("id")
        .eq("status", "building");

      for (const pkg of buildingPkgs || []) {
        const pkgId = pkg.id as string;

        // Check if step exists and is not done
        const { data: step } = await sb
          .from("package_steps")
          .select("id, status, meta")
          .eq("package_id", pkgId)
          .eq("step_key", "generate_learning_content")
          .maybeSingle();

        if (!step || step.status === "done") continue;

        // Composite shard-aware liveness check
        const liveness = await getLearningContentLiveness(sb, pkgId);

        // If healthy or stalled (within grace), skip
        if (liveness.verdict === "healthy_active" || liveness.verdict === "parent_only_active" || liveness.verdict === "stalled") continue;
        // If all shards are done (healthy_idle), skip — finalize will handle it
        if (liveness.verdict === "healthy_idle") continue;

        // Use SSOT needs_regen count from scheduler
        const needsRegen = await getNeedsRegenCount(sb, pkgId);
        if (!needsRegen || needsRegen <= 0) continue;

        if (liveness.is_deadlocked) {
          lcDeadlockCount++;
          console.warn(
            `[watchdog] 🔴 SHARD_DEADLOCK: pkg=${pkgId.slice(0, 8)} verdict=${liveness.verdict} shards_pending=${liveness.shards_pending} shard_jobs_active=${liveness.shard_jobs_pending + liveness.shard_jobs_processing} needsRegen=${needsRegen}`,
          );
        }

        // Dead: neutralize stale failed + revive step
        const neutralized = await neutralizeStaleTransientFailed(sb, pkgId, 120);
        lcNeutralizedCount += neutralized;

        const revived = await reviveLearningContentStepIfDead(sb, pkgId, needsRegen);
        if (revived) {
          lcRevivedCount++;
          actions.push(`LC shard-aware revive: pkg ${pkgId.slice(0, 8)} verdict=${liveness.verdict} needsRegen=${needsRegen} shards(pending=${liveness.shards_pending},total=${liveness.shards_total}) neutralized=${neutralized}`);
        }
      }

      if (lcRevivedCount > 0 || lcDeadlockCount > 0) {
        console.warn(`[watchdog] LC liveness guard v2: revived=${lcRevivedCount} deadlocks=${lcDeadlockCount} neutralized=${lcNeutralizedCount}`);
        try {
          await sb.from("auto_heal_log").insert({
            action_type: "lc_shard_liveness_revive",
            trigger_source: "pipeline-watchdog",
            result_status: "applied",
            result_detail: `Shard-aware liveness: revived=${lcRevivedCount} deadlocks_detected=${lcDeadlockCount} neutralized=${lcNeutralizedCount}`,
            metadata: { lcRevivedCount, lcDeadlockCount, lcNeutralizedCount },
          });
        } catch (_e) { /* best-effort */ }
      }
    } catch (lcErr) {
      console.error("[watchdog] LC liveness guard v2 error:", (lcErr as Error)?.message);
    }

    // ── WIP SOFT ENFORCEMENT (v2: observation-only, no demote) ──
    // With the admission-controlled acquire_v2 fix, the WIP cap is enforced
    // BEFORE promotion. The watchdog now only OBSERVES and logs drift,
    // but does NOT demote packages. Hard-demote caused cancel storms
    // (hundreds of cancelled jobs per hour in a promote→demote→cancel loop).
    //
    // Genuine zombies (building without lease/jobs/steps) are handled by
    // acquire_v2's orphan reclaim and stuck-scan hygiene.
    try {
      const { data: wipRow } = await sb
        .from("ops_pipeline_config")
        .select("value")
        .eq("key", "wip_limit")
        .maybeSingle();
      const wipLimit = wipRow?.value ? Number(JSON.parse(JSON.stringify(wipRow.value))) : 13;

      const { data: buildingPkgsAll } = await sb
        .from("course_packages")
        .select("id, priority, build_progress, updated_at")
        .eq("status", "building")
        .order("priority", { ascending: true })
        .order("build_progress", { ascending: false });

      const allBuilding = buildingPkgsAll || [];
      if (allBuilding.length > wipLimit) {
        // Log the overflow for observability, but do NOT demote.
        // The acquire_v2 fix prevents new promotions when cap is reached.
        // Existing overflow will drain naturally as packages complete.
        const overflow = allBuilding.length - wipLimit;
        console.warn(
          `[watchdog] WIP_OVERFLOW_OBSERVED: ${allBuilding.length}/${wipLimit} building (overflow=${overflow}). ` +
          `No demotion — acquire_v2 admission gate will prevent further promotion.`
        );
        actions.push(
          `WIP overflow observed: ${allBuilding.length}/${wipLimit} (no demotion, draining naturally)`
        );

        try {
          await sb.from("auto_heal_log").insert({
            action_type: "wip_overflow_observed",
            trigger_source: "pipeline-watchdog",
            result_status: "observed",
            result_detail: `WIP overflow: ${allBuilding.length}/${wipLimit} building. No demotion (admission-controlled).`,
            metadata: {
              wip_limit: wipLimit,
              total_building: allBuilding.length,
              overflow,
              building_ids: allBuilding.map((p: any) => (p.id as string).slice(0, 8)),
            },
          });
        } catch (_e) { /* best-effort */ }
      }
    } catch (wipErr) {
      console.error("[watchdog] WIP observer error:", (wipErr as Error)?.message);
    }

    // ── Log cycle ──
    const qgStats = { seen: qgSeenCount, healed: qgHealedCount, skipped: qgSkippedCount };
    try {
      await sb
        .from("auto_heal_log")
        .insert({
          action_type: "pipeline_watchdog_cycle",
          trigger_source: "cron",
          result_status: actions.length > 0 ? "healed" : "noop",
          result_detail: `${actions.length} actions`,
          metadata: {
            actions,
            queued: queuedCount,
            building: buildingCount,
            activeLeases,
            stale_steps: staleSteps.length,
            stale_leases: staleLeases.length,
            zombie_jobs: zombieJobCount,
            zombie_building: healedZombies,
            ghost_steps: ghostCount,
            qg_healed: qgStats,
          },
        });
    } catch (_) { /* non-critical */ }

    console.log(
      `[watchdog] Cycle done: ${actions.length} actions, queued=${queuedCount} building=${buildingCount} leases=${activeLeases}`,
    );

    return json({
      ok: true,
      actions_count: actions.length,
      actions,
      queued: queuedCount,
      building: buildingCount,
      activeLeases,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[watchdog] Error:", msg);
    try {
      await sb
        .from("ops_alerts")
        .insert({
          source: "pipeline-watchdog",
          severity: "error",
          message: `Watchdog crash: ${msg.slice(0, 500)}`,
        });
    } catch (_) { /* can't alert about alert failure */ }
    return json({ ok: false, error: msg }, 500);
  }
});
