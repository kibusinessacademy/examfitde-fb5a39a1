/**
 * admin-stripe-webhook-test
 * --------------------------------------------------------------
 * Admin-only. Builds a synthetic Stripe event, HMAC-signs it with
 * STRIPE_WEBHOOK_SECRET, POSTs to the live /stripe-webhook function,
 * and returns the HTTP result so the admin can see 200 OK / error.
 *
 * Auth: requires authenticated user with role 'admin' (checked via RPC).
 *
 * Body: { event_type: 'checkout.session.completed' | 'checkout.session.expired'
 *       | 'payment_intent.payment_failed' | 'charge.refunded' }
 */
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
]);

function syntheticPayload(eventType: string) {
  const id = `evt_test_${Math.random().toString(36).slice(2, 14)}`;
  const now = Math.floor(Date.now() / 1000);
  const base = {
    id,
    object: "event",
    api_version: "2024-12-18.acacia",
    created: now,
    livemode: false,
    type: eventType,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  };

  if (eventType === "checkout.session.completed") {
    return {
      ...base,
      data: {
        object: {
          id: `cs_test_${Math.random().toString(36).slice(2, 14)}`,
          object: "checkout.session",
          payment_status: "unpaid", // safe: handler skips
          mode: "payment",
          customer_email: "synthetic-admin-test@examfit-smoke.local",
          amount_total: 100,
          currency: "eur",
          metadata: { source: "admin-trigger-test" },
        },
      },
    };
  }
  if (eventType === "checkout.session.expired") {
    return {
      ...base,
      data: {
        object: {
          id: `cs_test_${Math.random().toString(36).slice(2, 14)}`,
          object: "checkout.session",
          status: "expired",
          mode: "payment",
          customer_email: "synthetic-admin-test@examfit-smoke.local",
          amount_total: 100,
          currency: "eur",
          metadata: { source: "admin-trigger-test" },
        },
      },
    };
  }
  if (eventType === "payment_intent.payment_failed") {
    return {
      ...base,
      data: {
        object: {
          id: `pi_test_${Math.random().toString(36).slice(2, 14)}`,
          object: "payment_intent",
          status: "requires_payment_method",
          last_payment_error: { code: "card_declined", message: "Synthetic test failure" },
          amount: 100,
          currency: "eur",
          metadata: { source: "admin-trigger-test" },
        },
      },
    };
  }
  if (eventType === "charge.refunded") {
    return {
      ...base,
      data: {
        object: {
          id: `ch_test_${Math.random().toString(36).slice(2, 14)}`,
          object: "charge",
          refunded: true,
          amount: 100,
          amount_refunded: 100,
          currency: "eur",
          payment_intent: `pi_test_${Math.random().toString(36).slice(2, 14)}`,
          metadata: { source: "admin-trigger-test" },
        },
      },
    };
  }
  return base;
}

function signPayload(body: string, secret: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${body}`;
  const sig = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${ts},v1=${sig}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: "STRIPE_WEBHOOK_SECRET not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Role check via service-role
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleCheck } = await adminClient.rpc("has_role" as any, {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleCheck !== true) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Parse + validate body
    const body = await req.json().catch(() => ({}));
    const eventType = String(body?.event_type || "");
    if (!ALLOWED_EVENTS.has(eventType)) {
      return new Response(JSON.stringify({
        error: "Invalid event_type",
        allowed: Array.from(ALLOWED_EVENTS),
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build, sign, POST
    const payload = syntheticPayload(eventType);
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody, WEBHOOK_SECRET);

    const webhookUrl = `${SUPABASE_URL}/functions/v1/stripe-webhook`;
    const started = Date.now();
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": signature,
      },
      body: rawBody,
    });
    const respText = await resp.text();
    const durationMs = Date.now() - started;

    // Audit
    try {
      await adminClient.from("stripe_event_log")
        .update({
          handler_notes: {
            triggered_by: userData.user.email,
            triggered_at: new Date().toISOString(),
            response_status: resp.status,
          },
        })
        .eq("stripe_event_id", payload.id);
    } catch (_e) { /* non-blocking */ }

    return new Response(JSON.stringify({
      ok: resp.ok,
      status: resp.status,
      stripe_event_id: payload.id,
      event_type: eventType,
      duration_ms: durationMs,
      response_body: respText.slice(0, 1000),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
