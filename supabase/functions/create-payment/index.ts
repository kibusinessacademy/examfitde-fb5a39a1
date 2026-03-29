import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-PAYMENT] ${step}`, details ? JSON.stringify(details) : "");
};

/**
 * create-payment: Product-based Stripe Checkout for B2C + B2B self-service.
 *
 * Routes:
 * A) Paywall variant flow (experiment_key provided) → uses variant's stripe_price_id
 * B) Pricing plan flow (pricing_plan_id provided) → uses plan's stripe_price_id
 *
 * SSOT: All prices resolved server-side from DB. No client price trust.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (!stripeKey) {
    return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey);
  const sb = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user?.email) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    logStep("Authenticated", { userId: user.id });

    const body = await req.json();
    const {
      product_id,
      pricing_plan_id,
      experiment_key,
      variant_key,
      trigger_context,
      success_url,
      cancel_url,
      org_name,
    } = body;

    if (!product_id) {
      return new Response(JSON.stringify({ error: "product_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || "https://examfitde.lovable.app";
    let stripe_price_id: string | null = null;
    let price_cents: number | null = null;
    let resolved_plan_key: string | null = null;
    let seat_count = 1;
    let duration_days = 365;
    let checkout_metadata: Record<string, string> = {
      user_id: user.id,
      product_id,
      checkout_source: "create-payment",
    };

    // ── Route A: Paywall variant flow ──
    if (experiment_key) {
      logStep("Resolving via experiment", { experiment_key, variant_key });

      // Get assignment
      const { data: variantData } = await sb.rpc("assign_paywall_variant" as any, {
        p_user_id: user.id,
        p_experiment_key: experiment_key,
        p_platform: "web",
      });

      const v = variantData as Record<string, unknown> | null;
      if (!v || (v as any).error) {
        return new Response(JSON.stringify({ error: "No variant assigned" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      stripe_price_id = (v.stripe_price_id as string) || null;
      price_cents = (v.web_price_cents as number) ?? (v.price_cents as number);

      if (!stripe_price_id) {
        return new Response(
          JSON.stringify({ error: "Variant has no stripe_price_id for web checkout" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      checkout_metadata.experiment_key = experiment_key;
      checkout_metadata.variant_key = (v.variant_key as string) || "";
      checkout_metadata.trigger_context = trigger_context || "";
      checkout_metadata.flow = "paywall_variant";
    }
    // ── Route B: Pricing plan flow ──
    else if (pricing_plan_id) {
      logStep("Resolving via pricing plan", { pricing_plan_id });

      const { data: plan, error: planErr } = await sb
        .from("pricing_plans")
        .select("*")
        .eq("id", pricing_plan_id)
        .eq("is_active", true)
        .single();

      if (planErr || !plan) {
        return new Response(JSON.stringify({ error: "Pricing plan not found or inactive" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (plan.checkout_mode !== "self_service") {
        return new Response(JSON.stringify({ error: "Plan is sales-only, cannot self-checkout" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (plan.product_id !== product_id) {
        return new Response(JSON.stringify({ error: "Plan does not match product" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      stripe_price_id = plan.stripe_price_id;
      price_cents = plan.price_cents;
      seat_count = plan.seat_count || 1;
      duration_days = plan.duration_days || 365;
      resolved_plan_key = plan.plan_key;

      if (!stripe_price_id) {
        return new Response(
          JSON.stringify({ error: "Plan has no stripe_price_id configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      checkout_metadata.pricing_plan_id = pricing_plan_id;
      checkout_metadata.plan_key = plan.plan_key;
      checkout_metadata.seat_count = String(seat_count);
      checkout_metadata.duration_days = String(duration_days);
      checkout_metadata.audience_type = plan.audience_type;
      checkout_metadata.flow = "pricing_plan";
      if (org_name) checkout_metadata.org_name = org_name;
    } else {
      return new Response(
        JSON.stringify({ error: "Either experiment_key or pricing_plan_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Create Stripe Checkout Session ──
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      customer_creation: customerId ? undefined : "always",
      line_items: [{ price: stripe_price_id!, quantity: 1 }],
      mode: "payment",
      success_url: success_url || `${origin}/purchase-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${origin}/shop?canceled=true`,
      metadata: checkout_metadata,
      invoice_creation: { enabled: true },
      billing_address_collection: "required",
    });

    logStep("Checkout session created", { sessionId: session.id, price_cents, seat_count });

    // ── Track checkout_started event ──
    await sb.from("conversion_events").insert({
      user_id: user.id,
      event_type: "checkout_started",
      metadata: {
        product_id,
        session_id: session.id,
        experiment_key: checkout_metadata.experiment_key,
        variant_key: checkout_metadata.variant_key,
        plan_key: resolved_plan_key,
        price_cents,
        seat_count,
      },
    }).then(() => {});

    return new Response(
      JSON.stringify({
        checkout_url: session.url,
        session_id: session.id,
        product_id,
        experiment_key: checkout_metadata.experiment_key || null,
        variant_key: checkout_metadata.variant_key || null,
        plan_key: resolved_plan_key,
        seat_count,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
