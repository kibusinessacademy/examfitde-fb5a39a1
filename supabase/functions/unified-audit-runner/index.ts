import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-job-runner-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ─── Types ───────────────────────────────────────────────────
interface Finding {
  layer: string;
  check_id: string;
  check_name: string;
  severity: "info" | "warning" | "critical";
  passed: boolean;
  metric_value?: number;
  threshold?: number;
  root_cause_category?: string;
  root_cause_detail?: string;
  root_cause_confidence?: number;
  dependency_chain?: unknown;
  sample_rows?: unknown;
  affected_entities?: unknown[];
  recommended_action?: string;
  action_risk?: "safe" | "guarded" | "manual";
}

interface FixAction {
  finding_check_id: string;
  action_type: string;
  action_risk: "safe" | "guarded" | "manual";
  target_type: string;
  target_id: string;
  before_snapshot: unknown;
  execute: () => Promise<{ after_snapshot: unknown; error?: string }>;
}

type SB = ReturnType<typeof createClient>;

// ─── Score Weights ───────────────────────────────────────────
const WEIGHTS = {
  infra: 0.15,
  pipeline: 0.25,
  data: 0.20,
  content: 0.15,
  didactic: 0.10,
  security: 0.10,
  e2e: 0.05,
};

function computeLayerScore(findings: Finding[], layer: string): number {
  const layerFindings = findings.filter((f) => f.layer === layer);
  if (layerFindings.length === 0) return 100;
  const passed = layerFindings.filter((f) => f.passed).length;
  return Math.round((passed / layerFindings.length) * 100);
}

