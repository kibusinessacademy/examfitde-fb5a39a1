import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type SB = any;
type JsonRow = Record<string, unknown>;

/** Fail-soft query: returns empty array if table/view doesn't exist */
async function safeFrom(sb: SB, table: string, query: string, filters?: (q: any) => any) {
  try {
    let q = sb.from(table).select(query);
    if (filters) q = filters(q);
    const { data, error } = await q;
    if (error) {
      console.warn(`[admin-control-tower] safeFrom(${table}) error:`, error.message);
      return [];
    }
    return (data ?? []) as JsonRow[];
  } catch (e) {
    console.warn(`[admin-control-tower] safeFrom(${table}) exception:`, e);
    return [];
  }
}

/** Fail-soft count query */
async function safeCount(sb: SB, table: string, filters?: (q: any) => any): Promise<number> {
  try {
    let q = sb.from(table).select("id", { count: "exact", head: true });
    if (filters) q = filters(q);
    const { count, error } = await q;
    if (error) {
      console.warn(`[admin-control-tower] safeCount(${table}) error:`, error.message);
      return 0;
    }
    return count ?? 0;
  } catch (e) {
    console.warn(`[admin-control-tower] safeCount(${table}) exception:`, e);
    return 0;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Admin role guard
    const sb = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);
    const body = await req.json();
    const { action, recovery_type, package_id } = body;

    switch (action) {
      case "overview":
        return json(await getOverview(sb));
      case "ops_queue":
        return json(await getOpsQueue(sb));
      case "provider_health":
        return json(await getProviderHealth(sb));
      case "package_risk":
        return json(await getPackageRisk(sb));
      case "revenue":
        return json(await getRevenue(sb));
      case "dashboard":
        return json(await getDashboard(sb));
      case "executive_kpis":
        return json(await getExecutiveKpis(sb));
      case "telemetry_integrity":
        return json(await getTelemetryIntegrity(sb));
      case "recovery_action":
        return json(await runRecoveryAction(sb, recovery_type ?? null, package_id ?? null));
      case "exam_pool_audit":
        return json(await getExamPoolAudit(sb));
      case "trap_coverage_audit":
        return json(await getTrapCoverageAudit(sb));
      case "trap_quality_audit":
        return json(await getTrapQualityAudit(sb));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function getOverview(sb: SB) {
  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [
    pendingCount,
    processingCount,
    completed24hCount,
    failed24hCount,
    stalledRows,
    cooldownRows,
    stepsRows,
    claimIssueRows,
    blockedPubRows,
    lcStarvationRows,
  ] = await Promise.all([
    safeCount(sb, "job_queue", (q: any) => q.eq("status", "pending")),
    safeCount(sb, "job_queue", (q: any) => q.eq("status", "processing")),
    safeCount(sb, "job_queue", (q: any) => q.eq("status", "completed").gte("updated_at", h24)),
    safeCount(sb, "job_queue", (q: any) => q.eq("status", "failed").gte("updated_at", h24)),
    safeFrom(sb, "ops_package_steps_stuck", "*", (q: any) => q.limit(200)),
    safeFrom(sb, "llm_provider_cooldowns", "*", (q: any) => q.gt("cooldown_until", now.toISOString())),
    safeFrom(sb, "ops_course_build_progress", "*", (q: any) => q.limit(300)),
    safeFrom(sb, "license_claims", "id,status", (q: any) =>
      q.in("status", ["failed", "conflict", "pending_manual_review"])
    ),
    safeFrom(sb, "v_package_publish_readiness", "package_id,publish_ready", (q: any) =>
      q.eq("publish_ready", false).limit(200)
    ),
    // LC starvation: building packages with generate_learning_content not done and no live jobs
    (async () => {
      try {
        const { data: steps } = await sb
          .from("package_steps")
          .select("package_id, status, meta")
          .eq("step_key", "generate_learning_content")
          .neq("status", "done");
        if (!steps || steps.length === 0) return [];

        const pkgIds = steps.map((s: any) => s.package_id);
        const { data: buildingPkgs } = await sb
          .from("course_packages")
          .select("id")
          .in("id", pkgIds)
          .eq("status", "building");
        if (!buildingPkgs || buildingPkgs.length === 0) return [];

        const buildingIds = buildingPkgs.map((p: any) => p.id);
        const { data: liveJobs } = await sb
          .from("job_queue")
          .select("package_id")
          .eq("job_type", "lesson_generate_content")
          .in("status", ["pending", "queued", "processing"])
          .in("package_id", buildingIds);

        const liveSet = new Set((liveJobs || []).map((j: any) => j.package_id));
        return buildingIds.filter((id: string) => !liveSet.has(id));
      } catch { return []; }
    })(),
  ]);

  const stalledCount = stalledRows.length;
  const cooldownCount = cooldownRows.length;
  const openClaimIssues = claimIssueRows.length;
  const blockedPublishables = blockedPubRows.length;
  const lcStarvationCount = lcStarvationRows.length;

  // Build pipeline step stats
  const stepMap = new Map<string, { queued: number; running: number; blocked: number; done: number; failed: number }>();
  for (const row of stepsRows) {
    const statusJson = row.step_status_json;
    if (statusJson && typeof statusJson === "object") {
      for (const [stepKey, rawStatus] of Object.entries(statusJson as Record<string, string>)) {
        if (!stepMap.has(stepKey)) {
          stepMap.set(stepKey, { queued: 0, running: 0, blocked: 0, done: 0, failed: 0 });
        }
        const entry = stepMap.get(stepKey)!;
        const s = String(rawStatus).toLowerCase();
        if (s === "queued") entry.queued++;
        else if (s === "processing" || s === "running") entry.running++;
        else if (s === "blocked") entry.blocked++;
        else if (s === "done" || s === "completed") entry.done++;
        else if (s === "failed" || s === "error") entry.failed++;
      }
    }
  }

  const pipeline = Array.from(stepMap.entries()).map(([step_key, counts]) => ({
    step_key,
    ...counts,
  }));

  // Determine system health tone from aggregate signals
  const systemIssues = (failed24hCount > 10 ? 1 : 0) + (stalledCount > 10 ? 1 : 0) + (cooldownCount > 3 ? 1 : 0);
  const systemTone = systemIssues >= 2 ? "red" as const : systemIssues === 1 ? "yellow" as const : "green" as const;

  const health = [
    { key: "system", label: "System", tone: systemTone, count: systemIssues },
    { key: "queue", label: "Queue", tone: pendingCount > 50 ? "red" as const : pendingCount > 20 ? "yellow" as const : "green" as const, count: pendingCount },
    { key: "ai", label: "AI", tone: cooldownCount > 3 ? "red" as const : cooldownCount > 0 ? "yellow" as const : "green" as const, count: cooldownCount },
    { key: "build", label: "Build", tone: stalledCount > 5 ? "red" as const : stalledCount > 0 ? "yellow" as const : "green" as const, count: stalledCount },
    { key: "publish", label: "Publish", tone: blockedPublishables > 5 ? "red" as const : blockedPublishables > 0 ? "yellow" as const : "green" as const, count: blockedPublishables },
    { key: "revenue", label: "Revenue", tone: openClaimIssues > 5 ? "red" as const : openClaimIssues > 0 ? "yellow" as const : "green" as const, count: openClaimIssues },
  ];

  const alerts = [
    ...stalledRows.slice(0, 5).map((row: JsonRow, i: number) => ({
      id: `stalled-${i}`,
      severity: "high" as const,
      domain: "ops" as const,
      title: `Stalled: ${row.package_id ?? "unknown"}`,
      detail: `Step stuck: ${row.step_key ?? "–"}`,
    })),
    ...(cooldownCount > 0
      ? [{
          id: "provider-cooldowns",
          severity: (cooldownCount > 3 ? "critical" : "high") as "critical" | "high",
          domain: "ops" as const,
          title: `${cooldownCount} aktive Provider-Cooldowns`,
          detail: "LLM-Provider sind im Cooldown oder Rate-Limit-Backoff.",
        }]
      : []),
    ...(openClaimIssues > 0
      ? [{
          id: "claim-issues",
          severity: (openClaimIssues > 5 ? "critical" : "medium") as "critical" | "medium",
          domain: "revenue" as const,
          title: `${openClaimIssues} offene Claim-/Lizenzprobleme`,
          detail: "Zugriffs- oder Aktivierungsprobleme mit Umsatzwirkung.",
        }]
      : []),
    ...(blockedPublishables > 3
      ? [{
          id: "blocked-publish",
          severity: (blockedPublishables > 10 ? "high" : "medium") as "high" | "medium",
          domain: "quality" as const,
          title: `${blockedPublishables} Pakete nicht publish-ready`,
          detail: "Integritäts- oder Qualitätsprüfungen blockieren die Veröffentlichung.",
        }]
      : []),
    ...(lcStarvationCount > 0
      ? [{
          id: "lc-starvation",
          severity: (lcStarvationCount > 3 ? "critical" : "high") as "critical" | "high",
          domain: "ops" as const,
          title: `${lcStarvationCount} Pakete mit Content-Starvation`,
          detail: "Building-Pakete mit offenen Inhalten, aber ohne aktive Content-Jobs.",
        }]
      : []),
  ];

  return {
    health,
    alerts,
    kpis: {
      pending_jobs: pendingCount,
      processing_jobs: processingCount,
      completed_24h: completed24hCount,
      failed_24h: failed24hCount,
      stalled_packages: stalledCount,
      provider_cooldowns: cooldownCount,
      blocked_publishables: blockedPublishables,
      open_claim_issues: openClaimIssues,
      lc_starvation: lcStarvationCount,
    },
    pipeline,
  };
}

async function getOpsQueue(sb: SB) {
  const data = await safeFrom(
    sb,
    "job_queue",
    "id, job_type, status, attempts, max_attempts, package_id, last_error, created_at",
    (q: any) => q.in("status", ["pending", "processing", "failed"]).order("created_at", { ascending: false }).limit(100),
  );

  // Resolve package titles
  const pkgIds = [...new Set(data.map((r: JsonRow) => r.package_id).filter(Boolean))] as string[];
  const pkgMap: Record<string, string> = {};
  if (pkgIds.length > 0) {
    const pkgs = await safeFrom(sb, "course_packages", "id, title", (q: any) => q.in("id", pkgIds));
    for (const p of pkgs) {
      pkgMap[String(p.id)] = String(p.title ?? "");
    }
  }

  return data.map((row: JsonRow) => {
    const pid = row.package_id ? String(row.package_id) : null;
    return {
      job_id: row.id,
      job_type: row.job_type,
      status: row.status,
      attempts: row.attempts ?? 0,
      max_attempts: row.max_attempts ?? 5,
      package_ref: pid ? pid.slice(0, 8) : null,
      package_title: pid && pkgMap[pid] ? pkgMap[pid] : null,
      error: row.last_error ? String(row.last_error).slice(0, 200) : null,
      created_at: row.created_at,
    };
  });
}

async function getProviderHealth(sb: SB) {
  const cooldowns = await safeFrom(sb, "llm_provider_cooldowns", "*", (q: any) => q.limit(50));

  return cooldowns.map((row: JsonRow) => ({
    provider: row.provider ?? "unknown",
    model: row.model ?? "–",
    status: row.cooldown_until && new Date(row.cooldown_until as string) > new Date() ? "cooldown" : "healthy",
    cooldown_until: row.cooldown_until ?? null,
    success_rate_1h: null,
    avg_latency_ms_1h: null,
    requests_1h: 0,
    failures_1h: 0,
    top_reason: row.reason ?? null,
  }));
}

async function getPackageRisk(sb: SB) {
  const data = await safeFrom(sb, "ops_package_steps_stuck", "*", (q: any) => q.limit(50));

  return data.map((row: JsonRow, i: number) => {
    const packageId =
      typeof row.package_id === "string" && row.package_id.length > 0
        ? row.package_id
        : `unknown-${i}`;

    const stallMinutes =
      typeof row.stall_minutes === "number"
        ? row.stall_minutes
        : typeof row.minutes_stuck === "number"
        ? row.minutes_stuck
        : null;

    const reason =
      typeof row.reason === "string"
        ? row.reason
        : typeof row.blocked_reason === "string"
        ? row.blocked_reason
        : null;

    const integrityPassed =
      typeof row.integrity_passed === "boolean" ? row.integrity_passed : null;

    const placeholderCount =
      typeof row.placeholder_count === "number" ? row.placeholder_count : null;

    const publishReady =
      typeof row.publish_ready === "boolean" ? row.publish_ready : null;

    const riskScore =
      (stallMinutes != null
        ? stallMinutes > 120 ? 40 : stallMinutes > 45 ? 25 : 10
        : 10) +
      (integrityPassed === false ? 20 : 0) +
      ((placeholderCount ?? 0) > 0 ? 20 : 0) +
      (publishReady === false ? 10 : 0);

    return {
      package_id: packageId,
      package_title:
        typeof row.package_title === "string" && row.package_title.length > 0
          ? row.package_title
          : packageId.slice(0, 8),
      curriculum_title:
        typeof row.curriculum_title === "string" ? row.curriculum_title : null,
      track: typeof row.track === "string" ? row.track : null,
      status: typeof row.status === "string" ? row.status : "building",
      current_step: typeof row.step_key === "string" ? row.step_key : null,
      blocked_reason: reason,
      stall_minutes: stallMinutes,
      integrity_passed: integrityPassed,
      placeholder_count: placeholderCount,
      publish_ready: publishReady,
      risk_score: riskScore,
    };
  });
}

async function getRevenue(sb: SB) {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const d24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [ordersToday, orders7d, orders30d, claimIssues, seats, checkoutFails] =
    await Promise.all([
      safeFrom(sb, "orders", "id,total_amount,amount,created_at", (q: any) => q.gte("created_at", dayStart.toISOString())),
      safeFrom(sb, "orders", "id,total_amount,amount,created_at", (q: any) => q.gte("created_at", d7)),
      safeFrom(sb, "orders", "id,total_amount,amount,created_at", (q: any) => q.gte("created_at", d30)),
      safeFrom(sb, "license_claims", "id,status", (q: any) => q.in("status", ["failed", "conflict", "pending_manual_review"])),
      safeFrom(sb, "corporate_license_seats", "id,learner_user_id"),
      safeFrom(sb, "checkout_events", "id,status,created_at", (q: any) => q.eq("status", "failed").gte("created_at", d24)),
    ]);

  const sumAmounts = (rows: JsonRow[]) =>
    rows.reduce((sum, row) => {
      const value =
        typeof row.total_amount === "number" ? row.total_amount
        : typeof row.amount === "number" ? row.amount
        : 0;
      return sum + value;
    }, 0);

  return {
    orders_today: ordersToday.length,
    revenue_today: sumAmounts(ordersToday),
    revenue_7d: sumAmounts(orders7d),
    revenue_30d: sumAmounts(orders30d),
    open_claim_issues: claimIssues.length,
    corporate_seats_total: seats.length,
    corporate_seats_claimed: seats.filter((row: JsonRow) => !!row.learner_user_id).length,
    checkout_failures_24h: checkoutFails.length,
  };
}

async function getDashboard(sb: SB) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    pkgStatuses,
    buildingPkgs,
    jobsPending,
    jobsProcessing,
    jobsCompletedToday,
    jobsFailed24h,
    costToday,
    budgetRow,
    stalledRows,
    cooldownRows,
    claimIssues,
    blockedPubRows,
    lcStarvation,
    orders30d,
    buildMetrics,
    stepsRows,
  ] = await Promise.all([
    safeFrom(sb, "course_packages", "id,status,build_progress,title,step_status_json,current_step,updated_at"),
    safeFrom(sb, "course_packages", "id,title,status,build_progress,step_status_json,current_step,updated_at", (q: any) => q.eq("status", "building").order("updated_at", { ascending: false })),
    safeCount(sb, "job_queue", (q: any) => q.eq("status", "pending")),
    safeCount(sb, "job_queue", (q: any) => q.eq("status", "processing")),
    safeCount(sb, "job_queue", (q: any) => q.eq("status", "completed").gte("completed_at", todayStart.toISOString())),
    safeCount(sb, "job_queue", (q: any) => q.eq("status", "failed").gte("updated_at", h24)),
    (async () => { try { const { data } = await sb.rpc("get_ai_cost_summary"); return data ?? { cost_today: 0, cost_mtd: 0 }; } catch { return { cost_today: 0, cost_mtd: 0 }; } })(),
    safeFrom(sb, "ai_cost_budgets", "budget_eur,spent_eur", (q: any) => q.order("month", { ascending: false }).limit(1)),
    safeFrom(sb, "ops_package_steps_stuck", "*", (q: any) => q.limit(200)),
    safeFrom(sb, "llm_provider_cooldowns", "provider,model,reason,until_at", (q: any) => q.gt("until_at", now.toISOString())),
    safeFrom(sb, "license_claims", "id,status", (q: any) => q.in("status", ["failed", "conflict", "pending_manual_review"])),
    safeFrom(sb, "v_package_publish_readiness", "package_id,publish_ready", (q: any) => q.eq("publish_ready", false).limit(200)),
    // LC starvation check
    (async () => {
      try {
        const { data: steps } = await sb.from("package_steps").select("package_id,status").eq("step_key", "generate_learning_content").neq("status", "done");
        if (!steps?.length) return 0;
        const pkgIds = steps.map((s: any) => s.package_id);
        const { data: bpkgs } = await sb.from("course_packages").select("id").in("id", pkgIds).eq("status", "building");
        if (!bpkgs?.length) return 0;
        const bIds = bpkgs.map((p: any) => p.id);
        const { data: liveJobs } = await sb.from("job_queue").select("package_id").eq("job_type", "lesson_generate_content").in("status", ["pending", "processing"]).in("package_id", bIds);
        const liveSet = new Set((liveJobs || []).map((j: any) => j.package_id));
        return bIds.filter((id: string) => !liveSet.has(id)).length;
      } catch { return 0; }
    })(),
    safeFrom(sb, "orders", "id,total_amount,amount", (q: any) => q.gte("created_at", d30)),
    (async () => {
      try {
        const { data } = await sb.rpc("get_building_metrics");
        return data ?? { active_by_jobs: 0, active_by_leases: 0, status_building: 0, zombies: 0 };
      } catch { return { active_by_jobs: 0, active_by_leases: 0, status_building: 0, zombies: 0 }; }
    })(),
    safeFrom(sb, "package_steps", "package_id,step_key,status,started_at,finished_at,last_error,meta", (q: any) => q.limit(1000)),
  ]);

  const costSummary = costToday as any;
  const dailyCost = Number(costSummary?.cost_today) || 0;
  const budget = (budgetRow as JsonRow[])[0];
  const revenue30dTotal = (orders30d as JsonRow[]).reduce((s, r) => s + (Number(r.total_amount) || Number(r.amount) || 0), 0);

  const statusCounts = { total: 0, building: 0, queued: 0, published: 0, done: 0, failed: 0 };
  for (const p of pkgStatuses) {
    statusCounts.total++;
    const st = String(p.status);
    if (st === "building") statusCounts.building++;
    else if (st === "queued") statusCounts.queued++;
    else if (st === "published") statusCounts.published++;
    else if (st === "done") statusCounts.done++;
    else if (st === "failed" || st === "quality_gate_failed") statusCounts.failed++;
  }

  // Build pipeline step aggregation from actual steps
  const stepAgg = new Map<string, { queued: number; running: number; done: number; failed: number }>();
  for (const row of stepsRows) {
    const key = String(row.step_key);
    if (!stepAgg.has(key)) stepAgg.set(key, { queued: 0, running: 0, done: 0, failed: 0 });
    const entry = stepAgg.get(key)!;
    const s = String(row.status);
    if (s === "queued") entry.queued++;
    else if (s === "running" || s === "processing" || s === "enqueued") entry.running++;
    else if (s === "done" || s === "skipped") entry.done++;
    else if (s === "failed" || s === "timeout") entry.failed++;
  }
  const pipelineSteps = Array.from(stepAgg.entries()).map(([step_key, c]) => ({ step_key, ...c }));

  // Health signals
  const stalledCount = (stalledRows as JsonRow[]).length;
  const cooldownCount = (cooldownRows as JsonRow[]).length;
  const claimCount = (claimIssues as JsonRow[]).length;
  const blockedPubCount = (blockedPubRows as JsonRow[]).length;
  const starvationCount = lcStarvation as number;

  const systemIssues = (jobsFailed24h > 10 ? 1 : 0) + (stalledCount > 5 ? 1 : 0) + (cooldownCount > 3 ? 1 : 0);
  const systemTone = systemIssues >= 2 ? "red" : systemIssues === 1 ? "yellow" : "green";

  const health = [
    { key: "system", label: "System", tone: systemTone, count: systemIssues },
    { key: "queue", label: "Queue", tone: jobsPending > 50 ? "red" : jobsPending > 20 ? "yellow" : "green", count: jobsPending },
    { key: "ai", label: "AI", tone: cooldownCount > 3 ? "red" : cooldownCount > 0 ? "yellow" : "green", count: cooldownCount },
    { key: "build", label: "Build", tone: stalledCount > 5 ? "red" : stalledCount > 0 ? "yellow" : "green", count: stalledCount },
    { key: "publish", label: "Publish", tone: blockedPubCount > 5 ? "red" : blockedPubCount > 0 ? "yellow" : "green", count: blockedPubCount },
    { key: "revenue", label: "Revenue", tone: claimCount > 5 ? "red" : claimCount > 0 ? "yellow" : "green", count: claimCount },
  ];

  // Building packages with step details
  const enrichedBuilding = (buildingPkgs as JsonRow[]).map((pkg: JsonRow) => ({
    id: pkg.id,
    title: String(pkg.title || "").replace("ExamFit – ", ""),
    status: pkg.status,
    build_progress: Number(pkg.build_progress) || 0,
    current_step: pkg.current_step,
    step_status_json: pkg.step_status_json,
    updated_at: pkg.updated_at,
  }));

  // Drift finder summary
  const driftRows = await safeFrom(sb, "ops_drift_finder", "drift_type,package_id,title,detail");
  const driftSummary: Record<string, number> = {};
  for (const r of driftRows) {
    const t = String(r.drift_type);
    driftSummary[t] = (driftSummary[t] || 0) + 1;
  }
  const totalDrift = driftRows.length;

  // Add drift to health signals
  if (totalDrift > 0) {
    health.push({
      key: "trust",
      label: "Trust",
      tone: totalDrift > 20 ? "red" : totalDrift > 5 ? "yellow" : "green",
      count: totalDrift,
      hint: `${Object.entries(driftSummary).map(([k, v]) => `${k}:${v}`).join(", ")}`,
    });
  }

  return {
    health,
    kpis: {
      total_packages: statusCounts.total,
      building: statusCounts.building,
      queued: statusCounts.queued,
      published: statusCounts.published,
      done: statusCounts.done,
      failed: statusCounts.failed,
      jobs_pending: jobsPending,
      jobs_processing: jobsProcessing,
      jobs_completed_today: jobsCompletedToday,
      jobs_failed_24h: jobsFailed24h,
      cost_today_eur: dailyCost,
      budget_eur: Number(budget?.budget_eur) || 200,
      stalled_packages: stalledCount,
      provider_cooldowns: cooldownCount,
      blocked_publishables: blockedPubCount,
      open_claim_issues: claimCount,
      lc_starvation: starvationCount,
      revenue_30d: revenue30dTotal,
      building_metrics: buildMetrics,
    },
    building_packages: enrichedBuilding,
    pipeline: pipelineSteps,
    cooldowns: (cooldownRows as JsonRow[]).map((r) => ({
      provider: r.provider,
      model: r.model,
      reason: r.reason,
      until_at: r.until_at,
    })),
    drift: {
      total: totalDrift,
      by_type: driftSummary,
      items: driftRows.slice(0, 50), // Top 50 for UI
    },
  };
}

