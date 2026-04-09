// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { isUuid, clampStr, clampScope, ReportScope } from "../_shared/org_privacy.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, origin);

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

    const body = await req.json().catch(() => ({}));
    const orgId = isUuid(body.organization_id) ? body.organization_id : null;
    if (!orgId) return json(400, { error: "Missing/invalid organization_id" }, origin);

    // Only OWNER/MANAGER can request identified access (SSOT: org_memberships)
    const { data: mem } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    const role = mem?.role ?? null;
    if (!role || !["OWNER", "MANAGER"].includes(role)) {
      return json(403, { error: "Only OWNER/MANAGER can request identified access" }, origin);
    }

    const requestedScope = clampScope(body.scope, "IDENTIFIED") as ReportScope;
    if (requestedScope !== "IDENTIFIED") {
      return json(400, { error: "Only scope=IDENTIFIED requires admin approval" }, origin);
    }

    const reason = clampStr(body.reason, 600);

    // Upsert request
    const { data, error } = await supabase
      .from("org_privacy_access")
      .upsert({
        organization_id: orgId,
        status: "REQUESTED",
        scope: "IDENTIFIED",
        requested_by: userId,
        requested_at: new Date().toISOString(),
        admin_notes: reason ? `Request reason: ${reason}` : null,
      }, { onConflict: "organization_id" })
      .select("organization_id, status, scope, requested_at")
      .maybeSingle();

    if (error) return json(500, { error: "request_failed", details: error.message }, origin);

    return json(200, { ok: true, request: data }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
