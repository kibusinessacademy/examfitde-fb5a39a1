import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SB = ReturnType<typeof createClient>;

async function assertAdmin(sb: SB, userId: string) {
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("FORBIDDEN");
}

async function safeCount(sb: SB, table: string, filters?: Record<string, unknown>): Promise<number> {
  try {
    let q = sb.from(table).select("*", { count: "exact", head: true });
    if (filters) for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { count } = await q;
    return count ?? 0;
  } catch { return 0; }
}

async function safeQuery(sb: SB, table: string, select = "*", opts?: {
  filters?: Record<string, unknown>; order?: string; ascending?: boolean; limit?: number;
  gte?: Record<string, string>; neq?: Record<string, string>;
  inFilter?: { col: string; vals: string[] };
}): Promise<any[]> {
  try {
    let q = sb.from(table).select(select);
    if (opts?.filters) for (const [k, v] of Object.entries(opts.filters)) q = q.eq(k, v);
    if (opts?.gte) for (const [k, v] of Object.entries(opts.gte)) q = q.gte(k, v);
    if (opts?.neq) for (const [k, v] of Object.entries(opts.neq)) q = q.neq(k, v);
    if (opts?.inFilter) q = q.in(opts.inFilter.col, opts.inFilter.vals);
    if (opts?.order) q = q.order(opts.order, { ascending: opts.ascending ?? false });
    if (opts?.limit) q = q.limit(opts.limit);
    const { data } = await q;
    return data ?? [];
  } catch { return []; }
}

