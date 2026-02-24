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

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  auto_healed?: boolean;
}

/**
 * Pipeline Forensic Stress Test (v1)
 * 
 * Deep analysis of the entire pipeline covering:
 * - JSONB type safety in ops_pipeline_config
 * - RPC cast safety (the root cause of runner crashes)
 * - Step state machine invariants
 * - Gate release logic (sequence guard, integrity gates)
 * - Lease/lock consistency
 * - Zombie/orphan detection
 * - Auto-heal loop detection (thrashing)
 * - Backpressure & concurrency limits
 * - Data integrity across pipeline tables
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: TestResult[] = [];
  const healed: string[] = [];

  // ═══════════════════════════════════════════════════════════════
  // T01: JSONB Type Safety in ops_pipeline_config
  // The root cause of the pipeline-runner crash
  // ═══════════════════════════════════════════════════════════════
  {
    const NUMERIC_KEYS = [
      "max_concurrent_packages",
      "autoscale_target_max",
      "autoscale_floor",
      "heartbeat_stale_seconds",
      "backpressure_threshold",
    ];

    const { data: configs } = await sb
      .from("ops_pipeline_config")
      .select("key, value");

    let corruptCount = 0;
    for (const cfg of configs || []) {
      if (NUMERIC_KEYS.includes(cfg.key)) {
        // Check if value is stored as JSONB string instead of number
        const val = cfg.value;
        const isString = typeof val === "string";
        if (isString) {
          corruptCount++;
          // Auto-heal: convert string to number
          const numVal = parseInt(val, 10);
          if (!isNaN(numVal)) {
            await sb
              .from("ops_pipeline_config")
              .update({ value: numVal })
              .eq("key", cfg.key);
            healed.push(`T01: Fixed ${cfg.key} JSONB type (string→number)`);
          }
        }
      }
    }

    results.push({
      id: "T01",
      name: "JSONB Type Safety (ops_pipeline_config)",
      passed: corruptCount === 0,
      severity: "critical",
      detail: corruptCount === 0
        ? "All numeric config values stored as JSONB numbers"
        : `${corruptCount} key(s) stored as JSONB strings (auto-healed)`,
      auto_healed: corruptCount > 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T02: RPC acquire_next_package_lease safe cast
  // ═══════════════════════════════════════════════════════════════
  {
    let passed = true;
    let detail = "";
    try {
      const { data, error } = await sb.rpc("acquire_next_package_lease", {
        p_runner_id: "forensic_test_dry_run",
        p_lease_seconds: 1, // 1 second lease (expires immediately)
      });
      if (error) {
        passed = false;
        detail = `RPC error: ${error.message}`;
        if (error.message.includes("cannot cast jsonb")) {
          detail += " — ROOT CAUSE: JSONB string→int cast failure";
        }
      } else {
        detail = data ? `Acquired ${String(data).slice(0, 8)} (releasing)` : "No package available (OK)";
        // Release any acquired lease immediately
        if (data) {
          await sb.rpc("release_package_lease", {
            p_package_id: data,
            p_runner_id: "forensic_test_dry_run",
          });
        }
      }
    } catch (e) {
      passed = false;
      detail = `Exception: ${(e as Error).message}`;
    }

    results.push({
      id: "T02",
      name: "acquire_next_package_lease RPC safety",
      passed,
      severity: "critical",
      detail,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T03: Ghost Running Steps (step=running, no active job)
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: ghostSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, status, job_id, started_at")
      .eq("status", "running")
      .is("job_id", null);

    const count = ghostSteps?.length ?? 0;
    let healedCount = 0;

    if (count > 0) {
      for (const gs of ghostSteps!) {
        await sb
          .from("package_steps")
          .update({ status: "queued", started_at: null, last_error: "Forensic: ghost running step (no job_id)" })
          .eq("package_id", gs.package_id)
          .eq("step_key", gs.step_key);
        healedCount++;
      }
      healed.push(`T03: Healed ${healedCount} ghost running steps`);
    }

    results.push({
      id: "T03",
      name: "Ghost Running Steps",
      passed: count === 0,
      severity: "critical",
      detail: count === 0 ? "No ghost running steps" : `${count} ghost steps found and healed`,
      auto_healed: count > 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T04: Orphan Enqueued Steps (step=enqueued, no job_id)
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: orphans } = await sb
      .from("package_steps")
      .select("package_id, step_key")
      .eq("status", "enqueued")
      .is("job_id", null);

    const count = orphans?.length ?? 0;
    if (count > 0) {
      for (const o of orphans!) {
        await sb
          .from("package_steps")
          .update({ status: "queued", last_error: "Forensic: orphan enqueued (no job_id)" })
          .eq("package_id", o.package_id)
          .eq("step_key", o.step_key);
      }
      healed.push(`T04: Healed ${count} orphan enqueued steps`);
    }

    results.push({
      id: "T04",
      name: "Orphan Enqueued Steps",
      passed: count === 0,
      severity: "high",
      detail: count === 0 ? "No orphan enqueued steps" : `${count} found and healed`,
      auto_healed: count > 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T05: Stale Leases (lease_until in past but still in table)
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: staleLeases } = await sb
      .from("package_leases")
      .select("package_id, runner_id, lease_until")
      .lt("lease_until", new Date().toISOString());

    const count = staleLeases?.length ?? 0;
    if (count > 0) {
      await sb
        .from("package_leases")
        .delete()
        .lt("lease_until", new Date().toISOString());
      healed.push(`T05: Cleaned ${count} stale leases`);
    }

    results.push({
      id: "T05",
      name: "Stale Leases",
      passed: count === 0,
      severity: "high",
      detail: count === 0 ? "No stale leases" : `${count} stale leases cleaned`,
      auto_healed: count > 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T06: Sequence Guard Integrity
  // Steps marked 'done' with incomplete predecessors
  // ═══════════════════════════════════════════════════════════════
  {
    const STEP_ORDER = [
      "auto_seed_exam_blueprints", "validate_blueprints",
      "generate_exam_pool", "validate_exam_pool",
      "build_ai_tutor_index", "validate_tutor_index",
      "generate_oral_exam", "validate_oral_exam",
      "run_integrity_check", "quality_council", "auto_publish",
    ];

    // Check building packages
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id")
      .eq("status", "building")
      .limit(20);

    let violations = 0;
    for (const pkg of buildingPkgs || []) {
      const { data: steps } = await sb
        .from("package_steps")
        .select("step_key, status")
        .eq("package_id", pkg.id);

      if (!steps) continue;
      const byKey = new Map(steps.map((s) => [s.step_key, s.status]));
      const existingOrder = STEP_ORDER.filter((k) => byKey.has(k));

      let foundIncomplete = false;
      for (const k of existingOrder) {
        const st = byKey.get(k)!;
        if (st !== "done" && st !== "skipped") {
          foundIncomplete = true;
        } else if ((st === "done") && foundIncomplete) {
          violations++;
        }
      }
    }

    results.push({
      id: "T06",
      name: "Sequence Guard Integrity",
      passed: violations === 0,
      severity: "critical",
      detail: violations === 0
        ? "No out-of-order done steps in building packages"
        : `${violations} out-of-order step(s) found`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T07: STARVATION Detection
  // Building packages with zero pending/processing jobs
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id, title")
      .eq("status", "building")
      .limit(20);

    const starved: string[] = [];
    for (const pkg of buildingPkgs || []) {
      // Check if package has incomplete steps
      const { data: incompleteSteps } = await sb
        .from("package_steps")
        .select("step_key")
        .eq("package_id", pkg.id)
        .not("status", "in", '("done","skipped")');

      if ((incompleteSteps?.length ?? 0) === 0) continue; // All done, just not promoted

      // Check for active jobs
      const { count: activeJobs } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["pending", "processing"]);

      // Check for active leases
      const { count: activeLeases } = await sb
        .from("package_leases")
        .select("package_id", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .gt("lease_until", new Date().toISOString());

      if ((activeJobs ?? 0) === 0 && (activeLeases ?? 0) === 0) {
        starved.push(`${pkg.title} (${pkg.id.slice(0, 8)}): ${incompleteSteps!.length} incomplete steps, 0 jobs, 0 leases`);
      }
    }

    results.push({
      id: "T07",
      name: "STARVATION Detection",
      passed: starved.length === 0,
      severity: "critical",
      detail: starved.length === 0
        ? "No starved building packages"
        : `${starved.length} starved: ${starved.join("; ")}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T08: Zombie Jobs (processing > 30min with no lock)
  // ═══════════════════════════════════════════════════════════════
  {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: zombies } = await sb
      .from("job_queue")
      .select("id, job_type, locked_at, updated_at")
      .eq("status", "processing")
      .lt("updated_at", thirtyMinAgo);

    const count = zombies?.length ?? 0;
    if (count > 0) {
      for (const z of zombies!) {
        await sb
          .from("job_queue")
          .update({
            status: "failed",
            last_error: `Forensic: zombie job (processing ${Math.round((Date.now() - new Date(z.updated_at).getTime()) / 60000)}min)`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", z.id);
      }
      healed.push(`T08: Failed ${count} zombie jobs`);
    }

    results.push({
      id: "T08",
      name: "Zombie Jobs",
      passed: count === 0,
      severity: "high",
      detail: count === 0 ? "No zombie jobs" : `${count} zombie jobs failed`,
      auto_healed: count > 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T09: Auto-Heal Thrashing Detection
  // Same step healed > 5 times in last hour = infinite loop
  // ═══════════════════════════════════════════════════════════════
  {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: healLogs } = await sb
      .from("auto_heal_log")
      .select("target_id, action_type, result_detail")
      .gte("created_at", oneHourAgo)
      .eq("action_type", "validation_auto_heal")
      .limit(200);

    // Count per target_id
    const countByTarget = new Map<string, number>();
    for (const log of healLogs || []) {
      const key = `${log.target_id}`;
      countByTarget.set(key, (countByTarget.get(key) ?? 0) + 1);
    }

    const thrashing = [...countByTarget.entries()].filter(([, c]) => c > 5);

    results.push({
      id: "T09",
      name: "Auto-Heal Thrashing Detection",
      passed: thrashing.length === 0,
      severity: "high",
      detail: thrashing.length === 0
        ? "No thrashing detected"
        : `${thrashing.length} target(s) thrashing: ${thrashing.map(([k, c]) => `${k.slice(0, 8)}×${c}`).join(", ")}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T10: Pipeline Lock Consistency
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: lock } = await sb
      .from("pipeline_lock")
      .select("*")
      .eq("id", 1)
      .single();

    let issues: string[] = [];
    if (lock?.active_package_id) {
      // Check if active package still exists and is building
      const { data: pkg } = await sb
        .from("course_packages")
        .select("id, status")
        .eq("id", lock.active_package_id)
        .maybeSingle();

      if (!pkg) {
        issues.push(`Lock references non-existent package ${lock.active_package_id}`);
      } else if (pkg.status !== "building") {
        issues.push(`Lock references package in status '${pkg.status}' (expected 'building')`);
      }

      // Check heartbeat staleness
      if (lock.heartbeat_at) {
        const staleMs = Date.now() - new Date(lock.heartbeat_at).getTime();
        if (staleMs > 15 * 60 * 1000) {
          issues.push(`Heartbeat stale for ${Math.round(staleMs / 60000)}min`);
        }
      }
    }

    results.push({
      id: "T10",
      name: "Pipeline Lock Consistency",
      passed: issues.length === 0,
      severity: "medium",
      detail: issues.length === 0 ? "Lock is consistent" : issues.join("; "),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T11: Job-Step Mismatch (step has job_id but job doesn't exist)
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: stepsWithJobs } = await sb
      .from("package_steps")
      .select("package_id, step_key, job_id, status")
      .not("job_id", "is", null)
      .in("status", ["enqueued", "running"]);

    let orphaned = 0;
    for (const s of stepsWithJobs || []) {
      const { data: job } = await sb
        .from("job_queue")
        .select("id, status")
        .eq("id", s.job_id!)
        .maybeSingle();

      if (!job) {
        orphaned++;
        await sb
          .from("package_steps")
          .update({ status: "queued", job_id: null, last_error: "Forensic: job_id references non-existent job" })
          .eq("package_id", s.package_id)
          .eq("step_key", s.step_key);
      } else if (job.status === "failed" || job.status === "completed") {
        // Step is enqueued/running but job is already done — sync mismatch
        orphaned++;
        const newStatus = job.status === "completed" ? "done" : "queued";
        await sb
          .from("package_steps")
          .update({
            status: newStatus,
            job_id: null,
            last_error: `Forensic: step/job sync mismatch (step=${s.status}, job=${job.status})`,
          })
          .eq("package_id", s.package_id)
          .eq("step_key", s.step_key);
      }
    }

    if (orphaned > 0) healed.push(`T11: Fixed ${orphaned} step/job mismatches`);

    results.push({
      id: "T11",
      name: "Job-Step Sync Integrity",
      passed: orphaned === 0,
      severity: "critical",
      detail: orphaned === 0
        ? "All step job references are valid"
        : `${orphaned} mismatches found and healed`,
      auto_healed: orphaned > 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T12: Duplicate Active Jobs per Step
  // Only ONE job should be pending/processing per package+step combo
  // ═══════════════════════════════════════════════════════════════
  {
    // Can't use raw SQL, use alternative approach
    const { data: activeJobs } = await sb
      .from("job_queue")
      .select("id, job_type, package_id, status, payload")
      .in("status", ["pending", "processing"])
      .limit(500);

    // Fan-out job types: multiple jobs per (package_id, job_type) are legitimate
    // when they target different learning_field_ids
    const FAN_OUT_JOB_TYPES = new Set([
      "package_generate_exam_pool",
      "package_generate_oral_exam",
      "package_build_ai_tutor_index",
    ]);

    const seen = new Map<string, string[]>();
    for (const j of activeJobs || []) {
      if (!j.package_id) continue;
      // For fan-out jobs, include learning_field_id in dedupe key
      const lfScope = FAN_OUT_JOB_TYPES.has(j.job_type)
        ? `::lf=${(j.payload as Record<string, unknown>)?.learning_field_id ?? '__root__'}`
        : "";
      const key = `${j.package_id}::${j.job_type}${lfScope}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(j.id);
    }

    const duplicates = [...seen.entries()].filter(([, ids]) => ids.length > 1);
    let cancelledCount = 0;
    for (const [key, ids] of duplicates) {
      // Keep the newest, cancel older ones
      const toCancel = ids.slice(0, -1);
      for (const id of toCancel) {
        await sb
          .from("job_queue")
          .update({ status: "cancelled", last_error: "Forensic: duplicate active job" })
          .eq("id", id);
        cancelledCount++;
      }
    }

    if (cancelledCount > 0) healed.push(`T12: Cancelled ${cancelledCount} duplicate jobs`);

    results.push({
      id: "T12",
      name: "Duplicate Active Jobs",
      passed: duplicates.length === 0,
      severity: "high",
      detail: duplicates.length === 0
        ? "No duplicate active jobs"
        : `${duplicates.length} duplicate groups (${cancelledCount} cancelled)`,
      auto_healed: cancelledCount > 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T13: WIP Limit Enforcement
  // Building packages should not exceed max_concurrent_packages
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: cfgRow } = await sb
      .from("ops_pipeline_config")
      .select("value")
      .eq("key", "max_concurrent_packages")
      .maybeSingle();
    const maxWip = typeof cfgRow?.value === "number" ? cfgRow.value : parseInt(String(cfgRow?.value ?? "5"), 10);

    const { count: buildingCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "building");

    const { count: leaseCount } = await sb
      .from("package_leases")
      .select("package_id", { count: "exact", head: true })
      .gt("lease_until", new Date().toISOString());

    const building = buildingCount ?? 0;
    const leases = leaseCount ?? 0;

    results.push({
      id: "T13",
      name: "WIP Limit Enforcement",
      passed: leases <= maxWip,
      severity: "medium",
      detail: `Building: ${building}, Active leases: ${leases}, Max WIP: ${maxWip}${leases > maxWip ? " — EXCEEDED!" : ""}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T14: Packages stuck in 'building' > 2 hours with no progress
  // ═══════════════════════════════════════════════════════════════
  {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: stuckPkgs } = await sb
      .from("course_packages")
      .select("id, title, updated_at")
      .eq("status", "building")
      .lt("updated_at", twoHoursAgo);

    results.push({
      id: "T14",
      name: "Stuck Building Packages (>2h)",
      passed: (stuckPkgs?.length ?? 0) === 0,
      severity: "medium",
      detail: (stuckPkgs?.length ?? 0) === 0
        ? "No packages stuck >2h"
        : `${stuckPkgs!.length} stuck: ${stuckPkgs!.map((p) => p.title || p.id.slice(0, 8)).join(", ")}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T15: Failed rate in last hour
  // ═══════════════════════════════════════════════════════════════
  {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: totalRecent } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["completed", "failed"])
      .gte("updated_at", oneHourAgo);

    const { count: failedRecent } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("updated_at", oneHourAgo);

    const total = totalRecent ?? 0;
    const failed = failedRecent ?? 0;
    const rate = total > 0 ? Math.round((failed / total) * 100) : 0;

    results.push({
      id: "T15",
      name: "Error Rate (1h)",
      passed: rate < 30,
      severity: rate > 50 ? "critical" : rate > 30 ? "high" : "low",
      detail: `${failed}/${total} failed (${rate}%)`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T16: Package without required fields (curriculum_id, course_id)
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: missingCurr } = await sb
      .from("course_packages")
      .select("id, title, status")
      .in("status", ["queued", "building"])
      .is("curriculum_id", null);

    const { data: missingCourse } = await sb
      .from("course_packages")
      .select("id, title, status")
      .in("status", ["queued", "building"])
      .is("course_id", null);

    const total = (missingCurr?.length ?? 0) + (missingCourse?.length ?? 0);

    results.push({
      id: "T16",
      name: "Missing Required Package Fields",
      passed: total === 0,
      severity: "high",
      detail: total === 0
        ? "All active packages have curriculum_id and course_id"
        : `${missingCurr?.length ?? 0} missing curriculum_id, ${missingCourse?.length ?? 0} missing course_id`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T17: acquire_next_package_lease RPC safety (core pipeline RPC)
  // ═══════════════════════════════════════════════════════════════
  {
    let passed = true;
    let detail = "";
    try {
      const { data, error } = await sb.rpc("acquire_next_package_lease", {
        p_runner_id: "forensic_test_noop",
        p_lease_seconds: 1,
      });
      if (error) {
        // "no rows" is acceptable — means no queued packages
        if (error.message?.includes("no rows") || error.message?.includes("No package")) {
          detail = "RPC callable, no packages available (OK)";
        } else {
          passed = false;
          detail = `RPC error: ${error.message}`;
        }
      } else {
        detail = `RPC returned package_id=${data ?? "null"} (OK)`;
        // Release the lease we just took (cleanup)
        if (data) {
          await sb.from("package_leases").delete().eq("package_id", data).eq("runner_id", "forensic_test_noop");
        }
      }
    } catch (e) {
      passed = false;
      detail = `Exception: ${(e as Error).message}`;
    }

    results.push({
      id: "T17",
      name: "acquire_next_package_lease RPC safety",
      passed,
      severity: "critical",
      detail,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T18: Exam Pool Gate (can_generate_exam_pool RPC)
  // ═══════════════════════════════════════════════════════════════
  {
    let passed = true;
    let detail = "";
    try {
      // Test with a non-existent course_id (should return false, not crash)
      const { data, error } = await sb.rpc("can_generate_exam_pool", {
        p_course_id: "00000000-0000-4000-8000-000000000000",
      });
      if (error) {
        passed = false;
        detail = `RPC error: ${error.message}`;
      } else {
        detail = `Returns ${data} for non-existent course (expected false)`;
        passed = data === false;
      }
    } catch (e) {
      passed = false;
      detail = `Exception: ${(e as Error).message}`;
    }

    results.push({
      id: "T18",
      name: "Exam Pool Gate (RPC Safety)",
      passed,
      severity: "high",
      detail,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T19: Blocked packages without blocked_reason
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: blocked } = await sb
      .from("course_packages")
      .select("id, title, blocked_reason")
      .eq("status", "blocked")
      .limit(20);

    const noReason = (blocked || []).filter((p: any) => !p.blocked_reason);

    results.push({
      id: "T19",
      name: "Blocked Packages Without Reason",
      passed: noReason.length === 0,
      severity: "low",
      detail: noReason.length === 0
        ? `All ${blocked?.length ?? 0} blocked packages have reasons`
        : `${noReason.length} blocked without reason`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // T20: Steps with attempts >= max_attempts but not failed
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: exhausted } = await sb
      .from("package_steps")
      .select("package_id, step_key, status, attempts, max_attempts")
      .not("status", "in", '("done","skipped","failed")')
      .limit(500);

    const overLimit = (exhausted || []).filter((s: any) => s.attempts >= s.max_attempts);

    results.push({
      id: "T20",
      name: "Exhausted Steps Not Marked Failed",
      passed: overLimit.length === 0,
      severity: "high",
      detail: overLimit.length === 0
        ? "No exhausted-but-active steps"
        : `${overLimit.length} step(s) at max attempts but not failed`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const criticalFails = results.filter((r) => !r.passed && r.severity === "critical");
  const health = criticalFails.length > 0 ? "CRITICAL" : failedCount > 3 ? "DEGRADED" : failedCount > 0 ? "WARNING" : "HEALTHY";

  const summary = {
    health,
    tests: results.length,
    passed: passedCount,
    failed: failedCount,
    auto_healed: healed.length,
    heal_actions: healed,
    critical_failures: criticalFails.map((r) => `${r.id}: ${r.detail}`),
  };

  console.info(`[forensic] ${passedCount}/${results.length} passed | ${healed.length} healed | ${health}`);

  return json({ summary, results });
});
