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
    const invoice_id = isUuid(body.invoice_id) ? body.invoice_id : null;
    const entity_id = isUuid(body.entity_id) ? body.entity_id : null;

    if (!organization_id || !invoice_id) {
      return json(400, { error: "Missing organization_id or invoice_id" }, origin);
    }

    // Role gate: must be OWNER/BILLING (SSOT: org_memberships)
    const { data: mem } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", organization_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    const role = mem?.role ?? null;
    if (!role || !["OWNER", "BILLING"].includes(role)) {
      return json(403, { error: "Insufficient role (requires OWNER/BILLING)" }, origin);
    }

    // SSOT check: invoice must belong to this org via billing_account_id
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, billing_account_id")
      .eq("id", invoice_id)
      .maybeSingle();

    if (!inv?.billing_account_id) return json(404, { error: "Invoice not found or not linked to billing account" }, origin);

    const { data: ba } = await supabase
      .from("billing_accounts")
      .select("id, organization_id")
      .eq("id", inv.billing_account_id)
      .maybeSingle();

    if (!ba?.organization_id || ba.organization_id !== organization_id) {
      return json(403, { error: "Invoice does not belong to organization (SSOT)" }, origin);
    }

    const payload = {
      organization_id,
      entity_id,
      invoice_id,
      cost_center: clampStr(body.cost_center, 80),
      cost_object: clampStr(body.cost_object, 80),
      gl_account: clampStr(body.gl_account, 40),
      project_code: clampStr(body.project_code, 80),
      internal_ref: clampStr(body.internal_ref, 80),
      notes: clampStr(body.notes, 400),
      created_by: userId,
    };

    const { data, error } = await supabase
      .from("org_invoice_coding")
      .upsert(payload, { onConflict: "organization_id,invoice_id" })
      .select("id, organization_id, entity_id, invoice_id, cost_center, cost_object, gl_account, project_code, internal_ref, notes, updated_at")
      .maybeSingle();

    if (error) return json(500, { error: "upsert_failed", details: error.message }, origin);

    return json(200, { ok: true, coding: data }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
