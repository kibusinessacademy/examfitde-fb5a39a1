// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
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

    // Get user's memberships WITH org details in one query (no N+1)
    // SSOT: use org_memberships as the single source of truth
    const { data: memberships, error: mErr } = await supabase
      .from("org_memberships")
      .select("org_id, role, status, organizations:org_id(id, name, org_type, fiscal_year_start_month, default_report_scope)")
      .eq("user_id", userId)
      .eq("status", "active");

    if (mErr) return json(500, { error: "memberships_failed", details: mErr.message }, origin);
    if (!memberships || memberships.length === 0) return json(200, { orgs: [], selected: null }, origin);

    // Build org list from joined data (no N+1 loop)
    const orgList = memberships.map((m: any) => ({
      id: m.organizations?.id,
      name: m.organizations?.name,
      org_type: m.organizations?.org_type,
      my_role: m.role,
    })).filter((o: any) => o.id);

    // Determine selected org
    const orgId = orgIdParam && memberships.some((m: any) => m.organization_id === orgIdParam)
      ? orgIdParam
      : memberships[0].organization_id;

    const myRole = memberships.find((m: any) => m.organization_id === orgId)?.role ?? null;
    const org = memberships.find((m: any) => m.organization_id === orgId)?.organizations ?? null;

    // Parallel loads for selected org
    const [entitiesRes, membersRes, learnersRes, seatsRes, privacyRes] = await Promise.all([
      supabase
        .from("organization_entities")
        .select("id, entity_code, legal_name, display_name, vat_id, billing_email, is_default")
        .eq("organization_id", orgId)
        .order("entity_code"),
      supabase
        .from("organization_members")
        .select("id, user_id, role, created_at")
        .eq("organization_id", orgId),
      supabase
        .from("organization_learners")
        .select("id, learner_user_id, entity_id, joined_at, left_at")
        .eq("organization_id", orgId)
        .is("left_at", null)
        .order("joined_at", { ascending: false })
        .limit(200),
      supabase
        .from("organization_seats")
        .select("id, entity_id, learner_user_id, product_id, certification_id, seat_status, start_at, end_at, auto_renew, notes")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("org_privacy_access")
        .select("status, scope, approved_until, requested_at")
        .eq("organization_id", orgId)
        .maybeSingle(),
    ]);

    // Guard: if selected org not found in join
    if (!org?.id) return json(200, { orgs: orgList, selected: null }, origin);

    const seats = seatsRes.data ?? [];

    // Seat summary KPIs
    const seatCounts: Record<string, number> = {};
    for (const s of seats) {
      seatCounts[s.seat_status] = (seatCounts[s.seat_status] || 0) + 1;
    }

    return json(200, {
      orgs: orgList,
      selected: {
        org,
        my_role: myRole,
        entities: entitiesRes.data ?? [],
        members: membersRes.data ?? [],
        learners: learnersRes.data ?? [],
        seats,
        seat_summary: seatCounts,
        privacy_access: privacyRes.data ?? { status: "NONE", scope: "ANONYMIZED" },
      },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