async function getExecutiveKpis(sb: SB) {
  const rows = await safeFrom(sb, "v_ops_executive_kpis", "*");
  return rows[0] ?? {};
}

async function getTelemetryIntegrity(sb: SB) {
  const rows = await safeFrom(sb, "ops_telemetry_integrity", "*");
  const gapCount = rows.filter((r: any) => r.logging_gap).length;
  const criticalDrift = rows.filter((r: any) => r.drift_severity === "critical").length;
  const warningDrift = rows.filter((r: any) => r.drift_severity === "warning").length;
  return {
    packages: rows,
    summary: {
      total: rows.length,
      logging_gaps: gapCount,
      critical_drift: criticalDrift,
      warning_drift: warningDrift,
      healthy: rows.length - gapCount - criticalDrift - warningDrift,
    },
  };
}

async function runRecoveryAction(sb: SB, recoveryType: string | null, packageId: string | null) {
  if (!recoveryType || !packageId) {
    return { error: "recovery_type and package_id required" };
  }
  const rpcMap: Record<string, string> = {
    repair_finalize: "repair_missing_finalize_artifact",
    clear_guards: "clear_stale_guard_loops",
    reconcile_progress: "reconcile_package_progress",
  };
  const rpcName = rpcMap[recoveryType];
  if (!rpcName) return { error: `Unknown recovery_type: ${recoveryType}` };

  const { data, error } = await sb.rpc(rpcName, { p_package_id: packageId });
  if (error) return { error: error.message };
  return { ok: true, result: data };
}

