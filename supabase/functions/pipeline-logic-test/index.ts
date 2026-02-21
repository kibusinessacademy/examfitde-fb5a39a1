import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ── Shared Constants ──
const STEP_ORDER = [
  'scaffold_learning_course','generate_glossary','auto_seed_exam_blueprints',
  'validate_blueprints','generate_learning_content','validate_learning_content',
  'generate_exam_pool','validate_exam_pool','generate_oral_exam','validate_oral_exam',
  'build_ai_tutor_index','validate_tutor_index','generate_handbook','validate_handbook',
  'quality_council','run_integrity_check','auto_publish'
] as const;

const STEP_RANK = new Map(STEP_ORDER.map((s, i) => [s, i + 1]));

const JOB_TYPE_TO_STEP: Record<string, string> = {
  package_scaffold_learning_course: 'scaffold_learning_course',
  package_generate_glossary: 'generate_glossary',
  package_auto_seed_exam_blueprints: 'auto_seed_exam_blueprints',
  package_validate_blueprints: 'validate_blueprints',
  package_generate_learning_content: 'generate_learning_content',
  package_validate_learning_content: 'validate_learning_content',
  package_generate_exam_pool: 'generate_exam_pool',
  package_validate_exam_pool: 'validate_exam_pool',
  package_generate_oral_exam: 'generate_oral_exam',
  package_validate_oral_exam: 'validate_oral_exam',
  package_build_ai_tutor_index: 'build_ai_tutor_index',
  package_validate_tutor_index: 'validate_tutor_index',
  package_generate_handbook: 'generate_handbook',
  package_validate_handbook: 'validate_handbook',
  package_quality_council: 'quality_council',
  package_run_integrity_check: 'run_integrity_check',
  package_auto_publish: 'auto_publish',
};

type TestResult = { pass: boolean; detail: string; severity: 'critical' | 'warning' | 'info'; data?: unknown };