/* ── Generate the full C-Level daily report ── */
async function generateReport(sb: SB) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const h2ago = new Date(now.getTime() - 2 * 3600_000).toISOString();
  const h24ago = new Date(now.getTime() - 24 * 3600_000).toISOString();

  // ── 1. Pipeline counts ──
  const pkgRows = await safeQuery(sb, "course_packages", "id, status, title, track, priority, blocked_reason, current_step, build_progress, updated_at");
  const pkgByStatus: Record<string, number> = {};
  for (const p of pkgRows) pkgByStatus[p.status] = (pkgByStatus[p.status] || 0) + 1;
  const totalPkgs = pkgRows.length;
  const building = pkgByStatus["building"] || 0;
  const queued = pkgByStatus["queued"] || 0;
  const blocked = pkgByStatus["blocked"] || 0;
  const done = pkgByStatus["done"] || 0;
  const published = pkgByStatus["published"] || 0;
  const failed = pkgByStatus["failed"] || 0;
  const remaining = totalPkgs - published;

  // ── 2. Job stats ──
  const [activeJobs, pendingJobs, completedTotal, failedTotal, cancelledTotal] = await Promise.all([
    safeCount(sb, "job_queue", { status: "processing" }),
    safeCount(sb, "job_queue", { status: "pending" }),
    safeCount(sb, "job_queue", { status: "completed" }),
    safeCount(sb, "job_queue", { status: "failed" }),
    safeCount(sb, "job_queue", { status: "cancelled" }),
  ]);

  // WIP limit
  const settingsRows = await safeQuery(sb, "system_settings", "key, value", {
    inFilter: { col: "key", vals: ["pipeline_wip_limit", "global_wip_limit", "max_parallel_packages"] },
  });
  let maxSlots = 5;
  for (const s of settingsRows) {
    const v = parseInt(s.value);
    if (!isNaN(v) && v > 0) { maxSlots = v; break; }
  }

  // ── 3. Active builds detail ──
  const buildingPkgs = pkgRows
    .filter((p: any) => p.status === "building")
    .map((p: any) => ({ id: p.id, title: p.title, current_step: p.current_step, build_progress: p.build_progress }));

  // Steps for building packages
  const buildingDetails = [];
  for (const bp of buildingPkgs) {
    const steps = await safeQuery(sb, "package_steps", "step_key, status", { filters: { package_id: bp.id } });
    const totalSteps = steps.length;
    const completedSteps = steps.filter((s: any) => s.status === "completed").length;
    buildingDetails.push({
      ...bp,
      total_steps: totalSteps,
      completed_steps: completedSteps,
    });
  }

  // Building without active job (fake WIP)
  const processingJobPkgIds = (await safeQuery(sb, "job_queue", "package_id", { filters: { status: "processing" } }))
    .map((j: any) => j.package_id).filter(Boolean);
  const fakeWip = buildingPkgs.filter((p: any) => !processingJobPkgIds.includes(p.id));

  // ── 4. Throughput ──
  const completed2h = await safeCount(sb, "job_queue", { status: "completed" });
  // More precise: count completed in last 2h
  const recentCompleted = await safeQuery(sb, "job_queue", "id", {
    filters: { status: "completed" },
    gte: { updated_at: h2ago },
  });
  const completed2hCount = recentCompleted.length;
  const throughputPerHour = Math.round((completed2hCount / 2) * 10) / 10;

  // Hourly breakdown (last 4h)
  const h1ago = new Date(now.getTime() - 1 * 3600_000).toISOString();
  const h3ago = new Date(now.getTime() - 3 * 3600_000).toISOString();
  const h4ago = new Date(now.getTime() - 4 * 3600_000).toISOString();
  const [comp1h, comp2h, comp3h, comp4h] = await Promise.all([
    safeQuery(sb, "job_queue", "id", { filters: { status: "completed" }, gte: { updated_at: h1ago } }),
    safeQuery(sb, "job_queue", "id", { filters: { status: "completed" }, gte: { updated_at: h2ago } }),
    safeQuery(sb, "job_queue", "id", { filters: { status: "completed" }, gte: { updated_at: h3ago } }),
    safeQuery(sb, "job_queue", "id", { filters: { status: "completed" }, gte: { updated_at: h4ago } }),
  ]);
  const hourlyBreakdown = [
    { label: "letzte 1h", count: comp1h.length },
    { label: "letzte 2h", count: comp2h.length },
    { label: "letzte 3h", count: comp3h.length },
    { label: "letzte 4h", count: comp4h.length },
  ];

  // ── 5. Blocked packages detail ──
  const blockedPkgs = pkgRows
    .filter((p: any) => p.status === "blocked")
    .map((p: any) => ({
      id: p.id,
      title: p.title,
      blocked_reason: p.blocked_reason,
      current_step: p.current_step,
    }));

  // ── 6. Cost ──
  const costRows24h = await safeQuery(sb, "ai_usage_log", "cost_eur", { gte: { created_at: h24ago }, limit: 1000 });
  const cost24h = Math.round(costRows24h.reduce((s: number, r: any) => s + (r.cost_eur || 0), 0) * 100) / 100;
  const costAllRows = await safeQuery(sb, "ai_usage_log", "cost_eur", { limit: 1000 });
  // Rough total from ai_usage_log
  let costTotal = Math.round(costAllRows.reduce((s: number, r: any) => s + (r.cost_eur || 0), 0) * 100) / 100;
  // Also try llm_cost_events for more accurate total
  try {
    const { count } = await sb.from("llm_cost_events").select("*", { count: "exact", head: true });
    if (count && count > 0) {
      const costEventsSum = await safeQuery(sb, "llm_cost_events", "cost_eur", { limit: 1000 });
      const evTotal = costEventsSum.reduce((s: number, r: any) => s + (r.cost_eur || 0), 0);
      if (evTotal > costTotal) costTotal = Math.round(evTotal * 100) / 100;
    }
  } catch {}

  // ── 7. Queue breakdown by priority ──
  const queuedPkgs = pkgRows.filter((p: any) => p.status === "queued");
  const prioBreakdown: Record<number, number> = {};
  for (const p of queuedPkgs) {
    const prio = p.priority ?? 99;
    prioBreakdown[prio] = (prioBreakdown[prio] || 0) + 1;
  }

  // ── 8. End-to-End status ──
  const councilReviews = await safeCount(sb, "tech_council_findings");

  // ── 9. Heartbeat check for active jobs ──
  const activeJobDetails = await safeQuery(sb, "job_queue", "id, job_type, package_id, locked_at, last_heartbeat_at", {
    filters: { status: "processing" },
    limit: 10,
  });
  const runnerHealth = activeJobDetails.map((j: any) => {
    const hbAge = j.last_heartbeat_at ? Math.round((now.getTime() - new Date(j.last_heartbeat_at).getTime()) / 60000) : null;
    return {
      job_id: j.id,
      job_type: j.job_type,
      heartbeat_age_min: hbAge,
      healthy: hbAge !== null && hbAge < 10,
    };
  });

  // ── 10. ETA calculation ──
  const avgJobsPerPkg = 25; // planning baseline
  const remainingJobs = remaining * avgJobsPerPkg;
  const planningEtaDays = throughputPerHour > 0
    ? Math.round((remainingJobs / throughputPerHour / 24) * 10) / 10
    : null;

  // For building packages specifically
  const buildEtaDays = buildingDetails.length > 0
    ? (() => {
        const avgRemaining = buildingDetails.reduce((s, b) => s + (b.total_steps - b.completed_steps), 0) / buildingDetails.length;
        // rough: ~2-4h per step on average
        return Math.round((avgRemaining * 3 / 24) * 10) / 10;
      })()
    : null;

  // ── 11. Signals ──
  const runnerUtilPct = maxSlots > 0 ? Math.round((activeJobs / maxSlots) * 1000) / 10 : 0;
  const runnerSignal = runnerUtilPct >= 85 ? "green" : runnerUtilPct >= 60 ? "yellow" : "red";

  const fakeWipSignal = fakeWip.length === 0 ? "green" : fakeWip.length <= 2 ? "yellow" : "red";
  const blockerSignal = blocked === 0 ? "green" : blocked <= 3 ? "yellow" : "red";
  const e2eSignal = published > 0 ? "green" : (building > 0 || done > 0) ? "yellow" : "red";

  let overallSignal = "green";
  if (blocked > 3 || fakeWip.length > 2 || (published === 0 && done === 0 && building > 0)) overallSignal = "red";
  else if (blocked > 0 || fakeWip.length > 0 || published === 0 || runnerUtilPct < 60) overallSignal = "yellow";

  // ── 12. Forecast scenarios ──
  const forecasts = {
    current_builds: {
      optimistic: buildEtaDays ? `${Math.max(1, Math.round(buildEtaDays * 0.6))}–${Math.round(buildEtaDays * 0.8)} Tage` : "—",
      realistic: buildEtaDays ? `${Math.round(buildEtaDays * 0.9)}–${Math.round(buildEtaDays * 1.3)} Tage` : "—",
      conservative: buildEtaDays ? `${Math.round(buildEtaDays * 1.3)}–${Math.round(buildEtaDays * 2)} Tage` : "—",
    },
    total_production: {
      optimistic: { days: "12–16", cost: "€300–450" },
      realistic: { days: "18–25", cost: "€450–650" },
      conservative: { days: "28–42", cost: "€600–900" },
    },
  };

  // ── 13. Priorities ──
  const priorities = [
    ...(blockedPkgs.length > 0 ? [{ priority: "P1", label: "Analyse und Entstörung blockierter Exam-Pool-Pakete", count: blockedPkgs.length }] : []),
    ...(published === 0 ? [{ priority: "P2", label: "Ersten vollständigen End-to-End-Publish erreichen", count: null }] : []),
    { priority: "P3", label: "Pipeline-Stabilität nach erstem Publish validieren", count: null },
  ];

  // ── Build report ──
  const report = {
    report_date: today,
    generated_at: now.toISOString(),
    overall_signal: overallSignal,

    production_status: {
      runner_slots_active: activeJobs,
      runner_slots_max: maxSlots,
      runner_utilization_pct: runnerUtilPct,
      runner_signal: runnerSignal,
      pending_jobs: pendingJobs,
      completed_jobs_total: completedTotal,
      failed_jobs_total: failedTotal,
      cancelled_jobs_total: cancelledTotal,
      runner_health: runnerHealth,
    },

    active_builds: buildingDetails,
    fake_wip: fakeWip,
    fake_wip_signal: fakeWipSignal,

    throughput: {
      per_hour: throughputPerHour,
      hourly_breakdown: hourlyBreakdown,
    },

    blocked_packages: blockedPkgs,
    blocker_signal: blockerSignal,

    cost: {
      last_24h: cost24h,
      total: costTotal,
    },

    pipeline: {
      total: totalPkgs,
      building,
      queued,
      blocked,
      done,
      published,
      failed,
      remaining,
      queue_by_priority: prioBreakdown,
    },

    e2e_status: {
      done_packages: done,
      published_packages: published,
      council_reviews: councilReviews,
      signal: e2eSignal,
    },

    forecasts,

    priorities,

    executive_summary: buildExecutiveSummary({
      overallSignal, activeJobs, maxSlots, throughputPerHour,
      building, blocked, done, published, remaining,
      blockedPkgs, fakeWip, cost24h, costTotal, planningEtaDays,
    }),
  };

  // Upsert
  await sb.from("daily_ops_reports").upsert(
    { report_date: today, report_json: report, trigger_source: "cron", generated_at: now.toISOString() },
    { onConflict: "report_date" },
  );

  return report;
}

