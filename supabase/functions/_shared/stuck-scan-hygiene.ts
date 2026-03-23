/**
 * stuck-scan: Hygiene — lease cleanup, pool mismatch sweep, transient revive.
 */
import { safeRpc, type SupabaseClient } from "./stuck-scan-helpers.ts";

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
      if (!meta.loop_guard_blocked) continue;

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
        meta: { loop_guard_reset_at: new Date().toISOString(), integrity_missing_heal_at: new Date().toISOString() },
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
 * Redispatch them by clearing meta and triggering the runner.
 */
export async function healTrueStallSteps(sb: SupabaseClient) {
  const healed: Array<{ package_id: string; step_key: string }> = [];
  try {
    // Find building packages with queued steps
    const { data: candidates } = await sb
      .from("package_steps")
      .select("package_id, step_key, updated_at, meta, last_error")
      .eq("status", "queued")
      .lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString())
      .limit(50);

    for (const step of candidates || []) {
      // Verify package is building
      const { data: pkg } = await sb.from("course_packages")
        .select("id, status").eq("id", step.package_id).eq("status", "building").maybeSingle();
      if (!pkg) continue;

      // Use the DB helper for precise true-stall detection
      const { data: isStall } = await sb.rpc("fn_is_true_stall", {
        p_package_id: step.package_id,
        p_step_key: step.step_key,
        p_stale_minutes: 15,
      });
      if (!isStall) continue;

      // Heal: clean meta, clear last_error, touch updated_at to re-trigger dispatch
      const cleanMeta = { ...(step.meta as Record<string, unknown> ?? {}) };
      delete cleanMeta.loop_guard_blocked;
      cleanMeta.true_stall_healed_at = new Date().toISOString();
      cleanMeta.loop_guard_reset_at = new Date().toISOString();

      await sb.from("package_steps").update({
        status: "queued",
        updated_at: new Date().toISOString(),
        last_error: null,
        meta: cleanMeta,
      }).eq("package_id", step.package_id).eq("step_key", step.step_key);

      healed.push({ package_id: step.package_id, step_key: step.step_key });
      console.warn(`[stuck-scan] 🔄 TRUE_STALL_HEAL: ${step.step_key} for ${step.package_id.slice(0, 8)} — prereqs done, no job, stale >15m. Redispatching.`);

      if (healed.length >= 10) break; // cap per cycle
    }

    if (healed.length > 0) {
      await sb.from("auto_heal_log").insert({
        action_type: "true_stall_step_heal",
        trigger_source: "stuck-scan",
        target_type: "package_steps",
        target_id: null,
        result_status: "applied",
        result_detail: `Healed ${healed.length} true-stall step(s): ${healed.map(h => h.step_key).join(", ")}`,
        metadata: { healed },
      });
    }
  } catch (err) {
    console.warn(`[stuck-scan] true-stall heal error: ${(err as Error).message}`);
  }
  return healed;
}
