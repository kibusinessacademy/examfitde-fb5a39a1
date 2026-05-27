// BerufOS Vertical Checkout — erzeugt eine Stripe-Subscription-Session
// für eine Branchen-Subscription (Starter oder Professional).
//
// Enterprise wird hier nicht gehandhabt (Sales-Kontakt-Flow).
//
// Eingabe: { vertical_slug: string, tier: "starter" | "professional" }
// Auth: Bearer-Token Pflicht — kein Guest-Checkout für Subscriptions.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIER_TO_PRICE: Record<string, { priceId: string; limit: number }> = {
  starter: { priceId: "price_1Tbj0MDxqdaWCpJ6QNObZfxB", limit: 300 },
  professional: { priceId: "price_1Tbj0ODxqdaWCpJ6Uf5p8JsL", limit: 3000 },
};

const ALLOWED_VERTICALS = new Set([
  "praxis",
  "steuer",
  "verwaltung",
  "notar",
  "handwerk",
  "gartenbau",
  "pflege",
  "krankenkasse",
  "kanzlei",
  "makler",
  "foerdermittel",
]);

const log = (step: string, details?: unknown) => {
  const s = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[VERTICAL-CHECKOUT] ${step}${s}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    log("invoked");
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY missing");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization header required");

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(token);
    if (userErr || !userData.user?.email) throw new Error("not authenticated");
    const user = userData.user;
    log("user", { id: user.id, email: user.email });

    const body = await req.json().catch(() => ({}));
    const verticalSlug = String(body?.vertical_slug ?? "").toLowerCase();
    const tier = String(body?.tier ?? "").toLowerCase();

    if (!ALLOWED_VERTICALS.has(verticalSlug)) {
      throw new Error(`unknown vertical_slug: ${verticalSlug}`);
    }
    const cfg = TIER_TO_PRICE[tier];
    if (!cfg) throw new Error(`unknown or non-selfservice tier: ${tier}`);

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Re-use Stripe customer if existing
    const existing = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = existing.data[0]?.id;
    log("customer", { reuse: !!customerId });

    const origin = req.headers.get("origin") || "https://berufos.com";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: cfg.priceId, quantity: 1 }],
      mode: "subscription",
      allow_promotion_codes: true,
      success_url: `${origin}/branchen/${verticalSlug}?checkout=success&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/branchen/${verticalSlug}?checkout=canceled`,
      metadata: {
        vertical_slug: verticalSlug,
        tier,
        user_id: user.id,
      },
      subscription_data: {
        metadata: {
          vertical_slug: verticalSlug,
          tier,
          user_id: user.id,
          monthly_vorgang_limit: String(cfg.limit),
        },
      },
    });

    // Pre-create pending row (idempotent enough via stripe_subscription_id UNIQUE later)
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );
    await supabaseService.from("vertical_subscriptions").insert({
      user_id: user.id,
      vertical_slug: verticalSlug,
      tier,
      status: "pending",
      stripe_customer_id: customerId ?? null,
      stripe_price_id: cfg.priceId,
      monthly_vorgang_limit: cfg.limit,
      metadata: { checkout_session_id: session.id },
    });

    log("session_created", { id: session.id });
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
