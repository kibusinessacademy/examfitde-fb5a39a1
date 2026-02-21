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

/**
 * Pipeline Logic Sandbox Test
 * 
 * Simulates various failure scenarios in the pipeline WITHOUT modifying production data.
 * All tests are READ-ONLY queries that verify invariants.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const results: Record<string, { pass: boolean; detail: string; data?: any }> = {};

  const KNOWN_STEPS = [
    'scaffold_learning_course','generate_glossary','auto_seed_exam_blueprints',
    'validate_blueprints','generate_learning_content','validate_learning_content',
    'generate_exam_pool','validate_exam_pool','generate_oral_exam','validate_oral_exam',
    'build_ai_tutor_index','validate_tutor_index','generate_handbook','validate_handbook',
    'quality_council','run_integrity_check','auto_publish'
  ];

  // ─── TEST 1: Step Ordering Completeness ───
  {
    const { data: unknownSteps } = await sb
      .from("package_steps" as any)
      .select("step_key")
      .not("step_key", "in", `(${KNOWN_STEPS.join(",")})`)
      .limit(10);
    
    const unknown = [...new Set((unknownSteps || []).map((r: any) => r.step_key))];
    results["T1_step_rank_completeness"] = {
      pass: unknown.length === 0,
      detail: unknown.length === 0
        ? "All step_keys have a defined rank in the orchestrator"
        : `FAIL: Unknown step_keys without rank: ${unknown.join(", ")}`,
      data: unknown,
    };
  }

  // ─── TEST 2: Glossary Sequencing ───
  // Verify no package has glossary=queued while a later step is already done/running
  {
    const { data: glossaryQueued } = await sb
      .from("package_steps" as any)
      .select("package_id")
      .eq("step_key", "generate_glossary")
      .eq("status", "queued");

    const glossaryIds = glossaryQueued?.map((r: any) => r.package_id) || [];

    let seqViolations: any[] = [];
    if (glossaryIds.length > 0) {
      const { data: laterDone } = await sb
        .from("package_steps" as any)
        .select("package_id, step_key, status")
        .in("package_id", glossaryIds.slice(0, 20))
        .in("step_key", ["generate_learning_content", "generate_exam_pool"])
        .in("status", ["done", "running", "enqueued"]);
      seqViolations = laterDone || [];
    }

    results["T2_glossary_sequencing"] = {
      pass: seqViolations.length === 0,
      detail: seqViolations.length === 0
        ? "No glossary sequencing violations"
        : `FAIL: ${seqViolations.length} packages have glossary=queued but later steps already done`,
      data: seqViolations.slice(0, 5),
    };
  }

  // ─── TEST 3: Zombie Jobs ───
  // Jobs in 'processing' with started_at=NULL (never actually started)
  {
    const { data: zombies } = await sb
      .from("job_queue" as any)
      .select("id, job_type, status, last_error, created_at, locked_at, locked_by, package_id")
      .eq("status", "processing")
      .is("started_at", null);

    results["T3_zombie_jobs"] = {
      pass: (zombies?.length || 0) === 0,
      detail: (zombies?.length || 0) === 0
        ? "No zombie jobs (processing without started_at)"
        : `FAIL: ${zombies!.length} zombie job(s) stuck in processing without ever starting`,
      data: zombies?.slice(0, 3),
    };
  }

  // ─── TEST 4: Orphaned Steps ───
  // Steps in 'running'/'enqueued' whose job_id points to a completed/failed job
  {
    const { data: activeSteps } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, status, job_id")
      .in("status", ["running", "enqueued"])
      .not("job_id", "is", null);

    let orphaned: any[] = [];
    if (activeSteps && activeSteps.length > 0) {
      const jobIds = activeSteps.map((s: any) => s.job_id);
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

    results["T4_orphaned_steps"] = {
      pass: orphaned.length === 0,
      detail: orphaned.length === 0
        ? "No orphaned steps (all active steps have matching active jobs)"
        : `FAIL: ${orphaned.length} step(s) pointing to completed/missing jobs`,
      data: orphaned.slice(0, 5),
    };
  }

  // ─── TEST 5: Data Consistency (done without finished_at) ───
  {
    const { data: inconsistent } = await sb
      .from("package_steps" as any)
      .select("package_id, step_key, status, finished_at")
      .eq("status", "done")
      .is("finished_at", null);

    results["T5_done_without_finished_at"] = {
      pass: (inconsistent?.length || 0) === 0,
      detail: (inconsistent?.length || 0) === 0
        ? "All done steps have finished_at set"
        : `FAIL: ${inconsistent!.length} step(s) marked done without finished_at`,
      data: inconsistent?.slice(0, 5),
    };
  }

  // ─── TEST 6: Double-Claim Prevention ───
  // Multiple pending/processing jobs for same package + job_type
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

    results["T6_double_claim_prevention"] = {
      pass: dupes.length === 0,
      detail: dupes.length === 0
        ? "No duplicate active jobs per package+type"
        : `FAIL: ${dupes.length} package(s) have duplicate active jobs`,
      data: dupes.slice(0, 5),
    };
  }

  // ─── TEST 7: Lease Expiry Alignment ───
  // Active steps without a valid lease = will never be picked up
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

    results["T7_lease_alignment"] = {
      pass: strandedPkgs.length === 0,
      detail: strandedPkgs.length === 0
        ? "All building packages have active leases"
        : `FAIL: ${strandedPkgs.length} building package(s) without lease (stranded)`,
      data: strandedPkgs.slice(0, 5),
    };
  }

  // ─── TEST 8: Trigger Integrity Gate Coverage ───
  // The sync trigger only gates generate_learning_content.
  // Are there other steps that should also be gated?
  {
    const { data: contentSteps } = await sb
      .from("package_steps" as any)
      .select("step_key, status, last_error")
      .eq("status", "done")
      .like("last_error", "%placeholder%");

    results["T8_integrity_gate_coverage"] = {
      pass: (contentSteps?.length || 0) === 0,
      detail: (contentSteps?.length || 0) === 0
        ? "No steps completed despite placeholder warnings"
        : `WARNING: ${contentSteps!.length} step(s) completed with placeholder warnings in last_error`,
      data: contentSteps?.slice(0, 5),
    };
  }

  // ─── TEST 9: claim_pending_jobs overload safety ───
  // Verify the 2-arg version (with lease check) is being used
  {
    const { data: procJobs } = await sb
      .from("job_queue" as any)
      .select("id, locked_by, locked_at")
      .eq("status", "processing");

    const noLock = (procJobs || []).filter((j: any) => !j.locked_by);
    results["T9_claim_uses_lease_guard"] = {
      pass: noLock.length === 0,
      detail: noLock.length === 0
        ? "All processing jobs have locked_by set (2-arg claim version used)"
        : `WARNING: ${noLock.length} processing job(s) without locked_by (1-arg claim version may be in use)`,
      data: noLock.slice(0, 3),
    };
  }

  // ─── SUMMARY ───
  const totalTests = Object.keys(results).length;
  const passed = Object.values(results).filter((r) => r.pass).length;
  const failed = totalTests - passed;

  return json({
    summary: `${passed}/${totalTests} tests passed, ${failed} failed`,
    timestamp: new Date().toISOString(),
    results,
  });
});
