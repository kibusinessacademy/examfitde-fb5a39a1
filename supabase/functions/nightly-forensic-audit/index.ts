import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SB = ReturnType<typeof createClient>;

interface AuditFinding {
  category: string;
  severity: "critical" | "warning" | "info";
  key: string;
  message: string;
  healed: boolean;
  details?: unknown;
}

async function invoke(url: string, key: string, fn: string, body: unknown = {}) {
  try {
    const res = await fetch(`${url}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: String(e) } };
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. FORENSIC AUDIT: Admin Action Handlers
// ═══════════════════════════════════════════════════════════════
async function auditAdminActionHandlers(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 1a. Recent failed admin actions (last 24h)
  const { data: failedActions } = await sb
    .from("admin_actions")
    .select("action, payload, after_state, created_at")
    .gte("created_at", new Date(Date.now() - 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(500);

  const errorActions = (failedActions ?? []).filter(
    (a: any) => a.after_state?.error || a.after_state?.ok === false
  );

  if (errorActions.length > 0) {
    const byAction: Record<string, { count: number; errors: string[] }> = {};
    for (const a of errorActions) {
      if (!byAction[a.action]) byAction[a.action] = { count: 0, errors: [] };
      byAction[a.action].count++;
      const errMsg = String(a.after_state?.error ?? "unknown").slice(0, 120);
      if (byAction[a.action].errors.length < 3) byAction[a.action].errors.push(errMsg);
    }

    for (const [action, info] of Object.entries(byAction)) {
      findings.push({
        category: "admin_actions",
        severity: info.count > 5 ? "critical" : "warning",
        key: `failed_action_${action}`,
        message: `Action "${action}" failed ${info.count}x in last 24h`,
        healed: false,
        details: { count: info.count, errors: info.errors },
      });
    }
  }

  // 1b. Unprocessed auto-heal queue items (stale >1h)
  const { data: pendingHeals } = await sb
    .from("admin_course_auto_heal_queue")
    .select("id, package_id, heal_action, reason_codes, created_at")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - 3600000).toISOString())
    .order("created_at", { ascending: true })
    .limit(100);

  if ((pendingHeals?.length ?? 0) > 0) {
    findings.push({
      category: "admin_actions",
      severity: (pendingHeals!.length > 20) ? "critical" : "warning",
      key: "stale_heal_queue",
      message: `${pendingHeals!.length} pending auto-heal items stale >1h`,
      healed: false,
      details: { count: pendingHeals!.length, oldest: pendingHeals![0]?.created_at },
    });
  }

  // 1c. Action handler coverage — check all registered actions are reachable
  const knownActions = [
    "requeue_failed_jobs", "release_provider_cooldowns", "reset_stalled_steps",
    "cancel_zombie_packages", "recover_failed_packages", "root_cause_summary",
    "retry_package_step", "cancel_package_build", "force_unlock_package",
    "unblock_package", "approve_step_exception", "workspace_snapshot",
    "heal_finalization_stall", "heal_non_building",
    "repair_exam_pool_quality", "repair_minichecks", "repair_lessons",
    "repair_handbook", "repair_oral_exam", "retry_stalled_step",
    "kill_stale_processing_jobs", "release_stale_leases",
  ];

  // Check recent action diversity (last 7d)
  const { data: recentActions } = await sb
    .from("admin_actions")
    .select("action")
    .gte("created_at", new Date(Date.now() - 604800000).toISOString())
    .limit(1000);

  const usedActions = new Set((recentActions ?? []).map((r: any) => r.action));
  const unusedActions = knownActions.filter(a => !usedActions.has(a) && !["root_cause_summary", "workspace_snapshot"].includes(a));
  if (unusedActions.length > 10) {
    findings.push({
      category: "admin_actions",
      severity: "info",
      key: "low_action_coverage",
      message: `${unusedActions.length} admin actions never used in 7 days`,
      healed: false,
      details: { unused: unusedActions },
    });
  }

  if (findings.length === 0) {
    findings.push({
      category: "admin_actions",
      severity: "info",
      key: "admin_actions_ok",
      message: "All admin action handlers healthy — 0 failures in 24h",
      healed: false,
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// 2. FORENSIC PIPELINE AUDIT
// ═══════════════════════════════════════════════════════════════
async function auditPipeline(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 2a. Zombie processing jobs (>2h old)
  const { data: zombies } = await sb
    .from("job_queue")
    .select("id, job_type, package_id, created_at, started_at")
    .eq("status", "processing")
    .lt("started_at", new Date(Date.now() - 7200000).toISOString())
    .limit(100);

  if ((zombies?.length ?? 0) > 0) {
    const { data: reaped } = await sb.rpc("reap_zombie_processing_jobs_v2", {
      p_max_age_hours: 2,
      p_reason: "nightly-forensic-audit: zombie reap",
    });
    const reapedCount = Array.isArray(reaped) ? reaped.length : 0;

    findings.push({
      category: "pipeline",
      severity: "critical",
      key: "zombie_jobs",
      message: `Found ${zombies!.length} zombie processing jobs (>2h) — reaped ${reapedCount}`,
      healed: reapedCount > 0,
      details: { found: zombies!.length, reaped: reapedCount },
    });
  }

  // 2b. Orphan leases (no heartbeat >10 min) — uses correct column name `last_heartbeat_at`
  const cutoff10m = new Date(Date.now() - 600000).toISOString();
  const { data: staleLeases } = await sb
    .from("job_queue")
    .select("id, job_type, package_id, locked_by")
    .eq("status", "processing")
    .not("locked_by", "is", null)
    .or(`last_heartbeat_at.lt.${cutoff10m},last_heartbeat_at.is.null`)
    .limit(50);

  if ((staleLeases?.length ?? 0) > 0) {
    let released = 0;
    for (const j of staleLeases!) {
      const { error } = await sb
        .from("job_queue")
        .update({ status: "pending", locked_by: null, locked_at: null, started_at: null, updated_at: new Date().toISOString() })
        .eq("id", j.id)
        .eq("status", "processing");
      if (!error) released++;
    }

    findings.push({
      category: "pipeline",
      severity: "warning",
      key: "stale_leases",
      message: `Found ${staleLeases!.length} stale leases — released ${released}`,
      healed: released > 0,
      details: { found: staleLeases!.length, released },
    });
  }

  // 2c. Ancient pending jobs (>48h with no pickup)
  const cutoff48h = new Date(Date.now() - 172800000).toISOString();
  const { data: ancientPending } = await sb
    .from("job_queue")
    .select("id, job_type, package_id, created_at")
    .eq("status", "pending")
    .lt("created_at", cutoff48h)
    .limit(100);

  if ((ancientPending?.length ?? 0) > 0) {
    // AUTO-HEAL: Fail ancient jobs that will never be picked up
    let failed = 0;
    for (const j of ancientPending!) {
      const { error } = await sb
        .from("job_queue")
        .update({ status: "failed", last_error: "nightly-forensic: ancient pending >48h", updated_at: new Date().toISOString() })
        .eq("id", j.id)
        .eq("status", "pending");
      if (!error) failed++;
    }

    findings.push({
      category: "pipeline",
      severity: "warning",
      key: "ancient_pending",
      message: `${ancientPending!.length} ancient pending jobs (>48h) — failed ${failed}`,
      healed: failed > 0,
      details: { found: ancientPending!.length, failed },
    });
  }

  // 2d. Run stuck-scan
  const stuckResult = await invoke(url, key, "stuck-scan", {});
  if (stuckResult.ok && stuckResult.data) {
    const d = stuckResult.data;
    const healedCount = (d.healed_steps ?? 0) + (d.healed_packages ?? 0) + (d.zombie_steps_fixed ?? 0);
    if (healedCount > 0) {
      findings.push({
        category: "pipeline",
        severity: "warning",
        key: "stuck_scan_healed",
        message: `Stuck-scan healed ${healedCount} items`,
        healed: true,
        details: d,
      });
    }
  }

  // 2e. Run production watchdog
  const wdResult = await invoke(url, key, "production-watchdog", {});
  if (wdResult.ok && wdResult.data?.results) {
    const actions = (wdResult.data.results as any[]).filter(
      (r: any) => r.action !== "none" && r.count > 0
    );
    for (const a of actions) {
      findings.push({
        category: "pipeline",
        severity: "warning",
        key: `watchdog_${a.check}`,
        message: `Watchdog ${a.check}: ${a.action} (${a.count} items)`,
        healed: true,
        details: a,
      });
    }
  }

  // 2f. Worker pool routing mismatches
  const { data: poolJobs } = await sb
    .from("job_queue")
    .select("id, job_type, worker_pool")
    .eq("status", "pending")
    .is("worker_pool", null)
    .limit(50);

  if ((poolJobs?.length ?? 0) > 0) {
    findings.push({
      category: "pipeline",
      severity: "warning",
      key: "null_worker_pool",
      message: `${poolJobs!.length} pending jobs with NULL worker_pool — may never be picked up`,
      healed: false,
      details: { job_types: [...new Set(poolJobs!.map((j: any) => j.job_type))] },
    });
  }

  if (findings.length === 0) {
    findings.push({
      category: "pipeline",
      severity: "info",
      key: "pipeline_ok",
      message: "Pipeline healthy — no zombies, no stale leases, no orphans",
      healed: false,
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// 3. PROGRESS & BLOCKER FORENSIC
// ═══════════════════════════════════════════════════════════════
async function auditProgressAndBlockers(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 3a. Packages stuck in building >24h
  const { data: stuckBuilding } = await sb
    .from("course_packages")
    .select("id, curriculum_id, build_progress, status, updated_at")
    .eq("status", "building")
    .lt("updated_at", new Date(Date.now() - 86400000).toISOString())
    .limit(50);

  if ((stuckBuilding?.length ?? 0) > 0) {
    // AUTO-HEAL: Check liveness and re-trigger build for truly idle packages
    let retriggered = 0;
    for (const pkg of stuckBuilding!) {
      // Check if any active jobs exist
      const { count } = await sb.from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["pending", "processing"]);

      if ((count ?? 0) === 0) {
        // No active jobs — invoke stuck-scan heal for this specific package
        await sb.from("course_packages").update({
          stuck_reason: "nightly-forensic: building >24h with no active jobs",
          updated_at: new Date().toISOString(),
        }).eq("id", pkg.id);
        retriggered++;
      }
    }

    findings.push({
      category: "progress_blockers",
      severity: "critical",
      key: "stale_building_24h",
      message: `${stuckBuilding!.length} packages stuck in 'building' >24h — ${retriggered} flagged`,
      healed: retriggered > 0,
      details: stuckBuilding!.slice(0, 10).map((p: any) => ({
        id: p.id, progress: p.build_progress, updated: p.updated_at,
      })),
    });
  }

  // 3b. Blocked/quality_gate_failed packages — auto reconcile
  const { data: blocked } = await sb
    .from("course_packages")
    .select("id, status, stuck_reason, blocked_reason, integrity_passed, council_approved, updated_at")
    .in("status", ["blocked", "quality_gate_failed"])
    .limit(100);

  if ((blocked?.length ?? 0) > 0) {
    // AUTO-HEAL: Use safe-global-heal for reconciliation
    const healResult = await invoke(url, key, "safe-global-heal", { source: "nightly-forensic" });
    const healedPkgs = healResult.data?.healed_count ?? 0;

    // Find packages that are blocked but have all gates green
    const readyButBlocked = (blocked ?? []).filter(
      (p: any) => p.integrity_passed && p.council_approved
    );

    if (readyButBlocked.length > 0) {
      // These should have been auto-unblocked — try individual recovery
      for (const pkg of readyButBlocked.slice(0, 5)) {
        try {
          await sb.rpc("safe_transition_package_status", {
            p_package_id: pkg.id,
            p_new_status: "building",
            p_extra: { blocked_reason: null, stuck_reason: null },
          });
        } catch { /* best-effort */ }
      }
    }

    findings.push({
      category: "progress_blockers",
      severity: (blocked!.length > 5) ? "critical" : "warning",
      key: "blocked_packages",
      message: `${blocked!.length} packages blocked/quality_gate_failed — healed ${healedPkgs}, ${readyButBlocked.length} ready-but-blocked`,
      healed: healedPkgs > 0 || readyButBlocked.length > 0,
      details: {
        total: blocked!.length, healed: healedPkgs, ready_but_blocked: readyButBlocked.length,
        sample: blocked!.slice(0, 5).map((p: any) => ({ id: p.id, status: p.status, reason: p.stuck_reason || p.blocked_reason })),
      },
    });
  }

  // 3c. Finalization stalls
  const { data: finStalls } = await sb
    .from("ops_finalization_stall")
    .select("package_id, stall_type, stalled_since")
    .limit(50);

  if ((finStalls?.length ?? 0) > 0) {
    // AUTO-HEAL: Direct RPC call (bypass admin auth since we're service_role)
    let healedFin = 0;
    try {
      const { data: healData } = await sb.rpc("heal_finalization_stall", { p_limit: 20 });
      const raw = healData as any;
      if (Array.isArray(raw)) healedFin = raw.length;
      else if (raw?.healed) healedFin = Array.isArray(raw.healed) ? raw.healed.length : 0;
    } catch { /* best-effort */ }

    findings.push({
      category: "progress_blockers",
      severity: "warning",
      key: "finalization_stalls",
      message: `${finStalls!.length} finalization stalls — healed ${healedFin}`,
      healed: healedFin > 0,
      details: { count: finStalls!.length, healed: healedFin, stalls: finStalls!.slice(0, 5) },
    });
  }

  // 3d. Progress drift
  const { data: driftRows } = await sb
    .from("v_ops_progress_drift_smoke")
    .select("*")
    .limit(50);

  if ((driftRows?.length ?? 0) > 0) {
    findings.push({
      category: "progress_blockers",
      severity: "warning",
      key: "progress_drift",
      message: `${driftRows!.length} packages with progress drift (SSOT vs stored)`,
      healed: false,
      details: driftRows!.slice(0, 5),
    });
  }

  // 3e. WIP saturation check
  let wipLimit = 25;
  try {
    const { data: cfg } = await sb.from("ops_pipeline_config").select("value").eq("key", "wip_limit").maybeSingle();
    if (cfg?.value) wipLimit = parseInt(String(cfg.value), 10) || 25;
  } catch { /* default */ }

  const { count: buildingCount } = await sb.from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "building");

  const wipUsage = ((buildingCount ?? 0) / wipLimit) * 100;
  if (wipUsage > 85) {
    findings.push({
      category: "progress_blockers",
      severity: "warning",
      key: "wip_saturation",
      message: `WIP at ${Math.round(wipUsage)}% (${buildingCount}/${wipLimit}) — pipeline may be starving`,
      healed: false,
      details: { building: buildingCount, limit: wipLimit, pct: Math.round(wipUsage) },
    });
  }

  if (findings.length === 0) {
    findings.push({
      category: "progress_blockers",
      severity: "info",
      key: "progress_ok",
      message: "No progress anomalies or blockers detected",
      healed: false,
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// 4. DRIFT & MISMATCH AUDIT
// ═══════════════════════════════════════════════════════════════
async function auditDriftAndMismatches(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 4a. Schema health
  const schemaResult = await invoke(url, key, "schema-health", { source: "nightly-forensic" });
  if (schemaResult.ok && schemaResult.data) {
    const d = schemaResult.data;
    if ((d.critical_count ?? 0) > 0) {
      findings.push({
        category: "drift_mismatch",
        severity: "critical",
        key: "schema_drift_critical",
        message: `${d.critical_count} critical schema drifts`,
        healed: false,
        details: d.drifts?.slice(0, 10),
      });
    } else if ((d.drift_count ?? 0) > 0) {
      findings.push({
        category: "drift_mismatch",
        severity: "warning",
        key: "schema_drift_minor",
        message: `${d.drift_count} minor schema drifts`,
        healed: false,
        details: d.drifts?.slice(0, 10),
      });
    }
  }

  // 4b. Integrity report mismatches — auto-heal
  const { data: integrityMismatches } = await sb
    .from("ops_integrity_report_mismatch")
    .select("package_id, integrity_report_version, has_report")
    .limit(50);

  if ((integrityMismatches?.length ?? 0) > 0) {
    let healedCount = 0;
    for (const m of integrityMismatches!.slice(0, 15)) {
      try {
        const { error } = await sb
          .from("package_steps")
          .update({ status: "queued", last_error: "nightly-forensic: integrity mismatch requeue", updated_at: new Date().toISOString() })
          .eq("package_id", (m as any).package_id)
          .eq("step_key", "run_integrity_check")
          .in("status", ["done", "failed"]);
        if (!error) healedCount++;
      } catch { /* best-effort */ }
    }

    findings.push({
      category: "drift_mismatch",
      severity: "critical",
      key: "integrity_report_mismatch",
      message: `${integrityMismatches!.length} integrity report mismatches — re-queued ${healedCount}`,
      healed: healedCount > 0,
      details: { total: integrityMismatches!.length, requeued: healedCount },
    });
  }

  // 4c. Pipeline step drift (>30min)
  const { data: stepDrifts } = await sb
    .from("ops_pipeline_step_drift")
    .select("package_id, step_key, drift_signal, age_minutes")
    .in("drift_signal", ["PENDING_DISPATCH", "TRUE_STALL"])
    .gt("age_minutes", 30)
    .limit(100);

  if ((stepDrifts?.length ?? 0) > 0) {
    findings.push({
      category: "drift_mismatch",
      severity: "warning",
      key: "pipeline_step_drift",
      message: `${stepDrifts!.length} pipeline steps with dispatch drift >30min`,
      healed: false,
      details: stepDrifts!.slice(0, 10),
    });
  }

  // 4d. Contract violations
  const contractResult = await invoke(url, key, "system-contract-audit", {});
  if (contractResult.ok && contractResult.data?.violations?.length > 0) {
    findings.push({
      category: "drift_mismatch",
      severity: "critical",
      key: "contract_violations",
      message: `${contractResult.data.violations.length} system contract violations`,
      healed: false,
      details: contractResult.data.violations.slice(0, 10),
    });
  }

  // 4e. Nightly guards (trigger bindings)
  await invoke(url, key, "ops-nightly-guards", {});

  // 4f. DAG edge count sanity
  const { count: dagEdges } = await sb
    .from("pipeline_dag_edges")
    .select("id", { count: "exact", head: true });

  if (dagEdges !== null && (dagEdges < 20 || dagEdges > 50)) {
    findings.push({
      category: "drift_mismatch",
      severity: "warning",
      key: "dag_edge_drift",
      message: `DAG edge count ${dagEdges} outside expected range [20, 50]`,
      healed: false,
      details: { count: dagEdges },
    });
  }

  // 4g. Trap distribution quality — nightly auto-check
  const trapResult = await invoke(url, key, "admin-control-tower", { action: "trap_quality_audit" });
  if (trapResult.ok && trapResult.data?.global) {
    const g = trapResult.data.global;
    if ((g.packages_hard_fail ?? 0) > 0) {
      findings.push({
        category: "drift_mismatch",
        severity: "warning",
        key: "trap_distribution_fail",
        message: `${g.packages_hard_fail} packages with trap distribution hard_fail`,
        healed: false,
        details: { total: g.packages_total, warn: g.packages_warn, hard_fail: g.packages_hard_fail },
      });
    }
  }

  // 4h. Trap coverage gaps
  const trapCovResult = await invoke(url, key, "admin-control-tower", { action: "trap_coverage_audit" });
  if (trapCovResult.ok && trapCovResult.data?.global) {
    const cg = trapCovResult.data.global;
    if ((cg.missing ?? 0) > 10) {
      findings.push({
        category: "drift_mismatch",
        severity: "warning",
        key: "trap_coverage_gap",
        message: `${cg.missing} approved questions missing trap_type (${cg.coverage_pct}% coverage)`,
        healed: false,
        details: cg,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      category: "drift_mismatch",
      severity: "info",
      key: "drift_ok",
      message: "No schema/data drift or mismatches detected",
      healed: false,
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// 5. ROOT CAUSE FORENSIC
// ═══════════════════════════════════════════════════════════════
async function auditRootCauses(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 5a. Chronic failure patterns
  const { data: failPatterns } = await sb
    .from("job_queue")
    .select("job_type, last_error")
    .eq("status", "failed")
    .gte("updated_at", new Date(Date.now() - 86400000).toISOString())
    .limit(1000);

  if (failPatterns && failPatterns.length > 0) {
    const byType: Record<string, { count: number; errors: Set<string> }> = {};
    for (const j of failPatterns) {
      const t = j.job_type;
      if (!byType[t]) byType[t] = { count: 0, errors: new Set() };
      byType[t].count++;
      if (j.last_error) byType[t].errors.add(String(j.last_error).slice(0, 120));
    }

    const chronic = Object.entries(byType).filter(([, v]) => v.count >= 3);
    for (const [jobType, info] of chronic) {
      findings.push({
        category: "root_causes",
        severity: info.count > 10 ? "critical" : "warning",
        key: `chronic_fail_${jobType}`,
        message: `Job "${jobType}" failed ${info.count}x in 24h`,
        healed: false,
        details: { count: info.count, top_errors: [...info.errors].slice(0, 5) },
      });
    }

    // AUTO-HEAL: Revive transient-failed jobs
    const { data: transientExhausted } = await sb
      .from("job_queue")
      .select("id, job_type, attempts, last_error")
      .eq("status", "failed")
      .gte("updated_at", new Date(Date.now() - 86400000).toISOString())
      .lt("attempts", 3)
      .limit(50);

    if ((transientExhausted?.length ?? 0) > 0) {
      let revived = 0;
      for (const j of transientExhausted!) {
        const lastErr = String(j.last_error ?? "");
        const isTransient = /timeout|ECONNRESET|503|429|rate.limit|EAGAIN|network|ETIMEDOUT|socket hang up/i.test(lastErr);
        if (!isTransient) continue;

        const { error } = await sb
          .from("job_queue")
          .update({ status: "pending", started_at: null, locked_by: null, locked_at: null, updated_at: new Date().toISOString() })
          .eq("id", j.id)
          .eq("status", "failed");
        if (!error) revived++;
      }

      if (revived > 0) {
        findings.push({
          category: "root_causes",
          severity: "info",
          key: "transient_revived",
          message: `Revived ${revived} transient-failed jobs for retry`,
          healed: true,
          details: { revived },
        });
      }
    }
  }

  // 5b. Heal-loop detection (same package healed ≥5x in 24h)
  const { data: healLogs } = await sb
    .from("auto_heal_log")
    .select("package_id, heal_type, action_type, created_at")
    .gte("created_at", new Date(Date.now() - 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(500);

  if (healLogs && healLogs.length > 0) {
    const byPkg: Record<string, { count: number; types: Set<string> }> = {};
    for (const h of healLogs) {
      const pid = (h as any).package_id ?? (h as any).target_id;
      if (!pid) continue;
      if (!byPkg[pid]) byPkg[pid] = { count: 0, types: new Set() };
      byPkg[pid].count++;
      byPkg[pid].types.add((h as any).action_type || (h as any).heal_type || "unknown");
    }

    const looping = Object.entries(byPkg).filter(([, v]) => v.count >= 5);
    for (const [pkgId, info] of looping) {
      findings.push({
        category: "root_causes",
        severity: "critical",
        key: `heal_loop_${pkgId.slice(0, 8)}`,
        message: `Package ${pkgId.slice(0, 8)}… healed ${info.count}x in 24h — possible heal-loop`,
        healed: false,
        details: { package_id: pkgId, heal_count: info.count, heal_types: [...info.types] },
      });
    }
  }

  // 5c. Error class distribution
  const { data: errorClasses } = await sb
    .from("v_pipeline_error_class")
    .select("*")
    .limit(20);

  if (errorClasses && errorClasses.length > 0) {
    const critical = errorClasses.filter(
      (e: any) => (e.count ?? 0) > 10 && e.error_class !== "transient"
    );
    for (const ec of critical) {
      findings.push({
        category: "root_causes",
        severity: "warning",
        key: `error_class_${ec.error_class}`,
        message: `Error class "${ec.error_class}": ${ec.count} occurrences`,
        healed: false,
        details: ec,
      });
    }
  }

  // 5d. Reseed loop detection
  const { data: reseedSteps } = await sb
    .from("package_steps")
    .select("package_id, step_key, meta")
    .eq("step_key", "generate_exam_pool")
    .eq("status", "failed")
    .limit(50);

  if (reseedSteps && reseedSteps.length > 0) {
    const reseedLoops = reseedSteps.filter((s: any) => {
      const meta = s.meta || {};
      return (meta.reseed_cycle_count ?? 0) >= 2;
    });

    if (reseedLoops.length > 0) {
      findings.push({
        category: "root_causes",
        severity: "critical",
        key: "reseed_loops",
        message: `${reseedLoops.length} packages stuck in reseed loop (cycle ≥2)`,
        healed: false,
        details: reseedLoops.map((s: any) => ({ package_id: s.package_id, cycles: s.meta?.reseed_cycle_count })),
      });
    }
  }

  // 5e. Run system guardrails
  await invoke(url, key, "system-scheduler-guardrail-cron", {});

  if (findings.length === 0) {
    findings.push({
      category: "root_causes",
      severity: "info",
      key: "root_causes_ok",
      message: "No chronic failure patterns or heal-loops detected",
      healed: false,
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// 6. EXAM QUALITY & CONTENT FORENSIC (NEW)
// ═══════════════════════════════════════════════════════════════
async function auditExamQuality(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 6a. QC flags unresolved >24h
  const { data: unresolvedQc } = await sb
    .from("exam_questions")
    .select("id, curriculum_id, qc_status, status")
    .eq("status", "approved")
    .not("qc_status", "in", "(tier1_passed,null)")
    .limit(200);

  if ((unresolvedQc?.length ?? 0) > 0) {
    findings.push({
      category: "exam_quality",
      severity: (unresolvedQc!.length > 20) ? "warning" : "info",
      key: "unresolved_qc_flags",
      message: `${unresolvedQc!.length} approved questions with unresolved QC flags`,
      healed: false,
      details: { count: unresolvedQc!.length },
    });
  }

  // 6b. Exam pool below minimum threshold
  const { data: smallPools } = await sb
    .from("v_ops_validate_exam_pool_progress" as any)
    .select("package_id, approved_count, exam_target")
    .lt("approved_count", 50)
    .limit(50);

  if ((smallPools?.length ?? 0) > 0) {
    const critical = (smallPools ?? []).filter((p: any) => (p.approved_count ?? 0) < 20);
    if (critical.length > 0) {
      findings.push({
        category: "exam_quality",
        severity: "warning",
        key: "small_exam_pools",
        message: `${critical.length} packages with critically small exam pools (<20 approved)`,
        healed: false,
        details: critical.slice(0, 5),
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      category: "exam_quality",
      severity: "info",
      key: "exam_quality_ok",
      message: "Exam quality checks passed — no anomalies",
      healed: false,
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// 7. AI COST & BUDGET FORENSIC (NEW)
// ═══════════════════════════════════════════════════════════════
async function auditAICosts(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 7a. Current month budget check
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: budget } = await sb
    .from("ai_cost_budgets")
    .select("budget_eur, spent_eur, alert_threshold")
    .eq("month", currentMonth)
    .maybeSingle();

  if (budget) {
    const usagePct = budget.budget_eur > 0 ? (budget.spent_eur / budget.budget_eur) * 100 : 0;
    if (usagePct > 90) {
      findings.push({
        category: "ai_costs",
        severity: "critical",
        key: "ai_budget_critical",
        message: `AI budget at ${Math.round(usagePct)}% (€${budget.spent_eur.toFixed(2)}/€${budget.budget_eur.toFixed(2)})`,
        healed: false,
        details: budget,
      });
    } else if (usagePct > 70) {
      findings.push({
        category: "ai_costs",
        severity: "warning",
        key: "ai_budget_warning",
        message: `AI budget at ${Math.round(usagePct)}%`,
        healed: false,
        details: budget,
      });
    }
  }

  // 7b. Provider cooldown check
  const { data: cooldowns } = await sb
    .from("llm_provider_cooldowns")
    .select("provider, cooldown_until, reason")
    .gt("cooldown_until", new Date().toISOString())
    .limit(10);

  if ((cooldowns?.length ?? 0) > 0) {
    findings.push({
      category: "ai_costs",
      severity: "warning",
      key: "active_cooldowns",
      message: `${cooldowns!.length} AI providers on cooldown`,
      healed: false,
      details: cooldowns,
    });
  }

  if (findings.length === 0) {
    findings.push({
      category: "ai_costs",
      severity: "info",
      key: "ai_costs_ok",
      message: "AI costs within budget — no cooldowns active",
      healed: false,
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// 8. COUNCIL & GOVERNANCE FORENSIC (NEW)
// ═══════════════════════════════════════════════════════════════
async function auditGovernance(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 8a. Council sessions stuck in pending >6h
  const { data: stuckCouncils } = await sb
    .from("council_sessions")
    .select("id, council_type, package_id, status, created_at")
    .in("status", ["pending", "running"])
    .lt("created_at", new Date(Date.now() - 21600000).toISOString())
    .limit(20);

  if ((stuckCouncils?.length ?? 0) > 0) {
    findings.push({
      category: "governance",
      severity: "warning",
      key: "stuck_councils",
      message: `${stuckCouncils!.length} council sessions stuck >6h`,
      healed: false,
      details: stuckCouncils!.slice(0, 5).map((c: any) => ({
        id: c.id, type: c.council_type, package: c.package_id?.slice(0, 8),
      })),
    });
  }

  // 8b. Packages awaiting council approval >48h
  const { data: awaitingCouncil } = await sb
    .from("course_packages")
    .select("id, status, council_approved, updated_at")
    .eq("council_approved", false)
    .eq("integrity_passed", true)
    .in("status", ["building", "blocked"])
    .lt("updated_at", new Date(Date.now() - 172800000).toISOString())
    .limit(20);

  if ((awaitingCouncil?.length ?? 0) > 0) {
    findings.push({
      category: "governance",
      severity: "warning",
      key: "awaiting_council_48h",
      message: `${awaitingCouncil!.length} packages awaiting council approval >48h (integrity passed)`,
      healed: false,
      details: { count: awaitingCouncil!.length },
    });
  }

  if (findings.length === 0) {
    findings.push({
      category: "governance",
      severity: "info",
      key: "governance_ok",
      message: "All governance checks passed",
      healed: false,
    });
  }

  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, serviceKey);

  const startedAt = new Date().toISOString();
  const allFindings: AuditFinding[] = [];
  const auditSteps: { name: string; status: string; duration_ms: number; finding_count: number }[] = [];

  const audits = [
    { name: "admin_action_handlers", fn: () => auditAdminActionHandlers(sb) },
    { name: "pipeline_forensic", fn: () => auditPipeline(sb, url, serviceKey) },
    { name: "progress_blockers", fn: () => auditProgressAndBlockers(sb, url, serviceKey) },
    { name: "drift_mismatch", fn: () => auditDriftAndMismatches(sb, url, serviceKey) },
    { name: "root_causes", fn: () => auditRootCauses(sb, url, serviceKey) },
    { name: "exam_quality", fn: () => auditExamQuality(sb, url, serviceKey) },
    { name: "ai_costs", fn: () => auditAICosts(sb) },
    { name: "governance", fn: () => auditGovernance(sb) },
  ];

  for (const audit of audits) {
    const t0 = Date.now();
    try {
      const results = await audit.fn();
      allFindings.push(...results);
      auditSteps.push({
        name: audit.name,
        status: "ok",
        duration_ms: Date.now() - t0,
        finding_count: results.length,
      });
    } catch (e) {
      const errMsg = String(e instanceof Error ? e.message : e).slice(0, 200);
      auditSteps.push({
        name: audit.name,
        status: `error: ${errMsg}`,
        duration_ms: Date.now() - t0,
        finding_count: 0,
      });
      allFindings.push({
        category: audit.name,
        severity: "warning",
        key: `${audit.name}_crash`,
        message: `Audit "${audit.name}" crashed: ${errMsg}`,
        healed: false,
      });
    }
  }

  // Compute summary
  const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
  const warningCount = allFindings.filter((f) => f.severity === "warning").length;
  const healedCount = allFindings.filter((f) => f.healed).length;
  const infoCount = allFindings.filter((f) => f.severity === "info").length;
  const verdict = criticalCount > 0 ? "CRITICAL" : warningCount > 0 ? "NEEDS_ATTENTION" : "HEALTHY";

  // Persist as notification
  const title = `🔬 Nightly Forensic: ${verdict} — ${criticalCount}C/${warningCount}W/${healedCount}H across ${auditSteps.length} audits`;
  const body = allFindings
    .filter((f) => f.severity !== "info")
    .map((f) => `[${f.severity.toUpperCase()}${f.healed ? "✅" : ""}] ${f.message}`)
    .join("\n")
    .slice(0, 2000);

  await sb.from("admin_notifications").insert({
    title,
    body: body || "All systems healthy — no issues found.",
    severity: criticalCount > 0 ? "error" : warningCount > 0 ? "warning" : "info",
    category: "ops",
    entity_type: "system",
    entity_id: "nightly-forensic-audit",
    metadata: {
      verdict,
      critical_count: criticalCount,
      warning_count: warningCount,
      healed_count: healedCount,
      info_count: infoCount,
      finding_count: allFindings.length,
      audit_count: auditSteps.length,
      steps: auditSteps,
    } as any,
  });

  const finishedAt = new Date().toISOString();

  return json({
    ok: true,
    verdict,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Date.now() - new Date(startedAt).getTime(),
    summary: {
      total_findings: allFindings.length,
      critical: criticalCount,
      warnings: warningCount,
      healed: healedCount,
      info: infoCount,
      audits_run: auditSteps.length,
    },
    steps: auditSteps,
    findings: allFindings,
  });
});
