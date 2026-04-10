import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-B2B-CHECKOUT] ${step}`, details ? JSON.stringify(details) : "");
};

/**
 * create-b2b-checkout: Creates a Stripe Checkout session for B2B subscriptions.
 * 
 * Body params:
 *   price_id: string (Stripe recurring price ID)
 *   category: string (ausbildung | studium | zertifizierung | weiterbildung)
 *   seats: number (5 | 10 | 25)
 *   org_id?: string (existing org, or new one is created)
 *   org_name?: string (for new org creation)
 *   success_url?: string
 *   cancel_url?: string
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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey);
  const sb = createClient(supabaseUrl, serviceRoleKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user?.email) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    logStep("Authenticated", { userId: user.id });

    const body = await req.json();
    const { price_id, category, seats, org_id, org_name, success_url, cancel_url } = body;

    if (!price_id || !category || !seats) {
      return new Response(JSON.stringify({ error: "price_id, category, and seats are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validCategories = ['ausbildung', 'studium', 'zertifizierung', 'weiterbildung'];
    if (!validCategories.includes(category)) {
      return new Response(JSON.stringify({ error: "Invalid category" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validSeats = [5, 10, 25];
    if (!validSeats.includes(Number(seats))) {
      return new Response(JSON.stringify({ error: "Invalid seat count (5, 10, or 25)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve or prepare org_id
    let resolvedOrgId = org_id;
    if (!resolvedOrgId) {
      // Check if user already owns an org
      const { data: existingMembership } = await sb
        .from('org_memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .eq('role', 'owner')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (existingMembership) {
        resolvedOrgId = existingMembership.org_id;
        logStep("Using existing org", { orgId: resolvedOrgId });
      }
      // If no org exists, it will be created in the webhook after payment
    }

    const origin = req.headers.get("origin") || "https://examfitde.lovable.app";
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Find or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

    const checkoutMetadata: Record<string, string> = {
      user_id: user.id,
      checkout_source: "create-b2b-checkout",
      flow: "b2b_subscription",
      category,
      seats: String(seats),
      org_name: org_name || 'Organisation',
    };
    if (resolvedOrgId) checkoutMetadata.org_id = resolvedOrgId;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      customer_creation: customerId ? undefined : "always",
      line_items: [{ price: price_id, quantity: 1 }],
      mode: "subscription",
      success_url: success_url || `${origin}/purchase-success?session_id={CHECKOUT_SESSION_ID}&type=b2b`,
      cancel_url: cancel_url || `${origin}/b2b?canceled=true`,
      metadata: checkoutMetadata,
      subscription_data: {
        metadata: checkoutMetadata,
      },
      billing_address_collection: "required",
      allow_promotion_codes: true,
    });

    logStep("B2B Checkout session created", { sessionId: session.id, category, seats });

    return new Response(
      JSON.stringify({
        checkout_url: session.url,
        session_id: session.id,
        category,
        seats,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
