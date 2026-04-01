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

// ═══════════════════════════════════════════════════════════════
// REMEDIATION ACTION — logged separately from findings
// ═══════════════════════════════════════════════════════════════
interface RemediationAction {
  module_key: string;
  action_key: string;
  entity_type?: string;
  entity_id?: string;
  status: "attempted" | "succeeded" | "skipped" | "failed";
  reason?: string;
  cooldown_key: string;
  payload?: unknown;
}

// ═══════════════════════════════════════════════════════════════
// MODULE RESULT — standardized contract per module
// ═══════════════════════════════════════════════════════════════
interface ModuleResult {
  module: string;
  status: "ok" | "failed" | "timeout" | "partial";
  duration_ms: number;
  findings: AuditFinding[];
  findings_count: number;
  remediation_candidate_count?: number;
  error?: string;
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

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`AUDIT_MODULE_TIMEOUT: ${label} exceeded ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSIS MODULES — READ-ONLY, no mutations
// ═══════════════════════════════════════════════════════════════

// MODULE 1: ADMIN ACTIONS
async function diagAdminActions(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "admin_actions";

  const { data: failedActions } = await sb
    .from("admin_actions")
    .select("action, after_state, created_at")
    .gte("created_at", new Date(Date.now() - 86400000).toISOString())
    .order("created_at", { ascending: false }).limit(500);

  const errors = (failedActions ?? []).filter((a: any) => a.after_state?.error || a.after_state?.ok === false);
  if (errors.length > 0) {
    const byAction: Record<string, number> = {};
    for (const a of errors) byAction[a.action] = (byAction[a.action] || 0) + 1;
    for (const [action, count] of Object.entries(byAction)) {
      findings.push(f(M, count > 5 ? "critical" : "warning", `failed_action_${action}`,
        `Action "${action}" failed ${count}x in 24h`,
        { finding_class: "symptom", metric_value: count, payload: { action, count } }));
    }
  }

  const { data: pendingHeals } = await sb
    .from("admin_course_auto_heal_queue")
    .select("id, package_id, heal_action, created_at")
    .eq("status", "pending").lt("created_at", new Date(Date.now() - 3600000).toISOString()).limit(100);

  if ((pendingHeals?.length ?? 0) > 0)
    findings.push(f(M, pendingHeals!.length > 20 ? "critical" : "warning", "stale_heal_queue",
      `${pendingHeals!.length} pending auto-heal items stale >1h`,
      { finding_class: "root_cause", actionability: "investigate", metric_value: pendingHeals!.length }));

  if (findings.length === 0) findings.push(f(M, "info", "admin_ok", "Admin action handlers healthy"));
  return findings;
}

// MODULE 2: PIPELINE (diagnosis only — no zombie reap, no lease release)
async function diagPipeline(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "pipeline";

  // Zombie processing jobs (>2h) — DETECT only
  const { data: zombies } = await sb.from("job_queue")
    .select("id, job_type, package_id, started_at")
    .eq("status", "processing")
    .lt("started_at", new Date(Date.now() - 7200000).toISOString()).limit(100);
  if ((zombies?.length ?? 0) > 0)
    findings.push(f(M, "critical", "zombie_jobs",
      `${zombies!.length} zombie processing jobs (>2h)`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: zombies!.length,
        payload: zombies!.slice(0, 5).map((z: any) => ({ id: z.id, job_type: z.job_type })) }));

  // Stale leases — DETECT only (heartbeat + started_at checks)
  const { data: staleLeases } = await sb.from("job_queue")
    .select("id, job_type, locked_by, started_at, updated_at")
    .eq("status", "processing").not("locked_by", "is", null)
    .lt("started_at", new Date(Date.now() - 600000).toISOString())
    .lt("updated_at", new Date(Date.now() - 300000).toISOString())
    .or(`last_heartbeat_at.lt.${new Date(Date.now() - 600000).toISOString()},last_heartbeat_at.is.null`)
    .limit(50);
  if ((staleLeases?.length ?? 0) > 0)
    findings.push(f(M, "warning", "stale_leases",
      `${staleLeases!.length} stale leases (no heartbeat >10min, started >10min ago, no update >5min)`,
      { finding_class: "symptom", actionability: "auto_heal", metric_value: staleLeases!.length }));

  // Ancient pending (>48h) — DETECT only
  const { data: ancient } = await sb.from("job_queue")
    .select("id, job_type").eq("status", "pending")
    .lt("created_at", new Date(Date.now() - 172800000).toISOString()).limit(100);
  if ((ancient?.length ?? 0) > 0)
    findings.push(f(M, ancient!.length > 20 ? "critical" : "warning", "ancient_pending",
      `${ancient!.length} ancient pending jobs (>48h)`,
      { finding_class: "consequence", actionability: "auto_heal", metric_value: ancient!.length }));

  // NULL worker pool
  const { data: poolJobs } = await sb.from("job_queue").select("id, job_type")
    .eq("status", "pending").is("worker_pool", null).limit(50);
  if ((poolJobs?.length ?? 0) > 0)
    findings.push(f(M, "warning", "null_worker_pool",
      `${poolJobs!.length} pending jobs with NULL worker_pool`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: poolJobs!.length }));

  if (findings.length === 0) findings.push(f(M, "info", "pipeline_ok", "Pipeline healthy"));
  return findings;
}

// MODULE 3: PROGRESS & BLOCKERS (diagnosis only)
async function diagProgressBlockers(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "progress_blockers";

  const { data: stuckBuilding } = await sb.from("course_packages")
    .select("id, build_progress, updated_at").eq("status", "building")
    .lt("updated_at", new Date(Date.now() - 86400000).toISOString()).limit(50);
  if ((stuckBuilding?.length ?? 0) > 0) {
    // Check which have no active jobs — but don't mutate
    let noJobCount = 0;
    for (const pkg of stuckBuilding!) {
      const { count } = await sb.from("job_queue").select("id", { count: "exact", head: true })
        .eq("package_id", pkg.id).in("status", ["pending", "processing"]);
      if ((count ?? 0) === 0) noJobCount++;
    }
    findings.push(f(M, "critical", "stale_building_24h",
      `${stuckBuilding!.length} packages stuck building >24h (${noJobCount} with no active jobs)`,
      { finding_class: "root_cause", actionability: "investigate", metric_value: stuckBuilding!.length }));
  }

  const { data: blocked } = await sb.from("course_packages")
    .select("id, status, integrity_passed, council_approved")
    .in("status", ["blocked", "quality_gate_failed"]).limit(100);
  if ((blocked?.length ?? 0) > 0) {
    const readyButBlocked = (blocked ?? []).filter((p: any) => p.integrity_passed && p.council_approved);
    findings.push(f(M, blocked!.length > 5 ? "critical" : "warning", "blocked_packages",
      `${blocked!.length} packages blocked — ${readyButBlocked.length} ready-but-blocked`,
      { finding_class: "consequence", actionability: readyButBlocked.length > 0 ? "auto_heal" : "investigate",
        metric_value: blocked!.length,
        payload: readyButBlocked.slice(0, 5).map((p: any) => ({ id: p.id })) }));
  }

  const { data: finStalls } = await sb.from("ops_finalization_stall").select("package_id").limit(50);
  if ((finStalls?.length ?? 0) > 0)
    findings.push(f(M, "warning", "finalization_stalls",
      `${finStalls!.length} finalization stalls`,
      { actionability: "auto_heal", metric_value: finStalls!.length }));

  const { data: drifts } = await sb.from("v_ops_progress_drift_smoke").select("*").limit(50);
  if ((drifts?.length ?? 0) > 0)
    findings.push(f(M, "warning", "progress_drift",
      `${drifts!.length} packages with progress drift`,
      { finding_class: "root_cause", metric_value: drifts!.length }));

  // WIP saturation
  let wipLimit = 25;
  try {
    const { data: cfg } = await sb.from("ops_pipeline_config").select("value").eq("key", "wip_limit").maybeSingle();
    if (cfg?.value) wipLimit = parseInt(String(cfg.value), 10) || 25;
  } catch { /* default */ }
  const { count: buildingCount } = await sb.from("course_packages").select("id", { count: "exact", head: true }).eq("status", "building");
  const wipPct = ((buildingCount ?? 0) / wipLimit) * 100;
  if (wipPct > 85)
    findings.push(f(M, "warning", "wip_saturation",
      `WIP at ${Math.round(wipPct)}% (${buildingCount}/${wipLimit})`,
      { metric_value: Math.round(wipPct) }));

  if (findings.length === 0) findings.push(f(M, "info", "progress_ok", "No progress anomalies"));
  return findings;
}

// MODULE 4: DRIFT & MISMATCH (diagnosis only)
async function diagDrift(sb: SB, url: string, key: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "drift_mismatch";

  const schemaResult = await invoke(url, key, "schema-health", { source: "nightly-forensic" });
  if (schemaResult.ok && schemaResult.data) {
    const d = schemaResult.data;
    if ((d.critical_count ?? 0) > 0) findings.push(f(M, "critical", "schema_drift_critical", `${d.critical_count} critical schema drifts`, { finding_class: "root_cause", actionability: "structural_fix" }));
    else if ((d.drift_count ?? 0) > 0) findings.push(f(M, "warning", "schema_drift_minor", `${d.drift_count} minor schema drifts`));
  }

  const { data: intMismatches } = await sb.from("ops_integrity_report_mismatch").select("package_id").limit(50);
  if ((intMismatches?.length ?? 0) > 0)
    findings.push(f(M, "critical", "integrity_mismatch", `${intMismatches!.length} integrity mismatches`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: intMismatches!.length }));

  const { data: stepDrifts } = await sb.from("ops_pipeline_step_drift")
    .select("package_id, step_key, drift_signal, age_minutes")
    .in("drift_signal", ["PENDING_DISPATCH", "TRUE_STALL"]).gt("age_minutes", 30).limit(100);
  if ((stepDrifts?.length ?? 0) > 0)
    findings.push(f(M, "warning", "step_drift", `${stepDrifts!.length} steps with dispatch drift >30min`, { metric_value: stepDrifts!.length }));

  const cResult = await invoke(url, key, "system-contract-audit", {});
  if (cResult.ok && cResult.data?.violations?.length > 0)
    findings.push(f(M, "critical", "contract_violations", `${cResult.data.violations.length} system contract violations`,
      { finding_class: "root_cause", actionability: "structural_fix" }));

  const { count: dagEdges } = await sb.from("pipeline_dag_edges").select("id", { count: "exact", head: true });
  if (dagEdges !== null && (dagEdges < 20 || dagEdges > 50))
    findings.push(f(M, "warning", "dag_edge_drift", `DAG edge count ${dagEdges} outside [20, 50]`, { finding_class: "root_cause", metric_value: dagEdges }));

  if (findings.length === 0) findings.push(f(M, "info", "drift_ok", "No drift or mismatches"));
  return findings;
}

// MODULE 5: ROOT CAUSES (diagnosis only — no revives)
async function diagRootCauses(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "root_causes";

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

    // Detect transient-revivable (but don't revive — that's remediation)
    const transient = failPatterns.filter(j =>
      (j as any).last_error && /timeout|ECONNRESET|503|429|rate.limit|EAGAIN|network|ETIMEDOUT/i.test(String((j as any).last_error))
    );
    if (transient.length > 0)
      findings.push(f(M, "info", "transient_revivable",
        `${transient.length} failed jobs appear transient-revivable`,
        { actionability: "auto_heal", metric_value: transient.length }));
  }

  // Heal-loop detection (≥5x in 24h)
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
    for (const [pkgId, info] of Object.entries(byPkg).filter(([, v]) => v.count >= 5))
      findings.push(f(M, "critical", `heal_loop_${pkgId.slice(0, 8)}`,
        `Package ${pkgId.slice(0, 8)}… healed ${info.count}x in 24h — heal-loop`,
        { finding_class: "root_cause", entity_type: "package", entity_id: pkgId, metric_value: info.count }));
  }

  // Reseed loops
  const { data: reseedSteps } = await sb.from("package_steps")
    .select("package_id, meta").eq("step_key", "generate_exam_pool").eq("status", "failed").limit(50);
  const reseedLoops = (reseedSteps ?? []).filter((s: any) => (s.meta?.reseed_cycle_count ?? 0) >= 2);
  if (reseedLoops.length > 0)
    findings.push(f(M, "critical", "reseed_loops", `${reseedLoops.length} packages in reseed loop (cycle ≥2)`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: reseedLoops.length }));

  // Error class distribution
  const { data: errorClasses } = await sb.from("v_pipeline_error_class").select("*").limit(20);
  for (const ec of (errorClasses ?? []).filter((e: any) => (e.count ?? 0) > 10 && e.error_class !== "transient"))
    findings.push(f(M, "warning", `error_class_${(ec as any).error_class}`,
      `Error class "${(ec as any).error_class}": ${(ec as any).count} occurrences`,
      { metric_value: (ec as any).count }));

  // Failed job clusters
  const { data: clusters } = await sb.from("v_failed_job_clusters" as any).select("*").limit(20);
  if (clusters && clusters.length > 0)
    for (const c of clusters.slice(0, 5)) {
      const cl = c as any;
      if ((cl.cluster_size ?? cl.count ?? 0) >= 5)
        findings.push(f(M, "warning", `fail_cluster_${(cl.error_pattern ?? cl.cluster_key ?? "unknown").slice(0, 30)}`,
          `Failure cluster: ${cl.error_pattern ?? cl.cluster_key} (${cl.cluster_size ?? cl.count} jobs)`,
          { finding_class: "root_cause", metric_value: cl.cluster_size ?? cl.count, payload: cl }));
    }

  if (findings.length === 0) findings.push(f(M, "info", "root_causes_ok", "No chronic failures or heal-loops"));
  return findings;
}

// MODULE 6: EXAM QUALITY
async function diagExamQuality(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "exam_quality";

  const { data: qc } = await sb.from("exam_questions")
    .select("id").eq("status", "approved").not("qc_status", "in", "(tier1_passed,null)").limit(200);
  if ((qc?.length ?? 0) > 0)
    findings.push(f(M, qc!.length > 20 ? "warning" : "info", "unresolved_qc",
      `${qc!.length} approved questions with unresolved QC`, { metric_value: qc!.length }));

  const { data: small } = await sb.from("v_ops_validate_exam_pool_progress" as any)
    .select("package_id, approved_count").lt("approved_count", 20).limit(50);
  if ((small?.length ?? 0) > 0)
    findings.push(f(M, "warning", "small_pools", `${small!.length} packages with <20 approved questions`,
      { finding_class: "consequence", metric_value: small!.length }));

  if (findings.length === 0) findings.push(f(M, "info", "exam_ok", "Exam quality checks passed"));
  return findings;
}

// MODULE 7: AI COSTS
async function diagAICosts(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "ai_costs";

  const month = new Date().toISOString().slice(0, 7);
  const { data: budget } = await sb.from("ai_cost_budgets").select("budget_eur, spent_eur").eq("month", month).maybeSingle();
  if (budget) {
    const pct = budget.budget_eur > 0 ? (budget.spent_eur / budget.budget_eur) * 100 : 0;
    if (pct > 70)
      findings.push(f(M, pct > 90 ? "critical" : "warning", pct > 90 ? "budget_critical" : "budget_warning",
        `AI budget at ${Math.round(pct)}% (€${budget.spent_eur.toFixed(2)}/€${budget.budget_eur.toFixed(2)})`,
        { finding_class: "consequence", metric_value: Math.round(pct) }));
  }

  const { data: cooldowns } = await sb.from("llm_provider_cooldowns")
    .select("provider, reason").gt("cooldown_until", new Date().toISOString()).limit(10);
  if ((cooldowns?.length ?? 0) > 0)
    findings.push(f(M, "warning", "active_cooldowns", `${cooldowns!.length} AI providers on cooldown`, { metric_value: cooldowns!.length }));

  const { data: dailySpend } = await sb.from("ai_worker_usage_daily")
    .select("date, cost_eur, errors, runs")
    .gte("date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
    .order("date", { ascending: false }).limit(7);
  if (dailySpend && dailySpend.length >= 3) {
    const costs = dailySpend.map((d: any) => d.cost_eur);
    const avg = costs.reduce((a: number, b: number) => a + b, 0) / costs.length;
    const latest = costs[0];
    if (latest > avg * 2 && latest > 5)
      findings.push(f(M, "warning", "spend_spike",
        `Today's AI spend €${latest.toFixed(2)} is ${(latest / avg).toFixed(1)}x the 7d avg (€${avg.toFixed(2)})`,
        { finding_class: "symptom", metric_value: latest }));
  }

  const { data: cacheStats } = await sb.from("ai_generation_cache")
    .select("hit_count").gte("created_at", new Date(Date.now() - 86400000).toISOString()).limit(500);
  if (cacheStats && cacheStats.length > 0) {
    const totalHits = cacheStats.reduce((s: number, c: any) => s + (c.hit_count || 0), 0);
    const hitRate = cacheStats.length > 0 ? totalHits / cacheStats.length : 0;
    if (hitRate < 0.5)
      findings.push(f(M, "info", "low_cache_hit_rate",
        `AI cache hit rate ${hitRate.toFixed(2)} — potential optimization opportunity`,
        { metric_value: hitRate }));
  }

  const { data: policies } = await sb.from("ai_worker_policies")
    .select("job_type, max_cost_eur_per_day, enabled").eq("enabled", true).limit(20);
  const { data: todayUsage } = await sb.from("ai_worker_usage_daily")
    .select("job_type, cost_eur").eq("date", new Date().toISOString().slice(0, 10)).limit(50);
  if (policies && todayUsage)
    for (const p of policies) {
      const usage = todayUsage.find((u: any) => u.job_type === (p as any).job_type);
      if (usage && (usage as any).cost_eur > (p as any).max_cost_eur_per_day * 0.9)
        findings.push(f(M, "warning", `worker_budget_${(p as any).job_type}`,
          `Worker "${(p as any).job_type}" at ${((usage as any).cost_eur / (p as any).max_cost_eur_per_day * 100).toFixed(0)}% daily budget`,
          { finding_class: "consequence", metric_value: (usage as any).cost_eur }));
    }

  if (findings.length === 0) findings.push(f(M, "info", "costs_ok", "AI costs within budget"));
  return findings;
}

