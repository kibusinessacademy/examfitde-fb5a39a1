// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { isUuid, clampInt } from "../_shared/org_privacy.ts";

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
    const orgId = url.searchParams.get("organization_id");
    if (!isUuid(orgId)) return json(400, { error: "Missing/invalid organization_id" }, origin);

    // Paging
    const page = clampInt(url.searchParams.get("page"), 1, 1, 2000);
    const pageSize = clampInt(url.searchParams.get("page_size"), 20, 5, 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const invoiceStatus = url.searchParams.get("invoice_status");
    const entityId = url.searchParams.get("entity_id");
    const billingAccountId = url.searchParams.get("billing_account_id");

    // 1) Membership check (SSOT: org_memberships)
    const { data: mem } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!mem?.role) return json(403, { error: "Not a member of organization" }, origin);

    // 2) Billing accounts (SSOT anchor)
    let baQ = supabase
      .from("billing_accounts")
      .select("id, organization_id, entity_id, label, currency, is_default, stripe_customer_id, billing_email, billing_name, vat_id")
      .eq("organization_id", orgId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (isUuid(entityId)) baQ = baQ.eq("entity_id", entityId);
    if (isUuid(billingAccountId)) baQ = baQ.eq("id", billingAccountId);

    const { data: billingAccounts, error: baErr } = await baQ;
    if (baErr) return json(500, { error: "billing_accounts_failed", details: baErr.message }, origin);

    const baIds = (billingAccounts ?? []).map((b: any) => b.id);

    if (baIds.length === 0) {
      return json(200, {
        organization_id: orgId,
        my_role: mem.role,
        billing_accounts: [],
        invoices: [],
        orders: [],
        payments: [],
        paging: { page, page_size: pageSize, returned: 0 },
      }, origin);
    }

    // 3) Orders (only via billing_account_id – leak-safe)
    const { data: orders, error: oErr } = await supabase
      .from("orders")
      .select("id, created_at, status, total_cents, currency, billing_account_id")
      .in("billing_account_id", baIds)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (oErr) return json(500, { error: "orders_failed", details: oErr.message }, origin);

    const orderIds = (orders ?? []).map((o: any) => o.id);

    // 4) Invoices (only via billing_account_id) + optional status filter
    let invQ = supabase
      .from("invoices")
      .select("id, order_id, invoice_number, issue_date, status, total_gross_cents, billing_account_id")
      .in("billing_account_id", baIds)
      .order("issue_date", { ascending: false })
      .range(from, to);

    if (invoiceStatus && typeof invoiceStatus === "string") invQ = invQ.eq("status", invoiceStatus);

    const { data: invoices, error: iErr } = await invQ;
    if (iErr) return json(500, { error: "invoices_failed", details: iErr.message }, origin);

    // 5) Payments (only for returned orders – bounded payload)
    let payments: any[] = [];
    if (orderIds.length > 0) {
      const { data: pay, error: pErr } = await supabase
        .from("payments")
        .select("id, order_id, amount_cents, currency, payment_status, paid_at")
        .in("order_id", orderIds)
        .order("paid_at", { ascending: false })
        .limit(200);

      if (pErr) return json(500, { error: "payments_failed", details: pErr.message }, origin);
      payments = pay ?? [];
    }

    return json(200, {
      organization_id: orgId,
      my_role: mem.role,
      billing_accounts: billingAccounts ?? [],
      orders: orders ?? [],
      invoices: invoices ?? [],
      payments,
      paging: { page, page_size: pageSize, returned: (invoices ?? []).length },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