/**
 * Exam Pool Lifecycle Audit
 * Shows packages where generate_exam_pool = queued but questions already exist,
 * plus recent deadlock guard blocks from auto_heal_log.
 */
async function getExamPoolAudit(sb: SB) {
  // 1. Find packages where generate_exam_pool is NOT done but questions exist
  const stepsRows = await safeFrom(
    sb,
    "package_steps",
    "package_id, status, last_error, updated_at",
    (q: any) => q.eq("step_key", "generate_exam_pool").in("status", ["queued", "pending", "failed"])
  );

  if (stepsRows.length === 0) {
    return { packages: [], guard_events: [] };
  }

  const packageIds = stepsRows.map((r: any) => r.package_id as string);

  // 2. Resolve package_id → curriculum_id (exam_questions has NO package_id column)
  const pkgRows = await safeFrom(sb, "course_packages", "id, curriculum_id", (q: any) => q.in("id", packageIds));
  const pkgToCurr: Record<string, string> = {};
  for (const r of pkgRows) {
    if (r.curriculum_id) pkgToCurr[r.id as string] = r.curriculum_id as string;
  }

  // 3. Count exam questions per curriculum (mapped back to package)
  const questionCounts: Record<string, { total: number; draft: number; review: number; approved: number; tier1_passed: number }> = {};
  for (const pid of packageIds) {
    const cid = pkgToCurr[pid];
    if (!cid) {
      questionCounts[pid] = { total: 0, draft: 0, review: 0, approved: 0, tier1_passed: 0 };
      continue;
    }
    const [totalRes, draftRes, reviewRes, approvedRes, tier1Res] = await Promise.all([
      sb.from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", cid).not("status", "eq", "rejected"),
      sb.from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", cid).eq("status", "draft"),
      sb.from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", cid).eq("status", "review"),
      sb.from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", cid).eq("status", "approved"),
      sb.from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", cid).eq("status", "draft").eq("qc_status", "tier1_passed"),
    ]);
    questionCounts[pid] = {
      total: totalRes.count ?? 0,
      draft: draftRes.count ?? 0,
      review: reviewRes.count ?? 0,
      approved: approvedRes.count ?? 0,
      tier1_passed: tier1Res.count ?? 0,
    };
  }

  // Filter: only packages that actually have questions
  const driftPackages = stepsRows
    .filter((r: any) => (questionCounts[r.package_id as string]?.total ?? 0) > 0)
    .map((r: any) => {
      const pid = r.package_id as string;
      const counts = questionCounts[pid];
      let diagnosis = "unknown";
      if (counts.review > 0 || counts.approved > 0) diagnosis = "compatible_unapproved";
      else if (counts.tier1_passed > 0) diagnosis = "lifecycle_drift";
      else if (counts.draft > 0) diagnosis = "draft_only";
      return {
        package_id: pid,
        step_status: r.status,
        last_error: r.last_error,
        step_updated_at: r.updated_at,
        diagnosis,
        ...counts,
      };
    })
    .sort((a: any, b: any) => b.total - a.total);

  // 3. Fetch package titles
  const titleRows = driftPackages.length > 0
    ? await safeFrom(sb, "course_packages", "id, title", (q: any) => q.in("id", driftPackages.map((d: any) => d.package_id)))
    : [];
  const titleMap = Object.fromEntries(titleRows.map((r: any) => [r.id, r.title]));
  for (const d of driftPackages) {
    (d as any).package_title = titleMap[d.package_id] ?? null;
  }

  // 4. Recent deadlock guard events
  const guardEvents = await safeFrom(
    sb,
    "auto_heal_log",
    "id, action_type, target_id, target_type, result_status, result_detail, metadata, created_at",
    (q: any) => q.eq("action_type", "deadlock_guard_blocked_reseed")
      .order("created_at", { ascending: false })
      .limit(20),
  );

  return { packages: driftPackages, guard_events: guardEvents };
}

