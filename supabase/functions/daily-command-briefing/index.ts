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

async function safeFrom(sb: SB, table: string, select = "*", opts?: {
  filters?: Record<string, unknown>; order?: string; ascending?: boolean; limit?: number;
  gte?: Record<string, string>; lt?: Record<string, string>;
}): Promise<any[]> {
  try {
    let q = sb.from(table).select(select);
    if (opts?.filters) for (const [k, v] of Object.entries(opts.filters)) q = q.eq(k, v);
    if (opts?.gte) for (const [k, v] of Object.entries(opts.gte)) q = q.gte(k, v);
    if (opts?.lt) for (const [k, v] of Object.entries(opts.lt)) q = q.lt(k, v);
    if (opts?.order) q = q.order(opts.order, { ascending: opts.ascending ?? false });
    if (opts?.limit) q = q.limit(opts.limit);
    const { data } = await q;
    return data ?? [];
  } catch { return []; }
}

/* ── Generate daily briefing ── */
async function generateBriefing(sb: SB) {
  const today = new Date().toISOString().slice(0, 10);
  const oneDayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();

  // 1. Critical items: failed jobs, stuck steps, high churn
  const [failedJobs, stuckSteps, highChurn, blockedPkgs] = await Promise.all([
    safeCount(sb, "job_queue", { status: "failed" }),
    safeFrom(sb, "ops_package_steps_stuck", "package_id, step_key, minutes_stuck", { limit: 20 }),
    safeFrom(sb, "churn_predictions", "user_id, risk_score, risk_level", {
      order: "risk_score", ascending: false, limit: 10,
    }),
    safeFrom(sb, "course_packages", "id, title, blocked_reason", {
      filters: { status: "quality_gate_failed" }, limit: 10,
    }),
  ]);

  const criticalItems = [];
  if (failedJobs > 0) criticalItems.push({ type: "failed_jobs", count: failedJobs, severity: "critical", label: `${failedJobs} fehlgeschlagene Jobs` });
  if (stuckSteps.length > 0) criticalItems.push({ type: "stuck_steps", count: stuckSteps.length, severity: "high", label: `${stuckSteps.length} blockierte Pipeline-Steps` });
  const highChurnCount = highChurn.filter((c: any) => c.risk_score > 70).length;
  if (highChurnCount > 0) criticalItems.push({ type: "churn_risk", count: highChurnCount, severity: "high", label: `${highChurnCount} Nutzer mit hohem Churn-Risiko` });
  if (blockedPkgs.length > 0) criticalItems.push({ type: "blocked_packages", count: blockedPkgs.length, severity: "high", label: `${blockedPkgs.length} blockierte Pakete` });

  // 2. Healed items (last 24h)
  const healLogs = await safeFrom(sb, "auto_heal_log", "action_type, result_status, result_detail, was_dry_run, created_at", {
    gte: { created_at: oneDayAgo },
    order: "created_at",
    limit: 50,
  });
  const healed = healLogs.filter((l: any) => l.result_status === "success" && !l.was_dry_run);
  const dryRuns = healLogs.filter((l: any) => l.was_dry_run);

  const healedItems = healed.map((h: any) => ({
    action: h.action_type,
    detail: h.result_detail,
    at: h.created_at,
  }));

  // 3. Blocked items (packages done but not published)
  const readyToPublish = await safeFrom(sb, "course_packages", "id, title, track", {
    filters: { status: "done" }, limit: 10,
  });

  // 4. Revenue signals
  const [revenueTodayRows, seoGapPages] = await Promise.all([
    safeFrom(sb, "orders", "total_cents", { gte: { created_at: today }, limit: 1000 }),
    safeCount(sb, "content_pages", { status: "published" }),
  ]);
  const revenueToday = revenueTodayRows.reduce((s: number, r: any) => s + (r.total_cents || 0), 0) / 100;

  // 5. Top lever
  let topLever = null;
  if (readyToPublish.length > 0) {
    topLever = { type: "publish_ready", label: `${readyToPublish.length} Pakete sofort publishen → SEO & Umsatz`, items: readyToPublish.slice(0, 3) };
  } else if (failedJobs > 10) {
    topLever = { type: "fix_pipeline", label: "Pipeline stabilisieren: Transient-Fehler-Welle beheben" };
  } else if (highChurnCount > 5) {
    topLever = { type: "churn_intervention", label: `${highChurnCount} Nutzer mit Nudges aktivieren` };
  }

  // 6. Recommended actions
  const actions = [];
  if (failedJobs > 0) actions.push({ action: "requeue_failed", label: "Fehlgeschlagene Jobs requeuen", priority: "high" });
  if (readyToPublish.length > 0) actions.push({ action: "publish_packages", label: `${readyToPublish.length} fertige Pakete veröffentlichen`, priority: "high" });
  if (highChurnCount > 0) actions.push({ action: "nudge_churn", label: "Churn-Nudges freigeben", priority: "medium" });
  if (dryRuns.length > 0) actions.push({ action: "review_dry_runs", label: `${dryRuns.length} Dry-Run-Ergebnisse prüfen`, priority: "low" });
  if (blockedPkgs.length > 0) actions.push({ action: "fix_quality_gates", label: "Quality-Gate-Fails analysieren", priority: "medium" });

  const briefing = {
    briefing_date: today,
    critical_items: criticalItems,
    healed_items: healedItems,
    blocked_items: readyToPublish.map((p: any) => ({ id: p.id, title: p.title, track: p.track, type: "publish_blocked" })),
    top_lever: topLever,
    recommended_actions: actions.slice(0, 5),
    revenue_at_risk: readyToPublish.length * 500, // estimated €500/package opportunity cost
  };

  // Upsert for today
  await sb.from("daily_command_briefing").upsert(briefing as any, { onConflict: "briefing_date" });

  return { ...briefing, revenue_today: revenueToday, healed_count_24h: healed.length, dry_run_count_24h: dryRuns.length };
}

/* ── Main handler ── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userSb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    await assertAdmin(sb, user.id);

    const { action } = await req.json().catch(() => ({ action: "generate" }));

    switch (action) {
      case "generate":
        return json(await generateBriefing(sb));
      case "history": {
        const rows = await safeFrom(sb, "daily_command_briefing", "*", { order: "briefing_date", limit: 7 });
        return json(rows);
      }
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    if (err.message === "FORBIDDEN") return json({ error: "Forbidden" }, 403);
    console.error("daily-command-briefing error:", err);
    return json({ error: err.message }, 500);
  }
});
