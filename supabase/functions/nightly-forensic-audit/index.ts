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

// ═══════════════════════════════════════════════════════════════
// FINDING MODEL — enriched with class + actionability
// ═══════════════════════════════════════════════════════════════
interface AuditFinding {
  module: string;
  severity: "critical" | "warning" | "info";
  code: string;
  title: string;
  detail?: string;
  finding_class: "root_cause" | "symptom" | "consequence";
  actionability: "auto_heal" | "investigate" | "structural_fix";
  entity_type?: string;
  entity_id?: string;
  metric_value?: number;
  healed: boolean;
  payload?: unknown;
}

function f(
  module: string,
  severity: AuditFinding["severity"],
  code: string,
  title: string,
  opts: Partial<AuditFinding> = {}
): AuditFinding {
  return {
    module,
    severity,
    code,
    title,
    finding_class: opts.finding_class ?? "symptom",
    actionability: opts.actionability ?? "investigate",
    healed: opts.healed ?? false,
    ...opts,
  };
}

async function invoke(url: string, key: string, fn: string, body: unknown = {}) {
  try {
    const res = await fetch(`${url}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: String(e) } };
  }
}

// ═══════════════════════════════════════════════════════════════
// MODULE TIMEOUT WRAPPER — prevents one module from blocking all
// ═══════════════════════════════════════════════════════════════
async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`AUDIT_MODULE_TIMEOUT: ${label} exceeded ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// ═══════════════════════════════════════════════════════════════
// MODULE 1: ADMIN ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════
async function auditAdminActions(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "admin_actions";

  // 1a. Failed admin actions (24h)
  const { data: failedActions } = await sb
    .from("admin_actions")
    .select("action, after_state, created_at")
    .gte("created_at", new Date(Date.now() - 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(500);

  const errors = (failedActions ?? []).filter((a: any) => a.after_state?.error || a.after_state?.ok === false);
  if (errors.length > 0) {
    const byAction: Record<string, number> = {};
    for (const a of errors) { byAction[a.action] = (byAction[a.action] || 0) + 1; }
    for (const [action, count] of Object.entries(byAction)) {
      findings.push(f(M, count > 5 ? "critical" : "warning", `failed_action_${action}`,
        `Action "${action}" failed ${count}x in 24h`,
        { finding_class: "symptom", metric_value: count, payload: { action, count } }));
    }
  }

  // 1b. Stale auto-heal queue (>1h)
  const { data: pendingHeals } = await sb
    .from("admin_course_auto_heal_queue")
    .select("id, package_id, heal_action, created_at")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - 3600000).toISOString())
    .limit(100);

  if ((pendingHeals?.length ?? 0) > 0) {
    findings.push(f(M, pendingHeals!.length > 20 ? "critical" : "warning", "stale_heal_queue",
      `${pendingHeals!.length} pending auto-heal items stale >1h`,
      { finding_class: "root_cause", actionability: "investigate", metric_value: pendingHeals!.length }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "admin_ok", "Admin action handlers healthy"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 2: PIPELINE FORENSIC
// ═══════════════════════════════════════════════════════════════
async function auditPipeline(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "pipeline";

  // 2a. Zombie processing jobs (>2h)
  const { data: zombies } = await sb.from("job_queue")
    .select("id, job_type, package_id, started_at")
    .eq("status", "processing")
    .lt("started_at", new Date(Date.now() - 7200000).toISOString())
    .limit(100);

  if ((zombies?.length ?? 0) > 0) {
    const { data: reaped } = await sb.rpc("reap_zombie_processing_jobs_v2", {
      p_max_age_hours: 2, p_reason: "nightly-forensic-audit: zombie reap",
    });
    const reapedCount = Array.isArray(reaped) ? reaped.length : 0;
    findings.push(f(M, "critical", "zombie_jobs",
      `${zombies!.length} zombie processing jobs (>2h) — reaped ${reapedCount}`,
      { finding_class: "root_cause", actionability: "auto_heal", healed: reapedCount > 0, metric_value: zombies!.length }));
  }

  // 2b. Orphan leases (no heartbeat >10 min)
  const { data: staleLeases } = await sb.from("job_queue")
    .select("id, job_type, locked_by")
    .eq("status", "processing")
    .not("locked_by", "is", null)
    .or(`last_heartbeat_at.lt.${new Date(Date.now() - 600000).toISOString()},last_heartbeat_at.is.null`)
    .limit(50);

  if ((staleLeases?.length ?? 0) > 0) {
    let released = 0;
    for (const j of staleLeases!) {
      const { error } = await sb.from("job_queue")
        .update({ status: "pending", locked_by: null, locked_at: null, started_at: null, updated_at: new Date().toISOString() })
        .eq("id", j.id).eq("status", "processing");
      if (!error) released++;
    }
    findings.push(f(M, "warning", "stale_leases",
      `${staleLeases!.length} stale leases — released ${released}`,
      { finding_class: "symptom", actionability: "auto_heal", healed: released > 0, metric_value: staleLeases!.length }));
  }

  // 2c. Ancient pending jobs (>48h) — fail them
  const { data: ancient } = await sb.from("job_queue")
    .select("id, job_type").eq("status", "pending")
    .lt("created_at", new Date(Date.now() - 172800000).toISOString()).limit(100);

  if ((ancient?.length ?? 0) > 0) {
    let failed = 0;
    for (const j of ancient!) {
      const { error } = await sb.from("job_queue")
        .update({ status: "failed", last_error: "nightly-forensic: ancient pending >48h", updated_at: new Date().toISOString() })
        .eq("id", j.id).eq("status", "pending");
      if (!error) failed++;
    }
    findings.push(f(M, "warning", "ancient_pending",
      `${ancient!.length} ancient pending jobs (>48h) — failed ${failed}`,
      { finding_class: "consequence", actionability: "auto_heal", healed: failed > 0 }));
  }

  // 2d. NULL worker pool
  const { data: poolJobs } = await sb.from("job_queue").select("id, job_type")
    .eq("status", "pending").is("worker_pool", null).limit(50);
  if ((poolJobs?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "null_worker_pool",
      `${poolJobs!.length} pending jobs with NULL worker_pool`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: poolJobs!.length }));
  }

  // 2e. Stuck-scan + watchdog
  const stuckResult = await invoke(url, key, "stuck-scan", {});
  if (stuckResult.ok && stuckResult.data) {
    const d = stuckResult.data;
    const cnt = (d.healed_steps ?? 0) + (d.healed_packages ?? 0) + (d.zombie_steps_fixed ?? 0);
    if (cnt > 0) findings.push(f(M, "warning", "stuck_scan_healed", `Stuck-scan healed ${cnt} items`, { healed: true, actionability: "auto_heal" }));
  }
  const wdResult = await invoke(url, key, "production-watchdog", {});
  if (wdResult.ok && wdResult.data?.results) {
    for (const a of (wdResult.data.results as any[]).filter((r: any) => r.action !== "none" && r.count > 0)) {
      findings.push(f(M, "warning", `watchdog_${a.check}`, `Watchdog ${a.check}: ${a.action} (${a.count})`, { healed: true, actionability: "auto_heal" }));
    }
  }

  if (findings.length === 0) findings.push(f(M, "info", "pipeline_ok", "Pipeline healthy"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 3: PROGRESS & BLOCKERS
// ═══════════════════════════════════════════════════════════════
async function auditProgressBlockers(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "progress_blockers";

  // 3a. Packages stuck building >24h
  const { data: stuckBuilding } = await sb.from("course_packages")
    .select("id, build_progress, updated_at").eq("status", "building")
    .lt("updated_at", new Date(Date.now() - 86400000).toISOString()).limit(50);

  if ((stuckBuilding?.length ?? 0) > 0) {
    let flagged = 0;
    for (const pkg of stuckBuilding!) {
      const { count } = await sb.from("job_queue").select("id", { count: "exact", head: true })
        .eq("package_id", pkg.id).in("status", ["pending", "processing"]);
      if ((count ?? 0) === 0) {
        await sb.from("course_packages").update({
          stuck_reason: "nightly-forensic: building >24h with no active jobs",
          updated_at: new Date().toISOString(),
        }).eq("id", pkg.id);
        flagged++;
      }
    }
    findings.push(f(M, "critical", "stale_building_24h",
      `${stuckBuilding!.length} packages stuck building >24h — ${flagged} flagged`,
      { finding_class: "root_cause", actionability: "investigate", healed: flagged > 0, metric_value: stuckBuilding!.length }));
  }

  // 3b. Blocked/quality_gate_failed — reconcile
  const { data: blocked } = await sb.from("course_packages")
    .select("id, status, integrity_passed, council_approved")
    .in("status", ["blocked", "quality_gate_failed"]).limit(100);

  if ((blocked?.length ?? 0) > 0) {
    await invoke(url, key, "safe-global-heal", { source: "nightly-forensic" });
    const readyButBlocked = (blocked ?? []).filter((p: any) => p.integrity_passed && p.council_approved);
    for (const pkg of readyButBlocked.slice(0, 5)) {
      try {
        await sb.rpc("safe_transition_package_status", {
          p_package_id: pkg.id, p_new_status: "building", p_extra: { blocked_reason: null, stuck_reason: null },
        });
      } catch { /* best-effort */ }
    }
    findings.push(f(M, blocked!.length > 5 ? "critical" : "warning", "blocked_packages",
      `${blocked!.length} packages blocked — ${readyButBlocked.length} ready-but-blocked`,
      { finding_class: "consequence", actionability: "auto_heal", healed: readyButBlocked.length > 0, metric_value: blocked!.length }));
  }

  // 3c. Finalization stalls
  const { data: finStalls } = await sb.from("ops_finalization_stall").select("package_id").limit(50);
  if ((finStalls?.length ?? 0) > 0) {
    let healed = 0;
    try {
      const { data: d } = await sb.rpc("heal_finalization_stall", { p_limit: 20 });
      healed = Array.isArray(d) ? d.length : (d as any)?.healed?.length ?? 0;
    } catch { /* best-effort */ }
    findings.push(f(M, "warning", "finalization_stalls",
      `${finStalls!.length} finalization stalls — healed ${healed}`,
      { actionability: "auto_heal", healed: healed > 0, metric_value: finStalls!.length }));
  }

  // 3d. Progress drift
  const { data: drifts } = await sb.from("v_ops_progress_drift_smoke").select("*").limit(50);
  if ((drifts?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "progress_drift",
      `${drifts!.length} packages with progress drift`,
      { finding_class: "root_cause", metric_value: drifts!.length }));
  }

  // 3e. WIP saturation
  let wipLimit = 25;
  try {
    const { data: cfg } = await sb.from("ops_pipeline_config").select("value").eq("key", "wip_limit").maybeSingle();
    if (cfg?.value) wipLimit = parseInt(String(cfg.value), 10) || 25;
  } catch { /* default */ }
  const { count: buildingCount } = await sb.from("course_packages").select("id", { count: "exact", head: true }).eq("status", "building");
  const wipPct = ((buildingCount ?? 0) / wipLimit) * 100;
  if (wipPct > 85) {
    findings.push(f(M, "warning", "wip_saturation",
      `WIP at ${Math.round(wipPct)}% (${buildingCount}/${wipLimit})`,
      { metric_value: Math.round(wipPct) }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "progress_ok", "No progress anomalies"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 4: DRIFT & MISMATCH
// ═══════════════════════════════════════════════════════════════
async function auditDrift(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "drift_mismatch";

  // 4a. Schema health
  const schemaResult = await invoke(url, key, "schema-health", { source: "nightly-forensic" });
  if (schemaResult.ok && schemaResult.data) {
    const d = schemaResult.data;
    if ((d.critical_count ?? 0) > 0) findings.push(f(M, "critical", "schema_drift_critical", `${d.critical_count} critical schema drifts`, { finding_class: "root_cause", actionability: "structural_fix" }));
    else if ((d.drift_count ?? 0) > 0) findings.push(f(M, "warning", "schema_drift_minor", `${d.drift_count} minor schema drifts`));
  }

  // 4b. Integrity report mismatches — requeue
  const { data: intMismatches } = await sb.from("ops_integrity_report_mismatch").select("package_id").limit(50);
  if ((intMismatches?.length ?? 0) > 0) {
    let healed = 0;
    for (const m of intMismatches!.slice(0, 15)) {
      const { error } = await sb.from("package_steps")
        .update({ status: "queued", last_error: "nightly-forensic: integrity mismatch", updated_at: new Date().toISOString() })
        .eq("package_id", (m as any).package_id).eq("step_key", "run_integrity_check").in("status", ["done", "failed"]);
      if (!error) healed++;
    }
    findings.push(f(M, "critical", "integrity_mismatch", `${intMismatches!.length} integrity mismatches — requeued ${healed}`,
      { finding_class: "root_cause", actionability: "auto_heal", healed: healed > 0, metric_value: intMismatches!.length }));
  }

  // 4c. Pipeline step drift
  const { data: stepDrifts } = await sb.from("ops_pipeline_step_drift")
    .select("package_id, step_key, drift_signal, age_minutes")
    .in("drift_signal", ["PENDING_DISPATCH", "TRUE_STALL"]).gt("age_minutes", 30).limit(100);
  if ((stepDrifts?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "step_drift", `${stepDrifts!.length} steps with dispatch drift >30min`, { metric_value: stepDrifts!.length }));
  }

  // 4d. Contract violations
  const cResult = await invoke(url, key, "system-contract-audit", {});
  if (cResult.ok && cResult.data?.violations?.length > 0) {
    findings.push(f(M, "critical", "contract_violations", `${cResult.data.violations.length} system contract violations`,
      { finding_class: "root_cause", actionability: "structural_fix" }));
  }

  // 4e. Nightly guards
  await invoke(url, key, "ops-nightly-guards", {});

  // 4f. DAG edge count
  const { count: dagEdges } = await sb.from("pipeline_dag_edges").select("id", { count: "exact", head: true });
  if (dagEdges !== null && (dagEdges < 20 || dagEdges > 50)) {
    findings.push(f(M, "warning", "dag_edge_drift", `DAG edge count ${dagEdges} outside [20, 50]`, { finding_class: "root_cause", metric_value: dagEdges }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "drift_ok", "No drift or mismatches"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 5: ROOT CAUSES
// ═══════════════════════════════════════════════════════════════
async function auditRootCauses(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "root_causes";

  // 5a. Chronic failure patterns
  const { data: failPatterns } = await sb.from("job_queue")
    .select("job_type, last_error").eq("status", "failed")
    .gte("updated_at", new Date(Date.now() - 86400000).toISOString()).limit(1000);

  if (failPatterns && failPatterns.length > 0) {
    const byType: Record<string, { count: number; errors: Set<string> }> = {};
    for (const j of failPatterns) {
      if (!byType[j.job_type]) byType[j.job_type] = { count: 0, errors: new Set() };
      byType[j.job_type].count++;
      if (j.last_error) byType[j.job_type].errors.add(String(j.last_error).slice(0, 120));
    }
    for (const [jt, info] of Object.entries(byType).filter(([, v]) => v.count >= 3)) {
      findings.push(f(M, info.count > 10 ? "critical" : "warning", `chronic_fail_${jt}`,
        `Job "${jt}" failed ${info.count}x in 24h`,
        { finding_class: "root_cause", metric_value: info.count, payload: { errors: [...info.errors].slice(0, 5) } }));
    }

    // Revive transient-failed
    const { data: transient } = await sb.from("job_queue")
      .select("id, last_error").eq("status", "failed")
      .gte("updated_at", new Date(Date.now() - 86400000).toISOString())
      .lt("attempts", 3).limit(50);
    if (transient && transient.length > 0) {
      let revived = 0;
      for (const j of transient) {
        if (!/timeout|ECONNRESET|503|429|rate.limit|EAGAIN|network|ETIMEDOUT/i.test(String(j.last_error ?? ""))) continue;
        const { error } = await sb.from("job_queue")
          .update({ status: "pending", started_at: null, locked_by: null, locked_at: null, updated_at: new Date().toISOString() })
          .eq("id", j.id).eq("status", "failed");
        if (!error) revived++;
      }
      if (revived > 0) findings.push(f(M, "info", "transient_revived", `Revived ${revived} transient-failed jobs`, { actionability: "auto_heal", healed: true, metric_value: revived }));
    }
  }

  // 5b. Heal-loop detection (≥5x in 24h)
  const { data: healLogs } = await sb.from("auto_heal_log")
    .select("target_id, action_type, created_at")
    .gte("created_at", new Date(Date.now() - 86400000).toISOString())
    .order("created_at", { ascending: false }).limit(500);
  if (healLogs && healLogs.length > 0) {
    const byPkg: Record<string, { count: number; types: Set<string> }> = {};
    for (const h of healLogs) {
      const pid = (h as any).target_id;
      if (!pid) continue;
      if (!byPkg[pid]) byPkg[pid] = { count: 0, types: new Set() };
      byPkg[pid].count++;
      byPkg[pid].types.add((h as any).action_type || "unknown");
    }
    for (const [pkgId, info] of Object.entries(byPkg).filter(([, v]) => v.count >= 5)) {
      findings.push(f(M, "critical", `heal_loop_${pkgId.slice(0, 8)}`,
        `Package ${pkgId.slice(0, 8)}… healed ${info.count}x in 24h — heal-loop`,
        { finding_class: "root_cause", entity_type: "package", entity_id: pkgId, metric_value: info.count }));
    }
  }

  // 5c. Reseed loop detection
  const { data: reseedSteps } = await sb.from("package_steps")
    .select("package_id, meta").eq("step_key", "generate_exam_pool").eq("status", "failed").limit(50);
  const reseedLoops = (reseedSteps ?? []).filter((s: any) => (s.meta?.reseed_cycle_count ?? 0) >= 2);
  if (reseedLoops.length > 0) {
    findings.push(f(M, "critical", "reseed_loops", `${reseedLoops.length} packages in reseed loop (cycle ≥2)`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: reseedLoops.length }));
  }

  // 5d. Error class distribution
  const { data: errorClasses } = await sb.from("v_pipeline_error_class").select("*").limit(20);
  for (const ec of (errorClasses ?? []).filter((e: any) => (e.count ?? 0) > 10 && e.error_class !== "transient")) {
    findings.push(f(M, "warning", `error_class_${(ec as any).error_class}`,
      `Error class "${(ec as any).error_class}": ${(ec as any).count} occurrences`,
      { metric_value: (ec as any).count }));
  }

  // 5e. Failed job clusters (NEW — previously unused view)
  const { data: clusters } = await sb.from("v_failed_job_clusters" as any).select("*").limit(20);
  if (clusters && clusters.length > 0) {
    for (const c of clusters.slice(0, 5)) {
      const cl = c as any;
      if ((cl.cluster_size ?? cl.count ?? 0) >= 5) {
        findings.push(f(M, "warning", `fail_cluster_${(cl.error_pattern ?? cl.cluster_key ?? "unknown").slice(0, 30)}`,
          `Failure cluster: ${cl.error_pattern ?? cl.cluster_key} (${cl.cluster_size ?? cl.count} jobs)`,
          { finding_class: "root_cause", metric_value: cl.cluster_size ?? cl.count, payload: cl }));
      }
    }
  }

  await invoke(url, key, "system-scheduler-guardrail-cron", {});
  if (findings.length === 0) findings.push(f(M, "info", "root_causes_ok", "No chronic failures or heal-loops"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 6: EXAM QUALITY & CONTENT
// ═══════════════════════════════════════════════════════════════
async function auditExamQuality(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "exam_quality";

  const { data: qc } = await sb.from("exam_questions")
    .select("id").eq("status", "approved").not("qc_status", "in", "(tier1_passed,null)").limit(200);
  if ((qc?.length ?? 0) > 0) {
    findings.push(f(M, qc!.length > 20 ? "warning" : "info", "unresolved_qc",
      `${qc!.length} approved questions with unresolved QC`, { metric_value: qc!.length }));
  }

  const { data: small } = await sb.from("v_ops_validate_exam_pool_progress" as any)
    .select("package_id, approved_count").lt("approved_count", 20).limit(50);
  if ((small?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "small_pools", `${small!.length} packages with <20 approved questions`,
      { finding_class: "consequence", metric_value: small!.length }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "exam_ok", "Exam quality checks passed"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 7: AI COSTS & BUDGET
// ═══════════════════════════════════════════════════════════════
async function auditAICosts(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "ai_costs";

  // 7a. Monthly budget
  const month = new Date().toISOString().slice(0, 7);
  const { data: budget } = await sb.from("ai_cost_budgets").select("budget_eur, spent_eur").eq("month", month).maybeSingle();
  if (budget) {
    const pct = budget.budget_eur > 0 ? (budget.spent_eur / budget.budget_eur) * 100 : 0;
    if (pct > 70) {
      findings.push(f(M, pct > 90 ? "critical" : "warning", pct > 90 ? "budget_critical" : "budget_warning",
        `AI budget at ${Math.round(pct)}% (€${budget.spent_eur.toFixed(2)}/€${budget.budget_eur.toFixed(2)})`,
        { finding_class: "consequence", metric_value: Math.round(pct) }));
    }
  }

  // 7b. Provider cooldowns
  const { data: cooldowns } = await sb.from("llm_provider_cooldowns")
    .select("provider, reason").gt("cooldown_until", new Date().toISOString()).limit(10);
  if ((cooldowns?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "active_cooldowns", `${cooldowns!.length} AI providers on cooldown`, { metric_value: cooldowns!.length }));
  }

  // 7c. Daily spend trend (NEW)
  const { data: dailySpend } = await sb.from("ai_worker_usage_daily")
    .select("date, cost_eur, errors, runs")
    .gte("date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
    .order("date", { ascending: false }).limit(7);
  if (dailySpend && dailySpend.length >= 3) {
    const costs = dailySpend.map((d: any) => d.cost_eur);
    const avg = costs.reduce((a: number, b: number) => a + b, 0) / costs.length;
    const latest = costs[0];
    if (latest > avg * 2 && latest > 5) {
      findings.push(f(M, "warning", "spend_spike", `Today's AI spend €${latest.toFixed(2)} is ${(latest / avg).toFixed(1)}x the 7d avg (€${avg.toFixed(2)})`,
        { finding_class: "symptom", metric_value: latest }));
    }
  }

  // 7d. Cache hit rate (NEW)
  const { data: cacheStats } = await sb.from("ai_generation_cache")
    .select("hit_count").gte("created_at", new Date(Date.now() - 86400000).toISOString()).limit(500);
  if (cacheStats && cacheStats.length > 0) {
    const totalHits = cacheStats.reduce((s: number, c: any) => s + (c.hit_count || 0), 0);
    const hitRate = cacheStats.length > 0 ? totalHits / cacheStats.length : 0;
    if (hitRate < 0.5) {
      findings.push(f(M, "info", "low_cache_hit_rate",
        `AI cache hit rate ${hitRate.toFixed(2)} — potential optimization opportunity`,
        { metric_value: hitRate }));
    }
  }

  // 7e. Worker policy vs actual budget check (NEW)
  const { data: policies } = await sb.from("ai_worker_policies")
    .select("job_type, max_cost_eur_per_day, enabled").eq("enabled", true).limit(20);
  const { data: todayUsage } = await sb.from("ai_worker_usage_daily")
    .select("job_type, cost_eur").eq("date", new Date().toISOString().slice(0, 10)).limit(50);
  if (policies && todayUsage) {
    for (const p of policies) {
      const usage = todayUsage.find((u: any) => u.job_type === (p as any).job_type);
      if (usage && (usage as any).cost_eur > (p as any).max_cost_eur_per_day * 0.9) {
        findings.push(f(M, "warning", `worker_budget_${(p as any).job_type}`,
          `Worker "${(p as any).job_type}" at ${((usage as any).cost_eur / (p as any).max_cost_eur_per_day * 100).toFixed(0)}% daily budget`,
          { finding_class: "consequence", metric_value: (usage as any).cost_eur }));
      }
    }
  }

  if (findings.length === 0) findings.push(f(M, "info", "costs_ok", "AI costs within budget"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 8: GOVERNANCE
// ═══════════════════════════════════════════════════════════════
async function auditGovernance(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "governance";

  const { data: stuckCouncils } = await sb.from("council_sessions")
    .select("id, council_type, package_id").in("status", ["pending", "running"])
    .lt("created_at", new Date(Date.now() - 21600000).toISOString()).limit(20);
  if ((stuckCouncils?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "stuck_councils", `${stuckCouncils!.length} council sessions stuck >6h`, { metric_value: stuckCouncils!.length }));
  }

  const { data: awaitingCouncil } = await sb.from("course_packages")
    .select("id").eq("council_approved", false).eq("integrity_passed", true)
    .in("status", ["building", "blocked"]).lt("updated_at", new Date(Date.now() - 172800000).toISOString()).limit(20);
  if ((awaitingCouncil?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "awaiting_council_48h", `${awaitingCouncil!.length} packages awaiting council >48h`,
      { finding_class: "root_cause", metric_value: awaitingCouncil!.length }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "governance_ok", "Governance healthy"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 9: WORKER HEALTH
// ═══════════════════════════════════════════════════════════════
async function auditWorkerHealth(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "worker_health";

  const { data: staleWorkers } = await sb.from("worker_heartbeats" as any)
    .select("worker_name, instance_id, last_heartbeat_at")
    .lt("last_heartbeat_at", new Date(Date.now() - 900000).toISOString()).limit(20);
  if ((staleWorkers?.length ?? 0) > 0) {
    findings.push(f(M, staleWorkers!.length > 3 ? "critical" : "warning", "dead_workers",
      `${staleWorkers!.length} workers no heartbeat >15min`,
      { finding_class: "root_cause", metric_value: staleWorkers!.length }));
  }

  // Error rate
  const { data: recentJobs } = await sb.from("job_queue").select("status")
    .gte("updated_at", new Date(Date.now() - 3600000).toISOString())
    .in("status", ["completed", "failed"]).limit(1000);
  if (recentJobs && recentJobs.length >= 10) {
    const failedN = recentJobs.filter((j: any) => j.status === "failed").length;
    const rate = (failedN / recentJobs.length) * 100;
    if (rate > 30) {
      findings.push(f(M, rate > 60 ? "critical" : "warning", "high_error_rate",
        `Job error rate ${Math.round(rate)}% (${failedN}/${recentJobs.length})`,
        { finding_class: "root_cause", metric_value: Math.round(rate) }));
    }
  }

  // Queue depth
  const { count: pending } = await sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
  if ((pending ?? 0) > 100) {
    findings.push(f(M, (pending ?? 0) > 300 ? "critical" : "warning", "job_backlog",
      `${pending} pending jobs in queue`, { metric_value: pending ?? 0 }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "workers_ok", "Workers healthy"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 10: BATCH API HEALTH
// ═══════════════════════════════════════════════════════════════
async function auditBatchApi(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "batch_api";

  const { data: stuck } = await sb.from("llm_batches")
    .select("id, status").in("status", ["uploading", "draft", "submitted"])
    .lt("created_at", new Date(Date.now() - 1800000).toISOString()).limit(20);
  if ((stuck?.length ?? 0) > 0) {
    let healed = 0;
    for (const b of stuck!) {
      if ((b as any).status === "uploading" || (b as any).status === "draft") {
        const { error } = await sb.from("llm_batches")
          .update({ status: "failed", last_error: "nightly-forensic: stale >30min", updated_at: new Date().toISOString() })
          .eq("id", (b as any).id).in("status", ["uploading", "draft"]);
        if (!error) healed++;
      }
    }
    findings.push(f(M, "warning", "stuck_batches", `${stuck!.length} stuck batches — healed ${healed}`,
      { actionability: "auto_heal", healed: healed > 0, metric_value: stuck!.length }));
  }

  const { data: noImport } = await sb.from("llm_batches")
    .select("id").eq("status", "completed").is("results_imported_at" as any, null)
    .lt("completed_at", new Date(Date.now() - 3600000).toISOString()).limit(20);
  if ((noImport?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "import_backlog", `${noImport!.length} completed batches awaiting import >1h`, { metric_value: noImport!.length }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "batch_ok", "Batch API healthy"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 11: CONTENT COMPLETENESS
// ═══════════════════════════════════════════════════════════════
async function auditContentCompleteness(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "content_completeness";

  // 11a. Near-complete stalls (>90%, >6h)
  const { data: nearComplete } = await sb.from("course_packages")
    .select("id, build_progress, updated_at").eq("status", "building")
    .gte("build_progress", 90).lt("updated_at", new Date(Date.now() - 21600000).toISOString()).limit(30);
  if ((nearComplete?.length ?? 0) > 0) {
    let pushed = 0;
    for (const pkg of nearComplete!) {
      const { count } = await sb.from("job_queue").select("id", { count: "exact", head: true })
        .eq("package_id", pkg.id).in("status", ["pending", "processing"]);
      if ((count ?? 0) === 0) {
        await sb.from("course_packages").update({
          stuck_reason: "nightly-forensic: near-complete stall", updated_at: new Date().toISOString(),
        }).eq("id", pkg.id);
        pushed++;
      }
    }
    findings.push(f(M, pushed > 0 ? "warning" : "info", "near_complete_stalled",
      `${nearComplete!.length} packages >90% stalled >6h — ${pushed} pushed`,
      { actionability: "auto_heal", healed: pushed > 0, metric_value: nearComplete!.length }));
  }

  // 11b. False success
  const { data: falseSuccess } = await sb.from("ops_auto_publish_false_success" as any).select("package_id").limit(20);
  if ((falseSuccess?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "false_success", `${falseSuccess!.length} false-success packages`,
      { finding_class: "root_cause", metric_value: falseSuccess!.length }));
  }

  // 11c. Publish-eligible but stuck
  const { data: pubStuck } = await sb.from("ops_publish_eligible_but_stuck" as any).select("package_id").limit(20);
  if ((pubStuck?.length ?? 0) > 0) {
    let healed = 0;
    for (const p of pubStuck!.slice(0, 10)) {
      const { error } = await sb.from("package_steps")
        .update({ status: "queued", last_error: "nightly-forensic: publish-eligible heal", updated_at: new Date().toISOString() })
        .eq("package_id", (p as any).package_id).eq("step_key", "auto_publish").in("status", ["failed", "blocked"]);
      if (!error) healed++;
    }
    findings.push(f(M, "critical", "publish_stuck", `${pubStuck!.length} publish-eligible stuck — healed ${healed}`,
      { finding_class: "root_cause", actionability: "auto_heal", healed: healed > 0, metric_value: pubStuck!.length }));
  }

  // 11d. Step drift heal (>45min PENDING_DISPATCH)
  const { data: stepDrifts } = await sb.from("ops_pipeline_step_drift")
    .select("package_id, step_key, age_minutes")
    .eq("drift_signal", "PENDING_DISPATCH").gt("age_minutes", 45).limit(30);
  if ((stepDrifts?.length ?? 0) > 0) {
    let requeued = 0;
    for (const d of stepDrifts!) {
      const { error } = await sb.from("package_steps")
        .update({ status: "queued", started_at: null, last_error: `nightly-forensic: drift heal (${(d as any).age_minutes}min)`, updated_at: new Date().toISOString() })
        .eq("package_id", (d as any).package_id).eq("step_key", (d as any).step_key).in("status", ["enqueued", "running"]);
      if (!error) requeued++;
    }
    findings.push(f(M, "warning", "step_drift_healed", `${stepDrifts!.length} drift steps — requeued ${requeued}`,
      { actionability: "auto_heal", healed: requeued > 0, metric_value: stepDrifts!.length }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "content_ok", "Content completeness healthy"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 12: SHADOW ZOMBIES & PHANTOM DRIFT (NEW — Wave 1)
// ═══════════════════════════════════════════════════════════════
async function auditShadowZombies(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "shadow_zombies";

  // 12a. Shadow zombies — packages that look alive but do nothing
  const { data: shadowZombies } = await sb.from("v_ops_shadow_zombies" as any).select("*").limit(30);
  if ((shadowZombies?.length ?? 0) > 0) {
    findings.push(f(M, "critical", "shadow_zombies",
      `${shadowZombies!.length} shadow-zombie packages (appear active but no real work)`,
      { finding_class: "root_cause", actionability: "investigate", metric_value: shadowZombies!.length,
        payload: (shadowZombies as any[]).slice(0, 5).map((z: any) => ({ package_id: z.package_id, status: z.status })) }));
  }

  // 12b. Phantom step drift
  const { data: phantomDrift } = await sb.from("ops_phantom_step_drift" as any).select("*").limit(30);
  if ((phantomDrift?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "phantom_step_drift",
      `${phantomDrift!.length} phantom step drifts (steps in wrong state vs package)`,
      { finding_class: "root_cause", metric_value: phantomDrift!.length }));
  }

  // 12c. Re-entry misses
  const { data: reentryMisses } = await sb.from("v_ops_reentry_misses" as any).select("*").limit(30);
  if ((reentryMisses?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "reentry_misses",
      `${reentryMisses!.length} packages with failed re-entry after recovery`,
      { finding_class: "consequence", actionability: "investigate", metric_value: reentryMisses!.length }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "shadow_ok", "No shadow zombies or phantom drift"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 13: HOLLOW COMPLETIONS & THRESHOLD GUARDS (NEW — Wave 1)
// ═══════════════════════════════════════════════════════════════
async function auditHollowCompletions(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "quality_gates";

  // 13a. Hollow completions — steps marked done without real artifacts
  const { data: hollow } = await sb.from("ops_hollow_completions" as any).select("*").limit(50);
  if ((hollow?.length ?? 0) > 0) {
    findings.push(f(M, "critical", "hollow_completions",
      `${hollow!.length} hollow completions (steps "done" without real artifacts)`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: hollow!.length,
        payload: (hollow as any[]).slice(0, 5) }));
  }

  // 13b. Guard threshold rejections
  const { data: rejections } = await sb.from("ops_guard_threshold_rejections" as any).select("*").limit(50);
  if ((rejections?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "threshold_rejections",
      `${rejections!.length} guard threshold rejections (steps blocked by quality gates)`,
      { finding_class: "symptom", metric_value: rejections!.length,
        payload: (rejections as any[]).slice(0, 5) }));
  }

  // 13c. Steps done below threshold
  const { data: belowThreshold } = await sb.from("ops_step_done_below_threshold" as any).select("*").limit(50);
  if ((belowThreshold?.length ?? 0) > 0) {
    findings.push(f(M, "critical", "done_below_threshold",
      `${belowThreshold!.length} steps marked done but below minimum threshold`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: belowThreshold!.length,
        payload: (belowThreshold as any[]).slice(0, 5) }));
  }

  // 13d. Contract integrity summary
  const { data: contracts } = await sb.from("v_contract_integrity_summary" as any).select("*").limit(20);
  if (contracts && contracts.length > 0) {
    const violated = (contracts as any[]).filter((c: any) => c.status === "violated" || c.violations > 0);
    if (violated.length > 0) {
      findings.push(f(M, "critical", "contract_integrity_violated",
        `${violated.length} contract integrity violations`,
        { finding_class: "root_cause", actionability: "structural_fix", metric_value: violated.length, payload: violated.slice(0, 5) }));
    }
  }

  if (findings.length === 0) findings.push(f(M, "info", "quality_gates_ok", "Quality gates healthy — no hollow completions"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 14: EARLY WARNING & PIPELINE ALERTS (NEW — Wave 1)
// ═══════════════════════════════════════════════════════════════
async function auditEarlyWarning(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "early_warning";

  // 14a. Early warning signals
  const { data: warnings } = await sb.from("v_early_warning" as any).select("*").limit(30);
  if ((warnings?.length ?? 0) > 0) {
    for (const w of (warnings as any[]).slice(0, 10)) {
      findings.push(f(M, (w.severity ?? "warning") === "critical" ? "critical" : "warning",
        `ew_${(w.signal_type ?? w.warning_type ?? "unknown").slice(0, 40)}`,
        `Early warning: ${w.title ?? w.description ?? w.signal_type ?? "unknown signal"}`,
        { entity_type: w.entity_type, entity_id: w.entity_id, metric_value: w.metric_value ?? w.count, payload: w }));
    }
  }

  // 14b. Pipeline alerts
  const { data: alerts } = await sb.from("v_pipeline_alerts" as any).select("*").limit(30);
  if ((alerts?.length ?? 0) > 0) {
    for (const a of (alerts as any[]).slice(0, 10)) {
      findings.push(f(M, (a.severity ?? "warning") === "critical" ? "critical" : "warning",
        `alert_${(a.alert_type ?? a.check_name ?? "unknown").slice(0, 40)}`,
        `Pipeline alert: ${a.title ?? a.description ?? a.alert_type ?? "unknown"}`,
        { metric_value: a.count ?? a.metric_value, payload: a }));
    }
  }

  // 14c. Processing stale (jobs processing but no progress)
  const { data: procStale } = await sb.from("ops_processing_stale" as any).select("*").limit(30);
  if ((procStale?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "processing_stale",
      `${procStale!.length} processing-stale jobs (running but no progress)`,
      { finding_class: "symptom", actionability: "auto_heal", metric_value: procStale!.length }));
  }

  // 14d. Processing unlocked (processing without lock = corruption risk)
  const { data: procUnlocked } = await sb.from("ops_processing_unlocked" as any).select("*").limit(30);
  if ((procUnlocked?.length ?? 0) > 0) {
    findings.push(f(M, "critical", "processing_unlocked",
      `${procUnlocked!.length} processing jobs WITHOUT lock (corruption risk!)`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: procUnlocked!.length }));
  }

  // 14e. Queued steps missing jobs
  const { data: queuedNoJob } = await sb.from("ops_queued_steps_missing_job" as any).select("*").limit(50);
  if ((queuedNoJob?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "queued_missing_job",
      `${queuedNoJob!.length} queued steps without corresponding job`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: queuedNoJob!.length }));
  }

  // 14f. Stuck processing (from v_pipeline_stuck_processing)
  const { data: stuckProc } = await sb.from("v_pipeline_stuck_processing" as any).select("*").limit(30);
  if ((stuckProc?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "pipeline_stuck_processing",
      `${stuckProc!.length} stuck processing entries`,
      { finding_class: "symptom", metric_value: stuckProc!.length }));
  }

  // 14g. Step-job drift
  const { data: stepJobDrift } = await sb.from("ops_step_job_drift" as any).select("*").limit(30);
  if ((stepJobDrift?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "step_job_drift",
      `${stepJobDrift!.length} step-job drift entries (step vs job state mismatch)`,
      { finding_class: "root_cause", metric_value: stepJobDrift!.length }));
  }

  // 14h. Step mapping drift
  const { data: mapDrift } = await sb.from("ops_step_mapping_drift" as any).select("*").limit(20);
  if ((mapDrift?.length ?? 0) > 0) {
    findings.push(f(M, "warning", "step_mapping_drift",
      `${mapDrift!.length} step mapping drift (SSOT vs actual)`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: mapDrift!.length }));
  }

  // 14i. Runner integrity
  const { data: runnerInt } = await sb.from("ops_runner_integrity" as any).select("*").limit(20);
  if (runnerInt && runnerInt.length > 0) {
    const issues = (runnerInt as any[]).filter((r: any) => r.status === "violation" || r.issue_count > 0);
    if (issues.length > 0) {
      findings.push(f(M, "warning", "runner_integrity",
        `${issues.length} runner integrity issues`,
        { finding_class: "root_cause", metric_value: issues.length, payload: issues.slice(0, 5) }));
    }
  }

  // 14j. Prereq guard cancelled
  const { data: prereqCanc } = await sb.from("ops_prereq_guard_cancelled" as any).select("*").limit(30);
  if ((prereqCanc?.length ?? 0) > 0) {
    findings.push(f(M, "info", "prereq_cancelled",
      `${prereqCanc!.length} steps cancelled by prerequisite guard`,
      { metric_value: prereqCanc!.length }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "early_warning_ok", "No early warnings or pipeline alerts"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 15: HEAL EFFECTIVENESS & FEEDBACK LOOP (NEW — Wave 2)
// ═══════════════════════════════════════════════════════════════
async function auditHealEffectiveness(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "heal_effectiveness";

  // 15a. Heal effectiveness from dedicated view
  const { data: healEff } = await sb.from("ops_heal_effectiveness" as any).select("*").limit(30);
  if (healEff && healEff.length > 0) {
    for (const h of healEff as any[]) {
      const successRate = h.success_rate ?? h.effectiveness_pct ?? null;
      if (successRate !== null && successRate < 30) {
        findings.push(f(M, "warning", `low_heal_effectiveness_${(h.heal_type ?? h.action_type ?? "unknown").slice(0, 30)}`,
          `Heal "${h.heal_type ?? h.action_type}" has ${successRate}% effectiveness`,
          { finding_class: "root_cause", actionability: "structural_fix", metric_value: successRate,
            payload: { heal_type: h.heal_type ?? h.action_type, total: h.total, succeeded: h.succeeded ?? h.success_count } }));
      }
    }
  }

  // 15b. Heal churn — packages healed but regressed within 24h (from auto_heal_log)
  const { data: recentHeals } = await sb.from("auto_heal_log")
    .select("target_id, action_type, result_status, followup_verdict, created_at")
    .gte("created_at", new Date(Date.now() - 86400000).toISOString())
    .order("created_at", { ascending: false }).limit(500);

  if (recentHeals && recentHeals.length > 0) {
    const churnPkgs: Record<string, { heals: number; regressions: number }> = {};
    for (const h of recentHeals) {
      const pid = (h as any).target_id;
      if (!pid) continue;
      if (!churnPkgs[pid]) churnPkgs[pid] = { heals: 0, regressions: 0 };
      churnPkgs[pid].heals++;
      if ((h as any).followup_verdict === "regressed" || (h as any).followup_verdict === "no_delta") {
        churnPkgs[pid].regressions++;
      }
    }
    const churning = Object.entries(churnPkgs).filter(([, v]) => v.regressions >= 2 && v.heals >= 3);
    if (churning.length > 0) {
      findings.push(f(M, "critical", "heal_churn",
        `${churning.length} packages with heal-churn (healed ≥3x, regressed ≥2x in 24h)`,
        { finding_class: "root_cause", actionability: "investigate", metric_value: churning.length,
          payload: churning.slice(0, 5).map(([id, v]) => ({ package_id: id, ...v })) }));
    }

    // 15c. Overall heal stats
    const totalHeals = recentHeals.length;
    const successHeals = recentHeals.filter((h: any) => h.result_status === "applied" || h.result_status === "success").length;
    const noDeltas = recentHeals.filter((h: any) => h.followup_verdict === "no_delta").length;
    if (totalHeals > 10 && noDeltas / totalHeals > 0.5) {
      findings.push(f(M, "warning", "high_no_delta_rate",
        `${Math.round(noDeltas / totalHeals * 100)}% of heals produced no delta (${noDeltas}/${totalHeals})`,
        { finding_class: "consequence", metric_value: Math.round(noDeltas / totalHeals * 100) }));
    }
  }

  if (findings.length === 0) findings.push(f(M, "info", "heals_ok", "Heal effectiveness healthy"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MODULE 16: TREND ANALYSIS & REGRESSION DETECTION (NEW — Wave 2)
// ═══════════════════════════════════════════════════════════════
async function auditTrends(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "trend_analysis";

  // Read trend view for persistent & relapsed findings
  const { data: trends } = await sb.from("v_audit_finding_trends" as any).select("*").limit(100);
  if (trends && trends.length > 0) {
    const persistent = (trends as any[]).filter((t: any) => t.trend_status === "persistent" && t.max_severity !== "info");
    if (persistent.length > 0) {
      findings.push(f(M, "critical", "persistent_findings",
        `${persistent.length} findings persistent for 3+ days`,
        { finding_class: "root_cause", actionability: "investigate", metric_value: persistent.length,
          payload: persistent.slice(0, 10).map((p: any) => ({
            code: p.finding_code, severity: p.max_severity, occurrences: p.occurrence_count, first_seen: p.first_seen,
          })) }));
    }

    const relapsed = (trends as any[]).filter((t: any) => t.trend_status === "relapsed");
    if (relapsed.length > 0) {
      findings.push(f(M, "warning", "relapsed_findings",
        `${relapsed.length} previously healed findings have relapsed`,
        { finding_class: "consequence", metric_value: relapsed.length,
          payload: relapsed.slice(0, 10).map((r: any) => ({ code: r.finding_code, first_seen: r.first_seen })) }));
    }

    const recentlyHealed = (trends as any[]).filter((t: any) => t.trend_status === "healed" && t.was_ever_healed);
    if (recentlyHealed.length > 0) {
      findings.push(f(M, "info", "recently_healed",
        `${recentlyHealed.length} findings successfully healed`, { metric_value: recentlyHealed.length }));
    }
  }

  if (findings.length === 0) findings.push(f(M, "info", "trends_ok", "No concerning trends detected"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR — Parallel execution with per-module timeout
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, serviceKey);

  const startedAt = new Date();
  const allFindings: AuditFinding[] = [];
  const moduleResults: { name: string; status: string; duration_ms: number; finding_count: number }[] = [];

  // Create audit run record
  const { data: runRow } = await sb.from("nightly_audit_runs").insert({
    started_at: startedAt.toISOString(), status: "running", audit_version: "v2",
  }).select("id").single();
  const runId = runRow?.id;

  const MODULE_TIMEOUT_MS = 45_000; // 45s per module

  // Define all modules
  const modules: { name: string; fn: () => Promise<AuditFinding[]> }[] = [
    { name: "admin_actions", fn: () => auditAdminActions(sb) },
    { name: "pipeline", fn: () => auditPipeline(sb, url, serviceKey) },
    { name: "progress_blockers", fn: () => auditProgressBlockers(sb, url, serviceKey) },
    { name: "drift_mismatch", fn: () => auditDrift(sb, url, serviceKey) },
    { name: "root_causes", fn: () => auditRootCauses(sb, url, serviceKey) },
    { name: "exam_quality", fn: () => auditExamQuality(sb) },
    { name: "ai_costs", fn: () => auditAICosts(sb) },
    { name: "governance", fn: () => auditGovernance(sb) },
    { name: "worker_health", fn: () => auditWorkerHealth(sb) },
    { name: "batch_api", fn: () => auditBatchApi(sb) },
    { name: "content_completeness", fn: () => auditContentCompleteness(sb, url, serviceKey) },
    { name: "shadow_zombies", fn: () => auditShadowZombies(sb) },
    { name: "quality_gates", fn: () => auditHollowCompletions(sb) },
    { name: "early_warning", fn: () => auditEarlyWarning(sb) },
    { name: "heal_effectiveness", fn: () => auditHealEffectiveness(sb) },
    { name: "trend_analysis", fn: () => auditTrends(sb) },
  ];

  // Execute modules in parallel batches (4 at a time for safety)
  const BATCH_SIZE = 4;
  for (let i = 0; i < modules.length; i += BATCH_SIZE) {
    const batch = modules.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (mod) => {
        const t0 = Date.now();
        try {
          const findings = await withTimeout(mod.fn, MODULE_TIMEOUT_MS, mod.name);
          const elapsed = Date.now() - t0;
          moduleResults.push({ name: mod.name, status: elapsed > 30000 ? "slow" : "ok", duration_ms: elapsed, finding_count: findings.length });

          // SLA finding: module took too long
          if (elapsed > 30000) {
            findings.push(f("audit_sla", "warning", `module_slow_${mod.name}`,
              `Audit module "${mod.name}" took ${(elapsed / 1000).toFixed(1)}s (SLA: 30s)`,
              { finding_class: "consequence", metric_value: elapsed }));
          }
          return findings;
        } catch (e) {
          const elapsed = Date.now() - t0;
          const errMsg = String(e instanceof Error ? e.message : e).slice(0, 200);
          moduleResults.push({ name: mod.name, status: `error: ${errMsg}`, duration_ms: elapsed, finding_count: 0 });
          return [f(mod.name, "warning", `${mod.name}_crash`,
            `Module "${mod.name}" crashed: ${errMsg}`,
            { finding_class: "consequence", actionability: "investigate" })] as AuditFinding[];
        }
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") allFindings.push(...r.value);
    }
  }

  // Compute summary
  const criticalCount = allFindings.filter(f => f.severity === "critical").length;
  const warningCount = allFindings.filter(f => f.severity === "warning").length;
  const infoCount = allFindings.filter(f => f.severity === "info").length;
  const healedCount = allFindings.filter(f => f.healed).length;
  const verdict = criticalCount > 0 ? "CRITICAL" : warningCount > 0 ? "NEEDS_ATTENTION" : "HEALTHY";
  const finishedAt = new Date();

  // ═══════════════════════════════════════════════════════════════
  // INCIDENT AGGREGATION — deduplicate findings per entity
  // ═══════════════════════════════════════════════════════════════
  const incidentMap: Record<string, { findings: string[]; maxSeverity: string }> = {};
  for (const finding of allFindings) {
    if (finding.entity_id && finding.severity !== "info") {
      const key = `${finding.entity_type}:${finding.entity_id}`;
      if (!incidentMap[key]) incidentMap[key] = { findings: [], maxSeverity: "info" };
      incidentMap[key].findings.push(finding.code);
      if (finding.severity === "critical") incidentMap[key].maxSeverity = "critical";
      else if (finding.severity === "warning" && incidentMap[key].maxSeverity !== "critical") incidentMap[key].maxSeverity = "warning";
    }
  }
  const incidents = Object.entries(incidentMap)
    .filter(([, v]) => v.findings.length >= 2)
    .map(([entity, v]) => ({ entity, evidences: v.findings, severity: v.maxSeverity }));

  // ═══════════════════════════════════════════════════════════════
  // PERSIST TO HISTORY TABLES
  // ═══════════════════════════════════════════════════════════════
  if (runId) {
    // Update run record
    await sb.from("nightly_audit_runs").update({
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      status: "completed",
      verdict,
      total_findings: allFindings.length,
      critical_findings: criticalCount,
      warning_findings: warningCount,
      info_findings: infoCount,
      healed_count: healedCount,
      module_count: moduleResults.length,
      module_results: moduleResults as any,
      meta: { incidents, audit_version: "v2" } as any,
    }).eq("id", runId);

    // Persist individual findings (batch insert)
    const findingRows = allFindings.map(finding => ({
      run_id: runId,
      module_key: finding.module,
      severity: finding.severity,
      finding_code: finding.code,
      finding_class: finding.finding_class,
      actionability: finding.actionability,
      entity_type: finding.entity_type ?? null,
      entity_id: finding.entity_id ?? null,
      title: finding.title,
      detail: finding.detail ?? null,
      metric_value: finding.metric_value ?? null,
      healed: finding.healed,
      payload: (finding.payload ?? {}) as any,
    }));

    // Insert in chunks of 50
    for (let i = 0; i < findingRows.length; i += 50) {
      await sb.from("nightly_audit_findings").insert(findingRows.slice(i, i + 50));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PERSIST NOTIFICATION (legacy compat)
  // ═══════════════════════════════════════════════════════════════
  const title = `🔬 Nightly Forensic v2: ${verdict} — ${criticalCount}C/${warningCount}W/${healedCount}H across ${moduleResults.length} modules`;
  const body = allFindings
    .filter(finding => finding.severity !== "info")
    .map(finding => `[${finding.severity.toUpperCase()}${finding.healed ? "✅" : ""}] ${finding.title}`)
    .join("\n")
    .slice(0, 2000);

  await sb.from("admin_notifications").insert({
    title, body: body || "All systems healthy.",
    severity: criticalCount > 0 ? "error" : warningCount > 0 ? "warning" : "info",
    category: "ops", entity_type: "system", entity_id: "nightly-forensic-audit",
    metadata: { verdict, criticalCount, warningCount, healedCount, infoCount, run_id: runId, incidents: incidents.slice(0, 10), module_count: moduleResults.length } as any,
  });

  return json({
    ok: true,
    verdict,
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    summary: {
      total_findings: allFindings.length,
      critical: criticalCount,
      warnings: warningCount,
      healed: healedCount,
      info: infoCount,
      modules_run: moduleResults.length,
      incidents: incidents.length,
    },
    incidents: incidents.slice(0, 20),
    modules: moduleResults,
    findings: allFindings,
  });
});
