// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

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
    const jwtToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwtToken) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwtToken);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" }, origin);

    // Admin gate
    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (roleErr) return json(500, { error: "role_check_failed", details: roleErr.message }, origin);
    if (!isAdmin) return json(403, { error: "admin_only" }, origin);

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") ?? "REQUESTED").toUpperCase();

    const { data, error } = await supabase
      .from("org_privacy_access")
      .select("organization_id, status, scope, requested_by, requested_at, admin_notes, approved_until")
      .eq("status", status)
      .order("requested_at", { ascending: false })
      .limit(200);

    if (error) return json(500, { error: "query_failed", details: error.message }, origin);

    // Fetch org names separately to avoid join issues
    const orgIds = (data ?? []).map((r: any) => r.organization_id).filter(Boolean);
    let orgMap: Record<string, any> = {};
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name, org_type")
        .in("id", orgIds);
      for (const o of (orgs ?? [])) orgMap[o.id] = o;
    }

    return json(200, {
      status,
      requests: (data ?? []).map((r: any) => ({
        organization_id: r.organization_id,
        org_name: orgMap[r.organization_id]?.name ?? null,
        org_type: orgMap[r.organization_id]?.org_type ?? null,
        status: r.status,
        scope: r.scope,
        requested_by: r.requested_by,
        requested_at: r.requested_at,
        approved_until: r.approved_until,
        admin_notes: r.admin_notes,
      })),
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
