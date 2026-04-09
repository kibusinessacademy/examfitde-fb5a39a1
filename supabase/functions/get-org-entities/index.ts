// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { isUuid } from "../_shared/org_privacy.ts";

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
    const jwtToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwtToken) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwtToken);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" }, origin);

    const url = new URL(req.url);
    const organization_id = url.searchParams.get("organization_id");
    if (!isUuid(organization_id)) return json(400, { error: "Missing/invalid organization_id" }, origin);

    // Membership gate (SSOT: org_memberships)
    const { data: mem, error: memErr } = await supabase
      .from("org_memberships")
      .select("id, role")
      .eq("org_id", organization_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (memErr) return json(500, { error: "membership_failed", details: memErr.message }, origin);
    if (!mem) return json(403, { error: "not_org_member" }, origin);

    const [entitiesRes, defaultsRes, billingRes] = await Promise.all([
      supabase
        .from("organization_entities")
        .select("id, organization_id, entity_code, legal_name, display_name, vat_id, billing_email, is_default, created_at, updated_at")
        .eq("organization_id", organization_id)
        .order("entity_code"),
      supabase
        .from("org_entity_accounting_defaults")
        .select("id, entity_id, default_cost_center, default_cost_object, default_gl_account, default_project_code, created_at, updated_at"),
      supabase
        .from("billing_accounts")
        .select("id, organization_id, entity_id, label, is_default, stripe_customer_id, created_at, updated_at")
        .eq("organization_id", organization_id),
    ]);

    const entities = entitiesRes.data ?? [];
    const defaults = defaultsRes.data ?? [];
    const billing_accounts = billingRes.data ?? [];

    const defaultsByEntity: Record<string, unknown> = {};
    for (const d of defaults) defaultsByEntity[d.entity_id] = d;

    const billingByEntity: Record<string, unknown[]> = {};
    for (const b of billing_accounts) {
      const key = b.entity_id ?? "ORG";
      if (!billingByEntity[key]) billingByEntity[key] = [];
      billingByEntity[key].push(b);
    }

    return json(200, {
      organization_id,
      my_role: mem.role,
      entities: entities.map((e: any) => ({
        ...e,
        accounting_defaults: defaultsByEntity[e.id] ?? null,
        billing_accounts: billingByEntity[e.id] ?? [],
      })),
      org_billing_accounts: billingByEntity["ORG"] ?? [],
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