// MODULE 8: GOVERNANCE
async function diagGovernance(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "governance";

  const { data: stuckCouncils } = await sb.from("council_sessions")
    .select("id, council_type, package_id").in("status", ["pending", "running"])
    .lt("created_at", new Date(Date.now() - 21600000).toISOString()).limit(20);
  if ((stuckCouncils?.length ?? 0) > 0)
    findings.push(f(M, "warning", "stuck_councils", `${stuckCouncils!.length} council sessions stuck >6h`, { metric_value: stuckCouncils!.length }));

  const { data: awaitingCouncil } = await sb.from("course_packages")
    .select("id").eq("council_approved", false).eq("integrity_passed", true)
    .in("status", ["building", "blocked"]).lt("updated_at", new Date(Date.now() - 172800000).toISOString()).limit(20);
  if ((awaitingCouncil?.length ?? 0) > 0)
    findings.push(f(M, "warning", "awaiting_council_48h", `${awaitingCouncil!.length} packages awaiting council >48h`,
      { finding_class: "root_cause", metric_value: awaitingCouncil!.length }));

  if (findings.length === 0) findings.push(f(M, "info", "governance_ok", "Governance healthy"));
  return findings;
}

// MODULE 9: WORKER HEALTH
async function diagWorkerHealth(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "worker_health";

  const { data: staleWorkers } = await sb.from("worker_heartbeats" as any)
    .select("worker_name, instance_id, last_heartbeat_at")
    .lt("last_heartbeat_at", new Date(Date.now() - 900000).toISOString()).limit(20);
  if ((staleWorkers?.length ?? 0) > 0)
    findings.push(f(M, staleWorkers!.length > 3 ? "critical" : "warning", "dead_workers",
      `${staleWorkers!.length} workers no heartbeat >15min`,
      { finding_class: "root_cause", metric_value: staleWorkers!.length }));

  const { data: recentJobs } = await sb.from("job_queue").select("status")
    .gte("updated_at", new Date(Date.now() - 3600000).toISOString())
    .in("status", ["completed", "failed"]).limit(1000);
  if (recentJobs && recentJobs.length >= 10) {
    const failedN = recentJobs.filter((j: any) => j.status === "failed").length;
    const rate = (failedN / recentJobs.length) * 100;
    if (rate > 30)
      findings.push(f(M, rate > 60 ? "critical" : "warning", "high_error_rate",
        `Job error rate ${Math.round(rate)}% (${failedN}/${recentJobs.length})`,
        { finding_class: "root_cause", metric_value: Math.round(rate) }));
  }

  const { count: pending } = await sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
  if ((pending ?? 0) > 100)
    findings.push(f(M, (pending ?? 0) > 300 ? "critical" : "warning", "job_backlog",
      `${pending} pending jobs in queue`, { metric_value: pending ?? 0 }));

  if (findings.length === 0) findings.push(f(M, "info", "workers_ok", "Workers healthy"));
  return findings;
}

