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

    const sb = createClient(supabaseUrl, serviceKey);
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

// deno-lint-ignore no-explicit-any
type SB = any;

async function getOverview(sb: SB) {
  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [pendingQ, processingQ, completed24hQ, failed24hQ, stalledQ, cooldownQ, stepsQ] =
    await Promise.all([
      sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
      sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "completed").gte("updated_at", h24),
      sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", h24),
      sb.from("ops_package_steps_stuck").select("*").limit(200),
      sb.from("llm_provider_cooldowns").select("*").gt("cooldown_until", now.toISOString()),
      sb.from("ops_course_build_progress").select("*").limit(300),
    ]);

  const stalledCount = stalledQ.data?.length ?? 0;
  const cooldownCount = cooldownQ.data?.length ?? 0;

  // Build pipeline step stats
  const stepMap = new Map<string, { queued: number; running: number; blocked: number; done: number; failed: number }>();
  for (const row of (stepsQ.data ?? [])) {
    const statusJson = row.step_status_json;
    if (statusJson && typeof statusJson === "object") {
      for (const [stepKey, status] of Object.entries(statusJson as Record<string, string>)) {
        if (!stepMap.has(stepKey)) {
          stepMap.set(stepKey, { queued: 0, running: 0, blocked: 0, done: 0, failed: 0 });
        }
        const entry = stepMap.get(stepKey)!;
        if (status === "queued") entry.queued++;
        else if (status === "processing" || status === "running") entry.running++;
        else if (status === "blocked") entry.blocked++;
        else if (status === "done") entry.done++;
        else if (status === "failed") entry.failed++;
      }
    }
  }

  const pipeline = Array.from(stepMap.entries()).map(([step_key, counts]) => ({
    step_key,
    ...counts,
  }));

  const health = [
    { key: "system", label: "System", tone: "green" as const, count: 0 },
    { key: "queue", label: "Queue", tone: (pendingQ.count ?? 0) > 50 ? "red" as const : (pendingQ.count ?? 0) > 20 ? "yellow" as const : "green" as const, count: pendingQ.count ?? 0 },
    { key: "ai", label: "AI", tone: cooldownCount > 3 ? "red" as const : cooldownCount > 0 ? "yellow" as const : "green" as const, count: cooldownCount },
    { key: "build", label: "Build", tone: stalledCount > 5 ? "red" as const : stalledCount > 0 ? "yellow" as const : "green" as const, count: stalledCount },
  ];

  const alerts = (stalledQ.data ?? []).slice(0, 10).map((row: Record<string, unknown>, i: number) => ({
    id: `stalled-${i}`,
    severity: "high" as const,
    domain: "ops" as const,
    title: `Stalled: ${row.package_id ?? "unknown"}`,
    detail: `Step stuck: ${row.step_key ?? "–"}`,
  }));

  return {
    health,
    alerts,
    kpis: {
      pending_jobs: pendingQ.count ?? 0,
      processing_jobs: processingQ.count ?? 0,
      completed_24h: completed24hQ.count ?? 0,
      failed_24h: failed24hQ.count ?? 0,
      stalled_packages: stalledCount,
      provider_cooldowns: cooldownCount,
      blocked_publishables: 0,
      open_claim_issues: 0,
    },
    pipeline,
  };
}

async function getOpsQueue(sb: SB) {
  const { data } = await sb
    .from("job_queue")
    .select("id, job_type, status, attempts, max_attempts, package_id, last_error, created_at")
    .in("status", ["pending", "processing", "failed"])
    .order("created_at", { ascending: false })
    .limit(100);

  return (data ?? []).map((row: Record<string, unknown>) => ({
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
  const { data: cooldowns } = await sb
    .from("llm_provider_cooldowns")
    .select("*")
    .limit(50);

  return (cooldowns ?? []).map((row: Record<string, unknown>) => ({
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
  const { data } = await sb
    .from("ops_package_steps_stuck")
    .select("*")
    .limit(50);

  return (data ?? []).map((row: Record<string, unknown>, i: number) => {
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

  const [ordersTodayQ, orders7dQ, orders30dQ, claimIssuesQ, seatsQ, checkoutFailQ] =
    await Promise.all([
      sb.from("orders").select("id,total_amount,amount,created_at").gte("created_at", dayStart.toISOString()),
      sb.from("orders").select("id,total_amount,amount,created_at").gte("created_at", d7),
      sb.from("orders").select("id,total_amount,amount,created_at").gte("created_at", d30),
      sb.from("license_claims").select("id,status").in("status", ["failed", "conflict", "pending_manual_review"]),
      sb.from("corporate_license_seats").select("id,learner_user_id"),
      sb.from("checkout_events").select("id,status,created_at").eq("status", "failed").gte("created_at", d24),
    ]);

  const sumAmounts = (rows: Record<string, unknown>[]) =>
    rows.reduce((sum, row) => {
      const value =
        typeof row.total_amount === "number" ? row.total_amount
        : typeof row.amount === "number" ? row.amount
        : 0;
      return sum + value;
    }, 0);

  const ordersToday = (ordersTodayQ.data ?? []) as Record<string, unknown>[];
  const orders7d = (orders7dQ.data ?? []) as Record<string, unknown>[];
  const orders30d = (orders30dQ.data ?? []) as Record<string, unknown>[];
  const claimIssues = (claimIssuesQ.data ?? []) as Record<string, unknown>[];
  const seats = (seatsQ.data ?? []) as Record<string, unknown>[];
  const checkoutFails = (checkoutFailQ.data ?? []) as Record<string, unknown>[];

  return {
    orders_today: ordersToday.length,
    revenue_today: sumAmounts(ordersToday),
    revenue_7d: sumAmounts(orders7d),
    revenue_30d: sumAmounts(orders30d),
    open_claim_issues: claimIssues.length,
    corporate_seats_total: seats.length,
    corporate_seats_claimed: seats.filter((row) => !!row.learner_user_id).length,
    checkout_failures_24h: checkoutFails.length,
  };
}
