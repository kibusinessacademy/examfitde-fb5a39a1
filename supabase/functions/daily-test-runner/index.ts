import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ── Root-cause severity ranking ──────────────────────────────
const SEVERITY_RANK: Record<string, number> = {
  security: 100,
  schema: 90,
  rpc: 80,
  stuck_jobs: 70,
  edge_functions: 60,
  failed_jobs: 50,
  data_quality: 30,
  content_gap: 10,
};

interface CheckResult {
  id: string;
  area: string;
  passed: boolean;
  detail?: string;
  count?: number;
  duration_ms?: number;
}

interface RootCause {
  area: string;
  severity: number;
  message: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  // Smoke-test guard: return immediately when called as part of edge smoke tests
  try {
    const body = await req.clone().json();
    if (body?._smoke_test) {
      return new Response(JSON.stringify({ ok: true, smoke: true }), { status: 200, headers });
    }
  } catch { /* no body is fine */ }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const started = Date.now();

  // ── Load active policy ──────────────────────────────────────
  const { data: policyRow } = await admin
    .from("auto_heal_policies")
    .select("policy_json")
    .eq("is_active", true)
    .maybeSingle();
  const policy = policyRow?.policy_json as any || {};
  const guardrails = policy.guardrails || {};
  const checksConfig = policy.checks || {};

  const results: CheckResult[] = [];
  const rootCauses: RootCause[] = [];

  // ═══════════════════════════════════════════════════════════
  // 1. SCHEMA PRECHECKS
  // ═══════════════════════════════════════════════════════════
  const coreTables = checksConfig.prechecks?.find((c: any) => c.id === "schema_core_tables")?.tables
    || ["profiles", "curricula", "curriculum_learning_fields", "job_queue", "autofix_runs"];

  let schemaMissing = 0;
  for (const table of coreTables) {
    const t0 = Date.now();
    const { error } = await admin.from(table).select("id").limit(1);
    const passed = !error;
    if (!passed) schemaMissing++;
    results.push({ id: `schema:${table}`, area: "schema", passed, detail: error?.message, duration_ms: Date.now() - t0 });
  }
  if (schemaMissing > 0) {
    rootCauses.push({ area: "schema", severity: SEVERITY_RANK.schema, message: `${schemaMissing} critical table(s) missing` });
  }

  // ═══════════════════════════════════════════════════════════
  // 2. RLS SMOKE (anon blocked)
  // ═══════════════════════════════════════════════════════════
  const rlsTables = checksConfig.prechecks?.find((c: any) => c.id === "rls_smoke")?.tables
    || ["autofix_runs", "job_queue"];
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  for (const table of rlsTables) {
    const t0 = Date.now();
    const { data, error } = await anonClient.from(table).select("id").limit(1);
    const blocked = (data?.length === 0) || !!error;
    if (!blocked) {
      rootCauses.push({ area: "security", severity: SEVERITY_RANK.security, message: `RLS open on ${table}: anon can read data` });
    }
    results.push({ id: `rls:${table}`, area: "security", passed: blocked, detail: blocked ? "blocked" : `OPEN: ${data?.length} rows`, duration_ms: Date.now() - t0 });
  }