// MODULE 10: BATCH API
async function diagBatchApi(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "batch_api";

  const { data: stuck } = await sb.from("llm_batches")
    .select("id, status").in("status", ["uploading", "draft", "submitted"])
    .lt("created_at", new Date(Date.now() - 1800000).toISOString()).limit(20);
  if ((stuck?.length ?? 0) > 0)
    findings.push(f(M, "warning", "stuck_batches", `${stuck!.length} stuck batches (>30min)`,
      { actionability: "auto_heal", metric_value: stuck!.length }));

  const { data: noImport } = await sb.from("llm_batches")
    .select("id").eq("status", "completed").is("results_imported_at" as any, null)
    .lt("completed_at", new Date(Date.now() - 3600000).toISOString()).limit(20);
  if ((noImport?.length ?? 0) > 0)
    findings.push(f(M, "warning", "import_backlog", `${noImport!.length} completed batches awaiting import >1h`, { metric_value: noImport!.length }));

  if (findings.length === 0) findings.push(f(M, "info", "batch_ok", "Batch API healthy"));
  return findings;
}

// MODULE 11: CONTENT COMPLETENESS (diagnosis only)
async function diagContentCompleteness(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "content_completeness";

  const { data: nearComplete } = await sb.from("course_packages")
    .select("id, build_progress, updated_at").eq("status", "building")
    .gte("build_progress", 90).lt("updated_at", new Date(Date.now() - 21600000).toISOString()).limit(30);
  if ((nearComplete?.length ?? 0) > 0)
    findings.push(f(M, "warning", "near_complete_stalled",
      `${nearComplete!.length} packages >90% stalled >6h`,
      { actionability: "investigate", metric_value: nearComplete!.length }));

  const { data: falseSuccess } = await sb.from("ops_auto_publish_false_success" as any).select("package_id").limit(20);
  if ((falseSuccess?.length ?? 0) > 0)
    findings.push(f(M, "warning", "false_success", `${falseSuccess!.length} false-success packages`,
      { finding_class: "root_cause", metric_value: falseSuccess!.length }));

  const { data: pubStuck } = await sb.from("ops_publish_eligible_but_stuck" as any).select("package_id").limit(20);
  if ((pubStuck?.length ?? 0) > 0)
    findings.push(f(M, "critical", "publish_stuck", `${pubStuck!.length} publish-eligible but stuck`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: pubStuck!.length }));

  const { data: stepDrifts } = await sb.from("ops_pipeline_step_drift")
    .select("package_id, step_key, age_minutes")
    .eq("drift_signal", "PENDING_DISPATCH").gt("age_minutes", 45).limit(30);
  if ((stepDrifts?.length ?? 0) > 0)
    findings.push(f(M, "warning", "step_drift_stale", `${stepDrifts!.length} steps with dispatch drift >45min`,
      { actionability: "auto_heal", metric_value: stepDrifts!.length }));

  if (findings.length === 0) findings.push(f(M, "info", "content_ok", "Content completeness healthy"));
  return findings;
}