// ═══════════════════════════════════════════════════════════════
// MODULE 1: INFRASTRUCTURE AUDIT
// ═══════════════════════════════════════════════════════════════
async function auditInfra(sb: SB): Promise<Finding[]> {
  const findings: Finding[] = [];

  // INFRA_001: Job queue backlog
  const { data: backlog } = await sb.rpc("get_job_queue_stats").maybeSingle();
  const pending = backlog?.pending ?? 0;
  const processing = backlog?.processing ?? 0;
  
  // Fallback if RPC doesn't exist
  if (!backlog) {
    const { count: pendingCount } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "queued"]);
    const { count: processingCount } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing");
    
    findings.push({
      layer: "infra",
      check_id: "INFRA_001",
      check_name: "Job queue backlog",
      severity: (pendingCount ?? 0) > 500 ? "critical" : (pendingCount ?? 0) > 200 ? "warning" : "info",
      passed: (pendingCount ?? 0) <= 500,
      metric_value: pendingCount ?? 0,
      threshold: 500,
      recommended_action: "Check runner health if backlog exceeds threshold",
    });

    // INFRA_002: Zombie processing jobs (>2h)
    const { data: zombies } = await sb
      .from("job_queue")
      .select("id, job_type, package_id, started_at")
      .eq("status", "processing")
      .lt("started_at", new Date(Date.now() - 7200_000).toISOString())
      .limit(20);
    
    findings.push({
      layer: "infra",
      check_id: "INFRA_002",
      check_name: "Zombie processing jobs (>2h)",
      severity: (zombies?.length ?? 0) > 0 ? "critical" : "info",
      passed: (zombies?.length ?? 0) === 0,
      metric_value: zombies?.length ?? 0,
      threshold: 0,
      sample_rows: zombies?.slice(0, 5),
      root_cause_category: (zombies?.length ?? 0) > 0 ? "zombie_job" : undefined,
      root_cause_detail: (zombies?.length ?? 0) > 0 ? "Jobs stuck in processing >2h, likely runner crash or timeout" : undefined,
      recommended_action: "Reset zombie jobs to queued",
      action_risk: "safe",
    });

    // INFRA_003: Failed jobs last 24h
    const { count: failedCount } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("updated_at", new Date(Date.now() - 86400_000).toISOString());
    
    findings.push({
      layer: "infra",
      check_id: "INFRA_003",
      check_name: "Failed jobs (24h)",
      severity: (failedCount ?? 0) > 50 ? "critical" : (failedCount ?? 0) > 20 ? "warning" : "info",
      passed: (failedCount ?? 0) <= 50,
      metric_value: failedCount ?? 0,
      threshold: 50,
    });

    // INFRA_004: Duplicate active jobs
    const { data: dupes } = await sb.rpc("check_duplicate_active_jobs");
    const dupeCount = Array.isArray(dupes) ? dupes.length : 0;
    findings.push({
      layer: "infra",
      check_id: "INFRA_004",
      check_name: "Duplicate active jobs",
      severity: dupeCount > 0 ? "warning" : "info",
      passed: dupeCount === 0,
      metric_value: dupeCount,
      threshold: 0,
      sample_rows: dupes?.slice(0, 5),
      recommended_action: dupeCount > 0 ? "Remove duplicate jobs keeping oldest" : undefined,
      action_risk: "safe",
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 2: DATA INTEGRITY AUDIT
// ═══════════════════════════════════════════════════════════════
async function auditData(sb: SB): Promise<Finding[]> {
  const findings: Finding[] = [];

  // DATA_001: Orphan packages (no course)
  const { data: orphanPkgs } = await sb
    .from("course_packages")
    .select("id, title, course_id")
    .is("course_id", null)
    .limit(10);
  
  findings.push({
    layer: "data",
    check_id: "DATA_001",
    check_name: "Orphan packages (no course_id)",
    severity: (orphanPkgs?.length ?? 0) > 0 ? "warning" : "info",
    passed: (orphanPkgs?.length ?? 0) === 0,
    metric_value: orphanPkgs?.length ?? 0,
    threshold: 0,
    sample_rows: orphanPkgs,
  });

  // DATA_002: Published packages with integrity_passed=false
  const { data: badPublished } = await sb
    .from("course_packages")
    .select("id, title, status, integrity_passed")
    .eq("status", "published")
    .eq("integrity_passed", false)
    .limit(10);
  
  findings.push({
    layer: "data",
    check_id: "DATA_002",
    check_name: "Published packages without integrity_passed",
    severity: (badPublished?.length ?? 0) > 0 ? "critical" : "info",
    passed: (badPublished?.length ?? 0) === 0,
    metric_value: badPublished?.length ?? 0,
    threshold: 0,
    sample_rows: badPublished,
    root_cause_category: (badPublished?.length ?? 0) > 0 ? "integrity_bypass" : undefined,
    root_cause_detail: "Package reached published status without passing integrity check",
    recommended_action: "Reset to building and re-run integrity check",
    action_risk: "guarded",
  });

  // DATA_003: Courses marked published with 0 published packages
  const { data: ghostCourses } = await sb.rpc("find_ghost_published_courses");
  if (Array.isArray(ghostCourses)) {
    findings.push({
      layer: "data",
      check_id: "DATA_003",
      check_name: "Ghost-published courses (0 published packages)",
      severity: ghostCourses.length > 0 ? "critical" : "info",
      passed: ghostCourses.length === 0,
      metric_value: ghostCourses.length,
      threshold: 0,
      sample_rows: ghostCourses.slice(0, 10),
      recommended_action: "Revert course status to draft",
      action_risk: "safe",
    });
  }

  // DATA_004: step_status_json sync check
  const { data: stepDrift } = await sb.rpc("check_step_status_json_sync");
  const driftCount = Array.isArray(stepDrift) ? stepDrift.length : 0;
  findings.push({
    layer: "data",
    check_id: "DATA_004",
    check_name: "step_status_json out of sync",
    severity: driftCount > 0 ? "warning" : "info",
    passed: driftCount === 0,
    metric_value: driftCount,
    threshold: 0,
    sample_rows: stepDrift,
    recommended_action: "Re-sync step_status_json from package_steps",
    action_risk: "safe",
  });

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 3: PIPELINE AUDIT
// ═══════════════════════════════════════════════════════════════
async function auditPipeline(sb: SB): Promise<Finding[]> {
  const findings: Finding[] = [];

  // PIPE_001: Stalled steps (running > 30min)
  const { data: stalledSteps } = await sb
    .from("package_steps")
    .select("id, package_id, step_key, status, updated_at")
    .eq("status", "running")
    .lt("updated_at", new Date(Date.now() - 1800_000).toISOString())
    .limit(20);

  findings.push({
    layer: "pipeline",
    check_id: "PIPE_001",
    check_name: "Stalled steps (running > 30min)",
    severity: (stalledSteps?.length ?? 0) > 5 ? "critical" : (stalledSteps?.length ?? 0) > 0 ? "warning" : "info",
    passed: (stalledSteps?.length ?? 0) === 0,
    metric_value: stalledSteps?.length ?? 0,
    threshold: 0,
    sample_rows: stalledSteps?.slice(0, 5),
    root_cause_category: (stalledSteps?.length ?? 0) > 0 ? "stalled_step" : undefined,
    root_cause_detail: "Step marked running but no job activity — likely runner crash",
    recommended_action: "Reset stalled steps to queued",
    action_risk: "safe",
  });

  // PIPE_002: Steps queued but no corresponding active job
  const { data: orphanSteps } = await sb.rpc("find_steps_without_jobs");
  if (Array.isArray(orphanSteps)) {
    findings.push({
      layer: "pipeline",
      check_id: "PIPE_002",
      check_name: "Steps queued/running without active job",
      severity: orphanSteps.length > 5 ? "critical" : orphanSteps.length > 0 ? "warning" : "info",
      passed: orphanSteps.length === 0,
      metric_value: orphanSteps.length,
      threshold: 0,
      sample_rows: orphanSteps.slice(0, 10),
      root_cause_category: orphanSteps.length > 0 ? "missing_job" : undefined,
      root_cause_detail: "Step expects a job consumer but none exists in queue",
      dependency_chain: orphanSteps.length > 0 ? { step: "queued", job: "missing", resolution: "enqueue_job" } : undefined,
      recommended_action: "Enqueue missing jobs for orphan steps",
      action_risk: "safe",
    });
  }

  // PIPE_003: Building packages with all steps done but not published
  const { data: readyButStuck } = await sb
    .from("course_packages")
    .select("id, title, status, integrity_passed")
    .eq("status", "building")
    .eq("integrity_passed", true)
    .limit(10);

  findings.push({
    layer: "pipeline",
    check_id: "PIPE_003",
    check_name: "Building packages with integrity_passed but not done/published",
    severity: (readyButStuck?.length ?? 0) > 0 ? "warning" : "info",
    passed: (readyButStuck?.length ?? 0) === 0,
    metric_value: readyButStuck?.length ?? 0,
    threshold: 0,
    sample_rows: readyButStuck,
    root_cause_category: (readyButStuck?.length ?? 0) > 0 ? "publish_gate_stuck" : undefined,
    root_cause_detail: "Package passed integrity but auto_publish step didn't fire",
    recommended_action: "Check auto_publish step status and re-enqueue if needed",
    action_risk: "guarded",
  });

  // PIPE_004: Packages building > 48h
  const { data: slowBuilds } = await sb
    .from("course_packages")
    .select("id, title, created_at, track")
    .eq("status", "building")
    .lt("created_at", new Date(Date.now() - 172800_000).toISOString())
    .limit(20);

  findings.push({
    layer: "pipeline",
    check_id: "PIPE_004",
    check_name: "Packages building > 48h",
    severity: (slowBuilds?.length ?? 0) > 3 ? "warning" : "info",
    passed: (slowBuilds?.length ?? 0) <= 3,
    metric_value: slowBuilds?.length ?? 0,
    threshold: 3,
    sample_rows: slowBuilds?.slice(0, 5),
  });

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 4: CONTENT AUDIT
// ═══════════════════════════════════════════════════════════════
async function auditContent(sb: SB): Promise<Finding[]> {
  const findings: Finding[] = [];

  // CONT_001: Placeholder lessons in published packages
  const { data: placeholders } = await sb.rpc("count_placeholder_lessons_in_published");
  const phCount = (Array.isArray(placeholders) ? placeholders[0]?.count : placeholders?.count) ?? 0;
  
  findings.push({
    layer: "content",
    check_id: "CONT_001",
    check_name: "Placeholder lessons in published packages",
    severity: phCount > 0 ? "critical" : "info",
    passed: phCount === 0,
    metric_value: phCount,
    threshold: 0,
    recommended_action: "Regenerate content for placeholder lessons",
    action_risk: "guarded",
  });

  // CONT_002: Thin lessons (content < 400 chars) in done/published packages
  const { data: thinLessons } = await sb.rpc("find_thin_lessons", { min_length: 400, p_limit: 20 });
  const thinCount = Array.isArray(thinLessons) ? thinLessons.length : 0;
  
  findings.push({
    layer: "content",
    check_id: "CONT_002",
    check_name: "Thin lessons (< 400 chars)",
    severity: thinCount > 10 ? "warning" : "info",
    passed: thinCount <= 10,
    metric_value: thinCount,
    threshold: 10,
    sample_rows: thinLessons,
  });

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 5: DIDACTIC AUDIT
// ═══════════════════════════════════════════════════════════════
async function auditDidactic(sb: SB): Promise<Finding[]> {
  const findings: Finding[] = [];

  // DIDA_001: Difficulty distribution in approved questions
  const { data: diffDist } = await sb
    .from("exam_questions")
    .select("difficulty")
    .eq("status", "approved");

  if (diffDist) {
    const total = diffDist.length;
    const easy = diffDist.filter((q: any) => ["easy", "leicht"].includes((q.difficulty || "").toLowerCase())).length;
    const hard = diffDist.filter((q: any) => ["hard", "schwer"].includes((q.difficulty || "").toLowerCase())).length;
    const easyPct = total > 0 ? Math.round((easy / total) * 100) : 0;
    const hardPct = total > 0 ? Math.round((hard / total) * 100) : 0;

    findings.push({
      layer: "didactic",
      check_id: "DIDA_001",
      check_name: "Easy question ratio",
      severity: easyPct > 50 ? "warning" : "info",
      passed: easyPct <= 50,
      metric_value: easyPct,
      threshold: 50,
    });

    findings.push({
      layer: "didactic",
      check_id: "DIDA_002",
      check_name: "Hard question ratio (minimum 10%)",
      severity: hardPct < 10 && total > 100 ? "warning" : "info",
      passed: hardPct >= 10 || total <= 100,
      metric_value: hardPct,
      threshold: 10,
    });
  }

  // DIDA_003: Blueprint coverage (competencies without blueprints)
  const { data: bpGaps } = await sb.rpc("check_blueprint_quality_kpis");
  if (bpGaps) {
    const result = Array.isArray(bpGaps) ? bpGaps[0] : bpGaps;
    findings.push({
      layer: "didactic",
      check_id: "DIDA_003",
      check_name: "Blueprint competency coverage",
      severity: (result?.coverage_pct ?? 100) < 90 ? "warning" : "info",
      passed: (result?.coverage_pct ?? 100) >= 90,
      metric_value: result?.coverage_pct ?? 100,
      threshold: 90,
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 6: SECURITY AUDIT
// ═══════════════════════════════════════════════════════════════
async function auditSecurity(sb: SB): Promise<Finding[]> {
  const findings: Finding[] = [];

  // SEC_001: Trigger binding integrity
  const { data: tgData } = await sb.rpc("check_trigger_bindings");
  const tgResult = Array.isArray(tgData) ? tgData[0] : tgData;
  const missingTriggers = tgResult?.missing ?? [];

  findings.push({
    layer: "security",
    check_id: "SEC_001",
    check_name: "Trigger binding integrity",
    severity: missingTriggers.length > 0 ? "critical" : "info",
    passed: missingTriggers.length === 0,
    metric_value: missingTriggers.length,
    threshold: 0,
    sample_rows: missingTriggers,
    root_cause_category: missingTriggers.length > 0 ? "missing_trigger" : undefined,
    recommended_action: "Auto-rebind missing triggers",
    action_risk: "guarded",
  });

  // SEC_002: Nightly pipeline guards
  const { data: guardData, error: guardErr } = await sb.rpc("run_nightly_pipeline_guards");
  const guardResult = guardData as Record<string, unknown> | null;

  findings.push({
    layer: "security",
    check_id: "SEC_002",
    check_name: "Nightly pipeline guards",
    severity: guardErr || guardResult?.all_clear === false ? "critical" : "info",
    passed: !guardErr && guardResult?.all_clear === true,
    metric_value: guardResult?.all_clear ? 1 : 0,
    threshold: 1,
    root_cause_detail: guardErr?.message,
  });

  // SEC_003: Track plausibility
  const { data: trackFlags } = await sb.rpc("audit_track_plausibility", { p_limit: 50 });
  const redFlags = Array.isArray(trackFlags) ? trackFlags.filter((f: any) => f.verdict !== "OK") : [];

  findings.push({
    layer: "security",
    check_id: "SEC_003",
    check_name: "Track plausibility audit",
    severity: redFlags.length > 0 ? "warning" : "info",
    passed: redFlags.length === 0,
    metric_value: redFlags.length,
    threshold: 0,
    sample_rows: redFlags.slice(0, 5),
  });

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 7: E2E AUDIT (lightweight — checks learner data integrity)
// ═══════════════════════════════════════════════════════════════
async function auditE2E(sb: SB): Promise<Finding[]> {
  const findings: Finding[] = [];

  // E2E_001: Active exam sessions without recent activity
  const { data: staleSessions } = await sb
    .from("exam_sessions")
    .select("id, user_id, started_at")
    .eq("status", "active")
    .lt("started_at", new Date(Date.now() - 86400_000 * 7).toISOString())
    .limit(10);

  findings.push({
    layer: "e2e",
    check_id: "E2E_001",
    check_name: "Stale active exam sessions (>7d)",
    severity: (staleSessions?.length ?? 0) > 20 ? "warning" : "info",
    passed: (staleSessions?.length ?? 0) <= 20,
    metric_value: staleSessions?.length ?? 0,
    threshold: 20,
  });

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// SAFE AUTOFIX ENGINE (Level 2)
// ═══════════════════════════════════════════════════════════════
async function executeSafeAutofix(
  sb: SB,
  findings: Finding[],
  runId: string,
  mode: string
): Promise<{ attempted: number; applied: number; skipped: number; failed: number }> {
  if (mode === "report_only") return { attempted: 0, applied: 0, skipped: 0, failed: 0 };

  const stats = { attempted: 0, applied: 0, skipped: 0, failed: 0 };
  const safeFindings = findings.filter(
    (f) => !f.passed && f.action_risk === "safe" && f.recommended_action
  );

  for (const finding of safeFindings) {
    stats.attempted++;
    try {
      let applied = false;

      // INFRA_002: Reset zombie jobs
      if (finding.check_id === "INFRA_002" && Array.isArray(finding.sample_rows)) {
        const zombieIds = (finding.sample_rows as any[]).map((z) => z.id);
        if (zombieIds.length > 0) {
          const before = { zombie_ids: zombieIds, count: zombieIds.length };
          const { error } = await sb
            .from("job_queue")
            .update({ status: "queued", started_at: null })
            .in("id", zombieIds)
            .eq("status", "processing");

          await sb.from("system_audit_actions").insert({
            run_id: runId,
            action_type: "reset_zombie_jobs",
            action_risk: "safe",
            target_type: "job",
            target_id: zombieIds.join(","),
            before_snapshot: before,
            after_snapshot: { reset_to: "queued" },
            status: error ? "failed" : "applied",
            error_message: error?.message,
            executed_at: new Date().toISOString(),
          });
          applied = !error;
        }
      }

      // PIPE_001: Reset stalled steps
      if (finding.check_id === "PIPE_001" && Array.isArray(finding.sample_rows)) {
        const stepIds = (finding.sample_rows as any[]).map((s) => s.id);
        if (stepIds.length > 0) {
          const before = { step_ids: stepIds, count: stepIds.length };
          const { error } = await sb
            .from("package_steps")
            .update({ status: "queued", updated_at: new Date().toISOString() })
            .in("id", stepIds)
            .eq("status", "running");

          await sb.from("system_audit_actions").insert({
            run_id: runId,
            action_type: "reset_stalled_steps",
            action_risk: "safe",
            target_type: "step",
            target_id: stepIds.join(","),
            before_snapshot: before,
            after_snapshot: { reset_to: "queued" },
            status: error ? "failed" : "applied",
            error_message: error?.message,
            executed_at: new Date().toISOString(),
          });
          applied = !error;
        }
      }

      if (applied) stats.applied++;
      else stats.skipped++;
    } catch (err) {
      stats.failed++;
      console.error(`[Audit AutoFix] ${finding.check_id} failed:`, err);
    }
  }

  // Also handle guarded fixes if mode is aggressive
  if (mode === "aggressive_autofix") {
    const guardedFindings = findings.filter(
      (f) => !f.passed && f.action_risk === "guarded"
    );
    for (const finding of guardedFindings) {
      stats.attempted++;
      // Log as skipped — guarded actions require explicit implementation
      await sb.from("system_audit_actions").insert({
        run_id: runId,
        action_type: `guarded_${finding.check_id}`,
        action_risk: "guarded",
        target_type: "system",
        target_id: finding.check_id,
        before_snapshot: { finding },
        status: "skipped",
        executed_at: new Date().toISOString(),
      });
      stats.skipped++;
    }
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  // Auth: Accept service_role key via x-job-runner-key header,
  // OR any valid Supabase JWT (verify_jwt handles this at gateway level).
  // The function always uses service_role internally for writes.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const body = await req.json().catch(() => ({}));
    const scope: string = body.scope ?? "daily";
    const mode: string = body.mode ?? "safe_autofix";
    const targetPackageId: string | null = body.package_id ?? null;

    // Create audit run
    const { data: run, error: runErr } = await sb
      .from("system_audit_runs")
      .insert({
        scope,
        mode,
        target_package_id: targetPackageId,
        status: "running",
      })
      .select("id")
      .single();

    if (runErr || !run) {
      return json({ ok: false, error: `Failed to create audit run: ${runErr?.message}` }, 500);
    }

    const runId = run.id;
    console.log(`[UnifiedAudit] Run ${runId} started — scope=${scope} mode=${mode}`);

    // ── Run all 7 modules in parallel ──
    const [infraF, dataF, pipeF, contentF, didacticF, securityF, e2eF] = await Promise.allSettled([
      auditInfra(sb),
      auditData(sb),
      auditPipeline(sb),
      auditContent(sb),
      auditDidactic(sb),
      auditSecurity(sb),
      auditE2E(sb),
    ]);

    const allFindings: Finding[] = [];
    const extract = (r: PromiseSettledResult<Finding[]>) =>
      r.status === "fulfilled" ? r.value : [];

    allFindings.push(
      ...extract(infraF),
      ...extract(dataF),
      ...extract(pipeF),
      ...extract(contentF),
      ...extract(didacticF),
      ...extract(securityF),
      ...extract(e2eF)
    );

    // ── Persist findings ──
    if (allFindings.length > 0) {
      const findingRows = allFindings.map((f) => ({
        run_id: runId,
        layer: f.layer,
        check_id: f.check_id,
        check_name: f.check_name,
        severity: f.severity,
        passed: f.passed,
        metric_value: f.metric_value,
        threshold: f.threshold,
        root_cause_category: f.root_cause_category,
        root_cause_detail: f.root_cause_detail,
        root_cause_confidence: f.root_cause_confidence,
        dependency_chain: f.dependency_chain,
        sample_rows: f.sample_rows,
        affected_entities: f.affected_entities,
        recommended_action: f.recommended_action,
        action_risk: f.action_risk,
      }));

      await sb.from("system_audit_findings").insert(findingRows);
    }

    // ── Execute safe autofix ──
    const fixStats = await executeSafeAutofix(sb, allFindings, runId, mode);

    // ── Compute scores ──
    const scores = {
      infra: computeLayerScore(allFindings, "infra"),
      pipeline: computeLayerScore(allFindings, "pipeline"),
      data: computeLayerScore(allFindings, "data"),
      content: computeLayerScore(allFindings, "content"),
      didactic: computeLayerScore(allFindings, "didactic"),
      security: computeLayerScore(allFindings, "security"),
      e2e: computeLayerScore(allFindings, "e2e"),
    };

    const healthScore = Math.round(
      scores.infra * WEIGHTS.infra +
      scores.pipeline * WEIGHTS.pipeline +
      scores.data * WEIGHTS.data +
      scores.content * WEIGHTS.content +
      scores.didactic * WEIGHTS.didactic +
      scores.security * WEIGHTS.security +
      scores.e2e * WEIGHTS.e2e
    );

    const totalChecks = allFindings.length;
    const passedChecks = allFindings.filter((f) => f.passed).length;
    const warningChecks = allFindings.filter((f) => !f.passed && f.severity === "warning").length;
    const criticalChecks = allFindings.filter((f) => !f.passed && f.severity === "critical").length;

    // ── Update run with results ──
    await sb
      .from("system_audit_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "completed",
        health_score: healthScore,
        infra_score: scores.infra,
        pipeline_score: scores.pipeline,
        data_score: scores.data,
        content_score: scores.content,
        didactic_score: scores.didactic,
        security_score: scores.security,
        total_checks: totalChecks,
        passed_checks: passedChecks,
        warning_checks: warningChecks,
        critical_checks: criticalChecks,
        autofix_attempted: fixStats.attempted,
        autofix_applied: fixStats.applied,
        autofix_skipped: fixStats.skipped,
        autofix_failed: fixStats.failed,
      })
      .eq("id", runId);

    // ── Notify on critical findings ──
    if (criticalChecks > 0) {
      const critFindings = allFindings
        .filter((f) => !f.passed && f.severity === "critical")
        .map((f) => `${f.check_id}: ${f.check_name} (${f.metric_value})`)
        .join("; ");

      await sb.from("admin_notifications").insert({
        title: `🔴 Audit: ${criticalChecks} critical finding(s) — Health ${healthScore}%`,
        body: critFindings.slice(0, 500),
        severity: "error",
        category: "ops",
        entity_type: "system",
        entity_id: runId,
        metadata: { scores, fix_stats: fixStats },
      });
    }

    console.log(
      `[UnifiedAudit] Run ${runId} complete — Health: ${healthScore}% | ` +
      `Checks: ${totalChecks} (${passedChecks}✅ ${warningChecks}⚠️ ${criticalChecks}❌) | ` +
      `AutoFix: ${fixStats.applied}/${fixStats.attempted}`
    );

    return json({
      ok: true,
      run_id: runId,
      health_score: healthScore,
      scores,
      total_checks: totalChecks,
      passed: passedChecks,
      warnings: warningChecks,
      critical: criticalChecks,
      autofix: fixStats,
      started_at: new Date().toISOString(),
      scope,
      mode,
      findings: allFindings.map((f) => ({
        layer: f.layer,
        check_id: f.check_id,
        check_name: f.check_name,
        severity: f.severity,
        passed: f.passed,
        metric_value: f.metric_value,
        threshold: f.threshold,
        root_cause_category: f.root_cause_category,
        root_cause_detail: f.root_cause_detail,
        recommended_action: f.recommended_action,
        action_risk: f.action_risk,
        sample_rows: f.sample_rows,
      })),
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[UnifiedAudit] Fatal:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
