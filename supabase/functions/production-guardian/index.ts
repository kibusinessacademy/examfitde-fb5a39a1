import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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

interface ProviderRow {
  provider: string;
  status: string;
  current_slots: number;
  max_slots: number;
  cooldown_seconds: number;
  priority: number;
  reliability_7d: number;
  error_streak: number;
  last_error_at: string | null;
}

/**
 * production-guardian – runs every 20 min via pg_cron
 *
 * Goals:
 * 1. Unstick stuck/processing jobs
 * 2. Re-queue failed packages (max 2 retries)
 * 3. Auto-trigger package-queue-next when pipeline is idle
 * 4. Process pending curriculum content jobs
 * 5. Provider health management
 * 6. Pipeline lock cleanup
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    // ═══════════════════════════════════════════════════════════════
    // 1. FIX STUCK PROCESSING JOBS (>15 min)
    // ═══════════════════════════════════════════════════════════════
    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: stuckJobs } = await sb
      .from("job_queue")
      .select("id, job_type, attempts, max_attempts")
      .eq("status", "processing")
      .lt("started_at", fifteenMinAgo)
      .limit(20);

    for (const job of stuckJobs ?? []) {
      const maxAttempts = job.max_attempts ?? 5;
      if ((job.attempts ?? 0) >= maxAttempts) {
        await sb.from("job_queue")
          .update({ status: "failed", error: "Guardian: max attempts after stuck" })
          .eq("id", job.id);
        actions.push(`Failed stuck job ${job.job_type} (max attempts)`);
      } else {
        await sb.from("job_queue")
          .update({ status: "pending", started_at: null })
          .eq("id", job.id);
        actions.push(`Reset stuck job ${job.job_type} → pending`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. RESET EXCESSIVE ATTEMPT COUNTS ON PENDING JOBS
    // ═══════════════════════════════════════════════════════════════
    const { data: highAttemptJobs } = await sb
      .from("job_queue")
      .select("id, job_type, attempts")
      .eq("status", "pending")
      .gt("attempts", 10)
      .limit(50);

    for (const job of highAttemptJobs ?? []) {
      await sb.from("job_queue").update({ attempts: 0 }).eq("id", job.id);
      actions.push(`Reset attempts ${job.job_type}: ${job.attempts} → 0`);
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. PIPELINE LOCK CLEANUP (legacy — lease-based now)
    // ═══════════════════════════════════════════════════════════════
    // The pipeline now uses package_leases for concurrency control.
    // Only clean the legacy lock if it's stale — but do NOT mark packages
    // as failed based on lock alone (the runner uses leases, not locks).
    const { data: lock } = await sb
      .from("pipeline_lock")
      .select("id, active_package_id, locked_at, heartbeat_at")
      .eq("id", 1)
      .maybeSingle();

    let pipelineIdle = !lock?.active_package_id;

    if (lock?.active_package_id && lock.locked_at) {
      const lockAge = Date.now() - new Date(lock.locked_at).getTime();
      const heartbeatAge = lock.heartbeat_at
        ? Date.now() - new Date(lock.heartbeat_at).getTime()
        : lockAge;

      // Stale if no heartbeat for 15 min — only release lock, do NOT mark package failed
      // (the lease system handles package lifecycle now)
      if (heartbeatAge > 15 * 60_000) {
        // Release the stale lock only
        await sb.from("pipeline_lock")
          .update({ active_package_id: null, locked_at: null, heartbeat_at: null, locked_by: null })
          .eq("id", 1);

        actions.push(`Cleared stale legacy lock (${Math.round(heartbeatAge / 60_000)}min no heartbeat) — pkg ${lock.active_package_id.slice(0, 8)} NOT marked failed (lease-based now)`);
        pipelineIdle = true;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 3b. LEASE-AWARE STALE PACKAGE DETECTION
    // ═══════════════════════════════════════════════════════════════
    // Packages in 'building' with no active lease AND no active jobs
    // are genuinely stuck — mark them as failed.
    // The RPC uses priority-aware dynamic thresholds (30min–6h).
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id, title, updated_at")
      .eq("status", "building")
      .order("updated_at", { ascending: true })
      .limit(20);

    for (const bPkg of buildingPkgs ?? []) {
      // The RPC handles all threshold logic (priority-aware, grace-aware, queued-step-aware)
      // Pass a low base min_age; the RPC will compute the real dynamic threshold
      const { data: failResult } = await sb.rpc("guardian_fail_package_if_stale", {
        p_package_id: bPkg.id,
        p_min_age_minutes: 15,
      });

      const fr = failResult as Record<string, unknown> | null;
      const applied = fr?.applied === true;

      // Structured log for forensics — always log
      try {
        await sb.from("auto_heal_log").insert({
          action_type: "guardian_stale_fail",
          target_type: "course_package",
          target_id: bPkg.id,
          trigger_source: "production-guardian",
          result_status: applied ? "applied" : "skipped",
          result_detail: JSON.stringify(fr),
          metadata: fr,
        });
      } catch (_e) { /* non-critical */ }

      if (applied) {
        actions.push(`fail pkg ${bPkg.id.slice(0, 8)}: age=${fr?.age_min}m lease=${fr?.active_leases} jobs=${fr?.active_jobs} steps=${fr?.active_steps}`);
      } else {
        actions.push(`skip-fail pkg ${bPkg.id.slice(0, 8)}: guarded (lease=${fr?.active_leases} jobs=${fr?.active_jobs} steps=${fr?.active_steps})`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. RE-QUEUE FAILED PACKAGES (auto-retry up to 2 times)
    // ═══════════════════════════════════════════════════════════════
    const { data: failedPkgs } = await sb
      .from("course_packages")
      .select("id, title, retry_count, course_id")
      .eq("status", "failed")
      .order("updated_at", { ascending: true })
      .limit(5);

    for (const pkg of failedPkgs ?? []) {
      const retries = (pkg as any).retry_count ?? 0;
      if (retries < 2) {
        // Check the package has a valid course with curriculum
        const { data: courseCheck } = await sb
          .from("courses")
          .select("curriculum_id")
          .eq("id", pkg.course_id)
          .maybeSingle();

        if (courseCheck?.curriculum_id) {
          // Check if there are queued steps — if so, just re-enable building
          // Don't blindly reset all jobs (the steps may be partially done)
          const { count: queuedSteps } = await sb
            .from("package_steps")
            .select("*", { count: "exact", head: true })
            .eq("package_id", pkg.id)
            .eq("status", "queued");

          if ((queuedSteps ?? 0) > 0) {
            // Has queued steps — just flip back to building, pipeline-runner will pick up
            await sb.from("course_packages")
              .update({
                status: "building",
                retry_count: retries + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", pkg.id);

            actions.push(`Re-enabled building for failed pkg "${pkg.title}" (${queuedSteps} queued steps, retry ${retries + 1}/2)`);
          } else {
            // No queued steps — needs full re-queue via build-course-package
            // Reset failed jobs via RPC (deterministic JSONB extract)
            const { data: resetCount } = await sb.rpc("reset_failed_jobs_for_package", {
              p_package_id: pkg.id,
              p_job_types: null,
            });

            await sb.from("course_packages")
              .update({
                status: "queued",
                retry_count: retries + 1,
                build_progress: 0,
                updated_at: new Date().toISOString(),
              })
              .eq("id", pkg.id);

            actions.push(`Re-queued failed pkg "${pkg.title}" (no queued steps, retry ${retries + 1}/2)`);
          }
        } else {
          warnings.push(`Failed pkg "${pkg.title}" has no curriculum – skipping retry`);
        }
      }
    }
    // ═══════════════════════════════════════════════════════════════
    // 4b. RE-CHECK QA_FAILED PACKAGES (auto-retry quality council)
    // ═══════════════════════════════════════════════════════════════
    const { data: qaFailedPkgs } = await sb
      .from("course_packages")
      .select("id, course_id, updated_at")
      .eq("status", "qa_failed")
      .order("updated_at", { ascending: true })
      .limit(3);

    for (const qaPkg of qaFailedPkgs ?? []) {
      // Check if content was regenerated after the QA report
      const { data: qaReport } = await sb
        .from("package_quality_reports")
        .select("created_at")
        .eq("package_id", qaPkg.id)
        .maybeSingle();

      const reportAge = qaReport?.created_at ? Date.now() - new Date(qaReport.created_at).getTime() : Infinity;
      const pkgUpdateAge = Date.now() - new Date(qaPkg.updated_at).getTime();

      // Re-check if: report is older than 30 min AND package was updated after report
      if (qaReport && reportAge > 30 * 60_000 && pkgUpdateAge < reportAge) {
        // Delete old report so quality council runs fresh
        await sb.from("package_quality_reports").delete().eq("package_id", qaPkg.id);
        // Re-queue quality council
        await sb.from("job_queue").insert({
          job_type: "package_quality_council",
          status: "pending",
          package_id: qaPkg.id,
          attempts: 0,
          max_attempts: 3,
          payload: { package_id: qaPkg.id, course_id: qaPkg.course_id, retry_from: "guardian_qa_retry" },
          run_after: new Date().toISOString(),
        });
        // Set package back to building so auto-publish can pick it up
        await sb.from("course_packages")
          .update({ status: "building", updated_at: new Date().toISOString() })
          .eq("id", qaPkg.id);
        actions.push(`Re-triggered QA for qa_failed pkg ${qaPkg.id.slice(0, 8)} (content updated since last report)`);
      } else if (!qaReport) {
        // No report at all — just re-trigger
        await sb.from("job_queue").insert({
          job_type: "package_quality_council",
          status: "pending",
          package_id: qaPkg.id,
          attempts: 0,
          max_attempts: 3,
          payload: { package_id: qaPkg.id, course_id: qaPkg.course_id, retry_from: "guardian_qa_retry" },
          run_after: new Date().toISOString(),
        });
        await sb.from("course_packages")
          .update({ status: "building", updated_at: new Date().toISOString() })
          .eq("id", qaPkg.id);
        actions.push(`QA retry for pkg ${qaPkg.id.slice(0, 8)} (no report found)`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. AUTO-TRIGGER PIPELINE (if idle + queued packages exist)
    //    + STALL DETECTION → ops_alerts
    // ═══════════════════════════════════════════════════════════════
    const { count: queuedCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued");

    const { count: buildingCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "building");

    // Stall detection: queued > 0 BUT nothing building AND no active slots
    let activeSlotsNow: string[] = [];
    try {
      const rpcResult = await sb.rpc("get_active_pipeline_packages");
      if (!rpcResult.error && rpcResult.data) {
        activeSlotsNow = rpcResult.data as string[];
      }
    } catch (_) {
      // RPC may not exist — fall back to lease count
      const { data: leaseData } = await sb.from("package_leases")
        .select("package_id")
        .gt("lease_until", new Date().toISOString());
      activeSlotsNow = (leaseData ?? []).map((r: any) => r.package_id);
    }

    const isStalled = (queuedCount ?? 0) > 0 && (buildingCount ?? 0) === 0 && activeSlotsNow.length === 0;
    const isHealthy = !isStalled && ((buildingCount ?? 0) > 0 || activeSlotsNow.length > 0);

    // Auto-resolve stale PIPELINE_STALLED alerts if pipeline is healthy again
    if (isHealthy) {
      try {
        await sb.from("ops_alerts")
          .update({ acknowledged_at: new Date().toISOString() })
          .eq("source", "production-guardian")
          .is("acknowledged_at", null)
          .ilike("message", "%PIPELINE_STALLED%");
      } catch (_) { /* non-critical */ }
    }

    if (isStalled) {
      // Dedupe: only alert if no open stall alert in last 10 minutes
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data: recentStall } = await sb.from("ops_alerts")
        .select("id")
        .eq("source", "production-guardian")
        .is("acknowledged_at", null)
        .gte("created_at", tenMinAgo)
        .ilike("message", "%PIPELINE_STALLED%")
        .limit(1);

      if (!recentStall || recentStall.length === 0) {
        await sb.from("ops_alerts").insert({
          source: "production-guardian",
          severity: "warning",
          message: `PIPELINE_STALLED: ${queuedCount} packages queued but 0 building, 0 slots active`,
          payload: { queued: queuedCount, building: buildingCount, active_slots: activeSlotsNow.length },
        });
        warnings.push(`STALL DETECTED: ${queuedCount} queued, 0 building, 0 slots`);
      } else {
        console.log("[guardian] Stall detected but alert deduped (open recent alert exists).");
      }
    }

    if (pipelineIdle || ((queuedCount ?? 0) > 0 && (buildingCount ?? 0) === 0)) {
      if ((queuedCount ?? 0) > 0) {
        // Fire package-queue-next to pick up the next package
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/package-queue-next`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ triggered_by: "production-guardian" }),
          });
          const data = await res.json();
          if (data.started_package_id) {
            actions.push(`Triggered build for package ${data.started_package_id.slice(0, 8)}`);
          } else if (data.skipped) {
            actions.push(`Queue-next skipped: ${data.reason}`);
          }
        } catch (e) {
          warnings.push(`Failed to trigger package-queue-next: ${(e as Error).message}`);
        }
      } else {
        actions.push("Pipeline idle, no queued packages");
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 6. PROCESS PENDING CURRICULUM + SETUP JOBS (batch trigger)
    // ═══════════════════════════════════════════════════════════════
    const pipelineJobTypes = ["generate_curriculum_content", "setup_course_package"];

    // Also trigger freeze-priority: if many drafts remain, boost curriculum content jobs
    const { count: draftCount } = await sb
      .from("curricula")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft");

    const dc = draftCount ?? 0;

    const { count: frozenCount } = await sb
      .from("curricula")
      .select("id", { count: "exact", head: true })
      .eq("status", "frozen");

    const batchSize = dc > 200 ? 60 : dc > 100 ? 40 : 25;

    const { count: pendingPipelineJobs } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .in("job_type", pipelineJobTypes);

    if ((pendingPipelineJobs ?? 0) > 0) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/job-runner`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            job_types: pipelineJobTypes,
            max_jobs: batchSize,
            triggered_by: "production-guardian",
          }),
        });
        const data = await res.json();
        actions.push(`Triggered job-runner for ${pendingPipelineJobs} pending pipeline jobs (content+setup): ${JSON.stringify(data).slice(0, 120)}`);
      } catch (e) {
        warnings.push(`Job-runner trigger failed: ${(e as Error).message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. PROVIDER HEALTH MANAGEMENT
    // ═══════════════════════════════════════════════════════════════
    const { data: providers } = await sb
      .from("provider_status")
      .select("*") as { data: ProviderRow[] | null };

    for (const p of providers ?? []) {
      // Throttle high-error providers
      if (p.error_streak >= 5 && p.current_slots > 1) {
        const newSlots = Math.max(1, Math.floor(p.current_slots / 2));
        await sb.from("provider_status")
          .update({
            current_slots: newSlots,
            cooldown_seconds: Math.min(300, p.cooldown_seconds + 30),
            status: "degraded",
          })
          .eq("provider", p.provider);
        actions.push(`Throttled ${p.provider}: slots→${newSlots}`);
      }

      // Recover healthy providers
      if (p.status === "healthy" && p.error_streak === 0 && p.reliability_7d > 0.8 && p.current_slots < p.max_slots) {
        const newSlots = Math.min(p.max_slots, p.current_slots + 1);
        await sb.from("provider_status")
          .update({ current_slots: newSlots, cooldown_seconds: Math.max(30, p.cooldown_seconds - 10) })
          .eq("provider", p.provider);
        actions.push(`Recovered ${p.provider}: slots→${newSlots}`);
      }

      // Revive down providers after 10 min cooldown
      if (p.status === "down" && p.last_error_at) {
        if (Date.now() - new Date(p.last_error_at).getTime() > 10 * 60_000) {
          await sb.from("provider_status")
            .update({ status: "degraded", error_streak: 0, current_slots: 1, cooldown_seconds: 120 })
            .eq("provider", p.provider);
          actions.push(`Revived ${p.provider}: down→degraded`);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 8. ADAPTIVE COST GUARD (daily + monthly budget enforcement)
    // ═══════════════════════════════════════════════════════════════
    const today = new Date().toISOString().slice(0, 10);
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Monthly budget check
    const { data: monthlyBudget } = await sb
      .from("llm_budget")
      .select("budget_eur, spent_eur, hard_stop")
      .eq("month", currentMonth)
      .maybeSingle();

    if (monthlyBudget) {
      const spentPct = monthlyBudget.budget_eur > 0
        ? (monthlyBudget.spent_eur / monthlyBudget.budget_eur) * 100
        : 0;

      if (spentPct >= 90 && !monthlyBudget.hard_stop) {
        // Enable hard stop at 90% budget
        await sb.from("llm_budget")
          .update({ hard_stop: true, updated_at: new Date().toISOString() })
          .eq("month", currentMonth);
        warnings.push(`Budget Guard: €${monthlyBudget.spent_eur.toFixed(2)}/€${monthlyBudget.budget_eur} (${spentPct.toFixed(0)}%) → HARD STOP enabled`);

        await sb.from("admin_notifications").insert({
          title: `🚨 LLM Budget: ${spentPct.toFixed(0)}% verbraucht – Hard Stop aktiv`,
          body: `Monat ${currentMonth}: €${monthlyBudget.spent_eur.toFixed(2)} / €${monthlyBudget.budget_eur}. Neue LLM-Jobs werden blockiert.`,
          category: "ops",
          severity: "critical",
        });
      } else if (spentPct >= 70) {
        warnings.push(`Budget Guard: €${monthlyBudget.spent_eur.toFixed(2)}/€${monthlyBudget.budget_eur} (${spentPct.toFixed(0)}%) – nähert sich Limit`);
      }

      // Auto-reset hard_stop on new month
      if (spentPct < 50 && monthlyBudget.hard_stop) {
        await sb.from("llm_budget")
          .update({ hard_stop: false, updated_at: new Date().toISOString() })
          .eq("month", currentMonth);
        actions.push(`Budget Guard: Hard stop released (${spentPct.toFixed(0)}% spent)`);
      }
    }

    // Daily worker policy check
    const { data: usageToday } = await sb
      .from("ai_worker_usage_daily")
      .select("job_type, runs, errors, cost_eur")
      .eq("date", today);

    const { data: policies } = await sb
      .from("ai_worker_policies")
      .select("job_type, enabled, pause_on_error_rate, max_cost_eur_per_day");

    const usageMap = new Map((usageToday ?? []).map((u: any) => [u.job_type, u]));

    for (const pol of policies ?? []) {
      const usage = usageMap.get(pol.job_type);
      if (!usage) continue;
      const errRate = usage.runs > 4 ? usage.errors / usage.runs : 0;

      // Cost guard per job type
      if (usage.cost_eur >= pol.max_cost_eur_per_day && pol.enabled) {
        await sb.from("ai_worker_policies").update({ enabled: false }).eq("job_type", pol.job_type);
        warnings.push(`Cost Guard: Paused ${pol.job_type} (€${usage.cost_eur.toFixed(2)} >= €${pol.max_cost_eur_per_day}/day)`);
      }

      if (errRate >= pol.pause_on_error_rate && pol.enabled) {
        await sb.from("ai_worker_policies").update({ enabled: false }).eq("job_type", pol.job_type);
        warnings.push(`Paused ${pol.job_type}: err ${(errRate * 100).toFixed(0)}%`);
      }

      if (!pol.enabled && errRate < pol.pause_on_error_rate * 0.5 && usage.cost_eur < pol.max_cost_eur_per_day * 0.8) {
        await sb.from("ai_worker_policies").update({ enabled: true }).eq("job_type", pol.job_type);
        actions.push(`Re-enabled ${pol.job_type}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 9. STALE SLOT CLEANUP
    // ═══════════════════════════════════════════════════════════════
    const { data: activeSlots } = await sb.rpc("get_active_pipeline_packages");
    const slotList = (activeSlots as string[] | null) ?? [];

    for (const slotPkgId of slotList) {
      const { data: pkgStatus } = await sb
        .from("course_packages")
        .select("status")
        .eq("id", slotPkgId)
        .maybeSingle();

      if (pkgStatus && !["building", "queued"].includes(pkgStatus.status)) {
        await sb.rpc("release_pipeline_slot", { p_package_id: slotPkgId });
        actions.push(`Released stale slot for pkg ${slotPkgId.slice(0, 8)} (status: ${pkgStatus.status})`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 9.5 DEADLOCK RECOVERY (step-0 stuck + stale heartbeats)
    // ═══════════════════════════════════════════════════════════════
    // A) Auto-fail packages stuck at step 0 with empty step_status_json
    try {
      const { data: recoveredPkgs } = await sb.rpc("recover_stuck_packages", {
        p_age_minutes: 15,
        p_limit: 10,
      });
      for (const r of recoveredPkgs ?? []) {
        actions.push(`🔧 Auto-recovered deadlocked pkg ${String(r.package_id).slice(0, 8)} → ${r.action}`);
      }
    } catch (e) {
      warnings.push(`recover_stuck_packages RPC failed: ${(e as Error).message}`);
    }

    // B) Release slots with stale heartbeats (no heartbeat for 10 min)
    try {
      const { data: staleCount } = await sb.rpc("release_stale_slots", {
        p_age_minutes: 10,
      });
      if ((staleCount ?? 0) > 0) {
        actions.push(`🔧 Released ${staleCount} stale pipeline slots (heartbeat timeout)`);
      }
    } catch (e) {
      warnings.push(`release_stale_slots RPC failed: ${(e as Error).message}`);
    }

    // C) Building packages without active slots → reclaim or fail
    const { data: buildingPkgs2 } = await sb
      .from("course_packages")
      .select("id, course_id, current_step, updated_at")
      .eq("status", "building");

    for (const bPkg of buildingPkgs2 ?? []) {
      const isInSlot = slotList.includes(bPkg.id);
      if (!isInSlot) {
        const buildAge = Date.now() - new Date(bPkg.updated_at).getTime();
        if (buildAge > 10 * 60_000) {
          // If still at step 0, fail it outright (init never happened)
          if (((bPkg as any).current_step ?? 0) === 0) {
            // Use centralized SSOT RPC — never fail without checking guards
            const { data: failRes } = await sb.rpc("guardian_fail_package_if_stale", {
              p_package_id: bPkg.id,
              p_min_age_minutes: 10,
            });
            const orphanApplied = (failRes as any)?.applied === true;
            actions.push(orphanApplied
              ? `🔧 Failed orphaned step-0 pkg ${bPkg.id.slice(0, 8)} (no slot, never initialized)`
              : `⏭️ Skip orphan-fail pkg ${bPkg.id.slice(0, 8)}: guarded (lease=${(failRes as any)?.active_leases} jobs=${(failRes as any)?.active_jobs} steps=${(failRes as any)?.active_steps})`);
          } else {
            // Has progress → reclaim slot
            try {
              await sb.from("pipeline_active_packages").upsert(
                { package_id: bPkg.id, claimed_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() },
                { onConflict: "package_id" }
              );
              actions.push(`🔧 Reclaimed slot for orphaned building pkg ${bPkg.id.slice(0, 8)}`);

              const { data: resetCount2 } = await sb.rpc("reset_failed_jobs_for_package", {
                p_package_id: bPkg.id,
                p_job_types: ["package_run_integrity_check", "package_auto_publish"],
              });
              actions.push(`Reset ${resetCount2 ?? 0} failed integrity/autopublish jobs for pkg ${bPkg.id.slice(0, 8)}`);
            } catch (e) {
              warnings.push(`Failed to reclaim slot for ${bPkg.id.slice(0, 8)}: ${(e as Error).message}`);
            }
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 10. ADAPTIVE AUTO-SCALING (429/timeout-driven WIP + concurrency)
    // ═══════════════════════════════════════════════════════════════
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();

    // Count recent 429/rate-limit errors
    const { count: rateLimitErrors } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("completed_at", tenMinAgo)
      .ilike("last_error", "%rate%limit%");

    const { count: timeoutErrors } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("completed_at", tenMinAgo)
      .ilike("last_error", "%timeout%");

    const { count: recentCompleted } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("completed_at", tenMinAgo);

    const rlErrors = rateLimitErrors ?? 0;
    const toErrors = timeoutErrors ?? 0;
    const recentOk = recentCompleted ?? 0;
    const totalRecent = recentOk + rlErrors + toErrors;
    const errorRate = totalRecent > 5 ? (rlErrors + toErrors) / totalRecent : 0;

    // Read current capacity
    const { data: capacity } = await sb
      .from("pipeline_capacity")
      .select("max_wip, min_wip")
      .eq("id", true)
      .maybeSingle();

    const currentMaxWip = capacity?.max_wip ?? 2;
    const minWip = capacity?.min_wip ?? 1;
    let newMaxWip = currentMaxWip;
    const scalingReason: Record<string, unknown> = {
      error_rate: +(errorRate * 100).toFixed(1),
      rate_limit_errors_10m: rlErrors,
      timeout_errors_10m: toErrors,
      completed_10m: recentOk,
      budget_pct: monthlyBudget ? +(((monthlyBudget.spent_eur / monthlyBudget.budget_eur) * 100).toFixed(1)) : 0,
    };

    if (errorRate > 0.3 || rlErrors > 10) {
      // High error rate → scale DOWN
      newMaxWip = Math.max(minWip, currentMaxWip - 1);
      scalingReason.action = "scale_down";
      scalingReason.trigger = errorRate > 0.3 ? "high_error_rate" : "rate_limit_spike";

      // Also reduce jobtype limits for content-heavy types
      for (const jt of ["generate_curriculum_content", "package_generate_exam_pool", "package_generate_oral_exam", "lesson_generate_content"]) {
        const { data: jtLimit } = await sb.from("jobtype_limits").select("max_processing").eq("job_type", jt).maybeSingle();
        if (jtLimit && jtLimit.max_processing > 1) {
          await sb.from("jobtype_limits").update({ max_processing: Math.max(1, jtLimit.max_processing - 1) }).eq("job_type", jt);
          actions.push(`Scaled down ${jt} concurrency → ${jtLimit.max_processing - 1}`);
        }
      }
    } else if (errorRate < 0.05 && recentOk > 20 && (dc < 50 || frozenCount > 150)) {
      // Stable + productive → scale UP (max 20)
      newMaxWip = Math.min(20, currentMaxWip + 1);
      scalingReason.action = "scale_up";
      scalingReason.trigger = "stable_throughput";

      // Also increase jobtype limits back — but respect finish-line ceilings
      const SCALE_UP_CEILINGS: Record<string, number> = {
        generate_curriculum_content: 20,
        package_generate_exam_pool: 16,
        lesson_generate_content: 20,  // Phase C: raised 10→20 for aggressive growth
        lesson_generate_content_shard: 12, // Phase C: raised 6→12 for shard parallelism
      };
      for (const jt of Object.keys(SCALE_UP_CEILINGS)) {
        const ceiling = SCALE_UP_CEILINGS[jt];
        const { data: jtLimit } = await sb.from("jobtype_limits").select("max_processing").eq("job_type", jt).maybeSingle();
        if (jtLimit && jtLimit.max_processing < ceiling) {
          await sb.from("jobtype_limits").update({ max_processing: Math.min(ceiling, jtLimit.max_processing + 1) }).eq("job_type", jt);
          actions.push(`Scaled up ${jt} concurrency → ${jtLimit.max_processing + 1} (ceiling: ${ceiling})`);
        }
      }
    } else {
      scalingReason.action = "hold";
    }

    // Budget override: if > 80% budget → cap WIP at 1
    const budgetPctValue = monthlyBudget && monthlyBudget.budget_eur > 0
      ? (monthlyBudget.spent_eur / monthlyBudget.budget_eur) * 100 : 0;
    if (budgetPctValue >= 80) {
      newMaxWip = Math.min(newMaxWip, 1);
      scalingReason.budget_override = true;
    }

    if (newMaxWip !== currentMaxWip) {
      await sb.rpc("set_pipeline_capacity", { p_max_wip: newMaxWip, p_reason: scalingReason });
      actions.push(`Auto-scaled WIP: ${currentMaxWip} → ${newMaxWip} (${scalingReason.action})`);

      // Log signal
      await sb.from("ops_runtime_signals").insert({ signal: scalingReason });
    }

    // frozenCount already fetched above in section 5

    // ═══════════════════════════════════════════════════════════════
    // 10.5 G1: PROGRESS GUARD — detect shadow-stalled packages
    // ═══════════════════════════════════════════════════════════════
    try {
      const { data: progressData } = await sb
        .from("v_ops_package_progress_guard")
        .select("*")
        .in("progress_state", ["SHADOW_STALLED", "SLOWING"]);

      const shadowStalled = (progressData ?? []).filter((p: any) => p.progress_state === "SHADOW_STALLED");

      for (const pkg of shadowStalled) {
        // Per-package + per-state dedup with 60min cooldown
        const fingerprint = `progress:${pkg.package_id}:SHADOW_STALLED`;
        const sixtyMinAgo = new Date(Date.now() - 60 * 60_000).toISOString();
        const { data: existing } = await sb.from("admin_notifications")
          .select("id")
          .eq("category", "pipeline")
          .eq("entity_id", pkg.package_id)
          .eq("entity_type", "progress_guard")
          .contains("metadata", { fingerprint })
          .gte("created_at", sixtyMinAgo)
          .limit(1);

        if (!existing || existing.length === 0) {
          await sb.from("admin_notifications").insert({
            title: `🚨 SHADOW_STALLED: ${pkg.title}`,
            body: `Package "${pkg.title}" has ${pkg.active_jobs} active jobs, ${pkg.active_leases} leases, but no real progress for ${Math.round(pkg.minutes_since_real_progress)}min. completed_30m=0, completed_60m=0.`,
            category: "pipeline",
            severity: "critical",
            entity_type: "progress_guard",
            entity_id: pkg.package_id,
            metadata: { ...pkg, fingerprint },
          });
          warnings.push(`G1: SHADOW_STALLED — ${pkg.title} (${pkg.active_jobs} jobs, ${Math.round(pkg.minutes_since_real_progress)}min no progress)`);
        }

        await sb.from("auto_heal_log").insert({
          action_type: "progress_guard_shadow_stalled",
          target_type: "course_package",
          target_id: pkg.package_id,
          trigger_source: "production-guardian",
          result_status: "detected",
          result_detail: `SHADOW_STALLED: ${pkg.active_jobs} jobs, ${Math.round(pkg.minutes_since_real_progress)}min`,
          metadata: pkg,
        });
      }

      // Log SLOWING as info (no P0)
      const slowing = (progressData ?? []).filter((p: any) => p.progress_state === "SLOWING");
      for (const pkg of slowing) {
        actions.push(`G1: SLOWING — ${pkg.title} (${pkg.active_jobs} jobs, completed_60m=${pkg.completed_jobs_60m})`);
      }

      // G1 extension: IDLE_WITH_LEASE as ops signal (warning, not P0)
      const idleWithLease = (progressData ?? []).filter((p: any) => p.progress_state === "IDLE_WITH_LEASE");
      for (const pkg of idleWithLease) {
        if ((pkg.minutes_since_real_progress ?? 0) > 30) {
          const fingerprint = `progress:${pkg.package_id}:IDLE_WITH_LEASE`;
          const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
          const { data: existing } = await sb.from("admin_notifications")
            .select("id")
            .eq("category", "pipeline")
            .eq("entity_id", pkg.package_id)
            .eq("entity_type", "progress_guard")
            .contains("metadata", { fingerprint })
            .gte("created_at", thirtyMinAgo)
            .limit(1);

          if (!existing || existing.length === 0) {
            await sb.from("admin_notifications").insert({
              title: `⚠️ IDLE_WITH_LEASE: ${pkg.title}`,
              body: `Package "${pkg.title}" has ${pkg.active_leases} active leases but 0 active jobs for ${Math.round(pkg.minutes_since_real_progress)}min. Possible lease leak.`,
              category: "pipeline",
              severity: "warning",
              entity_type: "progress_guard",
              entity_id: pkg.package_id,
              metadata: { ...pkg, fingerprint },
            });
            actions.push(`G1: IDLE_WITH_LEASE — ${pkg.title} (${pkg.active_leases} leases, 0 jobs)`);
          }
        }
      }
    } catch (e) {
      console.error("[Guardian] G1 progress guard error:", (e as Error).message);
    }

    // ═══════════════════════════════════════════════════════════════
    // 10.6 G2: BATCH SUBMIT HEALTH GUARD — detect submit failures
    // ═══════════════════════════════════════════════════════════════
    try {
      const { data: batchHealth } = await sb
        .from("v_ops_batch_submit_health")
        .select("*")
        .in("submit_health", ["CRITICAL", "DEGRADED", "WARNING"]);

      for (const b of batchHealth ?? []) {
        const entityId = `${b.provider ?? "?"}:${b.model ?? "?"}:${b.job_type ?? "?"}`;
        const fingerprint = `batch:${entityId}:${b.submit_health}`;
        const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();

        // Fingerprint-specific dedupe: filter by entity_id (provider:model:job_type)
        const { data: existing } = await sb.from("admin_notifications")
          .select("id")
          .eq("category", "pipeline")
          .eq("entity_type", "batch_submit_guard")
          .eq("entity_id", entityId)
          .gte("created_at", thirtyMinAgo)
          .limit(1);

        if (!existing || existing.length === 0) {
          // Granular severity: CRITICAL→critical, DEGRADED→warning, WARNING→info
          const severity = b.submit_health === "CRITICAL" ? "critical"
            : b.submit_health === "DEGRADED" ? "warning" : "info";

          // Volume thresholds: CRITICAL>=10, DEGRADED>=20, WARNING>=10
          const isRealVolume = (b.submit_health === "CRITICAL" && (b.total ?? 0) >= 10)
            || (b.submit_health === "DEGRADED" && (b.total ?? 0) >= 20)
            || (b.submit_health === "WARNING" && (b.total ?? 0) >= 10);

          if (isRealVolume) {
            await sb.from("admin_notifications").insert({
              title: `🚨 BATCH_SUBMIT_${b.submit_health}: ${b.provider}/${b.model}`,
              body: `Provider=${b.provider} model=${b.model} job_type=${b.job_type} failure_rate=${b.failure_pct}% (${b.failed}/${b.total}). Sample: ${String(b.sample_error ?? "").slice(0, 200)}`,
              category: "pipeline",
              severity,
              entity_type: "batch_submit_guard",
              entity_id: entityId,
              metadata: { ...b, fingerprint },
            });
            warnings.push(`G2: ${b.submit_health} — ${b.provider}/${b.model} ${b.failure_pct}%`);
          }
        }
      }
    } catch (e) {
      console.error("[Guardian] G2 batch submit guard error:", (e as Error).message);
    }

    // ═══════════════════════════════════════════════════════════════
    // 10.7 G3: HEALTH VIEW → NOTIFICATION BRIDGE
    // ═══════════════════════════════════════════════════════════════
    try {
      const { data: recoveryHealth } = await sb
        .from("v_ops_batch_recovery_health")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (recoveryHealth) {
        const redFields: string[] = [];
        for (const field of ["polling_health", "import_health", "output_health", "routing_health", "queue_health", "overall_health"]) {
          if ((recoveryHealth as any)[field] === "RED") {
            redFields.push(field);
          }
        }

        if (redFields.length > 0) {
          const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
          const fingerprint = `health_red:${redFields.sort().join(",")}`;
          // Fingerprint-specific dedupe: filter by entity_id = sorted RED fields
          const entityId = redFields.sort().join(",");
          const { data: existing } = await sb.from("admin_notifications")
            .select("id")
            .eq("category", "pipeline")
            .eq("entity_type", "health_bridge")
            .eq("entity_id", entityId)
            .gte("created_at", thirtyMinAgo)
            .limit(1);

          if (!existing || existing.length === 0) {
            await sb.from("admin_notifications").insert({
              title: `🔴 HEALTH_RED: ${redFields.join(", ")}`,
              body: `Batch Recovery Health zeigt RED für: ${redFields.join(", ")}. Overall: ${(recoveryHealth as any).overall_health}.`,
              category: "pipeline",
              severity: "critical",
              entity_type: "health_bridge",
              entity_id: entityId,
              metadata: { ...recoveryHealth, fingerprint, red_fields: redFields },
            });
            warnings.push(`G3: HEALTH_RED — ${redFields.join(", ")}`);
          }
        }
      }
    } catch (e) {
      console.error("[Guardian] G3 health bridge error:", (e as Error).message);
    }

    // ═══════════════════════════════════════════════════════════════
    // 10.8 G4: SHADOW ZOMBIE DETECTION
    // ═══════════════════════════════════════════════════════════════
    try {
      const { data: zombies } = await sb
        .from("v_ops_shadow_zombies")
        .select("*")
        .in("zombie_class", ["SHADOW_ZOMBIE", "POISONED_LOOP", "HARD_STALLED"]);

      for (const z of zombies ?? []) {
        const fingerprint = `zombie:${z.package_id}:${z.zombie_class}`;
        const sixtyMinAgo = new Date(Date.now() - 60 * 60_000).toISOString();
        const { data: existing } = await sb.from("admin_notifications")
          .select("id")
          .eq("category", "pipeline")
          .eq("entity_id", z.package_id)
          .eq("entity_type", "zombie_guard")
          .gte("created_at", sixtyMinAgo)
          .limit(1);

        if (!existing || existing.length === 0) {
          await sb.from("admin_notifications").insert({
            title: `🧟 ${z.zombie_class}: ${z.title}`,
            body: `Package "${z.title}" classified as ${z.zombie_class}. active_jobs=${z.active_jobs}, leases=${z.active_leases}, completed_1h=${z.completed_jobs_1h}, batch_ok=${z.batch_submit_ok_1h}, batch_fails=${z.batch_submit_fails_1h}, retries=${z.total_retry_attempts}.`,
            category: "pipeline",
            severity: "critical",
            entity_type: "zombie_guard",
            entity_id: z.package_id,
            metadata: { ...z, fingerprint },
          });
          warnings.push(`G4: ${z.zombie_class} — ${z.title}`);
        }

        await sb.from("auto_heal_log").insert({
          action_type: `zombie_detected_${String(z.zombie_class).toLowerCase()}`,
          target_type: "course_package",
          target_id: z.package_id,
          trigger_source: "production-guardian",
          result_status: "detected",
          result_detail: `${z.zombie_class}: jobs=${z.active_jobs}, completed_1h=${z.completed_jobs_1h}, batch_fails=${z.batch_submit_fails_1h}`,
          metadata: z,
        });
      }
    } catch (e) {
      console.error("[Guardian] G4 zombie guard error:", (e as Error).message);
    }

    // ═══════════════════════════════════════════════════════════════
    // 11. QUEUE STATS SNAPSHOT
    // ═══════════════════════════════════════════════════════════════
    const counts: Record<string, number> = {};
    for (const s of ["pending", "processing", "completed", "failed"]) {
      const { count } = await sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", s);
      counts[s] = count ?? 0;
    }

    const summary = {
      timestamp: new Date().toISOString(),
      queue: counts,
      pipeline_idle: pipelineIdle,
      actions_taken: actions.length,
      warnings_count: warnings.length,
      scaling: { current_wip: newMaxWip, error_rate: +(errorRate * 100).toFixed(1) },
      actions,
      warnings,
    };

    // Notify if critical
    if (warnings.length > 0 || actions.length > 0) {
      await sb.from("admin_notifications").insert({
        title: `Guardian: ${actions.length} Actions, ${warnings.length} Warnings`,
        body: JSON.stringify({ actions, warnings, queue: counts }),
        severity: warnings.length > 0 ? "warning" : "info",
        category: "system",
        entity_type: "production_guardian",
      });
    }

    // Log
    await sb.from("auto_heal_log").insert({
      action_type: "production_guardian_cycle",
      trigger_source: "cron_20min",
      result_status: warnings.length > 0 ? "warning" : "ok",
      result_detail: `${actions.length} actions, ${warnings.length} warnings`,
      metadata: summary,
    });

    console.log(`[Guardian] ${actions.length} actions, ${warnings.length} warnings, WIP=${newMaxWip}, queue: ${JSON.stringify(counts)}`);
    return json(summary);
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.error("[Guardian] Error:", msg);
    return json({ error: msg }, 500);
  }
});