// MODULE 12: SHADOW ZOMBIES
async function diagShadowZombies(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "shadow_zombies";

  const { data: shadowZombies } = await sb.from("v_ops_shadow_zombies" as any).select("*").limit(30);
  if ((shadowZombies?.length ?? 0) > 0)
    findings.push(f(M, "critical", "shadow_zombies",
      `${shadowZombies!.length} shadow-zombie packages`,
      { finding_class: "root_cause", actionability: "investigate", metric_value: shadowZombies!.length,
        payload: (shadowZombies as any[]).slice(0, 5).map((z: any) => ({ package_id: z.package_id, status: z.status })) }));

  const { data: phantomDrift } = await sb.from("ops_phantom_step_drift" as any).select("*").limit(30);
  if ((phantomDrift?.length ?? 0) > 0)
    findings.push(f(M, "warning", "phantom_step_drift",
      `${phantomDrift!.length} phantom step drifts`,
      { finding_class: "root_cause", metric_value: phantomDrift!.length }));

  const { data: reentryMisses } = await sb.from("v_ops_reentry_misses" as any).select("*").limit(30);
  if ((reentryMisses?.length ?? 0) > 0)
    findings.push(f(M, "warning", "reentry_misses",
      `${reentryMisses!.length} packages with failed re-entry after recovery`,
      { finding_class: "consequence", actionability: "investigate", metric_value: reentryMisses!.length }));

  if (findings.length === 0) findings.push(f(M, "info", "shadow_ok", "No shadow zombies"));
  return findings;
}

// MODULE 13: QUALITY GATES
async function diagQualityGates(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "quality_gates";

  const { data: hollow } = await sb.from("ops_hollow_completions" as any).select("*").limit(50);
  if ((hollow?.length ?? 0) > 0)
    findings.push(f(M, "critical", "hollow_completions",
      `${hollow!.length} hollow completions`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: hollow!.length,
        payload: (hollow as any[]).slice(0, 5) }));

  const { data: rejections } = await sb.from("ops_guard_threshold_rejections" as any).select("*").limit(50);
  if ((rejections?.length ?? 0) > 0)
    findings.push(f(M, "warning", "threshold_rejections",
      `${rejections!.length} guard threshold rejections`,
      { finding_class: "symptom", metric_value: rejections!.length }));

  const { data: belowThreshold } = await sb.from("ops_step_done_below_threshold" as any).select("*").limit(50);
  if ((belowThreshold?.length ?? 0) > 0)
    findings.push(f(M, "critical", "done_below_threshold",
      `${belowThreshold!.length} steps done below threshold`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: belowThreshold!.length }));

  const { data: contracts } = await sb.from("v_contract_integrity_summary" as any).select("*").limit(20);
  if (contracts && contracts.length > 0) {
    const violated = (contracts as any[]).filter((c: any) => c.status === "violated" || c.violations > 0);
    if (violated.length > 0)
      findings.push(f(M, "critical", "contract_integrity_violated",
        `${violated.length} contract integrity violations`,
        { finding_class: "root_cause", actionability: "structural_fix", metric_value: violated.length }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "quality_gates_ok", "Quality gates healthy"));
  return findings;
}

// MODULE 14: EARLY WARNING
async function diagEarlyWarning(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "early_warning";

  const { data: warnings } = await sb.from("v_early_warning" as any).select("*").limit(30);
  if ((warnings?.length ?? 0) > 0)
    for (const w of (warnings as any[]).slice(0, 10))
      findings.push(f(M, (w.severity ?? "warning") === "critical" ? "critical" : "warning",
        `ew_${(w.signal_type ?? w.warning_type ?? "unknown").slice(0, 40)}`,
        `Early warning: ${w.title ?? w.description ?? w.signal_type ?? "unknown signal"}`,
        { entity_type: w.entity_type, entity_id: w.entity_id, metric_value: w.metric_value ?? w.count, payload: w }));

  const { data: alerts } = await sb.from("v_pipeline_alerts" as any).select("*").limit(30);
  if ((alerts?.length ?? 0) > 0)
    for (const a of (alerts as any[]).slice(0, 10))
      findings.push(f(M, (a.severity ?? "warning") === "critical" ? "critical" : "warning",
        `alert_${(a.alert_type ?? a.check_name ?? "unknown").slice(0, 40)}`,
        `Pipeline alert: ${a.title ?? a.description ?? a.alert_type ?? "unknown"}`,
        { metric_value: a.count ?? a.metric_value, payload: a }));

  const { data: procStale } = await sb.from("ops_processing_stale" as any).select("*").limit(30);
  if ((procStale?.length ?? 0) > 0)
    findings.push(f(M, "warning", "processing_stale",
      `${procStale!.length} processing-stale jobs`,
      { finding_class: "symptom", actionability: "auto_heal", metric_value: procStale!.length }));

  const { data: procUnlocked } = await sb.from("ops_processing_unlocked" as any).select("*").limit(30);
  if ((procUnlocked?.length ?? 0) > 0)
    findings.push(f(M, "critical", "processing_unlocked",
      `${procUnlocked!.length} processing jobs WITHOUT lock (corruption risk!)`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: procUnlocked!.length }));

  const { data: queuedNoJob } = await sb.from("ops_queued_steps_missing_job" as any).select("*").limit(50);
  if ((queuedNoJob?.length ?? 0) > 0)
    findings.push(f(M, "warning", "queued_missing_job",
      `${queuedNoJob!.length} queued steps without corresponding job`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: queuedNoJob!.length }));

  const { data: stuckProc } = await sb.from("v_pipeline_stuck_processing" as any).select("*").limit(30);
  if ((stuckProc?.length ?? 0) > 0)
    findings.push(f(M, "warning", "pipeline_stuck_processing",
      `${stuckProc!.length} stuck processing entries`,
      { finding_class: "symptom", metric_value: stuckProc!.length }));

  const { data: stepJobDrift } = await sb.from("ops_step_job_drift" as any).select("*").limit(30);
  if ((stepJobDrift?.length ?? 0) > 0)
    findings.push(f(M, "warning", "step_job_drift",
      `${stepJobDrift!.length} step-job drift entries`,
      { finding_class: "root_cause", metric_value: stepJobDrift!.length }));

  const { data: mapDrift } = await sb.from("ops_step_mapping_drift" as any).select("*").limit(20);
  if ((mapDrift?.length ?? 0) > 0)
    findings.push(f(M, "warning", "step_mapping_drift",
      `${mapDrift!.length} step mapping drift`,
      { finding_class: "root_cause", actionability: "structural_fix", metric_value: mapDrift!.length }));

  const { data: runnerInt } = await sb.from("ops_runner_integrity" as any).select("*").limit(20);
  if (runnerInt && runnerInt.length > 0) {
    const issues = (runnerInt as any[]).filter((r: any) => r.status === "violation" || r.issue_count > 0);
    if (issues.length > 0)
      findings.push(f(M, "warning", "runner_integrity",
        `${issues.length} runner integrity issues`,
        { finding_class: "root_cause", metric_value: issues.length }));
  }

  const { data: prereqCanc } = await sb.from("ops_prereq_guard_cancelled" as any).select("*").limit(30);
  if ((prereqCanc?.length ?? 0) > 0)
    findings.push(f(M, "info", "prereq_cancelled",
      `${prereqCanc!.length} steps cancelled by prerequisite guard`,
      { metric_value: prereqCanc!.length }));

  if (findings.length === 0) findings.push(f(M, "info", "early_warning_ok", "No early warnings"));
  return findings;
}

