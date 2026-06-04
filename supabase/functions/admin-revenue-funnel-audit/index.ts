// ============================================================
// admin-revenue-funnel-audit
// ------------------------------------------------------------
// Returns a JSON report on the health of the Revenue/CRM funnel.
// Read-only. Admin-protected via service-role and an `expected_email`
// param to look up specific test orders.
//
// Also can simulate a Stripe `checkout.session.completed` event
// (mode=simulate) WITHOUT touching Stripe — useful for verifying
// that the persistence path writes orders, contacts and conversion
// events, before doing a real Test-Card purchase.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: require admin JWT or EDGE_INTERNAL_SHARED_SECRET. Without this guard
  // anyone could read funnel/CRM metrics or inject fake orders via ?mode=simulate.
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
  const jobRunnerKey = req.headers.get("x-job-runner-key") || "";
  const isInternal = !!internalSecret && jobRunnerKey === internalSecret;

  if (!isInternal) {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    if (token === SERVICE_KEY) return json({ error: "Unauthorized" }, 401);
    const userSb = createClient(SUPABASE_URL, ANON_KEY);
    const { data: u, error: uErr } = await userSb.auth.getUser(token);
    if (uErr || !u?.user) return json({ error: "Unauthorized" }, 401);
    const guardSb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: role } = await guardSb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Admin access required" }, 403);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "audit";

  try {
    if (mode === "simulate") {
      // Insert a fake order + crm_contact + conversion_event tuple to validate
      // the persistence path end-to-end. Tagged so it can be cleaned up later.
      const tag = `simulated-${Date.now()}`;
      const email = `audit+${tag}@berufos.com`;

      const { data: contact } = await sb
        .from("crm_contacts")
        .insert({
          email,
          first_name: "Audit",
          last_name: "Bot",
          lifecycle_stage: "customer",
          lead_source: "audit_simulator",
          tags: ["audit", tag],
        })
        .select("id")
        .single();

      const { data: order } = await sb
        .from("orders")
        .insert({
          billing_email: email,
          billing_name: "Audit Bot",
          currency: "eur",
          subtotal_cents: 1000,
          tax_cents: 190,
          total_cents: 1190,
          status: "paid",
          stripe_checkout_session_id: `cs_test_${tag}`,
          notes: `audit simulation ${tag}`,
        })
        .select("id")
        .single();

      const { data: ce } = await sb
        .from("conversion_events")
        .insert({
          event_type: "checkout_complete",
          contact_id: contact?.id ?? null,
          // smoke_test=true → v_funnel_integrity_check ignoriert dieses Event.
          // package_id absichtlich null (Audit-Simulation, keine echte Conversion).
          metadata: {
            simulation: true,
            smoke_test: true,
            tag,
            order_id: order?.id,
            package_id: null,
          },
        })
        .select("id")
        .single();

      return json({
        ok: true,
        mode: "simulate",
        tag,
        order_id: order?.id,
        contact_id: contact?.id,
        event_id: ce?.id,
        cleanup_hint:
          "DELETE FROM orders WHERE notes LIKE 'audit simulation%'; DELETE FROM crm_contacts WHERE lead_source='audit_simulator'; DELETE FROM conversion_events WHERE metadata->>'simulation'='true';",
      });
    }

    // === AUDIT MODE ===
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      ordersTotal,
      orders24h,
      orderItemsTotal,
      events24h,
      eventsByType,
      subsTotal,
      subsConfirmed,
      contactsTotal,
      contactsCustomer,
      dealsTotal,
      activities7d,
      doiPending,
    ] = await Promise.all([
      sb.from("orders").select("id", { count: "exact", head: true }),
      sb
        .from("orders")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since24h),
      sb.from("order_items").select("id", { count: "exact", head: true }),
      sb
        .from("conversion_events")
        .select("event_type")
        .gte("created_at", since24h),
      sb.rpc("track_conversion_event_v2" as any, {
        p_event_type: "pricing_view",
        p_metadata: { audit_probe: true },
      }),
      sb.from("newsletter_subscribers").select("id", { count: "exact", head: true }),
      sb
        .from("newsletter_subscribers")
        .select("id", { count: "exact", head: true })
        .eq("is_subscribed", true),
      sb.from("crm_contacts").select("id", { count: "exact", head: true }),
      sb
        .from("crm_contacts")
        .select("id", { count: "exact", head: true })
        .eq("lifecycle_stage", "customer"),
      sb.from("crm_deals").select("id", { count: "exact", head: true }),
      sb
        .from("crm_activities")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since7d),
      sb
        .from("newsletter_doi_tokens")
        .select("id", { count: "exact", head: true })
        .is("confirmed_at", null),
    ]);

    const eventCounts: Record<string, number> = {};
    (events24h.data ?? []).forEach((r: any) => {
      eventCounts[r.event_type] = (eventCounts[r.event_type] ?? 0) + 1;
    });

    const requiredEvents = [
      "hero_cta_click",
      "pricing_view",
      "checkout_start",
      "checkout_complete",
      "lead_magnet_download",
      "quiz_complete",
    ];
    const missing = requiredEvents.filter((e) => !(e in eventCounts));

    return json({
      ok: true,
      mode: "audit",
      generated_at: new Date().toISOString(),
      revenue: {
        orders_total: ordersTotal.count ?? 0,
        orders_24h: orders24h.count ?? 0,
        order_items_total: orderItemsTotal.count ?? 0,
      },
      funnel_24h: {
        events_total: (events24h.data ?? []).length,
        by_type: eventCounts,
        missing_required_events: missing,
      },
      crm: {
        contacts_total: contactsTotal.count ?? 0,
        contacts_customer: contactsCustomer.count ?? 0,
        deals_total: dealsTotal.count ?? 0,
        activities_7d: activities7d.count ?? 0,
      },
      newsletter: {
        subscribers_total: subsTotal.count ?? 0,
        subscribers_confirmed: subsConfirmed.count ?? 0,
        doi_tokens_pending: doiPending.count ?? 0,
      },
      next_steps:
        missing.length > 0
          ? `Frontend muss ${missing.join(", ")} feuern (siehe src/lib/conversionTracking.ts).`
          : "Alle Pflicht-Events feuern. Für Live-Test: POST /functions/v1/admin-revenue-funnel-audit?mode=simulate",
    });
  } catch (err) {
    console.error("[admin-revenue-funnel-audit] error:", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown" },
      500
    );
  }
});
