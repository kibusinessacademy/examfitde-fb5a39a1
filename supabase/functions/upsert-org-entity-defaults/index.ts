// Deno.serve is built-in
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { isUuid, clampStr } from "../_shared/org_privacy.ts";

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

    const entity_id = isUuid(body.entity_id) ? body.entity_id : null;
    if (!entity_id) return json(400, { error: "Missing/invalid entity_id" }, origin);

    // load entity -> org -> role gate (OWNER/BILLING)
    const { data: ent } = await supabase
      .from("organization_entities")
      .select("id, organization_id")
      .eq("id", entity_id)
      .maybeSingle();

    if (!ent) return json(404, { error: "entity_not_found" }, origin);

    // SSOT: org_memberships
    const { data: mem } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", ent.organization_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!mem) return json(403, { error: "not_org_member" }, origin);
    if (!["OWNER", "BILLING"].includes(mem.role)) return json(403, { error: "role_denied" }, origin);

    const payload: Record<string, unknown> = {
      entity_id,
      default_cost_center: clampStr(body.default_cost_center, 80),
      default_cost_object: clampStr(body.default_cost_object, 80),
      default_gl_account: clampStr(body.default_gl_account, 80),
      default_project_code: clampStr(body.default_project_code, 80),
    };

    const { data: saved, error } = await supabase
      .from("org_entity_accounting_defaults")
      .upsert(payload, { onConflict: "entity_id" })
      .select("id, entity_id, default_cost_center, default_cost_object, default_gl_account, default_project_code, created_at, updated_at")
      .maybeSingle();

    if (error) return json(500, { error: "upsert_failed", details: error.message }, origin);

    return json(200, { ok: true, defaults: saved }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