function buildExecutiveSummary(d: any): string {
  const parts: string[] = [];

  parts.push(
    `Die Produktionspipeline ist technisch ${d.overallSignal === "green" ? "stabil" : d.overallSignal === "yellow" ? "aktiv mit Einschränkungen" : "unter Beobachtung"}.`
  );

  parts.push(
    `${d.activeJobs}/${d.maxSlots} Runner-Slots sind belegt (${Math.round(d.activeJobs / Math.max(d.maxSlots, 1) * 100)}% Auslastung).`
  );

  if (d.throughputPerHour > 0) {
    parts.push(`Aktueller Durchsatz: ${d.throughputPerHour} Jobs/h.`);
  }

  if (d.blocked > 0) {
    const reasons = [...new Set(d.blockedPkgs.map((p: any) => p.blocked_reason))].join(", ");
    parts.push(`${d.blocked} Pakete blockiert (${reasons}).`);
  }

  if (d.fakeWip.length > 0) {
    parts.push(`${d.fakeWip.length} Pakete im Status 'building' ohne aktiven Job (Fake-WIP).`);
  }

  if (d.published === 0) {
    parts.push("Noch kein Paket vollständig veröffentlicht – End-to-End-Validierung steht aus.");
  } else {
    parts.push(`${d.published} Pakete veröffentlicht.`);
  }

  parts.push(
    `Kosten: €${d.cost24h} (24h) / €${d.costTotal} (gesamt). ` +
    `Restproduktion: ${d.remaining} Pakete.` +
    (d.planningEtaDays ? ` Planning ETA: ~${d.planningEtaDays} Tage.` : "")
  );

  return parts.join(" ");
}

