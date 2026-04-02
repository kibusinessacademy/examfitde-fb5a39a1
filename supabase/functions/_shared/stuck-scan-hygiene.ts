/**
 * stuck-scan: Hygiene — lease cleanup, pool mismatch sweep, transient revive.
 */
import { safeRpc, type SupabaseClient } from "./stuck-scan-helpers.ts";
import { enqueueJob } from "./enqueue.ts";
import { isRepairActionEligible } from "./repair-eligibility.ts";
import { STEP_TO_JOB_TYPE, getArtifactPriorityBump } from "./job-map.ts";

export async function runHygiene(sb: SupabaseClient) {
  let hygieneResult: Record<string, unknown> = {};
  try {
    const { data: hData, error: hErr } = await sb.rpc("ops_hygiene_cleanup", {
      p_max_lease_cleanup: 50, p_max_job_cleanup: 200,
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
  return hygieneResult;
}

export async function healLeaseNoProgress(sb: SupabaseClient) {
  let healed = 0;
  try {
    const { data: activeLeases } = await sb
      .from("package_leases").select("package_id, runner_id, lease_until")
      .gt("lease_until", new Date().toISOString());

    for (const lease of activeLeases || []) {
      const { data: pkgJobs } = await sb
        .from("job_queue").select("id, status, updated_at, last_heartbeat_at")
        .eq("package_id", lease.package_id).in("status", ["pending", "processing"]);

      const hasAliveWork = (pkgJobs || []).some((j: any) => {
        if (j.status === "pending") return true;
        const refTs = j.last_heartbeat_at || j.updated_at;
        return refTs && new Date(refTs).getTime() > (Date.now() - 10 * 60_000);
      });

      if (!hasAliveWork) {
        const { data: released } = await safeRpc(sb, "release_stale_package_lease_v2", {
          p_package_id: lease.package_id, p_reason: "stuck-scan: lease without alive work",
        });
        if (released) {
          healed++;
          console.warn(`[stuck-scan] 🔓 LEASE_NO_PROGRESS: released lease for ${String(lease.package_id).slice(0, 8)} (no alive work)`);
          await sb.from("auto_heal_log").insert({
            action_type: "lease_no_progress_heal", trigger_source: "stuck-scan",
            target_type: "package_lease", target_id: lease.package_id, result_status: "applied",
            result_detail: `Released lease: no alive processing/pending jobs`,
            metadata: { runner_id: lease.runner_id, total_jobs: (pkgJobs || []).length },
          });
        }
      }
    }
    if (healed > 0) console.log(`[stuck-scan] 🔓 Lease-no-progress healed: ${healed} lease(s) released`);
  } catch (leaseErr) {
    console.warn(`[stuck-scan] Lease-no-progress check error: ${(leaseErr as Error).message}`);
  }
  return healed;
}

export async function sweepPoolMismatches(sb: SupabaseClient) {
  let fixed = 0;
  try {
    const { JOB_DEFINITIONS } = await import("./job-map.ts");
    const contentJobTypes = Object.entries(JOB_DEFINITIONS)
      .filter(([_, def]: [string, any]) => def.pool === "content")
      .map(([k]) => k);

    if (contentJobTypes.length > 0) {
      const { data: mismatched } = await sb
        .from("job_queue").select("id, job_type, worker_pool, meta")
        .eq("status", "pending").eq("worker_pool", "core")
        .in("job_type", contentJobTypes).limit(200);

      if (mismatched && mismatched.length > 0) {
        for (const row of mismatched) {
          const mergedMeta = { ...(row.meta as Record<string, unknown> ?? {}), pool_autofixed: true, old_pool: "core", fixed_by: "stuck-scan-sweep" };
          await sb.from("job_queue").update({
            worker_pool: "content", meta: mergedMeta, updated_at: new Date().toISOString(),
          }).eq("id", row.id);
        }
        fixed += mismatched.length;
        const mismatchJobTypes = [...new Set(mismatched.map(r => r.job_type))];
        console.warn(`[stuck-scan] 🔧 POOL_SWEEP: Fixed ${mismatched.length} job(s) from core→content | types=${mismatchJobTypes.join(",")}`);

        try {
          await sb.from("admin_notifications").insert({
            title: "Pool Mismatch Sweep: jobs auto-fixed",
            body: `${mismatched.length} job(s) were on wrong pool (core instead of content). Auto-fixed. Job types: ${mismatchJobTypes.join(", ")}`,
            category: "ops", severity: "warn",
            metadata: { fixed_count: mismatched.length, job_types: mismatchJobTypes },
          });
        } catch (_e) { /* best-effort */ }
      }
    }
  } catch (sweepErr) {
    console.warn(`[stuck-scan] Pool sweep error: ${(sweepErr as Error).message}`);
  }
  return fixed;
}

export async function reviveTransientFailed(sb: SupabaseClient) {
  let revivedCount = 0;
  try {
    const { data: revived } = await sb.rpc("revive_transient_failed_lesson_jobs", { p_limit: 50 });
    revivedCount = Array.isArray(revived) ? revived.length : 0;
    if (revivedCount > 0) console.log(`[stuck-scan] 🔄 Auto-revived ${revivedCount} transient-failed lesson jobs`);
  } catch (reviveErr) {
    console.warn(`[stuck-scan] revive_transient_failed error: ${(reviveErr as Error).message}`);
  }
  return revivedCount;
}

export async function healTrueStalls(sb: SupabaseClient) {
  let healed: Array<{ package_id: string; step_key: string; job_type: string }> = [];
  try {
    const { data } = await sb.rpc("heal_true_stall_steps", { p_max_heal: 5 });
    healed = Array.isArray(data) ? data : [];
    if (healed.length > 0) {
      console.warn(`[stuck-scan] 🩹 Auto-healed ${healed.length} true-stall step(s): ${healed.map(h => h.step_key).join(", ")}`);
    }
  } catch (err) {
    console.warn(`[stuck-scan] heal_true_stalls error: ${(err as Error).message}`);
  }
  return healed;
}

/**
 * Detect and heal learning-content deadlocks where generate_learning_content
 * is ≥95% complete but stuck in queued, blocking downstream steps.
 */
export async function healLearningContentDeadlocks(sb: SupabaseClient) {
  const healed: Array<{ package_id: string; title: string; completion_ratio: number; action: string }> = [];
  try {
    const { data: candidates } = await sb
      .from("ops_learning_content_deadlock_candidates")
      .select("package_id, title, package_status, generate_status")
      .in("package_status", ["building", "blocked"])
      .limit(20);

    for (const row of candidates || []) {
      try {
        const { data: result } = await sb.rpc("heal_learning_content_deadlock", {
          p_package_id: row.package_id,
          p_completion_threshold: 0.95,
          p_enqueue_regen: true,
        });

        const rows = Array.isArray(result) ? result : [];
        for (const r of rows) {
          if (r.action_taken !== "noop") {
            healed.push({
              package_id: r.package_id,
              title: r.package_title ?? row.title,
              completion_ratio: r.completion_ratio,
              action: r.action_taken,
            });
            console.warn(
              `[stuck-scan] 🩹 DEADLOCK_HEAL: ${row.title?.slice(0, 30)} (${String(row.package_id).slice(0, 8)}) ratio=${r.completion_ratio} action=${r.action_taken}`,
            );
          }
        }
      } catch (healErr) {
        console.warn(`[stuck-scan] deadlock heal error for ${String(row.package_id).slice(0, 8)}: ${(healErr as Error).message}`);
      }
    }

    if (healed.length > 0) {
      await sb.from("auto_heal_log").insert({
        action_type: "learning_content_deadlock_heal",
        trigger_source: "stuck-scan",
        target_type: "package_steps",
        target_id: null,
        result_status: "applied",
        result_detail: `Healed ${healed.length} learning-content deadlock(s)`,
        metadata: { healed },
      });
    }
  } catch (err) {
    console.warn(`[stuck-scan] deadlock heal sweep error: ${(err as Error).message}`);
  }
  return healed;
}

/**
 * Fix 1 (Ops layer): Detect loop-guard false positives where artifacts are fully materialized.
 * If generate_learning_content is blocked by loop guard but content is 100% done,
 * override the block and mark the step as done.
 */
export async function healLoopGuardFalsePositives(sb: SupabaseClient) {
  const healed: Array<{ package_id: string; title: string; ratio: number }> = [];
  try {
    const { data: blocked } = await sb
      .from("package_steps")
      .select("package_id, meta, last_error")
      .eq("step_key", "generate_learning_content")
      .eq("status", "blocked")
      .limit(20);

  for (const step of blocked || []) {
      const meta = (step.meta ?? {}) as Record<string, unknown>;
      // Only process steps actually blocked by loop guard (meta flag or error string)
      if (!meta.loop_guard_blocked && !String(step.last_error ?? "").includes("LOOP_GUARD")) continue;

      try {
        const { data: matRows } = await sb.rpc("fn_package_learning_content_materialized", { p_package_id: step.package_id });
        const mat = Array.isArray(matRows) ? matRows[0] : matRows;
        if (!mat?.materialized) continue;

        // Override: mark step done
        await sb.from("package_steps").update({
          status: "done",
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
          meta: {
            ...meta,
            loop_guard_blocked: false,
            loop_guard_overridden: true,
            loop_guard_override_reason: "stuck-scan: ARTIFACT_SSOT content fully materialized",
            completion_guard: {
              mode: "artifact_ssot_override",
              total_lessons: mat.total_lessons,
              generated_lessons: mat.generated_lessons,
              completion_ratio: Number(mat.completion_ratio),
              resolved_as: "done",
            },
          },
        }).eq("package_id", step.package_id).eq("step_key", "generate_learning_content");

        // Unblock the package if it was blocked by this step
        await sb.from("course_packages").update({
          status: "building",
          blocked_reason: null,
          last_error: null,
        }).eq("id", step.package_id).eq("status", "blocked").ilike("blocked_reason", "%generate_learning_content%");

        const { data: pkg } = await sb.from("course_packages").select("title").eq("id", step.package_id).maybeSingle();
        healed.push({ package_id: step.package_id, title: pkg?.title ?? "?", ratio: Number(mat.completion_ratio) });
        console.warn(`[stuck-scan] 🏗️ LOOP_GUARD_FALSE_POSITIVE: ${pkg?.title?.slice(0, 30)} (${step.package_id.slice(0, 8)}) — content materialized, overriding block`);
      } catch (e) {
        console.warn(`[stuck-scan] loop guard false-positive check error: ${(e as Error).message}`);
      }
    }

    if (healed.length > 0) {
      await sb.from("auto_heal_log").insert({
        action_type: "loop_guard_false_positive_heal",
        trigger_source: "stuck-scan",
        target_type: "package_steps",
        target_id: null,
        result_status: "applied",
        result_detail: `Overrode ${healed.length} loop guard false positive(s) via artifact-SSOT`,
        metadata: { healed },
      });
    }
  } catch (err) {
    console.warn(`[stuck-scan] loop guard false-positive sweep error: ${(err as Error).message}`);
  }
  return healed;
}

/**
 * Fix 2 (Ops layer): Detect integrity_report_version set without integrity_report.
 * Auto-requeue the integrity step instead of leaving package permanently blocked.
 */
export async function healIntegrityReportMissing(sb: SupabaseClient) {
  let healed = 0;
  try {
    const { data: broken } = await sb
      .from("course_packages")
      .select("id, title, integrity_report_version")
      .not("integrity_report_version", "is", null)
      .is("integrity_report", null)
      .in("status", ["building", "blocked", "council_review"])
      .limit(20);

    for (const pkg of broken || []) {
      await sb.from("course_packages").update({
        integrity_report_version: null,
        integrity_passed: false,
      }).eq("id", pkg.id);

      await sb.from("package_steps").update({
        status: "queued",
        started_at: null,
        finished_at: null,
        updated_at: new Date().toISOString(),
        last_error: "AUTO_REQUEUE: integrity_report missing despite version set",
        meta: {
          integrity_consistency_guard_at: new Date().toISOString(),
          integrity_auto_requeue_at: new Date().toISOString(),
          loop_guard_reset_at: new Date().toISOString(),
        },
      }).eq("package_id", pkg.id).eq("step_key", "run_integrity_check").in("status", ["done", "failed"]);

      healed++;
      console.warn(`[stuck-scan] 📋 INTEGRITY_REPORT_MISSING: ${pkg.title?.slice(0, 30)} (${pkg.id.slice(0, 8)}) — version=${pkg.integrity_report_version} but report=NULL, requeued`);
    }

    if (healed > 0) {
      await sb.from("auto_heal_log").insert({
        action_type: "integrity_report_missing_heal",
        trigger_source: "stuck-scan",
        target_type: "course_packages",
        target_id: null,
        result_status: "applied",
        result_detail: `Healed ${healed} package(s) with integrity_report_version set but no report`,
        metadata: { count: healed },
      });
    }
  } catch (err) {
    console.warn(`[stuck-scan] integrity report missing sweep error: ${(err as Error).message}`);
  }
  return healed;
}

/**
 * Fix 3 (Ops layer): Detect true-stall steps (queued, prereqs done, no job, stale).
 * Redispatch them by clearing stale meta and touching the step for re-dispatch.
 */
/**
 * Conservative whitelist: only these steps are eligible for true-stall auto-heal.
 * Steps outside this set may be intentionally queued (e.g. awaiting manual action).
 */
const TRUE_STALL_HEALABLE_STEPS = new Set([
  "validate_learning_content",
  "auto_seed_exam_blueprints",
  "validate_blueprints",
  "validate_exam_pool",
  "build_ai_tutor_index",
  "generate_oral_exam",
  "validate_oral_exam",
  "generate_lesson_minichecks",
  "validate_lesson_minichecks",
  "generate_handbook",
  "validate_handbook",
  "enqueue_handbook_expand",
  "expand_handbook",
  "validate_handbook_depth",
  "elite_harden",
  "run_integrity_check",
  "quality_council",
  "auto_publish",
]);

export async function healTrueStallSteps(sb: SupabaseClient) {
  const healed: Array<{ package_id: string; step_key: string }> = [];

  try {
    const { data: candidates, error: candErr } = await sb
      .from("ops_pipeline_step_drift")
      .select("package_id, step_key, drift_signal, age_minutes, job_type, pkg_status, has_active_job")
      .eq("pkg_status", "building")
      .in("drift_signal", ["PENDING_DISPATCH", "TRUE_STALL"])
      .eq("has_active_job", false)
      .order("age_minutes", { ascending: false })
      .limit(50);

    if (candErr) throw candErr;

    for (const step of candidates || []) {
      if (!TRUE_STALL_HEALABLE_STEPS.has(step.step_key)) continue;

      const minAgeMinutes = step.drift_signal === "PENDING_DISPATCH" ? 2 : 15;
      if ((step.age_minutes ?? 0) < minAgeMinutes) continue;

      const { data: pkg, error: pkgErr } = await sb
        .from("course_packages")
        .select("id, title, status, course_id, curriculum_id, certification_id, feature_flags")
        .eq("id", step.package_id)
        .eq("status", "building")
        .maybeSingle();

      if (pkgErr) {
        console.warn(`[stuck-scan] package lookup failed for ${String(step.package_id).slice(0, 8)}: ${pkgErr.message}`);
        continue;
      }
      if (!pkg) continue;

      const { data: stepRow, error: stepErr } = await sb
        .from("package_steps")
        .select("meta, status")
        .eq("package_id", step.package_id)
        .eq("step_key", step.step_key)
        .maybeSingle();

      if (stepErr || !stepRow || stepRow.status !== "queued") continue;

      if (step.drift_signal === "TRUE_STALL") {
        const { data: isStall, error: stallErr } = await sb.rpc("fn_is_true_stall", {
          p_package_id: step.package_id,
          p_step_key: step.step_key,
          p_stale_minutes: 15,
        });

        if (stallErr) {
          console.warn(`[stuck-scan] fn_is_true_stall failed for ${String(step.package_id).slice(0, 8)} / ${step.step_key}: ${stallErr.message}`);
          continue;
        }
        if (!isStall) continue;
      }

      const cleanMeta = { ...((stepRow.meta ?? {}) as Record<string, unknown>) };
      delete cleanMeta.loop_guard_blocked;
      delete cleanMeta.loop_guard_count;
      delete cleanMeta.last_guard_reason;

      const nowIso = new Date().toISOString();
      cleanMeta.true_stall_healed_at = nowIso;
      cleanMeta.true_stall_healed_by = "stuck-scan";
      cleanMeta.loop_guard_reset_at = nowIso;
      cleanMeta.dispatch_recovered_at = nowIso;
      cleanMeta.dispatch_recovered_reason = step.drift_signal;

      const payload: Record<string, unknown> = {
        package_id: step.package_id,
        course_id: pkg.course_id,
        curriculum_id: pkg.curriculum_id,
        certification_id: pkg.certification_id,
        mode: "auto_heal",
        feature_flags: pkg.feature_flags ?? {},
      };

      if (Array.isArray(cleanMeta.target_lf_ids) && cleanMeta.target_lf_ids.length > 0) {
        payload.target_lf_ids = cleanMeta.target_lf_ids;
      }
      if (cleanMeta.batch_cursor && typeof cleanMeta.batch_cursor === "object") {
        payload.batch_cursor = cleanMeta.batch_cursor as Record<string, unknown>;
      }

      const jobType = step.job_type ?? STEP_TO_JOB_TYPE[step.step_key as keyof typeof STEP_TO_JOB_TYPE];
      if (!jobType) continue;

      let enqueued;
      try {
        enqueued = await enqueueJob(sb, {
          job_type: jobType,
          package_id: step.package_id,
          payload,
          priority: 20 + getArtifactPriorityBump(step.step_key),
          batch_cursor: (cleanMeta.batch_cursor as Record<string, unknown>) ?? null,
        });
      } catch (enqueueErr) {
        console.warn(`[stuck-scan] TRUE_STALL_HEAL enqueue failed for ${String(step.package_id).slice(0, 8)} / ${step.step_key}: ${(enqueueErr as Error).message}`);
        continue;
      }

      const { error: updErr } = await sb
        .from("package_steps")
        .update({
          status: "enqueued",
          job_id: enqueued.id,
          runner_id: "stuck-scan",
          started_at: null,
          finished_at: null,
          updated_at: nowIso,
          last_error: null,
          meta: cleanMeta,
        })
        .eq("package_id", step.package_id)
        .eq("step_key", step.step_key);

      if (updErr) {
        console.warn(`[stuck-scan] TRUE_STALL_HEAL update failed for ${String(step.package_id).slice(0, 8)} / ${step.step_key}: ${updErr.message}`);
        continue;
      }

      healed.push({ package_id: step.package_id, step_key: step.step_key });

      console.warn(
        `[stuck-scan] 🔄 TRUE_STALL_HEAL: ${step.step_key} for ${String(step.package_id).slice(0, 8)} — ${step.drift_signal}, job ${jobType} directly re-enqueued`,
      );

      if (healed.length >= 10) break;
    }

    if (healed.length > 0) {
      const { error: logErr } = await sb.from("auto_heal_log").insert({
        action_type: "true_stall_step_heal",
        trigger_source: "stuck-scan",
        target_type: "package_steps",
        target_id: null,
        result_status: "applied",
        result_detail: `Healed ${healed.length} true-stall step(s)`,
        metadata: { healed },
      });

      if (logErr) {
        console.warn(`[stuck-scan] auto_heal_log insert failed for true-stall heal: ${logErr.message}`);
      }
    }
  } catch (err) {
    console.warn(`[stuck-scan] true-stall heal error: ${(err as Error).message}`);
  }

  return healed;
}

/**
 * Zombie Reaper v2: Kill processing jobs based on hard age cutoff (ignores heartbeat refresh).
 * This prevents the false-liveness pattern where STALE_LOCK_RECOVERY cycles keep refreshing
 * last_heartbeat_at on zombie jobs.
 */
export async function reapZombieProcessingJobsV2(sb: SupabaseClient): Promise<number> {
  try {
    const { data: reaped, error } = await safeRpc(sb, "reap_zombie_processing_jobs_v2", {
      p_max_age_hours: 24,
      p_reason: "stuck-scan: zombie processing (age-based, ignores heartbeat)",
    });
    const count = Array.isArray(reaped) ? reaped.length : 0;
    if (count > 0) {
      console.warn(`[stuck-scan] 🧟‍♂️ ZOMBIE REAPER V2: Killed ${count} processing job(s) older than 24h`);

      // Release leases for affected packages
      const packageIds = [...new Set((reaped as any[]).map((r: any) => r.package_id).filter(Boolean))];
      for (const pkgId of packageIds) {
        await safeRpc(sb, "release_stale_package_lease_v2", {
          p_package_id: pkgId,
          p_reason: "stuck-scan: zombie reaper v2 cleanup",
        });
      }

      await sb.from("auto_heal_log").insert({
        action_type: "zombie_reaper_v2",
        trigger_source: "stuck-scan",
        target_type: "job_queue",
        target_id: null,
        result_status: "applied",
        result_detail: `Killed ${count} zombie processing jobs (age-based)`,
        metadata: { killed: reaped, package_ids: packageIds.slice(0, 20) },
      });
    }
    if (error) {
      console.warn(`[stuck-scan] zombie reaper v2 error: ${error.message}`);
    }
    return count;
  } catch (err) {
    console.warn(`[stuck-scan] zombie reaper v2 threw: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * Ancient Pending Reaper: Cancel pending jobs that have been waiting too long (>48h).
 */
export async function reapAncientPendingJobs(sb: SupabaseClient): Promise<number> {
  try {
    const { data: reaped, error } = await safeRpc(sb, "reap_ancient_pending_jobs", {
      p_max_age_hours: 48,
      p_reason: "stuck-scan: ancient pending job cleanup",
    });
    const count = Array.isArray(reaped) ? reaped.length : 0;
    if (count > 0) {
      console.warn(`[stuck-scan] 📦 ANCIENT PENDING REAPER: Cancelled ${count} pending job(s) older than 48h`);
      await sb.from("auto_heal_log").insert({
        action_type: "ancient_pending_reaper",
        trigger_source: "stuck-scan",
        target_type: "job_queue",
        target_id: null,
        result_status: "applied",
        result_detail: `Cancelled ${count} ancient pending jobs`,
        metadata: { cancelled: reaped },
      });
    }
    if (error) {
      console.warn(`[stuck-scan] ancient pending reaper error: ${error.message}`);
    }
    return count;
  } catch (err) {
    console.warn(`[stuck-scan] ancient pending reaper threw: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * False-Liveness Guard: Release leases and reset building packages that have no real activity.
 * Uses ops_build_activity_truth view to identify false-active packages.
 */
export async function healFalseLivenessPackages(sb: SupabaseClient): Promise<string[]> {
  const healed: string[] = [];
  const normalized: string[] = [];
  const GRACE_MINUTES = 15;

  try {
    const { data: falseActive } = await sb
      .from("ops_build_activity_truth")
      .select("package_id, title, status, fresh_active_jobs, zombie_jobs, running_steps, has_lease, liveness_verdict, last_step_transition_at, last_pipeline_event_at")
      .eq("liveness_verdict", "false_active");

    for (const pkg of (falseActive ?? []) as any[]) {
      // Release lease
      if (pkg.has_lease) {
        await safeRpc(sb, "release_stale_package_lease_v2", {
          p_package_id: pkg.package_id,
          p_reason: "stuck-scan: false-liveness guard — no real activity",
        });
      }

      healed.push(pkg.package_id);
      console.warn(`[stuck-scan] 🎭 FALSE-LIVENESS: ${String(pkg.package_id).slice(0, 8)} "${pkg.title}" — released lease`);

      // ── P0.3: Auto-normalize building+false_active → queued after grace period ──
      if (pkg.status === "building") {
        const lastActivity = pkg.last_step_transition_at || pkg.last_pipeline_event_at;
        const idleMinutes = lastActivity
          ? (Date.now() - new Date(lastActivity).getTime()) / 60_000
          : 999;

        if (idleMinutes >= GRACE_MINUTES) {
          const { error: resetErr } = await sb
            .from("course_packages")
            .update({
              status: "queued",
              updated_at: new Date().toISOString(),
              stuck_reason: null,
            })
            .eq("id", pkg.package_id)
            .eq("status", "building");

          if (!resetErr) {
            normalized.push(pkg.package_id);
            console.warn(`[stuck-scan] 🎭→📦 FALSE-LIVENESS NORMALIZE: ${String(pkg.package_id).slice(0, 8)} "${pkg.title}" — building→queued (idle ${Math.round(idleMinutes)}min)`);
          }
        }
      }
    }

    // Also check no_activity packages that are still building
    const { data: noActivity } = await sb
      .from("ops_build_activity_truth")
      .select("package_id, title, status, last_step_transition_at, last_pipeline_event_at, liveness_verdict")
      .eq("liveness_verdict", "no_activity")
      .eq("status", "building");

    for (const pkg of (noActivity ?? []) as any[]) {
      const lastActivity = pkg.last_step_transition_at || pkg.last_pipeline_event_at;
      const idleMinutes = lastActivity
        ? (Date.now() - new Date(lastActivity).getTime()) / 60_000
        : 999;

      if (idleMinutes >= GRACE_MINUTES) {
        const { error: resetErr } = await sb
          .from("course_packages")
          .update({
            status: "queued",
            updated_at: new Date().toISOString(),
            stuck_reason: null,
          })
          .eq("id", pkg.package_id)
          .eq("status", "building");

        if (!resetErr) {
          normalized.push(pkg.package_id);
          console.warn(`[stuck-scan] 📦 NO-ACTIVITY NORMALIZE: ${String(pkg.package_id).slice(0, 8)} "${pkg.title}" — building→queued (idle ${Math.round(idleMinutes)}min)`);
        }
      }
    }

    if (healed.length > 0) {
      await sb.from("auto_heal_log").insert({
        action_type: "false_liveness_release",
        trigger_source: "stuck-scan",
        target_type: "course_packages",
        target_id: null,
        result_status: "applied",
        result_detail: `Released ${healed.length} false-liveness lease(s)`,
        metadata: { released: healed, grace_minutes: GRACE_MINUTES },
      });
    }
    if (normalized.length > 0) {
      // Separate action types for false_active vs no_activity normalizations
      const falseActiveNormalized = normalized.filter(id => healed.includes(id));
      const noActivityNormalized = normalized.filter(id => !healed.includes(id));
      if (falseActiveNormalized.length > 0) {
        await sb.from("auto_heal_log").insert({
          action_type: "false_liveness_normalize",
          trigger_source: "stuck-scan",
          target_type: "course_packages",
          target_id: null,
          result_status: "applied",
          result_detail: `Normalized ${falseActiveNormalized.length} false-active package(s) building→queued`,
          metadata: { normalized: falseActiveNormalized, grace_minutes: GRACE_MINUTES },
        });
      }
      if (noActivityNormalized.length > 0) {
        await sb.from("auto_heal_log").insert({
          action_type: "no_activity_normalize",
          trigger_source: "stuck-scan",
          target_type: "course_packages",
          target_id: null,
          result_status: "applied",
          result_detail: `Normalized ${noActivityNormalized.length} no-activity package(s) building→queued`,
          metadata: { normalized: noActivityNormalized, grace_minutes: GRACE_MINUTES },
        });
      }
    }
  } catch (err) {
    console.warn(`[stuck-scan] false-liveness guard threw: ${(err as Error).message}`);
  }
  return [...healed, ...normalized];
}

/**
 * Delta-based validate_exam_pool soft-stall recovery.
 * Uses fn_classify_validate_guard to identify soft_stalled packages
 * and dispatches targeted repair instead of blind retry.
 *
 * State machine: healthy → soft_stalled → recovering → healthy → ... → hard_stalled
 */
export async function healValidateExamPoolLoop(sb: SupabaseClient) {
  let repaired = 0;
  try {
    // Find packages where validate_exam_pool needs attention
    const { data: candidates } = await sb
      .from("package_steps")
      .select("package_id, meta, last_error, status")
      .eq("step_key", "validate_exam_pool")
      .in("status", ["failed", "blocked", "queued"])
      .limit(20);

    for (const step of candidates || []) {
      // Use the delta-based classification function
      let classification: Record<string, unknown> | null = null;
      try {
        const { data } = await sb.rpc("fn_classify_validate_guard", {
          p_package_id: step.package_id,
        });
        classification = data as Record<string, unknown> | null;
      } catch (err) {
        console.warn(`[stuck-scan] classify guard failed for ${step.package_id.slice(0, 8)}: ${(err as Error).message}`);
        continue;
      }

      if (!classification) continue;

      const guardState = classification.guard_state as string;
      const action = classification.action as string;
      const reasonCode = classification.reason_code as string | null;

      // Skip healthy or already-recovering packages
      if (guardState === "healthy" || guardState === "recovering") {
        // If step is failed/blocked but guard says healthy, unblock it
        if (step.status === "failed" || step.status === "blocked") {
          await sb.from("package_steps").update({
            status: "queued",
            last_error: null,
            meta: {
              ...(step.meta as Record<string, unknown> ?? {}),
              loop_guard_false_positive_healed_at: new Date().toISOString(),
              guard_state: guardState,
            },
            updated_at: new Date().toISOString(),
          }).eq("package_id", step.package_id).eq("step_key", "validate_exam_pool");

          // Unblock package if loop-guarded
          await sb.from("course_packages").update({
            status: "building",
            blocked_reason: null,
            updated_at: new Date().toISOString(),
          }).eq("id", step.package_id)
            .eq("status", "blocked")
            .ilike("blocked_reason", "%validate_exam_pool%");

          repaired++;
          console.log(`[stuck-scan] ✅ VALIDATE_GUARD_FALSE_POSITIVE: ${step.package_id.slice(0, 8)} unblocked (${guardState})`);
        }
        continue;
      }

      // soft_stalled → enqueue repair
      if (guardState === "soft_stalled" && (action === "enqueue_repair" || action === "requeue_validate")) {
        const { data: pkg } = await sb
          .from("course_packages")
          .select("curriculum_id, title")
          .eq("id", step.package_id)
          .maybeSingle();

        if (action === "enqueue_repair") {
          // P0 GUARD: Check eligibility before dispatching repair
          const eligibility = await isRepairActionEligible(sb, step.package_id, "repair_exam_pool_quality", "stuck-scan-delta-guard");
          if (!eligibility.eligible) {
            console.warn(`[stuck-scan] ❌ REPAIR INELIGIBLE for ${(step.package_id as string).slice(0, 8)}: ${eligibility.reason}`);
            await sb.from("auto_heal_log").insert({
              action_type: "repair_dispatch_blocked",
              trigger_source: "stuck-scan-delta-guard",
              target_type: "package_step",
              target_id: step.package_id,
              result_status: "blocked",
              result_detail: `Repair ineligible: ${eligibility.reason}`,
              metadata: { package_id: step.package_id, guard_state: guardState, reason_code: reasonCode },
            }).catch(() => {});
          } else {
            // Ensure repair step exists
            const { data: repairStep } = await sb
              .from("package_steps")
              .select("id, status")
              .eq("package_id", step.package_id)
              .eq("step_key", "repair_exam_pool_quality")
              .maybeSingle();

            if (!repairStep) {
              await sb.rpc("ensure_package_step", {
                p_package_id: step.package_id,
                p_step_key: "repair_exam_pool_quality",
                p_status: "queued",
              });
            } else if (!["running", "enqueued", "processing"].includes(repairStep.status)) {
              await sb.from("package_steps").update({
                status: "queued",
                updated_at: new Date().toISOString(),
              }).eq("id", repairStep.id);
            }

            // Enqueue repair job
            await enqueueJob(sb, {
              jobType: "package_repair_exam_pool_quality",
              packageId: step.package_id,
              priority: 30,
              payload: {
                curriculum_id: pkg?.curriculum_id,
                triggered_by: "stuck-scan-delta-guard",
                guard_state: guardState,
                reason_code: reasonCode,
              },
            });
          }
        }

        // Set grace period so validate doesn't re-run immediately
        const graceDuration = 20 * 60 * 1000; // 20 minutes
        const stepMeta = (step.meta as Record<string, unknown>) ?? {};
        await sb.from("package_steps").update({
          status: "queued",
          last_error: null,
          meta: {
            ...stepMeta,
            guard_state: guardState,
            stall_reason_code: reasonCode,
            soft_stall_count: (Number(stepMeta.soft_stall_count ?? 0)) + 1,
            last_soft_stall_at: new Date().toISOString(),
            grace_until: new Date(Date.now() + graceDuration).toISOString(),
          },
          updated_at: new Date().toISOString(),
        }).eq("package_id", step.package_id).eq("step_key", "validate_exam_pool");

        // Unblock package if blocked
        await sb.from("course_packages").update({
          status: "building",
          blocked_reason: null,
          updated_at: new Date().toISOString(),
        }).eq("id", step.package_id)
          .eq("status", "blocked")
          .ilike("blocked_reason", "%validate_exam_pool%");

        repaired++;
        console.warn(`[stuck-scan] 🔧 VALIDATE_SOFT_STALL → ${action}: ${pkg?.title?.slice(0, 30)} (${step.package_id.slice(0, 8)}) reason=${reasonCode}`);

        await sb.from("auto_heal_log").insert({
          action_type: "validate_exam_pool_delta_guard_heal",
          trigger_source: "stuck-scan",
          target_type: "package_steps",
          target_id: step.package_id,
          result_status: "applied",
          result_detail: `Guard state: ${guardState}, action: ${action}, reason: ${reasonCode}`,
          metadata: { guard_state: guardState, reason_code: reasonCode, action },
        });
        continue;
      }

      // hard_stalled → deterministic block with clear reason code
      if (guardState === "hard_stalled") {
        const stepMeta = (step.meta as Record<string, unknown>) ?? {};
        await sb.from("package_steps").update({
          status: "failed",
          last_error: `VALIDATE_EXAM_POOL_TRUE_STALL: No progress after multiple repair cycles. Reason: ${reasonCode}`,
          meta: {
            ...stepMeta,
            guard_state: "hard_stalled",
            stall_reason_code: reasonCode,
            hard_stall_count: (Number(stepMeta.hard_stall_count ?? 0)) + 1,
            last_hard_stall_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        }).eq("package_id", step.package_id).eq("step_key", "validate_exam_pool");

        await sb.from("course_packages").update({
          status: "blocked",
          blocked_reason: "VALIDATE_EXAM_POOL_TRUE_STALL",
          last_error: `True stall: ${reasonCode}`,
          updated_at: new Date().toISOString(),
        }).eq("id", step.package_id);

        console.error(`[stuck-scan] 🛑 VALIDATE_HARD_STALL: ${step.package_id.slice(0, 8)} → blocked (${reasonCode})`);

        await sb.from("auto_heal_log").insert({
          action_type: "validate_exam_pool_hard_stall_block",
          trigger_source: "stuck-scan",
          target_type: "package_steps",
          target_id: step.package_id,
          result_status: "blocked",
          result_detail: `Hard stall: ${reasonCode}`,
          metadata: { guard_state: guardState, reason_code: reasonCode },
        });
      }
    }
  } catch (err) {
    console.warn(`[stuck-scan] validate_exam_pool delta-guard heal error: ${(err as Error).message}`);
  }
  return repaired;
}
