import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getFanOutConfig, FAN_OUT_CONFIG, STEP_TO_JOB_TYPE as SSOT_STEP_TO_JOB } from "../_shared/job-map.ts";

/**
 * production-watchdog – Unified proactive health sweep
 *
 * Designed to run every 2-3 minutes via pg_cron.
 * Combines stuck-scan, prebuild-autofix, fan-out sync, and alerting
 * into a single resilient function that ensures zero silent failures.
 *
 * Checks performed:
 * 1. STALE_PROCESSING   – Jobs stuck in "processing" > 10min → reset to pending
 * 2. ORPHAN_BUILDS      – Packages "building" with 0 active jobs → auto-recover or fail
 * 3. FAN_OUT_SYNC       – Packages with all fan-out sub-jobs done but step still "running" → advance
 * 4. DEAD_PACKAGES      – Packages "building" > 2h with no progress → alert + auto-fix
 * 5. MISSING_PREREQS    – Queued packages missing course/curriculum/plan → prebuild-autofix
 * 6. BATCH_CURSOR_LOOP  – Jobs with batch_cursor stuck in infinite re-loop → cap + alert
 * 7. FIRE_FORGET_FAIL   – Packages set to "building" but no jobs ever enqueued → re-trigger
 * 8. BUDGET_ALERT       – Daily AI cost approaching limit → alert
 * 9. QUEUE_HEALTH       – Overall queue metrics + trend alerting
 */

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

interface WatchdogResult {
  check: string;
  action: string;
  count: number;
  details?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const results: WatchdogResult[] = [];
  const alerts: Array<{ title: string; body: string; severity: string; category: string }> = [];
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    // ═══════════════════════════════════════════════════════════
    // 1. STALE PROCESSING JOBS (>10 min without heartbeat)
    // ═══════════════════════════════════════════════════════════
    const staleThreshold = new Date(now.getTime() - 10 * 60_000).toISOString();
    const { data: staleJobs } = await sb
      .from("job_queue")
      .select("id, job_type, provider, locked_at, attempts, max_attempts, payload")
      .eq("status", "processing")
      .lt("locked_at", staleThreshold);