// MODULE 15: HEAL EFFECTIVENESS
async function diagHealEffectiveness(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "heal_effectiveness";

  const { data: healEff } = await sb.from("ops_heal_effectiveness" as any).select("*").limit(30);
  if (healEff && healEff.length > 0)
    for (const h of healEff as any[]) {
      const successRate = h.success_rate ?? h.effectiveness_pct ?? null;
      if (successRate !== null && successRate < 30)
        findings.push(f(M, "warning", `low_heal_effectiveness_${(h.heal_type ?? h.action_type ?? "unknown").slice(0, 30)}`,
          `Heal "${h.heal_type ?? h.action_type}" has ${successRate}% effectiveness`,
          { finding_class: "root_cause", actionability: "structural_fix", metric_value: successRate }));
    }

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
      if ((h as any).followup_verdict === "regressed" || (h as any).followup_verdict === "no_delta")
        churnPkgs[pid].regressions++;
    }
    const churning = Object.entries(churnPkgs).filter(([, v]) => v.regressions >= 2 && v.heals >= 3);
    if (churning.length > 0)
      findings.push(f(M, "critical", "heal_churn",
        `${churning.length} packages with heal-churn`,
        { finding_class: "root_cause", actionability: "investigate", metric_value: churning.length,
          payload: churning.slice(0, 5).map(([id, v]) => ({ package_id: id, ...v })) }));

    const totalHeals = recentHeals.length;
    const noDeltas = recentHeals.filter((h: any) => h.followup_verdict === "no_delta").length;
    if (totalHeals > 10 && noDeltas / totalHeals > 0.5)
      findings.push(f(M, "warning", "high_no_delta_rate",
        `${Math.round(noDeltas / totalHeals * 100)}% of heals produced no delta (${noDeltas}/${totalHeals})`,
        { finding_class: "consequence", metric_value: Math.round(noDeltas / totalHeals * 100) }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "heals_ok", "Heal effectiveness healthy"));
  return findings;
}

// MODULE 16: TREND ANALYSIS
async function diagTrends(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "trend_analysis";

  const { data: trends } = await sb.from("v_audit_finding_trends" as any).select("*").limit(100);
  if (trends && trends.length > 0) {
    const escalating = (trends as any[]).filter((t: any) => t.trend_status === "escalating");
    if (escalating.length > 0)
      findings.push(f(M, "critical", "escalating_findings",
        `${escalating.length} findings are ESCALATING (worsening over time)`,
        { finding_class: "root_cause", actionability: "investigate", metric_value: escalating.length,
          payload: escalating.slice(0, 10).map((p: any) => ({ code: p.finding_code, severity: p.max_severity, recent_avg: p.recent_avg_metric, older_avg: p.older_avg_metric })) }));

    const persistent = (trends as any[]).filter((t: any) => t.trend_status === "persistent" && t.max_severity !== "info");
    if (persistent.length > 0)
      findings.push(f(M, "critical", "persistent_findings",
        `${persistent.length} findings persistent for 3+ days`,
        { finding_class: "root_cause", actionability: "investigate", metric_value: persistent.length,
          payload: persistent.slice(0, 10).map((p: any) => ({ code: p.finding_code, severity: p.max_severity, occurrences: p.occurrence_count })) }));

    const relapsed = (trends as any[]).filter((t: any) => t.trend_status === "relapsed");
    if (relapsed.length > 0)
      findings.push(f(M, "warning", "relapsed_findings",
        `${relapsed.length} previously healed findings have relapsed`,
        { finding_class: "consequence", metric_value: relapsed.length }));

    const recentlyHealed = (trends as any[]).filter((t: any) => t.trend_status === "healed" && t.was_ever_healed);
    if (recentlyHealed.length > 0)
      findings.push(f(M, "info", "recently_healed",
        `${recentlyHealed.length} findings successfully healed`, { metric_value: recentlyHealed.length }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "trends_ok", "No concerning trends"));
  return findings;
}

// MODULE 17: ORPHAN DRAFT QUESTIONS (can never promote without competency_id)
async function diagOrphanDrafts(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "orphan_drafts";

  const { data: orphans } = await sb.from("ops_orphan_draft_questions" as any)
    .select("curriculum_id, curriculum_title, orphan_count, oldest_age_hours").limit(50);
  
  if (orphans && orphans.length > 0) {
    const total = (orphans as any[]).reduce((s: number, o: any) => s + (o.orphan_count || 0), 0);
    findings.push(f(M, total > 50 ? "critical" : "warning", "orphan_drafts_detected",
      `${total} draft questions without competency_id across ${orphans.length} curricula — can never auto-promote`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: total,
        payload: (orphans as any[]).slice(0, 10).map((o: any) => ({ curriculum: o.curriculum_title, count: o.orphan_count, age_hours: o.oldest_age_hours })) }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "orphan_drafts_ok", "No orphan drafts without competency_id"));
  return findings;
}

// MODULE 18: STALE COUNCIL SESSIONS (pending >4h blocks pipeline)
async function diagStaleCouncilSessions(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "stale_council_sessions";

  const { data: stale } = await sb.from("ops_stale_council_sessions" as any)
    .select("package_id, package_title, pending_count, oldest_age_hours").limit(50);
  
  if (stale && stale.length > 0) {
    const totalSessions = (stale as any[]).reduce((s: number, o: any) => s + (o.pending_count || 0), 0);
    findings.push(f(M, totalSessions > 20 ? "critical" : "warning", "stale_council_sessions_detected",
      `${totalSessions} council sessions stuck in pending across ${stale.length} packages`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: totalSessions,
        payload: (stale as any[]).slice(0, 10).map((s: any) => ({ package: s.package_title, pending: s.pending_count, age_hours: s.oldest_age_hours })) }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "council_sessions_ok", "No stale council sessions"));
  return findings;
}

// MODULE 19: COUNCIL CHURN LOOPS (pending sessions + non-done quality_council step)
async function diagCouncilChurnLoops(sb: SB): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const M = "council_churn_loops";

  const { data: loops } = await sb.from("ops_council_churn_loops" as any)
    .select("package_id, package_title, package_status, step_status, step_attempts, pending_sessions").limit(50);
  
  if (loops && loops.length > 0) {
    findings.push(f(M, "critical", "council_churn_loop_detected",
      `${loops.length} packages in council churn loop (pending sessions block step completion)`,
      { finding_class: "root_cause", actionability: "auto_heal", metric_value: loops.length,
        payload: (loops as any[]).slice(0, 10).map((l: any) => ({ package: l.package_title, status: l.package_status, step: l.step_status, attempts: l.step_attempts, pending: l.pending_sessions })) }));
  }

  if (findings.length === 0) findings.push(f(M, "info", "churn_loops_ok", "No council churn loops"));
  return findings;
}

