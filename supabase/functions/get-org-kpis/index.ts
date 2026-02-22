import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

function json(status: number, data: unknown, origin: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, origin);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" }, origin);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" }, origin);

    const url = new URL(req.url);
    const orgId = url.searchParams.get("organization_id");
    if (!orgId) return json(400, { error: "Missing organization_id" }, origin);

    // Verify membership
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!membership) return json(403, { error: "Not a member of this organization" }, origin);

    // Check privacy gate
    const { data: privacy } = await supabase
      .from("org_privacy_access")
      .select("status, scope, approved_until")
      .eq("organization_id", orgId)
      .maybeSingle();

    const now = new Date().toISOString();
    const accessApproved = privacy?.status === "APPROVED" && (!privacy.approved_until || privacy.approved_until > now);
    const scope = accessApproved ? (privacy?.scope ?? "ANONYMIZED") : "ANONYMIZED";

    // Seat KPIs
    const { data: seats } = await supabase
      .from("organization_seats")
      .select("seat_status, entity_id, learner_user_id")
      .eq("organization_id", orgId);

    const totalSeats = seats?.length ?? 0;
    const activeSeats = seats?.filter((s: any) => s.seat_status === "ACTIVE").length ?? 0;
    const invitedSeats = seats?.filter((s: any) => s.seat_status === "INVITED").length ?? 0;
    const suspendedSeats = seats?.filter((s: any) => s.seat_status === "SUSPENDED").length ?? 0;
    const expiredSeats = seats?.filter((s: any) => s.seat_status === "EXPIRED").length ?? 0;

    // Entity breakdown
    const entityBreakdown: Record<string, { total: number; active: number }> = {};
    for (const s of (seats ?? [])) {
      const eid = s.entity_id ?? "__none__";
      if (!entityBreakdown[eid]) entityBreakdown[eid] = { total: 0, active: 0 };
      entityBreakdown[eid].total++;
      if (s.seat_status === "ACTIVE") entityBreakdown[eid].active++;
    }

    // Learner count
    const { count: learnerCount } = await supabase
      .from("organization_learners")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("left_at", null);

    // Invoice coding count
    const { count: codingCount } = await supabase
      .from("org_invoice_coding")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);

    // Audit: log this KPI run
    await supabase.from("org_report_runs").insert({
      organization_id: orgId,
      run_by: userId,
      report_key: "kpi_dashboard",
      scope,
      params: { entity_breakdown: Object.keys(entityBreakdown).length },
    });

    return json(200, {
      organization_id: orgId,
      scope,
      privacy_access: privacy ?? { status: "NONE", scope: "ANONYMIZED" },
      kpis: {
        total_seats: totalSeats,
        active_seats: activeSeats,
        invited_seats: invitedSeats,
        suspended_seats: suspendedSeats,
        expired_seats: expiredSeats,
        utilization_pct: totalSeats > 0 ? Math.round((activeSeats / totalSeats) * 100) : 0,
        learner_count: learnerCount ?? 0,
        invoice_coding_count: codingCount ?? 0,
        entity_breakdown: entityBreakdown,
      },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