async function getTrapCoverageAudit(sb: SB) {
  // Get all non-archived packages with their curriculum_id
  const pkgRows = await safeFrom(sb, "course_packages", "id, title, status, curriculum_id", (q: any) =>
    q.not("status", "eq", "archived").not("curriculum_id", "is", null).limit(200)
  );

  if (pkgRows.length === 0) return { packages: [], global: { total: 0, missing: 0, coverage_pct: 100 } };

  const results: Array<{
    package_id: string;
    title: string | null;
    status: string;
    approved_total: number;
    missing_trap: number;
    coverage_pct: number;
    risk: 'critical' | 'high' | 'medium' | 'ok';
  }> = [];

  for (const pkg of pkgRows) {
    const cid = pkg.curriculum_id as string;
    const [totalRes, missingRes] = await Promise.all([
      sb.from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", cid).eq("status", "approved"),
      sb.from("exam_questions").select("id", { count: "exact", head: true })
        .eq("curriculum_id", cid).eq("status", "approved").is("trap_type", null),
    ]);
    const total = totalRes.count ?? 0;
    const missing = missingRes.count ?? 0;
    if (total === 0) continue;
    const pct = Math.round(1000 * (total - missing) / total) / 10;
    const risk = pct === 0 ? 'critical' : pct < 20 ? 'high' : pct < 80 ? 'medium' : 'ok';
    if (risk !== 'ok') {
      results.push({
        package_id: pkg.id as string,
        title: pkg.title as string | null,
        status: pkg.status as string,
        approved_total: total,
        missing_trap: missing,
        coverage_pct: pct,
        risk,
      });
    }
  }

  results.sort((a, b) => a.coverage_pct - b.coverage_pct);

  // Global stats
  const [gTotal, gMissing] = await Promise.all([
    sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("status", "approved"),
    sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("status", "approved").is("trap_type", null),
  ]);
  const gt = gTotal.count ?? 0;
  const gm = gMissing.count ?? 0;

  return {
    packages: results,
    global: { total: gt, missing: gm, coverage_pct: gt > 0 ? Math.round(1000 * (gt - gm) / gt) / 10 : 100 },
  };
}