/* ── Main handler ── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Auth: accept EDGE_INTERNAL_SHARED_SECRET (cron) OR validated admin JWT.
    // The legacy "no auth header == cron" + anon-key bypass was removed (the
    // anon key is the public publishable key, so anyone could trigger this).
    const authHeader = req.headers.get("Authorization");
    const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
    const jobRunnerKey = req.headers.get("x-job-runner-key") || "";
    const isCron = !!internalSecret && jobRunnerKey === internalSecret;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

    const action = (body.action as string) || "generate";

    // If not cron, verify admin
    if (!isCron) {
      if (!authHeader) return json({ error: "Unauthorized" }, 401);
      const userSb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userSb.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      await assertAdmin(sb, user.id);
    }

    switch (action) {
      case "generate":
        return json(await generateReport(sb));

      case "latest": {
        const { data } = await sb
          .from("daily_ops_reports")
          .select("*")
          .order("report_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!data) return json(await generateReport(sb));
        return json(data.report_json);
      }

      case "history": {
        const { data } = await sb
          .from("daily_ops_reports")
          .select("report_date, report_json, generated_at")
          .order("report_date", { ascending: false })
          .limit(14);
        return json(data ?? []);
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    if (err.message === "FORBIDDEN") return json({ error: "Forbidden" }, 403);
    console.error("daily-ops-report error:", err);
    return json({ error: err.message }, 500);
  }
});
