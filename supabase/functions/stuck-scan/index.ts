/**
 * stuck-scan v4 – Hardened production watchdog (modular)
 *
 * Orchestrator only — all heavy logic lives in _shared/stuck-scan-*.ts modules.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { safeRpc } from "../_shared/stuck-scan-helpers.ts";
import { detectAndFixZombieSteps } from "../_shared/stuck-scan-zombies.ts";
import { healOrphanProcessing, healEnqueuedDrift, healStatusLag } from "../_shared/stuck-scan-healers.ts";
import { detectEscalationLoops, detectSystemFreeze } from "../_shared/stuck-scan-escalation.ts";
import { checkStuckPackages, checkBuildingOrphans } from "../_shared/stuck-scan-packages.ts";
import { runHygiene, healLeaseNoProgress, sweepPoolMismatches, reviveTransientFailed, healTrueStalls, healLearningContentDeadlocks, healLoopGuardFalsePositives, healIntegrityReportMissing, healTrueStallSteps, reapZombieProcessingJobsV2, reapAncientPendingJobs, healFalseLivenessPackages, healValidateExamPoolLoop } from "../_shared/stuck-scan-hygiene.ts";
import { detectAndMitigateHotLoops } from "../_shared/stuck-scan-hot-loop.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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
    // Load policy
    const { data: policyRow } = await sb
      .from("triage_policy")
      .select("policy_json")
      .eq("is_active", true)
      .maybeSingle();

    const policy = policyRow?.policy_json as Record<string, unknown> | null;
    const stuckConfig = (policy as any)?.production_specific?.stuck_detection ?? {};
    const heartbeatTimeout = stuckConfig.job_processing_heartbeat_timeout_seconds ?? 600;
    const packageTimeout = stuckConfig.package_no_progress_timeout_minutes ?? 90;

    // Job-type-specific stale thresholds
    const JOB_TYPE_STALE_OVERRIDES: Record<string, number> = {
      package_generate_exam_pool: 240,
      package_generate_lessons: 300,
      package_generate_flashcards: 300,
      package_elite_harden: 240,
    };

    // ══ 1) Kill stale processing jobs ══
    const now = Date.now();
    const minThreshold = Math.min(
      heartbeatTimeout,
      ...Object.values(JOB_TYPE_STALE_OVERRIDES).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0),
    );
    const minCutoffIso = new Date(now - minThreshold * 1000).toISOString();

    const { data: processingJobs } = await sb
      .from("job_queue")
      .select("id, package_id, attempts, max_attempts, job_type, worker_pool, locked_at, updated_at, last_heartbeat_at, last_error, meta")
      .eq("status", "processing")
      .or(`last_heartbeat_at.lt.${minCutoffIso},last_heartbeat_at.is.null`);

    const staleJobs = (processingJobs || []).filter((job: any) => {
      const threshold = JOB_TYPE_STALE_OVERRIDES[job.job_type] ?? heartbeatTimeout;
      const cutoff = now - threshold * 1000;
      const refTs = job.last_heartbeat_at || job.updated_at || job.locked_at;
      if (!refTs) return false;
      return new Date(refTs).getTime() < cutoff;
    });

    let staleCount = 0;
    const failedFromStale = 0;

    if (staleJobs.length > 0) {
      const packageIds = [...new Set(staleJobs.map((j: any) => j.package_id).filter(Boolean))];

      const { data: killedJobs } = await safeRpc(sb, "kill_stale_processing_jobs_v2", {
        p_heartbeat_timeout_seconds: heartbeatTimeout,
        p_reason: "stuck-scan: stale processing heartbeat",
        p_requeue: true,
      });
      staleCount = Array.isArray(killedJobs) ? killedJobs.length : staleJobs.length;

      if (staleCount > 0) {
        console.warn(`[stuck-scan] 🔪 Liveness guard killed ${staleCount} stale processing job(s)`);
      }

      for (const pkgId of packageIds) {
        const { data: released } = await safeRpc(sb, "release_stale_package_lease_v2", {
          p_package_id: pkgId,
          p_reason: "stuck-scan: stale processing killed → lease released",
        });
        if (released) {
          console.warn(`[stuck-scan] 🔓 Released stale lease for package ${String(pkgId).slice(0, 8)}`);
        }
      }

      await sb.from("auto_heal_log").insert({
        action_type: "job_liveness_guard",
        trigger_source: "stuck-scan",
        target_type: "job_queue",
        target_id: null,
        result_status: "applied",
        result_detail: `Killed ${staleCount} stale processing jobs, checked ${packageIds.length} package leases`,
        metadata: { killed_count: staleCount, package_ids: packageIds.slice(0, 10), heartbeat_timeout: heartbeatTimeout },
      });
    }

    // ══ 1a2) Zombie completed-but-processing jobs ══
    let zombieCompletedCount = 0;
    try {
      const { data: reaped } = await safeRpc(sb, "reap_zombie_completed_jobs", {
        p_max_age_minutes: 30,
        p_reason: "stuck-scan: completed_at set but still processing",
      });
      zombieCompletedCount = Array.isArray(reaped) ? reaped.length : 0;
      if (zombieCompletedCount > 0) {
        console.warn(`[stuck-scan] 🧟 Reaped ${zombieCompletedCount} zombie completed-but-processing jobs`);
      }
    } catch (e) {
      console.warn(`[stuck-scan] zombie reaper error: ${(e as Error)?.message?.slice(0, 100)}`);
    }

    // ══ 1b) Zombie steps ══
    const zombieResults = await detectAndFixZombieSteps(sb);

    // ══ 1b2) Orphan processing ══
    const orphanResults = await healOrphanProcessing(sb);

    // ══ 1b3) Enqueued drift ══
    const enqueuedDriftResults = await healEnqueuedDrift(sb);

    // ══ 1b4) Status lag ══
    const statusLagResults = await healStatusLag(sb);

    // ══ 1c) Escalation loops ══
    const escalationResults = await detectEscalationLoops(sb);

    // ══ 1d) System freeze ══
    const systemFrozen = await detectSystemFreeze(sb);

    // ══ 2) Stuck packages ══
    const results = await checkStuckPackages(sb, packageTimeout);

    // ══ 3) Building orphans ══
    const buildingPkgResults = await checkBuildingOrphans(sb);

    // ══ 4) Alert ══
    const allStuck = [
      ...results.filter(r => r.reason.includes("Marked stuck")),
      ...buildingPkgResults.filter(o => o.action.includes("stuck")),
      ...escalationResults,
    ];
    if (allStuck.length > 0) {
      await sb.from("admin_notifications").insert({
        title: `${allStuck.length} Package(s) stuck/escalated`,
        body: `Pakete ohne Fortschritt, verwaiste Builds oder Eskalations-Loops erkannt.`,
        category: "ops", severity: "warning",
        metadata: { details: allStuck },
      });
    }

    // ══ 5) Hygiene ══
    const hygieneResult = await runHygiene(sb);
    const leaseNoProgressHealed = await healLeaseNoProgress(sb);
    const poolMismatchFixed = await sweepPoolMismatches(sb);
    const revivedCount = await reviveTransientFailed(sb);
    const trueStallsHealed = await healTrueStalls(sb);
    const deadlockHealed = await healLearningContentDeadlocks(sb);
    const loopGuardFalsePositives = await healLoopGuardFalsePositives(sb);
    const integrityReportMissing = await healIntegrityReportMissing(sb);
    const trueStallStepsHealed = await healTrueStallSteps(sb);

    // ══ 6) Zombie Reaper v2 (age-based, ignores false heartbeats) ══
    const zombieReaperV2Count = await reapZombieProcessingJobsV2(sb);
    const ancientPendingCount = await reapAncientPendingJobs(sb);

    // ══ 7) False-Liveness Guard ══
    const falseLivenessHealed = await healFalseLivenessPackages(sb);

    // ══ 8) Validate Exam Pool Loop → Repair Dispatch ══
    const examPoolLoopRepaired = await healValidateExamPoolLoop(sb);

    console.log(`[stuck-scan] ${results.length} timeout-checked, ${orphanResults.length} orphan-checked, ${buildingPkgResults.length} building-pkg-checked, ${statusLagResults.length} status-lag-healed, ${staleCount} stale jobs killed (liveness guard), ${zombieResults.length} zombie steps fixed, ${escalationResults.length} escalation loops handled, ${revivedCount} transient-failed revived, ${leaseNoProgressHealed} lease-no-progress healed, ${trueStallsHealed.length} true-stalls healed, ${deadlockHealed.length} deadlocks healed, ${loopGuardFalsePositives.length} loop-guard-false-positives healed, ${integrityReportMissing} integrity-report-missing healed, ${trueStallStepsHealed.length} true-stall-steps healed, ${zombieReaperV2Count} zombie-v2 reaped, ${ancientPendingCount} ancient-pending reaped, ${falseLivenessHealed.length} false-liveness healed, ${examPoolLoopRepaired} exam-pool-loops repaired${systemFrozen ? ", ⚫ SYSTEM FREEZE DETECTED" : ""}${poolMismatchFixed > 0 ? `, 🔧 ${poolMismatchFixed} pool mismatches fixed` : ""}`);

    return json({
      ok: true,
      config: { heartbeat_timeout_s: heartbeatTimeout, package_timeout_min: packageTimeout },
      stuck_packages: results,
      orphan_packages: orphanResults,
      building_pkg_results: buildingPkgResults,
      stale_jobs_killed: staleCount,
      stale_jobs_permanently_failed: failedFromStale,
      zombie_steps_fixed: zombieResults,
      escalation_loops: escalationResults,
      system_frozen: systemFrozen,
      hygiene: hygieneResult,
      pool_mismatch_fixed: poolMismatchFixed,
      status_lag_healed: statusLagResults,
      enqueued_drift_healed: enqueuedDriftResults,
      transient_revived: revivedCount,
      lease_no_progress_healed: leaseNoProgressHealed,
      true_stalls_healed: trueStallsHealed,
      deadlock_healed: deadlockHealed,
      loop_guard_false_positives: loopGuardFalsePositives,
      integrity_report_missing_healed: integrityReportMissing,
      true_stall_steps_healed: trueStallStepsHealed,
      zombie_reaper_v2_count: zombieReaperV2Count,
      ancient_pending_reaped: ancientPendingCount,
      false_liveness_healed: falseLivenessHealed,
      exam_pool_loop_repaired: examPoolLoopRepaired,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[stuck-scan] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