// ═══════════════════════════════════════════════════════════════
// REMEDIATION LAYER — separate, idempotent, cooldown-gated
// ═══════════════════════════════════════════════════════════════

async function checkCooldown(sb: SB, cooldownKey: string, hours = 6): Promise<boolean> {
  const { data } = await sb.rpc("check_heal_cooldown", { p_cooldown_key: cooldownKey, p_cooldown_hours: hours });
  return data === true;
}

async function logRemediation(
  sb: SB, runId: string | null, action: RemediationAction
): Promise<void> {
  if (!runId) return;
  await sb.from("audit_remediation_actions").insert({
    run_id: runId,
    module_key: action.module_key,
    action_key: action.action_key,
    entity_type: action.entity_type ?? null,
    entity_id: action.entity_id ?? null,
    status: action.status,
    reason: action.reason ?? null,
    cooldown_key: action.cooldown_key,
    payload: (action.payload ?? {}) as any,
  });
}

async function runRemediation(
  sb: SB, url: string, key: string, findings: AuditFinding[], runId: string | null
): Promise<{ actions: RemediationAction[]; healedCodes: Set<string> }> {
  const actions: RemediationAction[] = [];
  const healedCodes = new Set<string>();
  const healableFindings = findings.filter(fi => fi.actionability === "auto_heal" && fi.severity !== "info");

  // ── SAFE HEAL 1: Zombie Reap (via existing RPC) ──
  if (healableFindings.some(fi => fi.code === "zombie_jobs")) {
    const ck = `zombie_reap:${new Date().toISOString().slice(0, 13)}`;
    if (await checkCooldown(sb, ck, 4)) {
      try {
        const { data: reaped } = await sb.rpc("reap_zombie_processing_jobs_v2", {
          p_max_age_hours: 2, p_reason: "nightly-forensic-v2: zombie reap",
        });
        const count = Array.isArray(reaped) ? reaped.length : 0;
        const a: RemediationAction = { module_key: "pipeline", action_key: "zombie_reap", status: count > 0 ? "succeeded" : "attempted", cooldown_key: ck, payload: { reaped: count } };
        actions.push(a);
        await logRemediation(sb, runId, a);
        if (count > 0) healedCodes.add("zombie_jobs");
      } catch (e) {
        const a: RemediationAction = { module_key: "pipeline", action_key: "zombie_reap", status: "failed", cooldown_key: ck, reason: String(e) };
        actions.push(a);
        await logRemediation(sb, runId, a);
      }
    } else {
      const a: RemediationAction = { module_key: "pipeline", action_key: "zombie_reap", status: "skipped", cooldown_key: ck, reason: "cooldown active" };
      actions.push(a);
      await logRemediation(sb, runId, a);
    }
  }

  // ── SAFE HEAL 2: Stale Lease Release (via hardened RPC with internal cooldown) ──
  if (healableFindings.some(fi => fi.code === "stale_leases")) {
    const ck = `stale_lease_release:${new Date().toISOString().slice(0, 13)}`;
    if (await checkCooldown(sb, ck, 2)) {
      try {
        const { data: result } = await sb.rpc("release_stale_leases_safely", {
          p_run_id: runId, p_grace_minutes: 15, p_max_per_run: 20,
        });
        const released = (result as any)?.released ?? 0;
        const skippedCd = (result as any)?.skipped_cooldown ?? 0;
        const a: RemediationAction = { module_key: "pipeline", action_key: "stale_lease_release", status: released > 0 ? "succeeded" : "attempted", cooldown_key: ck, payload: { released, skipped_cooldown: skippedCd } };
        actions.push(a);
        await logRemediation(sb, runId, a);
        if (released > 0) healedCodes.add("stale_leases");
      } catch (e) {
        const a: RemediationAction = { module_key: "pipeline", action_key: "stale_lease_release", status: "failed", cooldown_key: ck, reason: String(e) };
        actions.push(a);
        await logRemediation(sb, runId, a);
      }
    } else {
      const a: RemediationAction = { module_key: "pipeline", action_key: "stale_lease_release", status: "skipped", cooldown_key: ck, reason: "cooldown active" };
      actions.push(a);
      await logRemediation(sb, runId, a);
    }
  }

  // ── SAFE HEAL 3: Ancient Pending → Cancelled (via hardened RPC with internal cooldown) ──
  if (healableFindings.some(fi => fi.code === "ancient_pending")) {
    const ck = `ancient_pending_cancel:${new Date().toISOString().slice(0, 10)}`;
    if (await checkCooldown(sb, ck, 12)) {
      try {
        const { data: result } = await sb.rpc("mark_ancient_pending_safely", {
          p_run_id: runId, p_max_age_hours: 72, p_max_per_run: 50,
        });
        const cancelled = (result as any)?.cancelled ?? 0;
        const skippedCd = (result as any)?.skipped_cooldown ?? 0;
        const a: RemediationAction = { module_key: "pipeline", action_key: "ancient_pending_cancel", status: cancelled > 0 ? "succeeded" : "attempted", cooldown_key: ck, payload: { cancelled, skipped_cooldown: skippedCd } };
        actions.push(a);
        await logRemediation(sb, runId, a);
        if (cancelled > 0) healedCodes.add("ancient_pending");
      } catch (e) {
        const a: RemediationAction = { module_key: "pipeline", action_key: "ancient_pending_cancel", status: "failed", cooldown_key: ck, reason: String(e) };
        actions.push(a);
        await logRemediation(sb, runId, a);
      }
    } else {
      const a: RemediationAction = { module_key: "pipeline", action_key: "ancient_pending_cancel", status: "skipped", cooldown_key: ck, reason: "cooldown active" };
      actions.push(a);
      await logRemediation(sb, runId, a);
    }
  }

  // ── SAFE HEAL 4: Integrity Mismatch Requeue (via hardened RPC with internal cooldown) ──
  if (healableFindings.some(fi => fi.code === "integrity_mismatch")) {
    const ck = `integrity_requeue:${new Date().toISOString().slice(0, 10)}`;
    if (await checkCooldown(sb, ck, 6)) {
      try {
        const { data: result } = await sb.rpc("requeue_integrity_mismatch_safely", {
          p_run_id: runId, p_max_per_run: 10,
        });
        const requeued = (result as any)?.requeued ?? 0;
        const skippedCd = (result as any)?.skipped_cooldown ?? 0;
        const a: RemediationAction = { module_key: "drift_mismatch", action_key: "integrity_requeue", status: requeued > 0 ? "succeeded" : "attempted", cooldown_key: ck, payload: { requeued, skipped_cooldown: skippedCd } };
        actions.push(a);
        await logRemediation(sb, runId, a);
        if (requeued > 0) healedCodes.add("integrity_mismatch");
      } catch (e) {
        const a: RemediationAction = { module_key: "drift_mismatch", action_key: "integrity_requeue", status: "failed", cooldown_key: ck, reason: String(e) };
        actions.push(a);
        await logRemediation(sb, runId, a);
      }
    } else {
      const a: RemediationAction = { module_key: "drift_mismatch", action_key: "integrity_requeue", status: "skipped", cooldown_key: ck, reason: "cooldown active" };
      actions.push(a);
      await logRemediation(sb, runId, a);
    }
  }

  // ── SAFE HEAL 5: Finalization Stall Heal (via existing RPC) ──
  if (healableFindings.some(fi => fi.code === "finalization_stalls")) {
    const ck = `finalization_heal:${new Date().toISOString().slice(0, 13)}`;
    if (await checkCooldown(sb, ck, 4)) {
      try {
        const { data: d } = await sb.rpc("heal_finalization_stall", { p_limit: 20 });
        const count = Array.isArray(d) ? d.length : (d as any)?.healed?.length ?? 0;
        const a: RemediationAction = { module_key: "progress_blockers", action_key: "finalization_heal", status: count > 0 ? "succeeded" : "attempted", cooldown_key: ck, payload: { healed: count } };
        actions.push(a);
        await logRemediation(sb, runId, a);
        if (count > 0) healedCodes.add("finalization_stalls");
      } catch (e) {
        const a: RemediationAction = { module_key: "progress_blockers", action_key: "finalization_heal", status: "failed", cooldown_key: ck, reason: String(e) };
        actions.push(a);
        await logRemediation(sb, runId, a);
      }
    } else {
      const a: RemediationAction = { module_key: "progress_blockers", action_key: "finalization_heal", status: "skipped", cooldown_key: ck, reason: "cooldown active" };
      actions.push(a);
      await logRemediation(sb, runId, a);
    }
  }

  // ── SAFE HEAL 6: Stuck-scan + Watchdog (via edge function invoke) ──
  const ck6 = `stuck_scan:${new Date().toISOString().slice(0, 13)}`;
  if (await checkCooldown(sb, ck6, 2)) {
    const stuckResult = await invoke(url, key, "stuck-scan", {});
    const wdResult = await invoke(url, key, "production-watchdog", {});
    const stuckHealed = stuckResult.ok ? (stuckResult.data?.healed_steps ?? 0) + (stuckResult.data?.healed_packages ?? 0) : 0;
    const a: RemediationAction = { module_key: "pipeline", action_key: "stuck_scan_watchdog", status: stuckHealed > 0 || wdResult.ok ? "succeeded" : "attempted", cooldown_key: ck6, payload: { stuck_healed: stuckHealed, watchdog_ok: wdResult.ok } };
    actions.push(a);
    await logRemediation(sb, runId, a);
  }

  // ── SAFE HEAL 7: Nightly guards (read-only-ish, but invoke for side effects) ──
  const ck7 = `nightly_guards:${new Date().toISOString().slice(0, 10)}`;
  if (await checkCooldown(sb, ck7, 12)) {
    await invoke(url, key, "ops-nightly-guards", {});
    await invoke(url, key, "system-scheduler-guardrail-cron", {});
    const a: RemediationAction = { module_key: "governance", action_key: "nightly_guards", status: "succeeded", cooldown_key: ck7 };
    actions.push(a);
    await logRemediation(sb, runId, a);
  }

  // ── SAFE HEAL 8: Orphan Draft Reaper (auto-reject drafts without competency_id) ──
  if (healableFindings.some(fi => fi.code === "orphan_drafts_detected")) {
    const ck8 = `orphan_draft_reap:${new Date().toISOString().slice(0, 10)}`;
    if (await checkCooldown(sb, ck8, 12)) {
      try {
        const { data: result } = await sb.rpc("reap_orphan_draft_questions", { p_grace_hours: 2, p_limit: 500 });
        const count = (result as any)?.rejected_count ?? 0;
        const a: RemediationAction = { module_key: "orphan_drafts", action_key: "reap_orphan_drafts", status: count > 0 ? "succeeded" : "attempted", cooldown_key: ck8, payload: { rejected: count } };
        actions.push(a);
        await logRemediation(sb, runId, a);
        if (count > 0) healedCodes.add("orphan_drafts_detected");
      } catch (e) {
        const a: RemediationAction = { module_key: "orphan_drafts", action_key: "reap_orphan_drafts", status: "failed", cooldown_key: ck8, reason: String(e) };
        actions.push(a);
        await logRemediation(sb, runId, a);
      }
    } else {
      const a: RemediationAction = { module_key: "orphan_drafts", action_key: "reap_orphan_drafts", status: "skipped", cooldown_key: ck8, reason: "cooldown active" };
      actions.push(a);
      await logRemediation(sb, runId, a);
    }
  }

  // ── SAFE HEAL 9: Stale Council Session Reaper (auto-complete pending >4h) ──
  if (healableFindings.some(fi => fi.code === "stale_council_sessions_detected" || fi.code === "council_churn_loop_detected")) {
    const ck9 = `council_session_reap:${new Date().toISOString().slice(0, 10)}`;
    if (await checkCooldown(sb, ck9, 12)) {
      try {
        const { data: result } = await sb.rpc("reap_stale_council_sessions", { p_grace_hours: 4, p_limit: 200 });
        const count = (result as any)?.completed_count ?? 0;
        const a: RemediationAction = { module_key: "stale_council_sessions", action_key: "reap_stale_sessions", status: count > 0 ? "succeeded" : "attempted", cooldown_key: ck9, payload: { completed: count, packages: (result as any)?.package_count ?? 0 } };
        actions.push(a);
        await logRemediation(sb, runId, a);
        if (count > 0) { healedCodes.add("stale_council_sessions_detected"); healedCodes.add("council_churn_loop_detected"); }
      } catch (e) {
        const a: RemediationAction = { module_key: "stale_council_sessions", action_key: "reap_stale_sessions", status: "failed", cooldown_key: ck9, reason: String(e) };
        actions.push(a);
        await logRemediation(sb, runId, a);
      }
    } else {
      const a: RemediationAction = { module_key: "stale_council_sessions", action_key: "reap_stale_sessions", status: "skipped", cooldown_key: ck9, reason: "cooldown active" };
      actions.push(a);
      await logRemediation(sb, runId, a);
    }
  }

  return { actions, healedCodes };
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR — Diagnosis first, Remediation second
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, serviceKey);

  const startedAt = new Date();
  const allFindings: AuditFinding[] = [];
  const moduleResults: ModuleResult[] = [];

  // Create audit run record
  const { data: runRow } = await sb.from("nightly_audit_runs").insert({
    started_at: startedAt.toISOString(), status: "running", audit_version: "v2.1",
  }).select("id").single();
  const runId = runRow?.id;

  const MODULE_TIMEOUT_MS = 45_000;

  // ── PHASE 1: DIAGNOSIS (read-only modules, parallel in batches of 3) ──
  const diagModules: { name: string; fn: () => Promise<AuditFinding[]> }[] = [
    { name: "admin_actions", fn: () => diagAdminActions(sb) },
    { name: "pipeline", fn: () => diagPipeline(sb) },
    { name: "progress_blockers", fn: () => diagProgressBlockers(sb) },
    { name: "drift_mismatch", fn: () => diagDrift(sb, url, serviceKey) },
    { name: "root_causes", fn: () => diagRootCauses(sb) },
    { name: "exam_quality", fn: () => diagExamQuality(sb) },
    { name: "ai_costs", fn: () => diagAICosts(sb) },
    { name: "governance", fn: () => diagGovernance(sb) },
    { name: "worker_health", fn: () => diagWorkerHealth(sb) },
    { name: "batch_api", fn: () => diagBatchApi(sb) },
    { name: "content_completeness", fn: () => diagContentCompleteness(sb) },
    { name: "shadow_zombies", fn: () => diagShadowZombies(sb) },
    { name: "quality_gates", fn: () => diagQualityGates(sb) },
    { name: "early_warning", fn: () => diagEarlyWarning(sb) },
    { name: "heal_effectiveness", fn: () => diagHealEffectiveness(sb) },
    { name: "trend_analysis", fn: () => diagTrends(sb) },
    { name: "orphan_drafts", fn: () => diagOrphanDrafts(sb) },
    { name: "stale_council_sessions", fn: () => diagStaleCouncilSessions(sb) },
    { name: "council_churn_loops", fn: () => diagCouncilChurnLoops(sb) },
  ];

  const DIAG_BATCH_SIZE = 3;
  for (let i = 0; i < diagModules.length; i += DIAG_BATCH_SIZE) {
    const batch = diagModules.slice(i, i + DIAG_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (mod) => {
        const t0 = Date.now();
        try {
          const findings = await withTimeout(mod.fn, MODULE_TIMEOUT_MS, mod.name);
          const elapsed = Date.now() - t0;
          const status = elapsed > 30000 ? "partial" as const : "ok" as const;
          const remCandidates = findings.filter(fi => fi.actionability === "auto_heal" && fi.severity !== "info").length;
          const result: ModuleResult = { module: mod.name, status, duration_ms: elapsed, findings, findings_count: findings.length, remediation_candidate_count: remCandidates };
          moduleResults.push(result);

          if (elapsed > 30000)
            findings.push(f("audit_sla", "warning", `module_slow_${mod.name}`,
              `Audit module "${mod.name}" took ${(elapsed / 1000).toFixed(1)}s (SLA: 30s)`,
              { finding_class: "consequence", metric_value: elapsed }));

          return findings;
        } catch (e) {
          const elapsed = Date.now() - t0;
          const errMsg = String(e instanceof Error ? e.message : e).slice(0, 200);
          const isTimeout = errMsg.includes("AUDIT_MODULE_TIMEOUT");
          const result: ModuleResult = { module: mod.name, status: isTimeout ? "timeout" : "failed", duration_ms: elapsed, findings: [], findings_count: 0, error: errMsg };
          moduleResults.push(result);
          return [f(mod.name, "warning", `${mod.name}_${isTimeout ? "timeout" : "crash"}`,
            `Module "${mod.name}" ${isTimeout ? "timed out" : "crashed"}: ${errMsg}`,
            { finding_class: "consequence", actionability: "investigate" })] as AuditFinding[];
        }
      })
    );
    for (const r of results) if (r.status === "fulfilled") allFindings.push(...r.value);
  }

  // ── PHASE 2: REMEDIATION (sequential, cooldown-gated, RPC-only) ──
  const { actions: remActions, healedCodes } = await runRemediation(sb, url, serviceKey, allFindings, runId);

  // Mark healed findings
  for (const finding of allFindings) {
    if (healedCodes.has(finding.code)) finding.healed = true;
  }

  // ── PHASE 3: PERSIST & SUMMARIZE ──
  const criticalCount = allFindings.filter(fi => fi.severity === "critical").length;
  const warningCount = allFindings.filter(fi => fi.severity === "warning").length;
  const infoCount = allFindings.filter(fi => fi.severity === "info").length;
  const healedCount = allFindings.filter(fi => fi.healed).length;
  const verdict = criticalCount > 0 ? "CRITICAL" : warningCount > 0 ? "NEEDS_ATTENTION" : "HEALTHY";
  const finishedAt = new Date();

  // Incident aggregation (using numeric severity ranking)
  const sevRank = (s: string) => s === "critical" ? 3 : s === "warning" ? 2 : 1;
  const sevLabel = (r: number) => r >= 3 ? "critical" : r >= 2 ? "warning" : "info";
  const incidentMap: Record<string, { findings: string[]; maxSevRank: number; hasRootCause: boolean }> = {};
  for (const finding of allFindings) {
    if (finding.entity_id && finding.severity !== "info") {
      const key = `${finding.entity_type}:${finding.entity_id}`;
      if (!incidentMap[key]) incidentMap[key] = { findings: [], maxSevRank: 0, hasRootCause: false };
      incidentMap[key].findings.push(finding.code);
      incidentMap[key].maxSevRank = Math.max(incidentMap[key].maxSevRank, sevRank(finding.severity));
      if (finding.finding_class === "root_cause") incidentMap[key].hasRootCause = true;
    }
  }
  // Multi-signal OR single critical root_cause
  const incidents = Object.entries(incidentMap)
    .filter(([, v]) => v.findings.length >= 2 || (v.maxSevRank >= 3 && v.hasRootCause))
    .map(([entity, v]) => ({ entity, evidences: v.findings, severity: sevLabel(v.maxSevRank) }));

  if (runId) {
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
      module_results: moduleResults.map(r => ({ name: r.module, status: r.status, duration_ms: r.duration_ms, finding_count: r.findings_count, remediation_candidates: r.remediation_candidate_count ?? 0, error: r.error })) as any,
      meta: {
        incidents,
        audit_version: "v2.1",
        remediation_summary: {
          total_actions: remActions.length,
          succeeded: remActions.filter(a => a.status === "succeeded").length,
          skipped: remActions.filter(a => a.status === "skipped").length,
          failed: remActions.filter(a => a.status === "failed").length,
        },
      } as any,
    }).eq("id", runId);

    // Persist findings (batch insert)
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
    for (let i = 0; i < findingRows.length; i += 50)
      await sb.from("nightly_audit_findings").insert(findingRows.slice(i, i + 50));
  }

  // Notification
  const title = `🔬 Nightly Forensic v2.1: ${verdict} — ${criticalCount}C/${warningCount}W/${healedCount}H | ${remActions.filter(a => a.status === "succeeded").length} heals`;
  const body = allFindings
    .filter(finding => finding.severity !== "info")
    .map(finding => `[${finding.severity.toUpperCase()}${finding.healed ? "✅" : ""}] ${finding.title}`)
    .join("\n").slice(0, 2000);

  await sb.from("admin_notifications").insert({
    title, body: body || "All systems healthy.",
    severity: criticalCount > 0 ? "error" : warningCount > 0 ? "warning" : "info",
    category: "ops", entity_type: "system", entity_id: "nightly-forensic-audit",
    metadata: { verdict, criticalCount, warningCount, healedCount, infoCount, run_id: runId, incidents: incidents.slice(0, 10), module_count: moduleResults.length, remediation_actions: remActions.length } as any,
  });

  return json({
    ok: true,
    verdict,
    run_id: runId,
    audit_version: "v2.1",
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
      remediation: {
        total: remActions.length,
        succeeded: remActions.filter(a => a.status === "succeeded").length,
        skipped: remActions.filter(a => a.status === "skipped").length,
        failed: remActions.filter(a => a.status === "failed").length,
      },
    },
    incidents: incidents.slice(0, 20),
    modules: moduleResults.map(r => ({ name: r.module, status: r.status, duration_ms: r.duration_ms, finding_count: r.findings_count, remediation_candidates: r.remediation_candidate_count ?? 0, error: r.error })),
    remediation_actions: remActions,
    findings: allFindings,
  });
});