/**
 * Pipeline Logic Sandbox — Comprehensive Stress Test Suite v2
 *
 * 19 invariant checks covering:
 * - Step ordering & sequencing (T1-T2)
 * - Job lifecycle integrity (T3-T6, T9)
 * - Data consistency (T5, T8)
 * - Lease governance (T7)
 * - Deadlock & starvation detection (T10-T13)
 * - Content integrity gate (T14-T15)
 * - Performance & throughput (T16-T17)
 * - Recovery & self-healing verification (T18-T19)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const results: Record<string, TestResult> = {};

  // ═══════════════════════════════════════════════════════════════
  // SECTION A: Step Ordering & Sequencing Invariants
  // ═══════════════════════════════════════════════════════════════

  // ─── T1: Step Rank Completeness ───
  // Every step_key in package_steps must have a defined rank
  {
    const { data: unknownSteps } = await sb
      .from("package_steps" as any)
      .select("step_key")
      .not("step_key", "in", `(${STEP_ORDER.join(",")})`)
      .limit(10);

    const unknown = [...new Set((unknownSteps || []).map((r: any) => r.step_key))];
    results["T01_step_rank_completeness"] = {
      pass: unknown.length === 0,
      severity: "critical",
      detail: unknown.length === 0
        ? "All step_keys have a defined rank in the orchestrator"
        : `Unknown step_keys without rank: ${unknown.join(", ")}`,
      data: unknown,
    };
  }

  // ─── T2: Sequencing Violations ───
  // No package should have a later step 'done' while an earlier step is still 'queued'
  // (excluding scaffold which is always first)
  {
    let seqViolations: string[] = [];
    {
      const { data: allSteps } = await sb
        .from("package_steps" as any)
        .select("package_id, step_key, status")
        .in("status", ["queued", "done"]);

      const pkgSteps = new Map<string, { queued: number[]; done: number[] }>();
      for (const s of allSteps || []) {
        const rank = STEP_RANK.get(s.step_key);
        if (!rank) continue;
        if (!pkgSteps.has(s.package_id)) pkgSteps.set(s.package_id, { queued: [], done: [] });
        const entry = pkgSteps.get(s.package_id)!;
        if (s.status === "queued") entry.queued.push(rank);
        else if (s.status === "done") entry.done.push(rank);
      }
      for (const [pkgId, { queued, done }] of pkgSteps) {
        if (queued.length === 0 || done.length === 0) continue;
        const minQueued = Math.min(...queued);
        const maxDone = Math.max(...done);
        if (maxDone > minQueued) seqViolations.push(pkgId);
      }
    }
    results["T02_sequencing_violations"] = {
      pass: seqViolations.length === 0,
      severity: "warning",
      detail: seqViolations.length === 0
        ? "No sequencing violations (all steps in correct order)"
        : `${seqViolations.length} package(s) have later steps done while earlier steps still queued (legacy)`,
      data: seqViolations.slice(0, 10),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION B: Job Lifecycle Integrity
  // ═══════════════════════════════════════════════════════════════

  // ─── T3: Zombie Jobs (processing without started_at) ───
  {
    const { data: zombies } = await sb
      .from("job_queue" as any)
      .select("id, job_type, status, last_error, created_at, locked_at, locked_by, package_id")
      .eq("status", "processing")
      .is("started_at", null);

    results["T03_zombie_jobs_no_start"] = {
      pass: (zombies?.length || 0) === 0,
      severity: "critical",
      detail: (zombies?.length || 0) === 0
        ? "No zombie jobs (processing without started_at)"
        : `${zombies!.length} zombie job(s) stuck in processing without ever starting`,
      data: zombies?.slice(0, 5),
    };
  }

  // ─── T4: Orphaned Steps (running/enqueued with dead job) ───
  {
    const { data: activeSteps } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, status, job_id")
      .in("status", ["running", "enqueued"])
      .not("job_id", "is", null);

    let orphaned: any[] = [];
    if (activeSteps && activeSteps.length > 0) {
      const jobIds = [...new Set(activeSteps.map((s: any) => s.job_id))];
      const { data: jobs } = await sb
        .from("job_queue" as any)
        .select("id, status")
        .in("id", jobIds);

      const jobMap = new Map((jobs || []).map((j: any) => [j.id, j.status]));
      orphaned = activeSteps.filter((s: any) => {
        const jobStatus = jobMap.get(s.job_id);
        return jobStatus === "completed" || jobStatus === "failed" || jobStatus === "cancelled" || !jobStatus;
      });
    }

    results["T04_orphaned_steps"] = {
      pass: orphaned.length === 0,
      severity: "critical",
      detail: orphaned.length === 0
        ? "No orphaned steps (all active steps have matching active jobs)"
        : `${orphaned.length} step(s) pointing to completed/missing jobs`,
      data: orphaned.slice(0, 5),
    };
  }

  // ─── T5: Data Consistency (done without finished_at) ───
  {
    const { data: inconsistent } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, status, finished_at")
      .eq("status", "done")
      .is("finished_at", null);

    results["T05_done_without_finished_at"] = {
      pass: (inconsistent?.length || 0) === 0,
      severity: "warning",
      detail: (inconsistent?.length || 0) === 0
        ? "All done steps have finished_at set"
        : `${inconsistent!.length} step(s) marked done without finished_at`,
      data: inconsistent?.slice(0, 5),
    };
  }

  // ─── T6: Double-Claim Prevention ───
  {
    const { data: allActive } = await sb
      .from("job_queue" as any)
      .select("id, package_id, job_type, status")
      .in("status", ["pending", "processing"]);

    const counts = new Map<string, number>();
    const dupes: any[] = [];
    for (const j of allActive || []) {
      const key = `${j.package_id}::${j.job_type}`;
      const c = (counts.get(key) || 0) + 1;
      counts.set(key, c);
      if (c === 2) dupes.push({ package_id: j.package_id, job_type: j.job_type, count: c });
    }

    results["T06_double_claim_prevention"] = {
      pass: dupes.length === 0,
      severity: "critical",
      detail: dupes.length === 0
        ? "No duplicate active jobs per package+type"
        : `${dupes.length} package(s) have duplicate active jobs`,
      data: dupes.slice(0, 5),
    };
  }

  // ─── T7: Lease Alignment ───
  {
    const { data: buildingPkgs } = await sb
      .from("course_packages" as any)
      .select("id, title, status")
      .eq("status", "building");

    let strandedPkgs: any[] = [];
    if (buildingPkgs && buildingPkgs.length > 0) {
      const pkgIds = buildingPkgs.map((p: any) => p.id);
      const { data: leases } = await sb
        .from("package_leases" as any)
        .select("package_id, lease_until")
        .in("package_id", pkgIds);

      const leaseMap = new Map((leases || []).map((l: any) => [l.package_id, l.lease_until]));
      strandedPkgs = buildingPkgs.filter((p: any) => !leaseMap.has(p.id));
    }

    results["T07_lease_alignment"] = {
      pass: strandedPkgs.length === 0,
      severity: "critical",
      detail: strandedPkgs.length === 0
        ? "All building packages have active leases"
        : `${strandedPkgs.length} building package(s) without lease (stranded)`,
      data: strandedPkgs.slice(0, 5),
    };
  }

  // ─── T8: Integrity Gate Coverage ───
  {
    const { data: contentSteps } = await sb
      .from("package_steps" as any)
      .select("step_key, status, last_error")
      .eq("status", "done")
      .like("last_error", "%placeholder%");

    results["T08_integrity_gate_coverage"] = {
      pass: (contentSteps?.length || 0) === 0,
      severity: "warning",
      detail: (contentSteps?.length || 0) === 0
        ? "No steps completed despite placeholder warnings"
        : `${contentSteps!.length} step(s) completed with placeholder warnings in last_error`,
      data: contentSteps?.slice(0, 5),
    };
  }

  // ─── T9: Claim Uses Lease Guard ───
  {
    const { data: procJobs } = await sb
      .from("job_queue" as any)
      .select("id, locked_by, locked_at")
      .eq("status", "processing");

    const noLock = (procJobs || []).filter((j: any) => !j.locked_by);
    results["T09_claim_uses_lease_guard"] = {
      pass: noLock.length === 0,
      severity: "warning",
      detail: noLock.length === 0
        ? "All processing jobs have locked_by set (2-arg claim version used)"
        : `${noLock.length} processing job(s) without locked_by`,
      data: noLock.slice(0, 3),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION C: Deadlock & Starvation Detection
  // ═══════════════════════════════════════════════════════════════

  // ─── T10: Pipeline Starvation ───
  // Packages in 'queued' with no building packages and no leases = nothing is moving
  {
    const { count: queuedCount } = await sb
      .from("course_packages" as any)
      .select("id", { count: "exact", head: true })
      .eq("status", "queued");

    const { count: buildingCount } = await sb
      .from("course_packages" as any)
      .select("id", { count: "exact", head: true })
      .eq("status", "building");

    const { count: activeLeases } = await sb
      .from("package_leases" as any)
      .select("package_id", { count: "exact", head: true })
      .gt("lease_until", new Date().toISOString());

    const isStarved = (queuedCount ?? 0) > 0 && (buildingCount ?? 0) === 0 && (activeLeases ?? 0) === 0;

    results["T10_pipeline_starvation"] = {
      pass: !isStarved,
      severity: "critical",
      detail: isStarved
        ? `STARVATION: ${queuedCount} queued, 0 building, 0 leases — pipeline is stuck`
        : `Pipeline flowing: ${queuedCount} queued, ${buildingCount} building, ${activeLeases} leases`,
      data: { queued: queuedCount, building: buildingCount, activeLeases },
    };
  }

  // ─── T11: Stuck Building Packages (no progress > 1h) ───
  {
    const { data: stuckBuilding } = await sb
      .from("course_packages" as any)
      .select("id, title, status, updated_at")
      .eq("status", "building")
      .lt("updated_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    results["T11_stuck_building_packages"] = {
      pass: (stuckBuilding?.length || 0) === 0,
      severity: "warning",
      detail: (stuckBuilding?.length || 0) === 0
        ? "No building packages stuck for >1 hour"
        : `${stuckBuilding!.length} package(s) in building with no update for >1h`,
      data: stuckBuilding?.slice(0, 5),
    };
  }

  // ─── T12: Stale Heartbeat Detection ───
  // Steps in 'running' with no heartbeat for > 10 min (should be timed out by watchdog)
  {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: staleHB } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, status, last_heartbeat_at")
      .eq("status", "running")
      .lt("last_heartbeat_at", tenMinAgo);

    results["T12_stale_heartbeat"] = {
      pass: (staleHB?.length || 0) === 0,
      severity: "warning",
      detail: (staleHB?.length || 0) === 0
        ? "No running steps with stale heartbeats (>10min)"
        : `${staleHB!.length} running step(s) with heartbeat older than 10 minutes`,
      data: staleHB?.slice(0, 5),
    };
  }

  // ─── T13: WIP Limit Compliance ───
  // Building count should never exceed configured WIP limit
  {
    const { data: config } = await sb
      .from("ops_pipeline_config" as any)
      .select("value")
      .eq("key", "wip_limit")
      .maybeSingle();

    const wipLimit = config?.value ? Number(config.value) : 5;

    const { count: currentBuilding } = await sb
      .from("course_packages" as any)
      .select("id", { count: "exact", head: true })
      .eq("status", "building");

    results["T13_wip_limit_compliance"] = {
      pass: (currentBuilding ?? 0) <= wipLimit,
      severity: "warning",
      detail: (currentBuilding ?? 0) <= wipLimit
        ? `WIP within limit: ${currentBuilding}/${wipLimit}`
        : `WIP EXCEEDED: ${currentBuilding} building but limit is ${wipLimit}`,
      data: { currentBuilding, wipLimit },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION D: Content Integrity & Quality Gates
  // ═══════════════════════════════════════════════════════════════

  // ─── T14: Placeholder Lessons Past Content Gate ───
  // If content step is 'done', there should be 0 placeholder lessons
  {
    const { data: doneContentSteps } = await sb
      .from("package_steps" as any)
      .select("package_id")
      .eq("step_key", "generate_learning_content")
      .eq("status", "done");

    let placeholderLeaks: any[] = [];
    if (doneContentSteps && doneContentSteps.length > 0) {
      const pkgIds = doneContentSteps.map((s: any) => s.package_id).slice(0, 50);
      const { data: lessons } = await sb
        .from("lessons" as any)
        .select("id, course_id, content")
        .in("course_id", pkgIds)
        .not("content", "is", null);

      // Check for _placeholder: true in content
      for (const l of lessons || []) {
        try {
          const content = typeof l.content === "string" ? JSON.parse(l.content) : l.content;
          if (content?._placeholder === true) {
            placeholderLeaks.push({ lesson_id: l.id, course_id: l.course_id });
          }
        } catch (_) { /* ignore parse errors */ }
      }
    }

    results["T14_placeholder_past_gate"] = {
      pass: placeholderLeaks.length === 0,
      severity: "critical",
      detail: placeholderLeaks.length === 0
        ? "No placeholder lessons found past content generation gate"
        : `${placeholderLeaks.length} placeholder lesson(s) leaked past content gate`,
      data: placeholderLeaks.slice(0, 5),
    };
  }

  // ─── T15: Exam Pool Minimum Threshold ───
  // Packages past validate_exam_pool should have >= 850 approved questions
  {
    const { data: examDone } = await sb
      .from("package_steps" as any)
      .select("package_id")
      .eq("step_key", "validate_exam_pool")
      .eq("status", "done");

    let belowThreshold: any[] = [];
    if (examDone && examDone.length > 0) {
      for (const s of examDone.slice(0, 20)) {
        const { count } = await sb
          .from("questions" as any)
          .select("id", { count: "exact", head: true })
          .eq("package_id", s.package_id)
          .eq("status", "approved");

        if ((count ?? 0) < 850) {
          belowThreshold.push({ package_id: s.package_id, approved_count: count });
        }
      }
    }

    results["T15_exam_pool_threshold"] = {
      pass: belowThreshold.length === 0,
      severity: "warning",
      detail: belowThreshold.length === 0
        ? "All validated exam pools meet minimum threshold (850 approved)"
        : `${belowThreshold.length} package(s) passed validation with <850 approved questions`,
      data: belowThreshold.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION E: Job-Step Sync & Trigger Integrity
  // ═══════════════════════════════════════════════════════════════

  // ─── T16: Job-Step Status Mismatch (current job completed, step stuck) ───
  // The step's current job_id should match an active job if step is running
  {
    const { data: runningSteps } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, status, job_id")
      .eq("status", "running")
      .not("job_id", "is", null);

    let mismatches: any[] = [];
    if (runningSteps && runningSteps.length > 0) {
      const jobIds = runningSteps.map((s: any) => s.job_id);
      const { data: jobs } = await sb
        .from("job_queue" as any)
        .select("id, status")
        .in("id", jobIds);

      const jobMap = new Map((jobs || []).map((j: any) => [j.id, j.status]));
      mismatches = runningSteps.filter((s: any) => {
        const js = jobMap.get(s.job_id);
        // Step is running but its CURRENT job is not processing/pending
        return js && js !== "processing" && js !== "pending";
      });
    }

    results["T16_job_step_sync_mismatch"] = {
      pass: mismatches.length === 0,
      severity: "critical",
      detail: mismatches.length === 0
        ? "All running steps have actively processing jobs"
        : `${mismatches.length} step(s) running but their current job is completed/failed (trigger missed)`,
      data: mismatches.slice(0, 5),
    };
  }

  // ─── T17: Steps Without Job (running/enqueued with NULL job_id) ───
  {
    const { data: noJobSteps } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, status, job_id")
      .in("status", ["running", "enqueued"])
      .is("job_id", null);

    results["T17_active_steps_no_job"] = {
      pass: (noJobSteps?.length || 0) === 0,
      severity: "critical",
      detail: (noJobSteps?.length || 0) === 0
        ? "No active steps without a job_id"
        : `${noJobSteps!.length} step(s) in running/enqueued without any job_id (ghost steps)`,
      data: noJobSteps?.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION F: Recovery & Self-Healing Verification
  // ═══════════════════════════════════════════════════════════════

  // ─── T18: Watchdog Effectiveness ───
  // Check if auto_heal_log shows recent activity
  {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentHeals } = await sb
      .from("auto_heal_log" as any)
      .select("id, action_type, result_status, created_at")
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(5);

    const hasRecentCycles = (recentHeals?.length || 0) > 0;
    const healedActions = (recentHeals || []).filter((h: any) => h.result_status === "healed");

    results["T18_watchdog_active"] = {
      pass: hasRecentCycles,
      severity: "info",
      detail: hasRecentCycles
        ? `Watchdog active: ${recentHeals!.length} cycle(s) in last hour, ${healedActions.length} healed`
        : "WARNING: No watchdog cycles in the last hour — cron may be down",
      data: recentHeals?.slice(0, 3),
    };
  }

  // ─── T19: Lease Expiry Timing Safety ───
  // Active leases should have at least 30s remaining (not about to expire during a job)
  {
    const now = Date.now();
    const { data: leases } = await sb
      .from("package_leases" as any)
      .select("package_id, runner_id, lease_until")
      .gt("lease_until", new Date().toISOString());

    const soonExpiring = (leases || []).filter((l: any) => {
      const remaining = new Date(l.lease_until).getTime() - now;
      return remaining < 30_000; // < 30 seconds
    });

    results["T19_lease_expiry_timing"] = {
      pass: soonExpiring.length === 0,
      severity: "info",
      detail: soonExpiring.length === 0
        ? `All ${(leases || []).length} active leases have >30s remaining`
        : `${soonExpiring.length} lease(s) expiring in <30s (risk of mid-job expiry)`,
      data: soonExpiring.slice(0, 3),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  const totalTests = Object.keys(results).length;
  const passed = Object.values(results).filter((r) => r.pass).length;
  const failed = totalTests - passed;
  const criticalFails = Object.values(results).filter((r) => !r.pass && r.severity === "critical").length;
  const warnings = Object.values(results).filter((r) => !r.pass && r.severity === "warning").length;

  return json({
    summary: `${passed}/${totalTests} passed | ${criticalFails} critical | ${warnings} warnings | ${failed} total failures`,
    timestamp: new Date().toISOString(),
    health: criticalFails > 0 ? "CRITICAL" : warnings > 0 ? "DEGRADED" : "HEALTHY",
    results,
  });
});
