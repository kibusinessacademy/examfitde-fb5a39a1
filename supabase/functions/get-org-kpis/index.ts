// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import {
  type ReportScope,
  clampScope,
  isUuid,
  parseRangeParams,
  fiscalYearRange,
  isoDate,
  addDays,
} from "../_shared/org_privacy.ts";

type SeatCounts = Record<string, number>;

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

    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwtToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwtToken) return json(401, { error: "Missing Bearer token" }, origin);

    const { data: u } = await supabase.auth.getUser(jwtToken);
    const userId = u?.user?.id;
    if (!userId) return json(401, { error: "Invalid token" }, origin);

    const url = new URL(req.url);
    const orgId = url.searchParams.get("organization_id");
    if (!isUuid(orgId)) return json(400, { error: "Missing/invalid organization_id" }, origin);

    // 1) Membership check (SSOT: org_memberships)
    const { data: mem, error: memErr } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (memErr) return json(500, { error: "membership_failed", details: memErr.message }, origin);
    if (!mem?.role) return json(403, { error: "Not a member of organization" }, origin);

    // 2) Org settings
    const { data: org } = await supabase
      .from("organizations")
      .select("id, fiscal_year_start_month, default_report_scope")
      .eq("id", orgId)
      .maybeSingle();

    if (!org?.id) return json(404, { error: "Organization not found" }, origin);

    // 3) Privacy gate
    const { data: privacy } = await supabase
      .from("org_privacy_access")
      .select("status, scope, approved_until")
      .eq("organization_id", orgId)
      .maybeSingle();

    const now = new Date();
    const approvedUntil = privacy?.approved_until ? new Date(privacy.approved_until) : null;
    const isIdentApproved =
      privacy?.status === "APPROVED" && approvedUntil && approvedUntil.getTime() > now.getTime();

    const orgDefaultScope = (org.default_report_scope ?? "ANONYMIZED") as ReportScope;
    const requestedScope = clampScope(url.searchParams.get("scope"), orgDefaultScope);

    // Effective scope: IDENTIFIED requires approval, otherwise downgrade
    const effectiveScope: ReportScope =
      requestedScope === "IDENTIFIED"
        ? (isIdentApproved ? "IDENTIFIED" : "PSEUDONYMIZED")
        : requestedScope;

    // 4) Time range
    const mode = (url.searchParams.get("mode") ?? "fiscal_year").toLowerCase();
    let start: Date;
    let end: Date;

    if (mode === "range") {
      const { start_date, end_date } = parseRangeParams(url);
      if (!start_date || !end_date) {
        return json(400, { error: "range mode requires start_date and end_date (YYYY-MM-DD)" }, origin);
      }
      start = new Date(`${start_date}T00:00:00.000Z`);
      end = addDays(new Date(`${end_date}T00:00:00.000Z`), 1);
    } else if (mode === "calendar_year") {
      const y = parseInt(url.searchParams.get("year") ?? `${now.getUTCFullYear()}`, 10);
      start = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
      end = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
    } else {
      const fy = fiscalYearRange(now, org.fiscal_year_start_month ?? 1);
      start = fy.start;
      end = fy.end;
    }

    // 5) Billing accounts (SSOT anchor)
    const { data: bas, error: baErr } = await supabase
      .from("billing_accounts")
      .select("id, entity_id, is_default")
      .eq("organization_id", orgId);

    if (baErr) return json(500, { error: "billing_accounts_failed", details: baErr.message }, origin);

    const baIds = (bas ?? []).map((b: any) => b.id);

    // Optional entity filter
    const entityId = url.searchParams.get("entity_id");
    const baIdsFiltered = isUuid(entityId)
      ? (bas ?? []).filter((b: any) => b.entity_id === entityId).map((b: any) => b.id)
      : baIds;

    // 6) Seat KPIs
    const { data: seats, error: seatErr } = await supabase
      .from("organization_seats")
      .select("id, seat_status, end_at, start_at, entity_id")
      .eq("organization_id", orgId);

    if (seatErr) return json(500, { error: "seats_failed", details: seatErr.message }, origin);

    const seatCounts: SeatCounts = {};
    let expiring30 = 0;
    let expired = 0;
    const cutoff30 = addDays(now, 30);
    const todayStr = isoDate(now);

    for (const s of (seats ?? [])) {
      const st = s.seat_status ?? "UNKNOWN";
      seatCounts[st] = (seatCounts[st] || 0) + 1;

      if (s.end_at) {
        if (s.end_at < todayStr) expired++;
        const endDate = new Date(`${s.end_at}T00:00:00.000Z`);
        if (endDate.getTime() >= now.getTime() && endDate.getTime() <= cutoff30.getTime()) expiring30++;
      }
    }

    // 7) Financial KPIs (leak-safe via billing_account_id)
    let ordersCount = 0;
    let ordersGrossCents = 0;
    let invoicesCount = 0;
    let invoicesGrossCents = 0;
    let invoicesOpenCount = 0;
    let paymentsPaidCents = 0;

    if (baIdsFiltered.length > 0) {
      const [ordersRes, invoicesRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id, total_cents, created_at, status, billing_account_id")
          .in("billing_account_id", baIdsFiltered)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString()),
        supabase
          .from("invoices")
          .select("id, status, total_gross_cents, issue_date, billing_account_id")
          .in("billing_account_id", baIdsFiltered)
          .gte("issue_date", isoDate(start))
          .lt("issue_date", isoDate(end)),
      ]);

      if (ordersRes.error) return json(500, { error: "orders_failed", details: ordersRes.error.message }, origin);
      if (invoicesRes.error) return json(500, { error: "invoices_failed", details: invoicesRes.error.message }, origin);

      for (const o of (ordersRes.data ?? [])) {
        ordersCount++;
        ordersGrossCents += (o.total_cents ?? 0);
      }

      const orderIds = (ordersRes.data ?? []).map((o: any) => o.id);

      for (const i of (invoicesRes.data ?? [])) {
        invoicesCount++;
        invoicesGrossCents += (i.total_gross_cents ?? 0);
        if (String(i.status ?? "").toUpperCase() !== "PAID") invoicesOpenCount++;
      }

      // Payments for bounded orderIds
      if (orderIds.length > 0) {
        const { data: pays, error: pErr } = await supabase
          .from("payments")
          .select("id, amount_cents, paid_at, payment_status, order_id")
          .in("order_id", orderIds);

        if (pErr) return json(500, { error: "payments_failed", details: pErr.message }, origin);

        for (const p of (pays ?? [])) {
          if (String(p.payment_status ?? "").toUpperCase() === "PAID") {
            paymentsPaidCents += (p.amount_cents ?? 0);
          }
        }
      }
    }

    // 8) Report audit
    await supabase.from("org_report_runs").insert({
      organization_id: orgId,
      run_by: userId,
      report_key: "ORG_KPIS",
      scope: effectiveScope,
      params: {
        mode,
        start: start.toISOString(),
        end: end.toISOString(),
        requested_scope: requestedScope,
        entity_id: isUuid(entityId) ? entityId : null,
      },
    });

    // 9) Response (no individual learner data)
    return json(200, {
      organization_id: orgId,
      my_role: mem.role,
      privacy: {
        requested_scope: requestedScope,
        effective_scope: effectiveScope,
        ident_approved: !!isIdentApproved,
        approved_until: privacy?.approved_until ?? null,
        status: privacy?.status ?? "NONE",
      },
      period: {
        mode,
        start_date: isoDate(start),
        end_date_exclusive: isoDate(end),
      },
      seats: {
        counts: seatCounts,
        expiring_within_30_days: expiring30,
        expired,
      },
      billing: {
        billing_accounts_count: baIdsFiltered.length,
        orders_count: ordersCount,
        orders_gross_cents: ordersGrossCents,
        invoices_count: invoicesCount,
        invoices_gross_cents: invoicesGrossCents,
        invoices_open_count: invoicesOpenCount,
        payments_paid_cents: paymentsPaidCents,
      },
    }, origin);
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) }, origin);
  }
});