// ── Trap Quality Audit (Task 2) ─────────────────────────────────────────
// Set-based distribution audit with resolver, anomaly flags, sample-size gate

interface TrapCorridor {
  trap_type: string;
  target_pct: number;
  min_pct: number;
  max_pct: number;
  warn_below_pct: number;
  hard_below_pct: number;
  source: 'blueprint' | 'curriculum' | 'track';
}

interface TrapDistributionRuleset {
  corridors: TrapCorridor[];
  profile: string;
  resolved_from: string;
}

function resolveRulesForPackage(
  allRules: JsonRow[],
  curriculumId: string,
  track: string,
  profile?: string,
): TrapDistributionRuleset {
  // 1. Curriculum-specific
  const currRules = allRules.filter(r => r.scope_type === 'curriculum' && r.scope_id === curriculumId);
  if (currRules.length >= 3) {
    return {
      corridors: currRules.map(r => ({
        trap_type: String(r.trap_type),
        target_pct: Number(r.target_pct),
        min_pct: Number(r.min_pct),
        max_pct: Number(r.max_pct),
        warn_below_pct: Number(r.warn_below_pct),
        hard_below_pct: Number(r.hard_below_pct),
        source: 'curriculum' as const,
      })),
      profile: String((currRules[0] as any).curriculum_profile || 'mixed'),
      resolved_from: `curriculum:${curriculumId}`,
    };
  }

  // 2. Track + profile
  const effectiveProfile = profile || 'mixed';
  const profileScopeId = effectiveProfile === 'mixed' ? track : `${track}:${effectiveProfile}`;
  const profileRules = allRules.filter(r => r.scope_type === 'track' && r.scope_id === profileScopeId);
  if (profileRules.length >= 3) {
    return {
      corridors: profileRules.map(r => ({
        trap_type: String(r.trap_type),
        target_pct: Number(r.target_pct),
        min_pct: Number(r.min_pct),
        max_pct: Number(r.max_pct),
        warn_below_pct: Number(r.warn_below_pct),
        hard_below_pct: Number(r.hard_below_pct),
        source: 'track' as const,
      })),
      profile: effectiveProfile,
      resolved_from: `track:${profileScopeId}`,
    };
  }

  // 3. Track default
  const defaultRules = allRules.filter(r => r.scope_type === 'track' && r.scope_id === track);
  if (defaultRules.length >= 3) {
    return {
      corridors: defaultRules.map(r => ({
        trap_type: String(r.trap_type),
        target_pct: Number(r.target_pct),
        min_pct: Number(r.min_pct),
        max_pct: Number(r.max_pct),
        warn_below_pct: Number(r.warn_below_pct),
        hard_below_pct: Number(r.hard_below_pct),
        source: 'track' as const,
      })),
      profile: 'mixed',
      resolved_from: `track:${track}:fallback`,
    };
  }

  // 4. Hardcoded ultimate fallback
  return {
    corridors: [
      { trap_type: 'misconception',   target_pct: 35, min_pct: 25, max_pct: 45, warn_below_pct: 20, hard_below_pct: 15, source: 'track' },
      { trap_type: 'typical_error',    target_pct: 40, min_pct: 30, max_pct: 50, warn_below_pct: 25, hard_below_pct: 20, source: 'track' },
      { trap_type: 'calculation_trap', target_pct: 25, min_pct: 15, max_pct: 35, warn_below_pct: 10, hard_below_pct: 5,  source: 'track' },
    ],
    profile: 'mixed',
    resolved_from: 'hardcoded:fallback',
  };
}

