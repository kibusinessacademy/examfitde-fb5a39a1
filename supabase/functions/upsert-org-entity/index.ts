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

    const organization_id = isUuid(body.organization_id) ? body.organization_id : null;
    const id = isUuid(body.id) ? body.id : null;

    const entity_code = clampStr(body.entity_code, 30);
    const legal_name = clampStr(body.legal_name, 180);
    const display_name = clampStr(body.display_name, 120);

    const vat_id = typeof body.vat_id === "string" ? body.vat_id.slice(0, 40) : null;
    const billing_email = typeof body.billing_email === "string" ? body.billing_email.slice(0, 180) : null;
    const is_default = typeof body.is_default === "boolean" ? body.is_default : false;

    if (!organization_id) return json(400, { error: "Missing/invalid organization_id" }, origin);
    if (!entity_code || !legal_name || !display_name) return json(400, { error: "Invalid entity_code/legal_name/display_name" }, origin);

    // Role gate: OWNER or MANAGER (SSOT: org_memberships)
    const { data: mem } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", organization_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!mem) return json(403, { error: "not_org_member" }, origin);
    if (!["OWNER", "MANAGER"].includes(mem.role)) return json(403, { error: "role_denied" }, origin);

    // If setting default -> unset others first
    if (is_default) {
      await supabase
        .from("organization_entities")
        .update({ is_default: false })
        .eq("organization_id", organization_id)
        .eq("is_default", true);
    }

    const payload: Record<string, unknown> = {
      organization_id,
      entity_code,
      legal_name,
      display_name,
      vat_id,
      billing_email,
      is_default,
    };

    const { data: saved, error } = await supabase
      .from("organization_entities")
      .upsert(
        id ? { ...payload, id } : payload,
        { onConflict: "organization_id,entity_code" }
      )
      .select("id, organization_id, entity_code, legal_name, display_name, vat_id, billing_email, is_default, created_at, updated_at")
      .maybeSingle();

    if (error) return json(500, { error: "upsert_failed", details: error.message }, origin);

    return json(200, { ok: true, entity: saved }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
