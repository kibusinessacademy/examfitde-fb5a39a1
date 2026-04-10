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

    // Get user's memberships WITH org details in one query
    const { data: memberships, error: mErr } = await supabase
      .from("org_memberships")
      .select("org_id, role, status, organizations:org_id(id, name, org_type, parent_org_id, fiscal_year_start_month, default_report_scope)")
      .eq("user_id", userId)
      .eq("status", "active");

    if (mErr) return json(500, { error: "memberships_failed", details: mErr.message }, origin);
    if (!memberships || memberships.length === 0) return json(200, { orgs: [], selected: null }, origin);

    // Build org list
    const orgList = memberships.map((m: any) => ({
      id: m.organizations?.id,
      name: m.organizations?.name,
      org_type: m.organizations?.org_type,
      parent_org_id: m.organizations?.parent_org_id,
      my_role: m.role,
    })).filter((o: any) => o.id);

    // Determine selected org
    const orgId = orgIdParam && memberships.some((m: any) => m.org_id === orgIdParam)
      ? orgIdParam
      : memberships[0].org_id;

    const myRole = memberships.find((m: any) => m.org_id === orgId)?.role ?? null;
    const org = memberships.find((m: any) => m.org_id === orgId)?.organizations ?? null;

    if (!org?.id) return json(200, { orgs: orgList, selected: null }, origin);

    const orgType = org.org_type ?? "COMPANY";

    // Lightweight parallel aggregations — counts only, no full lists
    const [
      membersCountRes, learnersCountRes, seatsCountRes, privacyRes,
      linksRes, classesCountRes, instructorsCountRes, curriculaCountRes,
    ] = await Promise.all([
      supabase
        .from("org_memberships")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "active"),
      supabase
        .from("organization_learners")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("left_at", null),
      supabase
        .from("organization_seats")
        .select("id, seat_status")
        .eq("organization_id", orgId),
      supabase
        .from("org_privacy_access")
        .select("status, scope, approved_until, requested_at")
        .eq("organization_id", orgId)
        .maybeSingle(),
      // Linked orgs (both directions) — summary only
      supabase
        .from("org_links")
        .select("id, org_a_id, org_b_id, link_type")
        .or(`org_a_id.eq.${orgId},org_b_id.eq.${orgId}`)
        .eq("status", "active"),
      // Class count
      supabase
        .from("school_classes")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "active"),
      // Instructor count
      supabase
        .from("instructor_assignments")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "active"),
      // Curricula count (distinct curriculum_ids from classes)
      supabase
        .from("school_classes")
        .select("curriculum_id")
        .eq("org_id", orgId),
    ]);

    // Seat summary — only counts per status
    const seats = seatsCountRes.data ?? [];
    const activeSeats = seats.filter((s: any) => s.seat_status === "active").length;
    const inactiveSeats = seats.filter((s: any) => s.seat_status !== "active").length;

    // Unique curricula count
    const uniqueCurricula = new Set((curriculaCountRes.data ?? []).map((c: any) => c.curriculum_id).filter(Boolean));

    // Resolve linked orgs for summary display
    const links = linksRes.data ?? [];
    let linkedOrgs: any[] = [];
    if (links.length > 0) {
      const linkedIds = [...new Set(links.map((l: any) => l.org_a_id === orgId ? l.org_b_id : l.org_a_id))];
      if (linkedIds.length > 0) {
        const { data: linkedOrgData } = await supabase
          .from("organizations")
          .select("id, name, org_type")
          .in("id", linkedIds);
        const orgMap = Object.fromEntries((linkedOrgData ?? []).map((o: any) => [o.id, o]));
        linkedOrgs = links.map((l: any) => {
          const partnerId = l.org_a_id === orgId ? l.org_b_id : l.org_a_id;
          const partner = orgMap[partnerId];
          return {
            link_id: l.id,
            link_type: l.link_type,
            direction: l.org_a_id === orgId ? "outbound" : "inbound",
            partner_org_id: partnerId,
            partner_org_name: partner?.name ?? null,
            partner_org_type: partner?.org_type ?? null,
          };
        });
      }
    }

    const capabilities = resolveCapabilities(orgType, myRole);

    return json(200, {
      orgs: orgList,
      selected: {
        org: { ...org, org_type: orgType },
        my_role: myRole,
        capabilities,
        summary: {
          active_members: membersCountRes.count ?? 0,
          active_learners: learnersCountRes.count ?? 0,
          active_seats: activeSeats,
          inactive_seats: inactiveSeats,
          classes_count: classesCountRes.count ?? 0,
          instructors_count: instructorsCountRes.count ?? 0,
          linked_orgs_count: links.length,
          curricula_count: uniqueCurricula.size,
        },
        privacy_access: privacyRes.data ?? { status: "NONE", scope: "ANONYMIZED", approved_until: null, requested_at: null },
        linked_orgs: linkedOrgs,
      },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});

