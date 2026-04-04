/**
 * create-product-checkout — B2C Einmalkauf-Checkout für Landingpages.
 * 
 * Input: { product_slug: string }
 * Output: { ok: true, checkout_url: string, order_id: string }
 *
 * Flow:
 *   1. Auth user
 *   2. Load product + active price from product_prices
 *   3. Create order (pending)
 *   4. Create Stripe Checkout Session (mode: payment)
 *   5. Return checkout_url
 */
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-PRODUCT-CHECKOUT] ${step}`, details ? JSON.stringify(details) : '');
};

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user?.email) {
      throw new Error("User not authenticated");
    }
    logStep("User authenticated", { userId: user.id, email: user.email });

    // ── Parse request ──
    const body = await req.json();
    const productSlug = String(body.product_slug ?? "").trim();
    if (!productSlug) {
      return new Response(JSON.stringify({ error: "product_slug is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── Load product ──
    const { data: product, error: productError } = await adminClient
      .from("products")
      .select("id, slug, title, certification_id")
      .eq("slug", productSlug)
      .eq("status", "active")
      .single();

    if (productError || !product) {
      logStep("Product not found", { slug: productSlug, error: productError?.message });
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    logStep("Product loaded", { id: product.id, title: product.title });

    // ── Load active price ──
    const { data: price, error: priceError } = await adminClient
      .from("product_prices")
      .select("id, amount_cents, currency, access_months, stripe_price_id, compare_at_cents")
      .eq("product_id", product.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (priceError || !price) {
      logStep("No active price", { productId: product.id, error: priceError?.message });
      return new Response(JSON.stringify({ error: "No active price for this product" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    logStep("Price loaded", { id: price.id, amount_cents: price.amount_cents });

    // ── Check existing entitlement (prevent double-buy) ──
    const { data: existingEntitlement } = await adminClient
      .from("entitlements")
      .select("id, valid_until")
      .eq("user_id", user.id)
      .eq("product_id", product.id)
      .gt("valid_until", new Date().toISOString())
      .limit(1);

    if (existingEntitlement && existingEntitlement.length > 0) {
      logStep("User already has active entitlement", { entitlementId: existingEntitlement[0].id });
      return new Response(JSON.stringify({
        error: "Du hast bereits Zugang zu diesem Produkt.",
        already_entitled: true,
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create order (pending) ──
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .insert({
        buyer_user_id: user.id,
        subtotal_cents: price.amount_cents,
        total_cents: price.amount_cents,
        tax_cents: 0,
        currency: price.currency,
        status: "pending",
        customer_type: "b2c",
        billing_email: user.email,
        notes: `product_checkout:${product.slug}`,
      })
      .select("id")
      .single();

    if (orderError || !order) {
      logStep("Order creation failed", { error: orderError?.message });
      throw new Error(orderError?.message ?? "Order creation failed");
    }
    logStep("Order created", { orderId: order.id });

    // ── Stripe Checkout Session ──
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Check if customer exists
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

    const appUrl = origin || Deno.env.get("APP_URL") || "https://examfit.de";

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = price.stripe_price_id
      ? [{ price: price.stripe_price_id, quantity: 1 }]
      : [{
          price_data: {
            currency: price.currency.toLowerCase(),
            product_data: { name: product.title },
            unit_amount: price.amount_cents,
          },
          quantity: 1,
        }];

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: lineItems,
      success_url: `${appUrl}/checkout/success?order_id=${order.id}`,
      cancel_url: `${appUrl}/landing/FORTBILDUNG/${product.slug}?checkout=cancelled`,
      metadata: {
        order_id: order.id,
        product_id: product.id,
        user_id: user.id,
        product_slug: product.slug,
        flow: "paywall_variant",
        checkout_source: "create-payment",
        access_months: String(price.access_months),
        duration_days: String(price.access_months * 30),
      },
    });

    // ── Update order with session ID ──
    await adminClient
      .from("orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", order.id);

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    return new Response(JSON.stringify({
      ok: true,
      checkout_url: session.url,
      order_id: order.id,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logStep("ERROR", { error: message });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