function computeAnomalyFlags(
  ruleset: TrapDistributionRuleset,
  actual: Record<string, number>,
  total: number,
  details: Array<{ trap_type: string; actual_pct: number; signal: string; }>,
): string[] {
  const flags: string[] = [];
  const pctOf = (t: string) => total > 0 ? ((actual[t] || 0) / total) * 100 : 0;

  // Missing type entirely
  if (!actual['calculation_trap'] || actual['calculation_trap'] === 0) flags.push('NO_CALCULATION_TRAP');
  if (!actual['typical_error'] || actual['typical_error'] === 0) flags.push('NO_TYPICAL_ERROR');
  if (!actual['misconception'] || actual['misconception'] === 0) flags.push('NO_MISCONCEPTION');

  // Overweight: > max_pct from corridor
  for (const c of ruleset.corridors) {
    const pct = pctOf(c.trap_type);
    if (pct > c.max_pct) {
      flags.push(`OVERWEIGHT_${c.trap_type.toUpperCase()}`);
    }
  }

  // Multi-warn
  const warnCount = details.filter(d => d.signal === 'warn').length;
  const hardCount = details.filter(d => d.signal === 'hard_fail').length;
  if (warnCount >= 2) flags.push('MULTI_WARN');
  if (hardCount > 0) flags.push('HARD_FAIL_PRESENT');

  // Profile mismatch: if profile is concept_heavy but calculation_trap dominates
  const profile = ruleset.profile;
  if (profile === 'concept_heavy' && pctOf('calculation_trap') > 40) flags.push('PROFILE_MISMATCH_SUSPECTED');
  if (profile === 'calculation_heavy' && pctOf('misconception') > 50) flags.push('PROFILE_MISMATCH_SUSPECTED');
  if (profile === 'procedure_heavy' && pctOf('calculation_trap') > 40) flags.push('PROFILE_MISMATCH_SUSPECTED');

  return [...new Set(flags)];
}