/** Resolve available capabilities based on org type and role */
function resolveCapabilities(orgType: string, role: string | null): Record<string, boolean> {
  const base = {
    view_overview: true,
    view_members: true,
    view_audit: true,
  };

  const isAdmin = ["OWNER", "MANAGER", "IT_ADMIN"].includes(role ?? "");

  switch (orgType) {
    case "SCHOOL":
    case "UNIVERSITY":
      return {
        ...base,
        view_classes: true,
        manage_classes: isAdmin || role === "SCHOOL_ADMIN",
        view_instructors: true,
        manage_instructors: isAdmin || role === "SCHOOL_ADMIN",
        view_learner_progress: role === "INSTRUCTOR" || isAdmin || role === "SCHOOL_ADMIN",
        view_linked_orgs: true,
        manage_linked_orgs: isAdmin || role === "SCHOOL_ADMIN",
        view_seats: true,
        view_billing: isAdmin || role === "BILLING",
        view_integrations: isAdmin,
        view_compliance: false,
        view_governance: false,
        view_institution_analytics: false,
        view_curricula: false,
        manage_curricula: false,
        view_quality: false,
        view_learners: false,
        manage_seats: false,
        view_commissions: false,
        view_referrals: false,
        view_leads: false,
      };
    case "IHK":
    case "HWK":
      return {
        ...base,
        view_governance: true,
        view_curricula: true,
        manage_curricula: isAdmin || role === "IHK_ADMIN" || role === "HWK_ADMIN",
        view_institution_analytics: true,
        view_linked_orgs: true,
        manage_linked_orgs: isAdmin,
        view_quality: true,
        view_classes: false,
        manage_classes: false,
        view_instructors: false,
        manage_instructors: false,
        view_learner_progress: false,
        view_seats: false,
        manage_seats: false,
        view_billing: false,
        view_integrations: false,
        view_compliance: false,
        view_learners: false,
        view_commissions: false,
        view_referrals: false,
        view_leads: false,
      };
    case "PARTNER_AGENCY":
    case "PARTNER_AFFILIATE":
      return {
        ...base,
        view_commissions: true,
        view_referrals: true,
        view_leads: true,
        view_classes: false,
        manage_classes: false,
        view_instructors: false,
        manage_instructors: false,
        view_learner_progress: false,
        view_linked_orgs: false,
        manage_linked_orgs: false,
        view_seats: false,
        manage_seats: false,
        view_billing: false,
        view_integrations: false,
        view_compliance: false,
        view_governance: false,
        view_institution_analytics: false,
        view_curricula: false,
        manage_curricula: false,
        view_quality: false,
        view_learners: false,
      };
    default: // COMPANY
      return {
        ...base,
        view_seats: true,
        manage_seats: isAdmin,
        view_learners: true,
        view_billing: isAdmin || role === "BILLING",
        view_integrations: isAdmin,
        view_linked_orgs: true,
        manage_linked_orgs: isAdmin,
        view_compliance: true,
        view_classes: false,
        manage_classes: false,
        view_instructors: false,
        manage_instructors: false,
        view_learner_progress: false,
        view_governance: false,
        view_institution_analytics: false,
        view_curricula: false,
        manage_curricula: false,
        view_quality: false,
        view_commissions: false,
        view_referrals: false,
        view_leads: false,
      };
  }
}
