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

async function safeCount(sb: SB, table: string, filters?: Record<string, unknown>): Promise<number> {
  try {
    let q = sb.from(table).select("*", { count: "exact", head: true });
    if (filters) for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { count } = await q;
    return count ?? 0;
  } catch { return 0; }
}

async function computeRevenueOverview(sb: SB) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const d7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const d30 = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [ordersToday, orders7d, orders30d, refunds, affiliates, churnPreds, readyPkgs, blockedPkgs] = await Promise.all([
    safeFrom(sb, "orders", "id, total_cents, status, created_at", { gte: { created_at: today } }),
    safeFrom(sb, "orders", "id, total_cents, status, created_at", { gte: { created_at: d7 }, limit: 1000 }),
    safeFrom(sb, "orders", "id, total_cents, status, created_at", { gte: { created_at: d30 }, limit: 1000 }),
    safeFrom(sb, "orders", "id, total_cents", { filters: { status: "refunded" }, gte: { created_at: d30 }, limit: 500 }),
    safeFrom(sb, "affiliates", "id, status, pending_payout, total_earnings, affiliate_code", { filters: { status: "active" } }),
    safeFrom(sb, "churn_predictions", "user_id, risk_score, risk_level, recommended_action", { order: "risk_score", ascending: false, limit: 50 }),
    safeFrom(sb, "course_packages", "id, title, track", { filters: { status: "done" }, limit: 50 }),
    safeFrom(sb, "course_packages", "id, title, blocked_reason", { filters: { status: "quality_gate_failed" }, limit: 50 }),
  ]);

  const sum = (arr: any[]) => arr.reduce((s, o) => s + (o.total_cents || 0), 0) / 100;

  const revenueToday = sum(ordersToday);
  const revenue7d = sum(orders7d);
  const revenue30d = sum(orders30d);
  const refundTotal = sum(refunds);
  const avgOrderValue = orders30d.length > 0 ? revenue30d / orders30d.length : 0;

  const highChurn = churnPreds.filter((c: any) => c.risk_score > 70);
  const medChurn = churnPreds.filter((c: any) => c.risk_score > 40 && c.risk_score <= 70);
  const estimatedChurnRevenue = highChurn.length * avgOrderValue;

  // Publish opportunity cost
  const publishOpportunityCost = readyPkgs.length * 500; // €500 estimated per unpublished package

  // Revenue health score (0-100)
  let healthScore = 100;
  if (refunds.length > orders30d.length * 0.05) healthScore -= 20;
  if (highChurn.length > 10) healthScore -= 15;
  if (readyPkgs.length > 3) healthScore -= 10;
  if (blockedPkgs.length > 0) healthScore -= 10;
  if (revenue7d < revenue30d / 4 * 0.7) healthScore -= 15; // 7d revenue < 70% of avg week
  healthScore = Math.max(0, Math.min(100, healthScore));

  // Issues
  const issues: any[] = [];
  if (highChurn.length > 0) issues.push({
    severity: highChurn.length > 10 ? "critical" : "high",
    title: `${highChurn.length} Nutzer mit hohem Churn-Risiko`,
    detail: `Geschätzter Umsatzverlust: €${estimatedChurnRevenue.toFixed(0)}`,
    recommendation: "Nudge-Intervention für Hochrisiko-Nutzer starten",
  });
  if (refunds.length > 0) issues.push({
    severity: refunds.length > 5 ? "high" : "medium",
    title: `${refunds.length} Rückerstattungen (30d)`,
    detail: `€${refundTotal.toFixed(2)} Umsatzverlust durch Refunds`,
    recommendation: "Ursachen der Rückerstattungen analysieren",
  });
  if (readyPkgs.length > 0) issues.push({
    severity: "high",
    title: `${readyPkgs.length} Pakete fertig aber nicht live`,
    detail: `Entgangener Umsatz: ~€${publishOpportunityCost}`,
    recommendation: "Pakete zeitnah veröffentlichen",
  });
  if (blockedPkgs.length > 0) issues.push({
    severity: "high",
    title: `${blockedPkgs.length} Quality-Gate-Blocker`,
    detail: "Pakete können nicht veröffentlicht werden",
    recommendation: "Quality-Gate-Fails analysieren und Inhalte nachbessern",
  });

  return {
    health_score: healthScore,
    revenue: {
      today: revenueToday,
      week: revenue7d,
      month: revenue30d,
      avg_order: Math.round(avgOrderValue * 100) / 100,
      orders_today: ordersToday.length,
      orders_week: orders7d.length,
      orders_month: orders30d.length,
    },
    refunds: { count: refunds.length, total_eur: refundTotal },
    churn: {
      high_risk: highChurn.length,
      medium_risk: medChurn.length,
      estimated_revenue_at_risk: estimatedChurnRevenue,
      top_risks: highChurn.slice(0, 5).map((c: any) => ({
        user_id: c.user_id, score: c.risk_score, level: c.risk_level, action: c.recommended_action,
      })),
    },
    affiliates: {
      active: affiliates.length,
      pending_payouts: affiliates.reduce((s: number, a: any) => s + (a.pending_payout || 0), 0),
      total_earnings: affiliates.reduce((s: number, a: any) => s + (a.total_earnings || 0), 0),
    },
    publish_blockers: {
      ready: readyPkgs.length,
      blocked: blockedPkgs.length,
      opportunity_cost: publishOpportunityCost,
      ready_items: readyPkgs.slice(0, 5),
      blocked_items: blockedPkgs.slice(0, 5),
    },
    issues,
    generated_at: now.toISOString(),
  };
}

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

    return json(await computeRevenueOverview(sb));
  } catch (err: any) {
    if (err.message === "FORBIDDEN") return json({ error: "Forbidden" }, 403);
    console.error("admin-revenue-tower error:", err);
    return json({ error: err.message }, 500);
  }
});
