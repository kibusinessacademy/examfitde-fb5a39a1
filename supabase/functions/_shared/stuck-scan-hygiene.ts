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