  // ═══════════════════════════════════════════════════════════
  // 3. FK ORPHAN CHECK
  // ═══════════════════════════════════════════════════════════
  let fkOrphans = 0;
  {
    const t0 = Date.now();
    const { data } = await admin.from("lessons").select("id, course_id").limit(500);
    if (data && data.length > 0) {
      const courseIds = [...new Set(data.map((l: any) => l.course_id).filter(Boolean))];
      if (courseIds.length > 0) {
        const { data: courses } = await admin.from("courses").select("id").in("id", courseIds);
        const validIds = new Set((courses || []).map((c: any) => c.id));
        fkOrphans = courseIds.filter(id => !validIds.has(id)).length;
      }
    }
    results.push({ id: "fk:lessons_courses", area: "database", passed: fkOrphans === 0, count: fkOrphans, detail: `${fkOrphans} orphaned refs`, duration_ms: Date.now() - t0 });
    if (fkOrphans > 0) {
      rootCauses.push({ area: "schema", severity: SEVERITY_RANK.schema - 5, message: `${fkOrphans} FK orphans (lessons→courses)` });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 4. JOB QUEUE HEALTH
  // ═══════════════════════════════════════════════════════════
  const stuckThreshold = (checksConfig.prechecks?.find((c: any) => c.id === "job_queue_health")?.stuckThresholdMinutes || 30) * 60_000;
  let stuckCount = 0;
  let failedCount24h = 0;
  {
    const t0 = Date.now();
    const cutoff = new Date(Date.now() - stuckThreshold).toISOString();
    const { data: stuck } = await admin.from("job_queue").select("id").eq("status", "processing").lt("locked_at", cutoff);
    stuckCount = stuck?.length ?? 0;
    results.push({ id: "jobs:stuck", area: "ops", passed: stuckCount === 0, count: stuckCount, detail: `${stuckCount} stuck`, duration_ms: Date.now() - t0 });
    if (stuckCount > 0) rootCauses.push({ area: "stuck_jobs", severity: SEVERITY_RANK.stuck_jobs, message: `${stuckCount} stuck job(s)` });
  }
  {
    const t0 = Date.now();
    const yesterday = new Date(Date.now() - 86400_000).toISOString();
    const { data: failed } = await admin.from("job_queue").select("id, job_type").eq("status", "failed").gte("updated_at", yesterday);
    failedCount24h = failed?.length ?? 0;
    results.push({ id: "jobs:failed_24h", area: "ops", passed: failedCount24h < 5, count: failedCount24h, detail: `${failedCount24h} failed`, duration_ms: Date.now() - t0 });
    if (failedCount24h >= 5) rootCauses.push({ area: "failed_jobs", severity: SEVERITY_RANK.failed_jobs, message: `${failedCount24h} failed jobs in 24h` });
  }

  // ═══════════════════════════════════════════════════════════
  // 5. EDGE FUNCTION SMOKE
  // ═══════════════════════════════════════════════════════════
  const edgeFunctions = (checksConfig.prechecks?.find((c: any) => c.id === "edge_smoke")?.functions
    || ["auto-gap-close", "job-runner"])
    .filter((fn: string) => fn !== "daily-test-runner"); // Never smoke-test ourselves
  let edgeFailures = 0;

  for (const fn of edgeFunctions) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ _smoke_test: true }),
      });
      const alive = res.status < 500;
      if (!alive) edgeFailures++;
      results.push({ id: `edge:${fn}`, area: "edge_functions", passed: alive, detail: `HTTP ${res.status}`, duration_ms: Date.now() - t0 });
    } catch (err) {
      edgeFailures++;
      results.push({ id: `edge:${fn}`, area: "edge_functions", passed: false, detail: String(err), duration_ms: Date.now() - t0 });
    }
  }
  if (edgeFailures > 0) rootCauses.push({ area: "edge_functions", severity: SEVERITY_RANK.edge_functions, message: `${edgeFailures} edge function(s) unreachable` });

  // ═══════════════════════════════════════════════════════════
  // 6. GUARDRAIL STATE
  // ═══════════════════════════════════════════════════════════
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data: todayRuns } = await admin.from("autofix_runs").select("id, status, budget_used_eur, last_score, stop_reason").gte("updated_at", todayStart.toISOString());
  const dailyCostEur = (todayRuns || []).reduce((s: number, r: any) => s + (r.budget_used_eur || 0), 0);
  const budgetLimit = guardrails.budgetCircuitBreaker?.dailyBudgetEur || 15;
  const budgetTripped = dailyCostEur >= budgetLimit;
  const activeRuns = (todayRuns || []).filter((r: any) => r.status === "running");
  const frozenRuns = (todayRuns || []).filter((r: any) => r.status === "frozen");
  const stoppedRuns = (todayRuns || []).filter((r: any) => r.status === "stopped");

  // ═══════════════════════════════════════════════════════════
  // 7. DATA QUALITY
  // ═══════════════════════════════════════════════════════════
  {
    const t0 = Date.now();
    const { data: published } = await admin.from("course_packages").select("id, integrity_score").eq("status", "published").lt("integrity_score", 50);
    const lowQ = published?.length ?? 0;
    results.push({ id: "dq:low_quality_packages", area: "data_quality", passed: lowQ === 0, count: lowQ, detail: `${lowQ} published packages with score<50`, duration_ms: Date.now() - t0 });
  }

  // ═══════════════════════════════════════════════════════════
  // 8. CLASSIFY & DECIDE
  // ═══════════════════════════════════════════════════════════
  rootCauses.sort((a, b) => b.severity - a.severity);

  const hasRedFlags = rootCauses.some(r => r.severity >= 60);
  const hasYellowFlags = rootCauses.some(r => r.severity >= 30 && r.severity < 60);
  const overallStatus = hasRedFlags ? "red" : hasYellowFlags ? "yellow" : "green";

  // Structural gate evaluation
  const structuralGateConfig = guardrails.structuralGate;
  const gateMetrics: Record<string, number> = {
    schema_missing_tables: schemaMissing,
    fk_orphans_count: fkOrphans,
    rpc_smoke_failures: 0,
    edge_function_smoke_failures: edgeFailures,
    job_queue_stuck_count: stuckCount,
  };

  let structuralGateBlocked = false;
  if (structuralGateConfig?.enabled) {
    for (const rule of structuralGateConfig.blockIf || []) {
      if ((gateMetrics[rule.key] ?? 0) > (rule.gt ?? 0)) {
        structuralGateBlocked = true;
        break;
      }
    }
  }

  const autoHealAllowed = !structuralGateBlocked && !budgetTripped && overallStatus !== "red";

  // ═══════════════════════════════════════════════════════════
  // 9. STORE SNAPSHOT
  // ═══════════════════════════════════════════════════════════
  const totalDuration = Date.now() - started;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  const snapshot = {
    overall_status: overallStatus,
    root_causes: rootCauses.slice(0, 5),
    checks: { total: results.length, passed, failed, results },
    guardrails: {
      budget: { daily_cost_eur: dailyCostEur, limit_eur: budgetLimit, tripped: budgetTripped },
      structural_gate: { blocked: structuralGateBlocked, metrics: gateMetrics },
      auto_heal_allowed: autoHealAllowed,
    },
    autofix_summary: {
      active: activeRuns.length,
      frozen: frozenRuns.length,
      stopped: stoppedRuns.length,
      today_cost_eur: dailyCostEur,
    },
    job_queue_summary: { stuck: stuckCount, failed_24h: failedCount24h },
    edge_function_summary: { tested: edgeFunctions.length, failures: edgeFailures },
    data_integrity: { fk_orphans: fkOrphans, schema_missing: schemaMissing },
    duration_ms: totalDuration,
    metadata: { policy_version: policy.version, run_at: new Date().toISOString() },
  };

  await admin.from("ops_health_snapshots").insert(snapshot);

  // ═══════════════════════════════════════════════════════════
  // 10. ADMIN NOTIFICATION
  // ═══════════════════════════════════════════════════════════
  const severity = overallStatus === "red" ? "critical" : overallStatus === "yellow" ? "warning" : "info";
  const emoji = overallStatus === "red" ? "🔴" : overallStatus === "yellow" ? "🟡" : "🟢";
  const title = `${emoji} Ops Health: ${overallStatus.toUpperCase()} – ${passed}/${results.length} checks passed`;

  const bodyParts = [
    `**Status:** ${overallStatus.toUpperCase()} (${totalDuration}ms)`,
    `**Checks:** ${passed} ✅ / ${failed} ❌`,
    `**Budget:** €${dailyCostEur.toFixed(2)} / €${budgetLimit}${budgetTripped ? " ⚠️ TRIPPED" : ""}`,
    `**Auto-Heal:** ${autoHealAllowed ? "✅ erlaubt" : "🚫 blockiert"}`,
  ];

  if (rootCauses.length > 0) {
    bodyParts.push("", "**Root Causes:**");
    rootCauses.slice(0, 5).forEach(r => bodyParts.push(`- ${r.area}: ${r.message}`));
  }

  if (structuralGateBlocked) {
    bodyParts.push("", "**⚠️ Structural Gate blockiert Auto-Heal:**");
    Object.entries(gateMetrics).filter(([, v]) => v > 0).forEach(([k, v]) => bodyParts.push(`- ${k}: ${v}`));
  }

  await admin.from("admin_notifications").insert({
    title,
    body: bodyParts.join("\n"),
    category: "ops_health",
    severity,
    metadata: { snapshot_id: snapshot.metadata.run_at, overall_status: overallStatus, auto_heal_allowed: autoHealAllowed },
  });

  // ═══════════════════════════════════════════════════════════
  // 11. AUTO-HEAL TRIGGER (if policy allows + conditions met)
  // ═══════════════════════════════════════════════════════════
  const autoHealConfig = policy.autoHeal;
  let autoHealTriggered = false;

  if (autoHealConfig?.enabled && autoHealAllowed) {
    // Find curricula needing healing
    const { data: packages } = await admin
      .from("course_packages")
      .select("id, curriculum_id, course_id, integrity_score")
      .in("status", ["building", "published", "integrity_failed"])
      .lt("integrity_score", autoHealConfig.scope?.targetScore || 85)
      .order("integrity_score", { ascending: true })
      .limit(autoHealConfig.scope?.maxCurriculaPerRun || 10);

    if (packages && packages.length > 0) {
      for (const pkg of packages) {
        // Check if already running
        const { data: existing } = await admin.from("autofix_runs")
          .select("id").eq("package_id", pkg.id).eq("status", "running").maybeSingle();
        if (existing) continue;

        // Enqueue auto-gap-close
        await admin.from("job_queue").insert({
          job_type: "auto_gap_close",
          status: "pending",
          payload: {
            package_id: pkg.id,
            curriculum_id: pkg.curriculum_id,
            course_id: pkg.course_id,
            target_score: autoHealConfig.scope?.targetScore || 85,
            max_rounds: autoHealConfig.loop?.maxRounds || 3,
            budget_eur: 2.0,
            triggered_by: "daily-test-runner",
          },
          max_attempts: 1,
        });
        autoHealTriggered = true;
      }

      if (autoHealTriggered) {
        await admin.from("admin_notifications").insert({
          title: `🔄 Auto-Heal gestartet für ${packages.length} Paket(e)`,
          body: packages.map((p: any) => `- ${p.id.substring(0, 8)} (Score: ${p.integrity_score})`).join("\n"),
          category: "auto_heal",
          severity: "info",
        });
      }
    }
  }

  console.log(`[DailyRunner] ${title} | autoHeal=${autoHealTriggered}`);

  return new Response(JSON.stringify({
    overall_status: overallStatus,
    summary: { total: results.length, passed, failed, duration_ms: totalDuration },
    root_causes: rootCauses.slice(0, 5),
    guardrails: snapshot.guardrails,
    auto_heal: { triggered: autoHealTriggered, allowed: autoHealAllowed },
    results,
  }), { status: failed > 0 ? 207 : 200, headers });
});
