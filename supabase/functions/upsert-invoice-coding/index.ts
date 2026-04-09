// Deno.serve is built-in
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

function json(status: number, data: unknown, origin: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function clampStr(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t || null;
}

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
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwt);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" }, origin);

    const body = await req.json().catch(() => ({}));

    const organization_id = isUuid(body.organization_id) ? body.organization_id : null;
    const invoice_id = isUuid(body.invoice_id) ? body.invoice_id : null;
    if (!organization_id || !invoice_id) return json(400, { error: "Missing organization_id / invoice_id" }, origin);

    // Verify OWNER or BILLING role (SSOT: org_memberships)
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("org_id", organization_id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["OWNER", "BILLING"].includes(membership.role)) {
      return json(403, { error: "Requires OWNER or BILLING role" }, origin);
    }

    const entity_id = isUuid(body.entity_id) ? body.entity_id : null;
    const cost_center = clampStr(body.cost_center, 50);
    const cost_object = clampStr(body.cost_object, 50);
    const gl_account = clampStr(body.gl_account, 50);
    const project_code = clampStr(body.project_code, 50);
    const internal_ref = clampStr(body.internal_ref, 100);
    const notes = clampStr(body.notes, 500);

    const { data: result, error } = await supabase
      .from("org_invoice_coding")
      .upsert({
        organization_id,
        invoice_id,
        entity_id,
        cost_center,
        cost_object,
        gl_account,
        project_code,
        internal_ref,
        notes,
        created_by: userId,
      }, { onConflict: "organization_id,invoice_id" })
      .select("id, organization_id, invoice_id, entity_id, cost_center, cost_object, gl_account, project_code, internal_ref, notes")
      .maybeSingle();

    if (error) return json(500, { error: "upsert_failed", details: error.message }, origin);

    return json(200, { ok: true, coding: result }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
