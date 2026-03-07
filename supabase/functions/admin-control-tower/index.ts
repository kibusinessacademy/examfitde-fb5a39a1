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
    const { action } = await req.json();

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

  return data.map((row: JsonRow) => ({
    job_id: row.id,
    job_type: row.job_type,
    status: row.status,
    attempts: row.attempts ?? 0,
    max_attempts: row.max_attempts ?? 5,
    package_ref: row.package_id ? String(row.package_id).slice(0, 8) : null,
    error: row.last_error ? String(row.last_error).slice(0, 200) : null,
    created_at: row.created_at,
  }));
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
