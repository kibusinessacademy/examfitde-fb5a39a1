import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? body.payload?.limit ?? 50), 200);

    const { data: events, error: eErr } = await sb
      .from("stripe_event_log")
      .select("id, stripe_event_id, event_type, livemode, payload, received_at")
      .is("processed_at", null)
      .order("received_at", { ascending: true })
      .limit(limit);

    if (eErr) throw eErr;

    let processed = 0;
    const results: any[] = [];

    for (const ev of events ?? []) {
      try {
        const out = await processStripeEvent(sb, ev);
        await sb.from("stripe_event_log").update({ processed_at: new Date().toISOString() }).eq("id", ev.id);
        processed++;
        results.push({ stripe_event_id: ev.stripe_event_id, ok: true, out });
      } catch (err: any) {
        results.push({ stripe_event_id: ev.stripe_event_id, ok: false, error: String(err?.message ?? err) });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, results }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[finance-council-reconcile] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

async function processStripeEvent(sb: any, ev: any) {
  const type = ev.event_type;
  const obj = ev.payload?.data?.object;

  if (type === "checkout.session.completed") {
    const pi = obj?.payment_intent ?? null;
    const sessionId = obj?.id ?? null;
    const order = await findOrderBySessionOrPI(sb, sessionId, pi);
    if (!order) return { skipped: true, reason: "order_not_found" };
    await ensureLedgerOrderCreated(sb, order);
    return { matched_order_id: order.id };
  }

  if (type === "payment_intent.succeeded") {
    const pi = obj?.id ?? null;
    const amount = obj?.amount_received ?? obj?.amount ?? 0;
    const currency = obj?.currency ?? "eur";
    const order = await findOrderByPI(sb, pi);
    if (!order) return { skipped: true, reason: "order_not_found", pi };
    await insertPaymentSucceeded(sb, { order, pi, currency, grossCents: amount });
    return { matched_order_id: order.id, payment_intent: pi };
  }

  if (type === "charge.refunded" || type === "charge.refund.updated") {
    const chargeId = obj?.id ?? null;
    const pi = obj?.payment_intent ?? null;
    const refunded = obj?.amount_refunded ?? 0;
    const currency = obj?.currency ?? "eur";
    const order = pi ? await findOrderByPI(sb, pi) : null;
    if (!order) return { skipped: true, reason: "order_not_found", chargeId };
    await insertRefund(sb, { order, pi, chargeId, currency, grossCents: refunded });
    return { matched_order_id: order.id, charge: chargeId };
  }

  return { skipped: true, reason: "unhandled_event_type", type };
}

async function findOrderBySessionOrPI(sb: any, sessionId: string | null, pi: string | null) {
  if (sessionId) {
    const r = await sb.from("orders").select("*").eq("stripe_checkout_session_id", sessionId).maybeSingle();
    if (!r.error && r.data) return r.data;
  }
  if (pi) return await findOrderByPI(sb, pi);
  return null;
}

async function findOrderByPI(sb: any, pi: string) {
  const r = await sb.from("orders").select("*").eq("stripe_payment_intent_id", pi).maybeSingle();
  return r.data ?? null;
}

async function ensureLedgerOrderCreated(sb: any, order: any) {
  const ex = await sb.from("finance_ledger").select("id").eq("order_id", order.id).eq("event_type", "order_created").limit(1);
  if (ex.data?.length) return;
  const taxRate = order.tax_rate ?? (order.tax_cents && order.total_cents ? order.tax_cents / (order.total_cents - order.tax_cents) : 0.19);
  await sb.from("finance_ledger").insert({
    event_type: "order_created", source: "app", order_id: order.id,
    currency: order.currency ?? "eur",
    amount_gross_cents: order.total_cents ?? 0,
    amount_net_cents: order.subtotal_cents ?? 0,
    tax_cents: order.tax_cents ?? 0,
    tax_rate: taxRate, tax_country: order.tax_country ?? order.country ?? "DE",
    customer_type: order.customer_type ?? null,
    buyer_account_id: order.buyer_account_id ?? null,
    learner_user_id: order.learner_user_id ?? null,
    description: "Order created", meta: { source: "orders" },
    occurred_at: order.created_at ?? new Date().toISOString(),
  });
}

async function insertPaymentSucceeded(sb: any, input: { order: any; pi: string; currency: string; grossCents: number }) {
  const { order, pi, currency, grossCents } = input;
  const ex = await sb.from("finance_ledger").select("id").eq("order_id", order.id).eq("event_type", "payment_succeeded").eq("stripe_payment_intent_id", pi).limit(1);
  if (ex.data?.length) return;
  const gross = order.total_cents ?? grossCents ?? 0;
  const net = order.subtotal_cents ?? Math.round(gross / 1.19);
  const tax = order.tax_cents ?? (gross - net);
  const taxRate = order.tax_rate ?? (tax > 0 && net > 0 ? tax / net : 0.19);
  await sb.from("finance_ledger").insert({
    event_type: "payment_succeeded", source: "stripe", order_id: order.id, stripe_payment_intent_id: pi,
    currency: order.currency ?? currency ?? "eur",
    amount_gross_cents: gross, amount_net_cents: net, tax_cents: tax,
    tax_rate: taxRate, tax_country: order.tax_country ?? order.country ?? "DE",
    customer_type: order.customer_type ?? null,
    buyer_account_id: order.buyer_account_id ?? null, learner_user_id: order.learner_user_id ?? null,
    description: "Stripe payment succeeded", meta: { stripe_event: "payment_intent.succeeded" },
    occurred_at: new Date().toISOString(),
  });
}

async function insertRefund(sb: any, input: { order: any; pi: string | null; chargeId: string | null; currency: string; grossCents: number }) {
  const { order, pi, chargeId, currency, grossCents } = input;
  const ex = await sb.from("finance_ledger").select("id").eq("order_id", order.id).eq("event_type", "refund_created").eq("stripe_charge_id", chargeId ?? "").limit(1);
  if (ex.data?.length) return;
  const gross = -Math.abs(grossCents ?? 0);
  const taxRate = order.tax_rate ?? 0.19;
  const net = Math.round(gross / (1 + Number(taxRate)));
  const tax = gross - net;
  await sb.from("finance_ledger").insert({
    event_type: "refund_created", source: "stripe", order_id: order.id,
    stripe_payment_intent_id: pi ?? null, stripe_charge_id: chargeId ?? null,
    currency: order.currency ?? currency ?? "eur",
    amount_gross_cents: gross, amount_net_cents: net, tax_cents: tax,
    tax_rate: taxRate, tax_country: order.tax_country ?? order.country ?? "DE",
    customer_type: order.customer_type ?? null,
    buyer_account_id: order.buyer_account_id ?? null, learner_user_id: order.learner_user_id ?? null,
    description: "Stripe refund", meta: { stripe_event: "charge.refunded" },
    occurred_at: new Date().toISOString(),
  });
}