const MIN_SAMPLE_SIZE = 30;

async function getTrapQualityAudit(sb: SB) {
  // 1. Fetch all rules in one go
  const allRules = await safeFrom(sb, "trap_distribution_rules", "*");

  // 2. Fetch all non-archived packages with curriculum + track info
  const pkgRows = await safeFrom(sb, "course_packages", "id, title, status, curriculum_id, track", (q: any) =>
    q.not("status", "eq", "archived").not("curriculum_id", "is", null).limit(500)
  );
  if (pkgRows.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      global: { packages_total: 0, packages_warn: 0, packages_hard_fail: 0 },
      packages: [],
    };
  }

  // 3. Set-based: fetch ALL approved questions with just curriculum_id + trap_type
  //    This is much more efficient than per-package queries
  const curriculumIds = [...new Set(pkgRows.map(p => p.curriculum_id as string))];
  const allQuestions: Array<{ curriculum_id: string; trap_type: string | null }> = [];

  // Batch in chunks of 20 curriculum IDs to stay within query limits
  for (let i = 0; i < curriculumIds.length; i += 20) {
    const chunk = curriculumIds.slice(i, i + 20);
    const rows = await safeFrom(
      sb, "exam_questions", "curriculum_id, trap_type",
      (q: any) => q.eq("status", "approved").in("curriculum_id", chunk).limit(10000)
    );
    for (const r of rows) {
      allQuestions.push({ curriculum_id: r.curriculum_id as string, trap_type: r.trap_type as string | null });
    }
  }

  // 4. Aggregate trap counts per curriculum_id
  const currAgg = new Map<string, { total: number; counts: Record<string, number> }>();
  for (const q of allQuestions) {
    if (!currAgg.has(q.curriculum_id)) {
      currAgg.set(q.curriculum_id, { total: 0, counts: {} });
    }
    const agg = currAgg.get(q.curriculum_id)!;
    agg.total++;
    const tt = q.trap_type || '__missing__';
    agg.counts[tt] = (agg.counts[tt] || 0) + 1;
  }

  // 5. Resolve rules + evaluate per package
  const results: Array<Record<string, unknown>> = [];
  let warnCount = 0;
  let hardFailCount = 0;

  for (const pkg of pkgRows) {
    const cid = pkg.curriculum_id as string;
    const agg = currAgg.get(cid);
    if (!agg || agg.total === 0) continue;

    const track = (pkg.track as string) || 'AUSBILDUNG_VOLL';
    const ruleset = resolveRulesForPackage(allRules, cid, track);

    // Build actual counts (excluding __missing__)
    const actualCounts: Record<string, number> = {};
    let countedTotal = 0;
    for (const [tt, count] of Object.entries(agg.counts)) {
      if (tt !== '__missing__') {
        actualCounts[tt] = count;
        countedTotal += count;
      }
    }

    // Sample-size gate
    if (agg.total < MIN_SAMPLE_SIZE) {
      results.push({
        package_id: pkg.id,
        title: pkg.title,
        curriculum_id: cid,
        track,
        profile: ruleset.profile,
        resolved_from: ruleset.resolved_from,
        approved_total: agg.total,
        actual_counts: actualCounts,
        actual_pct: {},
        details: [],
        anomaly_flags: ['INSUFFICIENT_SAMPLE'],
        overall: 'insufficient_sample',
        rebalance_recommended: false,
        recommended_focus: [],
      });
      continue;
    }

    // Evaluate distribution
    const details = ruleset.corridors.map(c => {
      const count = actualCounts[c.trap_type] || 0;
      const pct = countedTotal > 0 ? (count / countedTotal) * 100 : 0;
      let signal: 'ok' | 'warn' | 'hard_fail' = 'ok';
      let reason: string | undefined;

      if (pct < c.hard_below_pct) {
        signal = 'hard_fail';
        reason = `${c.trap_type}: ${pct.toFixed(1)}% < hard ${c.hard_below_pct}%`;
      } else if (pct < c.warn_below_pct) {
        signal = 'warn';
        reason = `${c.trap_type}: ${pct.toFixed(1)}% < warn ${c.warn_below_pct}%`;
      } else if (pct > c.max_pct) {
        signal = 'warn';
        reason = `${c.trap_type}: ${pct.toFixed(1)}% > max ${c.max_pct}%`;
      }

      return {
        trap_type: c.trap_type,
        actual_pct: Math.round(pct * 10) / 10,
        target_pct: c.target_pct,
        signal,
        reason,
      };
    });

    const hardFails = details.filter(d => d.signal === 'hard_fail').length;
    const warns = details.filter(d => d.signal === 'warn').length;
    let overall: 'ok' | 'warn' | 'hard_fail' = 'ok';
    if (hardFails > 0 || warns >= 2) overall = 'hard_fail';
    else if (warns > 0) overall = 'warn';

    if (overall === 'warn') warnCount++;
    if (overall === 'hard_fail') hardFailCount++;

    // Anomaly flags
    const anomalyFlags = computeAnomalyFlags(ruleset, actualCounts, countedTotal, details);

    // Actual percentages
    const actualPct: Record<string, number> = {};
    for (const [tt, count] of Object.entries(actualCounts)) {
      actualPct[tt] = countedTotal > 0 ? Math.round((count / countedTotal) * 1000) / 10 : 0;
    }

    // Rebalance recommendation
    const rebalanceRecommended = overall !== 'ok' || anomalyFlags.length > 0;
    const recommendedFocus = details
      .filter(d => d.signal !== 'ok')
      .map(d => d.trap_type);

    results.push({
      package_id: pkg.id,
      title: pkg.title,
      curriculum_id: cid,
      track,
      profile: ruleset.profile,
      resolved_from: ruleset.resolved_from,
      approved_total: agg.total,
      actual_counts: actualCounts,
      actual_pct: actualPct,
      details,
      anomaly_flags: anomalyFlags,
      overall,
      rebalance_recommended: rebalanceRecommended,
      recommended_focus: recommendedFocus,
    });
  }

  // Sort: hard_fail first, then warn, then ok
  const signalOrder = { hard_fail: 0, warn: 1, insufficient_sample: 2, ok: 3 };
  results.sort((a, b) => {
    const oa = signalOrder[a.overall as keyof typeof signalOrder] ?? 3;
    const ob = signalOrder[b.overall as keyof typeof signalOrder] ?? 3;
    return oa - ob;
  });

  return {
    generated_at: new Date().toISOString(),
    global: {
      packages_total: results.length,
      packages_warn: warnCount,
      packages_hard_fail: hardFailCount,
    },
    packages: results,
  };
}
