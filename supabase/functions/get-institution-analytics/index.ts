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
    const orgId = url.searchParams.get("organization_id");
    if (!orgId) return json(400, { error: "organization_id required" }, origin);

    // Guard: qualifying role
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) return json(403, { error: "No access" }, origin);

    const allowedRoles = ["OWNER", "MANAGER", "IHK_ADMIN", "HWK_ADMIN"];
    if (!allowedRoles.includes(membership.role)) {
      return json(403, { error: "Insufficient role for institution analytics" }, origin);
    }

    // Org info
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, org_type")
      .eq("id", orgId)
      .single();

    if (!org) return json(404, { error: "Organization not found" }, origin);

    // Parallel loads
    const [linksRes, membersRes] = await Promise.all([
      // All linked orgs
      supabase
        .from("org_links")
        .select("id, org_a_id, org_b_id, link_type, status, metadata")
        .or(`org_a_id.eq.${orgId},org_b_id.eq.${orgId}`)
        .eq("status", "active"),
      // Members count
      supabase
        .from("org_memberships")
        .select("id, role")
        .eq("org_id", orgId)
        .eq("status", "active"),
    ]);

    const links = linksRes.data ?? [];

    // Resolve linked orgs
    const linkedIds = links.map((l: any) => l.org_a_id === orgId ? l.org_b_id : l.org_a_id);
    const uniqueLinkedIds = [...new Set(linkedIds)];
    let linkedOrgDetails: any[] = [];
    if (uniqueLinkedIds.length > 0) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name, org_type")
        .in("id", uniqueLinkedIds);
      linkedOrgDetails = orgs ?? [];
    }
    const orgMap = Object.fromEntries(linkedOrgDetails.map((o: any) => [o.id, o]));

    // Categorize linked orgs
    const linkedSchools = links
      .filter((l: any) => {
        const partnerId = l.org_a_id === orgId ? l.org_b_id : l.org_a_id;
        return orgMap[partnerId]?.org_type === "SCHOOL" || orgMap[partnerId]?.org_type === "UNIVERSITY";
      })
      .map((l: any) => {
        const partnerId = l.org_a_id === orgId ? l.org_b_id : l.org_a_id;
        return { link_id: l.id, link_type: l.link_type, ...orgMap[partnerId] };
      });

    const linkedCompanies = links
      .filter((l: any) => {
        const partnerId = l.org_a_id === orgId ? l.org_b_id : l.org_a_id;
        return orgMap[partnerId]?.org_type === "COMPANY";
      })
      .map((l: any) => {
        const partnerId = l.org_a_id === orgId ? l.org_b_id : l.org_a_id;
        return { link_id: l.id, link_type: l.link_type, ...orgMap[partnerId] };
      });

    // Count learners across linked schools (via classes)
    let totalLinkedLearners = 0;
    let totalLinkedClasses = 0;
    if (linkedSchools.length > 0) {
      const schoolIds = linkedSchools.map((s: any) => s.id);
      const { data: classes } = await supabase
        .from("school_classes")
        .select("id, org_id")
        .in("org_id", schoolIds)
        .eq("status", "active");
      totalLinkedClasses = (classes ?? []).length;

      if (classes && classes.length > 0) {
        const classIds = classes.map((c: any) => c.id);
        const { count } = await supabase
          .from("class_memberships")
          .select("id", { count: "exact", head: true })
          .in("class_id", classIds)
          .eq("role", "student")
          .eq("status", "active");
        totalLinkedLearners = count ?? 0;
      }
    }

    return json(200, {
      org,
      kpis: {
        linked_schools: linkedSchools.length,
        linked_companies: linkedCompanies.length,
        total_linked_learners: totalLinkedLearners,
        total_linked_classes: totalLinkedClasses,
        total_members: (membersRes.data ?? []).length,
      },
      linked_schools: linkedSchools,
      linked_companies: linkedCompanies,
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
