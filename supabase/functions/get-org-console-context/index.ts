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
    const { data: memberships, error: mErr } = await supabase
      .from("org_memberships")
      .select("org_id, role, status, organizations:org_id(id, name, org_type, parent_org_id, fiscal_year_start_month, default_report_scope)")
      .eq("user_id", userId)
      .eq("status", "active");

    if (mErr) return json(500, { error: "memberships_failed", details: mErr.message }, origin);
    if (!memberships || memberships.length === 0) return json(200, { orgs: [], selected: null }, origin);

    // Build org list with org_type
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

    // Parallel loads for selected org — base data + new institutional data
    const [
      entitiesRes, membersRes, learnersRes, seatsRes, privacyRes,
      linksRes, classesRes, instructorsRes,
    ] = await Promise.all([
      supabase
        .from("organization_entities")
        .select("id, entity_code, legal_name, display_name, vat_id, billing_email, is_default")
        .eq("organization_id", orgId)
        .order("entity_code"),
      supabase
        .from("org_memberships")
        .select("id, user_id, role, status, created_at")
        .eq("org_id", orgId)
        .eq("status", "active"),
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
      // Linked orgs (both directions)
      supabase
        .from("org_links")
        .select("id, org_a_id, org_b_id, link_type, status, metadata, created_at")
        .or(`org_a_id.eq.${orgId},org_b_id.eq.${orgId}`)
        .eq("status", "active"),
      // School classes (if applicable)
      supabase
        .from("school_classes")
        .select("id, name, curriculum_id, academic_year, grade_year, status, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100),
      // Instructor assignments
      supabase
        .from("instructor_assignments")
        .select("id, user_id, curriculum_id, class_id, can_view_progress, can_grade, assignment_type, status")
        .eq("org_id", orgId)
        .eq("status", "active"),
    ]);

    if (!org?.id) return json(200, { orgs: orgList, selected: null }, origin);

    const seats = seatsRes.data ?? [];
    const seatCounts: Record<string, number> = {};
    for (const s of seats) {
      seatCounts[s.seat_status] = (seatCounts[s.seat_status] || 0) + 1;
    }

    // Resolve linked org names for display
    const links = linksRes.data ?? [];
    let linkedOrgs: any[] = [];
    if (links.length > 0) {
      const linkedIds = links.map((l: any) => l.org_a_id === orgId ? l.org_b_id : l.org_a_id);
      const uniqueIds = [...new Set(linkedIds)];
      if (uniqueIds.length > 0) {
        const { data: linkedOrgData } = await supabase
          .from("organizations")
          .select("id, name, org_type")
          .in("id", uniqueIds);
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
            metadata: l.metadata,
          };
        });
      }
    }

    // Determine org capabilities based on org_type
    const orgType = org.org_type ?? "COMPANY";
    const capabilities = resolveCapabilities(orgType, myRole);

    return json(200, {
      orgs: orgList,
      selected: {
        org: { ...org, org_type: orgType },
        my_role: myRole,
        capabilities,
        entities: entitiesRes.data ?? [],
        members: membersRes.data ?? [],
        learners: learnersRes.data ?? [],
        seats,
        seat_summary: seatCounts,
        privacy_access: privacyRes.data ?? { status: "NONE", scope: "ANONYMIZED" },
        linked_orgs: linkedOrgs,
        classes: classesRes.data ?? [],
        instructors: instructorsRes.data ?? [],
      },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});

/** Resolve available capabilities / tabs based on org type and role */
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
      };
    case "PARTNER_AGENCY":
    case "PARTNER_AFFILIATE":
      return {
        ...base,
        view_commissions: true,
        view_referrals: true,
        view_leads: true,
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
      };
  }
}
