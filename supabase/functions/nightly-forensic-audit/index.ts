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

  // Check for recent failed admin actions (last 24h)
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
    // Group by action type
    const byAction: Record<string, number> = {};
    for (const a of errorActions) {
      byAction[a.action] = (byAction[a.action] || 0) + 1;
    }

    for (const [action, count] of Object.entries(byAction)) {
      findings.push({
        category: "admin_actions",
        severity: count > 5 ? "critical" : "warning",
        key: `failed_action_${action}`,
        message: `Action "${action}" failed ${count}x in last 24h`,
        healed: false,
        details: { count, sample: errorActions.filter((a: any) => a.action === action).slice(0, 3) },
      });
    }
  }

  // Check for unprocessed auto-heal queue items
  const { data: pendingHeals, error: healErr } = await sb
    .from("admin_course_auto_heal_queue")
    .select("id, package_id, heal_action, reason_codes, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);

  if (!healErr && (pendingHeals?.length ?? 0) > 10) {
    findings.push({
      category: "admin_actions",
      severity: "warning",
      key: "stale_heal_queue",
      message: `${pendingHeals!.length} pending auto-heal items not yet processed`,
      healed: false,
      details: { count: pendingHeals!.length },
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
    // AUTO-HEAL: Reap zombie jobs
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

  // 2b. Orphan leases (no heartbeat >10 min)
  const { data: staleLeases } = await sb
    .from("job_queue")
    .select("id, job_type, package_id, lease_holder")
    .eq("status", "processing")
    .not("lease_holder", "is", null)
    .lt("heartbeat_at", new Date(Date.now() - 600000).toISOString())
    .limit(50);

  if ((staleLeases?.length ?? 0) > 0) {
    let released = 0;
    for (const j of staleLeases!) {
      const { error } = await sb
        .from("job_queue")
        .update({ status: "pending", lease_holder: null, started_at: null })
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

  // 2c. Run stuck-scan for comprehensive pipeline health
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

  // 2d. Run production watchdog
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

  if (findings.length === 0) {
    findings.push({
      category: "pipeline",
      severity: "info",
      key: "pipeline_ok",
      message: "Pipeline healthy — no zombies, no stale leases",
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

  // 3a. Packages stuck in building >24h with no activity
  const { data: stuckBuilding } = await sb
    .from("course_packages")
    .select("id, curriculum_id, build_progress, status, updated_at")
    .eq("status", "building")
    .lt("updated_at", new Date(Date.now() - 86400000).toISOString())
    .limit(50);

  if ((stuckBuilding?.length ?? 0) > 0) {
    findings.push({
      category: "progress_blockers",
      severity: "critical",
      key: "stale_building_24h",
      message: `${stuckBuilding!.length} packages stuck in 'building' >24h`,
      healed: false,
      details: stuckBuilding!.map((p: any) => ({
        id: p.id,
        progress: p.build_progress,
        updated: p.updated_at,
      })),
    });
  }

  // 3b. Blocked/quality_gate_failed packages
  const { data: blocked } = await sb
    .from("course_packages")
    .select("id, status, stuck_reason, updated_at")
    .in("status", ["blocked", "quality_gate_failed"])
    .limit(100);

  if ((blocked?.length ?? 0) > 0) {
    // AUTO-HEAL: Try reconciliation via safe-global-heal
    const healResult = await invoke(url, key, "safe-global-heal", { source: "nightly-forensic" });
    const healedPkgs = healResult.data?.healed_count ?? 0;

    findings.push({
      category: "progress_blockers",
      severity: (blocked!.length > 5) ? "critical" : "warning",
      key: "blocked_packages",
      message: `${blocked!.length} packages blocked/quality_gate_failed — healed ${healedPkgs}`,
      healed: healedPkgs > 0,
      details: {
        total: blocked!.length,
        healed: healedPkgs,
        sample: blocked!.slice(0, 5).map((p: any) => ({
          id: p.id,
          status: p.status,
          reason: p.stuck_reason,
        })),
      },
    });
  }

  // 3c. Finalization stalls
  const { data: finStalls } = await sb
    .from("ops_finalization_stall")
    .select("package_id, stall_type, stalled_since")
    .limit(50);

  if ((finStalls?.length ?? 0) > 0) {
    // AUTO-HEAL: Attempt finalization heal
    const healFin = await invoke(url, key, "admin-ops-actions", {
      action: "heal_finalization_stall",
    }).catch(() => ({ ok: false, data: null, status: 0 }));

    // For nightly runs, we use service role auth bypass
    findings.push({
      category: "progress_blockers",
      severity: "warning",
      key: "finalization_stalls",
      message: `${finStalls!.length} finalization stalls detected`,
      healed: false,
      details: { count: finStalls!.length, stalls: finStalls!.slice(0, 5) },
    });
  }

  // 3d. Progress drift check
  const { data: driftRows } = await sb
    .from("v_ops_progress_drift_smoke")
    .select("*")
    .limit(50);

  if ((driftRows?.length ?? 0) > 0) {
    findings.push({
      category: "progress_blockers",
      severity: "warning",
      key: "progress_drift",
      message: `${driftRows!.length} packages with progress drift`,
      healed: false,
      details: driftRows!.slice(0, 5),
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

  // 4a. Schema health check
  const schemaResult = await invoke(url, key, "schema-health", { source: "nightly-forensic" });
  if (schemaResult.ok && schemaResult.data) {
    const d = schemaResult.data;
    if ((d.critical_count ?? 0) > 0) {
      findings.push({
        category: "drift_mismatch",
        severity: "critical",
        key: "schema_drift_critical",
        message: `${d.critical_count} critical schema drifts detected`,
        healed: false,
        details: d.drifts?.slice(0, 10),
      });
    }
    if ((d.drift_count ?? 0) > 0 && (d.critical_count ?? 0) === 0) {
      findings.push({
        category: "drift_mismatch",
        severity: "warning",
        key: "schema_drift_minor",
        message: `${d.drift_count} minor schema drifts detected`,
        healed: false,
        details: d.drifts?.slice(0, 10),
      });
    }
  }

  // 4b. Integrity report mismatches
  const { data: integrityMismatches } = await sb
    .from("ops_integrity_report_mismatch")
    .select("package_id, integrity_report_version, has_report")
    .limit(50);

  if ((integrityMismatches?.length ?? 0) > 0) {
    // AUTO-HEAL: Re-queue integrity checks for mismatched packages
    let healedCount = 0;
    for (const m of integrityMismatches!.slice(0, 10)) {
      try {
        const { error } = await sb
          .from("package_steps")
          .update({ status: "queued" })
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

  // 4c. Pipeline step drift (steps queued but no job)
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

  // 4d. Pool routing mismatches
  const { data: poolMismatches } = await sb
    .from("job_queue")
    .select("id, job_type, worker_pool, status")
    .eq("status", "pending")
    .limit(500);

  // Cross-check pool routing via SSOT (best-effort)
  // Delegate to system-contract-audit
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

  // 4e. Run nightly guards (trigger bindings, etc.)
  const guardsResult = await invoke(url, key, "ops-nightly-guards", {});

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

  // 5a. Repeated failure patterns (same job_type failing >3x in 24h)
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
        details: {
          count: info.count,
          top_errors: [...info.errors].slice(0, 5),
        },
      });
    }

    // AUTO-HEAL: Revive transient-exhausted jobs with < max_attempts
    const { data: transientExhausted } = await sb
      .from("job_queue")
      .select("id, job_type, attempts, max_attempts, last_error")
      .eq("status", "failed")
      .gte("updated_at", new Date(Date.now() - 86400000).toISOString())
      .lt("attempts", 3)
      .limit(50);

    if ((transientExhausted?.length ?? 0) > 0) {
      let revived = 0;
      for (const j of transientExhausted!) {
        const lastErr = String(j.last_error ?? "");
        // Only revive transient errors, not permanent ones
        const isTransient = /timeout|ECONNRESET|503|429|rate.limit|EAGAIN|network/i.test(lastErr);
        if (!isTransient) continue;

        const { error } = await sb
          .from("job_queue")
          .update({ status: "pending", started_at: null, lease_holder: null })
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

  // 5b. Packages cycling between states (heal-loop detection)
  const { data: healLogs } = await sb
    .from("auto_heal_log")
    .select("package_id, heal_type, created_at")
    .gte("created_at", new Date(Date.now() - 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(500);

  if (healLogs && healLogs.length > 0) {
    const byPkg: Record<string, number> = {};
    for (const h of healLogs) {
      byPkg[h.package_id] = (byPkg[h.package_id] || 0) + 1;
    }

    const looping = Object.entries(byPkg).filter(([, count]) => count >= 5);
    for (const [pkgId, count] of looping) {
      findings.push({
        category: "root_causes",
        severity: "critical",
        key: `heal_loop_${pkgId.slice(0, 8)}`,
        message: `Package ${pkgId.slice(0, 8)}… healed ${count}x in 24h — possible heal-loop`,
        healed: false,
        details: { package_id: pkgId, heal_count: count },
      });
    }
  }

  // 5c. Error class distribution from pipeline
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

  // 5d. Run system orphan reaper + cron governance
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
      auditSteps.push({
        name: audit.name,
        status: `error: ${String(e).slice(0, 200)}`,
        duration_ms: Date.now() - t0,
        finding_count: 0,
      });
    }
  }

  // Compute summary
  const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
  const warningCount = allFindings.filter((f) => f.severity === "warning").length;
  const healedCount = allFindings.filter((f) => f.healed).length;
  const verdict = criticalCount > 0 ? "CRITICAL" : warningCount > 0 ? "NEEDS_ATTENTION" : "HEALTHY";

  // Persist audit report as admin notification
  const title = `🔬 Nightly Forensic: ${verdict} — ${criticalCount} critical, ${warningCount} warnings, ${healedCount} healed`;
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
      finding_count: allFindings.length,
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
    },
    steps: auditSteps,
    findings: allFindings,
  });
});
