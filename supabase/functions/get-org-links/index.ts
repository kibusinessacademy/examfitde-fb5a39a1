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

    // Guard: any active membership
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) return json(403, { error: "No access" }, origin);

    // Links
    const { data: links } = await supabase
      .from("org_links")
      .select("id, org_a_id, org_b_id, link_type, status, metadata, created_at")
      .or(`org_a_id.eq.${orgId},org_b_id.eq.${orgId}`)
      .order("created_at", { ascending: false });

    const allLinks = links ?? [];
    const partnerIds = [...new Set(allLinks.map((l: any) => l.org_a_id === orgId ? l.org_b_id : l.org_a_id))];

    let orgMap: Record<string, any> = {};
    if (partnerIds.length > 0) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name, org_type")
        .in("id", partnerIds);
      orgMap = Object.fromEntries((orgs ?? []).map((o: any) => [o.id, o]));
    }

    const enrichedLinks = allLinks.map((l: any) => {
      const partnerId = l.org_a_id === orgId ? l.org_b_id : l.org_a_id;
      return {
        link_id: l.id,
        link_type: l.link_type,
        status: l.status,
        direction: l.org_a_id === orgId ? "outbound" : "inbound",
        partner_org_id: partnerId,
        partner_org_name: orgMap[partnerId]?.name ?? null,
        partner_org_type: orgMap[partnerId]?.org_type ?? null,
        metadata: l.metadata,
        created_at: l.created_at,
      };
    });

    return json(200, { links: enrichedLinks }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
