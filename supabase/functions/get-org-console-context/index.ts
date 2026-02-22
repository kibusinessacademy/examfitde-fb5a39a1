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
    const orgIdParam = url.searchParams.get("organization_id");

    // Get user's memberships
    const { data: memberships, error: mErr } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userId);

    if (mErr) return json(500, { error: "memberships_failed", details: mErr.message }, origin);
    if (!memberships || memberships.length === 0) return json(200, { orgs: [], selected: null }, origin);

    // Determine selected org
    const orgId = orgIdParam && memberships.some((m: any) => m.organization_id === orgIdParam)
      ? orgIdParam
      : memberships[0].organization_id;

    const myRole = memberships.find((m: any) => m.organization_id === orgId)?.role ?? null;

    // Load org details
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, org_type, fiscal_year_start_month, default_report_scope")
      .eq("id", orgId)
      .maybeSingle();

    // Load entities
    const { data: entities } = await supabase
      .from("organization_entities")
      .select("id, entity_code, legal_name, display_name, vat_id, billing_email, is_default")
      .eq("organization_id", orgId)
      .order("entity_code");

    // Load members
    const { data: members } = await supabase
      .from("organization_members")
      .select("id, user_id, role, created_at")
      .eq("organization_id", orgId);

    // Load learners with entity info
    const { data: learners } = await supabase
      .from("organization_learners")
      .select("id, learner_user_id, entity_id, joined_at, left_at")
      .eq("organization_id", orgId)
      .is("left_at", null)
      .order("joined_at", { ascending: false })
      .limit(200);

    // Load seats
    const { data: seats } = await supabase
      .from("organization_seats")
      .select("id, entity_id, learner_user_id, product_id, certification_id, seat_status, start_at, end_at, auto_renew, notes")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500);

    // Load privacy access
    const { data: privacyAccess } = await supabase
      .from("org_privacy_access")
      .select("status, scope, approved_until, requested_at")
      .eq("organization_id", orgId)
      .maybeSingle();

    // Seat summary KPIs
    const seatCounts: Record<string, number> = {};
    for (const s of (seats ?? [])) {
      seatCounts[s.seat_status] = (seatCounts[s.seat_status] || 0) + 1;
    }

    // All orgs for switcher
    const orgList = [];
    for (const m of memberships) {
      const { data: o } = await supabase
        .from("organizations")
        .select("id, name, org_type")
        .eq("id", m.organization_id)
        .maybeSingle();
      if (o) orgList.push({ ...o, my_role: m.role });
    }

    return json(200, {
      orgs: orgList,
      selected: {
        org,
        my_role: myRole,
        entities: entities ?? [],
        members: members ?? [],
        learners: learners ?? [],
        seats: seats ?? [],
        seat_summary: seatCounts,
        privacy_access: privacyAccess ?? { status: "NONE", scope: "ANONYMIZED" },
      },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