    if (staleJobs && staleJobs.length > 0) {
      // Release provider slots
      for (const sj of staleJobs) {
        if (sj.provider) {
          try { await sb.rpc("release_provider_slot", { p_provider: sj.provider }); } catch { /* ignore */ }
        }
      }

      const staleIds = staleJobs.map((j: { id: string }) => j.id);
      await sb
        .from("job_queue")
        .update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          scheduled_at: new Date(now.getTime() + 30_000).toISOString(),
          last_error: "Watchdog: stale processing reset",
          last_error_code: "STALE_LOCK",
        })
        .in("id", staleIds);

      results.push({ check: "STALE_PROCESSING", action: "reset_to_pending", count: staleJobs.length });

      if (staleJobs.length >= 5) {
        alerts.push({
          title: `⚠️ ${staleJobs.length} Jobs stale (>10min processing)`,
          body: `Job-Typen: ${[...new Set(staleJobs.map((j: { job_type: string }) => j.job_type))].join(", ")}`,
          severity: "warning",
          category: "ops",
        });
      }
    } else {
      results.push({ check: "STALE_PROCESSING", action: "none", count: 0 });
    }

    // ═══════════════════════════════════════════════════════════
    // 2. ORPHAN BUILDS (building + 0 active jobs)
    // ═══════════════════════════════════════════════════════════
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id, title, course_id, build_progress, updated_at, status")
      .eq("status", "building");

    // Grace period: skip packages recently recovered (standard 10min age + 15min recovery grace)
    const { data: recentRecoveries } = await sb
      .from("auto_heal_log")
      .select("target_id")
      .eq("action_type", "recover_and_reenter_package")
      .eq("result_status", "success")
      .gte("created_at", new Date(now.getTime() - 15 * 60_000).toISOString());
    const recoverySet = new Set((recentRecoveries || []).map((r: { target_id: string }) => r.target_id));

    let orphanCount = 0;
    for (const pkg of buildingPkgs || []) {
      // GRACE: Skip if recently recovered or < 10min old
      const pkgAge = now.getTime() - new Date(pkg.updated_at).getTime();
      if (pkgAge < 10 * 60_000 || recoverySet.has(pkg.id)) continue;

      const { count: activeJobs } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "processing"])
        .eq("package_id", pkg.id);

      if ((activeJobs ?? 0) === 0) {
        orphanCount++;

        // Check for retryable failed jobs
        const { data: failedJobs } = await sb
          .from("job_queue")
          .select("id, job_type, attempts, max_attempts")
          .eq("status", "failed")
          .eq("package_id", pkg.id)
          .lt("attempts", 25);

        if (failedJobs && failedJobs.length > 0) {
          // Re-enqueue failed jobs
          for (const fj of failedJobs) {
            await sb.from("job_queue").update({
              status: "pending",
              run_after: new Date(now.getTime() + 10_000).toISOString(),
              locked_at: null,
              locked_by: null,
            }).eq("id", fj.id);
          }
          results.push({
            check: "ORPHAN_BUILD",
            action: "re_enqueued_failed",
            count: failedJobs.length,
            details: { package_id: pkg.id, title: pkg.title },
          });
        } else {
          // No retryable jobs — check how long it's been building
          const buildAge = now.getTime() - new Date(pkg.updated_at).getTime();
          if (buildAge > 2 * 60 * 60_000) {
            // >2h with no jobs → mark failed
            await sb.from("course_packages").update({
              status: "failed",
              stuck_reason: "Watchdog: orphan build >2h, no active/retryable jobs",
            }).eq("id", pkg.id);

            // Clear lock
            await sb.from("course_package_locks").delete().eq("package_id", pkg.id);

            alerts.push({
              title: `🔴 Paket "${pkg.title || pkg.id.slice(0, 8)}" als fehlgeschlagen markiert`,
              body: `Build lief >2h ohne aktive Jobs. Lock wurde entfernt.`,
              severity: "error",
              category: "ops",
            });

            results.push({
              check: "ORPHAN_BUILD",
              action: "marked_failed",
              count: 1,
              details: { package_id: pkg.id, title: pkg.title, age_hours: Math.round(buildAge / 3600_000) },
            });
          } else {
            // <2h — try re-triggering build
            try {
              await sb.from("course_package_locks").delete().eq("package_id", pkg.id);
              const buildUrl = `${SUPABASE_URL}/functions/v1/build-course-package`;
              fetch(buildUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
                body: JSON.stringify({ packageId: pkg.id }),
              }).catch(() => {});

              results.push({
                check: "ORPHAN_BUILD",
                action: "re_triggered_build",
                count: 1,
                details: { package_id: pkg.id, title: pkg.title },
              });
            } catch {
              results.push({
                check: "ORPHAN_BUILD",
                action: "re_trigger_failed",
                count: 1,
                details: { package_id: pkg.id },
              });
            }
          }
        }
      }
    }
    if (orphanCount === 0) {
      results.push({ check: "ORPHAN_BUILD", action: "none", count: 0 });
    }

    // ═══════════════════════════════════════════════════════════
    // 3. FAN-OUT SYNC (SSOT-driven via check_fan_out_completion RPC)
    //    Uses centralized FAN_OUT_CONFIG from job-map.ts
    // ═══════════════════════════════════════════════════════════

    const { data: runningSteps } = await sb
      .from("course_package_build_steps")
      .select("package_id, step_key, status")
      .eq("status", "running");

    let fanOutSynced = 0;
    for (const step of runningSteps || []) {
      const fanOutCfg = getFanOutConfig(step.step_key);
      
      if (fanOutCfg) {
        // Use centralized RPC for fan-out steps
        const { data: completion } = await sb.rpc("check_fan_out_completion", {
          p_package_id: step.package_id,
          p_step_key: step.step_key,
          p_subjob_types: fanOutCfg.subjobTypes,
          p_completion_mode: fanOutCfg.completionMode,
          p_completion_rpc: fanOutCfg.completionRpc ?? null,
        });

        const comp = completion as Record<string, unknown> | null;
        if (!comp) continue;

        const activeCount = Number(comp.active_subjobs ?? 0);
        const failedCount = Number(comp.failed_subjobs ?? 0);

        if (activeCount === 0) {
          if (comp.ok) {
            await sb.rpc("update_course_package_step", {
              p_package_id: step.package_id,
              p_step_key: step.step_key,
              p_status: "done",
              p_log: { synced_by: "production-watchdog", mode: "fan_out_ssot", completion: comp },
            });
            fanOutSynced++;
            console.log(`[Watchdog] FAN_OUT_SYNC: ${step.step_key} for ${step.package_id.slice(0, 8)} → done`);
          } else if (failedCount > 0) {
            await sb.rpc("update_course_package_step", {
              p_package_id: step.package_id,
              p_step_key: step.step_key,
              p_status: "failed",
              p_log: { synced_by: "production-watchdog", failed_jobs: failedCount, completion: comp },
            });
            fanOutSynced++;
            console.log(`[Watchdog] FAN_OUT_SYNC: ${step.step_key} for ${step.package_id.slice(0, 8)} → failed (${failedCount} failed)`);
          }
        }
      } else {
        // Non-fan-out steps: legacy check by job_type
        const jobType = SSOT_STEP_TO_JOB[step.step_key as keyof typeof SSOT_STEP_TO_JOB];
        if (!jobType) continue;

        const { count: activeByType } = await sb
          .from("job_queue")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "processing"])
          .eq("job_type", jobType)
          .eq("package_id", step.package_id);

        if ((activeByType ?? 0) === 0) {
          const { count: failedByType } = await sb
            .from("job_queue")
            .select("id", { count: "exact", head: true })
            .eq("status", "failed")
            .eq("job_type", jobType)
            .eq("package_id", step.package_id);

          if ((failedByType ?? 0) === 0) {
            await sb.rpc("update_course_package_step", {
              p_package_id: step.package_id,
              p_step_key: step.step_key,
              p_status: "done",
              p_log: { synced_by: "production-watchdog", note: "All jobs completed (legacy path)" },
            });
            fanOutSynced++;
          } else {
            await sb.rpc("update_course_package_step", {
              p_package_id: step.package_id,
              p_step_key: step.step_key,
              p_status: "failed",
              p_log: { synced_by: "production-watchdog", failed_jobs: failedByType },
            });
            fanOutSynced++;
          }
        }
      }
    }
    results.push({ check: "FAN_OUT_SYNC", action: fanOutSynced > 0 ? "synced_steps" : "none", count: fanOutSynced });

    // ═══════════════════════════════════════════════════════════
    // 4. BATCH CURSOR INFINITE LOOP PROTECTION
    // ═══════════════════════════════════════════════════════════
    const { data: loopingJobs } = await sb
      .from("job_queue")
      .select("id, job_type, payload, batch_cursor")
      .eq("status", "pending")
      .not("batch_cursor", "is", null);

    let loopsCapped = 0;
    for (const j of loopingJobs || []) {
      const cursor = j.batch_cursor as Record<string, unknown> | null;
      const loopCount = Number(cursor?.loop_count ?? 0);
      if (loopCount >= 5) {
        // Cap at 5 loops — mark as completed with what we have
        await sb.from("job_queue").update({
          status: "completed",
          completed_at: nowIso,
          last_error: `Watchdog: capped at ${loopCount} loops`,
        }).eq("id", j.id);
        loopsCapped++;

        // Also mark the step as done
        const packageId = (j.payload as Record<string, unknown>)?.package_id as string;
        const stepKey = (j.payload as Record<string, unknown>)?.step_key as string;
        if (packageId && stepKey) {
          await sb.rpc("update_course_package_step", {
            p_package_id: packageId,
            p_step_key: stepKey,
            p_status: "done",
            p_log: { note: `Loop-capped at ${loopCount}`, capped_by: "production-watchdog" },
          });
        }
      }
    }
    results.push({ check: "BATCH_LOOP_CAP", action: loopsCapped > 0 ? "capped" : "none", count: loopsCapped });

    // ═══════════════════════════════════════════════════════════
    // 5. FIRE-AND-FORGET FAILURE (building but 0 jobs ever created)
    // ═══════════════════════════════════════════════════════════
    let fireForgetFixed = 0;
    for (const pkg of buildingPkgs || []) {
      // GRACE: Skip if recently recovered or < 10min old
      const ffAge = now.getTime() - new Date(pkg.updated_at).getTime();
      if (ffAge < 10 * 60_000 || recoverySet.has(pkg.id)) continue;

      const { count: totalJobs } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("package_id", pkg.id);

      if ((totalJobs ?? 0) === 0) {
        // Building status but no jobs ever created — fire-and-forget failed silently
        try {
          await sb.from("course_package_locks").delete().eq("package_id", pkg.id);
          const buildUrl = `${SUPABASE_URL}/functions/v1/build-course-package`;
          const res = await fetch(buildUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ packageId: pkg.id }),
          });
          const data = await res.json().catch(() => ({}));
          fireForgetFixed++;

          alerts.push({
            title: `🔧 Fire-and-Forget Recovery: "${pkg.title || pkg.id.slice(0, 8)}"`,
            body: `Build hatte 0 Jobs. Neu gestartet. Ergebnis: ${(data as Record<string, unknown>)?.ok ? "OK" : "Fehler"}`,
            severity: "warning",
            category: "ops",
          });
        } catch (e) {
          alerts.push({
            title: `🔴 Fire-and-Forget Recovery fehlgeschlagen`,
            body: `Paket ${pkg.id.slice(0, 8)}: ${(e as Error).message}`,
            severity: "error",
            category: "ops",
          });
        }
      }
    }
    results.push({ check: "FIRE_FORGET_RECOVERY", action: fireForgetFixed > 0 ? "re_triggered" : "none", count: fireForgetFixed });

    // ═══════════════════════════════════════════════════════════
    // 5b. FAILED PACKAGE AUTO-RECOVERY
    //     Packages in "failed" state where the failed step can be retried
    //     (e.g., integrity_check failed due to fan-out race, but data exists)
    // ═══════════════════════════════════════════════════════════
    const { data: failedPkgs } = await sb
      .from("course_packages")
      .select("id, title, status, stuck_reason")
      .eq("status", "failed")
      .limit(10);

    let failedRecovered = 0;
    for (const pkg of failedPkgs || []) {
      // Get all steps for this package
      const { data: steps } = await sb
        .from("course_package_build_steps")
        .select("step_key, status")
        .eq("package_id", pkg.id);

      if (!steps || steps.length === 0) continue;

      const failedSteps = steps.filter((s: { status: string }) => s.status === "failed");
      const pendingSteps = steps.filter((s: { status: string }) => s.status === "pending");
      const doneSteps = steps.filter((s: { status: string }) => s.status === "done");

      // Case 1: All steps done but package still "failed" → reset to queued
      if (failedSteps.length === 0 && doneSteps.length === steps.length) {
        await sb.from("course_packages").update({
          status: "queued", stuck_reason: null,
        }).eq("id", pkg.id);
        await sb.from("course_package_locks").delete().eq("package_id", pkg.id);
        failedRecovered++;
        console.log(`[Watchdog] FAILED_RECOVERY: ${pkg.id.slice(0, 8)} all steps done → queued`);
        continue;
      }

      // Case 2: Failed step(s) that can be retried — reset to pending
      for (const fs of failedSteps) {
        // Check if there are stuck fan-out jobs blocking this step
        const jobType = STEP_TO_JOB_TYPE[fs.step_key];
        if (jobType) {
          // Clean up stuck pending fan-out jobs (>30min old)
          const staleAge = new Date(now.getTime() - 30 * 60_000).toISOString();
          const { data: stuckFanOut } = await sb
            .from("job_queue")
            .select("id")
            .eq("job_type", jobType)
            .eq("status", "pending")
            .eq("package_id", pkg.id)
            .lt("created_at", staleAge);

          if (stuckFanOut && stuckFanOut.length > 0) {
            await sb.from("job_queue").delete().in("id", stuckFanOut.map((j: { id: string }) => j.id));
            console.log(`[Watchdog] Cleaned ${stuckFanOut.length} stale fan-out jobs for ${pkg.id.slice(0, 8)}/${fs.step_key}`);
          }
        }

        // Reset the failed step to pending
        await sb.rpc("update_course_package_step", {
          p_package_id: pkg.id,
          p_step_key: fs.step_key,
          p_status: "pending",
          p_log: { reset_by: "production-watchdog", note: "Auto-recovery from failed state" },
        });
      }

      // Reset package to queued so pipeline picks it up
      if (failedSteps.length > 0) {
        await sb.from("course_packages").update({
          status: "queued", stuck_reason: null,
        }).eq("id", pkg.id);
        await sb.from("course_package_locks").delete().eq("package_id", pkg.id);
        failedRecovered++;

        alerts.push({
          title: `🔧 Auto-Recovery: "${pkg.title || pkg.id.slice(0, 8)}"`,
          body: `${failedSteps.length} fehlgeschlagene Steps zurückgesetzt: ${failedSteps.map((s: { step_key: string }) => s.step_key).join(", ")}`,
          severity: "info",
          category: "ops",
        });
        console.log(`[Watchdog] FAILED_RECOVERY: ${pkg.id.slice(0, 8)} reset ${failedSteps.length} steps → queued`);
      }
    }
    results.push({ check: "FAILED_RECOVERY", action: failedRecovered > 0 ? "recovered" : "none", count: failedRecovered });

    // ═══════════════════════════════════════════════════════════
    // 6. QUEUED PACKAGES MISSING PREREQS → prebuild-autofix
    // ═══════════════════════════════════════════════════════════
    const { data: queuedPkgs } = await sb
      .from("course_packages")
      .select("id, course_id, certification_id")
      .eq("status", "queued")
      .limit(5);

    let prereqFixed = 0;
    for (const pkg of queuedPkgs || []) {
      if (!pkg.course_id || !pkg.certification_id) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/prebuild-autofix`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ package_id: pkg.id }),
          });
          prereqFixed++;
        } catch { /* non-fatal */ }
      }
    }
    results.push({ check: "QUEUED_PREREQS", action: prereqFixed > 0 ? "autofix_triggered" : "none", count: prereqFixed });

    // ═══════════════════════════════════════════════════════════
    // 7. BUDGET ALERT
    // ═══════════════════════════════════════════════════════════
    const month = nowIso.slice(0, 7);
    const { data: budget } = await sb
      .from("llm_budget")
      .select("budget_eur, spent_eur")
      .eq("month", month)
      .maybeSingle();

    if (budget) {
      const pct = (budget.spent_eur / Math.max(1, budget.budget_eur)) * 100;
      if (pct >= 90) {
        alerts.push({
          title: `🔴 KI-Budget bei ${Math.round(pct)}%`,
          body: `€${budget.spent_eur.toFixed(2)} / €${budget.budget_eur} verbraucht. Produktion könnte gestoppt werden.`,
          severity: "critical",
          category: "finance",
        });
      } else if (pct >= 75) {
        alerts.push({
          title: `⚠️ KI-Budget bei ${Math.round(pct)}%`,
          body: `€${budget.spent_eur.toFixed(2)} / €${budget.budget_eur} verbraucht.`,
          severity: "warning",
          category: "finance",
        });
      }
      results.push({ check: "BUDGET", action: pct >= 75 ? "alert_sent" : "none", count: 0, details: { pct: Math.round(pct) } });
    }

    // ═══════════════════════════════════════════════════════════
    // 8. QUEUE HEALTH SUMMARY
    // ═══════════════════════════════════════════════════════════
    const [pendingRes, processingRes, failedRes, completedRes] = await Promise.all([
      sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
      sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
      sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "completed")
        .gte("completed_at", new Date(now.getTime() - 3600_000).toISOString()),
    ]);

    const queueHealth = {
      pending: pendingRes.count ?? 0,
      processing: processingRes.count ?? 0,
      failed: failedRes.count ?? 0,
      completed_1h: completedRes.count ?? 0,
    };

    // Alert if failure rate is high
    const total1h = queueHealth.completed_1h + (failedRes.count ?? 0);
    const failRate = total1h > 0 ? (failedRes.count ?? 0) / total1h : 0;
    if (failRate > 0.3 && total1h > 5) {
      alerts.push({
        title: `🔴 Hohe Fehlerrate: ${Math.round(failRate * 100)}%`,
        body: `${failedRes.count} fehlgeschlagen von ${total1h} Jobs in der letzten Stunde.`,
        severity: "critical",
        category: "ops",
      });
    }

    results.push({ check: "QUEUE_HEALTH", action: "measured", count: 0, details: queueHealth });

    // ═══════════════════════════════════════════════════════════
    // 9. WRITE ALERTS (deduplicated by title, max 1 per hour)
    // ═══════════════════════════════════════════════════════════
    const oneHourAgo = new Date(now.getTime() - 3600_000).toISOString();
    for (const alert of alerts) {
      // Deduplicate: skip if same title was sent in last hour
      const { count: existing } = await sb
        .from("admin_notifications")
        .select("id", { count: "exact", head: true })
        .eq("title", alert.title)
        .gte("created_at", oneHourAgo);

      if ((existing ?? 0) === 0) {
        await sb.from("admin_notifications").insert({
          title: alert.title,
          body: alert.body,
          severity: alert.severity,
          category: alert.category,
          metadata: { source: "production-watchdog", timestamp: nowIso },
        });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // 10. LOG TO AUTO_HEAL_LOG for audit trail
    // ═══════════════════════════════════════════════════════════
    const totalActions = results.reduce((s, r) => s + (r.action !== "none" && r.action !== "measured" ? r.count : 0), 0);
    if (totalActions > 0) {
      await sb.from("auto_heal_log").insert({
        action_type: "production_watchdog",
        trigger_source: "cron",
        target_type: "system",
        target_id: "global",
        result_status: "success",
        result_detail: JSON.stringify({ results, alerts_sent: alerts.length }),
        metadata: { total_actions: totalActions, checks: results.length },
      });
    }

    const summary = results.filter(r => r.action !== "none" && r.action !== "measured");
    console.log(
      `[Watchdog] ${summary.length} actions taken, ${alerts.length} alerts sent. ` +
      summary.map(r => `${r.check}:${r.count}`).join(", ")
    );

    return json({
      ok: true,
      timestamp: nowIso,
      total_actions: totalActions,
      alerts_sent: alerts.length,
      results,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[Watchdog] Fatal:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
