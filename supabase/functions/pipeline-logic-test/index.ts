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

type TestResult = {
  pass: boolean;
  detail: string;
  severity: 'critical' | 'warning' | 'info';
  healed?: number;
  heal_detail?: string;
  data?: unknown;
};

/**
 * Pipeline Logic Sandbox — v3 with Auto-Heal
 *
 * 19 invariant checks with automatic healing for fixable issues.
 * Heals: T03 zombies, T04 orphaned steps, T05 missing finished_at,
 *        T07 stranded leases, T11 stuck building, T12 stale heartbeats,
 *        T16 job-step sync mismatches, T17 ghost steps
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const results: Record<string, TestResult> = {};
  let totalHealed = 0;

  // ═══════════════════════════════════════════════════════════════
  // T01: Step Rank Completeness
  // ═══════════════════════════════════════════════════════════════
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
        ? "All step_keys have a defined rank"
        : `Unknown step_keys: ${unknown.join(", ")}`,
      data: unknown,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T02: Sequencing Violations
  // ═══════════════════════════════════════════════════════════════
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
    const seqViolations: string[] = [];
    for (const [pkgId, { queued, done }] of pkgSteps) {
      if (queued.length === 0 || done.length === 0) continue;
      if (Math.max(...done) > Math.min(...queued)) seqViolations.push(pkgId);
    }
    results["T02_sequencing_violations"] = {
      pass: seqViolations.length === 0,
      severity: "warning",
      detail: seqViolations.length === 0
        ? "No sequencing violations"
        : `${seqViolations.length} package(s) with sequencing violations`,
      data: seqViolations.slice(0, 10),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T03: Zombie Jobs — AUTO-HEAL: reset to pending
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: zombies } = await sb
      .from("job_queue" as any)
      .select("id, job_type, package_id")
      .eq("status", "processing")
      .is("started_at", null);

    let healed = 0;
    if (zombies && zombies.length > 0) {
      for (const z of zombies) {
        const { error } = await sb.from("job_queue" as any).update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          last_error: "Auto-healed: zombie job (processing without started_at)",
          last_error_code: "ZOMBIE_HEALED",
          updated_at: new Date().toISOString(),
        }).eq("id", z.id);
        if (!error) healed++;
      }
      totalHealed += healed;
    }
    results["T03_zombie_jobs"] = {
      pass: (zombies?.length || 0) === 0,
      severity: "critical",
      detail: (zombies?.length || 0) === 0
        ? "No zombie jobs"
        : `${zombies!.length} zombie job(s) found`,
      healed,
      heal_detail: healed > 0 ? `Reset ${healed} zombie job(s) to pending` : undefined,
      data: zombies?.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T04: Orphaned Steps — AUTO-HEAL: sync step to job status
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: activeSteps } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, status, job_id")
      .in("status", ["running", "enqueued"])
      .not("job_id", "is", null);

    let orphaned: any[] = [];
    let healed = 0;
    if (activeSteps && activeSteps.length > 0) {
      const jobIds = [...new Set(activeSteps.map((s: any) => s.job_id))];
      const { data: jobs } = await sb.from("job_queue" as any).select("id, status").in("id", jobIds);
      const jobMap = new Map((jobs || []).map((j: any) => [j.id, j.status]));

      orphaned = activeSteps.filter((s: any) => {
        const js = jobMap.get(s.job_id);
        return js === "completed" || js === "failed" || js === "cancelled" || !js;
      });

      // Auto-heal: set orphaned steps to 'done' (if job completed) or 'queued' (if job failed/missing)
      for (const s of orphaned) {
        const js = jobMap.get(s.job_id);
        const newStatus = js === "completed" ? "done" : "queued";
        const update: any = {
          status: newStatus,
          updated_at: new Date().toISOString(),
          last_error: `Auto-healed: orphaned step (job was ${js || 'missing'})`,
        };
        if (newStatus === "done") update.finished_at = new Date().toISOString();
        if (newStatus === "queued") update.job_id = null;

        const { error } = await sb.from("package_steps" as any)
          .update(update)
          .eq("package_id", s.package_id)
          .eq("step_key", s.step_key);
        if (!error) healed++;
      }
      totalHealed += healed;
    }
    results["T04_orphaned_steps"] = {
      pass: orphaned.length === 0,
      severity: "critical",
      detail: orphaned.length === 0
        ? "No orphaned steps"
        : `${orphaned.length} orphaned step(s)`,
      healed,
      heal_detail: healed > 0 ? `Synced ${healed} step(s) to their job's final status` : undefined,
      data: orphaned.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T05: Done without finished_at — AUTO-HEAL: set finished_at
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: inconsistent } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, updated_at")
      .eq("status", "done")
      .is("finished_at", null);

    let healed = 0;
    if (inconsistent && inconsistent.length > 0) {
      for (const s of inconsistent) {
        const { error } = await sb.from("package_steps" as any)
          .update({ finished_at: s.updated_at || new Date().toISOString() })
          .eq("package_id", s.package_id)
          .eq("step_key", s.step_key);
        if (!error) healed++;
      }
      totalHealed += healed;
    }
    results["T05_done_without_finished_at"] = {
      pass: (inconsistent?.length || 0) === 0,
      severity: "warning",
      detail: (inconsistent?.length || 0) === 0
        ? "All done steps have finished_at"
        : `${inconsistent!.length} step(s) done without finished_at`,
      healed,
      heal_detail: healed > 0 ? `Set finished_at on ${healed} step(s)` : undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T06: Double-Claim Prevention
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: allActive } = await sb
      .from("job_queue" as any)
      .select("id, package_id, job_type, status, created_at")
      .in("status", ["pending", "processing"]);

    const seen = new Map<string, { id: string; created_at: string }>();
    const dupes: any[] = [];
    let healed = 0;
    for (const j of allActive || []) {
      const key = `${j.package_id}::${j.job_type}`;
      if (seen.has(key)) {
        dupes.push({ package_id: j.package_id, job_type: j.job_type });
        // Cancel the older duplicate
        const existing = seen.get(key)!;
        const cancelId = new Date(j.created_at) < new Date(existing.created_at) ? j.id : existing.id;
        const { error } = await sb.from("job_queue" as any)
          .update({ status: "cancelled", last_error: "Auto-healed: duplicate job cancelled", updated_at: new Date().toISOString() })
          .eq("id", cancelId);
        if (!error) { healed++; totalHealed++; }
      }
      seen.set(key, { id: j.id, created_at: j.created_at });
    }
    results["T06_double_claim"] = {
      pass: dupes.length === 0,
      severity: "critical",
      detail: dupes.length === 0
        ? "No duplicate active jobs"
        : `${dupes.length} duplicate(s) found`,
      healed,
      heal_detail: healed > 0 ? `Cancelled ${healed} duplicate job(s)` : undefined,
      data: dupes.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T07: Lease Alignment — AUTO-HEAL: reset stranded to queued
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: buildingPkgs } = await sb
      .from("course_packages" as any)
      .select("id, title")
      .eq("status", "building");

    let strandedPkgs: any[] = [];
    let healed = 0;
    if (buildingPkgs && buildingPkgs.length > 0) {
      const pkgIds = buildingPkgs.map((p: any) => p.id);
      const { data: leases } = await sb
        .from("package_leases" as any)
        .select("package_id")
        .in("package_id", pkgIds);
      const leaseSet = new Set((leases || []).map((l: any) => l.package_id));

      // Also check for active jobs
      const { data: activeJobs } = await sb
        .from("job_queue" as any)
        .select("package_id")
        .in("package_id", pkgIds)
        .in("status", ["pending", "processing"]);
      const jobSet = new Set((activeJobs || []).map((j: any) => j.package_id));

      strandedPkgs = buildingPkgs.filter((p: any) => !leaseSet.has(p.id) && !jobSet.has(p.id));

      // Auto-heal: packages with no lease AND no active jobs → queued
      for (const p of strandedPkgs) {
        const { error } = await sb.from("course_packages" as any)
          .update({ status: "queued", stuck_reason: null, updated_at: new Date().toISOString() })
          .eq("id", p.id);
        if (!error) { healed++; totalHealed++; }
      }
    }
    results["T07_lease_alignment"] = {
      pass: strandedPkgs.length === 0,
      severity: "critical",
      detail: strandedPkgs.length === 0
        ? "All building packages have leases or active jobs"
        : `${strandedPkgs.length} stranded package(s)`,
      healed,
      heal_detail: healed > 0 ? `Reset ${healed} stranded package(s) to queued` : undefined,
      data: strandedPkgs.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T08: Integrity Gate Coverage
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: contentSteps } = await sb
      .from("package_steps" as any)
      .select("step_key, status, last_error")
      .eq("status", "done")
      .like("last_error", "%placeholder%");
    results["T08_integrity_gate"] = {
      pass: (contentSteps?.length || 0) === 0,
      severity: "warning",
      detail: (contentSteps?.length || 0) === 0
        ? "No steps completed with placeholder warnings"
        : `${contentSteps!.length} step(s) completed with placeholder warnings`,
      data: contentSteps?.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T09: Claim Uses Lease Guard
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: procJobs } = await sb
      .from("job_queue" as any)
      .select("id, locked_by, locked_at")
      .eq("status", "processing");
    const noLock = (procJobs || []).filter((j: any) => !j.locked_by);
    results["T09_claim_lease_guard"] = {
      pass: noLock.length === 0,
      severity: "warning",
      detail: noLock.length === 0
        ? "All processing jobs have locked_by"
        : `${noLock.length} processing job(s) without locked_by`,
      data: noLock.slice(0, 3),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T10: Pipeline Starvation
  // ═══════════════════════════════════════════════════════════════
  {
    const { count: queuedCount } = await sb.from("course_packages" as any).select("id", { count: "exact", head: true }).eq("status", "queued");
    const { count: buildingCount } = await sb.from("course_packages" as any).select("id", { count: "exact", head: true }).eq("status", "building");
    const { count: activeLeases } = await sb.from("package_leases" as any).select("package_id", { count: "exact", head: true }).gt("lease_until", new Date().toISOString());
    const isStarved = (queuedCount ?? 0) > 0 && (buildingCount ?? 0) === 0 && (activeLeases ?? 0) === 0;

    results["T10_starvation"] = {
      pass: !isStarved,
      severity: "critical",
      detail: isStarved
        ? `STARVATION: ${queuedCount} queued, 0 building, 0 leases`
        : `Pipeline flowing: ${queuedCount} queued, ${buildingCount} building, ${activeLeases} leases`,
      data: { queued: queuedCount, building: buildingCount, activeLeases },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T11: Stuck Building — AUTO-HEAL: trigger stuck-scan RPC
  // ═══════════════════════════════════════════════════════════════
  {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: stuckBuilding } = await sb
      .from("course_packages" as any)
      .select("id, title, updated_at")
      .eq("status", "building")
      .lt("updated_at", oneHourAgo);

    let healed = 0;
    if (stuckBuilding && stuckBuilding.length > 0) {
      for (const p of stuckBuilding) {
        // Check if package has active steps
        const { count: activeSteps } = await sb
          .from("package_steps" as any)
          .select("step_key", { count: "exact", head: true })
          .eq("package_id", p.id)
          .in("status", ["running", "enqueued"]);

        if ((activeSteps ?? 0) === 0) {
          // No active steps — safe to reset to queued
          const { error } = await sb.from("course_packages" as any)
            .update({ status: "queued", stuck_reason: "Auto-healed: stuck >1h without active steps", updated_at: new Date().toISOString() })
            .eq("id", p.id);

          // Clean expired leases for this package
          await sb.from("package_leases" as any)
            .delete()
            .eq("package_id", p.id)
            .lt("lease_until", new Date().toISOString());

          if (!error) { healed++; totalHealed++; }
        }
      }
    }
    results["T11_stuck_building"] = {
      pass: (stuckBuilding?.length || 0) === 0,
      severity: "warning",
      detail: (stuckBuilding?.length || 0) === 0
        ? "No stuck building packages"
        : `${stuckBuilding!.length} package(s) stuck >1h`,
      healed,
      heal_detail: healed > 0 ? `Reset ${healed} stuck package(s) to queued` : undefined,
      data: stuckBuilding?.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T12: Stale Heartbeat — AUTO-HEAL: reset step to queued
  // ═══════════════════════════════════════════════════════════════
  {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: staleHB } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, last_heartbeat_at, job_id")
      .eq("status", "running")
      .lt("last_heartbeat_at", tenMinAgo);

    let healed = 0;
    if (staleHB && staleHB.length > 0) {
      for (const s of staleHB) {
        // Reset step to queued so it gets re-picked
        const { error } = await sb.from("package_steps" as any)
          .update({
            status: "queued",
            job_id: null,
            last_error: "Auto-healed: stale heartbeat (>10min)",
            updated_at: new Date().toISOString(),
          })
          .eq("package_id", s.package_id)
          .eq("step_key", s.step_key);

        // Also fail the stale job if it exists
        if (s.job_id) {
          await sb.from("job_queue" as any)
            .update({
              status: "failed",
              last_error: "Auto-healed: step heartbeat stale >10min",
              last_error_code: "STALE_HEARTBEAT",
              updated_at: new Date().toISOString(),
            })
            .eq("id", s.job_id)
            .eq("status", "processing");
        }

        if (!error) { healed++; totalHealed++; }
      }
    }
    results["T12_stale_heartbeat"] = {
      pass: (staleHB?.length || 0) === 0,
      severity: "warning",
      detail: (staleHB?.length || 0) === 0
        ? "No stale heartbeats"
        : `${staleHB!.length} running step(s) with stale heartbeat`,
      healed,
      heal_detail: healed > 0 ? `Reset ${healed} step(s) to queued, failed stale jobs` : undefined,
      data: staleHB?.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T13: WIP Limit Compliance
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: config } = await sb.from("ops_pipeline_config" as any).select("value").eq("key", "wip_limit").maybeSingle();
    const wipLimit = config?.value ? Number(config.value) : 5;
    const { count: currentBuilding } = await sb.from("course_packages" as any).select("id", { count: "exact", head: true }).eq("status", "building");
    results["T13_wip_limit"] = {
      pass: (currentBuilding ?? 0) <= wipLimit,
      severity: "warning",
      detail: (currentBuilding ?? 0) <= wipLimit
        ? `WIP: ${currentBuilding}/${wipLimit}`
        : `WIP EXCEEDED: ${currentBuilding}/${wipLimit}`,
      data: { currentBuilding, wipLimit },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T14: Placeholder Lessons Past Content Gate
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: doneContentSteps } = await sb
      .from("package_steps" as any)
      .select("package_id")
      .eq("step_key", "generate_learning_content")
      .eq("status", "done");

    let placeholderLeaks: any[] = [];
    let healed = 0;
    if (doneContentSteps && doneContentSteps.length > 0) {
      const pkgIds = doneContentSteps.map((s: any) => s.package_id).slice(0, 50);
      const { data: lessons } = await sb
        .from("lessons" as any)
        .select("id, course_id, content")
        .in("course_id", pkgIds)
        .not("content", "is", null);

      for (const l of lessons || []) {
        try {
          const content = typeof l.content === "string" ? JSON.parse(l.content) : l.content;
          if (content?._placeholder === true) {
            placeholderLeaks.push({ lesson_id: l.id, course_id: l.course_id });
          }
        } catch (_) { /* ignore */ }
      }

      // Auto-heal: if placeholders found, reset the content step to queued to re-generate
      if (placeholderLeaks.length > 0) {
        const affectedPkgs = [...new Set(placeholderLeaks.map(l => l.course_id))];
        for (const pkgId of affectedPkgs) {
          const { error } = await sb.from("package_steps" as any)
            .update({
              status: "queued",
              job_id: null,
              finished_at: null,
              last_error: `Auto-healed: ${placeholderLeaks.filter(l => l.course_id === pkgId).length} placeholder lesson(s) found post-gate`,
              updated_at: new Date().toISOString(),
            })
            .eq("package_id", pkgId)
            .eq("step_key", "generate_learning_content");
          if (!error) { healed++; totalHealed++; }
        }
      }
    }
    results["T14_placeholder_past_gate"] = {
      pass: placeholderLeaks.length === 0,
      severity: "critical",
      detail: placeholderLeaks.length === 0
        ? "No placeholder lessons past content gate"
        : `${placeholderLeaks.length} placeholder(s) leaked past gate`,
      healed,
      heal_detail: healed > 0 ? `Reset content step for ${healed} package(s) to re-generate` : undefined,
      data: placeholderLeaks.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T15: Exam Pool Minimum Threshold
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: examDone } = await sb
      .from("package_steps" as any)
      .select("package_id")
      .eq("step_key", "validate_exam_pool")
      .eq("status", "done");

    let belowThreshold: any[] = [];
    if (examDone && examDone.length > 0) {
      for (const s of examDone.slice(0, 20)) {
        const { count } = await sb.from("questions" as any)
          .select("id", { count: "exact", head: true })
          .eq("package_id", s.package_id)
          .eq("status", "approved");
        if ((count ?? 0) < 850) {
          belowThreshold.push({ package_id: s.package_id, approved: count });
        }
      }
    }
    results["T15_exam_pool_threshold"] = {
      pass: belowThreshold.length === 0,
      severity: "warning",
      detail: belowThreshold.length === 0
        ? "All exam pools meet 850 threshold"
        : `${belowThreshold.length} package(s) below 850`,
      data: belowThreshold.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T16: Job-Step Sync Mismatch — AUTO-HEAL
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: runningSteps } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, job_id")
      .eq("status", "running")
      .not("job_id", "is", null);

    let mismatches: any[] = [];
    let healed = 0;
    if (runningSteps && runningSteps.length > 0) {
      const jobIds = runningSteps.map((s: any) => s.job_id);
      const { data: jobs } = await sb.from("job_queue" as any).select("id, status").in("id", jobIds);
      const jobMap = new Map((jobs || []).map((j: any) => [j.id, j.status]));

      mismatches = runningSteps.filter((s: any) => {
        const js = jobMap.get(s.job_id);
        return js && js !== "processing" && js !== "pending";
      });

      for (const s of mismatches) {
        const js = jobMap.get(s.job_id);
        const newStatus = js === "completed" ? "done" : "queued";
        const update: any = {
          status: newStatus,
          updated_at: new Date().toISOString(),
          last_error: `Auto-healed: job was ${js} but step stuck in running`,
        };
        if (newStatus === "done") update.finished_at = new Date().toISOString();
        if (newStatus === "queued") update.job_id = null;

        const { error } = await sb.from("package_steps" as any)
          .update(update)
          .eq("package_id", s.package_id)
          .eq("step_key", s.step_key);
        if (!error) { healed++; totalHealed++; }
      }
    }
    results["T16_job_step_sync"] = {
      pass: mismatches.length === 0,
      severity: "critical",
      detail: mismatches.length === 0
        ? "All running steps synced with jobs"
        : `${mismatches.length} mismatch(es)`,
      healed,
      heal_detail: healed > 0 ? `Synced ${healed} step(s)` : undefined,
      data: mismatches.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T17: Ghost Steps — AUTO-HEAL: reset to queued
  // ═══════════════════════════════════════════════════════════════
  {
    const { data: noJobSteps } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key")
      .in("status", ["running", "enqueued"])
      .is("job_id", null);

    let healed = 0;
    if (noJobSteps && noJobSteps.length > 0) {
      for (const s of noJobSteps) {
        const { error } = await sb.from("package_steps" as any)
          .update({
            status: "queued",
            last_error: "Auto-healed: ghost step (active without job_id)",
            updated_at: new Date().toISOString(),
          })
          .eq("package_id", s.package_id)
          .eq("step_key", s.step_key);
        if (!error) { healed++; totalHealed++; }
      }
    }
    results["T17_ghost_steps"] = {
      pass: (noJobSteps?.length || 0) === 0,
      severity: "critical",
      detail: (noJobSteps?.length || 0) === 0
        ? "No ghost steps"
        : `${noJobSteps!.length} ghost step(s)`,
      healed,
      heal_detail: healed > 0 ? `Reset ${healed} ghost step(s) to queued` : undefined,
      data: noJobSteps?.slice(0, 5),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T18: Watchdog Activity
  // ═══════════════════════════════════════════════════════════════
  {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentHeals } = await sb
      .from("auto_heal_log" as any)
      .select("id, action_type, result_status, created_at")
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(5);

    results["T18_watchdog_active"] = {
      pass: (recentHeals?.length || 0) > 0,
      severity: "info",
      detail: (recentHeals?.length || 0) > 0
        ? `Watchdog active: ${recentHeals!.length} cycle(s) in last hour`
        : "No watchdog cycles in last hour",
      data: recentHeals?.slice(0, 3),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // T19: Lease Expiry Timing
  // ═══════════════════════════════════════════════════════════════
  {
    const now = Date.now();
    const { data: leases } = await sb
      .from("package_leases" as any)
      .select("package_id, lease_until")
      .gt("lease_until", new Date().toISOString());

    const soonExpiring = (leases || []).filter((l: any) =>
      new Date(l.lease_until).getTime() - now < 30_000
    );
    results["T19_lease_expiry_timing"] = {
      pass: soonExpiring.length === 0,
      severity: "info",
      detail: soonExpiring.length === 0
        ? `All ${(leases || []).length} leases have >30s remaining`
        : `${soonExpiring.length} lease(s) expiring in <30s`,
      data: soonExpiring.slice(0, 3),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY + LOG
  // ═══════════════════════════════════════════════════════════════
  const totalTests = Object.keys(results).length;
  const passed = Object.values(results).filter((r) => r.pass).length;
  const failed = totalTests - passed;
  const criticalFails = Object.values(results).filter((r) => !r.pass && r.severity === "critical").length;
  const warnings = Object.values(results).filter((r) => !r.pass && r.severity === "warning").length;
  const health = criticalFails > 0 ? "CRITICAL" : warnings > 0 ? "DEGRADED" : "HEALTHY";

  // Log results + healing to auto_heal_log
  await sb.from("auto_heal_log" as any).insert({
    action_type: "pipeline_logic_test_v3",
    trigger_source: "cron",
    result_status: totalHealed > 0 ? "healed" : (health === "HEALTHY" ? "ok" : "degraded"),
    result_detail: `${passed}/${totalTests} passed, ${totalHealed} auto-healed`,
    metadata: {
      health,
      passed,
      failed,
      critical: criticalFails,
      warnings,
      totalHealed,
      healed_tests: Object.entries(results)
        .filter(([, r]) => (r.healed ?? 0) > 0)
        .map(([k, r]) => ({ test: k, healed: r.healed, detail: r.heal_detail })),
    },
  });

  // Create alert if critical issues found
  if (criticalFails > 0) {
    await sb.from("ops_alerts" as any).insert({
      alert_type: "pipeline_logic_critical",
      severity: "critical",
      title: `Pipeline Logic: ${criticalFails} critical failure(s), ${totalHealed} auto-healed`,
      detail: Object.entries(results)
        .filter(([, r]) => !r.pass && r.severity === "critical")
        .map(([k, r]) => `${k}: ${r.detail}${r.healed ? ` (healed ${r.healed})` : ""}`)
        .join("; "),
      metadata: { results },
    });
  }

  console.log(`[pipeline-logic-test] ${passed}/${totalTests} passed | ${totalHealed} auto-healed | health: ${health}`);

  return json({
    summary: `${passed}/${totalTests} passed | ${criticalFails} critical | ${warnings} warnings | ${totalHealed} auto-healed`,
    timestamp: new Date().toISOString(),
    health,
    totalHealed,
    results,
  });
});
